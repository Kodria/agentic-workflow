import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { initWatch } from '../../../src/commands/watch/init';
import { readJournal, writeJournal } from '../../../src/core/journal/store';
import { validatePlanFile } from '../../../src/core/plan/validate';
import { captureSelfRef } from '../../../src/core/journal/process';
import * as eventStore from '../../../src/core/model-policy/event-store';
import * as localScope from '../../../src/core/model-policy/local-event-scope';
import { Supervisor, DEFAULT_SUPERVISOR_CONFIG, MAX_SENSOR_DEFERRALS, type DispatchAdmission } from '../../../src/commands/watch/supervisor';
import type { AdmissionReport } from '../../../src/core/admission';
import { recoverAdmissionCustody } from '../../../src/commands/watch/admission-recovery';
import { registerWatchCommand } from '../../../src/commands/watch';
import * as supervisorModule from '../../../src/commands/watch/supervisor';
import { routingEnvelope } from '../../helpers/routing-approval';

const DIGEST = 'a'.repeat(64);
const identity = { kind: 'native', version: '1.0.0', accountScopeDigest: DIGEST };
const input = { provider: 'codex', routingIdentity: identity, controllerAutonomy: 'approval-free' as const,
    generationToken: 'legacy-1', reason: 'Operador verificó currentness y recibos vigentes' };
const admitted: DispatchAdmission = async () => ({ state: 'admitted', planState: 'valid', executionMode: 'desatendido', journal: 'current', currentness: 'current', sensors: 'pass', diagnostics: [] });
const blocked = (code: string, currentness: 'unverifiable' | 'current', sensors: 'not-required' | 'not-certified'): DispatchAdmission =>
    async (): Promise<AdmissionReport> => ({ state: 'blocked', planState: 'valid', executionMode: 'desatendido', journal: 'not-required', currentness, sensors, diagnostics: [{ code, message: 'still blocked' }] });

describe('issue #196: admission custody recovery', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admission-recovery-'));
        execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
        execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'seed'], { cwd: repo });
        fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'plans', 'cycle.md'), fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v1/valid.md'), 'utf8'));
        fs.writeFileSync(path.join(repo, 'source.md'), '## Canonical source\nfixture source\n');
        initWatch(repo, 'main');
        const plan = validatePlanFile('plans/cycle.md', repo);
        if (plan.state !== 'valid') throw new Error('invalid fixture');
        const state = readJournal(repo, 'main').state!;
        state.schema = 2;
        state.planBinding = { path: 'plans/cycle.md', digest: plan.planDigest, schema: plan.schema, executionMode: 'desatendido', boundAt: new Date().toISOString() };
        state.generations.push({ n: 1, token: input.generationToken, state: 'terminated', launchedAt: new Date().toISOString(), provider: 'codex' });
        state.cycle.status = 'BLOCKED';
        state.cycle.blockedReason = 'admisión compacta desatendida bloqueada antes de dispatch: ADMISSION_CURRENTNESS_BLOCKED: Consumed contract currentness is unverifiable: registry:baseline.';
        writeJournal(repo, 'main', state);
        jest.spyOn(eventStore, 'readStoredEventReceipt').mockImplementation(runtime => ({ state: 'present', receipt: {
            schema: 'routing-capabilities/v2', runtime, binaryDigest: DIGEST, configDigest: DIGEST,
            recordedAt: new Date().toISOString(), claims: [],
        } as never }));
        jest.spyOn(localScope, 'queryLocalEventScope').mockImplementation(async (_cwd, target, kind) => ({ state: 'current', scope: {
            runtime: { target, kind, version: identity.version, accountScopeDigest: identity.accountScopeDigest },
            binaryDigest: DIGEST, configDigest: DIGEST,
        } as never }));
    });
    afterEach(() => { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); });

    test('legacy currentness custody resumes once with original reason, generation and nextAction retained', async () => {
        const original = readJournal(repo, 'main').state!;
        expect(await recoverAdmissionCustody(repo, 'main', input, admitted)).toBe('recovered');
        const result = readJournal(repo, 'main').state!;
        expect(result.cycle.status).toBe('IN_PROGRESS');
        expect(result.cycle.nextAction).toEqual(original.cycle.nextAction);
        expect(result.generations).toEqual(original.generations);
        expect(result.tasks).toEqual(original.tasks);
        expect(result.dispatches).toEqual(original.dispatches);
        expect(result.jobs).toEqual(original.jobs);
        expect(result).toHaveProperty('admissionRecoveries.0.blockedReason', original.cycle.blockedReason);
        expect(result).toHaveProperty('admissionRecoveries.0.generationToken', input.generationToken);
        const revision = result.revision;
        expect(await recoverAdmissionCustody(repo, 'main', input, admitted)).toBe('already-recovered');
        expect(readJournal(repo, 'main').state!.revision).toBe(revision);
    });

    test('persistent unverifiable currentness → custody without generation → explicit recovery → one launch', async () => {
        const initial = readJournal(repo, 'main').state!;
        initial.generations = [];
        initial.cycle.status = 'IN_PROGRESS';
        initial.cycle.blockedReason = undefined;
        writeJournal(repo, 'main', initial);
        let now = Date.now();
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, routingIdentity: identity, controllerAutonomy: 'approval-free' as const };
        const transient = blocked('ADMISSION_CURRENTNESS_BLOCKED', 'unverifiable', 'not-required');
        let spawns = 0;
        for (let i = 0; i < MAX_SENSOR_DEFERRALS + 1; i++) {
            const outcome = await new Supervisor(repo, 'main', cfg, () => { spawns++; }, undefined, transient, true).tick();
            expect(outcome).toBe(i < MAX_SENSOR_DEFERRALS ? 'continue' : 'custody');
            now += 5000;
        }
        const held = readJournal(repo, 'main').state!;
        expect(held.generations).toHaveLength(0);
        expect(held.tasks).toHaveLength(0);
        expect(spawns).toBe(0);
        expect(await recoverAdmissionCustody(repo, 'main', { ...input, generationToken: undefined }, admitted)).toBe('recovered');
        expect(await new Supervisor(repo, 'main', cfg, () => { spawns++; }, undefined, admitted, true).tick()).toBe('continue');
        const resumed = readJournal(repo, 'main').state!;
        expect(resumed.generations).toHaveLength(1);
        expect(resumed.cycle.nextAction).toEqual(held.cycle.nextAction);
        expect(resumed.jobs).toEqual({});
        expect(resumed.dispatches).toEqual([]);
        expect(spawns).toBeGreaterThan(0);
    });

    test('persistent currentness and sensor failures leave custody untouched', async () => {
        for (const [code, currentness, sensors] of [
            ['ADMISSION_CURRENTNESS_BLOCKED', 'unverifiable', 'not-required'],
            ['ADMISSION_SENSORS_BLOCKED', 'current', 'not-certified'],
        ] as const) {
            const revision = readJournal(repo, 'main').state!.revision;
            await expect(recoverAdmissionCustody(repo, 'main', input, blocked(code, currentness, sensors))).rejects.toThrow(/admisión|currentness|sensores/i);
            expect(readJournal(repo, 'main').state!.revision).toBe(revision);
        }
    });

    test('legacy recovery refuses a missing native receipt even when v1 plan admission says admitted', async () => {
        jest.spyOn(eventStore, 'readStoredEventReceipt').mockReturnValue({ state: 'absent' });
        const revision = readJournal(repo, 'main').state!.revision;
        await expect(recoverAdmissionCustody(repo, 'main', input, admitted)).rejects.toThrow(/recibo|receipt/i);
        expect(readJournal(repo, 'main').state!.revision).toBe(revision);
        expect(readJournal(repo, 'main').state!.cycle.status).toBe('BLOCKED');
    });

    test('sensor custody can recover only after sensors pass', async () => {
        const state = readJournal(repo, 'main').state!;
        state.cycle.blockedReason = 'admisión sensors no verificable tras 3 reintentos: ADMISSION_SENSORS_BLOCKED: not-certified';
        writeJournal(repo, 'main', state);
        await expect(recoverAdmissionCustody(repo, 'main', input, blocked('ADMISSION_SENSORS_BLOCKED', 'current', 'not-certified'))).rejects.toThrow();
        expect(readJournal(repo, 'main').state!.cycle.status).toBe('BLOCKED');
        expect(await recoverAdmissionCustody(repo, 'main', input, admitted)).toBe('recovered');
    });

    test.each([
        'runtime local no verificable: NATIVE_QUERY_FAILED',
        'runtime local cambió durante generacion admitida',
    ])('runtime custody %s recovers only after strict offline revalidation', async (reason) => {
        fs.writeFileSync(path.join(repo, 'plans', 'cycle.md'), fs.readFileSync(path.join(__dirname,
            '../../core/plan/fixtures/compact-slices-v2/valid.md'), 'utf8'));
        const v2Plan = validatePlanFile('plans/cycle.md', repo);
        if (v2Plan.state !== 'valid' || !v2Plan.executionDigest) throw new Error('invalid v2 recovery fixture');
        const state = readJournal(repo, 'main').state!;
        state.planBinding = { ...state.planBinding!, schema: v2Plan.schema, digest: v2Plan.planDigest,
            executionDigest: v2Plan.executionDigest, executionIdentitySchema: 'awm-plan-execution/v1' };
        state.cycle.blockedReason = reason;
        writeJournal(repo, 'main', state);
        const revision = readJournal(repo, 'main').state!.revision;
        await expect(recoverAdmissionCustody(repo, 'main', input, blocked('ADMISSION_SENSORS_BLOCKED', 'current', 'not-certified'))).rejects.toThrow();
        expect(readJournal(repo, 'main').state!.revision).toBe(revision);
        expect(await recoverAdmissionCustody(repo, 'main', input, admitted)).toBe('recovered');
        const recovered = readJournal(repo, 'main').state!;
        expect(recovered.cycle.status).toBe('IN_PROGRESS');
        expect(recovered.planBinding?.schema).toBe('compact-slices/v2');
        expect(recovered.admissionRecoveries?.at(-1)?.blockedReason).toBe(reason);
        expect(recovered.generations).toEqual(state.generations);
    });

    test('changed binding, active request problem, pending job and identity mismatch all fail closed', async () => {
        const check = async (mutate: (state: NonNullable<ReturnType<typeof readJournal>['state']>) => void, pattern: RegExp) => {
            const state = readJournal(repo, 'main').state!;
            mutate(state);
            writeJournal(repo, 'main', state);
            const revision = readJournal(repo, 'main').state!.revision;
            await expect(recoverAdmissionCustody(repo, 'main', input, admitted)).rejects.toThrow(pattern);
            expect(readJournal(repo, 'main').state!.revision).toBe(revision);
        };
        await check(state => { state.planBinding!.digest = DIGEST; }, /binding|plan/i);
        const validPlan = validatePlanFile('plans/cycle.md', repo);
        if (validPlan.state !== 'valid') throw new Error('fixture changed');
        const s1 = readJournal(repo, 'main').state!; s1.planBinding!.digest = validPlan.planDigest; writeJournal(repo, 'main', s1);
        await check(state => { state.requestProblems.push({ file: 'rejected', kind: 'rejected', detail: 'x', at: new Date().toISOString() }); }, /request/i);
        const s2 = readJournal(repo, 'main').state!; s2.requestProblems = []; writeJournal(repo, 'main', s2);
        await check(state => { state.jobs['J1'] = { id: 'J1', fingerprint: 'x', commandDigest: 'x', argv: ['true'], cwd: '.', paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing', phaseTimestamps: {} }; }, /job/i);
        const sJob = readJournal(repo, 'main').state!; sJob.jobs = {}; writeJournal(repo, 'main', sJob);
        await check(state => { state.routingAttempts = [{ schema: 'routing-attempt/v1', id: 'route-1',
            obligationId: 'S1-implementer', lineageId: 'S1', attempt: 1, envelope: routingEnvelope,
            envelopeDigest: 'e'.repeat(64), fingerprint: 'f'.repeat(64), state: 'active',
            nativeAgentId: 'native-child' }]; }, /nativ|routing|attempt|intento/i);
        const sRouting = readJournal(repo, 'main').state!; sRouting.routingAttempts = []; writeJournal(repo, 'main', sRouting);
        await check(state => { state.routingAttempts = [{ schema: 'routing-attempt/v1', id: 'route-1',
            obligationId: 'S1-implementer', lineageId: 'S1', attempt: 1, envelope: routingEnvelope,
            envelopeDigest: 'e'.repeat(64), fingerprint: 'f'.repeat(64), state: 'reserved' }];
        state.dispatches.push({ id: 'linked', taskId: 'S1', at: new Date().toISOString(),
            routingAttemptId: 'route-1', dispatchRequestId: 'linked-ack' }); }, /nativ|routing|attempt|intento|dispatch/i);
        const sPendingChild = readJournal(repo, 'main').state!;
        sPendingChild.routingAttempts = []; sPendingChild.dispatches = []; writeJournal(repo, 'main', sPendingChild);
        await check(state => { state.generations[0].processRef = captureSelfRef('recovery-test'); }, /controller/i);
        const sController = readJournal(repo, 'main').state!; sController.generations[0].processRef = undefined; writeJournal(repo, 'main', sController);
        await check(state => { state.generations[0].provider = 'claude-code'; }, /provider|identidad/i);
        const s3 = readJournal(repo, 'main').state!; s3.generations[0].provider = 'codex'; writeJournal(repo, 'main', s3);
        await expect(recoverAdmissionCustody(repo, 'main', { ...input, routingIdentity: { ...identity, accountScopeDigest: 'bad' } }, admitted)).rejects.toThrow(/runtime|digest/i);
    });

    test('an independent missing required verifier keeps the cycle BLOCKED', async () => {
        const state = readJournal(repo, 'main').state!;
        state.requiredVerifiers = ['test'];
        state.tasks.push({ id: 'S1', title: 'complete claim', status: 'done', attempts: 1, verificationPlan: [], reviewObligations: [] });
        writeJournal(repo, 'main', state);
        const revision = readJournal(repo, 'main').state!.revision;
        await expect(recoverAdmissionCustody(repo, 'main', input, admitted)).rejects.toThrow(/verificador|required/i);
        expect(readJournal(repo, 'main').state!.revision).toBe(revision);
        expect(readJournal(repo, 'main').state!.cycle.status).toBe('BLOCKED');
    });

    test('a long-lived cycle can recover again after 128 prior audited decisions', async () => {
        const state = readJournal(repo, 'main').state!;
        state.admissionRecoveries = Array.from({ length: 128 }, (_, index) => ({
            at: new Date().toISOString(), reason: `prior-${index}`, blockedReason: state.cycle.blockedReason!,
            generationToken: input.generationToken, context: { provider: 'codex', runtime: identity, controllerAutonomy: 'approval-free' },
            planDigest: state.planBinding!.digest, assertion: 'legacy-operator-asserted' as const,
        }));
        writeJournal(repo, 'main', state);
        expect(await recoverAdmissionCustody(repo, 'main', input, admitted)).toBe('recovered');
        expect(readJournal(repo, 'main').state!.admissionRecoveries).toHaveLength(129);
    });

    test('after audited recovery supervisor still rechecks admission before any dispatch', async () => {
        await recoverAdmissionCustody(repo, 'main', input, admitted);
        let spawns = 0;
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', routingIdentity: identity, controllerAutonomy: 'approval-free' as const };
        const sup = new Supervisor(repo, 'main', cfg, () => { spawns++; }, undefined,
            blocked('ADMISSION_CURRENTNESS_BLOCKED', 'unverifiable', 'not-required'));
        expect(await sup.tick()).toBe('continue');
        expect(spawns).toBe(0);
        expect(readJournal(repo, 'main').state!.tasks).toHaveLength(0);
        expect(readJournal(repo, 'main').state!.cycle.nextAction?.actionId).toBe('bootstrap-cycle');
    });

    test('public watch recover-admission CLI records one offline transition', async () => {
        const before = readJournal(repo, 'main').state!;
        before.tasks.push({ id: 'S1', title: 'pending work', status: 'pending', attempts: 0, verificationPlan: [], reviewObligations: [] });
        writeJournal(repo, 'main', before);
        jest.spyOn(supervisorModule, 'admissionForConfig').mockReturnValue(admitted);
        const cwd = jest.spyOn(process, 'cwd').mockReturnValue(repo);
        const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const program = new Command();
        program.exitOverride();
        registerWatchCommand(program);
        try {
            await program.parseAsync(['node', 'awm', 'watch', 'recover-admission',
                '--provider', 'codex', '--runtime-kind', identity.kind, '--runtime-version', identity.version,
                '--account-scope-digest', identity.accountScopeDigest, '--controller-autonomy', 'approval-free',
                '--generation', input.generationToken, '--reason', input.reason]);
            expect(readJournal(repo, 'main').state!.cycle.status).toBe('IN_PROGRESS');
            expect(stdout.mock.calls.map(call => String(call[0])).join('')).toContain('"recovered":true');
            let spawned = 0;
            const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', routingIdentity: identity, controllerAutonomy: 'approval-free' as const };
            const outcome = await new Supervisor(repo, 'main', cfg, () => { spawned++; }, undefined, admitted, true).tick();
            expect({ outcome, blockedReason: readJournal(repo, 'main').state!.cycle.blockedReason }).toEqual({ outcome: 'continue', blockedReason: undefined });
            const resumed = readJournal(repo, 'main').state!;
            expect(resumed.tasks.map(task => task.id)).toEqual(['S1']);
            expect(resumed.jobs).toEqual({});
            expect(resumed.dispatches).toEqual([]);
            expect(resumed.cycle.nextAction?.actionId).toBe('bootstrap-cycle');
            expect(resumed.generations).toHaveLength(2);
            expect(spawned).toBeGreaterThan(0);
        } finally {
            cwd.mockRestore(); stdout.mockRestore();
        }
    });

    test('CLI requires provider to be asserted, not inherited from the watch default', async () => {
        const cwd = jest.spyOn(process, 'cwd').mockReturnValue(repo);
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const program = new Command();
        registerWatchCommand(program);
        try {
            await program.parseAsync(['node', 'awm', 'watch', 'recover-admission',
                '--runtime-kind', identity.kind, '--runtime-version', identity.version,
                '--account-scope-digest', identity.accountScopeDigest, '--controller-autonomy', 'approval-free',
                '--generation', input.generationToken, '--reason', input.reason]);
            expect(stderr.mock.calls.map(call => String(call[0])).join('')).toMatch(/--provider/);
            expect(readJournal(repo, 'main').state!.cycle.status).toBe('BLOCKED');
        } finally {
            cwd.mockRestore(); stderr.mockRestore(); process.exitCode = 0;
        }
    });
});
