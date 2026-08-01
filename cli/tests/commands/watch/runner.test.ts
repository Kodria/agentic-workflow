import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnPendingWrappers, collectAndReconcile, runnerTick, WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper, claimPath, identityPath, resultPath } from '../../../src/commands/job/exec-wrapper';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { logsDir } from '../../../src/core/journal/paths';
import { Job } from '../../../src/core/journal/types';

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    // Mismo contrato que el spawner real: dispara el wrapper y NO espera.
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: repoRoot }).catch(() => { /* el resultado 127 ya quedo en sidecar */ });
};

async function until(fn: () => boolean, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout esperando condicion');
        await new Promise((r) => setTimeout(r, 50));
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
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

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
        expect(running.processRef!.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited';
        });
    });

    test('spawn-intent sin claim fuera de gracia => retry con Attempt nuevo (matriz unica, R3.3)', () => {  // verifies R3.3
        seedJob(repo, {
            executionState: 'spawn-intent', spawnNonce: 'nunca-claimeo',
            phaseTimestamps: { 'spawn-intent': new Date(Date.now() - 60000).toISOString() },
        });
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'retry-new-attempt')).toBeDefined();
        const s = readJournal(repo, 'rama').state!;
        expect(s.jobs['j1'].executionState).toBe('cancelled');
        const fresh = Object.values(s.jobs).find((j) => j.attemptOf === 'j1')!;
        expect(fresh.executionState).toBe('received');
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
            command: { pid: 112, startTime: 'x', spawnNonce: 'nI', argvDigest: 'd', processGroup: 111, psArgsDigest: 'e' },
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

    test('resultado con forma invalida (sin exitCode numerico) => el scan no lo adopta; fuera de gracia la matriz lo cae a orphaned, jamas fabrica verdict (R1.6)', () => {  // verifies R1.6
        const dead = { pid: 999999, startTime: 'gone', spawnNonce: 'nL', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        seedJob(repo, {
            executionState: 'running', spawnNonce: 'nL', processRef: dead,
            phaseTimestamps: { running: new Date(Date.now() - 60000).toISOString() },
        });
        fs.writeFileSync(claimPath(logsDir(repo, 'rama'), 'j1', 'nL'), '{}');
        fs.writeFileSync(resultPath(logsDir(repo, 'rama'), 'j1', 'nL'), JSON.stringify({}));   // sin exitCode
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'orphaned-authorization-required')).toBeDefined();
        const done = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(done.executionState).toBe('orphaned');
        expect(done.verdict).toBeUndefined();   // jamas fabricado de un sidecar sin forma
    });

    test('runnerTick combina recoleccion + spawn en un tick sin esperar (R4.4)', async () => {  // verifies R4.4
        seedJob(repo, {});
        const out = runnerTick(repo, 'rama', fakeSpawner, { reconcileGraceMs: 10000 });
        expect(out.spawned).toBe(1);
        await until(() => runnerTick(repo, 'rama', fakeSpawner, { reconcileGraceMs: 10000 }).advanced > 0
            || readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited');
    });
});
