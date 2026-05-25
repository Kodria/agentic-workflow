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

const PACK_DEFAULTS: Record<string, SensorManifest['sensors']> = {
    'js-ts': {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        lint:      { cmd: 'npx eslint . --format json', fast: true },
        security:  { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
        depcheck:  { cmd: 'npx depcruise --config .dep-cruiser.awm.js src', fast: false },
        mutation:  { enabled: false },
    },
    python: {
        typecheck: { cmd: 'mypy .', fast: true },
        lint:      { cmd: 'ruff check . --output-format json', fast: true },
        security:  { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
        mutation:  { enabled: false },
    },
    generic: {
        security: { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
    },
};

export function buildManifest(pack: string, existing?: SensorManifest): SensorManifest {
    const defaults = PACK_DEFAULTS[pack] ?? {};
    const existingSensors = existing?.sensors ?? {};
    return { pack, sensors: { ...defaults, ...existingSensors } };
}

export function initSensors(opts: InitOptions = {}): { manifest: SensorManifest; detection: StackDetection; configured: string[] } {
    const cwd = opts.cwd ?? process.cwd();
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');
    const detection = detectStack(cwd);

    let existing: SensorManifest | undefined;
    if (fs.existsSync(manifestPath)) {
        try { existing = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* ignore corrupt manifest */ }
    }

    const manifest = buildManifest(detection.pack, existing);
    fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const configured: string[] = [];
    if (opts.configure && opts.registryRoot) {
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
