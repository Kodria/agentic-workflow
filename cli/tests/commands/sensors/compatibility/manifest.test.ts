import { legacyCompatibility, parseSensorManifest, serializeManifestV2, serializeManifestV3 } from '../../../../src/commands/sensors/compatibility/manifest';
import fs from 'fs';
import path from 'path';

function validV2Manifest() {
    return {
        schemaVersion: 2,
        pack: 'js-ts',
        sensors: {
            lint: {
                enabled: true, variantId: 'eslint-9',
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.', '--format', 'json'] },
                initializedCompatibility: { state: 'certified', reason: 'range-and-probe', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] },
            },
        },
    };
}

describe('sensor manifest contract', () => {
    it('keeps compatibility contracts on an acyclic import boundary', () => {
        const source = (relative: string) => fs.readFileSync(path.join(__dirname, '../../../../src/commands/sensors', relative), 'utf8');
        expect(source('types.ts')).not.toContain('./compatibility/');
        expect(source('compatibility/types.ts')).not.toContain('../coverage/');
        expect(source('coverage/contract.ts')).not.toContain('../compatibility/manifest');
    });

    it('normalizes a legacy string command with compatible-unverified evidence', () => {
        expect(parseSensorManifest({ pack: 'js-ts', sensors: { lint: 'npm run lint' } }, 'sensors.json')).toMatchObject({ kind: 'legacy', pack: {
            pack: 'js-ts',
            sensors: { lint: { cmd: 'npm run lint' } },
            compatibility: legacyCompatibility(),
        } });
    });

    it('accepts a v2 selected variant and structured command', () => {
        const manifest = validV2Manifest();
        expect(parseSensorManifest(manifest, 'sensors.json')).toMatchObject({ kind: 'v2', pack: manifest });
        expect(JSON.parse(serializeManifestV2(manifest))).toEqual(manifest);
    });

    it('parses the three exact v3 modes without physical registry provenance', () => {
        const project = {
            schemaVersion: 3,
            mode: 'project-sensors',
            pack: 'js-ts',
            source: { registry: 'baseline' },
            packageRoot: 'cli',
            sensors: validV2Manifest().sensors,
        };
        expect(parseSensorManifest(project, 'sensors.json')).toMatchObject({
            kind: 'v3',
            pack: { mode: 'project-sensors', source: { registry: 'baseline' }, packageRoot: 'cli' },
        });
        expect(parseSensorManifest({ schemaVersion: 3, mode: 'native-gate', reason: 'managed by platform' }, 'sensors.json')).toMatchObject({
            kind: 'v3', pack: { mode: 'native-gate', reason: 'managed by platform' },
        });
        expect(parseSensorManifest({ schemaVersion: 3, mode: 'opt-out', reason: 'not applicable' }, 'sensors.json')).toMatchObject({
            kind: 'v3', pack: { mode: 'opt-out', reason: 'not applicable' },
        });
        expect(() => parseSensorManifest({ ...project, source: { registry: 'Baseline' } }, 'sensors.json')).toThrow('registry');
        expect(() => parseSensorManifest({ schemaVersion: 3, mode: 'native-gate' }, 'sensors.json')).toThrow('reason');
        expect(() => parseSensorManifest({ ...project, registryRoot: '/machine/root' }, 'sensors.json')).toThrow('unknown field');
    });

    it('serializes v3 deterministically with a newline and round-trips portable semantics', () => {
        const manifest = {
            schemaVersion: 3,
            mode: 'project-sensors',
            pack: 'js-ts',
            packSelection: 'explicit' as const,
            source: { registry: 'baseline' },
            packageRoot: 'cli',
            sensors: { lint: { ...validV2Manifest().sensors.lint, enabled: false, fast: true, timeout: 45_000, assets: ['eslint.config.awm.mjs'], policyRef: 'shared/semgrep-policy.json' as const } },
            concurrency: 2,
        };
        const serialized = serializeManifestV3(manifest);
        expect(serialized).toBe(serializeManifestV3(manifest));
        expect(serialized.endsWith('\n')).toBe(true);
        expect(serialized).not.toContain('registryRoot');
        expect(serialized).not.toContain('/home/');
        expect(parseSensorManifest(JSON.parse(serialized), 'sensors.json')).toEqual({ kind: 'v3', pack: manifest });
    });

    it('accepts and serializes a positive v2 project timeout (R3)', () => {
        const manifest = validV2Manifest();
        (manifest.sensors.lint as Record<string, unknown>).timeout = 45_000;
        expect(parseSensorManifest(manifest, '/project/.awm/sensors.json')).toMatchObject({
            kind: 'v2', pack: { sensors: { lint: { timeout: 45_000 } } },
        });
        expect(JSON.parse(serializeManifestV2(manifest))).toEqual(manifest);
    });

    test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000'])('rejects v2 timeout %p before execution (R3.3)', timeout => {
        const manifest = validV2Manifest();
        (manifest.sensors.lint as Record<string, unknown>).timeout = timeout;
        expect(() => parseSensorManifest(manifest, '/project/.awm/sensors.json')).toThrow(/timeout.*positive safe integer/);
    });

    it('persists only an explicit v2 pack selection as applicability provenance', () => {
        const manifest = {
            schemaVersion: 2, pack: 'generic', packSelection: 'explicit',
            sensors: {},
        };
        expect(parseSensorManifest(manifest, 'sensors.json')).toMatchObject({ kind: 'v2', pack: { packSelection: 'explicit' } });
        expect(JSON.parse(serializeManifestV2(manifest))).toEqual(manifest);
        expect(() => parseSensorManifest({ ...manifest, packSelection: 'detected' }, 'sensors.json')).toThrow('packSelection');
    });

    it('accepts optional contained assets and rejects traversal', () => {
        const sensor = { enabled: true, variantId: 'eslint-9', assets: ['eslint.config.awm.mjs'], command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, initializedCompatibility: { state: 'certified', reason: 'ok', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } };
        expect(parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: sensor } }, 'sensors.json')).toMatchObject({ kind: 'v2' });
        expect(() => parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: { ...sensor, assets: ['C:/secret'] } } }, 'sensors.json')).toThrow('asset');
    });

    it('rejects mismatched compatibility variant and hostile source labels', () => {
        const sensor = { enabled: true, variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, initializedCompatibility: { state: 'certified', reason: 'ok', variantId: 'other', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } };
        expect(() => parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: sensor } }, { path: 'bad' })).toThrow('<unknown source>');
        expect(() => parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: sensor } }, 'source\nleak')).toThrow('<unknown source>');
    });

    it('rejects invalid semver evidence independently', () => {
        const sensor = { enabled: true, variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, initializedCompatibility: { state: 'certified', reason: 'ok', variantId: 'eslint-9', toolVersion: 'bad', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } };
        expect(() => parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: sensor } }, 'source')).toThrow('toolVersion');
    });

    it('rejects certified evidence without a selected variant', () => {
        const sensor = { enabled: true, variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, initializedCompatibility: { state: 'certified', reason: 'ok', variantId: null, toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } };
        expect(() => parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: sensor } }, 'source')).toThrow('variantId');
    });

    it('rejects a certified tool version outside its certified range', () => {
        const sensor = { enabled: true, variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, initializedCompatibility: { state: 'certified', reason: 'ok', variantId: 'eslint-9', toolVersion: '10.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } };
        expect(() => parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: sensor } }, 'source')).toThrow('certifiedRange');
    });

    it('accepts a v2 packageRoot for monorepo-scoped sensor detection/execution', () => {
        const manifest = { ...validV2Manifest(), packageRoot: 'cli' };
        expect(parseSensorManifest(manifest, 'source')).toMatchObject({ kind: 'v2', pack: { packageRoot: 'cli' } });
    });

    it('rejects a packageRoot that escapes the manifest directory', () => {
        const manifest = { ...validV2Manifest(), packageRoot: '../outside' };
        expect(() => parseSensorManifest(manifest, 'source')).toThrow('packageRoot');
    });

    it('rejects an absolute packageRoot', () => {
        const manifest = { ...validV2Manifest(), packageRoot: '/etc' };
        expect(() => parseSensorManifest(manifest, 'source')).toThrow('packageRoot');
    });

    test.each([
        [null, 'object'],
        [{}, 'pack'],
        [{ schemaVersion: 3, pack: 'js-ts', sensors: {} }, 'schemaVersion'],
        [{ schemaVersion: 2, pack: 'js-ts', sensors: { lint: { variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'path', args: [] } } } }, 'enabled'],
    ])('rejects malformed manifest %j', (input, message) => {
        expect(() => parseSensorManifest(input, 'sensors.json')).toThrow(message);
    });
});
