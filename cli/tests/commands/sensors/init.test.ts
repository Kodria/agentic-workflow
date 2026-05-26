import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectStack, detectSourceDirs, buildManifest, initSensors } from '../../../src/commands/sensors/init';

// Build a throwaway registry with a js-ts pack.json (the single source of truth
// init now reads from). `defaultCmd` uses the {{SOURCE_DIRS}} placeholder for depcheck.
function makeRegistry(): string {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
    const packDir = path.join(registryRoot, 'sensor-packs', 'js-ts');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
        name: 'js-ts',
        sensors: {
            typecheck: { fast: true, defaultCmd: 'npx tsc --noEmit' },
            lint:      { fast: true, defaultCmd: 'npx eslint . --config eslint.config.awm.mjs --cache --format json' },
            depcheck:  { fast: false, defaultCmd: 'npx depcruise --config .dep-cruiser.awm.js {{SOURCE_DIRS}}' },
            mutation:  { fast: false, enabled: false, defaultCmd: 'npx stryker run' },
        },
    }));
    return registryRoot;
}

describe('detectStack', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('detects js-ts when package.json exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('detects python when pyproject.toml exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('falls back to generic when no indicators found', () => {
        expect(detectStack(tmpDir).pack).toBe('generic');
    });
});

describe('detectSourceDirs', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-src-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('returns the App-Router-style dirs that exist', () => {
        for (const d of ['app', 'lib', 'components']) fs.mkdirSync(path.join(tmpDir, d));
        expect(detectSourceDirs(tmpDir)).toEqual(['app', 'lib', 'components']);
    });

    it('returns src when it exists', () => {
        fs.mkdirSync(path.join(tmpDir, 'src'));
        expect(detectSourceDirs(tmpDir)).toEqual(['src']);
    });

    it('falls back to ["src"] when no known source dir exists', () => {
        expect(detectSourceDirs(tmpDir)).toEqual(['src']);
    });
});

describe('buildManifest', () => {
    let registryRoot: string;
    let cwd: string;
    beforeEach(() => {
        registryRoot = makeRegistry();
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cwd-'));
    });
    afterEach(() => {
        fs.rmSync(registryRoot, { recursive: true });
        fs.rmSync(cwd, { recursive: true });
    });

    it('builds manifest from the pack.json single source', () => {
        const m = buildManifest('js-ts', undefined, registryRoot, cwd);
        expect(m.pack).toBe('js-ts');
        expect(m.sensors.typecheck.cmd).toBe('npx tsc --noEmit');
        expect(m.sensors.lint.cmd).toContain('--config eslint.config.awm.mjs');
    });

    it('substitutes {{SOURCE_DIRS}} in depcheck with the detected dirs', () => {
        for (const d of ['app', 'lib']) fs.mkdirSync(path.join(cwd, d));
        const m = buildManifest('js-ts', undefined, registryRoot, cwd);
        expect(m.sensors.depcheck.cmd).toBe('npx depcruise --config .dep-cruiser.awm.js app lib');
        expect(m.sensors.depcheck.cmd).not.toContain('{{SOURCE_DIRS}}');
    });

    it('merges conservatively — existing sensor commands are preserved', () => {
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'custom-tsc', fast: true } } };
        const m = buildManifest('js-ts', existing, registryRoot, cwd);
        expect(m.sensors.typecheck.cmd).toBe('custom-tsc');
        expect(m.sensors.lint).toBeDefined();
    });

    it('uses the python fallback when the pack has no pack.json', () => {
        const m = buildManifest('python', undefined, registryRoot, cwd);
        expect(m.sensors.typecheck.cmd).toBe('mypy .');
    });
});

describe('initSensors', () => {
    let tmpDir: string;
    let registryRoot: string;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-'));
        registryRoot = makeRegistry();
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
        fs.rmSync(registryRoot, { recursive: true });
    });

    it('creates .awm/sensors.json for js-ts project', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        const result = initSensors({ cwd: tmpDir, registryRoot });
        expect(fs.existsSync(path.join(tmpDir, '.awm', 'sensors.json'))).toBe(true);
        expect(result.detection.pack).toBe('js-ts');
        expect(result.manifest.sensors.typecheck).toBeDefined();
    });

    it('is idempotent — existing sensor commands survive re-init', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'my-tsc', fast: true } } };
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(existing));
        initSensors({ cwd: tmpDir, registryRoot });
        const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf-8'));
        expect(written.sensors.typecheck.cmd).toBe('my-tsc');
        expect(written.sensors.lint).toBeDefined(); // new sensor added
    });

    it('copies pack config files into the repo by default (configure on)', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(registryRoot, 'sensor-packs', 'js-ts', 'tsconfig.awm.json'), '{}');
        const result = initSensors({ cwd: tmpDir, registryRoot }); // no explicit configure → default true
        expect(result.configured).toContain('tsconfig.awm.json');
        expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(true);
    });

    it('does NOT copy config files when configure is false', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(registryRoot, 'sensor-packs', 'js-ts', 'tsconfig.awm.json'), '{}');
        const result = initSensors({ cwd: tmpDir, registryRoot, configure: false });
        expect(result.configured).toEqual([]);
        expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(false);
    });
});
