import {
  buildPackageView, STANDALONE_NAME, packageSummaryLines, packageDetailLines,
  packagePickerItems, artifactPickerItems,
  findPackage, artifactCountLabel, ALL_SENTINEL, artifactValue, resolveLevel2Selection
} from '../../src/utils/registry-view';
import { SkillArtifact, WorkflowArtifact, AgentArtifact } from '../../src/core/discovery';
import { BundleDefinition } from '../../src/core/bundles';

const skill = (name: string, description = ''): SkillArtifact => ({ name, path: `/s/${name}`, description });
const wf = (name: string, description = ''): WorkflowArtifact => ({ name, path: `/w/${name}.md`, description });
const agent = (name: string, description = ''): AgentArtifact => ({ name, path: `/a/${name}.md`, description });

const bundle = (over: Partial<BundleDefinition> & { name: string }): BundleDefinition => ({
    description: '', version: '1.0.0', scope: 'project', visibility: 'public',
    dependsOn: [], skills: [], workflows: [], agents: [], ...over,
});

const processes: BundleDefinition[] = [
    bundle({ name: 'core-dev', description: 'Dev lifecycle', scope: 'baseline',
        skills: [{ name: 'brainstorming', onSignal: false }, { name: 'shared', onSignal: false }],
        workflows: ['exec'], agents: ['plan'] }),
    bundle({ name: 'docs', description: 'Docs as code',
        skills: [{ name: 'shared', onSignal: false }] }),
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

    it('returns empty array when no values are selected', () => {
        expect(resolveLevel2Selection(core, [])).toEqual([]);
    });
});

describe('visibility', () => {
    it('marks a private bundle on its PackageView', () => {
        const priv: BundleDefinition[] = [
            bundle({ name: 'secret', description: 'private', visibility: 'private',
                skills: [{ name: 'a', onSignal: false }] }),
        ];
        const view = buildPackageView([skill('a')], [], [], priv);
        expect(view.find((p) => p.name === 'secret')!.visibility).toBe('private');
    });

    it('defaults visibility to public', () => {
        const view = buildPackageView([skill('brainstorming')], [], [], processes);
        expect(view.find((p) => p.name === 'core-dev')!.visibility).toBe('public');
    });
});

describe('packageSummaryLines width-awareness', () => {
  it('truncates the description column when a width is given', () => {
    const view = buildPackageView([skill('brainstorming', 'x'.repeat(200))], [], [], [
      bundle({ name: 'core-dev', description: 'x'.repeat(200), skills: [{ name: 'brainstorming', onSignal: false }] }),
    ]);
    const lines = packageSummaryLines(view, 60);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(60);
    expect(lines.some((l) => l.includes('…'))).toBe(true);
  });
  it('does not truncate when no width is given (piped output)', () => {
    const view = buildPackageView([skill('brainstorming', 'y'.repeat(200))], [], [], [
      bundle({ name: 'core-dev', description: 'z'.repeat(200), skills: [{ name: 'brainstorming', onSignal: false }] }),
    ]);
    const lines = packageSummaryLines(view); // no width
    expect(lines.some((l) => l.includes('z'.repeat(200)))).toBe(true);
  });
});

describe('artifactPickerItems', () => {
  it('prepends an "install entire package" sentinel item, then one per artifact', () => {
    const view = buildPackageView([skill('a', 'desc a'), skill('b', 'desc b')], [], [], [
      bundle({ name: 'p', description: 'pkg', skills: [{ name: 'a', onSignal: false }, { name: 'b', onSignal: false }] }),
    ]);
    const items = artifactPickerItems(view.find((p) => p.name === 'p')!);
    expect(items[0].value).toBe(ALL_SENTINEL);
    expect(items.slice(1).map((i) => i.label)).toEqual(['a', 'b']);
    expect(items.find((i) => i.label === 'a')!.description).toBe('desc a');
  });
});

describe('packagePickerItems', () => {
  it('builds one item per package with a count+description summary', () => {
    const view = buildPackageView([skill('a')], [], [], [
      bundle({ name: 'p', description: 'pkg desc', skills: [{ name: 'a', onSignal: false }] }),
    ]);
    const items = packagePickerItems(view);
    expect(items[0].value).toBe('p');
    expect(items[0].description).toContain('pkg desc');
  });
});
