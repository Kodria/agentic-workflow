import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    stepCache, stepHook, stepDevCore, stepAmbient,
    stepProfile, stepActivation, stepSensors, stepConstitution, stepContext,
    stepContextInjection, stepGlobalSkillsRepair,
} from '../../../src/core/init/steps';
import type { InitDeps, InitActions } from '../../../src/core/init/types';
import type { HarnessContext, ProjectFacts } from '../../../src/core/diagnostics/types';
import type { BundleDefinition } from '../../../src/core/bundles';

function bundle(name: string, scope: BundleDefinition['scope'], skills: string[]): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: skills.map((s) => ({ name: s, onSignal: false })),
        workflows: [], agents: [],
    };
}

function machine(): HarnessContext['machine'] {
    return {
        cliSource: { present: true, version: '1.0.0', gitState: 'clean' },
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
        gatherProject: jest.fn((_cwd: string, _bundles: any) => null),
        contextStatus: jest.fn(() => 'absent' as const),
        installContext: jest.fn(),
        repairGlobalSkills: jest.fn(() => ({ relinked: [], pruned: [], failed: [] })),
    } as unknown as jest.Mocked<InitActions>;
}

function deps(ctx: HarnessContext, actions: InitActions, over: Partial<InitDeps> = {}): InitDeps {
    return {
        cwd: '/repo', ctx, bundles: [bundle('dev', 'baseline', ['brainstorming'])],
        agent: 'claude-code', installMethod: 'symlink',
        registryRoot: '/cache', contentDir: '/cache/registry',
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
    it('syncs when cli absent', async () => {
        const a = spies();
        const m = machine(); m.cliSource = { present: false };
        const r = await stepCache(deps({ machine: m, project: null }, a));
        expect(r.action).toBe('applied');
        expect(a.syncCache).toHaveBeenCalled();
    });
    it('syncs when cli behind', async () => {
        const a = spies();
        const m = machine(); m.cliSource = { present: true, gitState: 'behind' };
        expect((await stepCache(deps({ machine: m, project: null }, a))).action).toBe('applied');
    });
    it('reports failed when syncCache throws (does not throw)', async () => {
        const a = spies();
        a.syncCache = jest.fn(async () => { throw new Error('net down'); });
        const m = machine(); m.cliSource = { present: false };
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
        expect(a.initSensors).toHaveBeenCalledWith({ cwd: '/repo', registryRoot: '/cache/registry', configure: true });
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
});
