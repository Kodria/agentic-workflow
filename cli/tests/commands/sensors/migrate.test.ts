import fs from 'fs';
import os from 'os';
import path from 'path';
import { planV2Migration, replaceV2ManifestWithV3 } from '../../../src/commands/sensors/migrate';

const sensor = {
    enabled: false, fast: true, timeout: 45_000, variantId: 'eslint-9',
    command: { executable: 'eslint', resolution: 'node-modules-bin' as const, args: ['.', '--format', 'json'] },
    assets: ['eslint.config.awm.mjs'], policyRef: 'shared/semgrep-policy.json' as const,
    initializedCompatibility: { state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [{ kind: 'version', status: 'pass' }] },
};
const v2 = { schemaVersion: 2, pack: 'js-ts', packSelection: 'explicit' as const, registryRoot: '/home/alice/.awm/registries/baseline', packageRoot: 'cli', sensors: { lint: sensor }, concurrency: 2 };

function resolvedSource(pack = 'js-ts', registry = 'baseline', contentRoot = `/home/alice/.awm/registries/${registry}`) {
    return {
        kind: 'logical',
        source: {
            path: path.join(contentRoot, 'sensor-packs', pack, 'pack.json'),
            content: JSON.stringify({
                schemaVersion: 2, name: pack, description: 'fixture', detects: ['package.json'],
                sensors: { lint: { applicability: { allFiles: ['package.json'] }, variants: [{
                    id: 'eslint-9', priority: 1,
                    requirements: { tool: 'eslint', toolRange: '>=9 <10', runtime: 'node', runtimeRange: '>=20' },
                    certifiedRange: '>=9 <10', assets: [], formatter: 'generic', probe: { kind: 'eslint-print-config' },
                    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                }] } },
                coverage: { schemaVersion: 1, classes: { linting: { description: 'fixture', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fixture', command: 'npm test' } } } },
            }),
            registry: { name: registry, remote: 'https://example.invalid/baseline', contentRoot },
        },
    };
}

function sourceWithPack(mutator: (pack: Record<string, unknown>) => void) {
    const source = resolvedSource();
    const pack = JSON.parse(source.source.content) as Record<string, unknown>;
    mutator(pack);
    return { ...source, source: { ...source.source, content: JSON.stringify(pack) } };
}

describe('planV2Migration', () => {
    it('returns an equivalent portable v3 candidate bound to the exact logical source', () => {
        const plan = planV2Migration({ manifest: v2, source: resolvedSource() });
        expect(plan.equivalent).toBe(true);
        expect(plan.equivalence).toEqual({
            pack: true,
            enabledDisabled: true,
            structuredCommands: true,
            assets: true,
            timeouts: true,
            fast: true,
            variants: true,
            policies: true,
            sensorIdentityAndOrder: true,
            concurrency: true,
            compatibilityEvidence: true,
            packageRoot: true,
            logicalSourceBinding: true,
        });
        expect(plan.candidate).toEqual({ schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', packSelection: 'explicit', source: { registry: 'baseline' }, packageRoot: 'cli', sensors: { lint: sensor }, concurrency: 2 });
        expect(JSON.stringify(plan.candidate)).not.toContain('registryRoot');
        expect(JSON.stringify(plan.candidate)).not.toContain('/home/alice');
        expect(JSON.stringify(plan.equivalence)).not.toContain('registryRoot');
        expect(JSON.stringify(plan.equivalence)).not.toContain('/home/alice');
    });

    it('accepts an old bound registry root only when an explicitly supplied logical source contains every selected sensor variant', () => {
        const legacyBound = { ...v2, registryRoot: '/opt/old-machine/registries/baseline' };
        expect(planV2Migration({ manifest: legacyBound, source: resolvedSource() }).candidate.source).toEqual({ registry: 'baseline' });

        for (const source of [
            sourceWithPack(pack => { (pack.sensors as Record<string, unknown>).other = (pack.sensors as Record<string, unknown>).lint; delete (pack.sensors as Record<string, unknown>).lint; }),
            sourceWithPack(pack => { ((((pack.sensors as Record<string, unknown>).lint as Record<string, unknown>).variants as Record<string, unknown>[])[0]).id = 'eslint-8'; }),
        ]) {
            expect(() => planV2Migration({ manifest: legacyBound, source })).toThrow('compatible');
        }
    });

    it('accepts a uniquely rebound configured logical source but rejects physical manifest provenance', () => {
        const rebound = { ...resolvedSource(), kind: 'legacy-rebound' as const };
        expect(planV2Migration({ manifest: v2, source: rebound }).candidate.source).toEqual({ registry: 'baseline' });

        const bound = { ...resolvedSource(), kind: 'legacy-bound' as const, source: {
            ...resolvedSource().source,
            registry: { ...resolvedSource().source.registry, name: 'manifest-provenance', remote: 'local' },
        } };
        expect(() => planV2Migration({ manifest: v2, source: bound })).toThrow('unique logical resolution');
    });

    it('rejects a replacement when any persisted sensor semantic differs', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = path.join(project, 'sensors.json');
        const original = JSON.stringify(v2, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            const withoutPolicy = { ...candidate.sensors.lint };
            delete withoutPolicy.policyRef;
            for (const changed of [
                { ...candidate.sensors.lint, fast: false },
                { ...candidate.sensors.lint, variantId: 'eslint-8', initializedCompatibility: { ...candidate.sensors.lint.initializedCompatibility, variantId: 'eslint-8', toolVersion: '8.0.0', certifiedRange: '>=8 <9' } },
                withoutPolicy,
            ]) {
                expect(() => replaceV2ManifestWithV3(manifestPath, { ...candidate, sensors: { lint: changed } }, resolvedSource())).toThrow('semantic mismatch');
                expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
            }
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('requires source.path to be the canonical selected pack beneath its content root', () => {
        const source = resolvedSource();
        const mismatched = { ...source, source: { ...source.source, path: path.join(source.source.registry.contentRoot, 'sensor-packs', 'other', 'pack.json') } };
        expect(() => planV2Migration({ manifest: v2, source: mismatched })).toThrow('exact resolved pack');
    });

    test.each([
        [{ manifest: { schemaVersion: 3, mode: 'native-gate', reason: 'CI' }, source: resolvedSource() }, 'v2'],
        [{ manifest: v2, source: { kind: 'source-unavailable' } }, 'unavailable'],
        [{ manifest: v2, source: { kind: 'source-ambiguous' } }, 'ambiguous'],
        [{ manifest: v2, source: { ...resolvedSource(), source: { ...resolvedSource().source, registry: { ...resolvedSource().source.registry, name: 'Baseline' } } } }, 'registry'],
        [{ manifest: v2, source: { ...resolvedSource('python'), source: { ...resolvedSource('python').source, path: resolvedSource().source.path } } }, 'exact v2 pack'],
        [{ manifest: { pack: 'js-ts', sensors: { lint: 'npm run lint' } }, source: resolvedSource() }, 'v2'],
    ])('rejects unsafe migration input %#', (input, message) => {
        expect(() => planV2Migration(input)).toThrow(message);
    });

    it('rejects physical home and registry paths in persisted sensor semantics while retaining relative evidence', () => {
        const relative = {
            ...v2,
            sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--config', 'config/eslint.json'] }, initializedCompatibility: {
                ...sensor.initializedCompatibility, reason: 'reports/eslint.json', evidence: [{ kind: 'file', status: 'pass', path: 'reports/eslint.json' }],
            } } },
        };
        expect(planV2Migration({ manifest: relative, source: resolvedSource() }).candidate.sensors.lint).toMatchObject({
            command: { args: ['--config', 'config/eslint.json'] },
            initializedCompatibility: { reason: 'reports/eslint.json', evidence: [{ path: 'reports/eslint.json' }] },
        });

        for (const manifest of [
            { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', '/tmp/eslint-cache'] } } } },
            { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', 'C:\\build-cache'] } } } },
            { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', '\\\\server\\share\\eslint-cache'] } } } },
            { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', '/home/alice/.awm/registries/baseline/cache'] } } } },
            { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', '/home/alice/.awm/registries/baseline/cache'] } } } },
            { ...v2, sensors: { lint: { ...sensor, initializedCompatibility: { ...sensor.initializedCompatibility, reason: 'source /home/alice/.awm/registries/baseline' } } } },
            { ...v2, sensors: { lint: { ...sensor, initializedCompatibility: { ...sensor.initializedCompatibility, evidence: [{ kind: 'file', status: 'pass', path: '/home/alice/report.json' }] } } } },
        ]) expect(() => planV2Migration({ manifest, source: resolvedSource() })).toThrow(/physical path|contained relative asset/);
    });

    it('rejects absolute paths embedded in flag-value strings while retaining relative flag values', () => {
        const relative = {
            ...v2,
            sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache=cache/eslint', '--config=config/eslint.json'] } } },
        };
        expect(planV2Migration({ manifest: relative, source: resolvedSource() }).candidate.sensors.lint.command.args)
            .toEqual(['--cache=cache/eslint', '--config=config/eslint.json']);

        for (const args of [
            ['--cache=/tmp/x'],
            ['--config=C:\\temp\\x'],
            ['--output=//server/share'],
            ['--cache="/tmp/x"'],
            ["--cache='C:\\temp\\x'"],
            ['--config="//server/share"'],
            ['--cache:/tmp/x'],
            ['--config:C:\\temp\\x'],
            ['--cache:"/tmp/x"'],
            ["--config:'C:\\temp\\x'"],
        ]) {
            const manifest = { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args } } } };
            expect(() => planV2Migration({ manifest, source: resolvedSource() })).toThrow('physical path');
        }
    });

    it('rejects a physical path under the resolved source root even when the v2 root differs', () => {
        const source = resolvedSource('js-ts', 'baseline', path.join(path.sep, 'srv', 'resolved-registry'));
        const manifest = {
            ...v2,
            registryRoot: path.join(path.sep, 'opt', 'legacy-registry'),
            sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', path.join(path.sep, 'srv', 'resolved-registry', 'cache')] } } },
        };
        expect(() => planV2Migration({ manifest, source })).toThrow('physical path');
    });

    it('validates before atomic replacement and leaves the v2 original intact on write failure', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = path.join(project, 'sensors.json');
        const original = JSON.stringify(v2, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const plan = planV2Migration({ manifest: v2, source: resolvedSource() });
            fs.chmodSync(project, 0o500);
            expect(() => replaceV2ManifestWithV3(manifestPath, plan.candidate, resolvedSource())).toThrow();
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
        } finally {
            fs.chmodSync(project, 0o700);
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('rejects a physical sensor path before replacement and preserves the v2 original', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = path.join(project, 'sensors.json');
        const original = JSON.stringify(v2, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            const unsafe = { ...candidate, sensors: { lint: { ...candidate.sensors.lint, command: { ...candidate.sensors.lint.command, args: ['/home/alice/.awm/cache'] } } } };
            expect(() => replaceV2ManifestWithV3(manifestPath, unsafe, resolvedSource())).toThrow('physical path');
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('requires replacement to use the supplied logical source rather than candidate provenance', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = path.join(project, 'sensors.json');
        const original = JSON.stringify({ ...v2, registryRoot: '/opt/legacy-bound-registry' }, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const source = resolvedSource();
            const candidate = planV2Migration({ manifest: JSON.parse(original), source }).candidate;
            expect(() => replaceV2ManifestWithV3(manifestPath, { ...candidate, source: { registry: 'other' } }, source)).toThrow('semantic mismatch');
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource('js-ts', 'rebound'))).toThrow('semantic mismatch');
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, sourceWithPack(pack => { ((((pack.sensors as Record<string, unknown>).lint as Record<string, unknown>).variants as Record<string, unknown>[])[0]).id = 'eslint-8'; }))).toThrow('compatible');
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('preserves a pre-existing replacement temporary file when exclusive creation collides', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = path.join(project, 'sensors.json');
        const now = jest.spyOn(Date, 'now').mockReturnValue(12345);
        const temporary = path.join(project, `.sensors.json.${process.pid}.12345.tmp`);
        try {
            fs.writeFileSync(manifestPath, JSON.stringify(v2));
            fs.writeFileSync(temporary, 'not ours');
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource())).toThrow();
            expect(fs.readFileSync(temporary, 'utf8')).toBe('not ours');
        } finally {
            now.mockRestore();
            fs.rmSync(project, { recursive: true, force: true });
        }
    });
});
