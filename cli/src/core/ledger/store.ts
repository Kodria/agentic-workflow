import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseLedgerEntry } from './types';
import type { LedgerEntry } from './types';
import { clusterEntries } from './cluster';
import type { RecurringCluster } from './cluster';

const LEDGER_DIR = path.join('.awm', 'ledger');

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
    const parsed = parseLedgerEntry(entry, 'ledger entry');
    if (!parsed.ok) throw new Error(`invalid ledger entry: ${parsed.reason}`);
    const p = ledgerPath(cwd, entry.branch);
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
