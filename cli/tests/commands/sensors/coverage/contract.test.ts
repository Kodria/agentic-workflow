import { parseCoverageContract, parseCoverageManifest } from '../../../../src/commands/sensors/coverage/contract';

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
                            files: [{ path: 'contract.ts', containsAll: ['parseCoverageContract'] }],
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

    test.each(['', '.', '..', '../secret', 'a/../../secret', '/etc/passwd', 'C:\\secret', 'a\\..\\secret', ' report.txt', 'report!.txt'])('rejects hostile evidence path %p', (path) => {
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

    it('rejects whitespace-only evidence text', () => {
        const input = {
            schemaVersion: 1,
            classes: {
                valid: {
                    description: 'x',
                    detectors: [{ sensor: 'test', evidence: { files: [{ path: 'report.txt', containsAll: [' \n'] }] } }],
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
});

describe('coverage manifest boundary', () => {
    it('accepts all legacy sensor fields', () => {
        const input = {
            pack: 'js-ts',
            concurrency: 2,
            sensors: {
                lint: {
                    cmd: 'npm run lint', fast: true, enabled: true, timeout: 120, changedCmd: 'npm run lint -- {files}', changedExtensions: ['.ts'], formatter: 'eslint-llm',
                },
            },
        };
        expect(parseCoverageManifest(input, 'sensors.json')).toEqual(input);
    });

    test.each([
        [null, 'object'],
        [{}, 'pack'],
        [{ pack: '', sensors: {} }, 'pack'],
        [{ pack: ' js-ts', sensors: {} }, 'pack'],
        [{ pack: 'js ts', sensors: {} }, 'pack'],
        [{ pack: 'js@ts', sensors: {} }, 'pack'],
        [{ pack: 'js-ts', sensors: null }, 'sensors'],
        [{ pack: 'js-ts', sensors: { lint: { cmd: 3 } } }, 'cmd'],
        [{ pack: 'js-ts', sensors: { 'lint!': {} } }, 'sensor name'],
    ])('rejects malformed manifest %j', (input, message) => {
        expect(() => parseCoverageManifest(input, 'sensors.json')).toThrow(message);
    });
});
