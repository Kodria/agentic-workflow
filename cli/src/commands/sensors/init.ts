import fs from 'fs';
import path from 'path';
import { SensorManifest } from './types';

export type InitOptions = {
    configure?: boolean;
    cwd?: string;
    registryRoot?: string;
};

export type StackDetection = {
    pack: 'js-ts' | 'python' | 'generic';
    indicators: string[];
};

const STACK_DETECTORS: Array<{ pack: StackDetection['pack']; files: string[] }> = [
    { pack: 'js-ts', files: ['package.json'] },
    { pack: 'python', files: ['pyproject.toml', 'setup.py', 'setup.cfg'] },
];

export function detectStack(cwd: string): StackDetection {
    for (const { pack, files } of STACK_DETECTORS) {
        const found = files.filter(f => fs.existsSync(path.join(cwd, f)));
        if (found.length > 0) return { pack, indicators: found };
    }
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

// Fallback defaults for packs that don't yet ship a pack.json in the registry
// (today: python). js-ts/generic are sourced from
// registry/sensor-packs/<pack>/pack.json — single source of truth.
const FALLBACK_DEFAULTS: Record<string, SensorManifest['sensors']> = {
    python: {
        typecheck: { cmd: 'mypy .', fast: true },
        lint:      { cmd: 'ruff check . --output-format json', fast: true },
        security:  { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
        mutation:  { enabled: false },
    },
};

type PackJson = {
    sensors?: Record<string, { defaultCmd?: string; fast?: boolean; enabled?: boolean }>;
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
    const defaults = fromPack ?? FALLBACK_DEFAULTS[pack] ?? {};
    const existingSensors = existing?.sensors ?? {};
    return { pack, sensors: { ...defaults, ...existingSensors } };
}

export function initSensors(opts: InitOptions = {}): { manifest: SensorManifest; detection: StackDetection; configured: string[] } {
    const cwd = opts.cwd ?? process.cwd();
    const configure = opts.configure ?? true; // configure (copy pack config files) by default
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');
    const detection = detectStack(cwd);

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
