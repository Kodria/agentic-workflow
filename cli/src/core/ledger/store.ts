import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseLedgerEntry } from './types';
import type { LedgerEntry } from './types';
import { clusterEntries } from './cluster';
import type { RecurringCluster } from './cluster';

const LEDGER_DIR = path.join('.awm', 'ledger');

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
    if (!fs.existsSync(src)) return false;
    const safe = ledgerFilename(branch);
    const dst = path.join(cwd, LEDGER_DIR, 'archive', `${safe}-${safeLabel}.jsonl`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst)) throw new Error(`ledger archive already exists: ${dst}`);
    fs.renameSync(src, dst);
    return true;
}
