import { prepareLegacySensor, prepareV2Sensor, validateRunOptions, type PrepareV2SensorInput } from '../../../src/commands/sensors/prepare';
import type { SensorVariant } from '../../../src/commands/sensors/compatibility/types';

const fullCommand = { executable: 'manifest-eslint', resolution: 'path' as const, args: ['.'] };
const changedCommand = {
    executable: 'live-eslint',
    resolution: 'path' as const,
    args: ['--format', 'json', '{files}'],
    fileInput: { placeholder: '{files}' as const, extensions: ['.ts'] },
};

function v2Input(overrides: Record<string, unknown> = {}): PrepareV2SensorInput {
    const liveVariant: SensorVariant = {
        id: 'eslint-live', priority: 1, certifiedRange: '>=1.0.0', requirements: { tool: 'eslint', toolRange: '>=1.0.0', runtime: 'node', runtimeRange: '>=1.0.0' }, assets: [],
        probe: { kind: 'version' }, command: { executable: 'live-eslint', resolution: 'path', args: ['.'] }, changedCommand, formatter: 'eslint-llm',
    };
    return {
        name: 'lint',
        sensor: {
            enabled: true, fast: false, variantId: 'eslint-live', command: fullCommand,
            initializedCompatibility: { state: 'certified' as const, reason: 'test', variantId: 'eslint-live', toolVersion: '1.0.0', runtimeVersion: '1.0.0', certifiedRange: '>=1.0.0', evidence: [] },
        },
        liveSensor: { applicability: {}, fast: false, timeout: 30_000, variants: [liveVariant] },
        liveState: { state: 'certified' as const, reason: 'test', variantId: 'eslint-live', toolVersion: '1.0.0', runtimeVersion: '1.0.0', certifiedRange: '>=1.0.0', evidence: [] },
        changed: { files: ['src/a.ts'] },
        requestedScope: 'changed' as const,
        projectTimeout: 90_000,
        ...overrides,
    };
}

describe('prepareV2Sensor', () => {
    test('v2 uses the live command and project > pack > fallback timeout (R1.1, R3.1)', () => {
        const prepared = prepareV2Sensor(v2Input());

        expect(prepared.command).toEqual({ kind: 'structured', value: { executable: 'live-eslint', resolution: 'path', args: ['--format', 'json', 'src/a.ts'] } });
        expect(prepared.timeoutMs).toBe(90_000);
        expect(prepared.timeoutSource).toBe('project');
        expect(prepareV2Sensor(v2Input({ projectTimeout: undefined })).timeoutSource).toBe('pack');
        const fallback = v2Input();
        fallback.liveSensor!.timeout = undefined;
        fallback.liveSensor!.fast = true;
        fallback.sensor.fast = undefined;
        expect(prepareV2Sensor({ ...fallback, projectTimeout: undefined })).toMatchObject({ timeoutMs: 10_000, timeoutSource: 'fallback' });
    });

    test('expands changed paths as literal argv entries (R4.1, R10.2)', () => {
        const prepared = prepareV2Sensor(v2Input({ changed: { files: ['src/a b.ts', 'src/$x.ts'] } }));

        expect(prepared.command).toEqual({ kind: 'structured', value: { executable: 'live-eslint', resolution: 'path', args: ['--format', 'json', 'src/a b.ts', 'src/$x.ts'] } });
        expect(prepared.effectiveScope).toBe('changed');
    });

    test('falls back full with an explicit reason without changedCommand (R4.2)', () => {
        const input = v2Input();
        input.liveSensor!.variants[0].changedCommand = undefined;

        const prepared = prepareV2Sensor(input);

        expect(prepared.command).toEqual({ kind: 'structured', value: input.liveSensor!.variants[0].command });
        expect(prepared.effectiveScope).toBe('full');
        expect(prepared.scopeReason).toMatch(/does not support changed scope/);
    });

    test('uses the full command with an explicit reason when the diff cannot resolve', () => {
        const prepared = prepareV2Sensor(v2Input({ changed: { files: [], error: 'git failed' } }));

        expect(prepared.effectiveScope).toBe('full');
        expect(prepared.scopeReason).toMatch(/could not be resolved: git failed/);
    });

    test('returns zero-file pass plan without a process (R4.4)', () => {
        const prepared = prepareV2Sensor(v2Input({ changed: { files: ['README.md'] } }));

        expect(prepared).toMatchObject({ effectiveScope: 'changed', files: 0, syntheticStatus: 'pass' });
        expect(prepared.command).toBeUndefined();
    });

    test('rejects an invalid requested scope before preparing a command', () => {
        expect(() => prepareV2Sensor({ ...v2Input(), requestedScope: 'sideways' as unknown as 'changed' }))
            .toThrow('requested scope must be "full" or "changed"');
    });
});

describe('prepareLegacySensor', () => {
    const originalPlatform = process.platform;

    afterEach(() => Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true }));

    test('falls back to the full command for an unsafe Windows filename', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        const prepared = prepareLegacySensor({
            name: 'lint', config: { cmd: 'eslint .', changedCmd: 'eslint {files}' }, requestedScope: 'changed', changed: { files: ['src/a&b.ts'] },
        });

        expect(prepared).toMatchObject({ command: { kind: 'legacy', value: 'eslint .' }, effectiveScope: 'full' });
        expect(prepared.scopeReason).toMatch(/cmd\.exe metacharacter/);
    });
});

describe('validateRunOptions', () => {
    test('rejects changed baseline capture before any scope preparation (R4.6)', () => {
        expect(() => validateRunOptions({ changed: true, ignoreBaseline: true }))
            .toThrow(/refusing to combine --changed with a baseline capture/);
    });
});
