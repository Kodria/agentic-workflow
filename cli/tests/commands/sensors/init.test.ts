import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectStack, detectSourceDirs, buildManifest, initSensors } from '../../../src/commands/sensors/init';
import { computeSensorStatus } from '../../../src/commands/sensors/status';

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

// Mirrors makeRegistry()'s js-ts shape but for a python pack.json that declares
// `formatter` on `typecheck` — needed for the buildManifest per-field-merge
// regression test (a pre-`formatter`-era existing manifest must still inherit it).
function makePythonRegistry(): string {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-py-'));
    const packDir = path.join(registryRoot, 'sensor-packs', 'python');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
        name: 'python',
        sensors: {
            typecheck: { fast: true, defaultCmd: 'mypy .', formatter: 'mypy' },
            lint:      { fast: true, defaultCmd: 'ruff check --output-format=json .', formatter: 'ruff' },
        },
    }));
    return registryRoot;
}

function makeV2Registry(): string {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-v2-'));
    const packDir = path.join(registryRoot, 'sensor-packs', 'js-ts');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'eslint.config.awm.mjs'), 'export default []\n');
    fs.writeFileSync(path.join(packDir, 'tsconfig.awm.json'), '{ "compilerOptions": { "strict": true } }\n');
    fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
        schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
        coverage: { schemaVersion: 1, classes: { lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix lint', command: 'awm sensors init --pack js-ts' } } } },
        hardening: { 'typescript-strict': { assets: ['tsconfig.awm.json'] } },
        sensors: { lint: { applicability: { allFiles: ['package.json'] }, variants: [{
            id: 'eslint-10', priority: 10, certifiedRange: '>=10.0.0 <11.0.0',
            requirements: { tool: 'eslint', toolRange: '>=10.0.0 <11.0.0', runtime: 'node', runtimeRange: '>=0.0.0' },
            assets: ['eslint.config.awm.mjs'], formatter: 'eslint-llm', probe: { kind: 'config-present' },
            command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
        }] } },
    }));
    return registryRoot;
}

function makeGenericV2Registry(): string {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-generic-v2-'));
    const packDir = path.join(registryRoot, 'sensor-packs', 'generic');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'generic.config'), 'fixture\n');
    fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
        schemaVersion: 2, name: 'generic', description: 'fixture', detects: ['README.md'],
        coverage: { schemaVersion: 1, classes: { security: { description: 'security', detectors: [{ sensor: 'security' }], remedy: { summary: 'run security', command: 'awm sensors init --pack generic' } } } },
        sensors: { security: { applicability: { kind: 'explicit-or-supported-language' }, variants: [{
            id: 'eslint-10', priority: 10, certifiedRange: '>=10.0.0 <11.0.0',
            requirements: { tool: 'eslint', toolRange: '>=10.0.0 <11.0.0', runtime: 'node', runtimeRange: '>=0.0.0', configFiles: ['generic.config'] },
            assets: ['generic.config'], formatter: 'eslint-llm', probe: { kind: 'config-present' },
            command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
        }] } },
    }));
    return registryRoot;
}

describe('detectStack', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('detects js-ts when package.json exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('detects python when pyproject.toml exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('falls back to generic when no indicators found', async () => {
        expect(detectStack(tmpDir).pack).toBe('generic');
    });

    it('detects shell from a root-level *.sh file when no js-ts/python marker exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        const result = detectStack(tmpDir);
        expect(result.pack).toBe('shell');
        expect(result.indicators).toEqual(['deploy.sh']);
    });

    it('detects shell from a scripts/*.sh file when root has nothing', async () => {
        fs.mkdirSync(path.join(tmpDir, 'scripts'));
        fs.writeFileSync(path.join(tmpDir, 'scripts', 'build.sh'), '#!/bin/sh\n');
        const result = detectStack(tmpDir);
        expect(result.pack).toBe('shell');
        expect(result.indicators).toEqual([path.join('scripts', 'build.sh')]);
    });

    it('js-ts wins over shell when both package.json and a root .sh file exist', async () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('python wins over shell when both a python marker and a root .sh file exist', async () => {
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('falls through to generic when scripts/ has only non-.sh files (glob must not over-match)', async () => {
        fs.mkdirSync(path.join(tmpDir, 'scripts'));
        fs.writeFileSync(path.join(tmpDir, 'scripts', 'notes.txt'), 'not shell');
        expect(detectStack(tmpDir).pack).toBe('generic');
    });

    it('detects python from requirements.txt alone', async () => {
        fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('detects python from Pipfile alone', async () => {
        fs.writeFileSync(path.join(tmpDir, 'Pipfile'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('python (via Pipfile) wins over shell when both a Pipfile and a root .sh file exist', async () => {
        fs.writeFileSync(path.join(tmpDir, 'Pipfile'), '');
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('does not report a directory named "*.sh" as a shell indicator', async () => {
        // Directory literally named `something.sh` (not a file) — findShellIndicators'
        // `entry.isFile()` guard must exclude it. Nothing else present → generic.
        fs.mkdirSync(path.join(tmpDir, 'something.sh'));
        expect(detectStack(tmpDir).pack).toBe('generic');
    });

    it('ignores a directory named "*.sh" but still finds a real .sh file alongside it', async () => {
        fs.mkdirSync(path.join(tmpDir, 'notreal.sh'));
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        const result = detectStack(tmpDir);
        expect(result.pack).toBe('shell');
        expect(result.indicators).toEqual(['deploy.sh']);
    });
});

describe('detectSourceDirs', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-src-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('returns the App-Router-style dirs that exist', async () => {
        for (const d of ['app', 'lib', 'components']) fs.mkdirSync(path.join(tmpDir, d));
        expect(detectSourceDirs(tmpDir)).toEqual(['app', 'lib', 'components']);
    });

    it('returns src when it exists', async () => {
        fs.mkdirSync(path.join(tmpDir, 'src'));
        expect(detectSourceDirs(tmpDir)).toEqual(['src']);
    });

    it('falls back to ["src"] when no known source dir exists', async () => {
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

    it('builds manifest from the pack.json single source', async () => {
        const m = buildManifest('js-ts', undefined, registryRoot, cwd);
        expect(m.pack).toBe('js-ts');
        expect(m.sensors.typecheck.cmd).toBe('npx tsc --noEmit');
        expect(m.sensors.lint.cmd).toContain('--config eslint.config.awm.mjs');
    });

    it('substitutes {{SOURCE_DIRS}} in depcheck with the detected dirs', async () => {
        for (const d of ['app', 'lib']) fs.mkdirSync(path.join(cwd, d));
        const m = buildManifest('js-ts', undefined, registryRoot, cwd);
        expect(m.sensors.depcheck.cmd).toBe('npx depcruise --config .dep-cruiser.awm.js app lib');
        expect(m.sensors.depcheck.cmd).not.toContain('{{SOURCE_DIRS}}');
    });

    it('merges conservatively — existing sensor commands are preserved', async () => {
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'custom-tsc', fast: true } } };
        const m = buildManifest('js-ts', existing, registryRoot, cwd);
        expect(m.sensors.typecheck.cmd).toBe('custom-tsc');
        expect(m.sensors.lint).toBeDefined();
    });

    it('carries the formatter field through from pack.json into the built manifest', async () => {
        // readPackDefaults must copy `formatter` the same way it already copies
        // `changedCmd`/`changedExtensions` — this is what lets run.ts's getFormatter
        // dispatch by real tool (ruff/mypy/shellcheck) instead of guessing from the
        // sensor name. Without this carry-through the field is read from pack.json but
        // silently dropped before it ever reaches the manifest run.ts consumes.
        const m = buildManifest('js-ts', undefined, registryRoot, cwd);
        expect(m.sensors.typecheck.formatter).toBe('tsc');
        expect(m.sensors.lint.formatter).toBe('eslint-llm');
    });

    it('returns an empty sensors object when the pack has no pack.json in the registry', async () => {
        // No FALLBACK_DEFAULTS anymore: `python` has no pack dir in this fixture
        // registry (only js-ts does — see makeRegistry) → the honest floor is `{}`,
        // never CLI-hardcoded commands that can drift from what the registry ships.
        const m = buildManifest('python', undefined, registryRoot, cwd);
        expect(m.sensors).toEqual({});
    });

    it('per-field merge: an existing sensor missing a newer pack field still inherits it', async () => {
        // Regression for Finding 1: a manifest written by the old FALLBACK_DEFAULTS-era
        // CLI has `typecheck: { cmd: 'mypy .', fast: true }` — no `formatter`, because
        // that field didn't exist yet. A naive `{ ...defaults, ...existingSensors }`
        // whole-sensor-object merge would replace `defaults.typecheck` wholesale,
        // permanently dropping `formatter` even though the (upgraded) pack now declares
        // it. The fix merges per FIELD within each sensor, so `formatter` — a field the
        // existing manifest never specified — is inherited from the pack default.
        const pyRegistryRoot = makePythonRegistry();
        try {
            const existing = {
                pack: 'python',
                sensors: { typecheck: { cmd: 'mypy .', fast: true } },
            };
            const m = buildManifest('python', existing, pyRegistryRoot, cwd);
            expect(m.sensors.typecheck.formatter).toBe('mypy');
            expect(m.sensors.typecheck.cmd).toBe('mypy .');
            expect(m.sensors.typecheck.fast).toBe(true);
        } finally {
            fs.rmSync(pyRegistryRoot, { recursive: true });
        }
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

    it('creates .awm/sensors.json for js-ts project', async () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        const result = await initSensors({ cwd: tmpDir, registryRoot });
        expect(fs.existsSync(path.join(tmpDir, '.awm', 'sensors.json'))).toBe(true);
        expect(result.detection.pack).toBe('js-ts');
        expect(result.manifest.sensors.typecheck).toBeDefined();
    });

    it('is idempotent — existing sensor commands survive re-init', async () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'my-tsc', fast: true } } };
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(existing));
        await initSensors({ cwd: tmpDir, registryRoot });
        const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf-8'));
        expect(written.sensors.typecheck.cmd).toBe('my-tsc');
        expect(written.sensors.lint).toBeDefined(); // new sensor added
    });

    it('copies pack config files into the repo by default (configure on)', async () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(registryRoot, 'sensor-packs', 'js-ts', 'tsconfig.awm.json'), '{}');
        const result = await initSensors({ cwd: tmpDir, registryRoot }); // no explicit configure → default true
        expect(result.configured).toContain('tsconfig.awm.json');
        expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(true);
    });

    it('does NOT copy config files when configure is false', async () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.writeFileSync(path.join(registryRoot, 'sensor-packs', 'js-ts', 'tsconfig.awm.json'), '{}');
        const result = await initSensors({ cwd: tmpDir, registryRoot, configure: false });
        expect(result.configured).toEqual([]);
        expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(false);
    });

    it('awaits v2 compatibility probes and persists their materialized evidence', async () => {
        const v2Registry = makeV2Registry();
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
            const result = await initSensors({ cwd: tmpDir, registryRoot: v2Registry });
            const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf8'));
            expect(result.manifest).toMatchObject({ schemaVersion: 2, sensors: { lint: { variantId: 'eslint-10' } } });
            // `package.json` is a declared detection file, so config-present matches.
            // Without init awaiting the probe the resolver stays `unverifiable`; this
            // exact assertion therefore distinguishes the async probe integration.
            expect(written.sensors.lint.initializedCompatibility).toMatchObject({ variantId: 'eslint-10', state: 'certified', reason: 'range-and-probe' });
            expect(written.registryRoot).toBe(v2Registry);
            expect(fs.existsSync(path.join(tmpDir, 'eslint.config.awm.mjs'))).toBe(true);
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('persists an explicit generic selection for live revalidation without promoting automatic generic fallback', async () => {
        const v2Registry = makeGenericV2Registry();
        try {
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));

            const automatic = await initSensors({ cwd: tmpDir, registryRoot: v2Registry, configure: false });
            expect(automatic.manifest).toMatchObject({ schemaVersion: 2, pack: 'generic', sensors: {} });
            expect((automatic.manifest as any).packSelection).toBeUndefined();

            fs.writeFileSync(path.join(tmpDir, 'generic.config'), 'fixture\n');
            const explicit = await initSensors({ cwd: tmpDir, registryRoot: v2Registry, pack: 'generic' });
            const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf8'));
            expect(explicit.manifest).toMatchObject({ schemaVersion: 2, pack: 'generic', packSelection: 'explicit', sensors: { security: { variantId: 'eslint-10' } } });
            expect(written.packSelection).toBe('explicit');
            await expect(computeSensorStatus(tmpDir)).resolves.toMatchObject({ overall: 'DEGRADED', checks: { security: { ok: false } } });
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('never materializes an opt-in hardening asset during ordinary v2 init', async () => {
        const v2Registry = makeV2Registry();
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
            await initSensors({ cwd: tmpDir, registryRoot: v2Registry });
            expect(fs.existsSync(path.join(tmpDir, 'eslint.config.awm.mjs'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(false);
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('initializes a selected v2 variant with an explicitly empty assets list', async () => {
        const v2Registry = makeV2Registry();
        try {
            const packPath = path.join(v2Registry, 'sensor-packs', 'js-ts', 'pack.json');
            const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
            pack.sensors.lint.variants[0].assets = [];
            fs.writeFileSync(packPath, JSON.stringify(pack));
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));

            await expect(initSensors({ cwd: tmpDir, registryRoot: v2Registry })).resolves.toMatchObject({
                manifest: { schemaVersion: 2, sensors: { lint: { assets: [] } } },
                configured: [],
            });
            expect(fs.existsSync(path.join(tmpDir, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('preserves enabled and fast choices when a valid v2 manifest is re-initialized', async () => {
        const v2Registry = makeV2Registry();
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
            await initSensors({ cwd: tmpDir, registryRoot: v2Registry });
            const manifestPath = path.join(tmpDir, '.awm', 'sensors.json');
            const selected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            selected.sensors.lint.enabled = false;
            selected.sensors.lint.fast = true;
            fs.writeFileSync(manifestPath, JSON.stringify(selected));

            await initSensors({ cwd: tmpDir, registryRoot: v2Registry });

            const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(written.sensors.lint).toMatchObject({ enabled: false, fast: true, variantId: 'eslint-10' });
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('preserves only the project timeout override, never prior executable authority (R3, R10)', async () => {
        const v2Registry = makeV2Registry();
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
            await initSensors({ cwd: tmpDir, registryRoot: v2Registry });
            const manifestPath = path.join(tmpDir, '.awm', 'sensors.json');
            const selected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            selected.sensors.lint.timeout = 45_000;
            selected.sensors.lint.command = {
                executable: 'otherlint', resolution: 'path', args: ['--custom'],
                environment: { ESLINT_USE_FLAT_CONFIG: 'false' },
            };
            selected.sensors.lint.assets = ['prior-owned.config'];
            fs.writeFileSync(manifestPath, JSON.stringify(selected));

            await initSensors({ cwd: tmpDir, registryRoot: v2Registry });

            const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(written.sensors.lint).toMatchObject({
                timeout: 45_000,
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                assets: ['eslint.config.awm.mjs'],
            });
            expect(written.sensors.lint.command.environment).toBeUndefined();
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('rejects a symlinked v2 pack source instead of reading it through init', async () => {
        const v2Registry = makeV2Registry();
        try {
            const packPath = path.join(v2Registry, 'sensor-packs', 'js-ts', 'pack.json');
            const outside = path.join(v2Registry, 'outside-pack.json');
            fs.renameSync(packPath, outside);
            fs.symlinkSync(outside, packPath);
            fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

            await expect(initSensors({ cwd: tmpDir, registryRoot: v2Registry })).rejects.toThrow(/symbolic|regular|contain/i);
            expect(fs.existsSync(path.join(tmpDir, '.awm', 'sensors.json'))).toBe(false);
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('migrates legacy overrides explicitly without silently certifying or re-enabling them', async () => {
        const v2Registry = makeV2Registry();
        try {
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
            fs.mkdirSync(path.join(tmpDir, '.awm'));
            fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
                pack: 'js-ts', sensors: { lint: { cmd: 'my-company-eslint .', enabled: false, fast: true } },
            }));
            await initSensors({ cwd: tmpDir, registryRoot: v2Registry });
            const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf8'));
            expect(written.sensors.lint).toMatchObject({ enabled: false, fast: true });
            expect(written.sensors.lint.initializedCompatibility).toMatchObject({ state: 'compatible-unverified', reason: expect.stringContaining('legacy custom command') });
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });
});

describe('initSensors — packageRoot (monorepo)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-monorepo-'));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects the real package under packageRoot, not the manifest directory', async () => {
        const v2Registry = makeV2Registry();
        try {
            // The manifest will live at tmpDir/.awm/sensors.json (repo root), but the
            // real package — package.json, node_modules — lives under tmpDir/cli.
            const packageDir = path.join(tmpDir, 'cli');
            fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(packageDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));

            const result = await initSensors({ cwd: tmpDir, registryRoot: v2Registry, packageRoot: 'cli' });

            // Real detection succeeded — a manifest built against tmpDir root (with no
            // package.json there) would leave lint unresolved/absent.
            expect(result.manifest).toMatchObject({ packageRoot: 'cli', sensors: { lint: { variantId: 'eslint-10' } } });

            // The manifest itself stays discoverable at the repo root (findManifestDir
            // walks up from cwd, never down into subdirectories).
            expect(fs.existsSync(path.join(tmpDir, '.awm', 'sensors.json'))).toBe(true);
            expect(fs.existsSync(path.join(packageDir, '.awm', 'sensors.json'))).toBe(false);
            const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf8'));
            expect(written.packageRoot).toBe('cli');
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
    });

    it('copies configured assets into packageRoot, not the manifest directory', async () => {
        const v2Registry = makeV2Registry();
        try {
            const packageDir = path.join(tmpDir, 'cli');
            fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(packageDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));

            await initSensors({ cwd: tmpDir, registryRoot: v2Registry, packageRoot: 'cli' });

            // The asset must land where the lint sensor will actually execute (cwd=cli),
            // not at the manifest's own directory (repo root) — otherwise a config-relative
            // tool invocation can never find it.
            expect(fs.existsSync(path.join(packageDir, 'eslint.config.awm.mjs'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            fs.rmSync(v2Registry, { recursive: true, force: true });
        }
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

    it('skips detection and uses the override pack when it exists in the registry', async () => {
        // No package.json/pyproject.toml here — if detection ran, this would be 'generic'.
        const result = await initSensors({ pack: 'js-ts', registryRoot, cwd: tmpDir });
        expect(result.detection.pack).toBe('js-ts');
        // Indicators must reflect an override, not file-based detection.
        expect(result.detection.indicators).not.toEqual(['package.json']);
        expect(result.detection.indicators.join(' ')).toMatch(/pack override/i);
    });

    it('throws listing available packs when the override pack is not in the registry', async () => {
        await expect(initSensors({ pack: 'bogus', registryRoot, cwd: tmpDir })).rejects.toThrow(/js-ts/);
        await expect(initSensors({ pack: 'bogus', registryRoot, cwd: tmpDir })).rejects.toThrow(/bogus/);
    });

    it('does not throw when no registryRoot is given — nothing to validate against', async () => {
        await expect(initSensors({ pack: 'anything', cwd: tmpDir })).resolves.toBeDefined();
        const result = await initSensors({ pack: 'anything', cwd: tmpDir });
        expect(result.detection.pack).toBe('anything');
    });

    it('throws a distinct message when the registry root has no sensor-packs directory at all', async () => {
        // Different failure shape from "pack not in the list": the registry root
        // itself is missing sensor-packs/, so there's no list to show — must say
        // so plainly instead of reporting an empty `available: `.
        const emptyRegistryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-reg-'));
        try {
            await expect(initSensors({ pack: 'js-ts', registryRoot: emptyRegistryRoot, cwd: tmpDir }))
                .rejects.toThrow(/no sensor-packs directory/);
        } finally {
            fs.rmSync(emptyRegistryRoot, { recursive: true });
        }
    });
});
