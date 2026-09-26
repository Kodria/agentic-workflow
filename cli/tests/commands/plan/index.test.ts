import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import type { PlanValidationReport } from '../../../src/core/plan/types';
import { validatePlanFile } from '../../../src/core/plan/validate';
import { exitCodeFor, formatReport, registerPlanCommand } from '../../../src/commands/plan';
import type { AdmissionReport } from '../../../src/core/admission';
import { initWatch } from '../../../src/commands/watch/init';
import { providerFor } from '../../../src/providers';
import { renderArtifact, renderedFilename } from '../../../src/core/renderers/registry';
import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { capabilityReceiptDigest } from '../../../src/core/model-policy/capabilities';
import { reserveRoutingAttempt } from '../../../src/core/model-policy/journal';
import { emptyState, isRoutingEnvelope } from '../../../src/core/journal/types';
import { removeFixtureTree } from '../../helpers/fixture-cleanup';

const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

const repositoryRoot = path.resolve(__dirname, '../../../..');
const approved = validatePlanFile('docs/plans/2026-09-14-compact-only-bootstrap-plan.md', repositoryRoot);
if (approved.state !== 'valid') throw new Error(`tracked bootstrap plan must validate before command tests: ${approved.state}`);
const valid = approved;
const approvedV2 = validatePlanFile('valid.md', path.join(__dirname, '../../core/plan/fixtures/compact-slices-v2'));
if (approvedV2.state !== 'valid') throw new Error(`v2 fixture must validate before command tests: ${approvedV2.state}`);
const v2Valid = approvedV2;
const invalid: Extract<PlanValidationReport, { state: 'invalid' }> = {
    state: 'invalid', diagnostics: [{ code: 'PLAN_MARKERS', message: 'compact markers must occur once in order' }],
};
const unsupported: Extract<PlanValidationReport, { state: 'unsupported' }> = {
    state: 'unsupported', schema: 'compact-slices/v2', diagnostics: [{ code: 'PLAN_UNSUPPORTED_SCHEMA', message: 'unsupported compact plan schema; update the CLI' }],
};
const migration: Extract<PlanValidationReport, { state: 'migration-required' }> = { state: 'migration-required', reason: 'unmarked-plan' };

function commandFor(report: PlanValidationReport, calls: Array<[string, string]> = []): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    registerPlanCommand(program, {
        validatePlanFile: (planPath: string, cwd: string) => {
            calls.push([planPath, cwd]);
            return report;
        },
    });
    return program;
}

describe('plan validate Commander wiring', () => {
    const previousExitCode = process.exitCode;

    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    afterAll(() => {
        stdoutWrite.mockRestore();
        process.exitCode = previousExitCode;
    });

    it('requires an explicit dispatch header for strict new-plan validation', async () => {
        const program = commandFor(valid);
        await program.parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--cwd', repositoryRoot, '--require-dispatch-mode', '--json']);
        expect(JSON.parse(String(stdoutWrite.mock.calls.at(-1)![0]))).toMatchObject({ state: 'invalid', diagnostics: [{ code: 'PLAN_DISPATCH_MODE' }] });
        expect(process.exitCode).toBe(2);
    });

    it('returns v1 not-required before reading personal policy or capability state', async () => {
        const policy = jest.fn(); const capabilities = jest.fn(); const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, { validatePlanFile: () => valid, readEffectivePolicy: policy as any, readCapabilities: capabilities as any });
        await program.parseAsync(['node', 'awm', 'plan', 'resolve', 'plans/r4.md', '--provider', 'codex', '--runtime-kind', 'native', '--runtime-version', '1.0.0', '--account-scope-digest', 'a'.repeat(64), '--role', 'controller', '--json']);
        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toEqual({ state: 'not-required', reason: 'v1-without-opt-in' }); expect(policy).not.toHaveBeenCalled(); expect(capabilities).not.toHaveBeenCalled();
    });

    // The consumer reference says: call `plan resolve` for the exact role and
    // local slice, then send ITS frozen envelope to `job routing-reserve`. The
    // envelope was only ever built on the --lineage branch, which resolves the
    // lineage out of journal state — and lineages are created by
    // reserveRoutingAttempt, i.e. by routing-reserve itself. envelope <= lineage
    // <= reserve <= envelope, so the first attempt of any lineage could never be
    // reserved. This test goes from resolve output to a reserved attempt with no
    // hand-built envelope literal, which is the only shape that can catch it:
    // tests/commands/job/routing.test.ts passes a literal and so starts one step
    // past the gap.
    it('emits a reservable envelope on a first v2 attempt, closing the resolve to reserve path', async () => {
        // A genuinely validated report: the resolver rejects any object that did
        // not come out of validatePlanFile, so a spread-and-relabel fixture
        // cannot reach this path at all.
        const sliceId = 'S1';
        const sel = { selector: { kind: 'model' as const, id: 'gpt-5.6-luna' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const full = { selector: { kind: 'model' as const, id: 'gpt-5.6-sol' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const sha = 'a'.repeat(64);
        const content = { schema: 'model-policy/v1' as const, mappings: [{ target: 'codex' as const, runtimeKind: 'native', profiles: { mechanical: sel, integration: sel, judgment: sel }, fullCapability: full, degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } }], implementationBudget: { maxAttempts: 3 as const, escalation: ['mechanical', 'integration', 'judgment'] as ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] as ['medium', 'high'] } };
        const readEffectivePolicy = () => ({ state: 'approved' as const, provenance: 'user' as const, policy: { schema: 'approved-model-policy/v1' as const, content, contentDigest: canonicalPolicyDigest(content), approval: { approvedAt: '2026-09-19T00:00:00.000Z', approvalId: 'a1' }, lineage: { previousDigest: null } } });
        const receipt = {
            schema: 'routing-capabilities/v1' as const,
            runtime: { target: 'codex' as const, kind: 'native', version: '1.0.0', accountScopeDigest: sha },
            recordedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
            capabilities: { artifactDelivery: 'supported', interactiveExecution: 'supported', unattendedController: 'supported', nativeSubagents: 'supported', modelOverride: 'supported', effortOverride: 'supported', observedModelEvidence: 'supported', durableResume: 'unverified' } as never,
            availableSelections: [sel, full], runtimeDefaultSelection: full,
            evidence: (['modelOverride', 'effortOverride', 'observedModelEvidence', 'nativeSubagents', 'artifactDelivery', 'interactiveExecution', 'unattendedController'] as const).map(capability => ({ capability, kind: 'native-control' as const, receiptDigest: 'b'.repeat(64) })),
            approval: { approvalId: 'r1', snapshotDigest: 'c'.repeat(64) },
        };
        const readCapabilities = () => ({ state: 'current' as const, receipt, digest: capabilityReceiptDigest(receipt) });

        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, { validatePlanFile: () => v2Valid, readEffectivePolicy: readEffectivePolicy as never, readCapabilities: readCapabilities as never });
        await program.parseAsync(['node', 'awm', 'plan', 'resolve', 'plans/r4.md', '--provider', 'codex', '--runtime-kind', 'native', '--runtime-version', '1.0.0', '--account-scope-digest', sha, '--role', 'implementer', '--slice', sliceId, '--cwd', repositoryRoot, '--json']);

        const emitted = JSON.parse(String(stdoutWrite.mock.calls[stdoutWrite.mock.calls.length - 1][0]));
        expect(emitted.state).toBe('resolved');
        expect(emitted.envelope).toBeDefined();
        // The CLI must be the sole author: the envelope has to satisfy the same
        // predicate routing-reserve applies, with nothing filled in by the caller.
        expect(isRoutingEnvelope(emitted.envelope)).toBe(true);
        expect(emitted.envelope).toMatchObject({ schema: 'routing-envelope/v1', role: 'implementer', sliceId, requestedProfile: 'mechanical', effectiveProfile: 'mechanical', resolved: sel });
        expect(emitted.envelope.planDigest).toBe(v2Valid.planDigest);
        expect(emitted.envelope.executionDigest).toBe(v2Valid.executionDigest);

        // The point of the whole thing: that envelope reserves a first attempt,
        // which is what creates the lineage the escalation path later needs.
        const reserved = reserveRoutingAttempt(emptyState('main'), { obligationId: 'o1', lineageId: 'l1', envelope: emitted.envelope, fingerprint: 'e'.repeat(64), approval: () => ({ policy: readEffectivePolicy().policy, capabilities: receipt, checkedAt: new Date() }) }, '2026-09-19T00:00:00.000Z');
        expect(reserved.attemptId).toEqual(expect.any(String));
        expect(reserved.state.implementationLineages).toEqual([expect.objectContaining({ id: 'l1', sliceId, initialProfile: 'mechanical' })]);
    });

    it('emits deterministic human output for a valid compact plan', async () => {
        await commandFor(valid).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md']);

        expect(String(stdoutWrite.mock.calls[0][0])).toBe(
            'Plan validation: valid "plans/r4.md" (compact-slices/v1; 1 slices; 5 requirements; complete ownership)\n',
        );
        expect(process.exitCode).toBe(0);
    });

    it('emits one stable JSON object without an update banner', async () => {
        await commandFor(valid).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--json']);

        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toEqual({
            state: 'valid', path: 'plans/r4.md', schema: 'compact-slices/v1', planId: 'issue-126-compact-only-bootstrap',
            planDigest: valid.planDigest, requirements: 5, sources: 6, commands: 7, slices: 1, completeOwnership: true,
        });
        expect(String(stdoutWrite.mock.calls[0][0])).not.toContain('update');
    });

    it('emits deterministic migration-only human guidance and exit 2', async () => {
        await commandFor(migration).parseAsync(['node', 'awm', 'plan', 'validate', 'legacy.md']);

        expect(String(stdoutWrite.mock.calls[0][0])).toBe(
            'Plan validation: migration-required "legacy.md" (unmarked-plan)\nMigrate this plan to compact-slices/v1 before execution.\n',
        );
        expect(String(stdoutWrite.mock.calls[0][0])).not.toMatch(/full-quality|alternate|legacy path/i);
        expect(process.exitCode).toBe(2);
    });

    it('writes one stable migration JSON object before assigning exit 2', async () => {
        const observedExitCodes: unknown[] = [];
        stdoutWrite.mockImplementation(() => { observedExitCodes.push(process.exitCode); return true; });

        await commandFor(migration).parseAsync(['node', 'awm', 'plan', 'validate', 'legacy.md', '--json']);

        const output = String(stdoutWrite.mock.calls[0][0]);
        expect(output).toBe('{"state":"migration-required","path":"legacy.md","reason":"unmarked-plan"}\n');
        expect(JSON.parse(output)).toEqual({ state: 'migration-required', path: 'legacy.md', reason: 'unmarked-plan' });
        expect(output).not.toMatch(/full-quality|alternate|legacy path/i);
        expect(observedExitCodes).toEqual([undefined]);
        expect(process.exitCode).toBe(2);
    });

    it.each(['human', 'json'])('rejects a malformed injected migration report in %s mode before output', async (mode) => {
        const malformed = { state: 'migration-required' } as unknown as PlanValidationReport;
        const args = ['node', 'awm', 'plan', 'validate', 'unmarked.md', ...(mode === 'json' ? ['--json'] : [])];

        await expect(commandFor(malformed).parseAsync(args)).rejects.toThrow('plan validator returned an invalid migration reason');
        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('enforces migration-only output and exit 2 through the compiled CLI without mutating an unmarked plan', () => {
        const repoRoot = path.resolve(__dirname, '../../../..');
        const compiled = path.join(repoRoot, 'cli', 'dist', 'src', 'index.js');
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-unmarked-e2e-'));
        const plan = path.join(fixtureRoot, 'unmarked.md');
        const isolatedHome = path.join(fixtureRoot, 'home');
        fs.mkdirSync(isolatedHome);
        fs.writeFileSync(plan, '# Unmarked plan\n');
        const before = fs.readFileSync(plan);
        const environment = { ...process.env, HOME: isolatedHome, AWM_HOME: path.join(isolatedHome, '.awm') };
        try {
            expect(fs.existsSync(compiled)).toBe(true);
            const human = spawnSync(process.execPath, [compiled, 'plan', 'validate', 'unmarked.md', '--cwd', fixtureRoot], {
                cwd: repoRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            });
            const json = spawnSync(process.execPath, [compiled, 'plan', 'validate', 'unmarked.md', '--cwd', fixtureRoot, '--json'], {
                cwd: repoRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            });

            expect(human.status).toBe(2);
            expect(human.stdout).toBe('Plan validation: migration-required "unmarked.md" (unmarked-plan)\nMigrate this plan to compact-slices/v1 before execution.\n');
            expect(json.status).toBe(2);
            expect(JSON.parse(json.stdout)).toEqual({ state: 'migration-required', path: 'unmarked.md', reason: 'unmarked-plan' });
            expect(human.stdout + json.stdout).not.toMatch(/full-quality|alternate|legacy path/i);
            expect(fs.readFileSync(plan).equals(before)).toBe(true);
        } finally {
            removeFixtureTree(fixtureRoot);
        }
    });

    it.each([
        ['invalid', invalid],
        ['unsupported', unsupported],
    ] as const)('writes complete %s diagnostics before assigning semantic exit 2', async (state, report) => {
        const observedExitCodes: unknown[] = [];
        stdoutWrite.mockImplementation(() => {
            observedExitCodes.push(process.exitCode);
            return true;
        });

        await commandFor(report).parseAsync(['node', 'awm', 'plan', 'validate', 'broken.md', '--json']);

        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toMatchObject({ state, path: 'broken.md', diagnostics: report.diagnostics });
        expect(observedExitCodes).toEqual([undefined]);
        expect(process.exitCode).toBe(2);
    });

    it('passes an explicit cwd only to validation while retaining the original path text in output', async () => {
        const calls: Array<[string, string]> = [];
        await commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--cwd', 'fixture-root']);

        expect(calls).toEqual([['plans/r4.md', 'fixture-root']]);
        expect(String(stdoutWrite.mock.calls[0][0])).toContain('"plans/r4.md"');
    });

    it('rejects missing paths, extra arguments, and missing --cwd values before validation', async () => {
        const calls: Array<[string, string]> = [];
        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate'])).rejects.toThrow();
        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'one.md', 'two.md'])).rejects.toThrow();
        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'one.md', '--cwd', '--json'])).rejects.toThrow();
        expect(calls).toEqual([]);
    });

    it.each(['plans/escape\u001b.md', 'plans/tab\t.md'])('rejects control characters in the public plan path %j', async (planPath) => {
        const calls: Array<[string, string]> = [];

        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', planPath])).rejects.toThrow('plan path must be a non-empty path without control characters');
        expect(calls).toEqual([]);
    });

    it.each(['fixture\u001b-root', 'fixture\troot'])('rejects control characters in the public --cwd value %j', async (cwd) => {
        const calls: Array<[string, string]> = [];

        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--cwd', cwd])).rejects.toThrow('--cwd must be a non-empty path without control characters');
        expect(calls).toEqual([]);
    });

    it('does not emit terminal control characters in unsupported human output', () => {
        const report: PlanValidationReport = {
            state: 'unsupported', schema: 'compact-slices/v2\u001b[2J',
            diagnostics: [{ code: 'PLAN\tSCHEMA', message: 'unsafe\u001b[31m diagnostic', field: 'schema\r' }],
        };

        const output = formatReport(report, 'plans/unsafe\u001b.md');
        expect(output.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
        expect(output).toContain('compact-slices/v2\\u001b[2J');
    });

    it('suppresses the passive update notification only for root-program JSON validation', () => {
        const awmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-update-'));
        const repoRoot = path.resolve(__dirname, '../../../..');
        const indexPath = path.join(repoRoot, 'cli', 'src', 'index.ts');
        const registerPath = require.resolve('ts-node/register');
        fs.writeFileSync(path.join(awmHome, 'update-check.json'), JSON.stringify({ lastCheck: Date.now(), latest: '999.0.0' }));

        try {
            const result = spawnSync(process.execPath, ['-r', registerPath, indexPath, 'plan', 'validate', 'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md', '--cwd', repoRoot, '--json'], {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, AWM_HOME: awmHome, TS_NODE_PROJECT: path.join(repoRoot, 'cli', 'tsconfig.json') },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            expect(result.status).toBe(0);
            expect(() => JSON.parse(result.stdout)).not.toThrow();
            expect(JSON.parse(result.stdout)).toMatchObject({ state: 'valid', path: 'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md' });
            expect(result.stderr).toBe('');

            const humanResult = spawnSync(process.execPath, ['-r', registerPath, indexPath, 'plan', 'validate', 'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md', '--cwd', repoRoot], {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, AWM_HOME: awmHome, TS_NODE_PROJECT: path.join(repoRoot, 'cli', 'tsconfig.json') },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            expect(humanResult.status).toBe(0);
            expect(humanResult.stderr).toContain('awm v999.0.0 available');
        } finally {
            fs.rmSync(awmHome, { recursive: true, force: true });
        }
    });
});

describe('plan admit Commander wiring', () => {
    it('does not read v2 routing facts after currentness blocks', async () => {
        const policy = jest.fn(); const capabilities = jest.fn(); const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, { validatePlanFile: () => ({ ...valid, schema: 'compact-slices/v2', manifest: { ...valid.manifest, schema: 'compact-slices/v2', slices: valid.manifest.slices.map(slice => ({ ...slice, implementerProfile: 'mechanical' })) } } as any), readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }), readEffectivePolicy: policy as any, readCapabilities: capabilities as any, listRegistries: () => [], checkCurrentness: async () => ({ checkedAt: 'x', compatibility: { status: 'not-checked' }, components: [{ component: 'cli', installed: '1', latest: '2', channel: 'stable', source: 'x', checkedAt: 'x', status: 'stale', detail: 'x', remedy: 'x' }] }) });
        try { await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', repositoryRoot, '--require-current', '--runtime-kind', 'native', '--runtime-version', '1.0.0', '--account-scope-digest', 'a'.repeat(64), '--json']); expect(policy).not.toHaveBeenCalled(); expect(capabilities).not.toHaveBeenCalled(); }
        finally { output.mockRestore(); process.exitCode = undefined; }
    });
    it.each([
        ['invalid plan', invalid, 'codex', ['codex']],
        ['invalid provider', valid, 'not-a-provider', ['codex']],
        ['disabled provider', valid, 'codex', ['cursor']],
    ] as const)('does not read routing facts for %s even with complete runtime flags', async (_name, report, provider, enabledAgents) => {
        const policy = jest.fn(); const capabilities = jest.fn(); const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, { validatePlanFile: () => report, readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: [...enabledAgents], installMethod: 'symlink', defaultScope: 'local' }), readEffectivePolicy: policy as any, readCapabilities: capabilities as any });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', provider, '--cwd', repositoryRoot, '--runtime-kind', 'native', '--runtime-version', '1.0.0', '--account-scope-digest', 'a'.repeat(64), '--json']);
            expect(policy).not.toHaveBeenCalled(); expect(capabilities).not.toHaveBeenCalled();
        } finally { output.mockRestore(); process.exitCode = undefined; }
    });
    it('derives desatendido from the canonical plan header; a native v1 plan needs no journal (opt-in durable custody)', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admit-header-'));
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
            fs.writeFileSync(path.join(root, 'plan.md'), '**Modo de ejecución:** desatendido\n');
            spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
            spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
            spawnSync('git', ['add', 'plan.md'], { cwd: root });
            spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
            const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
            registerPlanCommand(program, {
                validatePlanFile: () => valid,
                readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            });
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--json']);
            const withoutPosture = JSON.parse(String(output.mock.calls[0][0]));
            expect(withoutPosture).toMatchObject({ state: 'blocked', executionMode: 'desatendido', journal: 'not-required' });
            expect(withoutPosture.diagnostics[0]).toMatchObject({ code: 'ADMISSION_CONTROLLER_AUTONOMY_REQUIRED' });
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--controller-autonomy', 'approval-free', '--json']);
            expect(JSON.parse(String(output.mock.calls[1][0]))).toMatchObject({ state: 'admitted', executionMode: 'desatendido', journal: 'not-required' });
        } finally { output.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it('uses executionMode from the validated snapshot when the plan file changes before admission', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admit-snapshot-mode-'));
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const admittedSnapshot = { ...valid, executionMode: 'desatendido' as const };
        const admit = jest.fn<Promise<AdmissionReport>, [any]>().mockResolvedValue({ state: 'admitted', planState: 'valid', journal: 'current', currentness: 'not-checked', sensors: 'not-required', diagnostics: [] });
        try {
            // This is deliberately the opposite header: a second read here would
            // silently downgrade the authenticated unattended snapshot.
            fs.writeFileSync(path.join(root, 'plan.md'), '**Modo de ejecución:** interactivo\n');
            const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
            registerPlanCommand(program, {
                validatePlanFile: () => admittedSnapshot,
                admitPlan: admit,
                readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            });
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--json']);
            expect(admit).toHaveBeenCalledWith(expect.objectContaining({ executionMode: 'desatendido' }));
        } finally { output.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it('uses an explicit validated execution-mode override over the canonical header', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admit-header-override-'));
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const admit = jest.fn<Promise<AdmissionReport>, [any]>().mockResolvedValue({ state: 'admitted', planState: 'valid', journal: 'not-required', currentness: 'not-checked', sensors: 'not-required', diagnostics: [] });
        try {
            fs.writeFileSync(path.join(root, 'plan.md'), '**Modo de ejecución:** desatendido\n');
            const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
            registerPlanCommand(program, { validatePlanFile: () => valid, admitPlan: admit, readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }) });
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--execution-mode', 'interactivo', '--json']);
            expect(admit).toHaveBeenCalledWith(expect.objectContaining({ executionMode: 'interactivo' }));
        } finally { output.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it('passes the current branch schema-2 journal and normalized plan path to unattended admission', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admit-journal-'));
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const admit = jest.fn<Promise<AdmissionReport>, [any]>().mockResolvedValue({ state: 'admitted', planState: 'valid', journal: 'current', currentness: 'not-checked', sensors: 'not-required', diagnostics: [] });
        try {
            spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
            initWatch(root, 'main', { path: 'plans/current.md', report: valid });
            const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
            registerPlanCommand(program, { validatePlanFile: () => valid, admitPlan: admit, readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }) });
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plans/current.md', '--provider', 'codex', '--cwd', root, '--execution-mode', 'desatendido', '--controller-autonomy', 'approval-free', '--json']);
            expect(admit).toHaveBeenCalledWith(expect.objectContaining({ executionMode: 'desatendido', planPath: 'plans/current.md', journalCorrupt: false, journalState: expect.objectContaining({ schema: 2, planBinding: expect.objectContaining({ digest: valid.planDigest }) }) }));
        } finally { output.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });
    it.each(['compatible', 'newer-cli-required', 'invalid-manifest', 'unconsumed', 'runtime-supplier', 'runtime-unowned', 'runtime-dangling', 'runtime-directory'])('checks the consumed registry CLI floor before sensors (%s)', async (scenario) => {
        const outputSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const oldHome = process.env.HOME;
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pair-admission-')));
        const registryRoot = path.join(root, 'registry');
        fs.mkdirSync(registryRoot);
        fs.writeFileSync(path.join(registryRoot, 'source.md'), 'contract');
        fs.writeFileSync(path.join(root, 'source.md'), 'project source');
        if (scenario.startsWith('runtime-')) {
            process.env.HOME = path.join(root, 'home');
            const installed = path.join(process.env.HOME, '.agents', 'skills');
            const source = path.join(scenario === 'runtime-unowned' ? root : registryRoot, 'skills', 'using-awm');
            fs.mkdirSync(installed, { recursive: true });
            fs.mkdirSync(source, { recursive: true });
            if (scenario === 'runtime-directory') fs.mkdirSync(path.join(source, 'SKILL.md'));
            else if (scenario !== 'runtime-dangling') fs.writeFileSync(path.join(source, 'SKILL.md'), 'runtime contract');
            fs.symlinkSync(source, path.join(installed, 'using-awm'), process.platform === 'win32' ? 'junction' : 'dir');
        }
        fs.writeFileSync(path.join(registryRoot, 'awm-registry.json'), scenario === 'invalid-manifest' ? '{bad' : JSON.stringify({ minCliVersion: scenario === 'compatible' ? '1.0.0' : '999.0.0' }));
        const report = { ...valid, manifest: { ...valid.manifest, sources: [{ id: 'source', path: scenario === 'unconsumed' || scenario.startsWith('runtime-') ? 'source.md' : 'registry/source.md', locator: 'contract', fact: 'contract' }] } };
        const sensors = jest.fn().mockResolvedValue({ overall: 'pass', sensors: [] });
        const program = new Command();
        registerPlanCommand(program, {
            validatePlanFile: () => report,
            listRegistries: () => [{ name: 'fixture', remote: 'https://example.invalid/fixture.git', contentRoot: registryRoot }],
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: async () => ({ checkedAt: 'x', compatibility: { status: 'not-checked' }, components: ['cli', 'registry:fixture'].map(component => ({ component, installed: '1.0.0', latest: '1.0.0', channel: 'stable', source: 'fixture', checkedAt: 'x', status: 'current' as const, detail: 'ok', remedy: 'none' as const })) }),
            runSensors: sensors,
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--execution-mode', 'interactivo', '--require-current', '--verify-sensors', '--json']);
            const output = JSON.parse(String(outputSpy.mock.calls.at(-1)![0]));
            if (scenario === 'compatible' || scenario === 'unconsumed') {
                expect(output.state).toBe('admitted');
                expect(sensors).toHaveBeenCalledTimes(1);
            } else {
                expect(output.state).toBe('blocked');
                const unknownSupplier = ['runtime-unowned', 'runtime-dangling', 'runtime-directory'].includes(scenario);
                expect(output.diagnostics[0].code).toBe(unknownSupplier ? 'ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED' : scenario === 'invalid-manifest' ? 'ADMISSION_REGISTRY_COMPATIBILITY_UNVERIFIABLE' : 'ADMISSION_REGISTRY_CLI_INCOMPATIBLE');
                if (!unknownSupplier) expect(output.diagnostics[0].message).toContain('registry:fixture');
                expect(sensors).not.toHaveBeenCalled();
                expect(process.exitCode).toBe(2);
            }
        } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; outputSpy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it.each([['cursor', 'global'], ['cursor', 'local'], ['copilot', 'local']] as const)('does not prove absence for actual unowned rendered %s %s runtime contracts', async (target, scope) => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rendered-admission-')));
        const oldHome = process.env.HOME;
        process.env.HOME = path.join(root, 'home');
        const outputSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const registryRoot = path.join(root, 'registry');
        const skillSource = path.join(registryRoot, 'skills', 'using-awm');
        fs.mkdirSync(skillSource, { recursive: true });
        fs.writeFileSync(path.join(skillSource, 'SKILL.md'), '---\nname: using-awm\ndescription: contract\n---\nRuntime contract.\n');
        fs.writeFileSync(path.join(registryRoot, 'awm-registry.json'), JSON.stringify({ minCliVersion: '1.0.0' }));
        fs.writeFileSync(path.join(root, 'source.md'), 'project source');
        const provider = providerFor(target);
        const directory = scope === 'global' ? provider.skill.global! : path.resolve(root, provider.skill.local);
        fs.mkdirSync(directory, { recursive: true });
        const installedFile = path.join(directory, renderedFilename('using-awm', provider.skill.renderer));
        fs.writeFileSync(installedFile, renderArtifact(provider.skill.renderer, skillSource)!);
        const sensors = jest.fn();
        const program = new Command();
        registerPlanCommand(program, {
            validatePlanFile: () => ({ ...valid, manifest: { ...valid.manifest, sources: [{ id: 'source', path: 'source.md', locator: 'contract', fact: 'contract' }] } }),
            listRegistries: () => [{ name: 'fixture', remote: 'https://example.invalid/fixture.git', contentRoot: registryRoot }],
            readPreferences: () => ({ defaultAgent: target, enabledAgents: [target], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: async () => ({ checkedAt: 'x', compatibility: { status: 'not-checked' }, components: [{ component: 'cli', installed: '1.0.0', latest: '1.0.0', channel: 'stable', source: 'fixture', checkedAt: 'x', status: 'current', detail: 'ok', remedy: 'none' }] }),
            runSensors: sensors,
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', target, '--cwd', root, '--execution-mode', 'interactivo', '--require-current', '--verify-sensors', '--json']);
            const output = JSON.parse(String(outputSpy.mock.calls.at(-1)![0]));
            expect(output.diagnostics[0].code).toBe('ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED');
            expect(output.state).toBe('blocked');
            // Global diagnostics may retain the declared path while local ones
            // use a physical root. Windows 8.3/long names are equivalent: prove
            // that the reported path names this exact file, not its spelling.
            const reported = /^Runtime artifact (.+) has no unique physical registry owner/.exec(output.diagnostics[0].message);
            expect(reported).not.toBeNull();
            const reportedIdentity = fs.lstatSync(reported![1], { bigint: true });
            const installedIdentity = fs.lstatSync(installedFile, { bigint: true });
            expect(reportedIdentity.isFile()).toBe(true);
            expect(reportedIdentity.ino).not.toBe(0n);
            expect([reportedIdentity.dev, reportedIdentity.ino]).toEqual([installedIdentity.dev, installedIdentity.ino]);
            expect(sensors).not.toHaveBeenCalled();
        } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; outputSpy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it.each(['symlink', 'directory', 'oversized', 'duplicate-floor', 'unsafe-floor', 'stale-before-compatibility'] as const)('keeps registry manifest %s noncertifying before sensors', async scenario => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-manifest-admission-')));
        const registryRoot = path.join(root, 'registry');
        fs.mkdirSync(registryRoot);
        fs.writeFileSync(path.join(registryRoot, 'source.md'), 'registry source');
        const manifest = path.join(registryRoot, 'awm-registry.json');
        if (scenario === 'symlink') { fs.writeFileSync(path.join(root, 'outside-manifest'), '{}'); fs.symlinkSync(path.join(root, 'outside-manifest'), manifest, 'file'); }
        else if (scenario === 'directory') fs.mkdirSync(manifest);
        else fs.writeFileSync(manifest, scenario === 'oversized' ? ' '.repeat(256 * 1024 + 1)
            : scenario === 'duplicate-floor' ? '{"minCliVersion":"999.0.0","minCliVersion":"1.0.0"}'
            : scenario === 'unsafe-floor' ? '{"minCliVersion":"' + '9'.repeat(1024) + '.0.0"}' : '{bad json');
        const outputSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const sensors = jest.fn();
        const program = new Command();
        registerPlanCommand(program, {
            validatePlanFile: () => ({ ...valid, manifest: { ...valid.manifest, sources: [{ id: 'source', path: 'registry/source.md', locator: 'contract', fact: 'contract' }] } }),
            listRegistries: () => [{ name: 'fixture', remote: 'https://example.invalid/fixture.git', contentRoot: registryRoot }],
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: async () => ({ checkedAt: 'x', compatibility: { status: 'not-checked' }, components: ['cli', 'registry:fixture'].map(component => ({ component, installed: '1.0.0', latest: '1.0.0', channel: 'stable', source: 'fixture', checkedAt: 'x', status: scenario === 'stale-before-compatibility' ? 'stale' : 'current', detail: 'observed', remedy: 'none' })) }),
            runSensors: sensors,
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--execution-mode', 'interactivo', '--require-current', '--verify-sensors', '--json']);
            const output = JSON.parse(String(outputSpy.mock.calls.at(-1)![0]));
            expect(output.state).toBe('blocked');
            expect(output.diagnostics[0].code).toBe(scenario === 'stale-before-compatibility' ? 'ADMISSION_CURRENTNESS_BLOCKED' : 'ADMISSION_REGISTRY_COMPATIBILITY_UNVERIFIABLE');
            expect(sensors).not.toHaveBeenCalled();
        } finally { outputSpy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it.each(['owner-currentness', 'inventory-currentness', 'owner-sensors', 'floor-sensors', 'registry-identity-currentness', 'body-currentness'] as const)('rechecks actual runtime contract %s after awaits before admitted', async scenario => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-supplier-drift-')));
        const oldHome = process.env.HOME;
        process.env.HOME = path.join(root, 'home');
        const registryRoot = path.join(root, 'registry');
        const owned = path.join(registryRoot, 'skills', 'using-awm');
        const unowned = path.join(root, 'unowned', 'using-awm');
        const replacementRoot = path.join(root, 'replacement-registry');
        const replacementOwned = path.join(replacementRoot, 'skills', 'using-awm');
        for (const directory of [owned, unowned, replacementOwned]) { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'SKILL.md'), 'contract'); }
        fs.writeFileSync(path.join(registryRoot, 'awm-registry.json'), '{}');
        fs.writeFileSync(path.join(replacementRoot, 'awm-registry.json'), '{}');
        fs.writeFileSync(path.join(root, 'source.md'), 'project source');
        const installed = providerFor('codex').skill.global!;
        fs.mkdirSync(installed, { recursive: true });
        const artifact = path.join(installed, 'using-awm');
        fs.symlinkSync(owned, artifact, process.platform === 'win32' ? 'junction' : 'dir');
        const outputSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        let inventoryChanged = false;
        let registryChanged = false;
        const replaceOwner = () => { fs.unlinkSync(artifact); fs.symlinkSync(unowned, artifact, process.platform === 'win32' ? 'junction' : 'dir'); };
        const sensors = jest.fn().mockImplementation(async () => {
            if (scenario === 'owner-sensors') replaceOwner();
            if (scenario === 'floor-sensors') fs.writeFileSync(path.join(registryRoot, 'awm-registry.json'), '{"minCliVersion":"999.0.0"}');
            return { overall: 'pass', sensors: [] };
        });
        const program = new Command();
        registerPlanCommand(program, {
            validatePlanFile: () => ({ ...valid, manifest: { ...valid.manifest, sources: [{ id: 'source', path: 'source.md', locator: 'contract', fact: 'contract' }] } }),
            listRegistries: () => [{ name: inventoryChanged ? 'replacement' : 'fixture', remote: registryChanged ? 'https://replacement.invalid/fixture.git' : 'https://example.invalid/fixture.git', contentRoot: registryChanged ? replacementRoot : registryRoot }],
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: async () => {
                if (scenario === 'owner-currentness') replaceOwner();
                if (scenario === 'inventory-currentness') inventoryChanged = true;
                if (scenario === 'registry-identity-currentness') {
                    registryChanged = true;
                    fs.unlinkSync(artifact); fs.symlinkSync(replacementOwned, artifact, process.platform === 'win32' ? 'junction' : 'dir');
                }
                if (scenario === 'body-currentness') fs.writeFileSync(path.join(owned, 'SKILL.md'), 'changed native runtime contract');
                return { checkedAt: 'x', compatibility: { status: 'not-checked' }, components: ['cli', 'registry:fixture'].map(component => ({ component, installed: '1.0.0', latest: '1.0.0', channel: 'stable', source: 'fixture', checkedAt: 'x', status: 'current', detail: 'ok', remedy: 'none' })) };
            }, runSensors: sensors,
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--execution-mode', 'interactivo', '--require-current', '--verify-sensors', '--json']);
            const output = JSON.parse(String(outputSpy.mock.calls.at(-1)![0]));
            expect(output.state).toBe('blocked');
            expect(output.diagnostics[0].code).toBe(scenario === 'floor-sensors' ? 'ADMISSION_REGISTRY_CLI_INCOMPATIBLE' : 'ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED');
            expect(sensors).toHaveBeenCalledTimes(scenario.endsWith('sensors') ? 1 : 0);
        } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; outputSpy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    it('keeps an unreadable inventory root actionable instead of silently proving it unconsumed', async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-root-admission-')));
        fs.writeFileSync(path.join(root, 'source.md'), 'project source');
        const outputSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const sensors = jest.fn(); const currentness = jest.fn();
        const program = new Command();
        registerPlanCommand(program, {
            validatePlanFile: () => ({ ...valid, manifest: { ...valid.manifest, sources: [{ id: 'source', path: 'source.md', locator: 'contract', fact: 'contract' }] } }),
            listRegistries: () => [{ name: 'unavailable-supplier', remote: 'https://example.invalid/fixture.git', contentRoot: path.join(root, 'missing-registry') }],
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: currentness, runSensors: sensors,
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', root, '--require-current', '--verify-sensors', '--json']);
            const output = JSON.parse(String(outputSpy.mock.calls.at(-1)![0]));
            expect(output.diagnostics[0].code).toBe('ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED');
            expect(output.diagnostics[0].message).toContain('unavailable-supplier');
            expect(currentness).not.toHaveBeenCalled(); expect(sensors).not.toHaveBeenCalled();
        } finally { outputSpy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = undefined; }
    });

    // Antes esta prueba afirmaba que un CLI stale bloqueaba y por eso los sensores no
    // corrian. Eso era el defecto: cada publicacion de npm detenia cualquier maquina.
    // La propiedad de orden —si el gate de contratos bloquea, los sensores no corren—
    // sigue cubierta arriba con un registry consumido stale.
    it('con el CLI stale admite y SI corre los sensores: la version publicada en npm no detiene el ciclo', async () => {
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const sensors = jest.fn();
        const program = new Command();
        program.exitOverride();
        program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, {
            validatePlanFile: () => valid, listRegistries: () => [],
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: async () => ({ checkedAt: 'x', compatibility: { status: 'not-checked' }, components: [{ component: 'cli', installed: '1.0.0', latest: '2.0.0', channel: 'stable', source: 'npm', checkedAt: 'x', status: 'stale', detail: 'stale', remedy: 'update' }] }),
            runSensors: sensors,
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', repositoryRoot, '--require-current', '--verify-sensors', '--json']);
            expect(sensors).toHaveBeenCalled();
            expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ currentness: 'current', cliCurrentness: 'stale' });
        } finally { output.mockRestore(); process.exitCode = undefined; }
    });

    it('rejects a forged admission report before output or exit status', async () => {
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const program = new Command();
        program.exitOverride();
        program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, {
            validatePlanFile: () => valid,
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            admitPlan: async () => ({ state: 'admitted', planState: 'valid', journal: 'not-required', currentness: 'current', sensors: 'pass', diagnostics: 'forged' } as any),
        });
        try {
            await expect(program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', repositoryRoot, '--json'])).rejects.toThrow('admission returned an invalid report');
            expect(output).not.toHaveBeenCalled();
            expect(process.exitCode).toBeUndefined();
        } finally { output.mockRestore(); process.exitCode = undefined; }
    });

    it('does not prove registry irrelevance through a source symlink that escapes cwd', async () => {
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admit-provenance-'));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-admit-outside-'));
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const currentness = jest.fn();
        const admit = jest.fn<Promise<AdmissionReport>, [any]>().mockResolvedValue({ state: 'blocked', planState: 'valid', journal: 'not-required', currentness: 'unverifiable', sensors: 'not-required', diagnostics: [] });
        try {
            fs.writeFileSync(path.join(outside, 'contract.md'), 'outside');
            fs.symlinkSync(outside, path.join(fixtureRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
            const escaped = { ...valid, manifest: { ...valid.manifest, sources: [{ id: 'SRC', path: 'linked/contract.md', locator: 'x', fact: 'x' }] } };
            const program = new Command();
            program.exitOverride();
            program.configureOutput({ writeErr: () => undefined });
            registerPlanCommand(program, {
                validatePlanFile: () => escaped, admitPlan: admit,
                readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
                listRegistries: () => [], checkCurrentness: currentness,
            });
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plan.md', '--provider', 'codex', '--cwd', fixtureRoot, '--require-current', '--json']);
            expect(currentness).not.toHaveBeenCalled();
            expect(admit).toHaveBeenCalledWith(expect.objectContaining({ provenance: 'unknown', consumedRegistryComponents: [] }));
        } finally {
            output.mockRestore();
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
            process.exitCode = undefined;
        }
    });

    it('bounds and terminal-sanitizes adversarial admission diagnostics in JSON', async () => {
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const program = new Command();
        program.exitOverride();
        program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, {
            validatePlanFile: () => valid,
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            admitPlan: async () => ({ state: 'blocked', planState: 'valid', journal: 'not-required', currentness: 'not-checked', sensors: 'not-required', diagnostics: [{ code: `X\u001b${'c'.repeat(5000)}`, message: `Y\u001b${'m'.repeat(5000)}` }] }),
        });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plans/r4.md', '--provider', 'codex', '--cwd', 'fixture-root', '--json']);
            const json = String(output.mock.calls[0][0]);
            expect(json.trimEnd()).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
            expect(JSON.parse(json).diagnostics[0]).toEqual({ code: expect.stringMatching(/^X\\u001b/), message: expect.stringMatching(/^Y\\u001b/) });
            expect(JSON.parse(json).diagnostics[0].message.length).toBeLessThanOrEqual(4096);
        } finally { output.mockRestore(); process.exitCode = undefined; }
    });

    it('uses the bounded admission surface and preserves JSON output', async () => {
        const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        process.exitCode = undefined;
        const admit = jest.fn<Promise<AdmissionReport>, [any]>()
            .mockResolvedValue({
            state: 'blocked', planState: 'valid', planDigest: valid.planDigest, provider: 'codex', executionMode: 'interactivo',
            journal: 'not-required', currentness: 'not-checked', sensors: 'not-required', diagnostics: [{ code: 'ADMISSION_CURRENTNESS_REQUIRED', message: 'required' }],
            });
        const sensorRun = jest.fn().mockResolvedValue({ overall: 'pass', sensors: [] });
        const program = new Command();
        program.exitOverride();
        program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, {
            validatePlanFile: () => valid, admitPlan: admit,
            readPreferences: () => ({ defaultAgent: 'codex', enabledAgents: ['codex'], installMethod: 'symlink', defaultScope: 'local' }),
            checkCurrentness: async () => ({ checkedAt: '2026-01-01T00:00:00.000Z', components: [], compatibility: { status: 'not-checked' } }),
            runSensors: sensorRun,
            listRegistries: () => [],
        });

        try {
            await program.parseAsync(['node', 'awm', 'plan', 'admit', 'plans/r4.md', '--provider', 'codex', '--cwd', repositoryRoot, '--verify-sensors', '--json']);
            expect(sensorRun).toHaveBeenCalledWith({ cwd: repositoryRoot, all: true, readOnly: true });
            expect(admit).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'codex', cwd: repositoryRoot, requireCurrent: false, verifySensors: true, plan: valid, provenance: 'proven' }));
            expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ state: 'blocked', provider: 'codex' });
            expect(process.exitCode).toBe(2);
        } finally {
            output.mockRestore();
            process.exitCode = undefined;
        }
    });
});

describe('plan validation public boundaries', () => {
    it.each([
        ['empty red commands', { slices: [{ ...valid.manifest.slices[0], redCommands: [] }] }],
        ['bogus review evidence', { slices: [{ ...valid.manifest.slices[0], reviewEvidence: ['specification', 'bogus'] }] }],
        ['bogus risk', { slices: [{ ...valid.manifest.slices[0], risk: 'unbounded' }] }],
        ['dangling closure command', { closureCommands: ['CMD-MISSING'] }],
    ])('rejects a forged valid report with %s before output or exit 0', (_name, changes) => {
        const forged = { ...valid, manifest: { ...valid.manifest, ...changes } } as unknown as PlanValidationReport;
        expect(() => formatReport(forged, 'plan.md')).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(forged)).toThrow('plan validator returned an invalid valid report');
    });

    it('rejects a structurally plausible forged or deserialized valid report', () => {
        const deserialized = JSON.parse(JSON.stringify(valid)) as PlanValidationReport;
        const forged = { ...valid } as PlanValidationReport;
        expect(() => formatReport(deserialized, 'plan.md')).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(deserialized)).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(forged)).toThrow('plan validator returned an invalid valid report');
    });

    it.each([
        'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md',
        'docs/plans/2026-08-27-sensor-portability-publication-a-plan.md',
        'docs/plans/2026-09-07-retire-onsignal.md',
        'docs/plans/2026-09-14-compact-only-bootstrap-plan.md',
    ])('accepts a validator-produced tracked v1 report at both public boundaries: %s', (file) => {
        const report = validatePlanFile(file, repositoryRoot);
        expect(report.state).toBe('valid');
        expect(exitCodeFor(report)).toBe(0);
        expect(formatReport(report, file)).toContain('complete ownership');
    });

    it.each([
        ['valid', valid, 0],
        ['migration-required', migration, 2],
        ['invalid', { state: 'invalid', diagnostics: [] } as PlanValidationReport, 2],
        ['unsupported', { state: 'unsupported', schema: 'compact-slices/v2', diagnostics: [] } as PlanValidationReport, 2],
    ])('maps %s reports to exit %i', (_state, report, code) => {
        expect(exitCodeFor(report)).toBe(code);
    });

    it('fails loudly rather than returning exit 0 for an injected valid state without a manifest', () => {
        const malformed = { state: 'valid' } as unknown as PlanValidationReport;
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
        expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
    });

    it('rejects a valid report missing the required closureCommands collection', () => {
        const malformed = { ...valid, manifest: { ...valid.manifest, closureCommands: undefined } } as unknown as PlanValidationReport;
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
    });

    it.each(['requirements', 'sources', 'commands', 'slices', 'closureCommands'] as const)(
        'rejects a null %s entry before claiming complete ownership or exit 0', (collection) => {
            const malformed = {
                ...valid, manifest: { ...valid.manifest, [collection]: [null] },
            } as unknown as PlanValidationReport;
            expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
            expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
        },
    );

    it.each(['human', 'json'])('rejects a null manifest slice before %s output or exit 0', async (mode) => {
        const malformed = {
            ...valid, manifest: { ...valid.manifest, slices: [null] },
        } as unknown as PlanValidationReport;
        const args = ['node', 'awm', 'plan', 'validate', 'plan.md', ...(mode === 'json' ? ['--json'] : [])];
        await expect(commandFor(malformed).parseAsync(args)).rejects.toThrow('plan validator returned an invalid valid report');
        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('rejects an unowned requirement before claiming complete ownership or exit 0', () => {
        const malformed = { ...valid, manifest: { ...valid.manifest, requirements: [...valid.manifest.requirements, 'R4-VAL-5'] } };
        expect(() => formatReport(malformed as unknown as PlanValidationReport, 'plan.md')).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(malformed as unknown as PlanValidationReport)).toThrow('plan validator returned an invalid valid report');
    });

    it('rejects a requirement owned by two slices', () => {
        const malformed = {
            ...valid, manifest: { ...valid.manifest, slices: [...valid.manifest.slices, {
                ...valid.manifest.slices[0], id: 'S2', requirements: [valid.manifest.requirements[0]],
            }] },
        };
        expect(() => formatReport(malformed as unknown as PlanValidationReport, 'plan.md')).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(malformed as unknown as PlanValidationReport)).toThrow('plan validator returned an invalid valid report');
    });

    it.each(['requirements', 'sources', 'commands', 'slices', 'closureCommands'] as const)(
        'rejects an empty %s collection in an injected valid report', (collection) => {
            const malformed = {
                ...valid, manifest: { ...valid.manifest, [collection]: [] },
            } as unknown as PlanValidationReport;
            expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
            expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
        },
    );

    it('fails loudly for a migration state without its required reason at the public exit boundary', () => {
        const malformed = { state: 'migration-required' } as unknown as PlanValidationReport;
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid migration reason');
    });

    it('fails loudly for an invalid validator dependency', () => {
        expect(() => registerPlanCommand(new Command(), {} as never)).toThrow('validatePlanFile must be a function');
    });
});

describe('plan migration-facts command', () => {
    it('emits deterministic JSON through the injected read-only collector', async () => {
        const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, { validatePlanFile: () => valid, collectMigrationFacts: () => ({ state: 'planning-required', issueLinks: ['https://github.com/Kodria/agentic-workflow/issues/126'], tasks: [], diagnostics: ['missing'], facts: [] }) });
        try {
            await program.parseAsync(['node', 'awm', 'plan', 'migration-facts', 'old.md', '--issue', 'https://github.com/Kodria/agentic-workflow/issues/126', '--json']);
            expect(JSON.parse(String(write.mock.calls.at(-1)?.[0]))).toMatchObject({ state: 'planning-required', diagnostics: ['missing'] });
        } finally { write.mockRestore(); }
    });

    it('rejects missing issue input before invoking collection', async () => {
        const collectMigrationFacts = jest.fn(); const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerPlanCommand(program, { validatePlanFile: () => valid, collectMigrationFacts });
        await expect(program.parseAsync(['node', 'awm', 'plan', 'migration-facts', 'old.md'])).rejects.toThrow();
        expect(collectMigrationFacts).not.toHaveBeenCalled();
    });
});
