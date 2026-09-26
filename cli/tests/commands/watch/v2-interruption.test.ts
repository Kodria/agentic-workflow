import { emptyState, isWellFormedState, type JournalState } from '../../../src/core/journal/types';
import { inspectHistoricalV2Rollouts, retireInterruptedV2Attempt } from '../../../src/commands/watch/v2-interruption';
import { routingApproval, routingEnvelope } from '../../helpers/routing-approval';
import { reserveRoutingAttempt } from '../../../src/core/model-policy/journal';
import { applyRequestToState } from '../../../src/commands/watch/apply';
import fs from 'fs';
import os from 'os';
import path from 'path';

function fixture(): JournalState {
    const s = emptyState('main');
    s.schema = 2;
    s.planBinding = { path: 'plans/cycle.md', digest: routingEnvelope.planDigest,
        executionDigest: routingEnvelope.executionDigest, executionIdentitySchema: 'awm-plan-execution/v1',
        schema: 'compact-slices/v2', executionMode: 'desatendido', boundAt: new Date().toISOString() };
    s.cycle.status = 'BLOCKED';
    s.cycle.blockedReason = 'doble senial de stall sin safeToReplace positivo del adapter (R4.2b)';
    s.tasks.push({ id: 'S1', title: 'S1', status: 'in-progress', attempts: 1, verificationPlan: [], reviewObligations: [] });
    s.routingAttempts = [{ schema: 'routing-attempt/v1', id: 'route-1', obligationId: 'S1:implementer',
        lineageId: 'S1:implementer:1', attempt: 1, envelope: routingEnvelope,
        envelopeDigest: 'e'.repeat(64), fingerprint: 'f'.repeat(64), state: 'active',
        reservedAt: new Date().toISOString(), reservationRequestId: 'reserve-1', nativeEvidenceRequired: true,
        nativeAgentId: 'child-1', nativeEventDigest: 'a'.repeat(64), observed: routingEnvelope.resolved }];
    s.appliedRequests['reserve-1'] = { requestId: 'reserve-1', idempotencyKey: 'r', payloadDigest: 'b'.repeat(64), outcome: 'applied', resultRef: 'route-1' };
    s.appliedRequests['dispatch-1'] = { requestId: 'dispatch-1', idempotencyKey: 'd', payloadDigest: 'c'.repeat(64), outcome: 'applied', resultRef: 'linked-1' };
    s.dispatches.push({ id: 'linked-1', taskId: 'S1', routingAttemptId: 'route-1', dispatchRequestId: 'dispatch-1', at: new Date().toISOString() });
    s.jobs['job-1'] = { id: 'job-1', fingerprint: '9'.repeat(64), commandDigest: 'd', argv: ['true'], cwd: '.', paths: [],
        expandedPaths: [], executionState: 'received', observationState: 'progressing', phaseTimestamps: { received: new Date().toISOString() } };
    return s;
}

const input = { attemptId: 'route-1', nativeAgentId: 'child-1', parentThreadId: 'parent-1',
    dispatchId: 'linked-1', jobId: 'job-1', jobFingerprint: '9'.repeat(64),
    planDigest: routingEnvelope.planDigest, executionDigest: routingEnvelope.executionDigest,
    policyDigest: routingEnvelope.policyDigest, capabilityDigest: routingEnvelope.capabilityDigest,
    generationToken: 'generation-1', evidenceDigest: '7'.repeat(64), reason: 'V2 native tree ended',
    at: '2026-09-25T21:00:00.000Z' };

describe('audited V2 interruption transition', () => {
    test('retires only the old attempt and never invents a job verdict', () => {
        const prior = fixture();
        expect(isWellFormedState(prior)).toBe(true);
        const { state, outcome } = retireInterruptedV2Attempt(prior, input);
        expect(outcome).toBe('recovered');
        expect(prior.routingAttempts![0].state).toBe('active');
        expect(state.routingAttempts![0]).toMatchObject({ state: 'interrupted', nativeAgentId: 'child-1',
            nativeEventDigest: 'a'.repeat(64), observed: routingEnvelope.resolved });
        expect(state.dispatches).toEqual(prior.dispatches);
        expect(state.appliedRequests).toEqual(prior.appliedRequests);
        expect(state.jobs['job-1']).toMatchObject({ executionState: 'cancelled', fingerprint: input.jobFingerprint });
        expect(state.jobs['job-1'].verdict).toBeUndefined();
        expect(state.cycle.status).toBe('IN_PROGRESS');
        expect(state.tasks[0].attempts).toBe(1);
        expect(isWellFormedState(state)).toBe(true);
        expect(retireInterruptedV2Attempt(state, input).outcome).toBe('already-recovered');
    });

    test.each(['wrong child', 'missing ack', 'claim', 'job drift', 'plan drift', 'second route'])(
        'fails closed on %s', scenario => {
            const s = fixture();
            if (scenario === 'wrong child') s.routingAttempts![0].nativeAgentId = 'other';
            if (scenario === 'missing ack') delete s.appliedRequests['dispatch-1'];
            if (scenario === 'claim') s.jobs['job-1'].spawnNonce = 'nonce';
            if (scenario === 'job drift') s.jobs['job-1'].fingerprint = '8'.repeat(64);
            if (scenario === 'plan drift') s.planBinding!.digest = '8'.repeat(64);
            if (scenario === 'second route') s.routingAttempts!.push({ ...s.routingAttempts![0], id: 'route-2', attempt: 2 });
            expect(() => retireInterruptedV2Attempt(s, input)).toThrow();
        },
    );

    test('only one fresh reservation and dispatch follows the interruption', () => {
        const recovered = retireInterruptedV2Attempt(fixture(), input).state;
        const reserve = () => reserveRoutingAttempt(recovered, { obligationId: 'S1:implementer',
            lineageId: 'S1:implementer:1', envelope: routingEnvelope, fingerprint: 'f'.repeat(64),
            approval: routingApproval }, '2026-09-25T21:00:01.000Z');
        const { state, attemptId } = reserve();
        expect(attemptId).not.toBe('route-1');
        expect(state.routingAttempts).toHaveLength(2);
        expect(state.routingAttempts![1].attempt).toBe(2);
        expect(state.routingAttempts![1].envelope.resolved).toEqual(recovered.routingAttempts![0].envelope.resolved);
        // Production reservation sets this from the current native event receipt.
        state.routingAttempts![1].nativeEvidenceRequired = true;
        state.routingAttempts![1].reservationRequestId = 'reserve-2';
        state.appliedRequests['reserve-2'] = { requestId: 'reserve-2', idempotencyKey: 'r2', payloadDigest: 'd'.repeat(64), outcome: 'applied', resultRef: attemptId };
        applyRequestToState(state, { kind: 'register-entity', requestId: 'dispatch-2', generationToken: 'generation-2',
            idempotencyKey: 'd2', payload: { entity: 'dispatch', dispatchId: 'linked-2', taskId: 'S1', routingAttemptId: attemptId } },
        'd'.repeat(64), process.cwd());
        expect(state.dispatches).toHaveLength(2);
        expect(state.tasks[0].attempts).toBe(2);
        expect(() => reserveRoutingAttempt(state, { obligationId: 'S1:implementer', lineageId: 'S1:implementer:1',
            envelope: { ...routingEnvelope, resolved: { ...routingEnvelope.resolved, selector: { kind: 'model', id: 'other' } } },
            fingerprint: 'a'.repeat(64), approval: routingApproval }, '2026-09-25T21:00:02.000Z')).toThrow();
    });

    test('native proof requires the V2 child continuation to be nonterminal and linked to its parent', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-v2-rollouts-'));
        try {
            const sessions = path.join(home, 'sessions', '2026', '09', '25');
            fs.mkdirSync(sessions, { recursive: true });
            const parent = path.join(sessions, 'parent.jsonl');
            const child = path.join(sessions, 'child.jsonl');
            const line = (type: string, payload: object) => JSON.stringify({ type, payload, timestamp: '2026-09-25T21:00:00.000Z' }) + '\n';
            fs.writeFileSync(parent, line('session_meta', { id: 'parent-1', cli_version: '0.156.1' })
                + line('turn_context', { model: 'gpt-6-sol', effort: 'high', multi_agent_version: 'v2' }));
            fs.writeFileSync(child, line('session_meta', { id: 'child-1', cli_version: '0.156.1',
                source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1' } } } })
                + line('event_msg', { type: 'task_started' })
                + line('turn_context', { model: 'm', effort: 'medium', multi_agent_version: 'v2' })
                + line('event_msg', { type: 'task_complete' })
                + line('event_msg', { type: 'task_started' })
                + line('turn_context', { model: 'm', effort: 'medium', multi_agent_version: 'v2' }));
            expect(inspectHistoricalV2Rollouts({ codexHome: home, parentRollout: parent, childRollout: child,
                parentThreadId: 'parent-1', childThreadId: 'child-1', cliVersion: '0.156.1',
                selection: routingEnvelope.resolved }).evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
            fs.appendFileSync(child, line('event_msg', { type: 'task_complete' }));
            expect(() => inspectHistoricalV2Rollouts({ codexHome: home, parentRollout: parent, childRollout: child,
                parentThreadId: 'parent-1', childThreadId: 'child-1', cliVersion: '0.156.1',
                selection: routingEnvelope.resolved })).toThrow(/terminal|unfinished/i);
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });
});
