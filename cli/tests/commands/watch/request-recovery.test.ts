import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { emitRequest } from '../../../src/core/journal/requests';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { computeGate } from '../../../src/commands/job/gate';
import { eventsPath, requestsDir } from '../../../src/core/journal/paths';
import { acquireLock, releaseLock } from '../../../src/commands/watch/lock';
import { recoverRejectedTask } from '../../../src/commands/watch/request-recovery';
import { recoveryWhitelistBlocker } from '../../../src/commands/watch/supervisor';
import { watchJournalStatus } from '../../../src/commands/watch/archive-unused';
import { enterCustody } from '../../../src/commands/watch/generations';

describe('issue #194: recovery of a rejected task request', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-recover-request-'));
        execFileSync('git', ['init', '-q', '-b', 'rama'], { cwd: repo });
        execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'seed'], { cwd: repo });
        initJournal(repo, 'rama');
        const state = readJournal(repo, 'rama').state!;
        state.schema = 2;
        state.planBinding = {
            path: 'docs/plans/cycle.md', digest: 'a'.repeat(64), schema: 'compact-slices/v1',
            executionMode: 'desatendido', boundAt: new Date().toISOString(),
        };
        state.requiredVerifiers = ['test', 'sensors'];
        state.generations.push({ n: 1, token: 'g1', state: 'active', launchedAt: new Date().toISOString() });
        state.cycle.status = 'BLOCKED';
        state.cycle.blockedReason = 'recovery no autorizado: hay conflictos durables de requests';
        writeJournal(repo, 'rama', state);
    });
    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    function rejectedTask() {
        const rejected = emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'bad-task',
            payload: { entity: 'task', taskId: 'S1', title: 'slice', verificationPlan: [{ id: 'test-s1', kind: 'test' }], reviewObligations: [] },
        });
        expect(consumePendingRequests(repo, 'rama', 'g1').rejectedInvalid).toBe(1);
        expect(fs.existsSync(`${rejected.file}.rejected`)).toBe(true);
        expect(fs.readFileSync(eventsPath(repo, 'rama'), 'utf8')).toMatch(/request-rejected-invalid/);
        return rejected;
    }

    function correctedTask(taskId = 'S1', kinds: Array<'test' | 'sensors'> = ['test', 'sensors']) {
        return emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: `corrected-${taskId}-${kinds.join('-')}`,
            payload: { entity: 'task', taskId, title: 'slice', verificationPlan: kinds.map(kind => ({ id: `${kind}-${taskId}`, kind })), reviewObligations: [] },
        });
    }

    test('rejection → corrected request → audited recovery → next action remains gated by real work', () => {
        const rejected = rejectedTask();
        const replacement = correctedTask();
        expect(computeGate(readJournal(repo, 'rama').state!, false, () => null).reasons.some(reason => reason.category === 'request-problem')).toBe(true);

        recoverRejectedTask(repo, 'rama', {
            rejectedRequestId: rejected.requestId, replacementRequestId: replacement.requestId,
            generationToken: 'g1', reason: 'corregido plan de verificación', resume: true,
        });

        const state = readJournal(repo, 'rama').state!;
        expect(state.tasks.map(task => task.id)).toEqual(['S1']);
        expect(state.appliedRequests[replacement.requestId]).toMatchObject({ outcome: 'applied', resultRef: 'S1' });
        expect(state.requestProblems[0]).toMatchObject({ kind: 'rejected', resolution: { replacementRequestId: replacement.requestId, generationToken: 'g1', reason: 'corregido plan de verificación' } });
        expect(state.cycle.status).toBe('IN_PROGRESS');
        expect(state.custodyDecisions).toEqual([expect.objectContaining({ decision: 'resume', generationToken: 'g1' })]);
        expect(fs.existsSync(`${rejected.file}.rejected`)).toBe(true);
        expect(fs.existsSync(replacement.file)).toBe(false);
        expect(fs.readFileSync(eventsPath(repo, 'rama'), 'utf8')).toMatch(/request-recovered/);
        const gate = computeGate(state, false, () => null);
        expect(gate.reasons.some(reason => reason.category === 'request-problem')).toBe(false);
        expect(gate.pass).toBe(false);
        expect(gate.reasons.some(reason => reason.category === 'pending-task')).toBe(true);

        recoverRejectedTask(repo, 'rama', {
            rejectedRequestId: rejected.requestId, replacementRequestId: replacement.requestId,
            generationToken: 'g1', reason: 'corregido plan de verificación', resume: true,
        });
        expect(readJournal(repo, 'rama').state!.tasks).toHaveLength(1);
        // Crash after state publication but before queue cleanup: supervisor
        // replay consumes the same request ID without registering S1 twice.
        fs.writeFileSync(replacement.file, JSON.stringify({ requestId: replacement.requestId,
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'corrected-S1-test-sensors',
            payload: { entity: 'task', taskId: 'S1', title: 'slice', verificationPlan: [
                { id: 'test-S1', kind: 'test' }, { id: 'sensors-S1', kind: 'sensors' }], reviewObligations: [] } }));
        expect(consumePendingRequests(repo, 'rama', 'g1').applied).toBe(0);
        expect(readJournal(repo, 'rama').state!.tasks).toHaveLength(1);
    });

    test('wrong task and still-invalid correction leave rejection active without partial writes', () => {
        const rejected = rejectedTask();
        const wrong = correctedTask('S2');
        expect(() => recoverRejectedTask(repo, 'rama', { rejectedRequestId: rejected.requestId, replacementRequestId: wrong.requestId, generationToken: 'g1', reason: 'wrong task', resume: true })).toThrow(/mismo taskId/);
        expect(readJournal(repo, 'rama').state!.requestProblems[0].resolution).toBeUndefined();
        fs.rmSync(wrong.file);
        const invalid = correctedTask('S1', ['test']);
        expect(() => recoverRejectedTask(repo, 'rama', { rejectedRequestId: rejected.requestId, replacementRequestId: invalid.requestId, generationToken: 'g1', reason: 'still invalid', resume: true })).toThrow(/sensors/);
        const state = readJournal(repo, 'rama').state!;
        expect(state.tasks).toHaveLength(0);
        expect(state.requestProblems[0].resolution).toBeUndefined();
        expect(state.cycle.status).toBe('BLOCKED');
    });

    test('stale generation, missing archive, and live supervisor lock cannot resolve a rejection', () => {
        const rejected = rejectedTask();
        const replacement = correctedTask();
        const input = { rejectedRequestId: rejected.requestId, replacementRequestId: replacement.requestId,
            generationToken: 'g1', reason: 'corregido', resume: true };
        expect(() => recoverRejectedTask(repo, 'rama', { ...input, generationToken: 'g0' })).toThrow(/generation/);
        const lock = acquireLock(repo);
        try { expect(() => recoverRejectedTask(repo, 'rama', input)).toThrow(/supervisor activo/); }
        finally { releaseLock(repo, lock); }
        fs.renameSync(`${rejected.file}.rejected`, `${rejected.file}.held`);
        expect(() => recoverRejectedTask(repo, 'rama', input)).toThrow();
        expect(readJournal(repo, 'rama').state!.requestProblems[0].resolution).toBeUndefined();
        expect(readJournal(repo, 'rama').state!.tasks).toHaveLength(0);
    });

    test('an unrelated active problem prevents --resume and leaves the correction queued', () => {
        const rejected = rejectedTask();
        const replacement = correctedTask();
        const state = readJournal(repo, 'rama').state!;
        state.requestProblems.push({ file: path.join(requestsDir(repo, 'rama'), 'other.json'), kind: 'corrupt', detail: 'bad envelope', at: new Date().toISOString() });
        writeJournal(repo, 'rama', state);
        expect(() => recoverRejectedTask(repo, 'rama', { rejectedRequestId: rejected.requestId,
            replacementRequestId: replacement.requestId, generationToken: 'g1', reason: 'corregido', resume: true })).toThrow(/todas las requests/);
        expect(fs.existsSync(replacement.file)).toBe(true);
        expect(readJournal(repo, 'rama').state!.tasks).toHaveLength(0);
    });

    test('a resolution-shaped state without an applied replacement is still an active gate problem', () => {
        rejectedTask();
        const state = readJournal(repo, 'rama').state!;
        state.requestProblems[0].resolution = { replacementRequestId: 'req-1-0000000000-deadbeef', replacementPayloadDigest: 'a'.repeat(64), reason: 'forged', generationToken: 'g1', at: new Date().toISOString() };
        writeJournal(repo, 'rama', state);
        expect(computeGate(readJournal(repo, 'rama').state!, false, () => null).reasons.some(reason => reason.category === 'request-problem')).toBe(true);
    });

    test('an unrelated applied task cannot be cited as the replacement of S1', () => {
        rejectedTask();
        const unrelated = correctedTask('S2');
        expect(consumePendingRequests(repo, 'rama', 'g1').applied).toBe(1);
        const state = readJournal(repo, 'rama').state!;
        state.requestProblems[0].resolution = { replacementRequestId: unrelated.requestId, replacementPayloadDigest: state.appliedRequests[unrelated.requestId].payloadDigest, reason: 'wrong link', generationToken: 'g1', at: new Date().toISOString() };
        writeJournal(repo, 'rama', state);
        expect(computeGate(readJournal(repo, 'rama').state!, false, () => null).reasons.some(reason => reason.category === 'request-problem')).toBe(true);
    });

    test('a corrupt request cannot be laundered through a task-shaped resolution', () => {
        const replacement = correctedTask('S1');
        expect(consumePendingRequests(repo, 'rama', 'g1').applied).toBe(1);
        const state = readJournal(repo, 'rama').state!;
        state.requestProblems.push({ file: path.join(requestsDir(repo, 'rama'), 'req-1-0000000000-deadbeef.json'),
            kind: 'corrupt', detail: 'bad JSON', at: new Date().toISOString(), requestId: 'req-1-0000000000-deadbeef',
            taskId: 'S1', generationToken: 'g1', resolution: { replacementRequestId: replacement.requestId,
                replacementPayloadDigest: state.appliedRequests[replacement.requestId].payloadDigest,
                reason: 'forged', generationToken: 'g1', at: new Date().toISOString() } });
        expect(() => writeJournal(repo, 'rama', state)).toThrow(/forma invalida/);
    });

    test('resume rejects a different custody cause even if its text mentions requests', () => {
        const rejected = rejectedTask();
        const replacement = correctedTask();
        const state = readJournal(repo, 'rama').state!;
        state.cycle.blockedReason = 'other failure; also mentions conflictos durables de requests';
        writeJournal(repo, 'rama', state);
        expect(() => recoverRejectedTask(repo, 'rama', { rejectedRequestId: rejected.requestId,
            replacementRequestId: replacement.requestId, generationToken: 'g1', reason: 'corrected', resume: true })).toThrow(/custodia BLOCKED por requests/);
        expect(readJournal(repo, 'rama').state!.tasks).toHaveLength(0);
    });

    test('a blocked request remains the specific custody cause across supervisor ticks', () => {
        rejectedTask();
        const state = readJournal(repo, 'rama').state!;
        expect(recoveryWhitelistBlocker(state)).toBe('hay conflictos durables de requests');
    });

    test('an independent custody cause is never overwritten by an active request problem', () => {
        rejectedTask();
        const state = readJournal(repo, 'rama').state!;
        state.cycle.blockedReason = 'veredicto de sensores no concluyente';
        writeJournal(repo, 'rama', state);
        expect(recoveryWhitelistBlocker(readJournal(repo, 'rama').state!)).toBe('el ciclo está bloqueado');
    });

    test('public journal status exposes the latest generation token after supervisor shutdown', () => {
        const state = readJournal(repo, 'rama').state!;
        state.generations[0].state = 'terminated';
        writeJournal(repo, 'rama', state);
        expect(watchJournalStatus(repo, 'rama')).toMatchObject({ latestGeneration: { n: 1, token: 'g1', state: 'terminated' } });
    });

    test('recovery without resume remains eligible for a later explicit resume', () => {
        const rejected = rejectedTask();
        const replacement = correctedTask();
        const input = { rejectedRequestId: rejected.requestId, replacementRequestId: replacement.requestId,
            generationToken: 'g1', reason: 'corregido', resume: false };
        recoverRejectedTask(repo, 'rama', input);
        const blocker = recoveryWhitelistBlocker(readJournal(repo, 'rama').state!);
        enterCustody(repo, 'rama', `recovery no autorizado: ${blocker}`);
        recoverRejectedTask(repo, 'rama', { ...input, resume: true });
        expect(readJournal(repo, 'rama').state!.cycle.status).toBe('IN_PROGRESS');
    });

    test('a correction from a newer generation cannot silently resolve the archived rejection', () => {
        const rejected = rejectedTask();
        const state = readJournal(repo, 'rama').state!;
        state.generations[0].state = 'superseded';
        state.generations.push({ n: 2, token: 'g2', state: 'active', launchedAt: new Date().toISOString() });
        writeJournal(repo, 'rama', state);
        const replacement = emitRequest(repo, 'rama', { kind: 'register-entity', generationToken: 'g2', idempotencyKey: 'corrected-g2',
            payload: { entity: 'task', taskId: 'S1', verificationPlan: [{ id: 't2', kind: 'test' }, { id: 's2', kind: 'sensors' }], reviewObligations: [] } });
        expect(() => recoverRejectedTask(repo, 'rama', { rejectedRequestId: rejected.requestId,
            replacementRequestId: replacement.requestId, generationToken: 'g2', reason: 'different generation', resume: true })).toThrow(/generation/);
        expect(readJournal(repo, 'rama').state!.requestProblems[0].resolution).toBeUndefined();
    });

    test('public watch recover-request command applies the correction under custody', () => {
        const rejected = rejectedTask();
        const replacement = correctedTask();
        const cli = path.resolve(__dirname, '../../../src/index.ts');
        const tsNode = require.resolve('ts-node/dist/bin.js');
        const output = execFileSync(process.execPath, [tsNode, '--compiler-options', '{"module":"CommonJS"}', cli, 'watch', 'recover-request',
            '--rejected', rejected.requestId, '--replacement', replacement.requestId,
            '--generation', 'g1', '--reason', 'operador verificó reemplazo', '--resume'],
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        expect(JSON.parse(output)).toMatchObject({ recovered: true, replacementRequestId: replacement.requestId });
        expect(readJournal(repo, 'rama').state!.cycle.status).toBe('IN_PROGRESS');
    });

    test('job register rejects missing sensors before writing a request file', () => {
        const cli = path.resolve(__dirname, '../../../src/index.ts');
        const tsNode = require.resolve('ts-node/dist/bin.js');
        const payload = JSON.stringify({ taskId: 'S1', verificationPlan: [{ id: 't1', kind: 'test' }], reviewObligations: [] });
        let diagnostic = '';
        try {
            execFileSync(process.execPath, [tsNode, '--compiler-options', '{"module":"CommonJS"}', cli,
                'job', 'register', '--generation', 'g1', '--entity', 'task', '--json', payload],
            { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            diagnostic = String((error as { stderr?: string }).stderr ?? '');
        }
        expect(diagnostic).toMatch(/verificationPlan.*sensors/);
        expect(fs.readdirSync(requestsDir(repo, 'rama')).filter(name => name.endsWith('.json'))).toHaveLength(0);
    });

    test('JSON cannot override --entity to bypass task prevalidation', () => {
        const cli = path.resolve(__dirname, '../../../src/index.ts');
        const tsNode = require.resolve('ts-node/dist/bin.js');
        const payload = JSON.stringify({ entity: 'task', taskId: 'S1', verificationPlan: [{ id: 't1', kind: 'test' }], reviewObligations: [] });
        let diagnostic = '';
        try {
            execFileSync(process.execPath, [tsNode, '--compiler-options', '{"module":"CommonJS"}', cli,
                'job', 'register', '--generation', 'g1', '--entity', 'cycle-plan', '--json', payload],
            { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) { diagnostic = String((error as { stderr?: string }).stderr ?? ''); }
        expect(diagnostic).toMatch(/entity.*coincidir/);
        expect(fs.readdirSync(requestsDir(repo, 'rama')).filter(name => name.endsWith('.json'))).toHaveLength(0);
    });
});
