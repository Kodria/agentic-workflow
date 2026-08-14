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
    it('keeps explicit-or-supported-language sensors not-applicable without positive capability evidence', () => {
        const resolved = resolveSensorCompatibility({ applicability: { kind: 'explicit-or-supported-language' }, variants: [variant('semgrep')] } as any,
            evidence({ applicable: undefined, paths: [], toolVersion: '1.0.0', runtimeVersion: '3.12.0', probe: { status: 'matched' } }), { pack: 'generic', sensor: 'security' });
        expect(resolved).toMatchObject({ state: 'not-applicable', reason: 'applicability-not-met' });
    });
    it('treats explicit generic pack selection as positive capability in project resolution', () => {
        const resolved = resolveProjectCompatibility({ schemaVersion: 2, name: 'generic', sensors: { security: { applicability: { kind: 'explicit-or-supported-language' }, variants: [variant('semgrep')] } } } as any,
            evidence({ applicable: undefined, paths: [], explicitPackSelection: true }));
        expect(resolved.sensors.security.state).not.toBe('not-applicable');
    });
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

    it('selects an operational variant when another tool variant is absent locally', () => {
        const variants = [
            { ...variant('eslint'), requirements: { ...variant('eslint').requirements, tool: 'eslint' } },
            { ...variant('biome'), requirements: { ...variant('biome').requirements, tool: 'biome' } },
        ];
        const resolved = resolveSensorCompatibility({ applicability: { allFiles: ['package.json'] }, variants } as any,
            evidence({ toolVersions: { eslint: '10.4.1', biome: null }, runtimeVersions: { node: '22.0.0' }, toolVersion: '8.0.0', runtimeVersion: '8.0.0' }), context);
        expect(resolved).toMatchObject({ state: 'certified', variantId: 'eslint', toolVersion: '10.4.1', runtimeVersion: '22.0.0' });
    });

    it('does not reuse scalar evidence for a missing key in a version map', () => {
        const biome = { ...variant('biome'), requirements: { ...variant('biome').requirements, tool: 'biome', runtime: 'bun' } };
        expect(resolveSensorCompatibility({ applicability: { allFiles: ['package.json'] }, variants: [biome] } as any,
            evidence({ toolVersions: { biome: null }, runtimeVersions: { bun: null }, toolVersion: '10.4.1', runtimeVersion: '22.0.0' }), context))
            .toMatchObject({ state: 'missing-tool' });
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

    test.each(['linux', 'darwin', 'win32'] as const)('keeps applicability and deterministic precedence above version resolution on %s', (os) => {
        const broad = variant('broad', 10, '>=9 <12');
        const narrow = variant('narrow', 10, '>=10 <11');
        const precedenceSensor = { applicability: { allFiles: ['package.json'] }, variants: [broad, narrow] };
        expect(resolveSensorCompatibility(precedenceSensor as any, evidence({ os, packageManagerConflict: true, applicable: false, paths: [] }), context))
            .toMatchObject({ state: 'not-applicable', reason: 'applicability-not-met' });
        expect(resolveSensorCompatibility(precedenceSensor as any, evidence({ os }), context)).toMatchObject({ variantId: 'narrow' });
        expect(() => resolveSensorCompatibility({ ...precedenceSensor, variants: [variant('a'), variant('b')] } as any, evidence({ os }), context)).toThrow(/ambiguous/i);
    });
});
