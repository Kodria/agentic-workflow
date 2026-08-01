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
/** stdio explicito en TODOS los execFileSync de este archivo (ver EXEC_STDIO):
 *  sin esto, `execFileSync` por defecto hace `inheritStderr` — relayea el
 *  stderr del subproceso hacia el stderr DEL PROCESO LLAMANTE. Si ese stderr
 *  llegara a ser un pipe roto/destruido (ej. wrapper detached, ver
 *  spawnStructured), el relay mismo dispara el EPIPE que crashea al
 *  llamante — el mismo bug de raiz, reintroducido via esta funcion en vez
 *  de via el spawn del hijo. Con stdio explicito ('pipe' para stdout/stderr)
 *  ese relay jamas ocurre: `execFileSync` captura el stderr del subproceso
 *  internamente y listo, sin tocar el fd real del proceso actual. */
export const EXEC_STDIO: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];

function psField(pid: number, field: string): string | null {
    try {
        const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8', stdio: EXEC_STDIO }).trim();
        return out.length > 0 ? out : null;
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        if (status === 1) return null;   // ps corrio y confirmo: el pid no existe
        throw error;   // ps no pudo ejecutarse (ENOENT/permisos/etc): NO es prueba de nada
    }
}

function sleepSync(seconds: string): void {
    try { execFileSync('sleep', [seconds], { stdio: EXEC_STDIO }); } catch { /* sin sleep: seguimos */ }
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
function identityDigest(psArgs: string, spawnNonce: string, requestedArgvDigest: string): string {
    return crypto.createHash('sha256').update(`${psArgs}\0${spawnNonce}\0${requestedArgvDigest}`).digest('hex').slice(0, 16);
}

export function psArgsDigestOf(pid: number, spawnNonce = '', requestedArgvDigest = ''): string | null {
    const args = psField(pid, 'args');
    if (args === null) return null;
    return identityDigest(args, spawnNonce, requestedArgvDigest);
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
    const requestedArgvDigest = argvDigest(argv);
    return {
        pid,
        startTime: start ?? 'unknown',
        spawnNonce: nonce,
        argvDigest: requestedArgvDigest,
        processGroup: pgid !== null ? Number(pgid) : pid,
        // Liga nonce + argv solicitado con la observacion real de ps. Alterar
        // cualquier miembro de la tupla invalida la identidad completa.
        psArgsDigest: args !== null ? identityDigest(args, nonce, requestedArgvDigest) : 'unknown',
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
        const stat = psField(ref.pid, 'stat');
        if (stat === null || stat.startsWith('Z')) return false; // zombie = proceso terminado, solo espera reap
        const start = psField(ref.pid, 'lstart');
        if (start === null || start !== ref.startTime) return false;
        const pgid = psField(ref.pid, 'pgid');
        if (pgid === null || Number(pgid) !== ref.processGroup) return false;
        const argsDig = psArgsDigestOf(ref.pid, ref.spawnNonce, ref.argvDigest);
        if (argsDig === null || argsDig !== ref.psArgsDigest) return false;
        return true;
    } catch {
        // ps no pudo ejecutarse: sin evidencia, jamas declarar muerte — se
        // trata como vivo (R2.1, bloqueador de Task 10: silencio no es prueba).
        return true;
    }
}

/** true <=> pgrep no encuentra miembros ejecutables en el grupo. Los zombies
 *  ya terminaron y solo esperan reap; no pueden responder seniales ni retener
 *  trabajo. Un fallo de observacion devuelve false (R2.1). */
export function processStatesAreGone(states: Array<string | null>): boolean {
    return states.every((stat) => stat === null || stat.startsWith('Z'));
}

export function groupIsGone(pgid: number): boolean {
    let pids: number[];
    try {
        const out = execFileSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8', stdio: EXEC_STDIO });
        pids = out.split('\n').filter(Boolean).map(Number).filter(Number.isInteger);
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        return status === 1;   // pgrep exit 1 = cero matches; cualquier otra cosa NO confirma
    }
    if (pids.length === 0) return true;
    try {
        // `pgrep` tambien devuelve zombies. No pueden ejecutar, mantener FDs ni
        // responder seniales; contarlos como vivos fuerza esperas completas y
        // custodia falsa hasta que el parent haga reap. Solo un miembro no-zombie
        // conserva ownership ejecutable del grupo.
        return processStatesAreGone(pids.map((pid) => psField(pid, 'stat')));
    } catch {
        return false; // sin observacion completa, falla cerrado
    }
}

export interface ActivitySnapshot { cpuTime: string; groupSize: number; }
export function activitySnapshot(ref: ProcessRef): ActivitySnapshot | null {
    if (!refIsAlive(ref)) return null;
    let cpu = '0';
    try { cpu = psField(ref.pid, 'time') ?? '0'; } catch { cpu = '0'; }
    let groupSize = 1;
    try {
        groupSize = execFileSync('pgrep', ['-g', String(ref.processGroup)], { encoding: 'utf8', stdio: EXEC_STDIO })
            .split('\n').filter(Boolean).length;
    } catch { groupSize = 1; }
    return { cpuTime: cpu, groupSize };
}

/** Escalera de gracia (design R4.2b): SIGTERM -> confirmar -> SIGKILL -> confirmar.
 *  true <=> lider muerto por identidad Y grupo entero desaparecido (pgrep -g
 *  vacio) — jamas confirmar solo el lider (bloqueador 6). */
export async function terminateGroupConfirmed(ref: ProcessRef, opts: { termGraceMs: number; killGraceMs: number }): Promise<boolean> {
    const waitUntilGone = async (maxMs: number): Promise<boolean> => {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
            if (groupIsGone(ref.processGroup)) return true;
            await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
        }
        return groupIsGone(ref.processGroup);
    };
    if (groupIsGone(ref.processGroup)) return true;
    // Un PGID ocupado con lider de identidad distinta NO es nuestro. Nunca
    // usar la falta de match como autorizacion para senializar ese grupo.
    if (!refIsAlive(ref)) return false;
    try { process.kill(-ref.processGroup, 'SIGTERM'); } catch { /* grupo ya ausente */ }
    if (await waitUntilGone(opts.termGraceMs)) return true;
    try { process.kill(-ref.processGroup, 'SIGKILL'); } catch { /* idem */ }
    return waitUntilGone(opts.killGraceMs);
}

/** Drena un grupo cuya propiedad fue capturada por el caller mientras el
 * lider aun estaba vivo. Se usa inmediatamente tras el exit del lider para
 * eliminar descendientes remanentes; el PGID no puede reutilizarse mientras
 * esos miembros sigan presentes. */
export async function terminatePreviouslyOwnedGroup(ref: ProcessRef, opts: { termGraceMs: number; killGraceMs: number }): Promise<boolean> {
    const waitUntilGone = async (maxMs: number): Promise<boolean> => {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
            if (groupIsGone(ref.processGroup)) return true;
            await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
        }
        return groupIsGone(ref.processGroup);
    };
    if (groupIsGone(ref.processGroup)) return true;
    try { process.kill(-ref.processGroup, 'SIGTERM'); } catch { /* ya ausente */ }
    if (await waitUntilGone(opts.termGraceMs)) return true;
    try { process.kill(-ref.processGroup, 'SIGKILL'); } catch { /* ya ausente */ }
    return waitUntilGone(opts.killGraceMs);
}
