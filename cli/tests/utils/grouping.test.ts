import { buildGroupedOptions, GroupableArtifact } from '../../src/utils/grouping';
import { BundleDefinition } from '../../src/core/bundles';

const bundle = (over: Partial<BundleDefinition> & { name: string }): BundleDefinition => ({
    description: '', version: '1.0.0', scope: 'project', visibility: 'public',
    dependsOn: [], skills: [], workflows: [], agents: [], ...over,
});

const processes: BundleDefinition[] = [
    bundle({ name: 'core-dev', description: 'Core development skills',
        skills: [{ name: 'brainstorming', onSignal: false }, { name: 'shared-skill', onSignal: false }],
        workflows: [], agents: [] }),
    bundle({ name: 'docs', description: 'Documentation skills',
        skills: [{ name: 'docs-assistant', onSignal: false }, { name: 'shared-skill', onSignal: false }],
        workflows: [], agents: [] }),
];

const formatLabel = (c: { baseName: string }) => c.baseName;

describe('buildGroupedOptions', () => {
    it('shows a skill that belongs to two processes in both process groups', () => {
        const artifacts: GroupableArtifact[] = [
            { name: 'shared-skill', type: 'skill' }
        ];

        const options = buildGroupedOptions(artifacts, processes, formatLabel);

        const groupLabels = options
            .filter(o => o.value._group)
            .map(o => o.value.processName);

        expect(groupLabels).toContain('core-dev');
        expect(groupLabels).toContain('docs');
    });

    it('shows a skill only in standalone when it belongs to no process', () => {
        const artifacts: GroupableArtifact[] = [
            { name: 'orphan-skill', type: 'skill' }
        ];

        const options = buildGroupedOptions(artifacts, processes, formatLabel);

        const groupLabels = options
            .filter(o => o.value._group)
            .map(o => o.value.processName);
        const standaloneLabels = options
            .filter(o => o.value._child)
            .map(o => o.label);

        expect(groupLabels).toHaveLength(0);
        expect(standaloneLabels.some(l => l.includes('orphan-skill'))).toBe(true);
    });
});
