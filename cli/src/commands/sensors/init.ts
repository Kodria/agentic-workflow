import fs from 'fs';
import path from 'path';
import { SensorManifest } from './types';

export type InitOptions = {
    configure?: boolean;
    cwd?: string;
    registryRoot?: string;
    pack?: string;
};

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
    { pack: 'python', files: ['pyproject.toml', 'setup.py', 'setup.cfg'] },
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
        for (const f of fs.readdirSync(full)) {
            if (f.endsWith('.sh')) found.push(dir === '.' ? f : path.join(dir, f));
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
    const packJsonPath = path.join(registryRoot, 'sensor-packs', pack, 'pack.json');
    if (!fs.existsSync(packJsonPath)) return null;
    let parsed: PackJson;
    try { parsed = JSON.parse(fs.readFileSync(packJsonPath, 'utf-8')); } catch { return null; }

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
    return { pack, sensors: { ...defaults, ...existingSensors } };
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
    const available = fs.readdirSync(packsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    if (!available.includes(pack)) {
        throw new Error(`pack '${pack}' not found in registry (available: ${available.join(', ')})`);
    }
}

export function initSensors(opts: InitOptions = {}): { manifest: SensorManifest; detection: StackDetection; configured: string[] } {
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
    if (fs.existsSync(manifestPath)) {
        try { existing = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* ignore corrupt manifest */ }
    }

    const manifest = buildManifest(detection.pack, existing, opts.registryRoot, cwd);
    fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
    const tmpPath = manifestPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.renameSync(tmpPath, manifestPath);

    const configured: string[] = [];
    if (configure && opts.registryRoot) {
        const packDir = path.join(opts.registryRoot, 'sensor-packs', detection.pack);
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

    return { manifest, detection, configured };
}
