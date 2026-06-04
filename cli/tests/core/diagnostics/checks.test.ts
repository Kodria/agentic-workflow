import { runChecks } from '../../../src/core/diagnostics/checks';
import { HarnessContext, ProjectFacts } from '../../../src/core/diagnostics/types';

function healthyMachine(): HarnessContext['machine'] {
    return {
        cliSource: { present: true, version: '1.0.0', gitState: 'clean' },
        hook: { present: true, degraded: false },
        devCore: { present: true, brokenLinks: [] },
        ambient: { wanted: [], installed: [] },
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
        m.cliSource.gitState = 'behind'; // warn
        expect(runChecks({ machine: m, project: null }).overall).toBe('healthy');
    });
});

describe('runChecks — machine.cli', () => {
    it('ok + version label when cache clean', () => {
        const c = byId({ machine: healthyMachine(), project: null }, 'machine.cli');
        expect(c.status).toBe('ok');
        expect(c.label).toBe('CLI v1.0.0');
        expect(c.remedy).toEqual({ kind: 'none' });
    });

    it('warn → awm update when behind', () => {
        const m = healthyMachine(); m.cliSource.gitState = 'behind';
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm update' });
    });

    it('warn + no action when dirty/unknown', () => {
        const m = healthyMachine(); m.cliSource.gitState = 'dirty';
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'none' });
    });

    it('missing → awm init when cache absent', () => {
        const m = healthyMachine(); m.cliSource = { present: false };
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
