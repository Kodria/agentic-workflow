import { assertNoEqualPriorityOverlap, parseSensorPack } from '../../../../src/commands/sensors/compatibility/contract';
import { positiveTimeout, resolveTimeout } from '../../../../src/commands/sensors/compatibility/timeout';
import fs from 'fs';
import os from 'os';
import path from 'path';

const coverage = {
    schemaVersion: 1,
    classes: {
        formatting: {
            description: 'Formatting is checked.',
            detectors: [{ sensor: 'lint' }],
            remedy: { summary: 'Add a formatter.', command: 'npm install prettier' },
        },
    },
};

function validPack() {
    return {
        schemaVersion: 2,
        name: 'js-ts', description: 'fixture', detects: ['package.json'],
        sensors: {
            lint: {
                applicability: { allFiles: ['package.json'] },
                variants: [{
                    id: 'eslint-9',
                    priority: 10,
                    requirements: { tool: 'eslint', toolRange: '>=9.0.0 <10.0.0', runtime: 'node', runtimeRange: '>=20.0.0' },
                    certifiedRange: '>=9.0.0 <10.0.0',
                    assets: ['eslint.config.awm.mjs'], formatter: 'eslint-llm', probe: { kind: 'eslint-print-config' },
                    command: {
                        executable: 'eslint',
                        resolution: 'node-modules-bin',
                        args: ['--format', 'json', '{files}'],
                        fileInput: { placeholder: '{files}', extensions: ['.ts', '.tsx'] },
                    },
                }],
            },
        },
        coverage,
    };
}

describe('sensor pack v2 contract', () => {
    it('exports bounded timeout validation and resolution (R3.1, R3.4)', () => {
        expect(positiveTimeout(1, 'sensor timeout')).toBe(1);
        expect(resolveTimeout({ project: 90_000, pack: 30_000, fast: true })).toEqual({ timeoutMs: 90_000, source: 'project' });
        expect(resolveTimeout({ pack: 30_000, fast: true })).toEqual({ timeoutMs: 30_000, source: 'pack' });
        expect(resolveTimeout({ fast: true })).toEqual({ timeoutMs: 10_000, source: 'fallback' });
        expect(resolveTimeout({ fast: false })).toEqual({ timeoutMs: 120_000, source: 'fallback' });
    });

    test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000'])('rejects invalid resolved timeout %p (R3.3)', timeout => {
        expect(() => positiveTimeout(timeout, 'sensor timeout')).toThrow(/sensor timeout.*positive safe integer/);
        expect(() => resolveTimeout({ project: timeout as number, fast: true })).toThrow(/project timeout.*positive safe integer/);
    });

    it('rejects malformed timeout helper inputs loudly (R3.4)', () => {
        expect(() => positiveTimeout(1000, '')).toThrow('timeout location must be a nonempty string');
        expect(() => resolveTimeout(null as unknown as { fast: boolean })).toThrow('timeout resolution input is invalid');
        expect(() => resolveTimeout({ fast: 'true' } as unknown as { fast: boolean })).toThrow('timeout resolution input is invalid');
    });

    it('derives Semgrep compatibility from a contained shared policy reference', () => {
        const sensorPacks = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-policy-'));
        const packDir = path.join(sensorPacks, 'python');
        try {
            fs.mkdirSync(path.join(sensorPacks, 'shared'), { recursive: true });
            fs.mkdirSync(packDir);
            fs.writeFileSync(path.join(sensorPacks, 'shared', 'semgrep-policy.json'), JSON.stringify({
                tool: 'semgrep', toolRange: '>=1.0.0', runtime: 'python', runtimeRange: '>=3.9.0', probe: 'semgrep-validate',
            }));
            const pack = validPack();
            pack.sensors.lint.variants[0] = {
                id: 'semgrep-python', priority: 10, certifiedRange: '>=1.0.0', policyRef: 'shared/semgrep-policy.json',
                command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml', '--json', '.'] },
                assets: ['.semgrep.awm.yml'], formatter: 'semgrep',
            } as any;
            const parsed = parseSensorPack(pack, path.join(packDir, 'pack.json'));
            expect(parsed).toMatchObject({ kind: 'v2', pack: { sensors: { lint: { variants: [{
                policyRef: 'shared/semgrep-policy.json', requirements: { tool: 'semgrep', runtime: 'python' }, probe: { kind: 'semgrep-validate' },
            }] } } } });
        } finally {
            fs.rmSync(sensorPacks, { recursive: true, force: true });
        }
    });

    it('rejects a Semgrep policy that changes between inspection and safe open', () => {
        const sensorPacks = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-policy-'));
        const packDir = path.join(sensorPacks, 'python');
        const policyPath = path.join(sensorPacks, 'shared', 'semgrep-policy.json');
        const originalOpen = fs.openSync.bind(fs);
        const open = jest.spyOn(fs, 'openSync');
        let replaced = false;
        try {
            fs.mkdirSync(path.dirname(policyPath), { recursive: true });
            fs.mkdirSync(packDir);
            fs.writeFileSync(policyPath, JSON.stringify({
                tool: 'semgrep', toolRange: '>=1.0.0', runtime: 'python', runtimeRange: '>=3.9.0', probe: 'semgrep-validate',
            }));
            const pack = validPack();
            pack.sensors.lint.variants[0] = {
                id: 'semgrep-python', priority: 10, certifiedRange: '>=1.0.0', policyRef: 'shared/semgrep-policy.json',
                command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml', '--json', '.'] },
                assets: ['.semgrep.awm.yml'], formatter: 'semgrep',
            } as any;
            open.mockImplementation(((file: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
                if (file === policyPath && !replaced) {
                    replaced = true;
                    fs.writeFileSync(policyPath, JSON.stringify({
                        tool: 'semgrep', toolRange: '>=2.0.0', runtime: 'python', runtimeRange: '>=3.10.0', probe: 'semgrep-validate',
                    }));
                }
                return originalOpen(file, flags, mode);
            }) as typeof fs.openSync);
            expect(() => parseSensorPack(pack, path.join(packDir, 'pack.json'))).toThrow(/changed|identity|policyRef/i);
        } finally {
            open.mockRestore();
            fs.rmSync(sensorPacks, { recursive: true, force: true });
        }
    });

    it('fails closed when a policy reference is not the AWM-owned shared Semgrep policy', () => {
        const pack = validPack();
        pack.sensors.lint.variants[0] = {
            id: 'semgrep-python', priority: 10, certifiedRange: '>=1.0.0', policyRef: '../secret.json',
            command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml', '--json', '.'] },
            assets: ['.semgrep.awm.yml'], formatter: 'semgrep',
        } as any;
        expect(() => parseSensorPack(pack, '/tmp/sensor-packs/python/pack.json')).toThrow('policyRef');
    });

    it('parses a valid versioned pack', () => {
        expect(parseSensorPack(validPack(), 'pack.json')).toMatchObject({ kind: 'v2', pack: validPack() });
    });

    it('accepts one standalone files placeholder in changedCommand (R4)', () => {
        const pack = validPack();
        (pack.sensors.lint.variants[0] as Record<string, unknown>).changedCommand = {
            executable: 'eslint', resolution: 'node-modules-bin',
            args: ['--format', 'json', '{files}'],
            fileInput: { placeholder: '{files}', extensions: ['.js', '.ts'] },
        };
        expect(parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toMatchObject({
            kind: 'v2', pack: { sensors: { lint: { variants: [{ changedCommand: { args: ['--format', 'json', '{files}'] } }] } } },
        });
    });

    test.each([
        { args: ['{files}', '{files}'], fileInput: { placeholder: '{files}', extensions: ['.ts'] } },
        { args: ['prefix-{files}'], fileInput: { placeholder: '{files}', extensions: ['.ts'] } },
        { args: ['{files}'], fileInput: { placeholder: '{files}', extensions: [] } },
    ])('rejects unsafe changedCommand %# (R4)', changedCommand => {
        const pack = validPack();
        (pack.sensors.lint.variants[0] as Record<string, unknown>).changedCommand = {
            executable: 'eslint', resolution: 'node-modules-bin', ...changedCommand,
        };
        expect(() => parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toThrow(/changedCommand|fileInput|\{files\}/);
    });

    test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000'])('rejects pack sensor timeout %p (R3.3)', timeout => {
        const pack = validPack();
        (pack.sensors.lint as Record<string, unknown>).timeout = timeout;
        expect(() => parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toThrow(/timeout.*positive safe integer/);
    });

    it('accepts an optional positive pack sensor timeout (R3.1)', () => {
        const pack = validPack();
        (pack.sensors.lint as Record<string, unknown>).timeout = 30_000;
        expect(parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toMatchObject({
            kind: 'v2', pack: { sensors: { lint: { timeout: 30_000 } } },
        });
    });

    it('accepts an opt-in hardening asset while variants may require no assets', () => {
        const pack = {
            ...validPack(),
            hardening: { 'typescript-strict': { assets: ['tsconfig.awm.json'] } },
            sensors: {
                lint: {
                    ...validPack().sensors.lint,
                    variants: [{ ...validPack().sensors.lint.variants[0], assets: [] }],
                },
            },
        };
        expect(parseSensorPack(pack, 'pack.json')).toMatchObject({
            kind: 'v2',
            pack: { hardening: { 'typescript-strict': { assets: ['tsconfig.awm.json'] } }, sensors: { lint: { variants: [{ assets: [] }] } } },
        });
    });

    it.each(['true', 'false'] as const)('accepts the exact ESLINT_USE_FLAT_CONFIG=%s environment mapping', flatConfig => {
        const command = {
            executable: 'npm',
            resolution: 'path',
            args: ['run', 'lint'],
            packageManager: 'npm',
            environment: { ESLINT_USE_FLAT_CONFIG: flatConfig },
        };
        expect(parseSensorPack({ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command }] } } }, 'pack.json'))
            .toMatchObject({ kind: 'v2', pack: { sensors: { lint: { variants: [{ command }] } } } });
    });

    it.each([
        { ESLINT_USE_FLAT_CONFIG: 'yes' },
        { ESLINT_USE_FLAT_CONFIG: 'true', OTHER: 'value' },
    ])('rejects an unknown or expanded ESLint environment mapping', environment => {
        const command = { executable: 'npm', resolution: 'path', args: ['run', 'lint'], packageManager: 'npm', environment };
        expect(() => parseSensorPack({ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command }] } } }, 'pack.json'))
            .toThrow('command.environment');
    });

    it('normalizes package-manager executable spelling before enforcing its explicit selection', () => {
        const variant = validPack().sensors.lint.variants[0];
        const withExecutable = (executable: string, packageManager?: string) => ({
            ...validPack(),
            sensors: { lint: { ...validPack().sensors.lint, variants: [{
                ...variant,
                command: { executable, resolution: 'path', args: ['run', 'lint'], ...(packageManager === undefined ? {} : { packageManager }) },
            }] } },
        });

        expect(() => parseSensorPack(withExecutable('NPM'), 'pack.json')).toThrow('packageManager');
        expect(parseSensorPack(withExecutable('npm.exe', 'NPM'), 'pack.json')).toMatchObject({
            kind: 'v2', pack: { sensors: { lint: { variants: [{ command: { executable: 'npm.exe', packageManager: 'npm' } }] } } },
        });
        expect(() => parseSensorPack(withExecutable('NPM', 'pnpm'), 'pack.json')).toThrow('match executable');
    });

    it('keeps an unversioned pack on the legacy compatibility path', () => {
        const legacy = { name: 'legacy', sensors: {} };
        expect(parseSensorPack(legacy, 'pack.json')).toMatchObject({ kind: 'legacy', pack: { ...legacy, compatibility: { state: 'compatible-unverified' } } });
    });

    test.each([
        [{ name: 'legacy', detects: [null], sensors: {} }, 'detects[0]'],
        [{ name: 'legacy', detects: ['package.json'], sensors: { lint: { unknown: true } } }, 'unknown field'],
        [{ name: 'legacy', detects: ['package.json'], sensors: { lint: { defaultCmd: 'eslint\u0000 .' } } }, 'defaultCmd'],
        [{ name: 'legacy', detects: ['package.json'], sensors: { lint: { changedExtensions: ['.ts', 3] } } }, 'changedExtensions[1]'],
        [{ name: 'legacy', detects: ['package.json'], sensors: { 'bad/name': {} } }, 'sensor id'],
    ])('rejects recursively malformed legacy content %j', (input, message) => {
        expect(() => parseSensorPack(input, 'legacy-pack.json')).toThrow(message);
    });

    it('preserves legacy config file fallbacks', () => {
        expect(parseSensorPack({ name: 'legacy', sensors: { lint: { configFile: 'eslint.config.js', configFileFallback: '.eslintrc.json' } } }, 'legacy')).toMatchObject({ kind: 'legacy', pack: { sensors: { lint: { configFile: 'eslint.config.js', configFileFallback: '.eslintrc.json' } } } });
    });

    it('rejects malformed applicability and probe extensions', () => {
        const variant = validPack().sensors.lint.variants[0];
        expect(() => parseSensorPack({ ...validPack(), sensors: { lint: { applicability: { allFiles: [3] }, variants: [variant] } } }, 'pack')).toThrow('allFiles[0]');
        expect(() => parseSensorPack({ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...variant, probe: { kind: 'version', extra: true } }] } } }, 'pack')).toThrow('unknown field');
    });

    it('preserves config selectors and validates package.json field names', () => {
        const variant = { ...validPack().sensors.lint.variants[0], requirements: { ...validPack().sensors.lint.variants[0].requirements, configFiles: ['eslint.config.js'], packageJsonFields: ['eslintConfig'] } };
        expect(parseSensorPack({ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [variant] } } }, 'pack')).toMatchObject({ kind: 'v2', pack: { sensors: { lint: { variants: [{ requirements: { configFiles: ['eslint.config.js'], packageJsonFields: ['eslintConfig'] } }] } } } });
        const malformed = { ...variant, requirements: { ...variant.requirements, packageJsonFields: ['eslint-config'] } };
        expect(() => parseSensorPack({ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [malformed] } } }, 'pack')).toThrow('packageJsonFields[0]');
        const complete = validPack().sensors.lint.variants[0];
        expect(() => assertNoEqualPriorityOverlap([{ ...complete, id: '../bad' }] as unknown)).toThrow('stable lowercase id');
        expect(() => assertNoEqualPriorityOverlap([{ ...complete, command: undefined }] as unknown)).toThrow('command');
    });

    it('rejects equal-priority variants with overlapping operational tool ranges', () => {
        const first = validPack().sensors.lint.variants[0];
        const second = { ...first, id: 'eslint-9-alt', certifiedRange: '>=10 <11', requirements: { ...first.requirements, toolRange: '>=9.5 <10.5' } };
        expect(() => assertNoEqualPriorityOverlap([first, second])).toThrow('overlap');
    });

    it('accepts overlapping tool ranges when runtime ranges are disjoint', () => {
        const first = validPack().sensors.lint.variants[0];
        const second = { ...first, id: 'eslint-9-node-old', requirements: { ...first.requirements, toolRange: '>=9.5 <10.5', runtimeRange: '>=18 <20' } };
        expect(() => assertNoEqualPriorityOverlap([first, second])).not.toThrow();
    });

    test.each([
        [{ ...validPack(), schemaVersion: 3 }, 'supported: legacy, 2'],
        [{ ...validPack(), sensors: { lint: { variants: [] } } }, 'variants'],
        [{ ...validPack(), name: '../escape' }, 'name'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], assets: ['../secret'] }] } } }, 'asset'],
        [{ ...validPack(), sensors: { lint: { variants: [{ ...validPack().sensors.lint.variants[0], command: { executable: 'sh', resolution: 'path', args: ['-c', 'echo nope'] } }] } } }, 'executable'],
        [{ ...validPack(), coverage: { ...coverage, schemaVersion: 2 } }, 'coverage.schemaVersion'],
        [{ ...validPack(), sensors: { lint: { variants: [{ ...validPack().sensors.lint.variants[0], certifiedRange: 'not-a-range' }] } } }, 'certifiedRange'],
        [{ ...validPack(), sensors: { lint: validPack().sensors.lint, lint2: validPack().sensors.lint } }, 'variant id'],
        [{ ...validPack(), sensors: { lint: { variants: [validPack().sensors.lint.variants[0], { ...validPack().sensors.lint.variants[0], id: 'eslint-9-next', certifiedRange: '>=9.1.0 <10.0.0' }] } } }, 'overlap'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], assets: ['C:/secret'] }] } } }, 'asset'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command: { executable: 'cmd.exe', resolution: 'path', args: ['x'] } }] } } }, 'executable'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command: { executable: 'npm', resolution: 'path', args: ['run', 'lint'] } }] } } }, 'packageManager'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command: { executable: 'npm', resolution: 'path', args: ['run', 'lint'], packageManager: 'pnpm' } }] } } }, 'match executable'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command: { ...validPack().sensors.lint.variants[0].command, environment: { NODE_OPTIONS: '--require unsafe' } } }] } } }, 'environment'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command: { ...validPack().sensors.lint.variants[0].command, args: ['prefix{files}'] } }] } } }, 'embed'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], formatter: 'bad\nformat' }] } } }, 'formatter'],
        [{ ...validPack(), hardening: { 'typescript-strict': { assets: ['../tsconfig.awm.json'] } } }, 'asset'],
        [{ ...validPack(), hardening: { 'typescript-strict': { assets: [] } } }, 'hardening'],
        [{ ...validPack(), hardening: { 'typescript-strict': { assets: ['tsconfig.awm.json'], command: {} } } }, 'unknown field'],
    ])('rejects malformed pack %j', (input, message) => {
        expect(() => parseSensorPack(input, 'pack.json')).toThrow(message);
    });
});
