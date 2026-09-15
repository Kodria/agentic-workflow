import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { EXEC_STDIO } from './process';
import type { JournalState, PlanBinding } from './types';

function sha(parts: string[]): string {
    return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}
// Sin ceiling de maxBuffer: repos grandes (`ls-files` / `ls-files --stage` en
// miles de archivos) pueden superar el default de Node (1MB) y abortar con ENOBUFS.
// stdio explicito (ver EXEC_STDIO en process.ts): sin esto, execFileSync relayea
// el stderr de git hacia el stderr DEL SUPERVISOR — si ese fd es un pipe roto, el
// relay dispara un EPIPE no catcheable que crashea el proceso ENTERO (este helper
// backea computeFingerprint, invocado en CADA tick via FingerprintNow/computeGate).
function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: Infinity, stdio: EXEC_STDIO });
}

export interface FingerprintResult {
    fingerprint: string;
    commandDigest: string;
    expandedPaths: string[];
}

/** Read-only, deterministic recovery classification for an unattended cycle.
 * Observers provide bounded status facts; this reducer never reads prompts or
 * source bodies and never creates a duplicate durable obligation. */
export type UnattendedRecoveryInput = Readonly<{
    journal: JournalState | null;
    journalCorrupt: boolean;
    plan: PlanBinding;
    git: 'current' | 'changed';
    activeJobIds: readonly string[];
    tests: 'pass' | 'fail' | 'missing';
    sensors: 'pass' | 'fail' | 'missing';
    verdicts: 'current' | 'stale' | 'missing';
}>;
export type UnattendedRecoveryResult = Readonly<{
    state: 'ready' | 'blocked';
    nextAction: 'reconcile-active-jobs' | 'repair-journal' | 'rebind-plan' | 'reconcile-git' | 'run-tests' | 'run-sensors' | 'repair-verdicts' | 'select-work';
    activeJobIds: string[];
    diagnostics: string[];
}>;

export function reconcileUnattendedRecovery(input: UnattendedRecoveryInput): UnattendedRecoveryResult {
    const activeJobIds = [...new Set(input.activeJobIds)].sort();
    const result = (state: UnattendedRecoveryResult['state'], nextAction: UnattendedRecoveryResult['nextAction'], diagnostics: string[]): UnattendedRecoveryResult => ({ state, nextAction, activeJobIds, diagnostics });
    if (input.journalCorrupt || input.journal === null) return result('blocked', 'repair-journal', ['journal-corrupt-or-missing']);
    const binding = input.journal.schema === 2 ? input.journal.planBinding : undefined;
    if (!binding || binding.path !== input.plan.path || binding.digest !== input.plan.digest || binding.schema !== input.plan.schema || binding.executionMode !== 'desatendido') return result('blocked', 'rebind-plan', ['journal-plan-binding-stale']);
    if (input.git !== 'current') return result('blocked', 'reconcile-git', ['git-fingerprint-changed']);
    if (input.verdicts !== 'current') return result('blocked', 'repair-verdicts', [`verdicts-${input.verdicts}`]);
    if (activeJobIds.length > 0) return result('ready', 'reconcile-active-jobs', []);
    if (input.tests !== 'pass') return result('blocked', 'run-tests', [`tests-${input.tests}`]);
    if (input.sensors !== 'pass') return result('blocked', 'run-sensors', [`sensors-${input.sensors}`]);
    return result('ready', 'select-work', []);
}

export function resolveWorkingDirectory(repoRoot: string, cwdRel: string): { relative: string; absolute: string } {
    if (typeof cwdRel !== 'string' || cwdRel.length === 0) throw new Error('cwd relativo requerido');
    const relative = path.normalize(cwdRel);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`cwd fuera del repo: ${JSON.stringify(cwdRel)}`);
    }
    const root = fs.realpathSync(repoRoot);
    let cursor = root;
    for (const segment of relative.split(path.sep).filter((part) => part !== '.')) {
        cursor = path.join(cursor, segment);
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink()) throw new Error(`cwd contiene symlink no permitido: ${JSON.stringify(cwdRel)}`);
    }
    const absolute = fs.realpathSync(path.join(root, relative));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`cwd fuera del repo: ${JSON.stringify(cwdRel)}`);
    if (!fs.statSync(absolute).isDirectory()) throw new Error(`cwd no es directorio: ${JSON.stringify(cwdRel)}`);
    return { relative: relative.split(path.sep).join('/'), absolute };
}

/** El journal jamás invalida evidencia: .awm/ queda fuera de toda expansión. */
const EXCLUDE_JOURNAL = ':(exclude).awm';

/** Componentes SEPARADOS (design R3.4, bloqueador 7 de la review):
 *  argv exacto + cwd relativo REAL + HEAD + índice real (`ls-files --stage`
 *  hasheado) + digest de contenido por archivo tracked/untracked/deleted. */
export function computeFingerprint(repoRoot: string, argv: string[], pathGlobs: string[], cwdRel: string): FingerprintResult {
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv vacio');
    const cwdNorm = resolveWorkingDirectory(repoRoot, cwdRel).relative;
    const commandDigest = sha(argv);
    const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const pathspecs = pathGlobs.length > 0 ? pathGlobs : ['.'];
    // Índice REAL: modos + blobs + stages + paths — un cambio staged-only con
    // worktree idéntico produce salida distinta aquí. Sin -z a propósito: esta
    // salida se hashea completa como texto opaco, nunca se separa en paths
    // individuales, así que el quoting de core.quotePath es inofensivo aquí
    // (a diferencia de expandedPaths abajo, cuyos paths SÍ se re-extraen para
    // pasarlos a `hash-object` — por eso ese caso sí necesita -z).
    const indexRaw = git(repoRoot, ['ls-files', '--stage', '--', ...pathspecs, EXCLUDE_JOURNAL]);
    const indexDigest = sha([indexRaw]);
    const expandedPaths = git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs, EXCLUDE_JOURNAL])
        .split('\0').filter(Boolean).sort();
    const perFile = expandedPaths.map((p) => {
        try {
            return `${p}:${git(repoRoot, ['hash-object', '--', p]).trim()}`;
        } catch {
            return `${p}:deleted`;   // listado pero ilegible/borrado del worktree: cuenta como cambio
        }
    });
    const declaredPaths = pathGlobs.length > 0 ? pathGlobs : ['.'];
    const fingerprint = sha([commandDigest, `cwd:${cwdNorm}`, `paths:${JSON.stringify(declaredPaths)}`, `head:${head}`, `index:${indexDigest}`, ...perFile]);
    return { fingerprint, commandDigest, expandedPaths };
}
