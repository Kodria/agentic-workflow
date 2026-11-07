import { parseSensorPack } from '../../../../src/commands/sensors/compatibility/contract';
import { setPortableReadForTests } from '../../../../src/commands/sensors/compatibility/safe-file';

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
        name: 'js-ts',
        description: 'fixture',
        detects: ['package.json'],
        sensors: {
            lint: {
                applicability: { allFiles: ['package.json'] },
                variants: [{
                    id: 'eslint-9',
                    priority: 10,
                    requirements: { tool: 'eslint', toolRange: '>=9.0.0 <10.0.0', runtime: 'node', runtimeRange: '>=20.0.0' },
                    certifiedRange: '>=9.0.0 <10.0.0',
                    assets: ['eslint.config.awm.mjs'],
                    formatter: 'eslint-llm',
                    probe: { kind: 'eslint-print-config' },
                    command: {
                        executable: 'eslint',
                        resolution: 'node-modules-bin',
                        args: ['--format', 'json', '.'],
                    },
                }],
            },
        },
        coverage,
    };
}

function withSliceCommand(sliceCommand: Record<string, unknown>) {
    const pack = validPack();
    (pack.sensors.lint.variants[0] as Record<string, unknown>).sliceCommand = sliceCommand;
    return pack;
}

describe('sensor pack v2 sliceCommand (RF-1.5, RF-1.6)', () => {
    beforeEach(() => setPortableReadForTests(true));
    afterEach(() => setPortableReadForTests(false));

    it('accepts a variant with sliceCommand + fileInput whose token is {files} and exactly one {files} arg', () => {
        const pack = withSliceCommand({
            executable: 'stryker',
            resolution: 'node-modules-bin',
            args: ['run', '--mutate', '{files}'],
            fileInput: { placeholder: '{files}', extensions: ['.ts', '.tsx'] },
        });
        const parsed = parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json');
        expect(parsed).toMatchObject({
            kind: 'v2',
            pack: {
                sensors: {
                    lint: {
                        variants: [{
                            sliceCommand: {
                                executable: 'stryker',
                                resolution: 'node-modules-bin',
                                args: ['run', '--mutate', '{files}'],
                                fileInput: { placeholder: '{files}', extensions: ['.ts', '.tsx'] },
                            },
                        }],
                    },
                },
            },
        });
    });

    it('rejects sliceCommand without fileInput', () => {
        const pack = withSliceCommand({
            executable: 'stryker',
            resolution: 'node-modules-bin',
            args: ['run'],
        });
        expect(() => parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toThrow(
            /sliceCommand must declare fileInput/,
        );
    });

    it('rejects fileInput token that is not {files}', () => {
        const pack = withSliceCommand({
            executable: 'stryker',
            resolution: 'node-modules-bin',
            args: ['run', '--mutate', '{files}'],
            fileInput: { placeholder: '{paths}', extensions: ['.ts'] },
        });
        expect(() => parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toThrow(
            /fileInput\.placeholder must be \{files\}/,
        );
    });

    it('rejects an unknown field beside the variant allowlist', () => {
        const pack = withSliceCommand({
            executable: 'stryker',
            resolution: 'node-modules-bin',
            args: ['run', '--mutate', '{files}'],
            fileInput: { placeholder: '{files}', extensions: ['.ts'] },
        });
        (pack.sensors.lint.variants[0] as Record<string, unknown>).sliceCmd = 'stryker run';
        expect(() => parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toThrow(
            /unknown field "sliceCmd"/,
        );
    });

    it('includes the parsed sliceCommand object on the variant (parseVariant result)', () => {
        const pack = withSliceCommand({
            executable: 'stryker',
            resolution: 'node-modules-bin',
            args: ['run', '--mutate', '{files}'],
            fileInput: { placeholder: '{files}', extensions: ['.js'] },
        });
        const parsed = parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json');
        expect(parsed.kind).toBe('v2');
        if (parsed.kind !== 'v2') return;
        const variant = parsed.pack.sensors.lint.variants[0] as {
            sliceCommand?: {
                executable: string;
                resolution: string;
                args: string[];
                fileInput: { placeholder: string; extensions: string[] };
            };
        };
        expect(variant.sliceCommand).toEqual({
            executable: 'stryker',
            resolution: 'node-modules-bin',
            args: ['run', '--mutate', '{files}'],
            fileInput: { placeholder: '{files}', extensions: ['.js'] },
        });
    });
});
