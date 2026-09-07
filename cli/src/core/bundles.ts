import fs from 'fs';
import path from 'path';
import { Scope } from '../providers';
import { assertRegularRegistryFile, contentRoots, readRegistryManifest } from './registries';
import { sanitizeDiagnosticText } from './text';

export type BundleScope = 'baseline' | 'project' | 'ambient';
export type BundleVisibility = 'public' | 'private';

export interface BundleDefinition {
    name: string;
    description: string;
    version: string;
    scope: BundleScope;
    visibility: BundleVisibility;
    dependsOn: string[];
    skills: string[];
    workflows: string[];
    agents: string[];
    /** Root de contenido donde se descubrió el bundle (multi-registry, WS-1). */
    contentRoot?: string;
    /** Content root del bundle de un root anterior que este tapó (override declarado, WS-2). */
    overrode?: string;
}

export interface BundleDiscoveryResult {
    bundles: BundleDefinition[];
    diagnostics: string[];
}

export type BundleDiagnosticReporter = (diagnostic: string) => void;

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

function bundleManifestPath(contentDir: string, source: string): string {
    const root = path.resolve(contentDir);
    const manifest = path.resolve(root, source, 'bundle.json');
    const relative = path.relative(root, manifest);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Invalid bundle source "${source}" in ${catalogPath(contentDir)}: it must remain inside the registry content root.`);
    }
    let rootStat: fs.Stats;
    try {
        rootStat = fs.lstatSync(root);
    } catch (error) {
        throw new Error(`Cannot inspect registry content root ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error(`Registry content root ${root} must be a regular directory`);
    }
    let current = root;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(current);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
            throw new Error(`Cannot inspect registry bundle path ${current}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (stat.isSymbolicLink()) {
            throw new Error(`Registry bundle path ${current} must not be a symbolic link`);
        }
    }
    return manifest;
}

/** Lee `catalog.json` de un registry.
 *
 *  El contenido de un registry es INPUT NO CONFIABLE (un registry de equipo,
 *  interno, o agregado con `awm registry add`), asi que se valida forma antes de
 *  desreferenciar. Sin esto, un solo archivo malformado en CUALQUIER registry
 *  — incluido uno que llega por un `awm update` rutinario — hacia que `awm list`
 *  y `awm add` murieran con un stack trace crudo de Node y ningun mensaje
 *  accionable. Los demas lectores de contenido de registry de este repo
 *  (readRegistriesConfig, readRegistryManifest, readProfile) ya validaban; estos
 *  dos eran los que faltaban. */
export function readCatalog(contentDir: string): CatalogEntry[] {
    const file = catalogPath(contentDir);
    if (!assertRegularRegistryFile(file)) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        throw new Error(`${file} is not valid JSON. Fix the file in its registry, then re-run \`awm update\`.`);
    }
    if (parsed === null || typeof parsed !== 'object') {
        throw new Error(`${file} must contain a JSON object.`);
    }
    const bundles = (parsed as { bundles?: unknown }).bundles;
    if (bundles === undefined) return [];
    if (!Array.isArray(bundles)) {
        throw new Error(`${file}: "bundles" must be an array.`);
    }
    // Una entrada sin `source` usable haria que `path.join` tirara un
    // TypeError opaco mas adelante; se descarta aca, nombrando el archivo.
    return bundles.filter((entry): entry is CatalogEntry =>
        entry !== null && typeof entry === 'object' && typeof (entry as CatalogEntry).source === 'string');
}

function safeManifestIdentity(manifestPath: string): string {
    return sanitizeDiagnosticText(manifestPath).slice(0, 240);
}

function boundedDiagnostic(diagnostic: string): string {
    return sanitizeDiagnosticText(diagnostic).slice(0, 512);
}

/** Normaliza la única forma de compatibilidad CLI 9 antes de que el manifest
 * alcance consumidores operativos. Los objetos nunca salen de este límite. */
function normalizeSkillRefs(raw: unknown, manifestPath: string): { skills: string[]; diagnostics: string[] } {
    const identity = safeManifestIdentity(manifestPath);
    if (!Array.isArray(raw)) {
        throw new Error(`${identity}: "skills" must be an array.`);
    }

    const skills: string[] = [];
    let legacyCount = 0;
    raw.forEach((ref, index) => {
        const location = `${identity}: skills[${index}]`;
        if (typeof ref === 'string') {
            if (ref === '') throw new Error(`${location} must be a non-empty string.`);
            skills.push(ref);
            return;
        }
        if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
            throw new Error(`${location} must be a non-empty string or a supported legacy object.`);
        }

        const legacy = ref as Record<string, unknown>;
        const keys = Object.keys(legacy);
        if (!keys.every((key) => key === 'name' || key === 'onSignal')) {
            throw new Error(`${location} legacy object may contain only "name" and optional "onSignal".`);
        }
        if (typeof legacy.name !== 'string' || legacy.name === '') {
            throw new Error(`${location} legacy object "name" must be a non-empty string.`);
        }
        if (legacy.onSignal !== undefined && typeof legacy.onSignal !== 'boolean') {
            throw new Error(`${location} legacy object "onSignal" must be a boolean.`);
        }
        skills.push(legacy.name);
        legacyCount++;
    });

    const diagnostics = legacyCount === 0 ? [] : [boundedDiagnostic(
        `${identity}: ${legacyCount} legacy object skill reference(s) accepted for CLI 9; ` +
        'replace with canonical skills: ["skill-name"]. Legacy object support is removed in v10.'
    )];
    return { skills, diagnostics };
}

/** Array de strings, o vacio. Cualquier otra forma en el contenido del registry
 *  se ignora en vez de propagarse hasta un crash aguas abajo. */
function stringArray(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function inspectBundles(contentDir: string): BundleDiscoveryResult {
    const entries = readCatalog(contentDir);
    const bundles: BundleDefinition[] = [];
    const diagnostics: string[] = [];
    for (const entry of entries) {
        const manifestPath = bundleManifestPath(contentDir, entry.source);
        if (!assertRegularRegistryFile(manifestPath)) continue;
        let raw: unknown;
        try {
            raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        } catch {
            throw new Error(`${manifestPath} is not valid JSON. Fix the file in its registry, then re-run \`awm update\`.`);
        }
        if (raw === null || typeof raw !== 'object') {
            throw new Error(`${manifestPath} must contain a JSON object.`);
        }
        const m = raw as Record<string, unknown>;
        // Un bundle sin nombre usable no es instalable y solo produciria errores
        // opacos mas adelante — se nombra el archivo y se falla aca.
        if (typeof m.name !== 'string' || m.name === '') {
            throw new Error(`${manifestPath}: "name" must be a non-empty string.`);
        }
        const normalizedSkills = normalizeSkillRefs(m.skills, manifestPath);
        diagnostics.push(...normalizedSkills.diagnostics);
        bundles.push({
            name: m.name,
            description: typeof m.description === 'string' ? m.description : '',
            version: typeof m.version === 'string' ? m.version : '0.0.0',
            scope: (m.scope as BundleDefinition['scope']) ?? 'project',
            visibility: (m.visibility as BundleDefinition['visibility']) ?? 'public',
            dependsOn: stringArray(m.dependsOn),
            skills: normalizedSkills.skills,
            workflows: stringArray(m.workflows),
            agents: stringArray(m.agents),
            contentRoot: contentDir,
        });
    }
    return { bundles, diagnostics };
}

/** Creates the command-scoped CLI reporter used by discovery facades. */
export function createBundleDiagnosticReporter(
    write: (message: string) => void = (message) => console.error(message)
): BundleDiagnosticReporter {
    const emitted = new Set<string>();
    return (diagnostic) => {
        if (emitted.has(diagnostic)) return;
        emitted.add(diagnostic);
        write(`warning: ${diagnostic}`);
    };
}

const defaultBundleDiagnosticReporter = createBundleDiagnosticReporter();

function reportDiagnostics(diagnostics: string[], reporter?: BundleDiagnosticReporter): void {
    const emit = reporter ?? defaultBundleDiagnosticReporter;
    for (const diagnostic of new Set(diagnostics)) emit(diagnostic);
}

/** Compatibility facade for callers that only need bundle definitions. */
export function discoverBundles(contentDir: string, reporter?: BundleDiagnosticReporter): BundleDefinition[] {
    const result = inspectBundles(contentDir);
    reportDiagnostics(result.diagnostics, reporter);
    return result.bundles;
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
        for (const s of b.skills) skills.add(s);
    };
    visit(bundleName);
    return Array.from(skills);
}

/** Same closure-walk as `resolveBundleSkills`, over `agent`-type artifact names. */
export function resolveBundleAgents(bundleName: string, bundles: BundleDefinition[]): string[] {
    const byName = new Map(bundles.map((b) => [b.name, b]));
    const seen = new Set<string>();
    const agents = new Set<string>();
    const visit = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const b = byName.get(name);
        if (!b) return;
        for (const dep of b.dependsOn) visit(dep);
        for (const a of b.agents) agents.add(a);
    };
    visit(bundleName);
    return Array.from(agents);
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
export function inspectAllBundles(roots: string[] = contentRoots()): BundleDiscoveryResult {
    const byName = new Map<string, BundleDefinition>();
    const diagnostics: string[] = [];
    for (const root of roots) {
        const overrides = readRegistryManifest(root).overrides;
        const result = inspectBundles(root);
        diagnostics.push(...result.diagnostics);
        for (const b of result.bundles) {
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
    return { bundles: Array.from(byName.values()), diagnostics: Array.from(new Set(diagnostics)) };
}

/** Compatibility facade for callers that only need bundle definitions. */
export function discoverAllBundles(roots: string[] = contentRoots(), reporter?: BundleDiagnosticReporter): BundleDefinition[] {
    const result = inspectAllBundles(roots);
    reportDiagnostics(result.diagnostics, reporter);
    return result.bundles;
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
