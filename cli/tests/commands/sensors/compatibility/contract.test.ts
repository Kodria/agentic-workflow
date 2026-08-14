import { parseSensorPack } from '../../../../src/commands/sensors/compatibility/contract';

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
