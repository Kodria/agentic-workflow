import fs from 'fs';
import os from 'os';
import path from 'path';
import { planV2Migration, replaceV2ManifestWithV3 } from '../../../src/commands/sensors/migrate';
import { setSecureFsForTests } from '../../../src/commands/sensors/compatibility/safe-file';
import { secureFs } from '../../../src/core/secure-fs/native-bridge';

afterEach(() => setSecureFsForTests(undefined));

function replaceWithoutNoFollow(...args: Parameters<typeof replaceV2ManifestWithV3>): void {
    let replace: typeof replaceV2ManifestWithV3 | undefined;
    jest.isolateModules(() => {
        jest.doMock('fs', () => {
            const actual = jest.requireActual<typeof fs>('fs');
            const constants = { ...actual.constants, O_NOFOLLOW: undefined };
            return { __esModule: true, default: { ...actual, constants }, ...actual, constants };
        });
        replace = require('../../../src/commands/sensors/migrate').replaceV2ManifestWithV3 as typeof replaceV2ManifestWithV3;
    });
    jest.dontMock('fs');
    if (!replace) throw new Error('portable migration replacement could not be loaded');
    replace(...args);
}

const sensor = {
    enabled: false, fast: true, timeout: 45_000, variantId: 'eslint-9',
    command: { executable: 'eslint', resolution: 'node-modules-bin' as const, args: ['.', '--format', 'json'] },
    assets: ['eslint.config.awm.mjs'], policyRef: 'shared/semgrep-policy.json' as const,
    initializedCompatibility: { state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [{ kind: 'version', status: 'pass' }] },
};
const v2 = { schemaVersion: 2, pack: 'js-ts', packSelection: 'explicit' as const, registryRoot: '/home/alice/.awm/registries/baseline', packageRoot: 'cli', sensors: { lint: sensor }, concurrency: 2 };
const sourceRegistryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-source-'));

afterAll(() => fs.rmSync(sourceRegistryRoot, { recursive: true, force: true }));

function resolvedSource(pack = 'js-ts', registry = 'baseline', contentRoot = sourceRegistryRoot) {
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

function canonicalManifestPath(project: string): string {
    const manifestPath = path.join(project, '.awm', 'sensors.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    return manifestPath;
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

    it('invokes the secure-fs bridge before applying a migration', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = canonicalManifestPath(project);
        let leaseHeld = false;
        const bridge = {
            withProjectLease: jest.fn((_projectRoot: string, operation: () => unknown) => {
                leaseHeld = true;
                try { return operation(); }
                finally { leaseHeld = false; }
            }) as unknown as typeof secureFs.withProjectLease,
            readRegularFile: jest.fn((...args: Parameters<typeof secureFs.readRegularFile>) => {
                expect(leaseHeld).toBe(true);
                return secureFs.readRegularFile(...args);
            }),
            writeProjectTransaction: jest.fn((...args: Parameters<typeof secureFs.writeProjectTransaction>) => {
                expect(leaseHeld).toBe(true);
                return secureFs.writeProjectTransaction(...args);
            }),
        };
        try {
            fs.writeFileSync(manifestPath, JSON.stringify(v2));
            setSecureFsForTests(bridge);
            replaceV2ManifestWithV3(manifestPath, planV2Migration({ manifest: v2, source: resolvedSource() }).candidate, resolvedSource());
            expect(bridge.withProjectLease).toHaveBeenCalledWith(project, expect.any(Function));
            expect(bridge.readRegularFile).toHaveBeenCalledWith(manifestPath, 1024 * 1024);
            expect(bridge.writeProjectTransaction).toHaveBeenCalledWith(
                project,
                '.awm/sensors.json',
                expect.any(Buffer),
                { mode: 'replace', expected: expect.any(Buffer), expectedIdentity: expect.any(Object), createParents: false },
            );
            const observed = bridge.readRegularFile.mock.results[0].value;
            const writeOptions = bridge.writeProjectTransaction.mock.calls[0][3];
            expect(writeOptions.expectedIdentity).toBe(observed.identity);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
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
        const manifestPath = canonicalManifestPath(project);
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

    it('plans from the resolved source snapshot without probing its physical root', () => {
        const unavailableRoot = path.join(os.tmpdir(), `awm-migrate-unavailable-${Date.now()}`);
        const source = resolvedSource('js-ts', 'baseline', unavailableRoot);

        expect(planV2Migration({ manifest: v2, source }).candidate.source).toEqual({ registry: 'baseline' });
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
            sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache=cache/eslint', '--config=config/eslint.json', '--inputs=(reports/lint.json,cache/eslint)'] } } },
        };
        expect(planV2Migration({ manifest: relative, source: resolvedSource() }).candidate.sensors.lint.command.args)
            .toEqual(['--cache=cache/eslint', '--config=config/eslint.json', '--inputs=(reports/lint.json,cache/eslint)']);

        for (const args of [
            ['--cache=/tmp/x'],
            ['--config=C:\\temp\\x'],
            ['--config=C:temp\\x'],
            ['--config=\\temp\\x'],
            ['--output=//server/share'],
            ['--cache="/tmp/x"'],
            ["--cache='C:\\temp\\x'"],
            ['--config="//server/share"'],
            ['--cache:/tmp/x'],
            ['--config:C:\\temp\\x'],
            ['--cache:"/tmp/x"'],
            ["--config:'C:\\temp\\x'"],
            ['--cache;/tmp/x'],
            ['--cache,/tmp/x'],
            ['--config(C:\\\\temp\\\\x)'],
            ['--output,\\\\\\\\server\\\\share'],
            ['--config(//server/share)'],
            ['--cache;"/tmp/x"'],
            ["--config;'C:\\temp\\x'"],
        ]) {
            const manifest = { ...v2, sensors: { lint: { ...sensor, command: { ...sensor.command, args } } } };
            expect(() => planV2Migration({ manifest, source: resolvedSource() })).toThrow('physical path');
        }
    });

    it('retains an HTTPS URL command argument as portable sensor semantics', () => {
        const manifest = {
            ...v2,
            sensors: {
                lint: {
                    ...sensor,
                    command: { ...sensor.command, args: ['--rules-url=https://example.test/eslint/rules.json'] },
                },
            },
        };

        expect(planV2Migration({ manifest, source: resolvedSource() }).candidate.sensors.lint.command.args)
            .toEqual(['--rules-url=https://example.test/eslint/rules.json']);
    });

    test.each(['C:package', 'C:/package'])('rejects a Windows drive-qualified packageRoot: %s', packageRoot => {
        expect(() => planV2Migration({ manifest: { ...v2, packageRoot }, source: resolvedSource() })).toThrow(/physical path|contained relative asset path/);
    });

    it('rejects a physical path under the resolved source root even when the v2 root differs', () => {
        const resolvedRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-resolved-'));
        const source = resolvedSource('js-ts', 'baseline', resolvedRegistry);
        const manifest = {
            ...v2,
            registryRoot: path.join(path.sep, 'opt', 'legacy-registry'),
            sensors: { lint: { ...sensor, command: { ...sensor.command, args: ['--cache', path.join(resolvedRegistry, 'cache')] } } },
        };
        try {
            expect(() => planV2Migration({ manifest, source })).toThrow('physical path');
        } finally {
            fs.rmSync(resolvedRegistry, { recursive: true, force: true });
        }
    });

    it('validates before atomic replacement and leaves the v2 original intact on write failure', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = canonicalManifestPath(project);
        const manifestDirectory = path.dirname(manifestPath);
        const original = JSON.stringify(v2, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const plan = planV2Migration({ manifest: v2, source: resolvedSource() });
            fs.chmodSync(manifestDirectory, 0o500);
            expect(() => replaceV2ManifestWithV3(manifestPath, plan.candidate, resolvedSource())).toThrow();
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
        } finally {
            fs.chmodSync(manifestDirectory, 0o700);
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('rejects a physical sensor path before replacement and preserves the v2 original', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = canonicalManifestPath(project);
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
        const manifestPath = canonicalManifestPath(project);
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

    it('rejects an arbitrary absolute sensors.json outside the canonical project manifest location', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-arbitrary-'));
        const manifestPath = path.join(project, 'sensors.json');
        const original = JSON.stringify(v2, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;

            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource()))
                .toThrow(/canonical project manifest|\.awm\/sensors\.json/i);
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
            expect(fs.existsSync(path.join(project, '.awm'))).toBe(false);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('preserves a pre-existing legacy-named temporary file while staging privately', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = canonicalManifestPath(project);
        const now = jest.spyOn(Date, 'now').mockReturnValue(12345);
        const temporary = path.join(project, `.sensors.json.${process.pid}.12345.tmp`);
        try {
            fs.writeFileSync(manifestPath, JSON.stringify(v2));
            fs.writeFileSync(temporary, 'not ours');
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource())).not.toThrow();
            expect(fs.readFileSync(temporary, 'utf8')).toBe('not ours');
        } finally {
            now.mockRestore();
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it.skip('fails closed before staging when descriptor-bound publication is unavailable', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-portable-parent-'));
        const movedProject = `${project}-original`;
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-portable-outside-'));
        const manifestPath = canonicalManifestPath(project);
        const mkdtempSync = fs.mkdtempSync.bind(fs);
        const mkdtemp = jest.spyOn(fs, 'mkdtempSync');
        let parentSwapAttempted = false;
        try {
            fs.writeFileSync(manifestPath, JSON.stringify(v2));
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            mkdtemp.mockImplementation(((prefix: string, options?: fs.EncodingOption) => {
                if (prefix.startsWith(path.join(project, '.sensors.json.migrate-'))) {
                    parentSwapAttempted = true;
                    fs.renameSync(project, movedProject);
                    fs.symlinkSync(outside, project, 'dir');
                }
                return mkdtempSync(prefix, options);
            }) as typeof fs.mkdtempSync);
            expect(() => replaceWithoutNoFollow(manifestPath, candidate, resolvedSource())).toThrow(/descriptor|safe|migration/i);
            expect(parentSwapAttempted).toBe(false);
            expect(fs.readdirSync(outside)).toEqual([]);
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(JSON.stringify(v2));
        } finally {
            mkdtemp.mockRestore();
            fs.rmSync(project, { recursive: true, force: true });
            fs.rmSync(movedProject, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it.skip('keeps descriptor-bound Linux publication inside the original parent after a swap', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-parent-swap-'));
        const movedProject = `${project}-original`;
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-parent-outside-'));
        const manifestPath = canonicalManifestPath(project);
        const original = JSON.stringify(v2, null, 2) + '\n';
        const mkdtempSync = fs.mkdtempSync.bind(fs);
        const mkdtemp = jest.spyOn(fs, 'mkdtempSync');
        const writeFileSync = fs.writeFileSync.bind(fs);
        const write = jest.spyOn(fs, 'writeFileSync');
        let swapped = false;
        const redirectedWrites: fs.PathLike[] = [];
        try {
            fs.writeFileSync(manifestPath, original);
            fs.writeFileSync(path.join(outside, 'sensors.json'), original);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            mkdtemp.mockImplementation(((prefix: string, options?: fs.EncodingOption) => {
                if (!swapped && path.basename(prefix).startsWith('.sensors.json.migrate-')) {
                    swapped = true;
                    fs.renameSync(project, movedProject);
                    fs.symlinkSync(outside, project, 'dir');
                }
                return mkdtempSync(prefix, options);
            }) as typeof fs.mkdtempSync);
            write.mockImplementation(((file: fs.PathLike, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions | string) => {
                if (typeof file === 'string' && fs.realpathSync(path.dirname(file)).startsWith(outside + path.sep)) redirectedWrites.push(file);
                return (writeFileSync as (...args: unknown[]) => void)(file, data, options);
            }) as typeof fs.writeFileSync);
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource())).not.toThrow();
            expect(swapped).toBe(true);
            expect(redirectedWrites).toEqual([]);
            expect(fs.readFileSync(path.join(outside, 'sensors.json'), 'utf8')).toBe(original);
            expect(JSON.parse(fs.readFileSync(path.join(movedProject, 'sensors.json'), 'utf8'))).toMatchObject({ schemaVersion: 3, source: { registry: 'baseline' } });
        } finally {
            mkdtemp.mockRestore();
            write.mockRestore();
            fs.rmSync(project, { recursive: true, force: true });
            fs.rmSync(movedProject, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('refuses to replace a manifest whose bytes change after the original is read', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = canonicalManifestPath(project);
        const original = JSON.stringify(v2, null, 2) + '\n';
        const replacement = JSON.stringify({ schemaVersion: 2, pack: 'js-ts', sensors: {} }) + '\n';
        const originalLstat = fs.lstatSync.bind(fs);
        const lstat = jest.spyOn(fs, 'lstatSync');
        let inspections = 0;
        try {
            fs.writeFileSync(manifestPath, original);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            lstat.mockImplementation(((candidatePath: fs.PathLike, options?: fs.StatOptions) => {
                if (path.basename(String(candidatePath)) === 'sensors.json' && ++inspections === 2) fs.writeFileSync(manifestPath, replacement);
                return originalLstat(candidatePath, options);
            }) as typeof fs.lstatSync);
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource())).toThrow(/changed|identity/i);
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(replacement);
        } finally {
            lstat.mockRestore();
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it('refuses a same-byte manifest substitution after the native read and preserves the swapped target', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-same-byte-swap-'));
        const manifestPath = canonicalManifestPath(project);
        const parkedPath = path.join(project, 'original-sensors.json');
        const original = JSON.stringify(v2, null, 2) + '\n';
        const bridge = {
            withProjectLease: jest.fn((_projectRoot: string, operation: () => unknown) => operation()) as unknown as typeof secureFs.withProjectLease,
            readRegularFile: jest.fn((...args: Parameters<typeof secureFs.readRegularFile>) => secureFs.readRegularFile(...args)),
            writeProjectTransaction: jest.fn((...args: Parameters<typeof secureFs.writeProjectTransaction>) => {
                fs.renameSync(manifestPath, parkedPath);
                fs.writeFileSync(manifestPath, original);
                return secureFs.writeProjectTransaction(...args);
            }),
        };
        try {
            fs.writeFileSync(manifestPath, original);
            setSecureFsForTests(bridge);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;

            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource())).toThrow(/changed|identity|secure-fs/i);
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
            expect(fs.readFileSync(parkedPath, 'utf8')).toBe(original);
            expect(bridge.writeProjectTransaction).toHaveBeenCalledTimes(1);
        } finally {
            setSecureFsForTests(undefined);
            fs.rmSync(project, { recursive: true, force: true });
        }
    });

    it.skip('never overwrites a manifest installed during final no-clobber publication', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = canonicalManifestPath(project);
        const original = JSON.stringify(v2, null, 2) + '\n';
        const replacement = JSON.stringify({ schemaVersion: 2, pack: 'js-ts', sensors: {} }) + '\n';
        const originalLink = fs.linkSync.bind(fs);
        const link = jest.spyOn(fs, 'linkSync');
        let published = false;
        try {
            fs.writeFileSync(manifestPath, original);
            const candidate = planV2Migration({ manifest: v2, source: resolvedSource() }).candidate;
            link.mockImplementation(((existingPath: fs.PathLike, newPath: fs.PathLike) => {
                if (path.basename(String(newPath)) === 'sensors.json' && !published) {
                    published = true;
                    fs.writeFileSync(manifestPath, replacement, { flag: 'wx' });
                }
                return originalLink(existingPath, newPath);
            }) as typeof fs.linkSync);
            expect(() => replaceV2ManifestWithV3(manifestPath, candidate, resolvedSource())).toThrow();
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(replacement);
        } finally {
            link.mockRestore();
            fs.rmSync(project, { recursive: true, force: true });
        }
    });
});
