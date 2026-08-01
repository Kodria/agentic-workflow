// Exclusion fisica de supervisores (R4.1): un solo writer por worktree FISICO.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { supervisorLockPath } from '../../core/journal/paths';
import { captureSelfRef, refIsAlive } from '../../core/journal/process';
import { isWellFormedProcessRef, ProcessRef } from '../../core/journal/types';
import { fsyncDirSync } from '../../core/atomic-file';

/** Identidad indemostrable en el lock: BLOQUEAR con error DISTINTO — el
 *  operador decide con evidencia; el codigo jamas reclama lo que no puede
 *  probar muerto (bloqueador 6 de la review). */
export class LockBlockedError extends Error {
    constructor(message: string) { super(message); this.name = 'LockBlockedError'; }
}

export interface LockHandle { ref: ProcessRef; path: string; }

export function acquireLock(repoRoot: string): LockHandle {
    const lp = supervisorLockPath(repoRoot);
    fs.mkdirSync(path.dirname(lp), { recursive: true, mode: 0o700 });
    const self = captureSelfRef(crypto.randomBytes(8).toString('hex'));
    const body = JSON.stringify(self, null, 2) + '\n';
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lp, 'wx', 0o600);   // creacion EXCLUSIVA real: sin ventana existsSync/write
            try {
                fs.writeFileSync(fd, body);
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            fsyncDirSync(path.dirname(lp));
            return { ref: self, path: lp };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        // EEXIST: leer + validar identidad COMPLETA
        let prior: unknown;
        try {
            prior = JSON.parse(fs.readFileSync(lp, 'utf8'));
        } catch {
            throw new LockBlockedError(`lock ilegible en ${lp}: identidad indemostrable — BLOQUEADO (no se reclama; intervencion manual con evidencia)`);
        }
        if (!isWellFormedProcessRef(prior)) {
            throw new LockBlockedError(`lock con shape invalido en ${lp}: identidad indemostrable — BLOQUEADO (no se reclama)`);
        }
        if (refIsAlive(prior)) {
            throw new Error(`supervisor activo (pid ${prior.pid}) sobre este worktree`);
        }
        // Muerto PROBADO (la tupla completa no matchea a ningun proceso vivo):
        // rm + reintento wx UNA sola vez — si la carrera persiste, error.
        process.stderr.write('awm watch: lock previo con identidad muerta probada — reclamando\n');
        fs.rmSync(lp, { force: true });
    }
    throw new Error('no se pudo adquirir el lock tras reintento unico (carrera persistente)');
}

export function releaseLock(repoRoot: string, handle: LockHandle): void {
    const lp = supervisorLockPath(repoRoot);
    try {
        const onDisk = JSON.parse(fs.readFileSync(lp, 'utf8')) as ProcessRef;
        if (onDisk.spawnNonce === handle.ref.spawnNonce) fs.rmSync(lp);
    } catch { /* ya ausente o ilegible: no tocar lo que no es nuestro */ }
}

/** WHILE el supervisor este activo, el cambio de rama del worktree se bloquea:
 *  gate/reconcile/watch verifican rama actual == rama del journal (R1.1). */
export function verifyBranchInvariant(repoRoot: string, journalBranch: string): void {
    const current = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (current !== journalBranch) {
        throw new Error(`BLOCKED: rama actual (${current}) != rama del journal (${journalBranch}) — cambio de rama con journal activo (R1.1)`);
    }
}
