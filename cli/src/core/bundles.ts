import fs from 'fs';
import path from 'path';
import { REGISTRY_DIR } from './registry';

export const REGISTRY_CONTENT_DIR = path.join(REGISTRY_DIR, 'registry');

export type BundleScope = 'baseline' | 'project' | 'ambient';
export type BundleVisibility = 'public' | 'private';

export interface BundleSkillRef {
    name: string;
    onSignal: boolean;
}

export interface BundleDefinition {
    name: string;
    description: string;
    version: string;
    scope: BundleScope;
    visibility: BundleVisibility;
    dependsOn: string[];
    skills: BundleSkillRef[];
    workflows: string[];
    agents: string[];
}

export interface CatalogEntry {
    name: string;
    source: string;
    version: string;
    scope: BundleScope;
    visibility?: BundleVisibility;
}

function catalogPath(contentDir: string): string {
    return path.join(contentDir, 'catalog.json');
}

export function readCatalog(contentDir: string = REGISTRY_CONTENT_DIR): CatalogEntry[] {
    const file = catalogPath(contentDir);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { version: number; bundles: CatalogEntry[] };
    return parsed.bundles ?? [];
}

function normalizeSkillRefs(raw: Array<string | { name: string; onSignal?: boolean }>): BundleSkillRef[] {
    return (raw ?? []).map((s) =>
        typeof s === 'string' ? { name: s, onSignal: false } : { name: s.name, onSignal: s.onSignal === true }
    );
}

export function discoverBundles(contentDir: string = REGISTRY_CONTENT_DIR): BundleDefinition[] {
    const entries = readCatalog(contentDir);
    const bundles: BundleDefinition[] = [];
    for (const entry of entries) {
        const manifestPath = path.join(contentDir, entry.source, 'bundle.json');
        if (!fs.existsSync(manifestPath)) continue;
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        bundles.push({
            name: raw.name,
            description: raw.description ?? '',
            version: raw.version ?? '0.0.0',
            scope: raw.scope ?? 'project',
            visibility: raw.visibility ?? 'public',
            dependsOn: raw.dependsOn ?? [],
            skills: normalizeSkillRefs(raw.skills),
            workflows: raw.workflows ?? [],
            agents: raw.agents ?? [],
        });
    }
    return bundles;
}

export function resolveBundleSkills(bundleName: string, bundles: BundleDefinition[]): string[] {
    const byName = new Map(bundles.map((b) => [b.name, b]));
    const seen = new Set<string>();
    const skills = new Set<string>();
    const visit = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const b = byName.get(name);
        if (!b) return;
        for (const dep of b.dependsOn) visit(dep);
        for (const s of b.skills) skills.add(s.name);
    };
    visit(bundleName);
    return Array.from(skills);
}
