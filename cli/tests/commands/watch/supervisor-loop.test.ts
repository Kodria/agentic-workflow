import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Supervisor, runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import { WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { beginGeneration, activeGeneration } from '../../../src/commands/watch/generations';
import { initWatch } from '../../../src/commands/watch/init';
import { requestJob } from '../../../src/commands/job/request';
import { emitRequest } from '../../../src/core/journal/requests';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { spawnStructured } from '../../../src/core/journal/process';

jest.setTimeout(60000);

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: repoRoot }).catch(() => {});
};

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function setupRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-loop-'));
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
    return repo;
}

async function until(fn: () => boolean, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('supervisor loop', () => {
    let repo: string;
    let stubBin: string;
    let oldPath: string | undefined;
    beforeEach(() => {
        repo = setupRepo();
        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stub-'));
        fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        oldPath = process.env.PATH;
        process.env.PATH = `${stubBin}:${process.env.PATH}`;
    });
    afterEach(() => {
        process.env.PATH = oldPath;
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    test('ticks drenan y declaran COMPLETE solo con gate verde + cero vivos (R4.5)', async () => {  // verifies R4.5
        initWatch(repo, 'main');    // sin package.json => requiredVerifiers []
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, reconcileGraceMs: 10000 };
        const sup = new Supervisor(repo, 'main', cfg, fakeSpawner);
        // el controlador (aqui: el test) registra plan de ciclo + task + jobs enlazados
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }], reviewObligations: [] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'setTimeout(()=>process.exit(0), 400)'], [], '.', { satisfies: 'v1' });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e3',
            payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });
        let sawContinueWithLiveJob = false;
        let outcome = 'continue';
        for (let i = 0; i < 400 && outcome !== 'complete'; i++) {
            outcome = await sup.tick();
            const s = readJournal(repo, 'main').state!;
            const live = Object.values(s.jobs).some((j) => ['received', 'spawn-intent', 'claimed', 'running'].includes(j.executionState));
            if (outcome === 'continue' && live) sawContinueWithLiveJob = true;   // drenaje ANTES de COMPLETE
            await new Promise((r) => setTimeout(r, 50));
        }
        expect(outcome).toBe('complete');
        expect(sawContinueWithLiveJob).toBe(true);
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        expect(typeof final.cycle.completedAt).toBe('string');
        expect(Object.values(final.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass')).toBe(true);
    });

    test('custodia: doble senial + indeterminate => tick custody, lock retenido, proceso intacto (R4.2b/R4.5)', async () => {  // verifies R4.2b
        initJournal(repo, 'main');
        beginGeneration(repo, 'main');
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 20000)'], process.cwd(), 'nCtl');
        let s = readJournal(repo, 'main').state!;
        activeGeneration(s)!.processRef = ref;
        s.controllerHeartbeatAt = new Date(Date.now() - 3600000).toISOString();   // heartbeat vencido hace 1h
        writeJournal(repo, 'main', s);
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), 'lock-del-loop');              // el loop lo tendria: NO debe borrarse
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', heartbeatTimeoutMs: 1, activityWindowMs: 50, tickMs: 20 };
        const sup = new Supervisor(repo, 'main', cfg, fakeSpawner);
        await sup.tick();                                       // primer tick: arranca el tracking de actividad
        await new Promise((r) => setTimeout(r, 150));           // actividad congelada > ventana
        const out = await sup.tick();
        expect(out).toBe('custody');
        const after = readJournal(repo, 'main').state!;
        expect(after.cycle.status).toBe('BLOCKED');
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);   // custodia NO libera el lock
        expect(child.killed).toBe(false);                              // y NO mato al controlador
        child.kill('SIGKILL');
    });

    test('runSupervisorLoop: bootstrap gen-1 con stub codex, COMPLETE => libera lock y termina su generacion (R4.1/R4.5/R2.4)', async () => {  // verifies R4.1
        initWatch(repo, 'main');
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, termGraceMs: 300, killGraceMs: 300 };
        const loop = runSupervisorLoop(repo, 'main', cfg, fakeSpawner);
        await until(() => {
            const r = readJournal(repo, 'main');
            return r.state !== null && activeGeneration(r.state) !== undefined && fs.existsSync(supervisorLockPath(repo));
        });
        const token = activeGeneration(readJournal(repo, 'main').state!)!.token;
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: token, idempotencyKey: 'e1',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        await loop;                                             // auto-exit tras COMPLETE
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);   // lock liberado
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        const gen = final.generations[0];
        // generacion propia terminada: cero procesos codex huerfanos (R2.4)
        const { refIsAlive } = require('../../../src/core/journal/process');
        expect(gen.processRef === undefined || !refIsAlive(gen.processRef)).toBe(true);
    });
});
