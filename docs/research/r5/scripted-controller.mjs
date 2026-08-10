#!/usr/bin/env node
// R5 Task 16 — controller DETERMINISTA para certificar el contrato supervisor↔controller
// sin gastar un solo token de LLM.
//
// El supervisor lanza *un proceso* y le pasa el prompt de su generación como último
// argumento. Este script ocupa exactamente ese lugar: extrae el token, emite las requests
// reales por el CLI real, hace el trabajo real en los worktrees reales y pide los joins.
// Todo lo que el supervisor ve es indistinguible de un agente — que es justamente lo que
// hace válida la certificación.
//
// Lo que este controller NO prueba, y no pretende: que un LLM sepa seguir el protocolo. Esa
// es una propiedad del agente, no del supervisor, y es la única parte que necesita tokens.
//
// Uso (lo invoca el supervisor vía AWM_CONTROLLER_ARGV, no a mano):
//   AWM_CONTROLLER_ARGV='["node","docs/research/r5/scripted-controller.mjs","--repo","<repo>","--cli","<dist>"]'
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const argv = process.argv.slice(2);
// El prompt es SIEMPRE el último argumento (lo agrega `adapterFor`), así que los flags se
// leen por nombre y nunca por posición: agregar un flag no debe correr el prompt.
const prompt = argv[argv.length - 1] ?? '';
const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length - 1 ? argv[i + 1] : undefined;
};

const repo = flag('repo') ?? process.cwd();
const cli = flag('cli') ?? path.resolve('cli/dist/src/index.js');
const tracks = (flag('tracks') ?? 'alpha,beta').split(',');

// El token llega por el prompt, igual que a un agente real. Si no está, este proceso no es
// un controller legítimo de ninguna generación: aborta en vez de inventar uno.
const token = prompt.match(/Generacion activa:\s*([0-9a-f]+)/)?.[1];
if (token === undefined) {
    process.stderr.write(`scripted-controller: el prompt no trae token de generacion:\n${prompt}\n`);
    process.exit(2);
}

const log = (msg) => process.stdout.write(`[scripted-controller] ${msg}\n`);
const awm = (args, opts = {}) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function journal() {
    const p = path.join(repo, '.awm', 'journal', 'main', 'state.json');
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw.state ?? raw;
}

/** Sleep sincrónico sin quemar CPU ni abrir un proceso por vuelta. */
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * El heartbeat NO es cosmético: es parte del contrato del controller. El supervisor declara
 * en stall a todo controller que calle más que `--heartbeat-timeout` y lo supersede,
 * abriendo una generación nueva. Un controller que trabaja en silencio termina asesinado y
 * relanzado en loop — se comprobó de primera mano al escribir esto: sin heartbeat, la
 * corrida encadenaba `controller-suspected-stall` / `generation-begun` sin avanzar nunca.
 *
 * Best-effort: si el heartbeat falla (p. ej. la generación ya fue superseded), no se aborta
 * el trabajo — el supervisor ya decidió, y este proceso lo va a descubrir por el journal.
 */
function heartbeat() {
    try { awm(['job', 'controller-heartbeat', '--generation', token]); } catch { /* generación ya superseded */ }
}

/** Espera a que el journal satisfaga `done`, latiendo mientras espera. El supervisor avanza
 *  como mucho una frontera por tick (por diseño: es lo que hace que un crash converja al
 *  reintentar), así que un controller que asume "una request => estado final" mide otra cosa.
 *  Timeout explícito: colgarse para siempre no es esperar, es no reportar nunca. */
function waitFor(label, done, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const s = journal();
        if (s !== null && done(s)) return s;
        if (Date.now() > deadline) {
            process.stderr.write(`scripted-controller: timeout esperando ${label}; cohortPhase=${s?.cohortPhase} tracks=${JSON.stringify((s?.tracks ?? []).map((t) => [t.trackId, t.phase]))}\n`);
            process.exit(3);
        }
        heartbeat();
        sleep(1000);
    }
}

const ARMED_OR_LATER = ['ARMED', 'ACTIVE', 'JOIN_REQUESTED', 'FROZEN', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED'];

// --- Ejercicio 1: bootstrap ------------------------------------------------
// Idempotente a propósito: si el supervisor relevó a un controller anterior (ejercicio 2),
// este arranca de nuevo y los tracks YA declarados no deben re-declararse.
heartbeat();   // primer latido antes de cualquier trabajo: el supervisor ya está contando

// El contrato canónico de integración se registra ANTES de cualquier join. Sin él, el
// supervisor llega a `request-final-integration` y se queda esperando: no inventa un comando
// (fail-closed, C4) — la cohorte queda en ACTIVE para siempre. Creación-única en el journal,
// así que reemitirlo tras un relevo es inofensivo.
// `argv` como array y sin shell, igual que el argv de integración de un plan real.
try {
    awm(['job', 'register', '--generation', token, '--entity', 'track-integration', '--json', JSON.stringify({
        argv: ['git', 'rev-parse', 'HEAD'],
        paths: ['src/**'],
        planDigest: 'scripted-controller-r5-t16',
    })]);
    log('contrato de integracion registrado');
} catch (e) {
    log(`registro de integracion no aplicado (posible generacion superseded): ${String(e).split('\n')[0]}`);
}
heartbeat();

const declared = new Set((journal()?.tracks ?? []).map((t) => t.trackId));
for (const t of tracks) {
    if (declared.has(t)) { log(`track ${t} ya declarado, no se re-emite`); continue; }
    awm(['track', 'add', t, '--generation', token]);
    heartbeat();
    log(`track add ${t}`);
}
waitFor('ambos tracks ARMED', (s) => tracks.every((t) => ARMED_OR_LATER.includes((s.tracks ?? []).find((x) => x.trackId === t)?.phase ?? '')));
log('bootstrap: ambos tracks ARMED o posterior');

// --- Ejercicio 3: trabajo real en cada worktree + joins --------------------
for (const t of tracks) {
    const ref = (journal()?.tracks ?? []).find((x) => x.trackId === t);
    if (ref === undefined || !fs.existsSync(ref.worktreePath)) {
        process.stderr.write(`scripted-controller: worktree ausente para ${t}\n`);
        process.exit(4);
    }
    if (['MERGED_UNVERIFIED', 'JOINED', 'JOIN_INTENT', 'FROZEN'].includes(ref.phase)) {
        log(`track ${t} ya integrado o congelado, no se repite`);
        continue;
    }
    // Idempotencia sobre el ESTADO REAL del worktree, no sobre la fase del track. Un
    // controller relevado encuentra el trabajo de su antecesor ya commiteado mientras la
    // fase sigue atrás — porque el join anterior pudo ser rechazado por generación stale
    // (fencing), que es justamente lo que pasa tras un relevo. Mirar la fase hacía que este
    // script muriera con "nothing to commit" en vez de retomar.
    fs.writeFileSync(path.join(ref.worktreePath, 'src', `${t}.txt`), `${t}-final\n`);
    git(ref.worktreePath, ['add', '-A']);
    if (git(ref.worktreePath, ['status', '--porcelain']).trim().length > 0) {
        git(ref.worktreePath, ['-c', 'user.email=r5@awm.test', '-c', 'user.name=AWM R5', '-c', 'commit.gpgsign=false', 'commit', '-qm', `track ${t}`]);
        log(`commit en ${t}`);
    } else {
        log(`${t} ya commiteado por un controller anterior`);
    }
    // El join se (re)emite SIEMPRE: si el anterior fue rechazado por stale, este es el que
    // vale; si ya se aplicó, la idempotencia por `idempotencyKey` del journal lo absorbe.
    awm(['track', 'join', t, '--generation', token]);
    heartbeat();
    log(`track join ${t}`);
}

waitFor('cohorte COMPLETE', (s) => s.cohortPhase === 'COMPLETE');
log('join: cohorte COMPLETE');
