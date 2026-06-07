import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { LedgerEntry } from './types';

const LEDGER_DIR = path.join('.awm', 'ledger');

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
    const safe = branch.replace(/\//g, '__');
    return path.join(cwd, LEDGER_DIR, `${safe}.jsonl`);
}

export function addEntry(cwd: string, entry: LedgerEntry): void {
    const p = ledgerPath(cwd, entry.branch);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
}

export function listEntries(cwd: string, branch: string): LedgerEntry[] {
    const p = ledgerPath(cwd, branch);
    if (!fs.existsSync(p)) return [];
    const out: LedgerEntry[] = [];
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { out.push(JSON.parse(trimmed) as LedgerEntry); }
        catch { /* skip malformed line */ }
    }
    return out;
}
