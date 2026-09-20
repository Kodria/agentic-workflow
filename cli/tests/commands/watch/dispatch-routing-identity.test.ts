import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { initRepo } from '../../helpers/git-fixture';
import { DEFAULT_SUPERVISOR_CONFIG, admissionForConfig, defaultDispatchAdmission, routingFacts } from '../../../src/commands/watch/supervisor';
import { initWatch } from '../../../src/commands/watch/init';
import { validatePlanFile } from '../../../src/core/plan/validate';
import type { CapabilityReceipt, RuntimeKey } from '../../../src/core/model-policy/types';

// #166: the supervisor's own admission must carry the runtime identity that
// compact v2 demands. Every other gate could be green and dispatch still blocks
// with ADMISSION_ROUTING_FACTS_REQUIRED, because these three fields were never
// supplied. The identity is operator-asserted (as on `plan admit`/`plan resolve`)
// and the receipt must match it — never the other way round.

const DIGEST = 'a'.repeat(64);

function receiptFor(runtime: RuntimeKey, now: number): CapabilityReceipt {
    return {
        schema: 'routing-capabilities/v1', runtime,
        recordedAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(),
        capabilities: { artifactDelivery: 'supported', interactiveExecution: 'supported', unattendedController: 'supported',
            nativeSubagents: 'supported', modelOverride: 'supported', effortOverride: 'unsupported',
            observedModelEvidence: 'supported', durableResume: 'supported' },
        availableSelections: [{ selector: { kind: 'model', id: 'test-model' }, effort: { kind: 'runtime-default' } }],
        runtimeDefaultSelection: { selector: { kind: 'model', id: 'test-model' }, effort: { kind: 'runtime-default' } },
        evidence: [], approval: { approvalId: 'approval-1', snapshotDigest: DIGEST },
    };
}

describe('unattended dispatch routing identity (#166)', () => {
    let cwd: string;
    beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-dispatch-routing-')); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('asserts the operator-supplied runtime and attaches the matching receipt', () => {
        const now = Date.now();
        const seen: RuntimeKey[] = [];
        const facts = routingFacts('claude-code', { kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST }, cwd, {
            now: () => new Date(now),
            readEffectivePolicy: () => ({ state: 'absent' }) as never,
            readCapabilities: (runtime: RuntimeKey) => { seen.push(runtime); return { state: 'current', receipt: receiptFor(runtime, now) } as never; },
        });

        // The identity reaches admission intact — this is the whole defect.
        expect(facts?.runtime).toEqual({ target: 'claude-code', kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST });
        // The receipt is looked up BY the asserted runtime, not used to choose one.
        expect(seen).toEqual([{ target: 'claude-code', kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST }]);
        expect(facts?.capabilities?.runtime).toEqual(facts?.runtime);
        expect(facts?.now?.getTime()).toBe(now);
    });

    test('supplies no routing facts when the operator asserted no identity', () => {
        expect(routingFacts('claude-code', undefined, cwd, {
            readEffectivePolicy: () => { throw new Error('must not read policy without an asserted runtime'); },
            readCapabilities: () => { throw new Error('must not read capabilities without an asserted runtime'); },
        })).toBeUndefined();
    });

    test('refuses an identity that is not a valid runtime key', () => {
        expect(() => routingFacts('claude-code', { kind: 'native', version: 'not-semver', accountScopeDigest: DIGEST }, cwd, {}))
            .toThrow(/runtime\.version/);
        expect(() => routingFacts('claude-code', { kind: 'native', version: '2.0.0', accountScopeDigest: 'short' }, cwd, {}))
            .toThrow(/accountScopeDigest/);
    });

    test('withholds a stale receipt rather than admitting on it', () => {
        const now = Date.now();
        const facts = routingFacts('claude-code', { kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST }, cwd, {
            now: () => new Date(now),
            readEffectivePolicy: () => ({ state: 'absent' }) as never,
            readCapabilities: () => ({ state: 'expired' }) as never,
        });
        expect(facts?.runtime).toBeDefined();
        expect(facts?.capabilities).toBeUndefined();
    });
});

describe('awm watch runtime identity flags (#166)', () => {
    test('the compiled CLI declares the three identity flags', () => {
        const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../../dist/src/index.js'), 'watch', '--help'], {
            encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
        });
        expect(result.status).toBe(0);
        for (const flag of ['--runtime-kind', '--runtime-version', '--account-scope-digest']) expect(result.stdout).toContain(flag);
    });

    test('a partial identity is refused by name, before the lock is taken', () => {
        const repo = initRepo();
        try {
            const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../../dist/src/index.js'),
                'watch', '--provider', 'claude-code', '--runtime-kind', 'native'], {
                cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('--runtime-version');
            expect(result.stderr).toContain('--account-scope-digest');
            expect(result.stderr).not.toContain('--runtime-kind');
            // The refusal happens before any journal/lock work.
            expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('a malformed digest is refused by the runtime key validator, not by a custody cycle', () => {
        const repo = initRepo();
        try {
            const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../../dist/src/index.js'),
                'watch', '--provider', 'claude-code', '--runtime-kind', 'native',
                '--runtime-version', '2.0.0', '--account-scope-digest', 'not-a-digest'], {
                cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/accountScopeDigest/);
            expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });
});

describe('the supervisor admission actually carries the identity (#166)', () => {
    // The two suites above would both still pass if `routingFacts` were computed
    // and then never attached to the admission call — which is precisely the shape
    // of every defect in this chain: a test that starts one step past the gap.
    // This one fails if the wiring is removed.
    function boundRepo(): string {
        const repo = initRepo();
        const planPath = path.join(repo, 'docs', 'plan.md');
        fs.mkdirSync(path.dirname(planPath), { recursive: true });
        fs.writeFileSync(planPath, `**Modo de ejecución:** desatendido\n\n${fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v2/valid.md'), 'utf8')}`);
        fs.copyFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v2/source.md'), path.join(repo, 'source.md'));
        initWatch(repo, 'main', { path: 'docs/plan.md', report: validatePlanFile('docs/plan.md', repo) });
        return repo;
    }

    test('attaches the asserted runtime to the admission input it dispatches on', async () => {
        const repo = boundRepo();
        try {
            const seen: Array<Record<string, unknown>> = [];
            const admission = defaultDispatchAdmission(repo, 'main', 'claude-code',
                { kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST },
                {
                    admit: (async (input: Record<string, unknown>) => { seen.push(input); return { state: 'admitted' }; }) as never,
                    readEffectivePolicy: () => ({ state: 'absent' }) as never,
                    readCapabilities: () => ({ state: 'absent' }) as never,
                });

            await admission();

            expect(seen).toHaveLength(1);
            expect(seen[0].routing).toBeDefined();
            expect((seen[0].routing as { runtime: unknown }).runtime).toEqual({ target: 'claude-code', kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST });
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });

    test('dispatches without routing facts when no identity was asserted', async () => {
        const repo = boundRepo();
        try {
            const seen: Array<Record<string, unknown>> = [];
            const admission = defaultDispatchAdmission(repo, 'main', 'claude-code', undefined, {
                admit: (async (input: Record<string, unknown>) => { seen.push(input); return { state: 'admitted' }; }) as never,
            });

            await admission();

            expect(seen).toHaveLength(1);
            expect(seen[0].routing).toBeUndefined();
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });
});

describe('the config carries the identity to the admission (#166)', () => {
    // Covers the plumbing between `awm watch --runtime-*` and the gate. Without
    // it, `cfg.routingIdentity` could be dropped at the constructor and every
    // other test here would still pass.
    function boundRepo(): string {
        const repo = initRepo();
        const planPath = path.join(repo, 'docs', 'plan.md');
        fs.mkdirSync(path.dirname(planPath), { recursive: true });
        fs.writeFileSync(planPath, `**Modo de ejecución:** desatendido\n\n${fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v2/valid.md'), 'utf8')}`);
        fs.copyFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v2/source.md'), path.join(repo, 'source.md'));
        initWatch(repo, 'main', { path: 'docs/plan.md', report: validatePlanFile('docs/plan.md', repo) });
        return repo;
    }

    test('admissionForConfig forwards cfg.routingIdentity to the admission input', async () => {
        const repo = boundRepo();
        try {
            const seen: Array<Record<string, unknown>> = [];
            const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'claude-code', routingIdentity: { kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST } };
            await admissionForConfig(repo, 'main', cfg, {
                admit: (async (input: Record<string, unknown>) => { seen.push(input); return { state: 'admitted' }; }) as never,
                readEffectivePolicy: () => ({ state: 'absent' }) as never,
                readCapabilities: () => ({ state: 'absent' }) as never,
            })();
            expect((seen[0].routing as { runtime: unknown } | undefined)?.runtime)
                .toEqual({ target: 'claude-code', kind: 'native', version: '2.0.0', accountScopeDigest: DIGEST });
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });
});
