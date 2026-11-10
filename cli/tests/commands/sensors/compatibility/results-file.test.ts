import { parseSensorManifest } from '../../../../src/commands/sensors/compatibility/manifest';
import type { ProjectDeclaredSensor } from '../../../../src/commands/sensors/compatibility/manifest';
import type { SensorVariant } from '../../../../src/commands/sensors/compatibility/types';
import { prepareV2Sensor } from '../../../../src/commands/sensors/prepare';

function packBoundSensor(overrides: Record<string, unknown> = {}) {
    return {
        enabled: true,
        variantId: 'jest-node',
        command: { executable: 'node', resolution: 'path', args: ['run-tests.js'] },
        initializedCompatibility: {
            state: 'certified',
            reason: 'range-and-probe',
            variantId: 'jest-node',
            toolVersion: '29.0.0',
            runtimeVersion: '22.0.0',
            certifiedRange: '>=29 <30',
            evidence: [],
        },
        ...overrides,
    };
}

function projectSensor(overrides: Record<string, unknown> = {}) {
    return {
        source: 'project' as const,
        enabled: true,
        command: { executable: 'node', resolution: 'path', args: ['run-tests.js'] },
        formatter: 'test',
        ...overrides,
    };
}

function v3Project(sensors: Record<string, unknown>) {
    return {
        schemaVersion: 3,
        mode: 'project-sensors' as const,
        pack: 'js-ts',
        source: { registry: 'baseline' },
        sensors,
    };
}

describe('resultsFile manifest + prepare plumbing (RF-1.2)', () => {
    it('accepts a contained relative resultsFile on a project-declared sensor and prepares it', () => {
        const parsed = parseSensorManifest(
            v3Project({ test: projectSensor({ resultsFile: 'coverage/custom-results.json' }) }),
            'sensors.json',
        );
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') throw new Error('expected v3 project-sensors');
        const sensor = parsed.pack.sensors.test as ProjectDeclaredSensor;
        expect(sensor.resultsFile).toBe('coverage/custom-results.json');

        const prepared = prepareV2Sensor({
            name: 'test',
            sensor,
            requestedScope: 'full',
        });
        expect(prepared.resultsFile).toBe('coverage/custom-results.json');
        expect(prepared.formatter).toBe('test');
    });

    it('accepts a contained relative resultsFile on a pack-bound sensor and prepares it', () => {
        const parsed = parseSensorManifest(
            v3Project({ test: packBoundSensor({ resultsFile: 'tmp/awm-jest.json' }) }),
            'sensors.json',
        );
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') throw new Error('expected v3 project-sensors');
        const sensor = parsed.pack.sensors.test;
        expect((sensor as { resultsFile?: string }).resultsFile).toBe('tmp/awm-jest.json');

        const liveVariant: SensorVariant = {
            id: 'jest-node',
            priority: 1,
            certifiedRange: '>=29 <30',
            requirements: { tool: 'jest', toolRange: '>=29 <30', runtime: 'node', runtimeRange: '>=18' },
            assets: [],
            probe: { kind: 'version' },
            command: { executable: 'node', resolution: 'path', args: ['run-tests.js'] },
            formatter: 'test',
        };
        const prepared = prepareV2Sensor({
            name: 'test',
            sensor: sensor as never,
            liveState: {
                state: 'certified',
                reason: 'range-and-probe',
                variantId: 'jest-node',
                toolVersion: '29.0.0',
                runtimeVersion: '22.0.0',
                certifiedRange: '>=29 <30',
                evidence: [],
            },
            liveSensor: { applicability: {}, fast: false, timeout: 30_000, variants: [liveVariant] },
            requestedScope: 'full',
        });
        expect(prepared.resultsFile).toBe('tmp/awm-jest.json');
    });

    it('omits resultsFile when absent (undefined on prepared)', () => {
        const parsed = parseSensorManifest(
            v3Project({ test: projectSensor() }),
            'sensors.json',
        );
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') throw new Error('expected v3 project-sensors');
        const sensor = parsed.pack.sensors.test as ProjectDeclaredSensor;
        expect(sensor.resultsFile).toBeUndefined();

        const prepared = prepareV2Sensor({
            name: 'test',
            sensor,
            requestedScope: 'full',
        });
        expect(prepared.resultsFile).toBeUndefined();
    });

    it('defaults omitted formatter to test when project sensor name is test (RF-1.1)', () => {
        const { formatter: _omit, ...withoutFormatter } = projectSensor();
        const parsed = parseSensorManifest(
            v3Project({ test: withoutFormatter }),
            'sensors.json',
        );
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') throw new Error('expected v3 project-sensors');
        const sensor = parsed.pack.sensors.test as ProjectDeclaredSensor;
        expect(sensor.formatter).toBe('test');

        const prepared = prepareV2Sensor({
            name: 'test',
            sensor,
            requestedScope: 'full',
        });
        expect(prepared.formatter).toBe('test');
    });

    it.each([
        ['../escape.json', 'escape'],
        ['/abs/out.json', 'absolute'],
        ['C:\\windows\\out.json', 'absolute'],
        ['', 'empty'],
        ['coverage/./out.json', 'dot segment'],
        ['coverage//out.json', 'empty segment'],
        ['.awm/foo.json', 'reserved .awm'],
        ['nested/.awm/out.json', 'nested reserved .awm'],
        ['.git/objects/x.json', 'reserved .git'],
        ['vendor/.git/out.json', 'nested reserved .git'],
        ['.AWM/Out.json', 'reserved .awm case-insensitive'],
        ['.Git/out.json', 'reserved .git case-insensitive'],
    ])('rejects invalid resultsFile %j (%s) on project and pack-bound', (bad) => {
        expect(() => parseSensorManifest(
            v3Project({ test: projectSensor({ resultsFile: bad }) }),
            'sensors.json',
        )).toThrow(/resultsFile/);
        expect(() => parseSensorManifest(
            v3Project({ test: packBoundSensor({ resultsFile: bad }) }),
            'sensors.json',
        )).toThrow(/resultsFile/);
    });
});
