// src/core/registries.ts
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { resolveBaseRemote } from './registry';
import { resolveTargetRef, machineVersionOpts, compareSemver, currentVersion, normalizePin } from './versioning';
import { cliVersion } from './cli-version';
import { awmHome } from './paths';

// Computed at require-time by calling the shared resolver (single source of truth: core/paths.ts).

// Funciones, no constantes de nivel de modulo. `awmHome()` lee AWM_HOME/HOME EN CADA
// LLAMADA a proposito (paths.ts) — resolverlo una sola vez al hacer `require` congelaba
// la respuesta en el instante del import, asi que cualquier cosa que fijara AWM_HOME
// despues (un test, un comando que cambia de home) seguia apuntando al viejo. Este
// modulo era el unico lugar que contradecia esa regla.
export function registriesDir(): string {
    return path.join(awmHome(), 'registries');
}

export function registriesConfigPath(): string {
    return path.join(awmHome(), 'registries.json');
}

export const CONTENT_DIR_NAMES = ['skills', 'bundles', 'workflows', 'agents'] as const;
export const CAPABILITY_DIR_NAMES = ['hooks', 'sensor-packs'] as const;
export const REGISTRY_DIR_NAMES = [...CONTENT_DIR_NAMES, ...CAPABILITY_DIR_NAMES] as const;
export const REGISTRY_MANIFEST_NAME = 'awm-registry.json';
export const REGISTRY_METADATA_FILE_NAMES = [REGISTRY_MANIFEST_NAME, 'catalog.json'] as const;

export interface RegistryEntry {
    name: string;
    remote: string;
}

export interface RegistrySource extends RegistryEntry {
    contentRoot: string;
}

export function registryContentRoot(name: string): string {
    const root = path.join(registriesDir(), name);
    if (!name || name === '.' || name.includes('..') || /[/\\]/.test(name) || !path.resolve(root).startsWith(path.resolve(registriesDir()) + path.sep)) {
        throw new Error(`Invalid registry name "${name}" — must not contain path separators`);
    }
    return root;
}

export function readRegistriesConfig(): RegistryEntry[] {
    if (!fs.existsSync(registriesConfigPath())) return [];
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(registriesConfigPath(), 'utf-8'));
    } catch (e) {
        throw new Error(
            `Invalid registries config at ${registriesConfigPath()}: ${e instanceof Error ? e.message : String(e)}`
        );
    }
    if (!Array.isArray(raw)) {
        throw new Error(`Invalid registries config at ${registriesConfigPath()}: expected a JSON array`);
    }
    for (const entry of raw) {
        if (typeof (entry as Record<string, unknown>)?.name !== 'string' || typeof (entry as Record<string, unknown>)?.remote !== 'string') {
            throw new Error(
                `Invalid registries config at ${registriesConfigPath()}: malformed entry ${JSON.stringify(entry)}`
            );
        }
        if (!entry.name || entry.name === '.' || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('..')) {
            throw new Error(
                `Invalid registries config at ${registriesConfigPath()}: malformed entry name "${entry.name}" (path traversal)`
            );
        }
    }
    return raw as RegistryEntry[];
}

export function writeRegistriesConfig(entries: RegistryEntry[]): void {
    fs.mkdirSync(awmHome(), { recursive: true });
    fs.writeFileSync(registriesConfigPath(), JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

/** Bootstrap de máquina (awm init): si no hay registries.json, lo crea con la
 *  entrada baseline (remote por cadena WS-2: env > prefs > default).
 *  Devuelve true si sembró. Nunca toca un registries.json existente. */
export function seedBaselineRegistry(): boolean {
    if (fs.existsSync(registriesConfigPath())) return false;
    writeRegistriesConfig([{ name: 'baseline', remote: resolveBaseRemote() }]);
    return true;
}

export function listRegistries(): RegistrySource[] {
    return readRegistriesConfig().map((e) => ({ ...e, contentRoot: registryContentRoot(e.name) }));
}

/** Roots de contenido en orden de registries.json.
 *  Un registry configurado pero ausente se omite (awm update lo re-clona). */
export function contentRoots(): string[] {
    const roots: string[] = [];
    for (const reg of listRegistries()) {
        if (isSafeRegistryRoot(reg.contentRoot)) roots.push(reg.contentRoot);
    }
    return roots;
}

/** Primer content root configurado (en orden de registries.json) que contiene el
 *  directorio pedido ('hooks', 'sensor-packs', 'skills'…). null si ninguno. */
export function capabilityRoot(dirName: string): string | null {
    for (const root of contentRoots()) {
        if (isRegularDirectory(path.join(root, dirName))) return root;
    }
    return null;
}

/** Todo symlink bajo directorios consumidos de un registry es no confiable: discovery,
 *  hooks y sensores no pueden consumir contenido que podría resolver fuera del clone. */
function containsManagedSymlink(dir: string): boolean {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return true;
    }
    for (const entry of entries) {
        const candidate = path.join(dir, entry.name);
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(candidate);
        } catch {
            return true;
        }
        if (stat.isSymbolicLink()) return true;
        if (stat.isDirectory() && containsManagedSymlink(candidate)) return true;
    }
    return false;
}

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isRegularDirectory(candidate: string): boolean {
    try {
        const stat = fs.lstatSync(candidate);
        return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
        return false;
    }
}

function isSafeOptionalRegistryFile(candidate: string): boolean {
    try {
        const stat = fs.lstatSync(candidate);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch (error) {
        return isMissing(error);
    }
}

/** Returns false when absent; throws when an existing registry metadata file cannot be
 * safely read as a regular file. Kept public so catalog and manifest readers share the
 * same trust boundary instead of relying only on an earlier layout scan. */
export function assertRegularRegistryFile(file: string): boolean {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(file);
    } catch (error) {
        if (isMissing(error)) return false;
        throw new Error(`Cannot inspect registry metadata at ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`Registry metadata at ${file} must not be a symbolic link`);
    if (!stat.isFile()) throw new Error(`Registry metadata at ${file} must be a regular file`);
    return true;
}

/** Verifica que la raíz y cada directorio que AWM consume sean regulares y no tengan
 *  symlinks anidados. Los registries capability-only siguen siendo válidos. */
function inspectRegistrySafety(root: string): { safe: boolean; hasManagedDirectory: boolean } {
    if (!isRegularDirectory(root)) return { safe: false, hasManagedDirectory: false };
    let hasManagedDirectory = false;
    for (const d of REGISTRY_DIR_NAMES) {
        const candidate = path.join(root, d);
        try {
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink()) return { safe: false, hasManagedDirectory: false };
            if (!stat.isDirectory()) continue;
            hasManagedDirectory = true;
            if (containsManagedSymlink(candidate)) return { safe: false, hasManagedDirectory: false };
        } catch (error) {
            if (isMissing(error)) continue;
            return { safe: false, hasManagedDirectory: false };
        }
    }
    for (const file of REGISTRY_METADATA_FILE_NAMES) {
        if (!isSafeOptionalRegistryFile(path.join(root, file))) {
            return { safe: false, hasManagedDirectory: false };
        }
    }
    return { safe: true, hasManagedDirectory };
}

export function isSafeRegistryRoot(root: string): boolean {
    return inspectRegistrySafety(root).safe;
}

/** Un registry válido tiene ≥1 directorio de contenido o capability regular y ningún
 *  symlink en las rutas que AWM consume. */
export function validateRegistryLayout(root: string): boolean {
    const state = inspectRegistrySafety(root);
    return state.safe && state.hasManagedDirectory;
}

/** Whether machine setup must synchronize before any registry-backed discovery.
 * An empty root is safe to keep configured, but cannot yet supply AWM content. */
export function registriesNeedSync(): boolean {
    return listRegistries().some((registry) => !validateRegistryLayout(registry.contentRoot));
}

export type RegistrySyncDisposition = 'installed' | 'advanced' | 'unchanged' | 'regressed' | 'resolved';

export type RegistrySyncResult =
    | {
        name: string;
        action: 'pulled' | 'recloned';
        version: string;
        /** Dirección real del checkout. Ausente solo para implementaciones previas/injectadas. */
        disposition?: RegistrySyncDisposition;
        /** Pin de máquina que resolvió el target, si lo hubo. */
        pin?: string;
        /** Versión semver previa, para que el renderer pueda explicar un rollback. */
        previousVersion?: string;
        /** Último tag semver disponible al resolver, aun cuando un pin eligió otro. */
        availableVersion?: string;
    }  // version: 'vX.Y.Z' | 'HEAD'
    | { name: string; action: 'error'; error: string };

/** Sincroniza cada registry configurado al ref resuelto (pin > último tag > HEAD);
 *  re-clona si falta el dir. Errores por-registry NO fatales: se reportan en el resultado. */
export async function syncRegistries(): Promise<RegistrySyncResult[]> {
    const results: RegistrySyncResult[] = [];
    for (const reg of listRegistries()) {
        try {
            const freshClone = !fs.existsSync(reg.contentRoot);
            if (!freshClone && !isSafeRegistryRoot(reg.contentRoot)) {
                throw new Error(`Unsafe registry layout at ${reg.contentRoot}`);
            }
            if (freshClone) {
                fs.mkdirSync(registriesDir(), { recursive: true });
                try {
                    await simpleGit().clone(reg.remote, reg.contentRoot);
                } catch (e) {
                    fs.rmSync(reg.contentRoot, { recursive: true, force: true });
                    throw e;
                }
            } else {
                await simpleGit(reg.contentRoot).reset(['--hard']);
            }
            const git = simpleGit(reg.contentRoot);
            const previousVersion = freshClone ? null : await currentVersion(reg.contentRoot);
            const versionOpts = machineVersionOpts(reg.name);
            let resolved;
            try {
                resolved = await resolveTargetRef(reg.contentRoot, versionOpts);
                await git.checkout(resolved.ref);
                if (resolved.kind !== 'tag') await git.pull('origin', resolved.ref);
                if (!validateRegistryLayout(reg.contentRoot)) {
                    throw new Error(`Unsafe registry layout at ${reg.contentRoot}`);
                }
            } catch (e) {
                if (freshClone) fs.rmSync(reg.contentRoot, { recursive: true, force: true });
                throw e;
            }
            const version = resolved.kind === 'tag' ? `v${resolved.version}` : 'HEAD';
            let disposition: RegistrySyncDisposition;
            if (freshClone) disposition = 'installed';
            else if (resolved.kind !== 'tag' || previousVersion === null) disposition = 'resolved';
            else {
                const direction = compareSemver(resolved.version, previousVersion);
                disposition = direction > 0 ? 'advanced' : direction < 0 ? 'regressed' : 'unchanged';
            }
            results.push({
                name: reg.name,
                action: freshClone ? 'recloned' : 'pulled',
                version,
                disposition,
                ...(versionOpts.pin ? { pin: normalizePin(versionOpts.pin) } : {}),
                ...(previousVersion ? { previousVersion: `v${previousVersion}` } : {}),
                ...(resolved.kind === 'tag' ? { availableVersion: `v${resolved.latestVersion}` } : {}),
            });
        } catch (e) {
            results.push({ name: reg.name, action: 'error', error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}

/** The errored entries of a `syncRegistries()` run, in `listRegistries()` order. */
export function registrySyncErrors(
    results: RegistrySyncResult[],
): { name: string; error: string }[] {
    return results
        .filter((r): r is Extract<RegistrySyncResult, { action: 'error' }> => r.action === 'error')
        .map((r) => ({ name: r.name, error: r.error }));
}

/** `name: reason; name: reason` — the shape both init and stepCache report errors in. */
export function describeRegistrySyncErrors(errors: { name: string; error: string }[]): string {
    return errors.map((e) => `${e.name}: ${e.error}`).join('; ');
}

/**
 * Registries that both errored during sync AND no longer have a usable content
 * layout afterwards — i.e. genuinely unusable, as opposed to merely stale.
 *
 * `syncRegistries()` deliberately reports per-registry failures as results
 * rather than throwing, so a flaky secondary registry never aborts a whole
 * run. Callers that go on to READ registry content (init) still need to know
 * whether what they are about to read remains usable: otherwise a missing,
 * empty, or unsafe registry
 * resurfaces much later as an unrelated step's failure, with its real cause
 * already discarded. Note that "usable" is deliberately about content on disk,
 * not about being a healthy git clone — a seeded content root with no `.git`
 * fails to sync every time and is still perfectly readable.
 */
export function unusableSyncedRegistries(
    results: RegistrySyncResult[],
): { name: string; error: string }[] {
    const errors = registrySyncErrors(results);
    if (errors.length === 0) return [];
    const roots = new Map(listRegistries().map((r) => [r.name, r.contentRoot]));
    return errors.filter((e) => {
        const root = roots.get(e.name);
        return root === undefined || !validateRegistryLayout(root);
    });
}

/** `unusableSyncedRegistries` as a guard: throws naming every unusable registry. */
export function assertSyncedRegistriesUsable(results: RegistrySyncResult[]): void {
    const unusable = unusableSyncedRegistries(results);
    if (unusable.length === 0) return;
    throw new Error(
        `registry sync failed and left no usable content on disk — ${describeRegistrySyncErrors(unusable)}`,
    );
}

export interface RegistryManifest {
    /** Nombres de artifacts que este registry puede sobreescribir de roots anteriores. */
    overrides: Set<string>;
    /** Versión mínima del CLI requerida por el contenido ("X.Y.Z", sin prefijo v). Opcional — WS-4. */
    minCliVersion?: string;
}

export function readRegistryManifest(root: string): RegistryManifest {
    const file = path.join(root, REGISTRY_MANIFEST_NAME);
    if (!assertRegularRegistryFile(file)) return { overrides: new Set() };
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        throw new Error(
            `Invalid registry manifest at ${file}: ${e instanceof Error ? e.message : String(e)}`
        );
    }
    const overrides = (raw as Record<string, unknown>)?.overrides ?? [];
    if (!Array.isArray(overrides) || overrides.some((n) => typeof n !== 'string')) {
        throw new Error(`Invalid registry manifest at ${file}: "overrides" must be an array of strings`);
    }
    for (const name of overrides as string[]) {
        if (!name || name === '.' || name.includes('..') || /[/\\]/.test(name)) {
            throw new Error(`Invalid registry manifest at ${file}: override name "${name}" (path traversal)`);
        }
    }
    let minCliVersion: string | undefined;
    const rawMin = (raw as Record<string, unknown>)?.minCliVersion;
    if (rawMin !== undefined) {
        if (typeof rawMin !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(rawMin)) {
            throw new Error(`Invalid registry manifest at ${file}: "minCliVersion" must be "X.Y.Z", got ${JSON.stringify(rawMin)}`);
        }
        minCliVersion = rawMin.replace(/^v/, '');
    }
    return { overrides: new Set(overrides as string[]), minCliVersion };
}

/** Nombre del registry dueño de un path: el nombre del clone bajo registriesDir(),
 *  o null si no pertenece a ninguno. */
export function registryNameForPath(p: string): string | null {
    const resolved = path.resolve(p);
    const regsRoot = path.resolve(registriesDir()) + path.sep;
    if (resolved.startsWith(regsRoot)) {
        const first = resolved.slice(regsRoot.length).split(path.sep)[0];
        return first || null;
    }
    return null;
}

export interface CliVersionFailure { name: string; min: string; }

/** Registries cuyo manifest exige un CLI más nuevo que el actual (capa 3, WS-4). */
export function verifyMinCliVersions(current: string = cliVersion()): CliVersionFailure[] {
    const failures: CliVersionFailure[] = [];
    for (const reg of listRegistries()) {
        if (!fs.existsSync(reg.contentRoot)) continue;
        let min: string | undefined;
        try { min = readRegistryManifest(reg.contentRoot).minCliVersion; } catch { continue; }
        // Falla CERRADO: si alguna de las dos versiones no es legible, se
        // reporta el fallo en vez de dejar pasar. Antes `compareSemver`
        // devolvia NaN y `NaN < 0` es false, asi que un `minCliVersion`
        // malformado hacia que el gate se saltara en silencio.
        if (!min) continue;
        try {
            if (compareSemver(current, min) < 0) failures.push({ name: reg.name, min });
        } catch {
            failures.push({ name: reg.name, min });
        }
    }
    return failures;
}

/** Throwing form of `verifyMinCliVersions`'s failure list — lets callers treat the
 *  min-CLI-version gate uniformly with other gates (version-gate, backup session, …)
 *  in a single try/catch rather than a bespoke console.warn loop. */
export function assertRegistryGates(failures: CliVersionFailure[]): void {
    if (failures.length === 0) return;
    const detail = failures.map((f) => `${f.name} requires CLI >= ${f.min}`).join('; ');
    throw new Error(`Registry version gate failed: ${detail}. Run: npm i -g agentic-workflow-manager`);
}
