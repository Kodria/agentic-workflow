import crypto from 'crypto';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import type { ProcessRef } from './types';

export const NONCE_ENV = 'AWM_SPAWN_NONCE';

function psField(pid: number, field: string): string | null {
    try {
        const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
        return out.length > 0 ? out : null;
    } catch { return null; }
}

function sleepSync(seconds: string): void {
    try { execFileSync('sleep', [seconds]); } catch { /* sin sleep: seguimos */ }
}

/** ps args estable: dos lecturas consecutivas iguales (evita capturar el
 *  estado pre-exec del fork). null si el proceso ya no existe. */
function stablePsArgs(pid: number): string | null {
    for (let i = 0; i < 5; i++) {
        const a = psField(pid, 'args');
        if (a === null) return null;
        sleepSync('0.05');
        const b = psField(pid, 'args');
        if (b === a) return a;
    }
    return psField(pid, 'args');
}

export function argvDigest(argv: string[]): string {
    return crypto.createHash('sha256').update(argv.join('\0')).digest('hex').slice(0, 16);
}

export function psArgsDigestOf(pid: number): string | null {
    const args = psField(pid, 'args');
    if (args === null) return null;
    return crypto.createHash('sha256').update(args).digest('hex').slice(0, 16);
}

/** Captura la identidad COMPLETA de un pid recien spawneado (R2.1):
 *  startTime + pgid reales de ps + digest de `ps -o args=` estable. */
export function captureRefFor(pid: number, nonce: string, argv: string[]): ProcessRef {
    let start: string | null = null;
    for (let i = 0; i < 5 && start === null; i++) {
        start = psField(pid, 'lstart');
        if (start === null) sleepSync('0.05');
    }
    const pgid = psField(pid, 'pgid');
    const args = stablePsArgs(pid);
    return {
        pid,
        startTime: start ?? 'unknown',
        spawnNonce: nonce,
        argvDigest: argvDigest(argv),
        processGroup: pgid !== null ? Number(pgid) : pid,
        psArgsDigest: args !== null ? crypto.createHash('sha256').update(args).digest('hex').slice(0, 16) : 'unknown',
    };
}

/** Identidad del proceso ACTUAL (la usa el wrapper externo y el lock). */
export function captureSelfRef(nonce: string): ProcessRef {
    return captureRefFor(process.pid, nonce, process.argv);
}

/** Ejecucion segura (design R4.7): executable+argv como array, shell:false,
 *  nonce por entorno (referencia, no valor persistido), grupo propio (detached). */
export function spawnStructured(argv: string[], cwd: string, nonce: string, extraEnv: Record<string, string> = {}): { child: ChildProcess; ref: ProcessRef } {
    const [exe, ...args] = argv;
    const child = spawn(exe, args, {
        cwd, shell: false, detached: true,
        env: { ...process.env, [NONCE_ENV]: nonce, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid === undefined) throw new Error(`spawn fallo para ${exe}`);
    return { child, ref: captureRefFor(child.pid, nonce, argv) };
}

/** Vivo Y con la MISMA identidad — tupla completa, nunca PID solo (R2.1,
 *  bloqueador 6): startTime + pgid + digest de ps args. */
export function refIsAlive(ref: ProcessRef): boolean {
    const start = psField(ref.pid, 'lstart');
    if (start === null || start !== ref.startTime) return false;
    const pgid = psField(ref.pid, 'pgid');
    if (pgid === null || Number(pgid) !== ref.processGroup) return false;
    const argsDig = psArgsDigestOf(ref.pid);
    if (argsDig === null || argsDig !== ref.psArgsDigest) return false;
    return true;
}

/** true <=> pgrep -g no encuentra NINGUN proceso en el grupo. Un fallo de
 *  pgrep distinto de "sin matches" devuelve false: sin confirmacion no hay
 *  muerte declarada (R2.1). */
export function groupIsGone(pgid: number): boolean {
    try {
        const out = execFileSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8' });
        return out.trim().length === 0;
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        return status === 1;   // pgrep exit 1 = cero matches; cualquier otra cosa NO confirma
    }
}

export interface ActivitySnapshot { cpuTime: string; groupSize: number; }
export function activitySnapshot(ref: ProcessRef): ActivitySnapshot | null {
    if (!refIsAlive(ref)) return null;
    const cpu = psField(ref.pid, 'time') ?? '0';
    let groupSize = 1;
    try {
        groupSize = execFileSync('pgrep', ['-g', String(ref.processGroup)], { encoding: 'utf8' })
            .split('\n').filter(Boolean).length;
    } catch { groupSize = 1; }
    return { cpuTime: cpu, groupSize };
}

/** Escalera de gracia (design R4.2b): SIGTERM -> confirmar -> SIGKILL -> confirmar.
 *  true <=> lider muerto por identidad Y grupo entero desaparecido (pgrep -g
 *  vacio) — jamas confirmar solo el lider (bloqueador 6). */
export async function terminateGroupConfirmed(ref: ProcessRef, opts: { termGraceMs: number; killGraceMs: number }): Promise<boolean> {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const confirmed = () => !refIsAlive(ref) && groupIsGone(ref.processGroup);
    if (confirmed()) return true;
    try { process.kill(-ref.processGroup, 'SIGTERM'); } catch { /* grupo ya ausente */ }
    await wait(opts.termGraceMs);
    if (confirmed()) return true;
    try { process.kill(-ref.processGroup, 'SIGKILL'); } catch { /* idem */ }
    await wait(opts.killGraceMs);
    return confirmed();
}
