import fs from 'fs';
import path from 'path';
import { SensorManifest } from './types';
import { parseSensorPack } from './compatibility/contract';
import { materializeResolvedSensors } from './compatibility/materialize';
import { resolveParsedPackCompatibility } from './compatibility/live';
import { parseSensorManifest, type SensorManifestV2 } from './compatibility/manifest';
import { resolvePackSource } from './compatibility/pack-source';
import type { SensorPackV2 } from './compatibility/types';

export type InitOptions = {
    configure?: boolean;
    cwd?: string;
    registryRoot?: string;
    pack?: string;
};

type ResolvedV2Pack = { pack: SensorPackV2; packRoot: string };

/** Read a pack only through the shared source resolver.  Init is a registry
 * boundary: a pack path that is absent is harmless, but a symlink or escaping
 * claimed source is never silently downgraded to an empty manifest. */
function readResolvedPack(pack: string, registryRoot: string): { path: string; content: string } | null {
    try {
        const source = resolvePackSource(pack, {
            registries: [{ name: 'init-registry', remote: 'local', contentRoot: registryRoot }],
        });
        return { path: source.path, content: source.content };
    } catch (error) {
        if (error instanceof Error && error.message.includes('was not found in configured registries')) return null;
        throw error;
    }
}

function readV2Pack(pack: string, registryRoot: string): ResolvedV2Pack | null {
    const source = readResolvedPack(pack, registryRoot);
    if (!source) return null;
    let raw: unknown;
    try { raw = JSON.parse(source.content); } catch { throw new Error(`cannot parse sensor pack ${source.path}`); }
    const parsed = parseSensorPack(raw, source.path);
    return parsed.kind === 'v2' ? { pack: parsed.pack, packRoot: path.dirname(source.path) } : null;
}

// Widened from a hardcoded union to `string` on purpose: `--pack <name>` (below) must
// accept any pack name present in the registry — including packs this CLI's source
// has never heard of (a team's custom pack, a future stack). `SensorManifest.pack` in
// types.ts is already plain `string`; this keeps the two consistent. The STACK_DETECTORS
// -driven auto-detection below still only ever PRODUCES 'js-ts' | 'python' | 'shell' |
// 'generic' in practice — only the type widens, not the detection logic's behavior.
export type StackDetection = {
    pack: string;
    indicators: string[];
};

const STACK_DETECTORS: Array<{ pack: string; files: string[] }> = [
    { pack: 'js-ts', files: ['package.json'] },
    { pack: 'python', files: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'] },
];

// Shell detection is a glob (`*.sh` in the repo root or in `scripts/`), unlike the
// exact-filename matches above — so it needs its own scan rather than fitting the
// STACK_DETECTORS table. Tried last, after js-ts and python both fail: a Python
// project that also ships a root `deploy.sh` must still detect as `python`, never
// `shell`. Order of specificity: js-ts > python > shell > generic.
const SHELL_SCAN_DIRS = ['.', 'scripts'];

function findShellIndicators(cwd: string): string[] {
    const found: string[] = [];
    for (const dir of SHELL_SCAN_DIRS) {
        const full = path.join(cwd, dir);
        if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
        for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.sh')) {
                found.push(dir === '.' ? entry.name : path.join(dir, entry.name));
            }
        }
    }
    return found;
}

export function detectStack(cwd: string): StackDetection {
    for (const { pack, files } of STACK_DETECTORS) {
        const found = files.filter(f => fs.existsSync(path.join(cwd, f)));
        if (found.length > 0) return { pack, indicators: found };
    }
    const shellIndicators = findShellIndicators(cwd);
    if (shellIndicators.length > 0) return { pack: 'shell', indicators: shellIndicators };
    return { pack: 'generic', indicators: [] };
}

// Candidate source dirs in priority order. `depcheck` analyzes the ones that
// exist — a project may use `src/`, or App-Router-style `app/lib/components/...`.
const SOURCE_DIR_CANDIDATES = ['src', 'app', 'lib', 'components', 'hooks', 'pages'];

export function detectSourceDirs(cwd: string): string[] {
    const found = SOURCE_DIR_CANDIDATES.filter(d => {
        const p = path.join(cwd, d);
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
    });
    return found.length > 0 ? found : ['src'];
}

type PackJson = {
    sensors?: Record<string, {
        defaultCmd?: string;
        fast?: boolean;
        enabled?: boolean;
        changedCmd?: string;
        changedExtensions?: string[];
        formatter?: string;
    }>;
};

/**
 * Read sensor defaults from the pack's pack.json (the single source of truth).
 * Maps `defaultCmd` → `cmd` and substitutes the `{{SOURCE_DIRS}}` placeholder
 * with the project's actual source dirs. Returns null if the pack has no pack.json.
 */
function readPackDefaults(pack: string, registryRoot: string, cwd: string): SensorManifest['sensors'] | null {
    const source = readResolvedPack(pack, registryRoot);
    if (!source) return null;
    let parsed: PackJson;
    try { parsed = JSON.parse(source.content); } catch { return null; }

    const sourceDirs = detectSourceDirs(cwd).join(' ');
    const sensors: SensorManifest['sensors'] = {};
    for (const [name, def] of Object.entries(parsed.sensors ?? {})) {
        const entry: SensorManifest['sensors'][string] = {};
        if (def.defaultCmd) entry.cmd = def.defaultCmd.replace('{{SOURCE_DIRS}}', sourceDirs);
        if (def.fast !== undefined) entry.fast = def.fast;
        if (def.enabled !== undefined) entry.enabled = def.enabled;
        // Carried through verbatim: without these in the written manifest, a pack can
        // declare a sensor scopable and `--changed` would silently run it in full —
        // the flag would look supported and do nothing. `{{SOURCE_DIRS}}` is not
        // substituted here on purpose: a scoped command takes an explicit file list.
        if (def.changedCmd) entry.changedCmd = def.changedCmd;
        if (def.changedExtensions) entry.changedExtensions = def.changedExtensions;
        // Carries the real tool name (`mypy`, `ruff`, `shellcheck`…) so the runner can
        // dispatch to the right output parser instead of guessing from the sensor name —
        // see `SensorConfig.formatter`.
        if (def.formatter) entry.formatter = def.formatter;
        sensors[name] = entry;
    }
    return sensors;
}

export function buildManifest(
    pack: string,
    existing?: SensorManifest,
    registryRoot?: string,
    cwd: string = process.cwd(),
): SensorManifest {
    const fromPack = registryRoot ? readPackDefaults(pack, registryRoot, cwd) : null;
    // No registry root, or the pack has no pack.json there → `{}` is the honest floor,
    // not a bug to paper over with CLI-hardcoded defaults. `checkManifest` (preflight)
    // and `computeSensorStatus` both surface a zero-sensor manifest as degraded, with a
    // remedy pointing at the registry — never silently inventing sensors here instead.
    const defaults = fromPack ?? {};
    const existingSensors = existing?.sensors ?? {};
    // Per-FIELD merge, not whole-sensor-object replacement: if `existingSensors.foo`
    // exists at all, a naive `{ ...defaults, ...existingSensors }` would replace
    // `defaults.foo` wholesale, permanently dropping any field that only lives in the
    // (newer) pack default — e.g. a pre-`formatter`-era manifest re-merged against a
    // pack.json that now declares `formatter` would silently lose it forever. Merging
    // field-by-field within each sensor entry lets a user's hand-edited field (e.g. a
    // custom `cmd`) win, while still inheriting any field the existing manifest doesn't
    // specify.
    const sensorNames = new Set([...Object.keys(defaults), ...Object.keys(existingSensors)]);
    const sensors: SensorManifest['sensors'] = {};
    for (const name of sensorNames) {
        sensors[name] = { ...defaults[name], ...existingSensors[name] };
    }
    return { pack, sensors };
}

/** Pack names present as directories under `<registryRoot>/sensor-packs/`, sorted. */
function availablePacks(registryRoot: string): string[] {
    const packsDir = path.join(registryRoot, 'sensor-packs');
    if (!fs.existsSync(packsDir) || !fs.statSync(packsDir).isDirectory()) return [];
    return fs.readdirSync(packsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
}

/** The last-resort pack, used when the detected one is absent from the registry. */
const FALLBACK_PACK = 'generic';

/**
 * Resolve the detected pack against what the registry actually ships.
 *
 * `--pack <name>` has always thrown here (`assertPackExists`), but auto-detection had
 * no such check: it wrote `{"pack":"python","sensors":{}}` and said nothing, so the
 * operator learned the gate was empty from an unrelated command days later. The two
 * paths now reach the same conclusion; only the remedy differs, because an explicit
 * `--pack` is a typo to correct while a detection is a fact about the tree that the
 * registry simply cannot serve yet.
 *
 * Falling back to `generic` keeps the gate measuring *something* real rather than
 * nothing. When the registry has no `generic` either, the detected pack is kept: the
 * manifest is then honestly empty, and preflight's `manifest`/`tools` checks both fail
 * on `total === 0` with a remedy pointing at the registry.
 */
function resolvePack(detected: string, registryRoot?: string): { pack: string; unavailablePack?: string } {
    if (!registryRoot) return { pack: detected };  // nothing to validate against
    const available = availablePacks(registryRoot);
    if (available.length === 0 || available.includes(detected)) return { pack: detected };
    return {
        pack: available.includes(FALLBACK_PACK) ? FALLBACK_PACK : detected,
        unavailablePack: detected,
    };
}

/**
 * Validate that `pack` exists as a directory under `<registryRoot>/sensor-packs/`.
 * Throws (not a swallow-and-return) so `awm sensors init --pack bogus` actually stops
 * instead of silently writing a manifest for a pack that doesn't exist. Lists every
 * pack directory actually present, sorted, so the user immediately sees valid options.
 */
function assertPackExists(pack: string, registryRoot: string): void {
    const packsDir = path.join(registryRoot, 'sensor-packs');
    if (!fs.existsSync(packsDir) || !fs.statSync(packsDir).isDirectory()) {
        throw new Error('registry has no sensor-packs directory');
    }
    const available = availablePacks(registryRoot);
    if (!available.includes(pack)) {
        throw new Error(`pack '${pack}' not found in registry (available: ${available.join(', ')})`);
    }
}

export async function initSensors(opts: InitOptions = {}): Promise<{
    manifest: SensorManifest;
    detection: StackDetection;
    configured: string[];
    /** The auto-detected pack the registry does not ship, when that happened. The
     *  manifest was built from the fallback pack (or left empty) instead — callers
     *  MUST surface this: an unannounced empty gate is the failure being prevented. */
    unavailablePack?: string;
    compatibility?: Record<string, unknown>;
    preserved?: string[];
    orphaned?: string[];
}> {
    const cwd = opts.cwd ?? process.cwd();
    const configure = opts.configure ?? true; // configure (copy pack config files) by default
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');

    // --pack skips the heuristic entirely. Only validate against the registry when a
    // registryRoot was actually given — same tolerance pattern as readPackDefaults /
    // buildManifest elsewhere in this file for a missing registry: nothing to validate
    // against, so nothing is validated.
    let detection: StackDetection;
    if (opts.pack) {
        if (opts.registryRoot) assertPackExists(opts.pack, opts.registryRoot);
        detection = { pack: opts.pack, indicators: ['--pack override'] };
    } else {
        detection = detectStack(cwd);
    }

    let existing: SensorManifest | undefined;
    let existingV2: SensorManifestV2 | undefined;
    if (fs.existsSync(manifestPath)) {
        let raw: unknown;
        try { raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); }
        catch { throw new Error(`cannot parse existing sensor manifest ${manifestPath}`); }
        // Never overwrite a corrupt or future-version manifest during init. Legacy
        // manifests remain a supported migration input; v2 is validated before a new
        // materialized selection becomes the commit point.
        const parsed = parseSensorManifest(raw, manifestPath);
        if (parsed.kind === 'legacy') existing = parsed.pack;
        else existingV2 = parsed.pack;
    }

    // `detection` keeps saying what the tree IS; `pack` is what the registry can serve
    // for it. They diverge only when the registry lacks the detected pack.
    const { pack: resolvedPack, unavailablePack } = resolvePack(detection.pack, opts.registryRoot);

    // v2 packs own the executable contract. Legacy packs deliberately retain the
    // old string-command path below until a registry author publishes a v2 contract.
    if (opts.registryRoot) {
        const resolvedV2 = readV2Pack(resolvedPack, opts.registryRoot);
        if (resolvedV2) {
            const packSelection = opts.pack ? 'explicit' as const : undefined;
            const compatibility = (await resolveParsedPackCompatibility(cwd, resolvedV2.pack, { packSelection })).sensors;
            const sensors: Record<string, any> = {};
            for (const [name, sensor] of Object.entries(resolvedV2.pack.sensors)) {
                const resolved = compatibility[name];
                const variant = resolved.variantId === null ? null : sensor.variants.find(candidate => candidate.id === resolved.variantId) ?? null;
                // Unresolved states do not receive an arbitrary command. They remain
                // represented in the manifest so status/coverage can explain them,
                // but run cannot accidentally dispatch a mismatched executable.
                if (variant) {
                    const prior = existing?.sensors[name] ?? existingV2?.sensors[name];
                    // Legacy string commands cannot be translated into a shell-free
                    // structured command without guessing. Preserve the operator's
                    // enabled/fast intent but make that migration non-certified.
                    const migratedOverride = existing?.sensors[name]?.cmd !== undefined;
                    sensors[name] = {
                        enabled: prior?.enabled ?? true,
                        fast: prior?.fast ?? sensor.fast ?? false,
                        variantId: variant.id,
                        command: variant.command,
                        assets: variant.assets,
                        ...(variant.policyRef ? { policyRef: variant.policyRef } : {}),
                        initializedCompatibility: migratedOverride
                            ? { ...resolved, state: 'compatible-unverified', reason: 'legacy custom command requires explicit v2 migration' }
                            : resolved,
                    };
                }
            }
            const materialized = materializeResolvedSensors({
                projectRoot: cwd, packRoot: resolvedV2.packRoot,
                pack: resolvedPack, ...(packSelection ? { packSelection } : {}), registryRoot: opts.registryRoot, sensors, configure,
            });
            return { detection, ...materialized,
                compatibility, ...(unavailablePack ? { unavailablePack } : {}) };
        }
    }

    const manifest = buildManifest(resolvedPack, existing, opts.registryRoot, cwd);
    fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
    const tmpPath = manifestPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tmpPath, manifestPath);

    const configured: string[] = [];
    if (configure && opts.registryRoot) {
        // The pack whose defaults the manifest was actually built from — copying the
        // detected pack's config files here would drop files for sensors that are not
        // in the manifest, and miss the ones that are.
        const packDir = path.join(opts.registryRoot, 'sensor-packs', resolvedPack);
        if (fs.existsSync(packDir)) {
            for (const file of fs.readdirSync(packDir).filter(f => f !== 'pack.json')) {
                const dst = path.join(cwd, file);
                if (!fs.existsSync(dst)) {
                    fs.copyFileSync(path.join(packDir, file), dst);
                    configured.push(file);
                }
            }
        }
    }

    return { manifest, detection, configured, ...(unavailablePack ? { unavailablePack } : {}) };
}
