jest.mock('../../../src/commands/sensors/project', () => ({ resolveSensorProject: jest.fn() }));
jest.mock('../../../src/commands/sensors/detection', () => ({ detectStack: jest.fn() }));
jest.mock('../../../src/core/registries', () => ({ listRegistries: jest.fn(() => []) }));
jest.mock('../../../src/commands/sensors/compatibility/pack-source', () => ({ listPackSources: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/contract', () => ({ ...jest.requireActual('../../../src/commands/sensors/compatibility/contract'), parseSensorPack: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/live', () => ({ resolveParsedPackCompatibility: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/materialize', () => ({ materializePortableSensors: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/safe-file', () => ({ writeProjectFile: jest.fn(), withProjectLease: jest.fn((_root: string, operation: () => unknown) => operation()) }));

import { planSensorBootstrap } from '../../../src/commands/sensors/bootstrap';
import { describeUnresolved } from '../../../src/commands/sensors/unresolved';
import { resolveSensorProject } from '../../../src/commands/sensors/project';
import { detectStack } from '../../../src/commands/sensors/detection';
import { listPackSources } from '../../../src/commands/sensors/compatibility/pack-source';
import { parseSensorPack } from '../../../src/commands/sensors/compatibility/contract';
import { resolveParsedPackCompatibility } from '../../../src/commands/sensors/compatibility/live';

// #172. One applicable sensor whose tool is absent used to abort the entire
// manifest, including the sensors that DID resolve — so a project whose only gap
// was semgrep could not configure sensors, could not pass preflight, and could
// not be handed off. A missing tool is a gap in one sensor, not grounds to refuse
// the pack.
const root = '/project';
const missing = { state: 'missing' as const, projectRoot: root, manifestPath: `${root}/.awm/sensors.json` };
const source = { path: '/registry/sensor-packs/js-ts/pack.json', content: '{}', registry: { name: 'baseline', remote: 'local', contentRoot: '/registry' } };

const lintVariant = { id: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: [] };
const securityVariant = { id: 'semgrep-js-ts', command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml'] }, assets: ['.semgrep.awm.yml'] };

function resolvedLint() {
    return { state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10', toolVersion: '10.4.1', runtimeVersion: '24.0.0', certifiedRange: '>=10 <11', evidence: [] };
}
function unresolvedSensor(state: string, reason: string) {
    return { state, reason, variantId: null, toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [] };
}

/** Wire the mocked pack + live resolution for one planning run. */
function pack(sensors: Record<string, { variants: unknown[] }>, live: Record<string, unknown>) {
    const parsed = { schemaVersion: 2, name: 'js-ts', sensors };
    (listPackSources as jest.Mock).mockReturnValue([source]);
    (parseSensorPack as jest.Mock).mockReturnValue({ kind: 'v2', pack: parsed });
    (resolveParsedPackCompatibility as jest.Mock).mockResolvedValue({ pack: parsed, sensors: live });
}

describe('project-sensors bootstrap with a partially resolvable pack', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveSensorProject as jest.Mock).mockReturnValue(missing);
        (detectStack as jest.Mock).mockReturnValue({ pack: 'js-ts', indicators: ['package.json'] });
    });

    it('writes the sensors that resolved and reports by name the applicable one that did not', async () => {
        pack(
            { lint: { variants: [lintVariant] }, security: { variants: [securityVariant] } },
            { lint: resolvedLint(), security: unresolvedSensor('missing-tool', 'tool-not-found') },
        );

        const plan = await planSensorBootstrap(root, { mode: 'project-sensors' });

        expect(plan.kind).toBe('create');
        const created = plan as Extract<typeof plan, { kind: 'create' }>;
        const manifest = created.manifest as Extract<typeof created.manifest, { mode: 'project-sensors' }>;
        // The manifest contents are the assertion, not the exit code.
        expect(Object.keys(manifest.sensors)).toEqual(['lint']);
        expect(manifest.sensors.lint.variantId).toBe('eslint-10');
        expect(created.unresolved).toEqual([{ sensor: 'security', state: 'missing-tool', reason: 'tool-not-found' }]);
        // Nothing is invented for the skipped sensor: no entry, and none of its assets.
        expect(created.changes.map(change => change.path)).toEqual(['.awm/sensors.json']);
    });

    it('carries a sensor with no manifest entry rather than a disabled entry with fabricated evidence', async () => {
        pack(
            { lint: { variants: [lintVariant] }, security: { variants: [securityVariant] } },
            { lint: resolvedLint(), security: unresolvedSensor('incompatible', 'no-operational-variant') },
        );

        const plan = await planSensorBootstrap(root, { mode: 'project-sensors' }) as Extract<Awaited<ReturnType<typeof planSensorBootstrap>>, { kind: 'create' }>;
        const manifest = plan.manifest as Extract<typeof plan.manifest, { mode: 'project-sensors' }>;

        expect(manifest.sensors).not.toHaveProperty('security');
        expect(JSON.stringify(manifest)).not.toContain('semgrep');
    });

    it('still blocks, naming every sensor, when sensors apply and none of them resolve', async () => {
        pack(
            { lint: { variants: [lintVariant] }, security: { variants: [securityVariant] } },
            { lint: unresolvedSensor('missing-tool', 'tool-not-found'), security: unresolvedSensor('missing-tool', 'tool-not-found') },
        );

        const plan = await planSensorBootstrap(root, { mode: 'project-sensors' });

        expect(plan).toMatchObject({ kind: 'blocked', reason: 'no-sensor-resolvable', changes: [] });
        expect((plan as Extract<typeof plan, { kind: 'blocked' }>).unresolved).toEqual([
            { sensor: 'lint', state: 'missing-tool', reason: 'tool-not-found' },
            { sensor: 'security', state: 'missing-tool', reason: 'tool-not-found' },
        ]);
    });

    it('keeps the distinct honest-empty manifest when the pack declares no applicable sensor', async () => {
        // This is NOT the same condition as "nothing resolved": it is the registry
        // having no sensor for this stack, which preflight reports with its own
        // remedy. Writing an empty manifest for an unresolvable pack would collide
        // with that signal.
        pack(
            { lint: { variants: [lintVariant] } },
            { lint: unresolvedSensor('not-applicable', 'applicability-not-met') },
        );

        const plan = await planSensorBootstrap(root, { mode: 'project-sensors' }) as Extract<Awaited<ReturnType<typeof planSensorBootstrap>>, { kind: 'create' }>;
        const manifest = plan.manifest as Extract<typeof plan.manifest, { mode: 'project-sensors' }>;

        expect(plan.kind).toBe('create');
        expect(manifest.sensors).toEqual({});
        expect(plan.unresolved).toBeUndefined();
    });

    it('omits the unresolved field entirely when every applicable sensor resolved', async () => {
        pack({ lint: { variants: [lintVariant] } }, { lint: resolvedLint() });
        const plan = await planSensorBootstrap(root, { mode: 'project-sensors' }) as Extract<Awaited<ReturnType<typeof planSensorBootstrap>>, { kind: 'create' }>;
        expect(plan.unresolved).toBeUndefined();
    });
});

describe('describeUnresolved', () => {
    it('names each sensor with its state and reason, in a stable order', () => {
        expect(describeUnresolved([
            { sensor: 'security', state: 'missing-tool', reason: 'tool-not-found' },
            { sensor: 'depcheck', state: 'incompatible', reason: 'no-operational-variant' },
        ])).toBe('depcheck: incompatible/no-operational-variant; security: missing-tool/tool-not-found');
    });

    it('is empty for nothing unresolved, so callers add no punctuation for an empty gap', () => {
        expect(describeUnresolved(undefined)).toBe('');
        expect(describeUnresolved([])).toBe('');
    });
});
