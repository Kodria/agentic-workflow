import { runChecks } from '../../../src/core/diagnostics/checks';
import { HarnessContext, ProjectFacts } from '../../../src/core/diagnostics/types';
import { AgentTarget } from '../../../src/providers';
import { InjectionState } from '../../../src/core/context/types';

function healthyMachine(): HarnessContext['machine'] {
    return {
        registryCache: { present: true, gitState: 'clean' },
        hook: { present: true, degraded: false },
        devCore: { present: true, brokenLinks: [] },
        ambient: { wanted: [], installed: [] },
        contextInjection: [],
        globalSkills: { valid: [], repairable: [], dead: [] },
    };
}

function healthyProject(): ProjectFacts {
    return {
        root: '/repo/belanz',
        profile: { present: true, extensions: ['frontend'] },
        activeBundles: { expected: ['frontend-craft'], linked: ['frontend-craft'], broken: [] },
        sensors: { present: true },
        constitution: { present: true },
        context: { present: true, file: 'CLAUDE.md' },
    };
}

function byId(ctx: HarnessContext, id: string) {
    return runChecks(ctx).results.find((r) => r.id === id)!;
}

describe('runChecks — overall', () => {
    it('is healthy when machine is fully ok and there is no project', () => {
        const report = runChecks({ machine: healthyMachine(), project: null });
        expect(report.overall).toBe('healthy');
        expect(report.hasProject).toBe(false);
        expect(report.projectName).toBeUndefined();
    });

    it('is healthy when machine and project are fully ok', () => {
        const report = runChecks({ machine: healthyMachine(), project: healthyProject() });
        expect(report.overall).toBe('healthy');
        expect(report.hasProject).toBe(true);
        expect(report.projectName).toBe('belanz');
    });

    it('degrades when any check is missing', () => {
        const m = healthyMachine();
        m.hook.present = false;
        expect(runChecks({ machine: m, project: null }).overall).toBe('degraded');
    });

    it('does NOT degrade on warn-only states', () => {
        const m = healthyMachine();
        m.registryCache.gitState = 'behind'; // warn
        expect(runChecks({ machine: m, project: null }).overall).toBe('healthy');
    });
});

describe('runChecks — machine.cli', () => {
    it('ok when cache clean', () => {
        const c = byId({ machine: healthyMachine(), project: null }, 'machine.cli');
        expect(c.status).toBe('ok');
        expect(c.label).toBe('CLI');
        expect(c.remedy).toEqual({ kind: 'none' });
    });

    it('warn → awm update when behind', () => {
        const m = healthyMachine(); m.registryCache.gitState = 'behind';
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm update' });
    });

    it('warn + no action when dirty/unknown', () => {
        const m = healthyMachine(); m.registryCache.gitState = 'dirty';
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'none' });
    });

    it('missing → awm init when cache absent', () => {
        const m = healthyMachine(); m.registryCache = { present: false };
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm init' });
    });
});

describe('runChecks — machine.hook / devCore', () => {
    it('hook degraded → warn', () => {
        const m = healthyMachine(); m.hook = { present: true, degraded: true };
        expect(byId({ machine: m, project: null }, 'machine.hook').status).toBe('warn');
    });

    it('hook absent → missing + awm init', () => {
        const m = healthyMachine(); m.hook = { present: false };
        const c = byId({ machine: m, project: null }, 'machine.hook');
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm init' });
    });

    it('devCore with broken links → warn', () => {
        const m = healthyMachine(); m.devCore = { present: true, brokenLinks: ['brainstorming'] };
        expect(byId({ machine: m, project: null }, 'machine.devCore').status).toBe('warn');
    });

    it('devCore absent → missing', () => {
        const m = healthyMachine(); m.devCore = { present: false, brokenLinks: [] };
        expect(byId({ machine: m, project: null }, 'machine.devCore').status).toBe('missing');
    });
});

describe('runChecks — machine.ambient (dynamic)', () => {
    it('emits no ambient rows when nothing is wanted', () => {
        const report = runChecks({ machine: healthyMachine(), project: null });
        expect(report.results.some((r) => r.id.startsWith('machine.ambient.'))).toBe(false);
    });

    it('one row per wanted bundle, missing → awm add <b>', () => {
        const m = healthyMachine();
        m.ambient = { wanted: ['personal-notion', 'docs'], installed: ['docs'] };
        const report = runChecks({ machine: m, project: null });
        const notion = report.results.find((r) => r.id === 'machine.ambient.personal-notion')!;
        const docs = report.results.find((r) => r.id === 'machine.ambient.docs')!;
        expect(notion.status).toBe('missing');
        expect(notion.remedy).toEqual({ kind: 'command', value: 'awm add personal-notion' });
        expect(docs.status).toBe('ok');
        expect(report.overall).toBe('degraded');
    });
});

describe('runChecks — project', () => {
    it('omits project checks when project is null', () => {
        const report = runChecks({ machine: healthyMachine(), project: null });
        expect(report.results.some((r) => r.level === 'project')).toBe(false);
    });

    it('constitution absent → missing + skill remedy (degrades)', () => {
        const p = healthyProject(); p.constitution = { present: false };
        const report = runChecks({ machine: healthyMachine(), project: p });
        const c = report.results.find((r) => r.id === 'project.constitution')!;
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'skill', value: 'project-constitution' });
        expect(report.overall).toBe('degraded');
    });

    it('context absent → warn + skill remedy (does NOT degrade)', () => {
        const p = healthyProject(); p.context = { present: false };
        const report = runChecks({ machine: healthyMachine(), project: p });
        const c = report.results.find((r) => r.id === 'project.context')!;
        expect(c.status).toBe('warn');
        expect(c.label).toBe('contexto del agente (CLAUDE.md/AGENTS.md) ausente');
        expect(c.remedy).toEqual({ kind: 'skill', value: 'project-context-init' });
        expect(report.overall).toBe('healthy');
    });

    it('activation with missing links → missing + awm sync', () => {
        const p = healthyProject();
        p.activeBundles = { expected: ['frontend-craft', 'impeccable'], linked: ['frontend-craft'], broken: [] };
        const c = runChecks({ machine: healthyMachine(), project: p }).results.find((r) => r.id === 'project.activation')!;
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm sync' });
    });

    it('sensors absent → missing + awm sensors init', () => {
        const p = healthyProject(); p.sensors = { present: false };
        const c = runChecks({ machine: healthyMachine(), project: p }).results.find((r) => r.id === 'project.sensors')!;
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm sensors init' });
    });
});

describe('machineChecks — global skill integrity', () => {
    function machineCtx(globalSkills: { valid: string[]; repairable: string[]; dead: string[] }): HarnessContext {
        return {
            machine: {
                registryCache: { present: true, gitState: 'clean' },
                hook: { present: true, degraded: false },
                devCore: { present: true, brokenLinks: [] },
                ambient: { wanted: [], installed: [] },
                contextInjection: [],
                globalSkills,
            },
            project: null,
        };
    }

    it('ok when no broken global skill links', () => {
        const report = runChecks(machineCtx({ valid: ['a'], repairable: [], dead: [] }));
        const row = report.results.find((r) => r.id === 'machine.globalSkills');
        expect(row?.status).toBe('ok');
    });

    it('warns with awm init remedy when there are broken links', () => {
        const report = runChecks(machineCtx({ valid: ['a'], repairable: ['b'], dead: ['c'] }));
        const row = report.results.find((r) => r.id === 'machine.globalSkills');
        expect(row?.status).toBe('warn');
        expect(row?.detail).toContain('2'); // 1 repairable + 1 dead
        expect(row?.remedy).toEqual({ kind: 'command', value: 'awm init' });
    });
});

describe('machine.context.<agent> checks', () => {
    function machineWith(contextInjection: { agent: AgentTarget; state: InjectionState }[]) {
        return { ...healthyMachine(), contextInjection };
    }

    it('ok when context is injected for an agent', () => {
        const r = runChecks({ machine: machineWith([{ agent: 'opencode', state: 'injected' }]), project: null });
        const row = r.results.find((x) => x.id === 'machine.context.opencode')!;
        expect(row.status).toBe('ok');
        expect(row.remedy).toEqual({ kind: 'none' });
    });

    it('missing + awm init remedy when absent (degrades overall)', () => {
        const r = runChecks({ machine: machineWith([{ agent: 'opencode', state: 'absent' }]), project: null });
        const row = r.results.find((x) => x.id === 'machine.context.opencode')!;
        expect(row.status).toBe('missing');
        expect(row.remedy).toEqual({ kind: 'command', value: 'awm init' });
        expect(r.overall).toBe('degraded');
    });

    it('warn when stale', () => {
        const r = runChecks({ machine: machineWith([{ agent: 'claude-code', state: 'stale' }]), project: null });
        expect(r.results.find((x) => x.id === 'machine.context.claude-code')!.status).toBe('warn');
    });
});
