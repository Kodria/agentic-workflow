import fs from 'fs';
import path from 'path';
import { REGISTRY_DIR } from './registry';
import { Scope } from '../providers';
import { contentRoots, readRegistryManifest } from './registries';

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
    /** Root de contenido donde se descubrió el bundle (multi-registry, WS-1). */
    contentRoot?: string;
    /** Content root del bundle de un root anterior que este tapó (override declarado, WS-2). */
    overrode?: string;
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
            contentRoot: contentDir,
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

/**
 * Default install scope for a bundle, derived from its scope class.
 * baseline/ambient install globally; project bundles install locally.
 */
export function defaultScopeForBundle(scope: BundleScope): Scope {
    return scope === 'project' ? 'local' : 'global';
}

/** Descubre bundles de TODOS los roots (base + registries adicionales).
 *  Colisión de nombre entre roots: override declarado en awm-registry.json
 *  del root posterior → reemplaza; no declarado → error nombrando ambas fuentes. */
export function discoverAllBundles(roots: string[] = contentRoots()): BundleDefinition[] {
    const byName = new Map<string, BundleDefinition>();
    for (const root of roots) {
        const overrides = readRegistryManifest(root).overrides;
        for (const b of discoverBundles(root)) {
            const prev = byName.get(b.name);
            if (!prev) {
                byName.set(b.name, b);
                continue;
            }
            if (overrides.has(b.name)) {
                byName.set(b.name, { ...b, overrode: prev.contentRoot });
                continue;
            }
            throw new Error(
                `Artifact name collision: bundle "${b.name}" exists in both ${prev.contentRoot} and ${root}. ` +
                `Remove or rename one of them, or declare "${b.name}" in "overrides" of the later registry's awm-registry.json.`
            );
        }
    }
    return Array.from(byName.values());
}

/**
 * Resolves the dependency closure of a bundle in deps-first order, deduped.
 * Each bundle appears once, after all bundles it depends on. Unknown names
 * (missing from `bundles`) are skipped.
 */
export function resolveBundleClosure(
    bundleName: string,
    bundles: BundleDefinition[]
): BundleDefinition[] {
    const byName = new Map(bundles.map((b) => [b.name, b]));
    const ordered: BundleDefinition[] = [];
    const seen = new Set<string>();
    const visit = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const b = byName.get(name);
        if (!b) return;
        for (const dep of b.dependsOn) visit(dep);
        ordered.push(b);
    };
    visit(bundleName);
    return ordered;
}
