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
        id: 'js-ts',
        assets: ['eslint.config.awm.mjs'],
        sensors: {
            lint: {
                variants: [{
                    id: 'eslint-9',
                    priority: 10,
                    certifiedRange: '>=9.0.0 <10.0.0',
                    probes: ['version', 'eslint-print-config'],
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
        expect(parseSensorPack(validPack(), 'pack.json')).toEqual(validPack());
    });

    it('keeps an unversioned pack on the legacy compatibility path', () => {
        const legacy = { name: 'legacy', sensors: {} };
        expect(parseSensorPack(legacy, 'pack.json')).toMatchObject({ ...legacy, compatibility: { state: 'compatible-unverified' } });
    });

    test.each([
        [{ ...validPack(), schemaVersion: 3 }, 'schemaVersion'],
        [{ ...validPack(), sensors: { lint: { variants: [] } } }, 'variants'],
        [{ ...validPack(), id: '../escape' }, 'id'],
        [{ ...validPack(), assets: ['../secret'] }, 'assets'],
        [{ ...validPack(), sensors: { lint: { variants: [{ ...validPack().sensors.lint.variants[0], command: { executable: 'sh', resolution: 'path', args: ['-c', 'echo nope'] } }] } } }, 'executable'],
        [{ ...validPack(), coverage: { ...coverage, schemaVersion: 2 } }, 'coverage.schemaVersion'],
        [{ ...validPack(), sensors: { lint: { variants: [{ ...validPack().sensors.lint.variants[0], certifiedRange: 'not-a-range' }] } } }, 'certifiedRange'],
        [{ ...validPack(), sensors: { lint: validPack().sensors.lint, lint2: validPack().sensors.lint } }, 'variant id'],
        [{ ...validPack(), sensors: { lint: { variants: [validPack().sensors.lint.variants[0], { ...validPack().sensors.lint.variants[0], id: 'eslint-9-next', certifiedRange: '>=9.1.0 <10.0.0' }] } } }, 'overlap'],
    ])('rejects malformed pack %j', (input, message) => {
        expect(() => parseSensorPack(input, 'pack.json')).toThrow(message);
    });
});
