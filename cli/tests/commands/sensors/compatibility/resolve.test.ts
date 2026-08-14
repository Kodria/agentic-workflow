import { resolveSensorCompatibility } from '../../../../src/commands/sensors/compatibility/resolve';
import { legacyCompatibility } from '../../../../src/commands/sensors/compatibility/manifest';

const variant = (id: string, priority = 10, toolRange = '>=9 <12', certifiedRange = '>=10 <11') => ({
    id, priority, certifiedRange,
    requirements: { tool: 'eslint', toolRange, runtime: 'node', runtimeRange: '>=20' },
    assets: [], formatter: 'eslint', probe: { kind: 'version' },
    command: { executable: 'eslint', resolution: 'path', args: ['--version'] },
});
const sensor = { applicability: { allFiles: ['package.json'] }, variants: [variant('eslint-main')] };
const evidence = (input: any = {}) => ({ paths: ['package.json'], applicable: true, packageManagerConflict: false, toolVersion: '10.4.1', runtimeVersion: '22.0.0', probe: { status: 'matched' }, ...input });

describe('resolveSensorCompatibility', () => {
    test.each([
        ['certified', evidence(), 'eslint-main'],
        ['compatible-unverified', evidence({ toolVersion: '11.0.0' }), 'eslint-main'],
        ['incompatible', evidence({ toolVersion: '8.0.0' }), null],
        ['missing-tool', evidence({ toolVersion: null }), null],
        ['unverifiable', evidence({ probe: { status: 'unverifiable' } }), 'eslint-main'],
        ['not-applicable', evidence({ applicable: false, paths: [] }), null],
    ])('resolves %s without conflating states', (state, discovered, variantId) => {
        expect(resolveSensorCompatibility(sensor as any, discovered)).toMatchObject({ state, variantId });
    });

    it('preserves legacy behavior without executing a probe', () => {
        expect(resolveSensorCompatibility({ defaultCmd: 'eslint .' } as any, evidence())).toEqual(legacyCompatibility('legacy pack without schemaVersion'));
    });

    it('fails an equal-precedence match rather than using array order', () => {
        expect(() => resolveSensorCompatibility({ ...sensor, variants: [variant('one'), variant('two')] } as any, evidence())).toThrow(/ambiguous.*one.*two/i);
    });

    it('reports lockfile conflicts as unverifiable', () => {
        expect(resolveSensorCompatibility(sensor as any, evidence({ packageManagerConflict: true }))).toMatchObject({ state: 'unverifiable', reason: 'package-manager-conflict' });
    });
});
