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
            typecheck: { fast: true, defaultCmd: 'npx tsc --noEmit', formatter: 'tsc' },
            lint:      { fast: true, defaultCmd: 'npx eslint . --config eslint.config.awm.mjs --cache --format json', formatter: 'eslint-llm' },
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

    it('detects shell from a root-level *.sh file when no js-ts/python marker exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        const result = detectStack(tmpDir);
        expect(result.pack).toBe('shell');
        expect(result.indicators).toEqual(['deploy.sh']);
    });

    it('detects shell from a scripts/*.sh file when root has nothing', () => {
        fs.mkdirSync(path.join(tmpDir, 'scripts'));
        fs.writeFileSync(path.join(tmpDir, 'scripts', 'build.sh'), '#!/bin/sh\n');
        const result = detectStack(tmpDir);
        expect(result.pack).toBe('shell');
        expect(result.indicators).toEqual([path.join('scripts', 'build.sh')]);
    });

    it('js-ts wins over shell when both package.json and a root .sh file exist', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('python wins over shell when both a python marker and a root .sh file exist', () => {
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('falls through to generic when scripts/ has only non-.sh files (glob must not over-match)', () => {
        fs.mkdirSync(path.join(tmpDir, 'scripts'));
        fs.writeFileSync(path.join(tmpDir, 'scripts', 'notes.txt'), 'not shell');
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

    it('carries the formatter field through from pack.json into the built manifest', () => {
        // readPackDefaults must copy `formatter` the same way it already copies
        // `changedCmd`/`changedExtensions` — this is what lets run.ts's getFormatter
        // dispatch by real tool (ruff/mypy/shellcheck) instead of guessing from the
        // sensor name. Without this carry-through the field is read from pack.json but
        // silently dropped before it ever reaches the manifest run.ts consumes.
        const m = buildManifest('js-ts', undefined, registryRoot, cwd);
        expect(m.sensors.typecheck.formatter).toBe('tsc');
        expect(m.sensors.lint.formatter).toBe('eslint-llm');
    });

    it('returns an empty sensors object when the pack has no pack.json in the registry', () => {
        // No FALLBACK_DEFAULTS anymore: `python` has no pack dir in this fixture
        // registry (only js-ts does — see makeRegistry) → the honest floor is `{}`,
        // never CLI-hardcoded commands that can drift from what the registry ships.
        const m = buildManifest('python', undefined, registryRoot, cwd);
        expect(m.sensors).toEqual({});
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

describe('initSensors — --pack override', () => {
    let tmpDir: string;
    let registryRoot: string;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-pack-'));
        registryRoot = makeRegistry(); // only ships a js-ts pack dir — see makeRegistry
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
        fs.rmSync(registryRoot, { recursive: true });
    });

    it('skips detection and uses the override pack when it exists in the registry', () => {
        // No package.json/pyproject.toml here — if detection ran, this would be 'generic'.
        const result = initSensors({ pack: 'js-ts', registryRoot, cwd: tmpDir });
        expect(result.detection.pack).toBe('js-ts');
        // Indicators must reflect an override, not file-based detection.
        expect(result.detection.indicators).not.toEqual(['package.json']);
        expect(result.detection.indicators.join(' ')).toMatch(/pack override/i);
    });

    it('throws listing available packs when the override pack is not in the registry', () => {
        expect(() => initSensors({ pack: 'bogus', registryRoot, cwd: tmpDir })).toThrow(/js-ts/);
        try {
            initSensors({ pack: 'bogus', registryRoot, cwd: tmpDir });
            throw new Error('expected initSensors to throw');
        } catch (e) {
            expect((e as Error).message).toContain('bogus');
            expect((e as Error).message).toContain('js-ts');
        }
    });

    it('does not throw when no registryRoot is given — nothing to validate against', () => {
        expect(() => initSensors({ pack: 'anything', cwd: tmpDir })).not.toThrow();
        const result = initSensors({ pack: 'anything', cwd: tmpDir });
        expect(result.detection.pack).toBe('anything');
    });
});
