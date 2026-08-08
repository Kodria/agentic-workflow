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
import { computeFingerprint } from '../../../src/core/journal/fingerprint';

jest.setTimeout(60000);

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => {});
};

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function setupRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-loop-'));
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
    fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
    return repo;
}

function emitVerdict(repo: string, token: string, obligationId: string, verdictId: string): void {
    const argv = ['awm-review', obligationId];
    const fp = computeFingerprint(repo, argv, [], '.').fingerprint;
    emitRequest(repo, 'main', { kind: 'verdict', generationToken: token, idempotencyKey: verdictId,
        payload: { verdictId, obligationId, result: 'pass', detail: 'ok', fingerprint: fp, argv, paths: [], cwd: '.' } });
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
        // A bare extensionless file with a #!/bin/sh shebang only runs via the POSIX
        // kernel's own shebang interpretation -- Windows CreateProcess has no such
        // mechanism, so this stub would silently fail to spawn there (spawnStructured
        // uses shell:false, matching production). Node's spawn on win32 resolves a bare
        // command name through PATHEXT and transparently re-invokes a found .cmd through
        // cmd.exe, so writing a .cmd sibling makes the SAME 'codex' invocation resolve on
        // both platforms without touching any production code.
        fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        fs.writeFileSync(path.join(stubBin, 'codex.cmd'), '@echo off\r\n:loop\r\ntimeout /t 1 /nobreak >nul\r\ngoto loop\r\n');
        oldPath = process.env.PATH;
        process.env.PATH = `${stubBin}${path.delimiter}${process.env.PATH}`;
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
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v-sensors', kind: 'sensors' }], reviewObligations: [{ id: 'o-spec', kind: 'spec' }, { id: 'o-quality', kind: 'quality' }] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }, { id: 'cv-interlock', kind: 'interlock' }] } });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'setTimeout(()=>process.exit(0), 400)'], [], '.', { satisfies: 'v1' });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v-sensors' });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv-interlock' });
        emitVerdict(repo, 'g0', 'o-spec', 'verd-spec');
        emitVerdict(repo, 'g0', 'o-quality', 'verd-quality');
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

    test('tick verifica branch antes del launch y un ciclo COMPLETE no lanza otro controller', async () => {
        initWatch(repo, 'main');
        let calls = 0;
        const spy: WrapperSpawner = () => { calls++; };
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10 };
        const s = readJournal(repo, 'main').state!;
        s.cycle.status = 'COMPLETE';
        writeJournal(repo, 'main', s);
        expect(await new Supervisor(repo, 'main', cfg, spy).tick()).toBe('complete');
        expect(calls).toBe(0);

        const reset = readJournal(repo, 'main').state!;
        reset.cycle.status = 'IN_PROGRESS';
        writeJournal(repo, 'main', reset);
        git(repo, 'checkout', '-qb', 'otra');
        await expect(new Supervisor(repo, 'main', cfg, spy).tick()).rejects.toThrow(/rama|branch/i);
        expect(calls).toBe(0);
    });

    test('fallo de launch queda durable y entra en backoff sin tumbar el supervisor (R4.3)', async () => {
        initWatch(repo, 'main');
        beginGeneration(repo, 'main');
        let calls = 0;
        const failing: WrapperSpawner = () => { calls++; throw new Error('provider unavailable'); };
        const sup = new Supervisor(repo, 'main', { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10 }, failing);
        await expect(sup.tick()).resolves.toBe('continue');
        expect(calls).toBe(1);
        const intent = activeGeneration(readJournal(repo, 'main').state!)!;
        expect(intent.controllerJobId).toBeDefined();
        expect(intent.spawnNonce).toBeDefined();
        await expect(sup.tick()).resolves.toBe('continue');
        expect(calls).toBe(1); // primer backoff es 60 s: no hace hot-loop
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
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }, { id: 'cv2', kind: 'interlock' }, { id: 'cv3', kind: 'test' }, { id: 'cv4', kind: 'sensors' }] } });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv2' });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv3' });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv4' });
        await loop;                                             // auto-exit tras COMPLETE
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);   // lock liberado
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        const gen = final.generations[0];
        // generacion propia terminada: cero procesos codex huerfanos (R2.4)
        const { refIsAlive } = require('../../../src/core/journal/process');
        expect(gen.processRef === undefined || !refIsAlive(gen.processRef)).toBe(true);
    });

    test('reinicio tras crash entre beginGeneration y spawn recupera la misma generacion sin quedar wedged', async () => {
        initWatch(repo, 'main');
        const begun = beginGeneration(repo, 'main');               // crash simulado: intent durable, sin ProcessRef
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 25, reconcileGraceMs: 300,
            termGraceMs: 300, killGraceMs: 300 };
        const loop = runSupervisorLoop(repo, 'main', cfg, fakeSpawner);
        let recovered = false;
        try {
            await until(() => {
                const active = activeGeneration(readJournal(repo, 'main').state!);
                recovered = active?.token === begun.token && active.processRef !== undefined;
                return recovered;
            }, 1500);
        } catch { /* la asercion de abajo conserva un fallo limpio y permite apagar el loop */ }
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: begun.token, idempotencyKey: 'recover-plan',
            payload: { entity: 'cycle-plan', items: [{ id: 'r-qa', kind: 'qa' }, { id: 'r-interlock', kind: 'interlock' }, { id: 'r-test', kind: 'test' }, { id: 'r-sensors', kind: 'sensors' }] } });
        for (const item of ['r-qa', 'r-interlock', 'r-test', 'r-sensors']) {
            requestJob(repo, 'main', begun.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: item });
        }
        await loop;
        expect(recovered).toBe(true);
        expect(readJournal(repo, 'main').state!.generations).toHaveLength(1);
    });
});
