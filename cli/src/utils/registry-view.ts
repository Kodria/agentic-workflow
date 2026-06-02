import pc from 'picocolors';
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

const TYPE_ICON: Record<ArtifactType, string> = { skill: '', workflow: '⚡ ', agent: '🤖 ' };

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Human label for a package's contents, e.g. "2 skills · 1 workflow". */
export function artifactCountLabel(counts: PackageView['counts']): string {
    const parts: string[] = [];
    if (counts.skills > 0) parts.push(plural(counts.skills, 'skill'));
    if (counts.workflows > 0) parts.push(plural(counts.workflows, 'workflow'));
    if (counts.agents > 0) parts.push(plural(counts.agents, 'agent'));
    if (parts.length === 0) return '0 artifacts';
    return parts.join(' · ');
}

function packageIcon(pkg: PackageView): string {
    return pkg.isStandalone ? '🔹' : '📦';
}

/** Compact summary: a header line plus one aligned line per package. */
export function packageSummaryLines(packages: PackageView[]): string[] {
    const uniqueSkillNames = new Set(packages.flatMap((p) => p.artifacts.filter((a) => a.type === 'skill').map((a) => a.name)));
    const totalSkills = uniqueSkillNames.size;
    const lines: string[] = [`AWM Registry — ${plural(packages.length, 'package')}, ${plural(totalSkills, 'skill')}`, ''];

    const nameWidth = Math.max(0, ...packages.map((p) => p.name.length));
    const countLabels = packages.map((p) => (p.isStandalone ? plural(p.artifacts.length, 'artifact') : artifactCountLabel(p.counts)));
    const countWidth = Math.max(0, ...countLabels.map((c) => c.length));

    packages.forEach((p, i) => {
        const name = p.name.padEnd(nameWidth);
        const count = countLabels[i].padEnd(countWidth);
        const desc = p.isStandalone ? '' : p.description;
        lines.push(`${packageIcon(p)} ${name}   ${count}   ${desc}`.trimEnd());
    });
    return lines;
}

/** Detailed view of a single package: header + one or two lines per artifact. */
export function packageDetailLines(pkg: PackageView): string[] {
    const lines: string[] = [];
    const header = pkg.isStandalone
        ? `${packageIcon(pkg)} ${pkg.name} — ${plural(pkg.artifacts.length, 'artifact')}`
        : `${packageIcon(pkg)} ${pkg.name} — ${pkg.description}  [${artifactCountLabel(pkg.counts)}]`;
    lines.push(header);
    pkg.artifacts.forEach((a) => {
        lines.push(`  ${TYPE_ICON[a.type]}${a.name}`);
        if (a.description) lines.push(`     ${a.description}`);
    });
    return lines;
}

export interface PackageLookup {
    match?: PackageView;
    suggestion?: string;
}

/** Exact (case-insensitive) name match; otherwise the closest name as a suggestion. */
export function findPackage(packages: PackageView[], query: string): PackageLookup {
    const q = query.toLowerCase();
    const exact = packages.find((p) => p.name.toLowerCase() === q);
    if (exact) return { match: exact };

    // Closest: prefer substring containment, then longest shared prefix.
    const contains = packages.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
    if (contains) return { suggestion: contains.name };

    let best: PackageView | undefined;
    let bestPrefix = -1;
    for (const p of packages) {
        const name = p.name.toLowerCase();
        let i = 0;
        while (i < name.length && i < q.length && name[i] === q[i]) i++;
        if (i > bestPrefix) {
            bestPrefix = i;
            best = p;
        }
    }
    return { suggestion: best?.name };
}

export const ALL_SENTINEL = '__ALL__';

export function artifactValue(a: ArtifactView): string {
    return `${a.type}:${a.name}`;
}

/** Level-1 multiselect options: one per package, value = package name. */
export function buildLevel1Options(packages: PackageView[]): { value: string; label: string }[] {
    return packages.map((p) => {
        const count = p.isStandalone ? plural(p.artifacts.length, 'artifact') : artifactCountLabel(p.counts);
        const desc = p.isStandalone ? '' : ` · ${p.description}`;
        return { value: p.name, label: `${packageIcon(p)} ${p.name}  ${pc.dim(`${count}${desc}`)}` };
    });
}

/**
 * Level-2 multiselect options for one package. First option is the
 * "install entire package" sentinel; the rest are one per artifact with the
 * description embedded into the label (always-visible — @clack hints only show
 * on the focused row).
 */
export function buildLevel2Options(pkg: PackageView): { value: string; label: string }[] {
    const installAll = { value: ALL_SENTINEL, label: `✨ Install entire package (${pkg.artifacts.length})` };
    const rest = pkg.artifacts.map((a) => {
        const title = `${TYPE_ICON[a.type]}${a.name}`;
        const label = a.description ? `${title}\n     ${pc.dim(a.description)}` : title;
        return { value: artifactValue(a), label };
    });
    return [installAll, ...rest];
}

/**
 * Maps a level-2 selection back to artifacts. The sentinel means "all".
 */
export function resolveLevel2Selection(pkg: PackageView, selectedValues: string[]): ArtifactView[] {
    if (selectedValues.includes(ALL_SENTINEL)) return [...pkg.artifacts];
    const wanted = new Set(selectedValues);
    return pkg.artifacts.filter((a) => wanted.has(artifactValue(a)));
}
