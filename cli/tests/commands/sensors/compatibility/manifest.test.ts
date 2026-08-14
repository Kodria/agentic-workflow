import { legacyCompatibility, parseSensorManifest, serializeManifestV2 } from '../../../../src/commands/sensors/compatibility/manifest';
import fs from 'fs';
import path from 'path';

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
        const manifest = {
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
        expect(parseSensorManifest(manifest, 'sensors.json')).toMatchObject({ kind: 'v2', pack: manifest });
        expect(JSON.parse(serializeManifestV2(manifest))).toEqual(manifest);
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

    test.each([
        [null, 'object'],
        [{}, 'pack'],
        [{ schemaVersion: 3, pack: 'js-ts', sensors: {} }, 'schemaVersion'],
        [{ schemaVersion: 2, pack: 'js-ts', sensors: { lint: { variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'path', args: [] } } } }, 'enabled'],
    ])('rejects malformed manifest %j', (input, message) => {
        expect(() => parseSensorManifest(input, 'sensors.json')).toThrow(message);
    });
});
