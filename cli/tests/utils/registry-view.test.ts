import { buildPackageView, STANDALONE_NAME } from '../../src/utils/registry-view';
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
