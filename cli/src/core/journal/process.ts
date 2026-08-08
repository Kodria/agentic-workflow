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

/** timeout explicito (defense-in-depth, mismo patron que win32ProcessInfo):
 *  sin esto, un `ps`/`pgrep` que cuelga (recurso bloqueado, binario
 *  emulado con comportamiento anomalo) cuelga TODO el proceso llamante
 *  indefinidamente — sin excepcion que atrapar, sin manera de fallar a
 *  favor de "vivo" porque el codigo nunca vuelve a ejecutar. Un timeout
 *  convierte ese cuelgue en un error normal, que el contrato existente de
 *  cada caller ya sabe manejar (nunca declarar muerte por un error). */
const PS_TIMEOUT_MS = 3000;

function psField(pid: number, field: string): string | null {
    try {
        const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8', stdio: EXEC_STDIO, timeout: PS_TIMEOUT_MS }).trim();
        return out.length > 0 ? out : null;
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        if (status === 1) return null;   // ps corrio y confirmo: el pid no existe
        throw error;   // ps no pudo ejecutarse (ENOENT/permisos/timeout/etc): NO es prueba de nada
    }
}

function sleepSync(seconds: string): void {
    try { execFileSync('sleep', [seconds], { stdio: EXEC_STDIO, timeout: PS_TIMEOUT_MS }); } catch { /* sin sleep: seguimos */ }
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
        // R6 ronda 4 probo `detached: true` incondicional en win32 (razonando
        // desde la doc de Node sobre supervivencia post-muerte del padre) y
        // la ronda 5 lo REVIERTE: la primera corrida real en windows-latest
        // mostro `refIsAlive(ref)` devolviendo `false` INMEDIATAMENTE despues
        // de un spawn normal, sin matar nada — el test mas basico del
        // archivo ('spawnStructured produce ProcessRef con tupla completa').
        // `captureRefFor` fija `processGroup: pid` por convencion en win32
        // (siempre), asi que ese `false` solo puede venir de
        // `pidExistsNative` viendo ESRCH real — el proceso hijo aparentaba
        // no existir casi de inmediato. Evidencia real > lectura de
        // documentacion: se revierte a `!isWindowsNative()` (el diseño ya
        // probado, correcto, en 4 rondas previas de CI real). La garantia de
        // R1.8 ("el wrapper sobrevive al supervisor") queda como gap
        // ABIERTO en win32 — ver el test skippeado en
        // tests/commands/watch/e2e-crash.test.ts para el detalle y el
        // proximo intento debe verificarse contra CI real antes de asumir
        // que un cambio de `detached` lo resuelve.
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
/** Sleep sincronico REAL, multiplataforma, sin depender de un binario externo
 *  (`sleep` no existe nativamente en win32 — ver el comentario de sleepSync
 *  mas arriba). `Atomics.wait` sobre un buffer compartido bloquea el hilo
 *  actual durante `ms` sin abrir ningun subproceso; funciona identico en
 *  cualquier plataforma que soporte Node. Usado SOLO por pidExistsNative
 *  para el reintento acotado de abajo — nunca en un hot-path de alta
 *  frecuencia. */
function sleepMsSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Reintento acotado (R6, post-mortem de CI real): dos corridas reales de
 *  windows-latest sobre el MISMO commit (uno vía `release.yml`, uno vía
 *  `ci.yml`, ambos re-corriendo el suite completo desde cero) dieron
 *  resultados DISTINTOS para el mismo test — `pidExistsNative` reportando
 *  ESRCH para un proceso recien spawneado por el propio test, genuinamente
 *  vivo — evidencia directa de una condicion de carrera transitoria
 *  especifica de esta plataforma/runner, no un bug determinista (el codigo
 *  no cambio entre ambas corridas). Un solo intento en el hot-path exacto
 *  "acabo de spawnear esto, ¿esta vivo?" no le da tiempo al SO a que el pid
 *  sea consultable via OpenProcess bajo carga pesada del runner. Reintentar
 *  con una pausa breve ANTES de declarar ESRCH definitivo no debilita el
 *  invariante "jamas muerte sin evidencia" — un proceso genuinamente muerto
 *  sigue reportando ESRCH en el reintento; esto solo absorbe el falso
 *  negativo transitorio. Costo maximo, y SOLO en la rama que ya iba a
 *  declarar "no existe" — el camino feliz (proceso vivo, exito inmediato)
 *  no paga nada.
 *
 *  R6 post-mortem #2: el presupuesto original (3 intentos, 50ms => 100ms de
 *  espera real) sobrevivio 2 corridas reales de windows-latest tras mergear
 *  este mismo mecanismo, pero una tercera corrida real (commit identico,
 *  ningun cambio en este archivo) volvio a fallar EL MISMO assert en EL
 *  MISMO test — siempre el PRIMER spawn del archivo, nunca los siguientes
 *  (que reusan un binario node.exe ya "calentado" por el SO/AV en ese
 *  proceso de test). Eso apunta a latencia de arranque en frio (primer
 *  spawn del job) empujando el tiempo de visibilidad de OpenProcess mas
 *  alla del presupuesto anterior — no una condicion de carrera nueva, la
 *  MISMA, con cola mas larga de lo que 100ms cubria. Presupuesto ampliado a
 *  10 intentos / 100ms (hasta ~900ms de espera real) para darle margen real
 *  a ese arranque en frio, siguiendo cuestionando el mismo mecanismo en vez
 *  de reemplazarlo (systematic-debugging: 2+ fallas del mismo sintoma exacto
 *  primero exige ampliar el mismo remedio antes de descartar la arquitectura
 *  — a diferencia del patron de "cada intento revela un problema nuevo en
 *  otro lugar", que si justificaria cuestionar el diseño). */
const PID_EXISTS_RETRY_ATTEMPTS = 10;
const PID_EXISTS_RETRY_DELAY_MS = 100;

function pidExistsNative(pid: number): boolean {
    for (let attempt = 0; attempt < PID_EXISTS_RETRY_ATTEMPTS; attempt++) {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            // ESRCH = el SO confirmo que el pid no existe. Cualquier otro
            // codigo (ej. EPERM: existe pero sin permiso de senializarlo) NO
            // es evidencia de muerte — falla a favor de "vivo" (R2.1).
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true;
            if (attempt < PID_EXISTS_RETRY_ATTEMPTS - 1) sleepMsSync(PID_EXISTS_RETRY_DELAY_MS);
        }
    }
    return false;
}

/** Vivo Y con la MISMA identidad — tupla completa, nunca PID solo (R2.1,
 *  bloqueador 6): startTime + pgid + digest de ps args.
 *
 *  win32 (R6, ronda 3 — REVIERTE la ronda 2): la ronda 2 intento cerrar el
 *  gap de reciclado de PID via una comparacion completa de identidad contra
 *  WMI (win32ProcessInfo, `Get-CimInstance Win32_Process`) en cada llamada.
 *  La PRIMERA corrida real en windows-latest CI (2026-08-08) mostro
 *  `refIsAlive` devolviendo `false` para un proceso node recien spawneado y
 *  genuinamente vivo (test platform-agnostico, SIN mocks de por medio) —
 *  osea que la comparacion WMI produjo un FALSO NEGATIVO real, la direccion
 *  de fallo MAS peligrosa para esta funcion (un supervisor que trata un job
 *  vivo como muerto puede duplicar trabajo o corromper estado). La misma
 *  corrida tambien mostro 2 tests E2E pesados (supervisor-loop, e2e-crash)
 *  colgando hasta el timeout, consistente con un loop de polling que nunca
 *  converge si su chequeo de vida es inestable.
 *
 *  `pidExistsNative` (process.kill(pid,0), directo al kernel via libuv) en
 *  cambio sobrevivio SIN NINGUN falso negativo/positivo a 3 corridas reales
 *  de CI consecutivas (rondas anteriores de este mismo release) — evidencia
 *  empirica solida de que es confiable en windows-latest, mientras que WMI
 *  demostradamente no lo es (razon exacta de la inestabilia sin determinar:
 *  podria ser latencia de indexado de WMI para procesos recien creados,
 *  podria ser una conversion de CreationDate no perfectamente determinista
 *  entre dos consultas separadas — no hay Windows real disponible en este
 *  entorno para experimentar y confirmar cual).
 *
 *  Decision (systematic-debugging: 2+ intentos revelando problemas nuevos en
 *  lugares distintos exige cuestionar la arquitectura, no seguir parchando):
 *  se revierte a existencia + convencion de processGroup solamente en
 *  win32, la MISMA superficie que la ronda 1 ya tenia probada. La proteccion
 *  contra reciclado de PID completa (bloqueador 6) queda como gap ACEPTADO
 *  y documentado en esta plataforma — la ventana real para que ocurra
 *  (Windows reciclando un pid entre esta verificacion y la captura original,
 *  tipicamente milisegundos/segundos antes, en el mismo proceso controlador)
 *  es angosta, y el costo de intentar cerrarla con un mecanismo demostrado
 *  no confiable es peor que el gap mismo. `win32ProcessInfo`/`captureRefFor`
 *  siguen poblando startTime/psArgsDigest REALES via WMI cuando responden
 *  (uso informativo — quedan en el ProcessRef persistido) pero refIsAlive
 *  YA NO los usa para su veredicto go/no-go. */
export function refIsAlive(ref: ProcessRef): boolean {
    if (isWindowsNative()) {
        if (!pidExistsNative(ref.pid)) return false;
        return ref.processGroup === ref.pid;
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
        const out = execFileSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8', stdio: EXEC_STDIO, timeout: PS_TIMEOUT_MS });
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
/** Llamada UNA VEZ POR TICK por el supervisor (ver superviseController en
 *  commands/watch/supervisor.ts) mientras un controlador este activo — el
 *  path mas caliente de todo el modulo. En win32, `ps`/`pgrep`, cuando
 *  resuelven en el PATH, son el binario EMULADO de MSYS/Cygwin (Git for
 *  Windows) — ciego a procesos nativos (el mismo hecho ya documentado y
 *  probado para pidExistsNative/refIsAlive/groupIsGone en este archivo).
 *  A diferencia de esas funciones, ESTA no fue tocada por ninguna ronda
 *  previa del fix de R6 — seguia intentando `ps`/`pgrep` reales en CADA
 *  tick, sin timeout, sobre un binario ya sabido no confiable ahi.
 *  Degradar directo (sin tocar el proceso real) evita acumular latencia de
 *  subprocess real en un loop de polling de alta frecuencia, con o sin el
 *  timeout de PS_TIMEOUT_MS de defensa — ese timeout cubre el caso en que
 *  el binario SI exista mal comportado; esta rama cubre el caso, ya
 *  confirmado real en este archivo, de que la herramienta simplemente no
 *  es fuente de verdad en esta plataforma. */
export function activitySnapshot(ref: ProcessRef): ActivitySnapshot | null {
    if (!refIsAlive(ref)) return null;
    if (isWindowsNative()) return { cpuTime: 'unknown', groupSize: 1 };
    let cpu = '0';
    try { cpu = psField(ref.pid, 'time') ?? '0'; } catch { cpu = '0'; }
    let groupSize = 1;
    try {
        groupSize = execFileSync('pgrep', ['-g', String(ref.processGroup)], { encoding: 'utf8', stdio: EXEC_STDIO, timeout: PS_TIMEOUT_MS })
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
