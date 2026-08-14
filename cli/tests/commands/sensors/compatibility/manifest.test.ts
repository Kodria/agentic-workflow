import { legacyCompatibility, parseSensorManifest, serializeManifestV2 } from '../../../../src/commands/sensors/compatibility/manifest';

describe('sensor manifest contract', () => {
    it('normalizes a legacy string command with compatible-unverified evidence', () => {
        expect(parseSensorManifest({ pack: 'js-ts', sensors: { lint: 'npm run lint' } }, 'sensors.json')).toMatchObject({
            pack: 'js-ts',
            sensors: { lint: { cmd: 'npm run lint' } },
            compatibility: legacyCompatibility(),
        });
    });

    it('accepts a v2 selected variant and structured command', () => {
        const manifest = {
            schemaVersion: 2,
            pack: 'js-ts',
            sensors: {
                lint: {
                    selectedVariantId: 'eslint-9',
                    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.', '--format', 'json'] },
                },
            },
        };
        expect(parseSensorManifest(manifest, 'sensors.json')).toEqual(manifest);
        expect(JSON.parse(serializeManifestV2(manifest))).toEqual(manifest);
    });

    test.each([
        [null, 'object'],
        [{}, 'pack'],
        [{ schemaVersion: 3, pack: 'js-ts', sensors: {} }, 'schemaVersion'],
        [{ schemaVersion: 2, pack: 'js-ts', sensors: { lint: { selectedVariantId: 'eslint-9', command: { executable: 'eslint', resolution: 'path', args: [] } } } }, 'args'],
    ])('rejects malformed manifest %j', (input, message) => {
        expect(() => parseSensorManifest(input, 'sensors.json')).toThrow(message);
    });
});
