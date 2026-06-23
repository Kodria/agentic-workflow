import pc from 'picocolors';
import { ArtifactType } from '../providers';
import { SkillArtifact, WorkflowArtifact, AgentArtifact } from '../core/discovery';
import { BundleDefinition } from '../core/bundles';
import { registryNameForPath } from '../core/registries';
import { truncate } from '../ui/text';
import { PickerItem } from '../ui/picker-view';

export const STANDALONE_NAME = 'standalone';

export interface ArtifactView {
    name: string;
    type: ArtifactType;
    sourcePath: string;
    installName: string;
    description: string;
    /** Path del artifact tapado cuando este es un override declarado (WS-2). */
    overrode?: string;
}

export interface PackageView {
    name: string;
    description: string;
    isStandalone: boolean;
    visibility: 'public' | 'private';
    artifacts: ArtifactView[];
    counts: { skills: number; workflows: number; agents: number };
}

function makePackage(
    name: string,
    description: string,
    isStandalone: boolean,
    visibility: 'public' | 'private',
    artifacts: ArtifactView[]
): PackageView {
    return {
        name,
        description,
        isStandalone,
        visibility,
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
    bundles: BundleDefinition[]
): PackageView[] {
    const all: ArtifactView[] = [
        ...skills.map((s) => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path, installName: s.name, description: s.description ?? '', overrode: s.overrode })),
        ...workflows.map((w) => ({ name: w.name, type: 'workflow' as ArtifactType, sourcePath: w.path, installName: `${w.name}.md`, description: w.description ?? '', overrode: w.overrode })),
        ...agents.map((a) => ({ name: a.name, type: 'agent' as ArtifactType, sourcePath: a.path, installName: `${a.name}.md`, description: a.description ?? '', overrode: a.overrode })),
    ];

    const packages: PackageView[] = [];
    const claimed = new Set<ArtifactView>();

    for (const b of bundles) {
        const skillNames = b.skills.map((s) => s.name);
        const arts = all.filter((a) =>
            (a.type === 'skill' && skillNames.includes(a.name)) ||
            (a.type === 'workflow' && b.workflows.includes(a.name)) ||
            (a.type === 'agent' && b.agents.includes(a.name))
        );
        if (arts.length === 0) continue;
        arts.forEach((a) => claimed.add(a));
        packages.push(makePackage(b.name, b.description, false, b.visibility, arts));
    }

    const orphans = all.filter((a) => !claimed.has(a));
    if (orphans.length > 0) {
        packages.push(makePackage(STANDALONE_NAME, 'Artifacts not part of any package', true, 'public', orphans));
    }

    return packages;
}

const TYPE_ICON: Record<ArtifactType, string> = { skill: '', workflow: '⚡ ', agent: '🤖 ' };

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

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

export function packageSummaryLines(packages: PackageView[], width?: number): string[] {
    const uniqueSkillNames = new Set(packages.flatMap((p) => p.artifacts.filter((a) => a.type === 'skill').map((a) => a.name)));
    const totalSkills = uniqueSkillNames.size;
    const lines: string[] = [`AWM Registry — ${plural(packages.length, 'package')}, ${plural(totalSkills, 'skill')}`, ''];

    const nameWidth = Math.max(0, ...packages.map((p) => p.name.length));
    const countLabels = packages.map((p) => (p.isStandalone ? plural(p.artifacts.length, 'artifact') : artifactCountLabel(p.counts)));
    const countWidth = Math.max(0, ...countLabels.map((c) => c.length));

    packages.forEach((p, i) => {
        const name = p.name.padEnd(nameWidth);
        const count = countLabels[i].padEnd(countWidth);
        let desc = p.isStandalone ? '' : p.description;
        if (width && desc) {
            const used = 3 + nameWidth + 3 + countWidth + 3; // icon(2)+space(1), name, gap, count, gap
            const avail = width - used;
            desc = avail > 1 ? truncate(desc, avail) : '';
        }
        lines.push(`${packageIcon(p)} ${name}   ${count}   ${desc}`.trimEnd());
    });
    return lines;
}

export function packageDetailLines(pkg: PackageView, width?: number): string[] {
    const lines: string[] = [];
    const header = pkg.isStandalone
        ? `${packageIcon(pkg)} ${pkg.name} — ${plural(pkg.artifacts.length, 'artifact')}`
        : `${packageIcon(pkg)} ${pkg.name} — ${pkg.description}  [${artifactCountLabel(pkg.counts)}]`;
    lines.push(header);
    pkg.artifacts.forEach((a) => {
        const mark = a.overrode
            ? pc.yellow(`  ← ${registryNameForPath(a.sourcePath) ?? 'unknown'} (override)`)
            : '';
        lines.push(`  ${TYPE_ICON[a.type]}${a.name}${mark}`);
        if (a.description) {
            const desc = width ? truncate(a.description, width - 5) : a.description;
            lines.push(`     ${desc}`);
        }
    });
    return lines;
}

export interface PackageLookup {
    match?: PackageView;
    suggestion?: string;
}

export function findPackage(packages: PackageView[], query: string): PackageLookup {
    const q = query.toLowerCase();
    const exact = packages.find((p) => p.name.toLowerCase() === q);
    if (exact) return { match: exact };

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

export function packagePickerItems(packages: PackageView[]): PickerItem[] {
    return packages.map((p) => ({
        value: p.name,
        label: `${packageIcon(p)} ${p.name}`,
        description: p.isStandalone
            ? plural(p.artifacts.length, 'artifact')
            : `${artifactCountLabel(p.counts)} · ${p.description}`,
    }));
}

export function artifactPickerItems(pkg: PackageView): PickerItem[] {
    const all: PickerItem = {
        value: ALL_SENTINEL,
        label: `✨ Install entire package (${pkg.artifacts.length})`,
        description: 'Select every artifact in this package.',
    };
    const rest: PickerItem[] = pkg.artifacts.map((a) => ({
        value: artifactValue(a),
        label: `${TYPE_ICON[a.type]}${a.name}`,
        description: a.description || '',
    }));
    return [all, ...rest];
}

export function resolveLevel2Selection(pkg: PackageView, selectedValues: string[]): ArtifactView[] {
    if (selectedValues.includes(ALL_SENTINEL)) return [...pkg.artifacts];
    const wanted = new Set(selectedValues);
    return pkg.artifacts.filter((a) => wanted.has(artifactValue(a)));
}
