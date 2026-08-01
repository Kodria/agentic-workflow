import fs from 'fs';
import path from 'path';

export function branchSlug(branch: string): string {
    if (!branch || branch === '.' || branch.includes('..')) {
        throw new Error(`branch inválida para slug: ${JSON.stringify(branch)}`);
    }
    return branch.replace(/[/\\]/g, '__');
}

export function journalDir(repoRoot: string, branch: string): string {
    return path.join(repoRoot, '.awm', 'journal', branchSlug(branch));
}

/** Lock único por worktree FÍSICO: clavado por realpath, fuera del dir de rama
 *  (design R1.1, bloqueante v5-5: dos ramas jamás toman locks distintos sobre
 *  el mismo árbol). */
export function supervisorLockPath(repoRoot: string): string {
    return path.join(fs.realpathSync(repoRoot), '.awm', 'journal', 'supervisor.lock');
}

export function statePath(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'state.json');
}
export function requestsDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'requests');
}
export function acksDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'acks');
}
export function logsDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'logs');
}
export function eventsPath(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'events.jsonl');
}
export function exportDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'export');
}
