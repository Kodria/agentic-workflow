import { assertNoEqualPriorityOverlap, parseSensorPack } from '../../../../src/commands/sensors/compatibility/contract';

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
    it('parses a valid versioned pack', () => {
        expect(parseSensorPack(validPack(), 'pack.json')).toMatchObject({ kind: 'v2', pack: validPack() });
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

    it('preserves configFiles and rejects incomplete public overlap input', () => {
        const variant = { ...validPack().sensors.lint.variants[0], requirements: { ...validPack().sensors.lint.variants[0].requirements, configFiles: ['eslint.config.js'] } };
        expect(parseSensorPack({ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [variant] } } }, 'pack')).toMatchObject({ kind: 'v2', pack: { sensors: { lint: { variants: [{ requirements: { configFiles: ['eslint.config.js'] } }] } } } });
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
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], command: { ...validPack().sensors.lint.variants[0].command, args: ['prefix{files}'] } }] } } }, 'embed'],
        [{ ...validPack(), sensors: { lint: { ...validPack().sensors.lint, variants: [{ ...validPack().sensors.lint.variants[0], formatter: 'bad\nformat' }] } } }, 'formatter'],
    ])('rejects malformed pack %j', (input, message) => {
        expect(() => parseSensorPack(input, 'pack.json')).toThrow(message);
    });
});
