import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { runnerTick, WrapperSpawner } from '../../../src/commands/watch/runner';
import { decideStall } from '../../../src/commands/watch/generations';
import { initWatch } from '../../../src/commands/watch/init';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { computeGate, FingerprintNow } from '../../../src/commands/job/gate';
import { reconcileJobs } from '../../../src/commands/job/reconcile';
import { requestJob } from '../../../src/commands/job/request';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import { emitRequest } from '../../../src/core/journal/requests';
import { readJournal } from '../../../src/core/journal/store';
import { logsDir } from '../../../src/core/journal/paths';

jest.setTimeout(30000);

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => {});
};

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

async function until(fn: () => boolean, ms = 15000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('integracion supervisor + jobs', () => {
    let repo: string;
    let fpNow: FingerprintNow;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-int-'));
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
        initWatch(repo, 'main');   // gitignorea .awm ANTES del primer fingerprint
        fpNow = (argv, paths, cwd) => {
            try { return computeFingerprint(repo, argv, paths, cwd).fingerprint; } catch { return null; }
        };
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    async function drainJobs(): Promise<void> {
        await until(() => {
            runnerTick(repo, 'main', fakeSpawner, { reconcileGraceMs: 10000 });
            const s = readJournal(repo, 'main').state!;
            return Object.values(s.jobs).every((j) => !['received', 'spawn-intent', 'claimed', 'running'].includes(j.executionState));
        });
    }

    test('e2e in-process: request => supervisor ejecuta => resultado en journal, dedup por key (RNF-T.7, R4.4)', async () => {  // verifies R6
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.');
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.');   // misma key
        consumePendingRequests(repo, 'main', 'g1');
        await drainJobs();
        const s = readJournal(repo, 'main').state!;
        const jobs = Object.values(s.jobs);
        expect(jobs).toHaveLength(1);                       // get-or-create: un solo job (RNF-T.7)
        expect(jobs[0].executionState).toBe('exited');
        expect(jobs[0].verdict).toBe('pass');
    });

    test('job fallido ENLAZADO al plan bloquea el gate por adverse-verdict (R1.4c)', async () => {  // verifies R1.4c
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v-sensors', kind: 'sensors' }], reviewObligations: [] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        // job largo que FALLA, enlazado a v1 (bloqueador 5: el test v1 no enlazaba)
        requestJob(repo, 'main', 'g1', ['node', '-e', 'setTimeout(()=>process.exit(1), 1200)'], [], '.', { satisfies: 'v1' });
        consumePendingRequests(repo, 'main', 'g1');
        await drainJobs();                                   // sin timeout terminal: espera lo que dure (R3.5)
        const s = readJournal(repo, 'main').state!;
        const g = computeGate(s, false, fpNow);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'adverse-verdict' && /v1/.test(r.detail))).toBe(true);
        expect(g.reasons.some((r) => r.category === 'live-job')).toBe(false);   // pero SI termino
    });

    test('evidencia pass con arbol cambiado despues => stale-fingerprint, historica (RF-2.8)', async () => {  // verifies R6
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'cycle-plan', items: [
                { id: 'cv-qa', kind: 'qa' }, { id: 'cv-interlock', kind: 'interlock' },
                { id: 'cv-test', kind: 'test' }, { id: 'cv-sensors', kind: 'sensors' },
            ] } });
        for (const item of ['cv-qa', 'cv-interlock', 'cv-test', 'cv-sensors']) {
            requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: item });
        }
        consumePendingRequests(repo, 'main', 'g1');
        await drainJobs();
        expect(computeGate(readJournal(repo, 'main').state!, false, fpNow).pass).toBe(true);
        fs.writeFileSync(path.join(repo, 'f.txt'), 'CAMBIO');   // el arbol cambio tras la evidencia
        const g = computeGate(readJournal(repo, 'main').state!, false, fpNow);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
    });

    test('custodia: doble senial sin safe => custody-blocked, jamas kill (R4.2b)', () => {  // verifies R4.2b
        const d = decideStall({ heartbeatAgeMs: 999999, activityFrozenMs: 999999, safeToReplace: 'indeterminate' },
            { heartbeatTimeoutMs: 1, activityWindowMs: 1 });
        expect(d).toBe('custody-blocked');
    });

    test('interrupcion entre spawn-intent y claim: la matriz decide por claim, no re-spawnea a ciegas (R1.8)', () => {  // verifies R1.8
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.');
        consumePendingRequests(repo, 'main', 'g1');
        const s = readJournal(repo, 'main').state!;
        const jid = Object.keys(s.jobs)[0];
        s.jobs[jid].executionState = 'spawn-intent';         // crash simulado: intent persistido, spawn jamas ocurrio
        s.jobs[jid].spawnNonce = 'nunca-uso';
        const out = reconcileJobs(s, logsDir(repo, 'main'));
        expect(out.decisions[0].action).toBe('retry-same-intent');  // mismo nonce: el claim wx impide duplicar
    });
});
