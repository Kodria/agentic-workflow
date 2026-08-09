import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnPendingWrappers, collectAndReconcile, runnerTick, WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper, claimPath, identityPath, resultPath, logPath } from '../../../src/commands/job/exec-wrapper';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { logsDir } from '../../../src/core/journal/paths';
import { Job } from '../../../src/core/journal/types';
import { argvDigest } from '../../../src/core/journal/process';

// Presupuesto explicito, como sus tres hermanos de `tests/commands/watch/`
// (integration 30s, supervisor-loop 60s, e2e-crash 180s). Este archivo era el unico de
// la familia sin uno, y hace el mismo trabajo que ellos: cada `collectAndReconcile`
// consulta si el proceso sigue vivo, y en Windows eso spawnea `tasklist` — cientos de ms
// por llamada bajo carga. El test de stall hace 3 iteraciones sobre dos refs (proceso +
// wrapper), o sea 6 consultas, y el default de 5s de jest quedaba justo en el borde:
// verde en dos corridas de Windows y timeout en la tercera, sin que cambiara el codigo.
// El sujeto del test es la semantica de deteccion de stall, no cuanto tarda; el reloj
// generoso no afloja ninguna asercion.
jest.setTimeout(60000);


const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    // Mismo contrato que el spawner real: dispara el wrapper y NO espera.
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => { /* el resultado 127 ya quedo en sidecar */ });
};

async function until(fn: () => boolean, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout esperando condicion');
        await new Promise((r) => setTimeout(r, 50));
    }
}

/** fakeSpawner dispara runExecWrapper sin esperarlo (fire-and-forget, mismo
 *  contrato que el spawner real — ver comentario en fakeSpawner). Eso deja
 *  una escritura async en vuelo hacia archivos bajo `repo` (logs, sidecars)
 *  que puede seguir viva cuando afterEach borra el tmpdir. En win32 un
 *  handle abierto en el momento del rmdir produce EBUSY (confirmado en CI
 *  real: windows-latest, no reproducible en POSIX porque unlink ahi no
 *  requiere que el handle este cerrado). No es un fallo de produccion —
 *  ningun test observa contenido tras el cleanup — asi que un
 *  reintento acotado alcanza sin tener que forzar cada test a esperar el
 *  wrapper en vuelo. */
async function rmSyncRetryingEbusy(target: string, attempts = 10, delayMs = 50): Promise<void> {
    for (let i = 0; i < attempts; i++) {
        try {
            fs.rmSync(target, { recursive: true, force: true });
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || i === attempts - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

function seedJob(repo: string, partial: Partial<Job>): string {
    const s = readJournal(repo, 'rama').state!;
    const j: Job = {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['node', '-e', 'process.exit(0)'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing',
        phaseTimestamps: { received: new Date().toISOString() }, ...partial,
    };
    s.jobs[j.id] = j;
    writeJournal(repo, 'rama', s);
    return j.id;
}

describe('runner concurrente', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-')); initJournal(repo, 'rama'); });
    afterEach(async () => { await rmSyncRetryingEbusy(repo); });

    test('spawnPendingWrappers persiste spawn-intent+nonce ANTES del spawn y NO bloquea (R1.8, R4.4)', async () => {  // verifies R4.4
        seedJob(repo, { argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 800)'] });
        const spawned = spawnPendingWrappers(repo, 'rama', fakeSpawner);
        expect(spawned).toBe(1);
        // Retorno INMEDIATO: el job aun no esta exited — el supervisor no espero
        const mid = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(['spawn-intent', 'claimed', 'running']).toContain(mid.executionState);
        expect(typeof mid.spawnNonce).toBe('string');           // intent durable pre-spawn
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited';
        });
        const done = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(done.verdict).toBe('pass');
        expect(done.processRef!.pid).toBeGreaterThan(0);        // identidad REAL adoptada del sidecar
        expect(done.wrapperRef!.pid).toBeGreaterThan(0);
    });

    test('job largo pasa por running con identidad real; jamas se mata por duracion (R3.5)', async () => {  // verifies R3.5
        seedJob(repo, { argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 1500)'] });
        spawnPendingWrappers(repo, 'rama', fakeSpawner);
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'running';
        });
        const running = readJournal(repo, 'rama').state!.jobs['j1'];
        // hex real cuando la plataforma pudo observar el proceso (ps en
        // POSIX, WMI/powershell en win32 — ver captureRefFor en
        // src/core/journal/process.ts); sentinel 'unknown' documentado
        // cuando esa observacion no estuvo disponible. Mismo criterio ya
        // establecido en tests/core/journal/process.test.ts (y en
        // exec-wrapper.test.ts) — este test no puede exigir mas certeza de
        // la que la plataforma real puede dar.
        expect(running.processRef!.psArgsDigest).toMatch(/^([0-9a-f]{16}|unknown)$/);
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited';
        });
    });

    test('spawn-intent sin claim fuera de gracia => re-spawn del MISMO intent y nonce (R3.3/R1.8)', () => {  // verifies R3.3
        seedJob(repo, {
            executionState: 'spawn-intent', spawnNonce: 'nunca-claimeo',
            phaseTimestamps: { 'spawn-intent': new Date(Date.now() - 60000).toISOString() },
        });
        const calls: Array<{ id: string; nonce: string }> = [];
        const out = runnerTick(repo, 'rama', (job, nonce) => { calls.push({ id: job.id, nonce }); }, { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'retry-same-intent')).toBeDefined();
        const s = readJournal(repo, 'rama').state!;
        expect(Object.keys(s.jobs)).toEqual(['j1']);
        expect(s.jobs['j1'].executionState).toBe('spawn-intent');
        expect(s.jobs['j1'].spawnNonce).toBe('nunca-claimeo');
        expect(calls).toEqual([{ id: 'j1', nonce: 'nunca-claimeo' }]);
    });

    test('claim sin resultado con procesos muertos => orphaned, jamas relanzar (R1.8)', () => {  // verifies R1.8
        const dead = { pid: 999999, startTime: 'gone', spawnNonce: 'nZ', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        seedJob(repo, {
            executionState: 'running', spawnNonce: 'nZ', processRef: dead, wrapperRef: { ...dead, pid: 999998 },
            phaseTimestamps: { running: new Date(Date.now() - 60000).toISOString() },
        });
        fs.writeFileSync(claimPath(logsDir(repo, 'rama'), 'j1', 'nZ'), '{}');
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'orphaned-authorization-required')).toBeDefined();
        expect(readJournal(repo, 'rama').state!.jobs['j1'].executionState).toBe('orphaned');
    });

    test('identity sidecar a medio escribir (JSON invalido) => no avanza esta vuelta, no crashea; tick siguiente con identidad valida si avanza', () => {  // verifies R1.8
        seedJob(repo, {
            executionState: 'claimed', spawnNonce: 'nI',
            phaseTimestamps: { claimed: new Date().toISOString() },
        });
        fs.writeFileSync(identityPath(logsDir(repo, 'rama'), 'j1', 'nI'), '{ esto no es json valido');
        expect(() => collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000 })).not.toThrow();
        const mid = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(mid.executionState).toBe('claimed');   // sin avance: el sidecar aun no es legible
        expect(mid.processRef).toBeUndefined();

        const validIdentity = {
            jobId: 'j1', nonce: 'nI',
            wrapper: { pid: 111, startTime: 'x', spawnNonce: 'nI', argvDigest: 'd', processGroup: 111, psArgsDigest: 'e' },
            command: { pid: 112, startTime: 'x', spawnNonce: 'nI', argvDigest: argvDigest(['node', '-e', 'process.exit(0)']), processGroup: 111, psArgsDigest: 'e' },
        };
        fs.writeFileSync(identityPath(logsDir(repo, 'rama'), 'j1', 'nI'), JSON.stringify(validIdentity));
        collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000 });
        const done = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(done.executionState).toBe('running');
        expect(done.processRef!.pid).toBe(112);
    });

    test('identity sidecar con JSON valido pero forma invalida (ProcessRef incompleto) => no avanza, no crashea (R1.8)', () => {  // verifies R1.8
        seedJob(repo, {
            executionState: 'claimed', spawnNonce: 'nJ',
            phaseTimestamps: { claimed: new Date().toISOString() },
        });
        fs.writeFileSync(identityPath(logsDir(repo, 'rama'), 'j1', 'nJ'), JSON.stringify({ jobId: 'j1', nonce: 'nJ', wrapper: {}, command: {} }));
        expect(() => collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000 })).not.toThrow();
        const mid = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(mid.executionState).toBe('claimed');
        expect(mid.processRef).toBeUndefined();
    });

    test('claim sidecar a medio escribir (contenido no-JSON) igual dispara claimed — el contenido nunca se parsea (R1.8)', () => {  // verifies R1.8
        seedJob(repo, {
            executionState: 'spawn-intent', spawnNonce: 'nK',
            phaseTimestamps: { 'spawn-intent': new Date().toISOString() },
        });
        fs.writeFileSync(claimPath(logsDir(repo, 'rama'), 'j1', 'nK'), '{"jobId":"j1truncado-sin-cerrar');
        expect(() => collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000 })).not.toThrow();
        expect(readJournal(repo, 'rama').state!.jobs['j1'].executionState).toBe('claimed');
    });

    test('resultado parcial con solo exitCode => el scan no lo adopta; fuera de gracia cae a orphaned, jamas fabrica pass (R1.6)', () => {  // verifies R1.6
        const dead = { pid: 999999, startTime: 'gone', spawnNonce: 'nL', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        seedJob(repo, {
            executionState: 'running', spawnNonce: 'nL', processRef: dead,
            phaseTimestamps: { running: new Date(Date.now() - 60000).toISOString() },
        });
        fs.writeFileSync(claimPath(logsDir(repo, 'rama'), 'j1', 'nL'), '{}');
        fs.writeFileSync(resultPath(logsDir(repo, 'rama'), 'j1', 'nL'), JSON.stringify({ exitCode: 0 }));
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'orphaned-authorization-required')).toBeDefined();
        const done = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(done.executionState).toBe('orphaned');
        expect(done.verdict).toBeUndefined();   // jamas fabricado de un sidecar sin forma
    });

    test('resultado completo sin claim no se adopta como evidencia', () => {
        seedJob(repo, {
            executionState: 'spawn-intent', spawnNonce: 'nNoClaim',
            phaseTimestamps: { 'spawn-intent': new Date(Date.now() - 60000).toISOString() },
        });
        fs.writeFileSync(resultPath(logsDir(repo, 'rama'), 'j1', 'nNoClaim'), JSON.stringify({
            exitCode: 0, endedAt: new Date().toISOString(), resultPath: 'forged',
        }));
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions).toContainEqual({ jobId: 'j1', action: 'retry-same-intent' });
        const job = readJournal(repo, 'rama').state!.jobs.j1;
        expect(job.executionState).toBe('spawn-intent');
        expect(job.verdict).toBeUndefined();
    });

    test('runnerTick combina recoleccion + spawn en un tick sin esperar (R4.4)', async () => {  // verifies R4.4
        seedJob(repo, {});
        const out = runnerTick(repo, 'rama', fakeSpawner, { reconcileGraceMs: 10000 });
        expect(out.spawned).toBe(1);
        await until(() => runnerTick(repo, 'rama', fakeSpawner, { reconcileGraceMs: 10000 }).advanced > 0
            || readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited');
    });

    describe('observationState: suspected-stall por staleness del log, puramente observacional (R3.5)', () => {
        function seedRunning(nonce: string, runningAt: string): void {
            const dead = { pid: 999999, startTime: 'gone', spawnNonce: nonce, argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
            seedJob(repo, {
                executionState: 'running', spawnNonce: nonce, processRef: dead, wrapperRef: { ...dead, pid: 999998 },
                phaseTimestamps: { running: runningAt }, lastProgressAt: runningAt,
            });
        }

        test('log que sigue creciendo (mtime avanza cada tick) queda progressing aun pasado el umbral', async () => {
            const oldIso = new Date(Date.now() - 60000).toISOString();
            seedRunning('nStall1', oldIso);
            const logs = logsDir(repo, 'rama');
            fs.mkdirSync(logs, { recursive: true });
            const file = logPath(logs, 'j1', 'nStall1');
            fs.writeFileSync(file, 'salida inicial\n');
            // umbral MUY corto (10ms): si el job estuviera realmente stalled, cualquiera
            // de estos 3 ticks lo marcaria suspected-stall — pero el log sigue creciendo.
            for (let i = 0; i < 3; i++) {
                await new Promise((res) => setTimeout(res, 20));   // > stallObservationMs entre escrituras
                fs.appendFileSync(file, `linea ${i}\n`);
                collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000, stallObservationMs: 10 });
                expect(readJournal(repo, 'rama').state!.jobs['j1'].observationState).toBe('progressing');
            }
        });

        // El log se escribe con un mtime EXPLICITAMENTE anterior a `lastProgressAt`
        // (utimesSync, no timing de reloj real) — determinista, sin flakiness por
        // resolucion de mtime del filesystem. Misma semantica que el runner real:
        // el log no avanzo desde la ultima marca de progreso conocida.
        function seedRunningWithStaleLog(nonce: string, content: string): void {
            const logs = logsDir(repo, 'rama');
            fs.mkdirSync(logs, { recursive: true });
            const file = logPath(logs, 'j1', nonce);
            fs.writeFileSync(file, content);
            const past = new Date(Date.now() - 5000);
            fs.utimesSync(file, past, past);
            seedRunning(nonce, new Date(Date.now() - 1000).toISOString());
        }

        test('log sin crecer por mas del umbral => suspected-stall, executionState intacto (jamas mata nada)', () => {
            seedRunningWithStaleLog('nStall2', 'salida unica, nunca mas crece\n');
            collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000, stallObservationMs: 10 });
            const j = readJournal(repo, 'rama').state!.jobs['j1'];
            expect(j.observationState).toBe('suspected-stall');
            expect(j.executionState).toBe('running');   // observacional puro: nunca produce transicion terminal (R3.5)
        });

        test('un job stalled vuelve a progressing si el log retoma crecimiento', () => {
            seedRunningWithStaleLog('nStall3', 'salida vieja\n');
            collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000, stallObservationMs: 10 });
            expect(readJournal(repo, 'rama').state!.jobs['j1'].observationState).toBe('suspected-stall');

            const logs = logsDir(repo, 'rama');
            fs.appendFileSync(logPath(logs, 'j1', 'nStall3'), 'output nuevo: el job seguia vivo\n');
            collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000, stallObservationMs: 10 });
            expect(readJournal(repo, 'rama').state!.jobs['j1'].observationState).toBe('progressing');
        });

        test('un job stalled que termina llega a exited via el sidecar de resultado normal, sin intervencion de staleness', () => {
            seedRunningWithStaleLog('nStall4', 'salida vieja\n');
            collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000, stallObservationMs: 10 });
            expect(readJournal(repo, 'rama').state!.jobs['j1'].observationState).toBe('suspected-stall');

            const logs = logsDir(repo, 'rama');
            fs.writeFileSync(claimPath(logs, 'j1', 'nStall4'), '{}');
            fs.writeFileSync(resultPath(logs, 'j1', 'nStall4'), JSON.stringify({ exitCode: 0, endedAt: new Date().toISOString(), resultPath: 'x' }));
            collectAndReconcile(repo, 'rama', { reconcileGraceMs: 60000, stallObservationMs: 10 });
            const j = readJournal(repo, 'rama').state!.jobs['j1'];
            expect(j.executionState).toBe('exited');
            expect(j.verdict).toBe('pass');
        });
    });
});
