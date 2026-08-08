import crypto from 'crypto';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import type { ProcessRef } from './types';
import { isWindowsNative } from '../paths';

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
    // Nota win32: `sleep` no existe nativamente ahi (ver callers via
    // win32ProcessInfo/captureRefFor) — el catch de arriba lo absorbe
    // silenciosamente, asi que en esa plataforma los reintentos que llaman
    // a esta funcion ocurren espalda-con-espalda sin pausa real. No es un
    // fallo: solo pierde el espaciado, nunca crashea ni miente sobre
    // resultado alguno.
}

/** Analogo win32 de `psField`/`stablePsArgs` (R2.1, R6): identidad real de un
 *  pid via WMI (clase Win32_Process), consultada a traves de PowerShell's
 *  Get-CimInstance — el reemplazo moderno soportado de `wmic` (que Microsoft
 *  viene retirando de instalaciones nuevas), y presente en cualquier Windows
 *  no deliberadamente reducido (a diferencia de `ps`/`pgrep`, que en Windows
 *  SOLO existen si algo como Git for Windows los puso en el PATH, y ahi son
 *  la capa emulada de MSYS/Cygwin ciega a procesos nativos — ver
 *  pidExistsNative). Contrato de TRES vias, deliberado, paralelo al de
 *  `psField`:
 *   - `'absent'`: PowerShell corrio bien y WMI no encontro NINGUN proceso
 *     con ese pid — evidencia POSITIVA de ausencia (el analogo exacto del
 *     exit-1 de `ps`/`pgrep` sobre un pid real), independiente de
 *     `process.kill` (que pidExistsNative usa) — asi que sigue siendo
 *     evidencia valida incluso si `process.kill` fuera mockeado/erroneo en
 *     algun caller (visto en CI real: un test que mockea process.kill para
 *     verificar que executeReap NUNCA senializa, sin intencion de simular
 *     un pid vivo — WMI no comparte ese mock y corrige la vista).
 *   - `null`: PowerShell no pudo ejecutarse, timeout, politica de ejecucion
 *     restrictiva, WMI/CIM deshabilitado, salida no parseable, etc. — CERO
 *     evidencia, ni de vida ni de muerte. Igual que el ENOENT de `ps` en
 *     POSIX: nunca se traduce a "muerto".
 *   - objeto con `creationDate`/`commandLine` reales: exito, comparables
 *     con `ref.startTime`/`ref.psArgsDigest` (via identityDigest) igual que
 *     `lstart`/`args` en la rama POSIX.
 *  Acotado con `timeout` (nunca cuelga al caller indefinidamente si el
 *  proveedor WMI no responde) y con `-NoProfile -NonInteractive -NoLogo`
 *  (arranque mas rapido y determinista, sin depender de perfiles del
 *  usuario). Solo se invoca desde refIsAlive/captureRefFor en win32, jamas
 *  desde un path "barato" (groupIsGone, pidExistsNative) — ver refIsAlive
 *  para el razonamiento de costo/beneficio. */
function win32ProcessInfo(pid: number): { creationDate: string; commandLine: string } | 'absent' | null {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    let out: string;
    try {
        const script = `try { $p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop; if ($p) { [PSCustomObject]@{ CreationDate = $p.CreationDate.ToString('o'); CommandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress } } catch { exit 1 }`;
        out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script], { encoding: 'utf8', stdio: EXEC_STDIO, timeout: 2000 }).trim();
    } catch {
        return null;   // powershell/WMI no disponible, timeout, o error interno: sin evidencia (nunca "ausente")
    }
    if (out.length === 0) return 'absent';   // corrio bien, cero coincidencias: evidencia positiva
    try {
        const parsed = JSON.parse(out) as { CreationDate?: unknown; CommandLine?: unknown };
        if (typeof parsed.CreationDate !== 'string' || typeof parsed.CommandLine !== 'string') return null;
        return { creationDate: parsed.CreationDate, commandLine: parsed.CommandLine };
    } catch { return null; }   // salida inesperada: inconclusive, jamas "ausente" por un parseo roto
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
 *  startTime + pgid reales de ps + digest de `ps -o args=` estable.
 *
 *  win32: sin pgid POSIX real jamas (convencion fija: processGroup === pid,
 *  la misma que asume killTreeWindows/groupIsGone); startTime/psArgsDigest
 *  se intentan via WMI (win32ProcessInfo) con el mismo reintento acotado que
 *  la rama POSIX. Si WMI no responde (politica restrictiva, servicio
 *  deshabilitado, sin powershell.exe) degrada al mismo sentinel 'unknown'
 *  ya documentado y testeado (ver 'captureRefFor degrada a unknown...') —
 *  jamas crashea, jamas fabrica una identidad falsa. */
export function captureRefFor(pid: number, nonce: string, argv: string[]): ProcessRef {
    const requestedArgvDigest = argvDigest(argv);
    if (isWindowsNative()) {
        let info: ReturnType<typeof win32ProcessInfo> = null;
        for (let i = 0; i < 5 && (info === null || info === 'absent'); i++) {
            info = win32ProcessInfo(pid);
            if (info === null || info === 'absent') sleepSync('0.05');
        }
        const resolved = info !== null && info !== 'absent' ? info : null;
        return {
            pid,
            startTime: resolved?.creationDate ?? 'unknown',
            spawnNonce: nonce,
            argvDigest: requestedArgvDigest,
            processGroup: pid,
            psArgsDigest: resolved !== null ? identityDigest(resolved.commandLine, nonce, requestedArgvDigest) : 'unknown',
        };
    }
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
        cwd, shell: false,
        // win32 no tiene grupos de proceso POSIX (setsid) — `detached: true`
        // ahi solo crea un grupo de consola para CTRL+BREAK, no lo que este
        // modulo necesita. Mismo patron que sensors/exec.ts::runCommand.
        detached: !isWindowsNative(),
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

/** Existencia de pid respaldada DIRECTAMENTE por el kernel via libuv
 *  (process.kill(pid,0) — funciona en cualquier plataforma que Node
 *  soporte, incluido win32), a diferencia de `ps`/`pgrep`: en Windows esos
 *  binarios, cuando resuelven en el PATH, son el `ps`/`pgrep` de
 *  MSYS/Cygwin (Git for Windows) — una capa de EMULACION con su propia
 *  tabla de pids, ciega a procesos nativos spawneados via CreateProcess
 *  (exactamente lo que produce spawnStructured). Confirmado en CI
 *  windows-latest: `ps -o stat= -p <pid>` para un hijo real y vivo salia
 *  con exit 1 ("no such process" segun la vista emulada), y `psField`
 *  interpretaba ese exit 1 como "el SO confirmo que el pid no existe" —
 *  falso: era ceguera de la herramienta, no evidencia de muerte. Eso
 *  rompia el invariante "JAMAS safe sin evidencia" (safeToReplace
 *  devolvia 'safe' para un proceso vivo). process.kill(pid,0) evita la
 *  capa de emulacion por completo. */
function pidExistsNative(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // ESRCH = el SO confirmo que el pid no existe. Cualquier otro
        // codigo (ej. EPERM: existe pero sin permiso de senializarlo) NO
        // es evidencia de muerte — falla a favor de "vivo" (R2.1).
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/** Vivo Y con la MISMA identidad — tupla completa, nunca PID solo (R2.1,
 *  bloqueador 6): startTime + pgid + digest de ps args.
 *
 *  win32 (R6, ronda 2 — cierra el gap de la ronda 1): `process.kill(pid,0)`
 *  solo prueba existencia, NUNCA identidad — un pid reciclado por el SO
 *  entre la captura original y esta verificacion pasaria pidExistsNative
 *  igual que el proceso original, exactamente el escenario que R6 exige
 *  rechazar. Verificacion completa via win32ProcessInfo (WMI/Win32_Process,
 *  el unico analogo de `ps -o lstart=,args=` disponible en win32 sin
 *  tooling nativo adicional — Job Objects/bindings nativos quedan fuera de
 *  alcance de este fix):
 *   1. pidExistsNative primero (barato, cero WMI): si el kernel confirma
 *      ESRCH, listo — el camino rapido de produccion para el caso comun
 *      (limpiar refs de jobs ya terminados) nunca paga el costo de WMI.
 *   2. Convencion fija de captureRefFor en win32 (processGroup === pid,
 *      jamas hay pgid real ahi): cualquier ref que la rompa no pudo salir
 *      de este codigo — mismatch barato, cero WMI.
 *   3. Ref degradado (startTime/psArgsDigest === 'unknown', WMI no
 *      respondio AL CAPTURAR o es un ref persistido por una version
 *      anterior a este fix): no hay con que comparar mas alla de
 *      existencia — mismo contrato que "ps no pudo ejecutarse" en POSIX,
 *      fail hacia 'vivo'. Evita pagar WMI en este caso tambien.
 *   4. Solo con un ref NO degradado se paga el costo real: una consulta
 *      WMI, comparando startTime Y digest(commandLine+nonce+argvDigest)
 *      contra la tupla capturada. Cualquier campo alterado (startTime,
 *      spawnNonce, argvDigest o psArgsDigest directamente) rompe el
 *      digest o la comparacion de startTime => false, igual que la rama
 *      POSIX via identityDigest.
 *  `win32ProcessInfo` en 'absent' (WMI confirmo positivamente que el pid no
 *  existe) se respeta AUNQUE pidExistsNative haya dicho 'vivo' mas arriba
 *  en el paso 1 (nunca ocurre en produccion real, donde process.kill no
 *  esta mockeado — pero corrige el caso donde process.kill fue interceptado
 *  por un caller ajeno, ya que WMI es una fuente de evidencia INDEPENDIENTE
 *  de process.kill). Cualquier falla de PowerShell/WMI (null) es
 *  inconclusive, jamas se traduce a "muerto" — mismo invariante de toda
 *  esta pagina: el silencio jamas es prueba. Costo: cada verificacion de un
 *  ref VIVO y no-degradado en win32 paga un proceso powershell.exe
 *  (~cientos de ms, acotado por el timeout de win32ProcessInfo) — pagado
 *  SOLO en esa plataforma y SOLO para refs que ya pasaron los filtros
 *  baratos de arriba; ni groupIsGone ni pidExistsNative (paths de
 *  existencia pura, usados en loops de polling mas ajustados) lo pagan. */
export function refIsAlive(ref: ProcessRef): boolean {
    if (isWindowsNative()) {
        if (!pidExistsNative(ref.pid)) return false;
        if (ref.processGroup !== ref.pid) return false;
        if (ref.startTime === 'unknown' || ref.psArgsDigest === 'unknown') return true;
        const info = win32ProcessInfo(ref.pid);
        if (info === 'absent') return false;
        if (info === null) return true;
        if (info.creationDate !== ref.startTime) return false;
        return identityDigest(info.commandLine, ref.spawnNonce, ref.argvDigest) === ref.psArgsDigest;
    }
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
    if (isWindowsNative()) {
        // Sin pgrep confiable en esta plataforma (ver pidExistsNative):
        // mejor esfuerzo, solo confirma al LIDER (pgid === pid, por la
        // convencion de fallback de captureRefFor en win32 — nunca hay un
        // pgid real de ps ahi). No enumeramos descendientes sin Job
        // Objects (fuera de alcance) — killTreeWindows ya los alcanza al
        // matar via `taskkill /T`, aunque este check no los confirme
        // individualmente. Nunca declarar "grupo ausente" por ceguera de
        // una herramienta POSIX inexistente/emulada.
        return !pidExistsNative(pgid);
    }
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

/** win32: sin process groups POSIX ni convencion de pid negativo, y sin
 *  distincion real SIGTERM/SIGKILL (Node mapea ambas a TerminateProcess
 *  alla) — un `taskkill /T /F` (recursivo, forzado) sustituye a la
 *  escalera completa. Mismo patron ya usado y testeado en
 *  sensors/exec.ts::killTree (ver tests/commands/sensors/exec-windows.test.ts). */
function killTreeWindows(pid: number): void {
    try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: EXEC_STDIO }); }
    catch { /* ya ausente, o taskkill no disponible: best-effort — la confirmacion la hace el poll de groupIsGone */ }
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
    if (isWindowsNative()) {
        killTreeWindows(ref.pid);
        if (await waitUntilGone(opts.termGraceMs)) return true;
        killTreeWindows(ref.pid);
        return waitUntilGone(opts.killGraceMs);
    }
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
    if (isWindowsNative()) {
        killTreeWindows(ref.pid);
        if (await waitUntilGone(opts.termGraceMs)) return true;
        killTreeWindows(ref.pid);
        return waitUntilGone(opts.killGraceMs);
    }
    try { process.kill(-ref.processGroup, 'SIGTERM'); } catch { /* ya ausente */ }
    if (await waitUntilGone(opts.termGraceMs)) return true;
    try { process.kill(-ref.processGroup, 'SIGKILL'); } catch { /* ya ausente */ }
    return waitUntilGone(opts.killGraceMs);
}
