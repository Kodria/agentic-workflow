import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { LEDGER_RESOLVE_KIND, parseLedgerEntry, parseLedgerResolveRecord } from './types';
import type { LedgerEntry, LedgerResolveRecord, ResolvedHow } from './types';
import { clusterEntries } from './cluster';
import type { RecurringCluster } from './cluster';

const LEDGER_DIR = path.join('.awm', 'ledger');

/** Zero-dep stable id: ISO-ish timestamp stamp + random hex (RF-4.7 / S5 fallback). */
export function generateLedgerEntryId(now: Date = new Date()): string {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return `${stamp}-${randomBytes(6).toString('hex')}`;
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSafeDirectory(directory: string, root: string, name: string): string {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe ledger ${name} directory`);
    const real = fs.realpathSync(directory);
    if (!isWithin(root, real)) throw new Error(`ledger ${name} directory escapes its root`);
    return real;
}

function sourceExists(source: string): boolean {
    try {
        fs.lstatSync(source);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function assertSafeLedgerSource(source: string, ledgerRoot: string): void {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('unsafe ledger source');
    const real = fs.realpathSync(source);
    if (!isWithin(ledgerRoot, real)) throw new Error('ledger source escapes ledger directory');
}

function ledgerFilename(branch: string): string {
    if (typeof branch !== 'string'
        || branch.length === 0
        || branch.includes('\\')
        || path.posix.isAbsolute(branch)
        || path.win32.isAbsolute(branch)
        || branch.split('/').some(segment => segment === '.' || segment === '..')) {
        throw new Error('invalid ledger branch');
    }
    return branch.replace(/\//g, '__');
}

function archiveLabel(label: string): string {
    if (typeof label !== 'string'
        || label.length === 0
        || label === '.'
        || label.includes('..')
        || /[/\\]/.test(label)
        || path.posix.isAbsolute(label)
        || path.win32.isAbsolute(label)) {
        throw new Error('invalid ledger label');
    }
    return label;
}

function destinationExists(destination: string): boolean {
    try {
        fs.lstatSync(destination);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

export function detectBranch(cwd: string): string {
    try {
        const b = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
        }).trim();
        return b && b !== 'HEAD' ? b : '_no-branch';
    } catch {
        return '_no-branch';
    }
}

export function ledgerPath(cwd: string, branch: string): string {
    return path.join(cwd, LEDGER_DIR, `${ledgerFilename(branch)}.jsonl`);
}

export function addEntry(cwd: string, entry: LedgerEntry): void {
    const withId: LedgerEntry = entry.id ? entry : { ...entry, id: generateLedgerEntryId() };
    const parsed = parseLedgerEntry(withId, 'ledger entry');
    if (!parsed.ok) throw new Error(`invalid ledger entry: ${parsed.reason}`);
    const p = ledgerPath(cwd, withId.branch);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(parsed.entry) + '\n', 'utf-8');
}

/**
 * Fold append-only resolve records onto entries by id.
 * Malformed / non-entry / non-resolve lines are skipped for the view but left
 * untouched on disk (CQ-S5-2). First resolution wins.
 */
export function listEntries(cwd: string, branch: string): LedgerEntry[] {
    const p = ledgerPath(cwd, branch);
    if (!fs.existsSync(p)) return [];
    const out: LedgerEntry[] = [];
    const indexById = new Map<string, number>();
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let raw: unknown;
        try {
            raw = JSON.parse(trimmed) as unknown;
        } catch {
            continue;
        }
        const resolve = parseLedgerResolveRecord(raw);
        if (resolve.ok) {
            const idx = indexById.get(resolve.record.id);
            if (idx === undefined) continue;
            if (out[idx].resolved !== undefined) continue;
            out[idx] = { ...out[idx], resolved: resolve.record.resolved };
            continue;
        }
        if (resolve.reason === 'invalid-resolve') continue;
        try {
            const parsed = parseLedgerEntry(raw, p);
            if (!parsed.ok) continue;
            // First entry wins for id → fold index (matches resolveById's find).
            // Last-wins here desyncs fold from resolveById when duplicate ids appear.
            if (typeof parsed.entry.id === 'string' && parsed.entry.id.length > 0 && !indexById.has(parsed.entry.id)) {
                indexById.set(parsed.entry.id, out.length);
            }
            out.push(parsed.entry);
        } catch { /* skip unexpected parse throw */ }
    }
    return out;
}

/** Deferred && !resolved — mechanical QA open set (RF-4.7). */
export function listDeferredOpen(cwd: string, branch: string): LedgerEntry[] {
    return listEntries(cwd, branch).filter(e => e.deferred !== undefined && e.resolved === undefined);
}

function appendResolveRecord(cwd: string, branch: string, record: LedgerResolveRecord): void {
    const parsed = parseLedgerResolveRecord(record);
    if (!parsed.ok) throw new Error(`invalid ledger resolve record: ${parsed.reason}`);
    const p = ledgerPath(cwd, branch);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(parsed.record) + '\n', 'utf-8');
}

export function resolveById(cwd: string, branch: string, id: string, how: ResolvedHow, at: string = new Date().toISOString()): LedgerEntry {
    if (typeof id !== 'string' || id.length === 0) throw new Error('resolve requires a non-empty --id');
    const entries = listEntries(cwd, branch);
    const target = entries.find(e => e.id === id);
    if (target === undefined) throw new Error(`ledger entry not found for id "${id}"`);
    if (target.resolved !== undefined) throw new Error(`ledger entry "${id}" is already resolved`);
    if (target.deferred === undefined) throw new Error(`ledger entry "${id}" is not deferred`);
    const resolved = { at, how };
    appendResolveRecord(cwd, branch, { kind: LEDGER_RESOLVE_KIND, id, resolved });
    return { ...target, resolved };
}

/** Explicit multi-resolve for deferred-open entries sharing a signature (never the default path). */
export function resolveAllWithSignature(cwd: string, branch: string, signature: string, how: ResolvedHow, at: string = new Date().toISOString()): LedgerEntry[] {
    if (typeof signature !== 'string' || signature.length === 0) {
        throw new Error('resolve --all-with-signature requires a non-empty signature');
    }
    const open = listDeferredOpen(cwd, branch).filter(e => e.signature === signature);
    if (open.length === 0) {
        throw new Error(`no deferred-open ledger entries found for signature "${signature}"`);
    }
    const resolvedAt = { at, how };
    const updated: LedgerEntry[] = [];
    for (const entry of open) {
        if (typeof entry.id !== 'string' || entry.id.length === 0) {
            throw new Error(`deferred entry with signature "${signature}" is missing a stable id`);
        }
        appendResolveRecord(cwd, branch, { kind: LEDGER_RESOLVE_KIND, id: entry.id, resolved: resolvedAt });
        updated.push({ ...entry, resolved: resolvedAt });
    }
    return updated;
}

export type { RecurringCluster, ClusterKind } from './cluster';

export function recurring(cwd: string, branch: string, min: number): RecurringCluster[] {
    return clusterEntries(listEntries(cwd, branch), min);
}

export function archiveLedger(cwd: string, branch: string, label: string): boolean {
    const safeLabel = archiveLabel(label);
    const src = ledgerPath(cwd, branch);
    if (!sourceExists(src)) return false;
    const safe = ledgerFilename(branch);
    const projectRoot = fs.realpathSync(cwd);
    const ledgerRoot = path.join(projectRoot, LEDGER_DIR);
    const safeLedgerRoot = assertSafeDirectory(ledgerRoot, projectRoot, 'root');
    assertSafeLedgerSource(src, safeLedgerRoot);
    const archiveRoot = path.join(ledgerRoot, 'archive');
    if (!sourceExists(archiveRoot)) fs.mkdirSync(archiveRoot);
    const safeArchiveRoot = assertSafeDirectory(archiveRoot, safeLedgerRoot, 'archive');
    const dst = path.join(safeArchiveRoot, `${safe}-${safeLabel}.jsonl`);
    if (destinationExists(dst)) throw new Error(`ledger archive already exists: ${dst}`);
    fs.renameSync(src, dst);
    return true;
}
