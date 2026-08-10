import fs from 'fs';
import path from 'path';

export function branchSlug(branch: string): string {
    if (!branch || branch === '.' || branch.includes('..')) {
        throw new Error(`branch inválida para slug: ${JSON.stringify(branch)}`);
    }
    // Escapa PRIMERO el propio caracter de escape (_), despues / y \ — así
    // ningún guion bajo literal sobrevive sin escapar, lo que hace la
    // codificación biyectiva: dos ramas distintas nunca pueden colisionar
    // (bloqueador encontrado en code-quality review de Task 3).
    return branch
        .replace(/_/g, '_5F')
        .replace(/\//g, '_2F')
        .replace(/\\/g, '_5C');
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

/** Lock de integración (R5.8/R5.9/C7, Task 10): único por PLAN físico, fuera
 *  de cualquier dir de rama — mismo criterio de `supervisorLockPath` (clavado
 *  por realpath). Se adquiere ANTES del primer join de una cohorte y retiene
 *  ownership mientras la generación del plan está pausada y ningún controller
 *  administrado corre. */
export function integrationLockPath(repoRoot: string): string {
    return path.join(fs.realpathSync(repoRoot), '.awm', 'journal', 'integration.lock');
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
