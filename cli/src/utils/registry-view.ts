import { ArtifactType } from '../providers';
import { ProcessDefinition, SkillArtifact, WorkflowArtifact, AgentArtifact } from '../core/discovery';

export const STANDALONE_NAME = 'standalone';

export interface ArtifactView {
    name: string;          // baseName (no extension)
    type: ArtifactType;    // 'skill' | 'workflow' | 'agent'
    sourcePath: string;    // path to install from
    installName: string;   // on-disk name at the destination
    description: string;   // from frontmatter; '' when absent
}

export interface PackageView {
    name: string;
    description: string;
    isStandalone: boolean;
    artifacts: ArtifactView[];
    counts: { skills: number; workflows: number; agents: number };
}

function makePackage(name: string, description: string, isStandalone: boolean, artifacts: ArtifactView[]): PackageView {
    return {
        name,
        description,
        isStandalone,
        artifacts,
        counts: {
            skills: artifacts.filter((a) => a.type === 'skill').length,
            workflows: artifacts.filter((a) => a.type === 'workflow').length,
            agents: artifacts.filter((a) => a.type === 'agent').length,
        },
    };
}

export function buildPackageView(
    skills: SkillArtifact[],
    workflows: WorkflowArtifact[],
    agents: AgentArtifact[],
    processes: ProcessDefinition[]
): PackageView[] {
    const all: ArtifactView[] = [
        ...skills.map((s) => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path, installName: s.name, description: s.description ?? '' })),
        ...workflows.map((w) => ({ name: w.name, type: 'workflow' as ArtifactType, sourcePath: w.path, installName: `${w.name}.md`, description: w.description ?? '' })),
        ...agents.map((a) => ({ name: a.name, type: 'agent' as ArtifactType, sourcePath: a.path, installName: `${a.name}.md`, description: a.description ?? '' })),
    ];

    const packages: PackageView[] = [];
    const claimed = new Set<ArtifactView>();

    for (const p of processes) {
        const arts = all.filter((a) =>
            (a.type === 'skill' && p.skills.includes(a.name)) ||
            (a.type === 'workflow' && p.workflows.includes(a.name)) ||
            (a.type === 'agent' && (p.agents ?? []).includes(a.name))
        );
        if (arts.length === 0) continue;
        arts.forEach((a) => claimed.add(a));
        packages.push(makePackage(p.name, p.description, false, arts));
    }

    const orphans = all.filter((a) => !claimed.has(a));
    if (orphans.length > 0) {
        packages.push(makePackage(STANDALONE_NAME, 'Artifacts not part of any package', true, orphans));
    }

    return packages;
}
