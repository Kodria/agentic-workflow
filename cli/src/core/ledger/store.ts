import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { parseLedgerEntry } from './types';
import type { LedgerEntry, ResolvedHow } from './types';
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

export function listEntries(cwd: string, branch: string): LedgerEntry[] {
    const p = ledgerPath(cwd, branch);
    if (!fs.existsSync(p)) return [];
    const out: LedgerEntry[] = [];
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = parseLedgerEntry(JSON.parse(trimmed) as unknown, p);
            if (parsed.ok) out.push(parsed.entry);
        } catch { /* skip malformed line */ }
    }
    return out;
}

/** Deferred && !resolved — mechanical QA open set (RF-4.7). */
export function listDeferredOpen(cwd: string, branch: string): LedgerEntry[] {
    return listEntries(cwd, branch).filter(e => e.deferred !== undefined && e.resolved === undefined);
}

function rewriteEntries(cwd: string, branch: string, next: LedgerEntry[]): void {
    const p = ledgerPath(cwd, branch);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const body = next.map(e => {
        const parsed = parseLedgerEntry(e, 'ledger entry');
        if (!parsed.ok) throw new Error(`invalid ledger entry: ${parsed.reason}`);
        return JSON.stringify(parsed.entry);
    }).join('\n') + (next.length > 0 ? '\n' : '');
    const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, body, 'utf-8');
    fs.renameSync(tmp, p);
}

export function resolveById(cwd: string, branch: string, id: string, how: ResolvedHow, at: string = new Date().toISOString()): LedgerEntry {
    if (typeof id !== 'string' || id.length === 0) throw new Error('resolve requires a non-empty --id');
    const entries = listEntries(cwd, branch);
    const index = entries.findIndex(e => e.id === id);
    if (index < 0) throw new Error(`ledger entry not found for id "${id}"`);
    const target = entries[index];
    if (target.resolved !== undefined) throw new Error(`ledger entry "${id}" is already resolved`);
    if (target.deferred === undefined) throw new Error(`ledger entry "${id}" is not deferred`);
    const updated: LedgerEntry = { ...target, resolved: { at, how } };
    const next = entries.slice();
    next[index] = updated;
    rewriteEntries(cwd, branch, next);
    return updated;
}

/** Explicit multi-resolve for deferred-open entries sharing a signature (never the default path). */
export function resolveAllWithSignature(cwd: string, branch: string, signature: string, how: ResolvedHow, at: string = new Date().toISOString()): LedgerEntry[] {
    if (typeof signature !== 'string' || signature.length === 0) {
        throw new Error('resolve --all-with-signature requires a non-empty signature');
    }
    const entries = listEntries(cwd, branch);
    const resolved: LedgerEntry[] = [];
    const next = entries.map(entry => {
        if (entry.signature !== signature || entry.deferred === undefined || entry.resolved !== undefined) {
            return entry;
        }
        if (typeof entry.id !== 'string' || entry.id.length === 0) {
            throw new Error(`deferred entry with signature "${signature}" is missing a stable id`);
        }
        const updated: LedgerEntry = { ...entry, resolved: { at, how } };
        resolved.push(updated);
        return updated;
    });
    if (resolved.length === 0) {
        throw new Error(`no deferred-open ledger entries found for signature "${signature}"`);
    }
    rewriteEntries(cwd, branch, next);
    return resolved;
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
