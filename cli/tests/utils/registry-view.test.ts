import { buildPackageView, STANDALONE_NAME, packageSummaryLines, packageDetailLines, findPackage, artifactCountLabel, ALL_SENTINEL, buildLevel1Options, buildLevel2Options, resolveLevel2Selection } from '../../src/utils/registry-view';
import { SkillArtifact, WorkflowArtifact, AgentArtifact, ProcessDefinition } from '../../src/core/discovery';

const skill = (name: string, description = ''): SkillArtifact => ({ name, path: `/s/${name}`, description });
const wf = (name: string, description = ''): WorkflowArtifact => ({ name, path: `/w/${name}.md`, description });
const agent = (name: string, description = ''): AgentArtifact => ({ name, path: `/a/${name}.md`, description });

const processes: ProcessDefinition[] = [
    { name: 'core-dev', description: 'Dev lifecycle', skills: ['brainstorming', 'shared'], workflows: ['exec'], agents: ['plan'] },
    { name: 'docs', description: 'Docs as code', skills: ['shared'], workflows: [], agents: [] },
];

describe('buildPackageView', () => {
    it('groups artifacts under their package with correct counts and install names', () => {
        const view = buildPackageView(
            [skill('brainstorming', 'explore'), skill('shared')],
            [wf('exec')],
            [agent('plan')],
            processes
        );
        const core = view.find((p) => p.name === 'core-dev')!;
        expect(core.description).toBe('Dev lifecycle');
        expect(core.counts).toEqual({ skills: 2, workflows: 1, agents: 1 });
        expect(core.artifacts.find((a) => a.type === 'skill' && a.name === 'brainstorming')!.installName).toBe('brainstorming');
        expect(core.artifacts.find((a) => a.type === 'workflow')!.installName).toBe('exec.md');
        expect(core.artifacts.find((a) => a.type === 'agent')!.installName).toBe('plan.md');
        expect(core.artifacts.find((a) => a.name === 'brainstorming')!.description).toBe('explore');
    });

    it('places an artifact that belongs to two packages in both', () => {
        const view = buildPackageView([skill('shared')], [], [], processes);
        const names = view.map((p) => p.name);
        expect(names).toContain('core-dev');
        expect(names).toContain('docs');
    });

    it('collects orphan artifacts into a standalone package', () => {
        const view = buildPackageView([skill('orphan')], [], [], processes);
        const standalone = view.find((p) => p.name === STANDALONE_NAME)!;
        expect(standalone.isStandalone).toBe(true);
        expect(standalone.artifacts.map((a) => a.name)).toEqual(['orphan']);
    });

    it('omits empty packages and omits standalone when there are no orphans', () => {
        const view = buildPackageView([skill('brainstorming')], [], [], processes);
        expect(view.map((p) => p.name)).toEqual(['core-dev']);
    });
});

describe('artifactCountLabel', () => {
    it('labels a skills-only package', () => {
        expect(artifactCountLabel({ skills: 30, workflows: 0, agents: 0 })).toBe('30 skills');
    });
    it('singularizes one skill', () => {
        expect(artifactCountLabel({ skills: 1, workflows: 0, agents: 0 })).toBe('1 skill');
    });
    it('appends workflow and agent counts when present', () => {
        expect(artifactCountLabel({ skills: 2, workflows: 1, agents: 1 })).toBe('2 skills · 1 workflow · 1 agent');
    });
});

describe('packageSummaryLines', () => {
    it('renders one aligned line per package plus a header count', () => {
        const view = buildPackageView(
            [skill('brainstorming'), skill('shared')],
            [],
            [],
            processes
        );
        const lines = packageSummaryLines(view);
        expect(lines[0]).toContain('2 packages');
        expect(lines.some((l) => l.includes('core-dev') && l.includes('Dev lifecycle'))).toBe(true);
        expect(lines.some((l) => l.includes('docs'))).toBe(true);
    });
});

describe('packageDetailLines', () => {
    it('lists each artifact and its description', () => {
        const view = buildPackageView([skill('brainstorming', 'explore intent')], [], [], processes);
        const core = view.find((p) => p.name === 'core-dev')!;
        const lines = packageDetailLines(core).join('\n');
        expect(lines).toContain('core-dev');
        expect(lines).toContain('brainstorming');
        expect(lines).toContain('explore intent');
    });
});

describe('findPackage', () => {
    const view = buildPackageView([skill('brainstorming')], [], [], processes);
    it('matches by exact name (case-insensitive)', () => {
        expect(findPackage(view, 'Core-Dev').match!.name).toBe('core-dev');
    });
    it('suggests the closest package on a miss', () => {
        const res = findPackage(view, 'cor');
        expect(res.match).toBeUndefined();
        expect(res.suggestion).toBe('core-dev');
    });
    it('falls back to prefix suggestion when no substring match exists', () => {
        const res = findPackage(view, 'xyz');
        expect(res.match).toBeUndefined();
        expect(res.suggestion).toBe('core-dev');
    });
});

describe('buildLevel1Options', () => {
    it('produces one option per package keyed by package name', () => {
        const view = buildPackageView([skill('brainstorming'), skill('shared')], [], [], processes);
        const opts = buildLevel1Options(view);
        expect(opts.map((o) => o.value).sort()).toEqual(['core-dev', 'docs']);
        expect(opts.find((o) => o.value === 'core-dev')!.label).toContain('core-dev');
        expect(opts.find((o) => o.value === 'core-dev')!.label).toContain('Dev lifecycle');
    });
});

describe('buildLevel2Options', () => {
    it('puts an "install entire package" sentinel first, then one option per artifact', () => {
        const view = buildPackageView([skill('brainstorming', 'explore')], [wf('exec')], [agent('plan')], processes);
        const core = view.find((p) => p.name === 'core-dev')!;
        const opts = buildLevel2Options(core);
        expect(opts[0].value).toBe(ALL_SENTINEL);
        expect(opts[0].label).toContain('Install entire package');
        const values = opts.slice(1).map((o) => o.value);
        expect(values).toContain('skill:brainstorming');
        expect(values).toContain('workflow:exec');
        expect(values).toContain('agent:plan');
        // description embedded in the label (always-visible, multi-line)
        expect(opts.find((o) => o.value === 'skill:brainstorming')!.label).toContain('explore');
    });
});

describe('resolveLevel2Selection', () => {
    const view = buildPackageView([skill('brainstorming'), skill('shared')], [], [], processes);
    const core = view.find((p) => p.name === 'core-dev')!;

    it('returns all artifacts when the sentinel is selected', () => {
        const out = resolveLevel2Selection(core, [ALL_SENTINEL]);
        expect(out.map((a) => a.name).sort()).toEqual(['brainstorming', 'shared']);
    });

    it('returns only the cherry-picked artifacts otherwise', () => {
        const out = resolveLevel2Selection(core, ['skill:brainstorming']);
        expect(out.map((a) => a.name)).toEqual(['brainstorming']);
    });
});
