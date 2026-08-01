import crypto from 'crypto';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import type { ProcessRef } from './types';

export const NONCE_ENV = 'AWM_SPAWN_NONCE';

/** Contrato dual, a proposito (tomo 3 rondas de fixes reales llegar aca —
 *  ver historial de Task 10): devuelve `null` SOLO cuando `ps` corrio y
 *  confirmo positivamente que el pid no existe (exit status 1). Cualquier
 *  otro fallo (ENOENT del binario, permisos, error transitorio) se
 *  RELANZA — nunca se traduce a `null`, porque un `null` aca significaria
 *  "muerte confirmada" para cualquier caller que no distinga los casos.
 *  Hay DOS formas correctas de consumir esto, segun el contexto:
 *  - Declaracion de muerte (`refIsAlive`, `activitySnapshot`): el caller
 *    DEBE envolver en su propio try/catch y fallar A FAVOR de "vivo" —
 *    nunca asumir muerto por un throw. El silencio jamas es prueba.
 *  - Captura de identidad en spawn (`captureRefFor`, `stablePsArgs`): usar
 *    `psFieldSafe` en vez de esta funcion — ahi "no se pudo determinar" ya
 *    tiene un fallback seguro documentado ('unknown'), sin riesgo de
 *    declarar muerte por error. */
function psField(pid: number, field: string): string | null {
    try {
        const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
        return out.length > 0 ? out : null;
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        if (status === 1) return null;   // ps corrio y confirmo: el pid no existe
        throw error;   // ps no pudo ejecutarse (ENOENT/permisos/etc): NO es prueba de nada
    }
}

function sleepSync(seconds: string): void {
    try { execFileSync('sleep', [seconds]); } catch { /* sin sleep: seguimos */ }
}

/** Variante de psField para contextos de CAPTURA de identidad (spawn time):
 *  aqui "no se pudo determinar" ya tiene un fallback seguro documentado
 *  ('unknown') — no es un contexto de declaracion de muerte, asi que
 *  cualquier fallo de ps se traga, igual que siempre. */
function psFieldSafe(pid: number, field: string): string | null {
    try { return psField(pid, field); } catch { return null; }
}

/** ps args estable: dos lecturas consecutivas iguales (evita capturar el
 *  estado pre-exec del fork). null si el proceso ya no existe O si ps
 *  fallo en ejecutarse (via psFieldSafe) — ambos casos son "no se pudo
 *  determinar" aca, sin riesgo: este es un contexto de captura, no de
 *  declaracion de muerte. */
function stablePsArgs(pid: number): string | null {
    for (let i = 0; i < 5; i++) {
        const a = psFieldSafe(pid, 'args');
        if (a === null) return null;
        sleepSync('0.05');
        const b = psFieldSafe(pid, 'args');
        if (b === a) return a;
    }
    return psFieldSafe(pid, 'args');
}

export function argvDigest(argv: string[]): string {
    return crypto.createHash('sha256').update(argv.join('\0')).digest('hex').slice(0, 16);
}

/** EXPORTADA pero hereda el contrato crudo de psField (throws si ps falla
 *  en ejecutarse, mas alla de "pid no existe"). Hoy el unico caller es
 *  refIsAlive, que ya envuelve en su propio try/catch fail-safe — cualquier
 *  caller NUEVO que la use standalone debe hacer lo mismo (ver comentario
 *  de psField) o usar psFieldSafe si esta en un contexto de captura. */
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
        start = psFieldSafe(pid, 'lstart');
        if (start === null) sleepSync('0.05');
    }
    const pgid = psFieldSafe(pid, 'pgid');
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
        // stdio:'ignore' completo (nada de pipes): un pipe destruido/abandonado
        // por el padre puede EPIPE-crashear al hijo si este escribe a su propio
        // stdout/stderr despues (ver defaultWrapperSpawner) — el hijo maneja su
        // stdio propio, el padre no necesita capturarlo.
        stdio: 'ignore',
    });
    if (child.pid === undefined) throw new Error(`spawn fallo para ${exe}`);
    return { child, ref: captureRefFor(child.pid, nonce, argv) };
}

/** Vivo Y con la MISMA identidad — tupla completa, nunca PID solo (R2.1,
 *  bloqueador 6): startTime + pgid + digest de ps args. */
export function refIsAlive(ref: ProcessRef): boolean {
    try {
        const start = psField(ref.pid, 'lstart');
        if (start === null || start !== ref.startTime) return false;
        const pgid = psField(ref.pid, 'pgid');
        if (pgid === null || Number(pgid) !== ref.processGroup) return false;
        const argsDig = psArgsDigestOf(ref.pid);
        if (argsDig === null || argsDig !== ref.psArgsDigest) return false;
        return true;
    } catch {
        // ps no pudo ejecutarse: sin evidencia, jamas declarar muerte — se
        // trata como vivo (R2.1, bloqueador de Task 10: silencio no es prueba).
        return true;
    }
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
    let cpu = '0';
    try { cpu = psField(ref.pid, 'time') ?? '0'; } catch { cpu = '0'; }
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
