import { resolveProjectCompatibility, resolveSensorCompatibility } from '../../../../src/commands/sensors/compatibility/resolve';
import { legacyCompatibility } from '../../../../src/commands/sensors/compatibility/manifest';

const variant = (id: string, priority = 10, toolRange = '>=9 <12', certifiedRange = '>=10 <11') => ({
    id, priority, certifiedRange,
    requirements: { tool: 'eslint', toolRange, runtime: 'node', runtimeRange: '>=20' },
    assets: [], formatter: 'eslint', probe: { kind: 'version' },
    command: { executable: 'eslint', resolution: 'path', args: ['--version'] },
});
const sensor = { applicability: { allFiles: ['package.json'] }, variants: [variant('eslint-main')] };
const evidence = (input: any = {}) => ({ paths: ['package.json'], applicable: true, packageManagerConflict: false, toolVersion: '10.4.1', runtimeVersion: '22.0.0', probe: { status: 'matched' }, ...input });
const context = { pack: 'js-ts', sensor: 'lint' };

describe('resolveSensorCompatibility', () => {
    test.each([
        ['certified', evidence(), 'eslint-main'],
        ['compatible-unverified', evidence({ toolVersion: '11.0.0' }), 'eslint-main'],
        ['incompatible', evidence({ toolVersion: '8.0.0' }), null],
        ['missing-tool', evidence({ toolVersion: null }), null],
        ['unverifiable', evidence({ probe: { status: 'unverifiable' } }), 'eslint-main'],
        ['not-applicable', evidence({ applicable: false, paths: [] }), null],
    ])('resolves %s without conflating states', (state, discovered, variantId) => {
        expect(resolveSensorCompatibility(sensor as any, discovered, context)).toMatchObject({ state, variantId });
    });

    it('preserves legacy behavior without executing a probe', () => {
        expect(resolveSensorCompatibility({ defaultCmd: 'eslint .' } as any, evidence(), context)).toEqual(legacyCompatibility('legacy pack without schemaVersion'));
    });

    it('fails an equal-precedence match with its pack, sensor, IDs, and ranges', () => {
        expect(() => resolveProjectCompatibility({ schemaVersion: 2, name: 'js-ts', sensors: { lint: { ...sensor, variants: [variant('one'), variant('two')] } } } as any, evidence())).toThrow(/js-ts.*lint.*one.*>=9 <12.*two.*>=9 <12/i);
    });

    it('requires a real pack and sensor identity for direct resolution', () => {
        expect(() => resolveSensorCompatibility(sensor as any, evidence(), undefined as any)).toThrow(/pack and sensor identity are required/i);
    });

    it('reports lockfile conflicts as unverifiable', () => {
        expect(resolveSensorCompatibility(sensor as any, evidence({ packageManagerConflict: true }), context)).toMatchObject({ state: 'unverifiable', reason: 'package-manager-conflict' });
    });

    it('carries bounded, sanitized evidence without raw probe output', () => {
        const resolved = resolveSensorCompatibility(sensor as any, evidence({ paths: ['package.json', '../SECRET_VALUE'], probe: { status: 'matched', output: 'SECRET_VALUE' } }), context);
        expect(resolved.evidence).toEqual(expect.arrayContaining([{ kind: 'project-path', status: 'present', path: 'package.json' }, { kind: 'probe', status: 'matched' }]));
        expect(JSON.stringify(resolved)).not.toContain('SECRET_VALUE');
    });

    test.each(['linux', 'darwin', 'win32'] as const)('resolves the six states under controlled %s evidence', (os) => {
        const states = [
            resolveSensorCompatibility(sensor as any, evidence({ os }), context),
            resolveSensorCompatibility(sensor as any, evidence({ os, toolVersion: '11.0.0' }), context),
            resolveSensorCompatibility(sensor as any, evidence({ os, toolVersion: '8.0.0' }), context),
            resolveSensorCompatibility(sensor as any, evidence({ os, toolVersion: null }), context),
            resolveSensorCompatibility(sensor as any, evidence({ os, probe: { status: 'unverifiable' } }), context),
            resolveSensorCompatibility(sensor as any, evidence({ os, applicable: false, paths: [] }), context),
        ].map(result => result.state);
        expect(states).toEqual(['certified', 'compatible-unverified', 'incompatible', 'missing-tool', 'unverifiable', 'not-applicable']);
    });
});
