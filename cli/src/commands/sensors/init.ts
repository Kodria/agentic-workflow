import fs from 'fs';
import path from 'path';
import { SensorManifest } from './types';
import { parseSensorPack } from './compatibility/contract';
import { resolvePackSource } from './compatibility/pack-source';
import { applySensorBootstrap, planSensorBootstrap } from './bootstrap';

export type InitOptions = {
    configure?: boolean;
    cwd?: string;
    registryRoot?: string;
    pack?: string;
    /** Contained relative path from cwd to the real project (package.json/tsconfig/
     *  etc). Monorepo support: the manifest is still written under cwd/.awm, but
     *  detection and materialized assets both resolve against cwd/packageRoot. */
    packageRoot?: string;
};

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

export async function initSensors(opts: InitOptions = {}): Promise<{
    /** Compatibility shape retained while all writes route through the v3 bootstrap. */
    manifest: SensorManifest;
    detection: StackDetection;
    configured: string[];
    status: 'created' | 'already-configured';
    unavailablePack?: string;
}> {
    const cwd = opts.cwd ?? process.cwd();
    const detectionCwd = opts.packageRoot ? path.resolve(cwd, opts.packageRoot) : cwd;
    const plan = await planSensorBootstrap(cwd, {
        mode: 'project-sensors', registryRoot: opts.registryRoot, configure: opts.configure,
        pack: opts.pack, packageRoot: opts.packageRoot,
    });
    if (plan.kind === 'blocked') throw new Error(`${plan.reason}: ${plan.remedy}`);
    if (plan.kind === 'migrate') throw new Error('initSensors does not migrate existing v2 manifests; run awm sensors bootstrap');
    if (plan.kind === 'noop') return {
        // No manifest is written or synthesized here. The compatibility API only
        // retains its historical result shape for callers that inspect detection.
        manifest: {} as SensorManifest, detection: detectStack(detectionCwd), configured: [], status: 'already-configured',
    };
    applySensorBootstrap(plan);
    return { manifest: plan.manifest as unknown as SensorManifest, detection: detectStack(detectionCwd), configured: [], status: 'created' };
}
