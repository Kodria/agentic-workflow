import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    stepCache, stepHook, stepDevCore, stepAmbient,
    stepProfile, stepActivation, stepSensors, stepConstitution, stepContext,
    stepContextInjection, stepGlobalSkillsRepair, stepConstitutionInjection,
} from '../../../src/core/init/steps';
import type { InitDeps, InitActions } from '../../../src/core/init/types';
import type { HarnessContext, ProjectFacts } from '../../../src/core/diagnostics/types';
import type { BundleDefinition } from '../../../src/core/bundles';
import { providerFor } from '../../../src/providers';
import { gatherContext } from '../../../src/core/diagnostics/context';

function bundle(name: string, scope: BundleDefinition['scope'], skills: string[]): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: skills.map((s) => ({ name: s, onSignal: false })),
        workflows: [], agents: [],
    };
}

function machine(): HarnessContext['machine'] {
    return {
        registryCache: { present: true, gitState: 'clean' },
        hook: { present: true, degraded: false },
        devCore: { present: true, brokenLinks: [] },
        ambient: { wanted: [], installed: [] },
        contextInjection: [],
        globalSkills: { valid: [], repairable: [], dead: [] },
    };
}

function project(over: Partial<ProjectFacts> = {}): ProjectFacts {
    return {
        root: '/repo',
        profile: { present: true, extensions: [] },
        activeBundles: { expected: [], linked: [], broken: [] },
        sensors: { present: true },
        constitution: { present: true },
        context: { present: true, file: 'CLAUDE.md' },
        ...over,
    };
}

function spies(): jest.Mocked<InitActions> {
    return {
        syncCache: jest.fn(async () => {}),
        installHook: jest.fn(() => ({ status: 'installed' })),
        installBundle: jest.fn(() => ({ installed: ['a'], skipped: [] })),
        syncProfile: jest.fn(() => ({ installed: ['a'], skipped: [], extensions: ['frontend'] })),
        initSensors: jest.fn(() => ({ detection: { pack: 'js-ts' } })),
        addExtension: jest.fn(),
        ensureProfile: jest.fn(),
        gatherProject: jest.fn((_cwd: string, _bundles: any) => null),
        contextStatus: jest.fn(() => 'absent' as const),
        installContext: jest.fn(),
        repairGlobalSkills: jest.fn(() => ({ relinked: [], pruned: [], failed: [] })),
        injectProjectConstitution: jest.fn(() => 'injected' as const),
    } as unknown as jest.Mocked<InitActions>;
}

function deps(ctx: HarnessContext, actions: InitActions, over: Partial<InitDeps> = {}): InitDeps {
    return {
        cwd: '/repo', ctx, bundles: [bundle('dev', 'baseline', ['brainstorming'])],
        agent: 'claude-code', enabledAgents: ['claude-code'], installMethod: 'symlink',
        registryRoot: '/cache', contentDir: '/cache/registry', sensorPacksRoot: '/cache/registry',
        confirmExtensions: async (p) => p, actions, ...over,
    };
}

describe('stepCache', () => {
    it('skips when cli present and not behind', async () => {
        const a = spies();
        const r = await stepCache(deps({ machine: machine(), project: null }, a));
        expect(r.action).toBe('skipped');
        expect(a.syncCache).not.toHaveBeenCalled();
    });
    it('syncs when registry cache absent', async () => {
        const a = spies();
        const m = machine(); m.registryCache = { present: false };
        const r = await stepCache(deps({ machine: m, project: null }, a));
        expect(r.action).toBe('applied');
        expect(a.syncCache).toHaveBeenCalled();
    });
    it('syncs when registry cache behind', async () => {
        const a = spies();
        const m = machine(); m.registryCache = { present: true, gitState: 'behind' };
        expect((await stepCache(deps({ machine: m, project: null }, a))).action).toBe('applied');
    });
    it('reports failed when syncCache throws (does not throw)', async () => {
        const a = spies();
        a.syncCache = jest.fn(async () => { throw new Error('net down'); });
        const m = machine(); m.registryCache = { present: false };
        const r = await stepCache(deps({ machine: m, project: null }, a));
        expect(r.action).toBe('failed');
        expect(r.error).toContain('net down');
    });
});

describe('stepHook / stepDevCore / stepAmbient', () => {
    it('hook skips when present and healthy', () => {
        const a = spies();
        expect(stepHook(deps({ machine: machine(), project: null }, a)).action).toBe('skipped');
        expect(a.installHook).not.toHaveBeenCalled();
    });
    it('hook installs when absent', () => {
        const a = spies();
        const m = machine(); m.hook = { present: false };
        expect(stepHook(deps({ machine: m, project: null }, a)).action).toBe('applied');
        expect(a.installHook).toHaveBeenCalled();
    });
    it('hook reinstalls when present but degraded', () => {
        const a = spies();
        const m = machine(); m.hook = { present: true, degraded: true };
        expect(stepHook(deps({ machine: m, project: null }, a)).action).toBe('applied');
        expect(a.installHook).toHaveBeenCalled();
    });
    // Regression: a real (unstubbed) `awm init --agent opencode` used to throw
    // "hooks not supported for agent target: opencode" from installHook,
    // because stepHook never checked whether the target agent has a hook
    // mechanism at all before calling installHook (providers/index.ts:
    // OpenCode/Antigravity have no `hooks` config). Found while building the
    // real Codex+OpenCode coexistence E2E test — mirrors provider-checks.ts's
    // `hookTrustCheck`, which already treats a missing `hooks` config as "not
    // applicable" rather than a failure.
    it('hook skips (not calls installHook) for an agent with no hook mechanism', () => {
        const a = spies();
        const m = machine(); m.hook = { present: false };
        const r = stepHook(deps({ machine: m, project: null }, a, { agent: 'opencode', enabledAgents: ['opencode'] }));
        expect(r.action).toBe('skipped');
        expect(a.installHook).not.toHaveBeenCalled();
    });
    it('devCore installs baseline when links broken', () => {
        const a = spies();
        const m = machine(); m.devCore = { present: true, brokenLinks: ['brainstorming'] };
        expect(stepDevCore(deps({ machine: m, project: null }, a)).action).toBe('applied');
        expect(a.installBundle).toHaveBeenCalled();
    });
    it('devCore installs when not present at all', () => {
        const a = spies();
        const m = machine(); m.devCore = { present: false, brokenLinks: [] };
        expect(stepDevCore(deps({ machine: m, project: null }, a)).action).toBe('applied');
        expect(a.installBundle).toHaveBeenCalled();
    });
    // Regression for the confirmed production bug: `awm init -a copilot` crashed
    // 100% of the time with "machine.devCore: skill global scope is not
    // supported by Copilot...", rolling back the ENTIRE init transaction (even
    // project-local artifacts like AGENTS.md). Root cause: Copilot has no
    // global skill directory (providerFor('copilot').skill.global === null),
    // so gatherMachine's devCorePresent was permanently false for it, and
    // stepDevCore fell through to installBundle at global scope on every run
    // — an install that always throws. Fixed in diagnostics/context.ts:
    // devCore.present is now reported `true` (N/A treated as satisfied) when
    // skill.global is null, so this step's existing skip guard applies
    // naturally.
    //
    // Unlike the rest of this describe block (which hand-builds `machine()`
    // fixtures — a fine choice for exercising stepDevCore's own skip-guard
    // logic in isolation), this test calls the REAL `gatherContext` (the
    // function diagnostics/context.ts's fix actually lives in) with an
    // isolated HOME/AWM_HOME, and feeds ITS real output into stepDevCore.
    // That's deliberate: an earlier version of this test hand-built
    // `devCore: { present: true, brokenLinks: [] }` directly and asserted
    // against it, which only re-verified stepDevCore's pre-existing skip
    // guard — reverting the context.ts fix left that version GREEN because it
    // never called the fixed code at all. This version goes RED on revert:
    // gatherContext would then report `devCore.present: false` for Copilot,
    // stepDevCore would fall through to `installBundle`, and the assertions
    // below (`action === 'skipped'`, `installBundle` not called) would fail.
    it('devCore skips cleanly (never calls installBundle) for an agent with no global skill directory (copilot) — via real gatherContext', () => {
        expect(providerFor('copilot').skill.global).toBeNull();

        const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-steps-copilot-devcore-'));
        const originalHome = process.env.HOME;
        const originalAwmHome = process.env.AWM_HOME;
        try {
            process.env.HOME = tmpHome;
            process.env.AWM_HOME = path.join(tmpHome, '.awm');

            const baselineBundle = bundle('dev-core', 'baseline', ['brainstorming']);
            const ctx = gatherContext({ cwd: tmpHome, bundles: [baselineBundle], agent: 'copilot' });

            const a = spies();
            const r = stepDevCore(deps({ machine: ctx.machine, project: null }, a, {
                agent: 'copilot', enabledAgents: ['copilot'], bundles: [baselineBundle],
            }));
            expect(r.action).toBe('skipped');
            expect(a.installBundle).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(tmpHome, { recursive: true, force: true });
            if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
            if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
        }
    });

    it('ambient installs only missing wanted', () => {
        const a = spies();
        const m = machine(); m.ambient = { wanted: ['personal-notion', 'docs'], installed: ['docs'] };
        const r = stepAmbient(deps({ machine: m, project: null }, a));
        expect(r.action).toBe('applied');
        expect(a.installBundle).toHaveBeenCalledTimes(1);
    });
    it('ambient skips when nothing wanted', () => {
        const a = spies();
        expect(stepAmbient(deps({ machine: machine(), project: null }, a)).action).toBe('skipped');
    });

    // Regression coverage for the BLOCKER found in post-implementation QA:
    // stepDevCore/stepAmbient used to pass a `[d.agent]` singleton as
    // `agents`, which install-planner.ts's `assertCompleteSharedGroup` (R14)
    // refuses whenever a co-owner sharing the same physical skill directory
    // (OpenCode and Codex both resolve to ~/.agents/skills) is independently
    // enabled — making `awm init --agent codex` structurally fail once
    // OpenCode was already enabled, and vice versa.
    it('devCore includes a co-enabled agent sharing the same skill target (codex + opencode)', () => {
        const a = spies();
        const m = machine(); m.devCore = { present: false, brokenLinks: [] };
        const r = stepDevCore(deps({ machine: m, project: null }, a, {
            agent: 'codex', enabledAgents: ['claude-code', 'opencode', 'codex'],
        }));
        expect(r.action).toBe('applied');
        expect(a.installBundle).toHaveBeenCalledWith(
            expect.objectContaining({ agents: expect.arrayContaining(['codex', 'opencode']) }),
        );
        const call = a.installBundle.mock.calls[0][0];
        expect(call.agents).toHaveLength(2); // claude-code is NOT included — it doesn't share the skill target
    });

    it('devCore does not add a co-owner that is not currently enabled', () => {
        const a = spies();
        const m = machine(); m.devCore = { present: false, brokenLinks: [] };
        const r = stepDevCore(deps({ machine: m, project: null }, a, {
            agent: 'codex', enabledAgents: ['claude-code', 'codex'],
        }));
        expect(r.action).toBe('applied');
        expect(a.installBundle).toHaveBeenCalledWith(expect.objectContaining({ agents: ['codex'] }));
    });

    it('devCore never adds a co-owner for claude-code (its skill dir is never shared)', () => {
        const a = spies();
        const m = machine(); m.devCore = { present: false, brokenLinks: [] };
        const r = stepDevCore(deps({ machine: m, project: null }, a, {
            agent: 'claude-code', enabledAgents: ['claude-code', 'opencode', 'codex'],
        }));
        expect(r.action).toBe('applied');
        expect(a.installBundle).toHaveBeenCalledWith(expect.objectContaining({ agents: ['claude-code'] }));
    });

    it('ambient includes a co-enabled agent sharing the same skill target (codex + opencode)', () => {
        const a = spies();
        const m = machine(); m.ambient = { wanted: ['docs'], installed: [] };
        const r = stepAmbient(deps({ machine: m, project: null }, a, {
            agent: 'opencode', enabledAgents: ['claude-code', 'opencode', 'codex'],
        }));
        expect(r.action).toBe('applied');
        const call = a.installBundle.mock.calls[0][0];
        expect(call.agents.sort()).toEqual(['codex', 'opencode']);
    });
});

describe('stepProfile', () => {
    it('adds confirmed extension when detector finds a match', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-step-profile-'));
        try {
            fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
            const a = spies();
            const ctx: HarnessContext = {
                machine: machine(),
                project: project({ root, profile: { present: true, extensions: [] } }),
            };
            const r = await stepProfile(deps(ctx, a, { confirmExtensions: async (p) => p }));
            expect(r.action).toBe('applied');
            expect(a.addExtension).toHaveBeenCalledWith(root, 'frontend');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    it('skips when confirm returns empty', async () => {
        const a = spies();
        const ctx: HarnessContext = { machine: machine(), project: project() };
        const r = await stepProfile(deps(ctx, a, { confirmExtensions: async () => [] }));
        expect(a.addExtension).not.toHaveBeenCalled();
        expect(r.action).toBe('skipped');
    });

    it('does not invoke confirmExtensions when no new extensions are proposed (#1 guard)', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-ext-'));
        try {
            const a = spies();
            const confirm = jest.fn(async (p: string[]) => p);
            const ctx: HarnessContext = {
                machine: machine(),
                project: project({ root, profile: { present: true, extensions: [] } }),
            };
            const r = await stepProfile(deps(ctx, a, { confirmExtensions: confirm }));
            expect(confirm).not.toHaveBeenCalled();
            expect(r.action).toBe('skipped');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('bootstraps an empty profile when none exists and no extensions are proposed', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bootstrap-profile-'));
        try {
            const a = spies();
            const ctx: HarnessContext = {
                machine: machine(),
                project: project({ root, profile: { present: false, extensions: [] } }),
            };
            const r = await stepProfile(deps(ctx, a, { confirmExtensions: async (p) => p }));
            expect(r.action).toBe('applied');
            expect(a.ensureProfile).toHaveBeenCalledWith(root);
            expect(a.addExtension).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not bootstrap when the profile already exists', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-existing-profile-'));
        try {
            const a = spies();
            const ctx: HarnessContext = {
                machine: machine(),
                project: project({ root, profile: { present: true, extensions: [] } }),
            };
            const r = await stepProfile(deps(ctx, a));
            expect(r.action).toBe('skipped');
            expect(a.ensureProfile).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('stepActivation', () => {
    it('skips when expected all linked and none broken', () => {
        const a = spies();
        a.gatherProject = jest.fn((_cwd: string, _bundles: any) => project({ activeBundles: { expected: ['x'], linked: ['x'], broken: [] } }));
        const r = stepActivation(deps({ machine: machine(), project: project() }, a));
        expect(r.action).toBe('skipped');
        expect(a.syncProfile).not.toHaveBeenCalled();
    });
    it('syncs when links missing', () => {
        const a = spies();
        a.gatherProject = jest.fn((_cwd: string, _bundles: any) => project({ activeBundles: { expected: ['x', 'y'], linked: ['x'], broken: [] } }));
        const r = stepActivation(deps({ machine: machine(), project: project() }, a));
        expect(r.action).toBe('applied');
        expect(a.syncProfile).toHaveBeenCalled();
    });
    it('passes target agent to gatherProject (#4 — project local skills scoped to agent)', () => {
        const a = spies();
        const m = machine();
        m.devCore = { present: true, brokenLinks: [] };
        const ctx = { machine: m, project: project() };
        stepActivation(deps(ctx, a, { agent: 'opencode' }));
        expect(a.gatherProject).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'opencode');
    });

    // Same class of bug as stepDevCore/stepAmbient's shared-group regression
    // above, in the LOCAL-scope (project) code path: OpenCode and Codex share
    // both their global AND local skill directories, so a project extension
    // with a skill artifact hits the identical R14 refusal whenever
    // syncProfile is called with a `[d.agent]` singleton and a co-owner is
    // independently enabled.
    it('activation includes a co-enabled agent sharing the same LOCAL skill target (codex + opencode)', () => {
        const a = spies();
        a.gatherProject = jest.fn((_cwd: string, _bundles: any) => project({ activeBundles: { expected: ['x'], linked: [], broken: [] } }));
        const r = stepActivation(deps({ machine: machine(), project: project() }, a, {
            agent: 'codex', enabledAgents: ['claude-code', 'opencode', 'codex'],
        }));
        expect(r.action).toBe('applied');
        const call = a.syncProfile.mock.calls[0][0];
        expect(call.agents.sort()).toEqual(['codex', 'opencode']);
    });

    it('activation does not add a co-owner that is not currently enabled', () => {
        const a = spies();
        a.gatherProject = jest.fn((_cwd: string, _bundles: any) => project({ activeBundles: { expected: ['x'], linked: [], broken: [] } }));
        const r = stepActivation(deps({ machine: machine(), project: project() }, a, {
            agent: 'codex', enabledAgents: ['claude-code', 'codex'],
        }));
        expect(r.action).toBe('applied');
        expect(a.syncProfile).toHaveBeenCalledWith(expect.objectContaining({ agents: ['codex'] }));
    });
});

describe('stepSensors', () => {
    it('skips when sensors present', () => {
        const a = spies();
        expect(stepSensors(deps({ machine: machine(), project: project() }, a)).action).toBe('skipped');
    });
    it('inits sensors when absent', () => {
        const a = spies();
        const r = stepSensors(deps({ machine: machine(), project: project({ sensors: { present: false } }) }, a));
        expect(r.action).toBe('applied');
        expect(a.initSensors).toHaveBeenCalledWith({ cwd: '/repo', registryRoot: '/cache/registry', configure: true }); // sensorPacksRoot='/cache/registry' from deps()
    });
});

describe('stepConstitution / stepContext (frontera agente)', () => {
    it('constitution pending + names the skill, never writes', () => {
        const a = spies();
        const r = stepConstitution(deps({ machine: machine(), project: project({ constitution: { present: false } }) }, a));
        expect(r.action).toBe('pending');
        expect(r.detail).toContain('project-constitution');
    });
    it('context pending names project-context-init', () => {
        const a = spies();
        const r = stepContext(deps({ machine: machine(), project: project({ context: { present: false } }) }, a));
        expect(r.action).toBe('pending');
        expect(r.detail).toContain('project-context-init');
    });
    it('both skip when present', () => {
        const a = spies();
        const ctx: HarnessContext = { machine: machine(), project: project() };
        expect(stepConstitution(deps(ctx, a)).action).toBe('skipped');
        expect(stepContext(deps(ctx, a)).action).toBe('skipped');
    });
});

describe('stepGlobalSkillsRepair', () => {
    it('skips when nothing is broken', () => {
        const a = spies();
        const m = machine(); // globalSkills.repairable=[], dead=[] by default
        const r = stepGlobalSkillsRepair(deps({ machine: m, project: null }, a));
        expect(r.action).toBe('skipped');
        expect(a.repairGlobalSkills).not.toHaveBeenCalled();
    });

    it('applies repair when there are broken links', () => {
        const a = spies();
        (a as any).repairGlobalSkills = jest.fn(() => ({ relinked: ['b'], pruned: ['c'], failed: [] }));
        const m = machine();
        m.globalSkills = { valid: ['a'], repairable: ['b'], dead: ['c'] };
        const r = stepGlobalSkillsRepair(deps({ machine: m, project: null }, a));
        expect(r.action).toBe('applied');
        expect(a.repairGlobalSkills).toHaveBeenCalledTimes(1);
        expect(r.detail).toContain('re-linked 1');
        expect(r.detail).toContain('pruned 1');
    });

    it('repairs the target agent skills dir, not Claude (#4)', () => {
        const a = spies();
        (a as any).repairGlobalSkills = jest.fn(() => ({ relinked: ['b'], pruned: [], failed: [] }));
        const m = machine();
        m.globalSkills = { valid: [], repairable: ['b'], dead: [] };
        const r = stepGlobalSkillsRepair(deps({ machine: m, project: null }, a, { agent: 'opencode' }));
        expect(r.action).toBe('applied');
        expect(a.repairGlobalSkills).toHaveBeenCalledWith(providerFor('opencode').skill.global, expect.any(Array));
    });

    it('Gap C — skips cleanly for an agent whose skill.global is null (copilot), even with broken links reported', () => {
        const a = spies();
        expect(providerFor('copilot').skill.global).toBeNull();
        const m = machine();
        // Broken-count is nonzero, so the ONLY thing that can make this skip is the
        // null-global-dir guard itself, not the "nothing broken" early return above.
        m.globalSkills = { valid: [], repairable: ['b'], dead: ['c'] };
        const r = stepGlobalSkillsRepair(deps({ machine: m, project: null }, a, { agent: 'copilot' }));
        expect(r.action).toBe('skipped');
        expect(a.repairGlobalSkills).not.toHaveBeenCalled();
    });
});

describe('stepConstitutionInjection (#6)', () => {
    it('injects for a config-instructions agent when CONSTITUTION.md is present', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: true } }) }, a, { agent: 'opencode' }),
        );
        expect(r.action).toBe('applied');
        expect(a.injectProjectConstitution).toHaveBeenCalledWith({ projectRoot: '/repo', agent: 'opencode' });
    });

    it('skips for Claude (delivered by the hook), never touching the action', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: true } }) }, a, { agent: 'claude-code' }),
        );
        expect(r.action).toBe('skipped');
        expect(a.injectProjectConstitution).not.toHaveBeenCalled();
    });

    it('skips when CONSTITUTION.md is absent', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: false } }) }, a, { agent: 'opencode' }),
        );
        expect(r.action).toBe('skipped');
        expect(a.injectProjectConstitution).not.toHaveBeenCalled();
    });

    it('installs Codex project guidance before CONSTITUTION.md exists', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: false } }) }, a, { agent: 'codex' }),
        );
        expect(r.action).toBe('applied');
        expect(a.injectProjectConstitution).toHaveBeenCalledWith({ projectRoot: '/repo', agent: 'codex' });
    });

    it('maps already → skipped when CONSTITUTION.md was already in opencode.json', () => {
        const a = spies();
        a.injectProjectConstitution.mockReturnValue('already');
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: true } }) }, a, { agent: 'opencode' }),
        );
        expect(r.action).toBe('skipped');
        expect(r.detail).toBe('already');
    });
});

describe('stepContextInjection', () => {
    it('skips claude-code (covered by stepHook)', () => {
        const a = spies();
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'claude-code' }));
        expect(r.action).toBe('skipped');
        expect(a.installContext).not.toHaveBeenCalled();
    });

    it('skips an agent without an injection mechanism', () => {
        const a = spies();
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'antigravity' }));
        expect(r.action).toBe('skipped');
        expect(a.installContext).not.toHaveBeenCalled();
    });

    it('skips opencode when already injected', () => {
        const a = spies();
        (a as any).contextStatus = jest.fn(() => 'injected' as const);
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'opencode' }));
        expect(r.action).toBe('skipped');
        expect(a.installContext).not.toHaveBeenCalled();
    });

    it('installs context for opencode when absent', () => {
        const a = spies();
        (a as any).contextStatus = jest.fn(() => 'absent' as const);
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'opencode' }));
        expect(r.action).toBe('applied');
        expect(a.installContext).toHaveBeenCalledWith(expect.objectContaining({ agent: 'opencode', scope: 'global' }));
    });

    it('installs context for opencode when stale', () => {
        const a = spies();
        (a as any).contextStatus = jest.fn(() => 'stale' as const);
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'opencode' }));
        expect(r.action).toBe('applied');
        expect(a.installContext).toHaveBeenCalled();
    });

    it('installs the Codex global managed block when absent', () => {
        const a = spies();
        a.contextStatus.mockReturnValue('absent');
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'codex' }));
        expect(r.action).toBe('applied');
        expect(a.installContext).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', scope: 'global' }));
    });

    it('installs Copilot context at local scope with projectRoot (no global AGENTS.md-equivalent)', () => {
        const a = spies();
        a.contextStatus.mockReturnValue('absent');
        const r = stepContextInjection(deps({ machine: machine(), project: null }, a, { agent: 'copilot', cwd: '/repo' }));
        expect(r.action).toBe('applied');
        expect(a.installContext).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'copilot', scope: 'local', projectRoot: '/repo' }),
        );
    });

    it('regression: uses the discovered project root, not raw cwd, when awm init runs from a subdirectory (R4 QA blocker 2b)', () => {
        // mutation-targets.ts's planInitMutationTargets computes its local-scope backup
        // target via findProjectRoot(cwd), which walks UP from cwd to the real project
        // root. If this step passed raw d.cwd as projectRoot instead, a run from a
        // subdirectory would write to <cwd>/AGENTS.md while the backup session snapshotted
        // <root>/AGENTS.md — a failed init's rollback would miss the real write entirely.
        const a = spies();
        a.contextStatus.mockReturnValue('absent');
        const r = stepContextInjection(deps(
            { machine: machine(), project: project({ root: '/repo' }) },
            a,
            { agent: 'copilot', cwd: '/repo/packages/sub' },
        ));
        expect(r.action).toBe('applied');
        expect(a.installContext).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'copilot', scope: 'local', projectRoot: '/repo' }),
        );
    });

    it('falls back to raw cwd when no project was discovered', () => {
        const a = spies();
        a.contextStatus.mockReturnValue('absent');
        const r = stepContextInjection(deps(
            { machine: machine(), project: null },
            a,
            { agent: 'copilot', cwd: '/nowhere' },
        ));
        expect(r.action).toBe('applied');
        expect(a.installContext).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'copilot', scope: 'local', projectRoot: '/nowhere' }),
        );
    });
});
