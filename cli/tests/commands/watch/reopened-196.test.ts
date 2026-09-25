import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { Command } from 'commander';
import { applyRequestToState, consumePendingRequests } from '../../../src/commands/watch/apply';
import { beginGeneration, launchControllerGeneration } from '../../../src/commands/watch/generations';
import { emptyState, isWellFormedState, type JournalState } from '../../../src/core/journal/types';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { digestOf, emitRequest } from '../../../src/core/journal/requests';
import { requestJob } from '../../../src/commands/job/request';
import { initWatch } from '../../../src/commands/watch/init';
import { validatePlanFile } from '../../../src/core/plan/validate';
import { registerWatchCommand } from '../../../src/commands/watch';
import { Supervisor, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import * as supervisorModule from '../../../src/commands/watch/supervisor';
import * as generationModule from '../../../src/commands/watch/generations';
import * as adapterModule from '../../../src/core/journal/adapter';
import type { AdmissionReport } from '../../../src/core/admission';
import { admitRegistryPlan } from '../../../src/core/admission/registry-contracts';
import { routingEnvelope } from '../../helpers/routing-approval';
import { routingApproval } from '../../helpers/routing-approval';
import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { ensureMachineKey } from '../../../src/core/model-policy/machine-key';
import { signNativeRoutingProof } from '../../../src/core/model-policy/native-routing-proof';
import { selectionPolicyDigest } from '../../../src/core/model-policy/selection-policy-digest';
import { recoverAdmissionCustody } from '../../../src/commands/watch/admission-recovery';
import * as eventStore from '../../../src/core/model-policy/event-store';
import * as localScope from '../../../src/core/model-policy/local-event-scope';
import { claimPath } from '../../../src/commands/job/exec-wrapper';
import { logsDir, requestsDir, statePath } from '../../../src/core/journal/paths';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { captureSelfRef } from '../../../src/core/journal/process';

function v2State(): JournalState {
    const state = emptyState('main');
    state.schema = 2;
    state.planBinding = {
        path: 'plans/cycle.md', digest: routingEnvelope.planDigest,
        executionDigest: routingEnvelope.executionDigest, executionIdentitySchema: 'awm-plan-execution/v1', schema: 'compact-slices/v2',
        executionMode: 'desatendido', boundAt: new Date().toISOString(),
    };
    state.tasks.push({ id: 'S1', title: 'Implement S1', status: 'pending', attempts: 0,
        verificationPlan: [], reviewObligations: [] });
    state.routingAttempts = [{ schema: 'routing-attempt/v1', id: 'route-1', obligationId: 'S1-implementer',
        lineageId: 'lineage-S1', attempt: 1, envelope: routingEnvelope,
        envelopeDigest: 'e'.repeat(64), fingerprint: 'f'.repeat(64), state: 'reserved',
        reservedAt: new Date().toISOString(), reservationRequestId: 'reserve-1', nativeEvidenceRequired: true }];
    state.appliedRequests['reserve-1'] = { requestId: 'reserve-1', idempotencyKey: 'reserve-1',
        payloadDigest: 'd'.repeat(64), outcome: 'applied', resultRef: 'route-1' };
    return state;
}

function dispatch(state: JournalState, payload: Record<string, unknown>): void {
    applyRequestToState(state, { kind: 'register-entity', requestId: 'dispatch-request',
        generationToken: 'g1', idempotencyKey: 'dispatch-key', payload: { entity: 'dispatch',
            dispatchId: 'dispatch-S1', taskId: 'S1', ...payload } }, 'd'.repeat(64), process.cwd());
}

function legacyDispatchDigest(): string {
    return digestOf({ entity: 'dispatch', dispatchId: 'dispatch-S1', taskId: 'S1' });
}

function boundRepo(version: 'v1' | 'v2' = 'v1'): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-196-bound-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'seed'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'plans', 'cycle.md'), fs.readFileSync(path.join(__dirname, `../../core/plan/fixtures/compact-slices-${version}/valid.md`), 'utf8'));
    fs.writeFileSync(path.join(repo, 'source.md'), '## Canonical source\nfixture source\n');
    initWatch(repo, 'main');
    const plan = validatePlanFile('plans/cycle.md', repo);
    if (plan.state !== 'valid') throw new Error('invalid fixture');
    const state = readJournal(repo, 'main').state!;
    state.schema = 2;
    state.planBinding = { path: 'plans/cycle.md', digest: plan.planDigest, schema: plan.schema,
        ...(plan.executionDigest ? { executionDigest: plan.executionDigest, executionIdentitySchema: 'awm-plan-execution/v1' as const } : {}),
        executionMode: 'desatendido', boundAt: new Date().toISOString() };
    writeJournal(repo, 'main', state);
    return repo;
}

const admitted: AdmissionReport = { state: 'admitted', planState: 'valid', executionMode: 'desatendido',
    journal: 'current', currentness: 'current', sensors: 'pass', diagnostics: [] };
const redSensor: AdmissionReport = { state: 'blocked', planState: 'valid', executionMode: 'desatendido',
    journal: 'not-required', currentness: 'current', sensors: 'fail',
    diagnostics: [{ code: 'ADMISSION_SENSORS_BLOCKED', message: 'format fails during RED' }] };

describe('issue #196 reopened: supervised S1 handoff', () => {
    beforeAll(() => {
        // These tests execute the published CLI entrypoint, not only ts-jest
        // imports. Rebuild it so source regressions cannot hide behind dist.
        execFileSync('npm', ['run', 'build'], {
            cwd: path.resolve(__dirname, '../../../'), stdio: 'pipe',
            // Windows exposes npm as npm.cmd, which requires a shell to spawn.
            shell: process.platform === 'win32',
        });
    }, 30000);

    test('controller prompt fences only generation-mutating job verbs, not reconcile', () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-196-prompt-'));
        try {
            initJournal(repo, 'main');
            beginGeneration(repo, 'main');
            let argv: string[] = [];
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-next-action' },
                job => { argv = job.argv; });
            const prompt = argv.join(' ');
            expect(prompt).toContain('awm job reconcile');
            expect(prompt).toMatch(/reconcile[^\n]*sin --generation/);
            expect(prompt).toMatch(/awm job ack/);
            expect(prompt).toContain('--generation');
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('v2 dispatch requires an applied matching routing reservation before native launch', () => {
        const state = v2State();
        expect(() => dispatch(state, {})).toThrow(/routingAttemptId|routing/i);
        expect(state.dispatches).toHaveLength(0);
        expect(() => dispatch(state, { routingAttemptId: 'route-1' })).not.toThrow();
        expect(state.dispatches).toEqual([expect.objectContaining({ id: 'dispatch-S1', taskId: 'S1', routingAttemptId: 'route-1' })]);
        expect(state.tasks[0].attempts).toBe(1);
    });

    test('v2 dispatch rejects a reservation for another slice without recording work', () => {
        const state = v2State();
        state.routingAttempts![0].envelope = { ...routingEnvelope, sliceId: 'S2' };
        expect(() => dispatch(state, { routingAttemptId: 'route-1' })).toThrow(/slice|task|routing/i);
        expect(state.dispatches).toHaveLength(0);
        expect(state.tasks[0].attempts).toBe(0);
    });

    test('v2 dispatch rejects unknown, unapplied and wrong-plan reservations', () => {
        for (const scenario of ['unknown', 'unapplied', 'wrong-plan'] as const) {
            const state = v2State();
            if (scenario === 'unapplied') delete state.appliedRequests['reserve-1'];
            if (scenario === 'wrong-plan') state.routingAttempts![0].envelope = {
                ...routingEnvelope, planDigest: 'a'.repeat(64),
            };
            expect(() => dispatch(state, { routingAttemptId: scenario === 'unknown' ? 'missing' : 'route-1' }))
                .toThrow(/reservation|routing|plan|ack/i);
            expect(state.dispatches).toHaveLength(0);
            expect(state.tasks[0].attempts).toBe(0);
        }
    });

    test('replay with a different routing attempt cannot reuse a dispatch ID', () => {
        const state = v2State();
        dispatch(state, { routingAttemptId: 'route-1' });
        state.routingAttempts!.push({ ...state.routingAttempts![0], id: 'route-2', reservationRequestId: 'reserve-2', state: 'reserved' });
        state.appliedRequests['reserve-2'] = { requestId: 'reserve-2', idempotencyKey: 'reserve-2',
            payloadDigest: 'd'.repeat(64), outcome: 'applied', resultRef: 'route-2' };
        expect(() => dispatch(state, { routingAttemptId: 'route-2' })).toThrow(/conflict|dispatch/i);
        expect(state.dispatches).toHaveLength(1);
        expect(state.tasks[0].attempts).toBe(1);
    });

    test('9.12.2 unlinked S1 dispatch is preserved while a fresh routed dispatch gets its own real ACK', () => {
        const state = v2State();
        const oldAt = new Date(Date.parse(state.routingAttempts![0].reservedAt!) - 60_000).toISOString();
        state.dispatches.push({ id: 'dispatch-S1', taskId: 'S1', at: oldAt });
        state.tasks[0].attempts = 1;
        state.tasks[0].status = 'in-progress';
        state.jobs['completed-test'] = { id: 'completed-test', fingerprint: 'fixture', commandDigest: 'fixture',
            argv: ['true'], cwd: '.', paths: [], expandedPaths: [], executionState: 'exited',
            observationState: 'progressing', phaseTimestamps: { exited: new Date().toISOString() } };
        state.appliedRequests['old-dispatch-request'] = { requestId: 'old-dispatch-request',
            idempotencyKey: 'old-dispatch-key', payloadDigest: legacyDispatchDigest(), outcome: 'applied', resultRef: 'dispatch-S1' };
        state.appliedRequests['old-dispatch-retry'] = { ...state.appliedRequests['old-dispatch-request'], requestId: 'old-dispatch-retry' };
        const oldRecord = structuredClone(state.dispatches[0]);
        const oldAck = structuredClone(state.appliedRequests['old-dispatch-request']);
        const retryAck = structuredClone(state.appliedRequests['old-dispatch-retry']);
        dispatch(state, { routingAttemptId: 'route-1' });
        expect(state.dispatches[0]).toEqual(oldRecord);
        expect(state.appliedRequests['old-dispatch-request']).toEqual(oldAck);
        expect(state.appliedRequests['old-dispatch-retry']).toEqual(retryAck);
        expect(state.dispatches).toHaveLength(2);
        const linked = state.dispatches[1];
        expect(linked).toMatchObject({ taskId: 'S1', routingAttemptId: 'route-1', dispatchRequestId: 'dispatch-request' });
        expect(linked.id).not.toBe('dispatch-S1');
        expect(state.appliedRequests['dispatch-request']).toMatchObject({ outcome: 'applied', resultRef: linked.id });
        expect(state.tasks[0].attempts).toBe(1);
        expect(isWellFormedState(state)).toBe(true);
        dispatch(state, { routingAttemptId: 'route-1' });
        expect(state.dispatches).toHaveLength(2);
        expect(state.tasks[0].attempts).toBe(1);
        expect(() => applyRequestToState(state, { kind: 'register-entity', requestId: 'unrelated-dispatch-request',
            generationToken: 'g1', idempotencyKey: 'different-dispatch-key', payload: { entity: 'dispatch',
                dispatchId: 'dispatch-S1', taskId: 'S1', routingAttemptId: 'route-1' } }, 'd'.repeat(64), process.cwd()))
            .toThrow(/conflictivo/);
        expect(state.dispatches).toHaveLength(2);
    });

    test('historical unlinked S1 cannot be bypassed with a different requested dispatch ID', () => {
        const state = v2State();
        state.dispatches.push({ id: 'dispatch-S1', taskId: 'S1',
            at: new Date(Date.parse(state.routingAttempts![0].reservedAt!) - 60_000).toISOString() });
        state.tasks[0].status = 'in-progress';
        state.tasks[0].attempts = 1;
        state.appliedRequests['old-dispatch-request'] = { requestId: 'old-dispatch-request',
            idempotencyKey: 'old-dispatch-key', payloadDigest: legacyDispatchDigest(), outcome: 'applied', resultRef: 'dispatch-S1' };
        expect(() => dispatch(state, { dispatchId: 'new-S1', routingAttemptId: 'route-1' })).toThrow(/legacy|historical|conflict/i);
        expect(state.dispatches).toHaveLength(1);
        expect(state.tasks[0].attempts).toBe(1);
        expect(state.appliedRequests['dispatch-request']).toBeUndefined();
    });

    test('historical handoff requires a matching applied legacy dispatch ACK', () => {
        for (const ack of ['missing', 'unrelated', 'rejected'] as const) {
            const state = v2State();
            state.dispatches.push({ id: 'dispatch-S1', taskId: 'S1',
                at: new Date(Date.parse(state.routingAttempts![0].reservedAt!) - 60_000).toISOString() });
            state.tasks[0].status = 'in-progress';
            state.tasks[0].attempts = 1;
            if (ack !== 'missing') state.appliedRequests['old-dispatch-request'] = {
                requestId: 'old-dispatch-request', idempotencyKey: 'old-dispatch-key',
                payloadDigest: ack === 'unrelated' ? digestOf({ entity: 'task', taskId: 'S1' }) : legacyDispatchDigest(),
                outcome: ack === 'rejected' ? 'rejected-stale-generation' : 'applied', resultRef: 'dispatch-S1',
            };
            expect(() => dispatch(state, { routingAttemptId: 'route-1' })).toThrow(/legacy|historical|ACK|evidencia/i);
            expect(state.dispatches).toHaveLength(1);
            expect(state.appliedRequests['dispatch-request']).toBeUndefined();
        }
    });

    test('a failed linked handoff does not authorize another child without native ownership proof', () => {
        const state = v2State();
        state.dispatches.push({ id: 'dispatch-S1', taskId: 'S1',
            at: new Date(Date.parse(state.routingAttempts![0].reservedAt!) - 60_000).toISOString() });
        state.tasks[0].status = 'in-progress';
        state.tasks[0].attempts = 1;
        state.appliedRequests['old-dispatch-request'] = { requestId: 'old-dispatch-request',
            idempotencyKey: 'old-dispatch-key', payloadDigest: legacyDispatchDigest(), outcome: 'applied', resultRef: 'dispatch-S1' };
        dispatch(state, { routingAttemptId: 'route-1' });
        state.routingAttempts![0].state = 'blocked';
        state.routingAttempts![0].verdict = 'fail';
        state.routingAttempts!.push({ ...state.routingAttempts![0], id: 'route-2', state: 'reserved',
            verdict: undefined, reservationRequestId: 'reserve-2' });
        state.appliedRequests['reserve-2'] = { requestId: 'reserve-2', idempotencyKey: 'reserve-2',
            payloadDigest: 'd'.repeat(64), outcome: 'applied', resultRef: 'route-2' };
        expect(() => applyRequestToState(state, { kind: 'register-entity', requestId: 'dispatch-request-2',
            generationToken: 'g1', idempotencyKey: 'dispatch-key-2', payload: { entity: 'dispatch',
                dispatchId: 'dispatch-S1-retry', taskId: 'S1', routingAttemptId: 'route-2' } }, 'd'.repeat(64), process.cwd()))
            .toThrow(/historical|conflict/i);
        expect(state.dispatches).toHaveLength(2);
        expect(state.tasks[0].attempts).toBe(1);
        expect(state.appliedRequests['dispatch-request-2']).toBeUndefined();
        expect(isWellFormedState(state)).toBe(true);
    });

    test('legacy dispatch reconciliation refuses ambiguous or already-observed work', () => {
        for (const scenario of ['two-old-dispatches', 'observed', 'wrong-order', 'existing-job'] as const) {
            const state = v2State();
            state.dispatches.push({ id: 'dispatch-S1', taskId: 'S1',
                at: new Date(Date.parse(state.routingAttempts![0].reservedAt!) - 60_000).toISOString() });
            state.tasks[0].attempts = 1;
            state.appliedRequests['old-dispatch-request'] = { requestId: 'old-dispatch-request',
                idempotencyKey: 'old-dispatch-key', payloadDigest: legacyDispatchDigest(), outcome: 'applied', resultRef: 'dispatch-S1' };
            if (scenario === 'two-old-dispatches') state.dispatches.push({ id: 'other-old', taskId: 'S1', at: state.dispatches[0].at });
            if (scenario === 'observed') state.routingAttempts![0].nativeAgentId = 'native-child';
            if (scenario === 'wrong-order') state.dispatches[0].at = new Date(Date.parse(state.routingAttempts![0].reservedAt!) + 60_000).toISOString();
            if (scenario === 'existing-job') state.jobs['unreconciled'] = { id: 'unreconciled',
                fingerprint: 'fixture', commandDigest: 'fixture', argv: ['true'], cwd: '.', paths: [], expandedPaths: [],
                executionState: 'received', observationState: 'progressing', phaseTimestamps: {} };
            expect(() => dispatch(state, { routingAttemptId: 'route-1' })).toThrow();
            expect(state.dispatches.some(item => item.routingAttemptId === 'route-1')).toBe(false);
            expect(state.appliedRequests['dispatch-request']).toBeUndefined();
        }
    });

    test('an exact dispatch replay after native observation does not duplicate S1', () => {
        const state = v2State();
        dispatch(state, { routingAttemptId: 'route-1' });
        state.routingAttempts![0].state = 'active';
        expect(() => dispatch(state, { routingAttemptId: 'route-1' })).not.toThrow();
        expect(state.dispatches).toHaveLength(1);
        expect(state.tasks[0].attempts).toBe(1);
    });

    test('a reservation cannot create a second dispatch with a different ID', () => {
        const state = v2State();
        dispatch(state, { routingAttemptId: 'route-1' });
        expect(() => dispatch(state, { routingAttemptId: 'route-1', dispatchId: 'dispatch-S1-duplicate' }))
            .toThrow(/reservation|dispatch|routing/i);
        expect(state.dispatches).toHaveLength(1);
        expect(state.tasks[0].attempts).toBe(1);
    });

    test('a persisted v2 dispatch cannot point to a missing routing attempt', () => {
        const state = v2State();
        dispatch(state, { routingAttemptId: 'route-1' });
        expect(isWellFormedState(state)).toBe(true);
        state.dispatches[0].routingAttemptId = 'route-missing';
        expect(isWellFormedState(state)).toBe(false);
    });

    test('an unrelated applied ack cannot stand in for the routing reservation ack', () => {
        const state = v2State();
        delete state.appliedRequests['reserve-1'];
        state.appliedRequests['task-ack'] = { requestId: 'task-ack', idempotencyKey: 'task-ack',
            payloadDigest: 'd'.repeat(64), outcome: 'applied', resultRef: 'route-1' };
        expect(() => dispatch(state, { routingAttemptId: 'route-1' })).toThrow(/ack|reservation|routing/i);
        expect(state.dispatches).toHaveLength(0);
    });

    test('v2 implementer dispatch refuses a legacy receipt without native provenance', () => {
        const state = v2State();
        state.routingAttempts![0].nativeEvidenceRequired = undefined;
        expect(() => dispatch(state, { routingAttemptId: 'route-1' })).toThrow(/native|receipt|evidence/i);
        expect(state.dispatches).toHaveLength(0);
    });

    test('v2 native observation cannot precede an acknowledged dispatch', () => {
        const state = v2State();
        expect(() => applyRequestToState(state, { kind: 'routing-observe', requestId: 'observe-1', generationToken: 'g1',
            idempotencyKey: 'observe-1', payload: { attemptId: 'route-1', nativeAgentId: 'child-1',
                observed: routingEnvelope.resolved } }, 'd'.repeat(64), process.cwd())).toThrow(/dispatch|ack/i);
        expect(state.routingAttempts![0].state).toBe('reserved');
    });

    test('a linked dispatch with no task is not a valid journal', () => {
        const state = v2State();
        dispatch(state, { routingAttemptId: 'route-1' });
        expect(isWellFormedState(state)).toBe(true);
        state.tasks = [];
        expect(isWellFormedState(state)).toBe(false);
    });

    test('journal ACK map keys must name the same request as their values', () => {
        const state = v2State();
        state.appliedRequests['req-wrong'] = { requestId: 'req-other', idempotencyKey: 'alias',
            payloadDigest: 'd'.repeat(64), outcome: 'applied', resultRef: 'route-1' };
        expect(isWellFormedState(state)).toBe(false);
    });

    test('real CLI exposes exact pending and applied request ack without changing the journal', () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-196-ack-'));
        try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
            initJournal(repo, 'main');
            const emitted = emitRequest(repo, 'main', { kind: 'controller-heartbeat', generationToken: 'g1',
                idempotencyKey: 'heartbeat-1', payload: {} });
            const compiled = path.resolve(__dirname, '../../../dist/src/index.js');
            const run = (id: string) => spawnSync(process.execPath, [compiled, 'job', 'ack', id], {
                cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });
            const pending = run(emitted.requestId);
            expect(pending.status).toBe(0);
            expect(JSON.parse(pending.stdout)).toMatchObject({ state: 'pending', requestId: emitted.requestId });
            consumePendingRequests(repo, 'main', 'g1');
            const applied = run(emitted.requestId);
            expect(applied.status).toBe(0);
            expect(JSON.parse(applied.stdout)).toMatchObject({ state: 'applied', requestId: emitted.requestId });
            const unknown = run('req-unknown');
            expect(unknown.status).not.toBe(0);
            expect(JSON.parse(unknown.stdout)).toMatchObject({ state: 'unknown', requestId: 'req-unknown' });
            const rejectedRequest = emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1',
                idempotencyKey: 'bad-task', payload: { entity: 'task' } });
            consumePendingRequests(repo, 'main', 'g1');
            const rejected = run(rejectedRequest.requestId);
            expect(rejected.status).not.toBe(0);
            expect(JSON.parse(rejected.stdout)).toMatchObject({ state: 'rejected', requestId: rejectedRequest.requestId });
            const corruptRequest = emitRequest(repo, 'main', { kind: 'controller-heartbeat', generationToken: 'g1',
                idempotencyKey: 'bad-json', payload: {} });
            fs.writeFileSync(corruptRequest.file, '{malformed');
            expect(JSON.parse(run(corruptRequest.requestId).stdout)).toMatchObject({ state: 'unverifiable', requestId: corruptRequest.requestId });
            consumePendingRequests(repo, 'main', 'g1');
            expect(JSON.parse(run(corruptRequest.requestId).stdout)).toMatchObject({ state: 'unverifiable', requestId: corruptRequest.requestId });
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('ack reports an unsafe or absent request directory as unverifiable', () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-196-ack-dir-'));
        try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
            initJournal(repo, 'main');
            const dir = requestsDir(repo, 'main');
            const saved = `${dir}-saved`;
            fs.renameSync(dir, saved);
            const compiled = path.resolve(__dirname, '../../../dist/src/index.js');
            const run = () => spawnSync(process.execPath, [compiled, 'job', 'ack', 'req-absent'], {
                cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });
            const absent = run();
            expect(absent.status).not.toBe(0);
            expect(JSON.parse(absent.stdout)).toMatchObject({ state: 'unverifiable', reasonCode: 'request-directory' });
            fs.symlinkSync(saved, dir, 'dir');
            const linked = run();
            expect(linked.status).not.toBe(0);
            expect(JSON.parse(linked.stdout)).toMatchObject({ state: 'unverifiable', reasonCode: 'request-directory' });
            fs.unlinkSync(dir);
            fs.renameSync(saved, dir);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('an admitted launched generation does not reclassify RED sensor failure as pre-dispatch custody', async () => {
        const repo = boundRepo();
        try {
            let report = admitted;
            let admissions = 0;
            let spawns = 0;
            const sup = new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG, () => { spawns += 1; }, undefined,
                async () => { admissions += 1; return report; }, true);
            expect(await sup.tick()).toBe('continue');
            const launched = readJournal(repo, 'main').state!;
            expect(launched.generations).toHaveLength(1);
            expect(launched.generations[0].launchArgvDigest).toBeDefined();
            const gen = launched.generations[0];
            gen.processRef = { pid: process.pid, processGroup: process.pid, startTime: 'fixture',
                spawnNonce: gen.spawnNonce!, argvDigest: gen.launchArgvDigest!, psArgsDigest: 'b'.repeat(64) };
            writeJournal(repo, 'main', launched);
            const adapter = adapterModule.adapterFor('codex');
            jest.spyOn(adapterModule, 'adapterFor').mockReturnValue({ ...adapter,
                activity: () => ({ cpuTime: '0', groupSize: 1 }), safeToReplace: () => 'indeterminate' });
            fs.writeFileSync(path.join(repo, 's1-red.test.ts'), 'test("RED", () => { throw new Error("RED"); });\n');
            requestJob(repo, 'main', gen.token, [process.execPath, '-e', 'process.exit(0)'], [], '.');
            report = redSensor;
            expect(await sup.tick()).toBe('continue');
            const duringRed = readJournal(repo, 'main').state!;
            expect(duringRed.cycle.status).toBe('IN_PROGRESS');
            expect(duringRed.generations).toHaveLength(1);
            expect(admissions).toBe(1);
            expect(spawns).toBe(2); // one controller launch, then the pending job during RED
            expect(Object.keys(duringRed.jobs)).toHaveLength(1);
        } finally { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('controller admission reuses only an owned generation sensor pass, never a new generation', async () => {
        const repo = boundRepo();
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const state = readJournal(repo, 'main').state!;
            const generation = state.generations[0];
            const claim = claimPath(logsDir(repo, 'main'), generation.controllerJobId!, generation.spawnNonce!);
            fs.writeFileSync(claim, '{}');
            generation.wrapperRef = captureSelfRef(generation.spawnNonce!);
            state.admissionContext = { provider: 'codex', controllerAutonomy: 'approval-free' };
            writeJournal(repo, 'main', state);
            const sensorRun = jest.fn(async () => ({ sensors: [], overall: 'not_certified',
                projectRoot: repo, manifestPath: path.join(repo, '.awm', 'sensors.json'), mode: 'project-sensors' } as never));
            const admit = async (freshSensorsRequired = false) => admitRegistryPlan({
                plan: validatePlanFile('plans/cycle.md', repo), provider: 'codex', cwd: repo,
                executionMode: 'desatendido', planPath: 'plans/cycle.md', journalState: readJournal(repo, 'main').state,
                verifySensors: true, controllerAutonomy: 'approval-free',
                ...(freshSensorsRequired ? { freshSensorsRequired: true } : {}),
            }, { runSensors: sensorRun });
            const active = await admit();
            expect(active.state).toBe('admitted');
            expect(active).toHaveProperty('sensorEvidence', 'generation-bound');
            expect(sensorRun).not.toHaveBeenCalled();
            const replacement = await admit(true);
            expect(replacement).toMatchObject({ state: 'blocked', sensors: 'not-certified' });
            expect(sensorRun).toHaveBeenCalledTimes(1);
            const claimOnly = readJournal(repo, 'main').state!;
            claimOnly.generations[0].wrapperRef = undefined;
            writeJournal(repo, 'main', claimOnly);
            expect(await admit()).toMatchObject({ state: 'blocked', sensors: 'not-certified' });
            expect(sensorRun).toHaveBeenCalledTimes(2);
            const mismatched = readJournal(repo, 'main').state!;
            mismatched.generations[0].processRef = captureSelfRef('different-nonce');
            writeJournal(repo, 'main', mismatched);
            expect(await admit()).toMatchObject({ state: 'blocked', sensors: 'not-certified' });
            expect(sensorRun).toHaveBeenCalledTimes(3);
            fs.unlinkSync(claim);
            const unowned = await admit();
            expect(unowned).toMatchObject({ state: 'blocked', sensors: 'not-certified' });
            expect(sensorRun).toHaveBeenCalledTimes(4);
            const stale = readJournal(repo, 'main').state!;
            stale.generations[0].processRef = { pid: 99999997, processGroup: 99999997,
                startTime: 'Thu Sep 24 20:00:00 2026', spawnNonce: generation.spawnNonce!,
                argvDigest: generation.launchArgvDigest!, psArgsDigest: 'b'.repeat(64) };
            writeJournal(repo, 'main', stale);
            expect(await admit()).toMatchObject({ state: 'blocked', sensors: 'not-certified' });
            expect(sensorRun).toHaveBeenCalledTimes(5);
            beginGeneration(repo, 'main');
            const next = await admit();
            expect(next).toMatchObject({ state: 'blocked', sensors: 'not-certified' });
            expect(sensorRun).toHaveBeenCalledTimes(6);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('generation-bound sensor reuse rejects a changed live v2 runtime', async () => {
        const repo = boundRepo('v2');
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const state = readJournal(repo, 'main').state!;
            const generation = state.generations[0];
            fs.writeFileSync(claimPath(logsDir(repo, 'main'), generation.controllerJobId!, generation.spawnNonce!), '{}');
            generation.wrapperRef = captureSelfRef(generation.spawnNonce!);
            state.admissionContext = { provider: 'codex', controllerAutonomy: 'approval-free',
                runtime: { kind: 'native', version: '0.156.0', accountScopeDigest: 'a'.repeat(64) } };
            writeJournal(repo, 'main', state);
            const sensorRun = jest.fn(async () => ({ sensors: [], overall: 'not_certified' } as never));
            const report = await admitRegistryPlan({ plan: validatePlanFile('plans/cycle.md', repo),
                provider: 'codex', cwd: repo, executionMode: 'desatendido', planPath: 'plans/cycle.md',
                journalState: readJournal(repo, 'main').state, verifySensors: true, controllerAutonomy: 'approval-free',
            }, { runSensors: sensorRun, readRouting: async () => ({ runtime: { target: 'codex', kind: 'native',
                version: '0.157.0', accountScopeDigest: 'a'.repeat(64) } }) });
            expect(report.state).toBe('blocked');
            expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ADMISSION_GENERATION_RUNTIME_MISMATCH' })]));
            expect(sensorRun).not.toHaveBeenCalled();
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('active v2 controller admission reuses owned sensors while still checking routing evidence', async () => {
        const repo = boundRepo('v2');
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const state = readJournal(repo, 'main').state!;
            const generation = state.generations[0];
            fs.writeFileSync(claimPath(logsDir(repo, 'main'), generation.controllerJobId!, generation.spawnNonce!), '{}');
            generation.wrapperRef = captureSelfRef(generation.spawnNonce!);
            state.admissionContext = { provider: 'codex', controllerAutonomy: 'approval-free',
                runtime: { kind: routingEnvelope.runtime.kind, version: routingEnvelope.runtime.version,
                    accountScopeDigest: routingEnvelope.runtime.accountScopeDigest } };
            writeJournal(repo, 'main', state);
            const evidence = routingApproval();
            const sensorRun = jest.fn(async () => ({ sensors: [], overall: 'not_certified' } as never));
            const readRouting = jest.fn(async () => ({ runtime: routingEnvelope.runtime,
                policy: evidence.policy, capabilities: evidence.capabilities, now: evidence.checkedAt }));
            const report = await admitRegistryPlan({ plan: validatePlanFile('plans/cycle.md', repo),
                provider: 'codex', cwd: repo, executionMode: 'desatendido', planPath: 'plans/cycle.md',
                journalState: readJournal(repo, 'main').state, verifySensors: true, controllerAutonomy: 'approval-free',
            }, { runSensors: sensorRun, readRouting });
            expect(report).toMatchObject({ state: 'admitted', sensors: 'pass', sensorEvidence: 'generation-bound' });
            expect(sensorRun).not.toHaveBeenCalled();
            expect(readRouting).toHaveBeenCalledTimes(1);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('the same RED continuation applies to compact v2 with unchanged native scope', async () => {
        const repo = boundRepo('v2');
        try {
            const runtime = routingEnvelope.runtime;
            const scope = { runtime, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) };
            jest.spyOn(localScope, 'queryLocalEventScope').mockResolvedValue({ state: 'current', scope });
            jest.spyOn(eventStore, 'readStoredEventReceipt').mockReturnValue({ state: 'present', receipt: {
                schema: 'routing-capabilities/v2', ...scope, recordedAt: new Date().toISOString(), claims: [],
            } });
            let report = admitted; let admissions = 0;
            const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, routingIdentity: {
                kind: runtime.kind, version: runtime.version, accountScopeDigest: runtime.accountScopeDigest,
            }, controllerAutonomy: 'approval-free' as const };
            const sup = new Supervisor(repo, 'main', cfg, () => {}, undefined,
                async () => { admissions += 1; return report; }, true);
            expect(await sup.tick()).toBe('continue');
            const gen = readJournal(repo, 'main').state!.generations[0];
            fs.writeFileSync(claimPath(logsDir(repo, 'main'), gen.controllerJobId!, gen.spawnNonce!), '{}');
            report = redSensor;
            expect(await sup.tick()).toBe('continue');
            expect(readJournal(repo, 'main').state!.cycle.status).toBe('IN_PROGRESS');
            expect(admissions).toBe(1);
        } finally { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('a new generation still fails closed when sensors are red', async () => {
        const repo = boundRepo();
        try {
            let report = admitted;
            const sup = new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG, () => {}, undefined,
                async () => report, true);
            expect(await sup.tick()).toBe('continue');
            const state = readJournal(repo, 'main').state!;
            state.generations[0].state = 'terminated';
            writeJournal(repo, 'main', state);
            report = redSensor;
            expect(await sup.tick()).toBe('custody');
            expect(readJournal(repo, 'main').state!.generations).toHaveLength(1);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test.each(['unverified', 'throws'] as const)('an active v2 generation records an inconclusive local runtime query (%s) without claiming drift', async scenario => {
        const repo = boundRepo('v2');
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const gen = readJournal(repo, 'main').state!.generations[0];
            fs.writeFileSync(claimPath(logsDir(repo, 'main'), gen.controllerJobId!, gen.spawnNonce!), '{}');
            const query = jest.spyOn(localScope, 'queryLocalEventScope');
            if (scenario === 'throws') query.mockRejectedValue(new Error('permission denied while reading a private path'));
            else query.mockResolvedValue({ state: 'unverified', reason: 'NATIVE_QUERY_FAILED' });
            const expected = routingEnvelope.runtime;
            const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, routingIdentity: {
                kind: expected.kind, version: expected.version, accountScopeDigest: expected.accountScopeDigest,
            }, controllerAutonomy: 'approval-free' as const };
            let spawns = 0;
            expect(await new Supervisor(repo, 'main', cfg, () => { spawns++; }, undefined, async () => admitted, true).tick()).toBe('custody');
            const final = readJournal(repo, 'main').state!;
            expect(final.cycle.blockedReason).toBe('runtime local no verificable: NATIVE_QUERY_FAILED');
            expect(spawns).toBe(0);
        } finally { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('an active v2 generation refuses dispatch when local runtime identity drifts', async () => {
        const repo = boundRepo('v2');
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const gen = readJournal(repo, 'main').state!.generations[0];
            fs.writeFileSync(claimPath(logsDir(repo, 'main'), gen.controllerJobId!, gen.spawnNonce!), '{}');
            const expected = routingEnvelope.runtime;
            jest.spyOn(localScope, 'queryLocalEventScope').mockResolvedValue({ state: 'current', scope: {
                runtime: { ...expected, version: '99.0.0' }, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64),
            } });
            const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, routingIdentity: {
                kind: expected.kind, version: expected.version, accountScopeDigest: expected.accountScopeDigest,
            }, controllerAutonomy: 'approval-free' as const };
            expect(await new Supervisor(repo, 'main', cfg, () => {}, undefined, async () => admitted, true).tick()).toBe('custody');
            expect(readJournal(repo, 'main').state!.cycle.status).toBe('BLOCKED');
        } finally { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('crash before controller claim rechecks admission before retrying the launch', async () => {
        const repo = boundRepo();
        try {
            let attempts = 0;
            const spawn = () => { attempts += 1; throw new Error('launch offline'); };
            expect(await new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG, spawn, undefined,
                async () => admitted, true).tick()).toBe('continue');
            const intent = readJournal(repo, 'main').state!.generations[0];
            expect(intent.launchArgvDigest).toBeDefined();
            expect(intent.wrapperRef).toBeUndefined();
            expect(attempts).toBe(1);
            expect(await new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG, spawn, undefined,
                async () => redSensor, true).tick()).toBe('custody');
            expect(attempts).toBe(1);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('replacement after a stalled generation waits for fresh admission', async () => {
        const repo = boundRepo();
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const state = readJournal(repo, 'main').state!;
            state.generations[0].processRef = { pid: 99999999, processGroup: 99999999, startTime: 'Thu Sep 24 20:00:00 2026',
                spawnNonce: 'n', argvDigest: 'a'.repeat(64), psArgsDigest: 'b'.repeat(64) };
            state.controllerHeartbeatAt = new Date(Date.now() - 3600_000).toISOString();
            writeJournal(repo, 'main', state);
            requestJob(repo, 'main', state.generations[0].token, [process.execPath, '-e', 'process.exit(0)'], [], '.');
            const adapter = adapterModule.adapterFor('codex');
            jest.spyOn(adapterModule, 'adapterFor').mockReturnValue({ ...adapter, activity: () => null, safeToReplace: () => 'safe' });
            jest.spyOn(generationModule, 'resolveGeneration').mockResolvedValue('proven-dead');
            let admissions = 0;
            let jobSpawns = 0;
            const sup = new Supervisor(repo, 'main', { ...DEFAULT_SUPERVISOR_CONFIG, heartbeatTimeoutMs: 0, activityWindowMs: 0 },
                () => { jobSpawns += 1; }, undefined, async (request) => {
                    admissions += 1;
                    expect(request).toMatchObject({ freshSensorsRequired: true });
                    return { ...admitted, sensorEvidence: 'generation-bound' };
                }, true);
            expect(await sup.tick()).toBe('custody');
            expect(readJournal(repo, 'main').state!.generations).toHaveLength(1);
            expect(admissions).toBe(1);
            expect(jobSpawns).toBe(0);
        } finally { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('relaunch backoff does not start received jobs under the dead generation', async () => {
        const repo = boundRepo();
        try {
            beginGeneration(repo, 'main');
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => {});
            const state = readJournal(repo, 'main').state!;
            state.generations[0].processRef = { pid: 99999998, processGroup: 99999998, startTime: 'Thu Sep 24 20:00:00 2026',
                spawnNonce: 'n', argvDigest: 'a'.repeat(64), psArgsDigest: 'b'.repeat(64) };
            state.controllerHeartbeatAt = new Date().toISOString();
            writeJournal(repo, 'main', state);
            requestJob(repo, 'main', state.generations[0].token, [process.execPath, '-e', 'process.exit(0)'], [], '.');
            const adapter = adapterModule.adapterFor('codex');
            jest.spyOn(adapterModule, 'adapterFor').mockReturnValue({ ...adapter, activity: () => null, safeToReplace: () => 'safe' });
            jest.spyOn(generationModule, 'resolveGeneration').mockResolvedValue('proven-dead');
            let spawns = 0; let admissions = 0;
            const sup = new Supervisor(repo, 'main', { ...DEFAULT_SUPERVISOR_CONFIG, heartbeatTimeoutMs: 60_000, activityWindowMs: 0 },
                () => { spawns += 1; }, undefined, async () => { admissions += 1; return admitted; }, true);
            (sup as unknown as { relaunchNotBefore: number }).relaunchNotBefore = Date.now() + 60_000;
            expect(await sup.tick()).toBe('continue');
            expect(spawns).toBe(0);
            expect(admissions).toBe(0);
        } finally { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('failed initial controller launch cannot start received jobs during backoff', async () => {
        const repo = boundRepo();
        try {
            beginGeneration(repo, 'main');
            const token = readJournal(repo, 'main').state!.generations[0].token;
            requestJob(repo, 'main', token, [process.execPath, '-e', 'process.exit(0)'], [], '.');
            let jobSpawns = 0;
            const sup = new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG,
                () => { jobSpawns += 1; throw new Error('controller launch offline'); },
                undefined, async () => admitted, true);
            expect(await sup.tick()).toBe('continue');
            expect(jobSpawns).toBe(1); // failed controller launch only
            expect(readJournal(repo, 'main').state!.generations[0].processRef).toBeUndefined();
            expect(await sup.tick()).toBe('continue');
            expect(jobSpawns).toBe(1); // no controller retry and no job dispatch in backoff
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('unadopted controller wrapper cannot start received jobs', async () => {
        const repo = boundRepo();
        try {
            beginGeneration(repo, 'main');
            const token = readJournal(repo, 'main').state!.generations[0].token;
            requestJob(repo, 'main', token, [process.execPath, '-e', 'process.exit(0)'], [], '.');
            const wrapper = { pid: process.pid, processGroup: process.pid, startTime: 'Thu Sep 24 20:00:00 2026',
                spawnNonce: 'n', argvDigest: 'a'.repeat(64), psArgsDigest: 'b'.repeat(64) };
            launchControllerGeneration(repo, 'main', 'codex', { schema: 'controller-recovery/v1', kind: 'resume-cycle' }, () => wrapper);
            let jobSpawns = 0;
            const sup = new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG,
                () => { jobSpawns += 1; }, undefined, async () => admitted, true);
            expect(await sup.tick()).toBe('continue');
            expect(jobSpawns).toBe(0);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('watch CLI never announces COMPLETE when the loop stops with an in-progress journal', async () => {
        const repo = boundRepo();
        const originalCwd = process.cwd();
        const output: string[] = [];
        const write = jest.spyOn(process.stdout, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
        const loop = jest.spyOn(supervisorModule, 'runSupervisorLoop').mockResolvedValue('stopped' as never);
        try {
            process.chdir(repo);
            const program = new Command();
            registerWatchCommand(program);
            await program.parseAsync(['node', 'awm', 'watch']);
            expect(loop).toHaveBeenCalled();
            expect(output.join('')).not.toContain('COMPLETE');
            expect(output.join('')).toMatch(/IN_PROGRESS|detenido/i);
        } finally {
            process.chdir(originalCwd);
            write.mockRestore(); loop.mockRestore();
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    test('a frozen loop with a corrupt final journal exits nonzero', async () => {
        const repo = boundRepo();
        const previousCwd = process.cwd();
        const previousExitCode = process.exitCode;
        const output: string[] = [];
        const write = jest.spyOn(process.stdout, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
        const loop = jest.spyOn(supervisorModule, 'runSupervisorLoop').mockImplementation(async () => {
            fs.writeFileSync(statePath(repo, 'main'), '{corrupt');
            return 'frozen';
        });
        try {
            process.chdir(repo);
            const program = new Command();
            registerWatchCommand(program);
            await program.parseAsync(['node', 'awm', 'watch']);
            expect(process.exitCode).toBe(1);
            expect(output.join('')).not.toContain('gate verde');
            expect(output.join('')).not.toContain('COMPLETE');
        } finally {
            process.chdir(previousCwd); process.exitCode = previousExitCode;
            write.mockRestore(); loop.mockRestore();
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    (process.platform === 'win32' ? test.skip : test)('real SIGINT stops the loop without claiming COMPLETE', async () => {
        const repo = boundRepo();
        const compiled = path.resolve(__dirname, '../../../dist/src/commands/watch/supervisor.js');
        const script = `const s=require(${JSON.stringify(compiled)}); const report={state:'admitted',planState:'valid',executionMode:'desatendido',journal:'current',currentness:'current',sensors:'pass',diagnostics:[]}; process.on('newListener',function ready(event){if(event==='SIGINT'){process.removeListener('newListener',ready);setImmediate(()=>console.log('SIGINT_READY'))}}); s.runSupervisorLoop(process.cwd(),'main',{...s.DEFAULT_SUPERVISOR_CONFIG,tickMs:30},()=>{},undefined,async()=>report).then(out=>console.log(JSON.stringify({out}))).catch(e=>{console.error(e);process.exitCode=2})`;
        const child = spawn(process.execPath, ['-e', script], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        try {
            const deadline = Date.now() + 4000;
            // The lock is acquired just before the signal handler is installed.
            // Wait for the child's readiness marker to avoid killing it in that gap.
            while ((!fs.existsSync(supervisorLockPath(repo)) || !stdout.includes('SIGINT_READY')) && child.exitCode === null && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);
            expect(stdout).toContain('SIGINT_READY');
            child.kill('SIGINT');
            const exit = await new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
            expect(exit).toBe(0);
            expect(stdout).toContain('"out":"stopped"');
            expect(stdout).not.toContain('COMPLETE');
            expect(stderr).not.toContain('Error');
            expect(readJournal(repo, 'main').state!.cycle.status).toBe('IN_PROGRESS');
        } finally {
            if (child.exitCode === null) child.kill('SIGKILL');
            fs.rmSync(repo, { recursive: true, force: true });
        }
    }, 10000);

    (process.platform === 'win32' ? test.skip : test)('compiled watch CLI reports interrupted journal truthfully', async () => {
        const repo = boundRepo();
        const supervisor = path.resolve(__dirname, '../../../dist/src/commands/watch/supervisor.js');
        const index = path.resolve(__dirname, '../../../dist/src/index.js');
        const harness = `const s=require(${JSON.stringify(supervisor)}); const keep=setInterval(()=>{},1000); s.runSupervisorLoop=()=>new Promise(resolve=>process.on('SIGINT',()=>{clearInterval(keep);resolve('stopped')})); process.argv=[process.execPath,${JSON.stringify(index)},'watch']; require(${JSON.stringify(index)}).program.parseAsync(process.argv).catch(e=>{console.error(e);process.exitCode=2});`;
        const child = spawn(process.execPath, ['-e', harness], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        try {
            const deadline = Date.now() + 4000;
            while (!stdout.includes('supervisor activo') && child.exitCode === null && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            expect(stdout).toContain('supervisor activo');
            child.kill('SIGINT');
            const exit = await new Promise<number | null>(resolve => child.once('close', code => resolve(code)));
            expect(exit).toBe(130);
            expect(stdout).toMatch(/detenido; ciclo IN_PROGRESS/);
            expect(stdout).not.toContain('COMPLETE');
            expect(stderr).not.toContain('Error');
        } finally {
            if (child.exitCode === null) child.kill('SIGKILL');
            fs.rmSync(repo, { recursive: true, force: true });
        }
    }, 10000);

    test('recovered historical v2 S1 uses real CLI reservation, new dispatch ack, observation and one continuation', async () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-196-integral-'));
        const previousHome = process.env.AWM_HOME;
        const operator = path.join(repo, 'operator');
        try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
            execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'seed'], { cwd: repo });
            fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'plans', 'cycle.md'), fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v2/valid.md'), 'utf8'));
            fs.writeFileSync(path.join(repo, 'source.md'), '## Canonical source\nfixture source\n');
            const plan = validatePlanFile('plans/cycle.md', repo);
            if (plan.state !== 'valid' || !plan.executionDigest) throw new Error('invalid v2 fixture');
            initWatch(repo, 'main', { path: 'plans/cycle.md', report: plan });
            const blocked = readJournal(repo, 'main').state!;
            blocked.cycle.status = 'BLOCKED';
            blocked.cycle.blockedReason = 'admisión compacta desatendida bloqueada antes de dispatch: ADMISSION_CURRENTNESS_BLOCKED: registry:baseline unverifiable';
            writeJournal(repo, 'main', blocked);

            const runtime = routingEnvelope.runtime;
            const scope = { runtime, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) };
            jest.spyOn(eventStore, 'readStoredEventReceipt').mockReturnValue({ state: 'present', receipt: {
                schema: 'routing-capabilities/v2', ...scope, recordedAt: new Date().toISOString(), claims: [],
            } });
            jest.spyOn(localScope, 'queryLocalEventScope').mockResolvedValue({ state: 'current', scope });
            expect(await recoverAdmissionCustody(repo, 'main', { provider: 'codex',
                routingIdentity: { kind: runtime.kind, version: runtime.version, accountScopeDigest: runtime.accountScopeDigest },
                controllerAutonomy: 'approval-free', reason: 'Reverified local gates' }, async () => admitted)).toBe('recovered');
            expect(readJournal(repo, 'main').state!.cycle.status).toBe('IN_PROGRESS');
            jest.restoreAllMocks();
            const generation = beginGeneration(repo, 'main');

            fs.mkdirSync(operator);
            process.env.AWM_HOME = operator;
            const machineKey = ensureMachineKey(operator);
            const approval = routingApproval();
            approval.policy.content.mappings[0].degradation.allowMissingObservedIdentity = true;
            approval.policy.contentDigest = canonicalPolicyDigest(approval.policy.content);
            fs.writeFileSync(path.join(repo, '.awm', 'model-policy.json'), JSON.stringify(approval.policy));
            const enrolledAt = new Date(Date.now() - 1000).toISOString();
            const eventDigest = 'e'.repeat(64);
            const eventReceipt = { schema: 'routing-capabilities/v2' as const, ...scope, recordedAt: enrolledAt,
                claims: [{ selection: routingEnvelope.resolved,
                    mappingDigest: selectionPolicyDigest(approval.policy.content.mappings[0], routingEnvelope.resolved),
                    eventDigest, source: 'codex-turn-context' as const, observedAt: enrolledAt,
                    actualModel: 'unverified' as const, tokenUsage: 'unknown' as const }] };
            const receipt = path.join(operator, 'routing-capabilities-v2', 'codex', 'native.json');
            fs.mkdirSync(path.dirname(receipt), { recursive: true });
            const mac = createHmac('sha256', machineKey).update('AWM routing-capabilities/v2 local receipt\0')
                .update(JSON.stringify(eventReceipt)).digest('hex');
            fs.writeFileSync(receipt, JSON.stringify({ receipt: eventReceipt, mac }));
            const envelope = { ...routingEnvelope, planDigest: plan.planDigest, executionDigest: plan.executionDigest,
                policyDigest: approval.policy.contentDigest,
                capabilityDigest: createHash('sha256').update(JSON.stringify(eventReceipt)).digest('hex'),
                outcome: 'degraded' as const, unavailableEvidence: ['observedModelEvidence'] };
            const envelopeFile = path.join(repo, 'envelope.json');
            fs.writeFileSync(envelopeFile, JSON.stringify(envelope));
            const compiled = path.resolve(__dirname, '../../../dist/src/index.js');
            const cli = (...args: string[]) => {
                const result = spawnSync(process.execPath, [compiled, 'job', ...args], { cwd: repo, encoding: 'utf8',
                    env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' } });
                if (result.status !== 0) throw new Error(`CLI ${args.join(' ')}: ${result.stderr} ${result.stdout}`);
                return JSON.parse(result.stdout);
            };
            const task = cli('register', '--generation', generation.token, '--entity', 'task', '--json', JSON.stringify({
                taskId: 'S1', title: 'Implement S1', verificationPlan: [], reviewObligations: [],
            }));
            expect(cli('ack', task.requestId).state).toBe('pending');
            consumePendingRequests(repo, 'main', generation.token, scope);
            expect(readJournal(repo, 'main').state!.requestProblems).toEqual([]);
            expect(cli('ack', task.requestId).state).toBe('applied');

            // Durable 9.12.2 intent predates the route reservation. Neither
            // the record nor its old ACK may be rewritten to imply a child.
            const historical = readJournal(repo, 'main').state!;
            const historicalAt = new Date(Date.now() - 60_000).toISOString();
            historical.dispatches.push({ id: 'dispatch-S1', taskId: 'S1', at: historicalAt });
            historical.tasks[0].attempts = 1;
            historical.tasks[0].status = 'in-progress';
            historical.appliedRequests['old-dispatch-request'] = { requestId: 'old-dispatch-request',
                idempotencyKey: 'old-dispatch-key', payloadDigest: legacyDispatchDigest(), outcome: 'applied', resultRef: 'dispatch-S1' };
            writeJournal(repo, 'main', historical);

            const reserve = cli('routing-reserve', '--generation', generation.token, '--obligation', 'S1-implementer',
                '--lineage', 'lineage-S1', '--envelope-file', envelopeFile, '--fingerprint', 'f'.repeat(64));
            expect(cli('ack', reserve.requestId).state).toBe('pending');
            consumePendingRequests(repo, 'main', generation.token, scope);
            expect(readJournal(repo, 'main').state!.requestProblems).toEqual([]);
            const reservation = cli('ack', reserve.requestId);
            expect(reservation.state).toBe('applied');
            const attemptId: string = reservation.resultRef;
            const dispatchPayload = JSON.stringify({ dispatchId: 'dispatch-S1', taskId: 'S1', routingAttemptId: attemptId });
            const queuedDispatch = cli('register', '--generation', generation.token, '--entity', 'dispatch', '--json', dispatchPayload);
            expect(cli('ack', queuedDispatch.requestId).state).toBe('pending');
            expect(fs.existsSync(path.join(repo, 's1-red.test.ts'))).toBe(false);
            consumePendingRequests(repo, 'main', generation.token, scope);
            const routedAck = cli('ack', queuedDispatch.requestId);
            expect(routedAck.state).toBe('applied');
            expect(routedAck.resultRef).not.toBe('dispatch-S1');
            const worker = spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(path.join(repo, 's1-red.test.ts'))}, 'test("RED", () => { throw new Error("RED"); });\\n')`], {
                cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });
            expect(worker.status).toBe(0);
            expect(fs.existsSync(path.join(repo, 's1-red.test.ts'))).toBe(true);
            const proof = signNativeRoutingProof({ attemptId, nativeAgentId: 'native-child-1', source: 'codex-turn-context',
                eventDigest, observedAt: new Date().toISOString(), selection: envelope.resolved }, machineKey);
            const observation = emitRequest(repo, 'main', { kind: 'routing-observe', generationToken: generation.token,
                idempotencyKey: 'native-observation-S1', payload: { attemptId, nativeAgentId: 'native-child-1',
                    observed: envelope.resolved, nativeProof: proof } });
            consumePendingRequests(repo, 'main', generation.token, scope);
            expect(cli('ack', observation.requestId).state).toBe('applied');
            const replay = cli('register', '--generation', generation.token, '--entity', 'dispatch', '--json', dispatchPayload);
            consumePendingRequests(repo, 'main', generation.token, scope);
            expect(cli('ack', replay.requestId)).toMatchObject({ state: 'applied', resultRef: routedAck.resultRef });
            expect(cli('reconcile').nextAction).toBeTruthy();
            const unsupported = spawnSync(process.execPath, [compiled, 'job', 'reconcile', '--generation', generation.token], {
                cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });
            expect(unsupported.status).not.toBe(0);
            expect(unsupported.stderr).toMatch(/generation|unknown option/i);
            const final = readJournal(repo, 'main').state!;
            expect(final.tasks).toHaveLength(1);
            expect(final.dispatches).toHaveLength(2);
            expect(final.dispatches[0]).toEqual({ id: 'dispatch-S1', taskId: 'S1', at: historicalAt });
            expect(final.appliedRequests['old-dispatch-request']).toEqual(historical.appliedRequests['old-dispatch-request']);
            expect(final.dispatches[1]).toMatchObject({ id: routedAck.resultRef,
                taskId: 'S1', routingAttemptId: attemptId, dispatchRequestId: queuedDispatch.requestId });
            expect(final.routingAttempts).toHaveLength(1);
            expect(final.routingAttempts![0].state).toBe('active');
            expect(final.tasks[0].attempts).toBe(1);
            expect(Object.keys(final.jobs)).toHaveLength(0);
        } finally {
            jest.restoreAllMocks();
            if (previousHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previousHome;
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});
