import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { EXEC_STDIO } from '../journal/process';
import type { TrackRef } from '../journal/types';

const git = (repo: string, args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: EXEC_STDIO });

/** R4.1/C2: `.awm` debe estar demostrablemente ignorado o el journal del
 *  track podría terminar versionado. `git check-ignore` es una operación de
 *  working-tree/index — responde por el árbol REALMENTE checkeado en `dir`,
 *  nunca por un commit arbitrario. Por eso el caller (`defaultTrackRuntime`)
 *  DEBE pasar el path del worktree ya creado (checkeado en `baseSha`), no el
 *  repo del plan en su HEAD vivo: ese HEAD puede estar en un commit distinto
 *  de `baseSha` y dar una respuesta stale (post-review: bug crítico
 *  encontrado en la primera versión de esta función). `exit 0` = ignorado;
 *  `exit 1` = no ignorado; cualquier otro fallo tampoco prueba nada — todo lo
 *  que no sea éxito confirmado se trata como "no ignorado" (fail-closed). */
export function isAwmGitignored(dir: string): boolean {
    try {
        git(dir, ['check-ignore', '-q', '.awm/probe']);
        return true;
    } catch {
        return false;
    }
}

export function headSha(repo: string): string {
    return git(repo, ['rev-parse', 'HEAD']).trim();
}

/** R4.6: nada se considera "nuestro" antes de que lo hayamos creado — si el
 *  destino ya existe y no está vacío, es por definición ajeno (todavía no
 *  intentamos crear nada ahí). Devuelve `true` también si no se puede
 *  *probar* que está vacío (fail-closed: silencio nunca es prueba de nada). */
export function foreignPathExists(target: string): boolean {
    try {
        return fs.existsSync(target) && fs.readdirSync(target).length > 0;
    } catch {
        return true;
    }
}

export function gitCheckTrackId(id: string): boolean {
    if (!id || id === '.' || id === '..' || id.startsWith('-') || id.includes('/') || id.includes('\\')) return false;
    try { git(process.cwd(), ['check-ref-format', '--branch', id]); return true; }
    catch { return false; }
}

export function mergeBase(repo: string, left: string, right: string): string {
    return git(repo, ['merge-base', left, right]).trim();
}

export interface ChangedPath { status: string; path: string; oldPath?: string }

/** R4.1/R4.6: crea el worktree del track SOLO si el destino está
 *  demostrablemente vacío. El caller (`tracks.ts`) es responsable de haber
 *  verificado `foreignPathExists`/`isAwmGitignored` ANTES de llamar esto —
 *  esta función es la única frontera que efectivamente ejecuta `git worktree
 *  add`, y nunca adopta ni sobreescribe contenido preexistente. */
export function addOwnedWorktree(repo: string, ref: TrackRef, baseSha: string): void {
    const parent = path.dirname(ref.worktreePath);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(ref.worktreePath) && fs.readdirSync(ref.worktreePath).length > 0) {
        throw new Error(`destino no vacío: ${ref.worktreePath}`);
    }
    git(repo, ['worktree', 'add', '-b', ref.branch, ref.worktreePath, baseSha]);
}

/** El worktree es NUESTRO (lo acabamos de crear en esta misma llamada) — esto
 *  jamás borra algo ajeno (R4.6): es deshacer un intento propio que no pasó
 *  una validación posterior (ej. C2, `.awm` no ignorado en `baseSha`). */
export function removeOwnedWorktree(repo: string, worktreePath: string): void {
    git(repo, ['worktree', 'remove', '--force', worktreePath]);
}

export function changedPaths(repo: string, base: string, head: string): ChangedPath[] {
    const fields = git(repo, ['diff', '--name-status', '-z', '--find-renames', base, head]).split('\0');
    const out: ChangedPath[] = [];
    for (let i = 0; i < fields.length && fields[i] !== '';) {
        const status = fields[i++];
        if (status.startsWith('R') || status.startsWith('C')) {
            out.push({ status, oldPath: fields[i++], path: fields[i++] });
        } else {
            out.push({ status, path: fields[i++] });
        }
    }
    return out;
}
