import { parseCoverageContract } from '../../../../src/commands/sensors/coverage/contract';

describe('coverage contract v1', () => {
    it('returns a complete valid contract unchanged', () => {
        const input = {
            schemaVersion: 1,
            classes: {
                'runtime-validation': {
                    description: 'All durable coverage artifacts validate their inputs.',
                    detectors: [{
                        sensor: 'contract-test',
                        evidence: {
                            commandIncludes: ['coverage'],
                            files: [{ path: 'eslint.config.awm.mjs', containsAll: ['parseCoverageContract'] }],
                        },
                    }],
                    remedy: { summary: 'Add a parser.', command: 'npm test -- contract.test.ts' },
                },
            },
        };

        expect(parseCoverageContract(input, 'coverage.json')).toEqual(input);
    });

    test.each([
        [{ schemaVersion: 2, classes: {} }, 'schemaVersion'],
        [{ schemaVersion: 1, classes: {}, extra: true }, 'unknown field'],
        [{ schemaVersion: 1, classes: {} }, 'classes'],
        [{ schemaVersion: 1, classes: { Bad: { description: 'x', detectors: [{ sensor: 'test' }], remedy: { summary: 'x', command: 'x' } } } }, 'class'],
        [{ schemaVersion: 1, classes: { valid: { description: '', detectors: [{ sensor: 'test' }], remedy: { summary: 'x', command: 'x' } } } }, 'description'],
        [{ schemaVersion: 1, classes: { valid: { description: '  \t', detectors: [{ sensor: 'test' }], remedy: { summary: 'x', command: 'x' } } } }, 'description'],
        [{ schemaVersion: 1, classes: { valid: { description: 'x', detectors: [], remedy: { summary: 'x', command: 'x' } } } }, 'detectors'],
    ])('rejects malformed contract %j', (input, message) => {
        expect(() => parseCoverageContract(input, 'coverage.json')).toThrow(message);
    });

    test.each(['', '.', '..', 'a..b', '../secret', 'a/../../secret', '/etc/passwd', 'C:\\secret', 'a\\..\\secret', ' report.txt', 'report!.txt', 'ñ.txt', '.env', '.gitignore', 'secrets.txt', 'id_rsa'])('rejects hostile evidence path %p', (path) => {
        const input = {
            schemaVersion: 1,
            classes: {
                valid: {
                    description: 'x',
                    detectors: [{ sensor: 'test', evidence: { files: [{ path, containsAll: [] }] } }],
                    remedy: { summary: 'x', command: 'x' },
                },
            },
        };
        expect(() => parseCoverageContract(input, 'coverage.json')).toThrow('path');
    });

    test.each([
        'eslint.config.awm.mjs',
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        'eslint.config.ts',
        'eslint.config.mts',
        'eslint.config.cts',
        '.semgrep.awm.yml',
        '.dep-cruiser.awm.js',
    ])('accepts contractual evidence path %p', (path) => {
        const input = {
            schemaVersion: 1,
            classes: {
                valid: {
                    description: 'x',
                    detectors: [{ sensor: 'test', evidence: { files: [{ path, containsAll: [] }] } }],
                    remedy: { summary: 'x', command: 'x' },
                },
            },
        };
        expect(parseCoverageContract(input, 'coverage.json')).toEqual(input);
    });

    it('rejects whitespace-only evidence text', () => {
        const input = {
            schemaVersion: 1,
            classes: {
                valid: {
                    description: 'x',
                    detectors: [{ sensor: 'test', evidence: { files: [{ path: 'eslint.config.awm.mjs', containsAll: [' \n'] }] } }],
                    remedy: { summary: 'x', command: 'x' },
                },
            },
        };
        expect(() => parseCoverageContract(input, 'coverage.json')).toThrow('containsAll');
    });

    it('rejects unknown nested evidence fields', () => {
        const input = {
            schemaVersion: 1,
            classes: {
                valid: {
                    description: 'x',
                    detectors: [{ sensor: 'test', evidence: { commandInclude: ['coverage'] } }],
                    remedy: { summary: 'x', command: 'x' },
                },
            },
        };
        expect(() => parseCoverageContract(input, 'coverage.json')).toThrow('unknown field');
    });

    it('rejects a detector sensor name that is not a safe component', () => {
        const input = {
            schemaVersion: 1,
            classes: {
                valid: {
                    description: 'x',
                    detectors: [{ sensor: '../escape' }],
                    remedy: { summary: 'x', command: 'x' },
                },
            },
        };
        expect(() => parseCoverageContract(input, 'coverage.json')).toThrow('sensor');
    });
});
