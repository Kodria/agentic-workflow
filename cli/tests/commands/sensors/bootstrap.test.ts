jest.mock('../../../src/commands/sensors/project', () => ({ resolveSensorProject: jest.fn() }));
jest.mock('../../../src/commands/sensors/detection', () => ({ detectStack: jest.fn() }));
jest.mock('../../../src/core/registries', () => ({ listRegistries: jest.fn(() => []) }));
jest.mock('../../../src/commands/sensors/compatibility/pack-source', () => ({ listPackSources: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/contract', () => ({ ...jest.requireActual('../../../src/commands/sensors/compatibility/contract'), parseSensorPack: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/live', () => ({ resolveParsedPackCompatibility: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/source', () => ({ resolveSensorSource: jest.fn() }));
jest.mock('../../../src/commands/sensors/migrate', () => ({ planV2Migration: jest.fn(), replaceV2ManifestWithV3: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/materialize', () => ({ materializePortableSensors: jest.fn() }));
jest.mock('../../../src/commands/sensors/compatibility/safe-file', () => ({ writeProjectFile: jest.fn(), withProjectLease: jest.fn((_root: string, operation: () => unknown) => operation()) }));

import { applySensorBootstrap, planSensorBootstrap } from '../../../src/commands/sensors/bootstrap';
import { resolveSensorProject } from '../../../src/commands/sensors/project';
import { detectStack } from '../../../src/commands/sensors/detection';
import { listPackSources } from '../../../src/commands/sensors/compatibility/pack-source';
import { parseSensorPack } from '../../../src/commands/sensors/compatibility/contract';
import { resolveParsedPackCompatibility } from '../../../src/commands/sensors/compatibility/live';
import { resolveSensorSource } from '../../../src/commands/sensors/compatibility/source';
import { planV2Migration } from '../../../src/commands/sensors/migrate';
import { replaceV2ManifestWithV3 } from '../../../src/commands/sensors/migrate';
import { materializePortableSensors } from '../../../src/commands/sensors/compatibility/materialize';
import { withProjectLease, writeProjectFile } from '../../../src/commands/sensors/compatibility/safe-file';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

const root = '/project';
const missing = { state: 'missing' as const, projectRoot: root, manifestPath: `${root}/.awm/sensors.json` };
const source = { path: '/registry/sensor-packs/js-ts/pack.json', content: '{}', registry: { name: 'baseline', remote: 'local', contentRoot: '/registry' } };

describe('planSensorBootstrap', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveSensorProject as jest.Mock).mockReturnValue(missing);
        (detectStack as jest.Mock).mockReturnValue({ pack: 'js-ts', indicators: ['package.json'] });
    });

    it('requires an explicit mode for a missing declaration and never calls a writer', async () => {
        await expect(planSensorBootstrap(root)).resolves.toMatchObject({ kind: 'blocked', reason: 'mode-required', changes: [] });
        expect(listPackSources).not.toHaveBeenCalled();
    });

    it.each(['native-gate', 'opt-out'] as const)('requires a reason for missing %s', async mode => {
        await expect(planSensorBootstrap(root, { mode })).resolves.toMatchObject({ kind: 'blocked', reason: 'reason-required', changes: [] });
    });

    it('plans a versioned native declaration without writing it', async () => {
        await expect(planSensorBootstrap(root, { mode: 'native-gate', reason: 'remote CI', dryRun: true })).resolves.toEqual({
            kind: 'create', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, dryRun: true, configure: true,
            changes: [{ path: '.awm/sensors.json', action: 'create' }],
            manifest: { schemaVersion: 3, mode: 'native-gate', reason: 'remote CI' },
        });
    });

    it('returns an idempotent no-op for an existing v3 declaration', async () => {
        (resolveSensorProject as jest.Mock).mockReturnValue({ state: 'configured', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, packageRoot: root, manifest: { kind: 'v3', pack: { schemaVersion: 3, mode: 'opt-out', reason: 'declared' } } });
        await expect(planSensorBootstrap(root)).resolves.toMatchObject({ kind: 'noop', changes: [] });
    });

    it('rejects a mode that conflicts with an existing v3 declaration', async () => {
        (resolveSensorProject as jest.Mock).mockReturnValue({ state: 'configured', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, packageRoot: root, manifest: { kind: 'v3', pack: { schemaVersion: 3, mode: 'opt-out', reason: 'declared' } } });
        await expect(planSensorBootstrap(root, { mode: 'native-gate', reason: 'other' })).resolves.toMatchObject({ kind: 'blocked', reason: 'mode-conflicts-with-existing-declaration', changes: [] });
    });

    it('blocks source-unavailable v2 migration without attempting a candidate', async () => {
        const v2 = { schemaVersion: 2, pack: 'js-ts', sensors: {} };
        (resolveSensorProject as jest.Mock).mockReturnValue({ state: 'configured', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, packageRoot: root, manifest: { kind: 'v2', pack: v2 } });
        (resolveSensorSource as jest.Mock).mockReturnValue({ kind: 'source-unavailable', reason: 'no-compatible-registry', remedy: 'install-registry-or-run-awm-update' });
        await expect(planSensorBootstrap(root)).resolves.toMatchObject({ kind: 'blocked', reason: 'no-compatible-registry', changes: [] });
        expect(planV2Migration).not.toHaveBeenCalled();
    });

    it('preserves a legacy v1 manifest and blocks an ambiguous v2 source without writes', async () => {
        (resolveSensorProject as jest.Mock).mockReturnValueOnce({ state: 'configured', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, packageRoot: root, manifest: { kind: 'legacy', pack: { pack: 'js-ts', sensors: {}, compatibility: {} } } });
        await expect(planSensorBootstrap(root)).resolves.toMatchObject({ kind: 'blocked', reason: 'legacy-v1-preserved', changes: [] });
        (resolveSensorProject as jest.Mock).mockReturnValueOnce({ state: 'configured', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, packageRoot: root, manifest: { kind: 'v2', pack: { schemaVersion: 2, pack: 'js-ts', sensors: {} } } });
        (resolveSensorSource as jest.Mock).mockReturnValue({ kind: 'source-ambiguous', reason: 'multiple-compatible-registries', remedy: 'configure-one-logical-registry', candidates: ['a', 'b'] });
        await expect(planSensorBootstrap(root)).resolves.toMatchObject({ kind: 'blocked', reason: 'multiple-compatible-registries', changes: [] });
        expect(planV2Migration).not.toHaveBeenCalled();
    });

    it('plans a v2 replacement only after semantic migration proves equivalence', async () => {
        const v2 = { schemaVersion: 2, pack: 'js-ts', sensors: {} };
        const resolution = { kind: 'logical', source };
        const migration = { candidate: { schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', source: { registry: 'baseline' }, sensors: {} }, equivalent: true, equivalence: {} };
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bootstrap-plan-'));
        const manifestPath = path.join(project, 'sensors.json');
        try {
            fs.writeFileSync(manifestPath, JSON.stringify(v2));
            (resolveSensorProject as jest.Mock).mockReturnValue({ state: 'configured', projectRoot: project, manifestPath, packageRoot: project, manifest: { kind: 'v2', pack: v2 } });
            (resolveSensorSource as jest.Mock).mockReturnValue(resolution);
            (planV2Migration as jest.Mock).mockReturnValue(migration);
            await expect(planSensorBootstrap(project)).resolves.toMatchObject({ kind: 'migrate', changes: [{ path: '.awm/sensors.json', action: 'replace' }], migration });
        } finally { fs.rmSync(project, { recursive: true, force: true }); }
    });

    it('plans a concrete portable project-sensors declaration from one logical source', async () => {
        const variant = { id: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.mjs'] };
        (listPackSources as jest.Mock).mockReturnValue([source]);
        (parseSensorPack as jest.Mock).mockReturnValue({ kind: 'v2', pack: { schemaVersion: 2, name: 'js-ts', sensors: { lint: { fast: true, variants: [variant] } } } });
        (resolveParsedPackCompatibility as jest.Mock).mockResolvedValue({ pack: { schemaVersion: 2, name: 'js-ts', sensors: { lint: { fast: true, variants: [variant] } } }, sensors: { lint: { state: 'certified', reason: 'ok', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } } });

        const plan = await planSensorBootstrap(root, { mode: 'project-sensors' });
        expect(plan).toMatchObject({ kind: 'create', changes: [{ path: '.awm/sensors.json', action: 'create' }, { path: 'eslint.config.mjs', action: 'create' }], manifest: { schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', source: { registry: 'baseline' } } });
        expect(JSON.stringify((plan as Extract<typeof plan, { kind: 'create' }>).manifest)).not.toContain('/registry');
    });

    it('resolves compatibility from the selected package root', async () => {
        const variant = { id: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: [] };
        const pack = { schemaVersion: 2, name: 'js-ts', sensors: { lint: { variants: [variant] } } };
        (listPackSources as jest.Mock).mockReturnValue([source]);
        (parseSensorPack as jest.Mock).mockReturnValue({ kind: 'v2', pack });
        (resolveParsedPackCompatibility as jest.Mock).mockResolvedValue({ pack, sensors: { lint: { state: 'certified', reason: 'ok', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] } } });

        await planSensorBootstrap(root, { mode: 'project-sensors', packageRoot: 'packages/web' });

        expect(resolveParsedPackCompatibility).toHaveBeenCalledWith(path.join(root, 'packages/web'), pack);
    });

    it('blocks project-sensors when compatibility cannot select every declared sensor variant', async () => {
        const variant = { id: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: [] };
        (listPackSources as jest.Mock).mockReturnValue([source]);
        (parseSensorPack as jest.Mock).mockReturnValue({ kind: 'v2', pack: { schemaVersion: 2, name: 'js-ts', sensors: { lint: { variants: [variant] } } } });
        (resolveParsedPackCompatibility as jest.Mock).mockResolvedValue({ pack: { schemaVersion: 2, name: 'js-ts', sensors: { lint: { variants: [variant] } } }, sensors: { lint: { variantId: null } } });
        await expect(planSensorBootstrap(root, { mode: 'project-sensors' })).resolves.toMatchObject({ kind: 'blocked', reason: 'sensor-variant-unresolvable', changes: [] });
    });

    it('converts a compatibility probe failure into a stable blocked plan', async () => {
        (listPackSources as jest.Mock).mockReturnValue([source]);
        (parseSensorPack as jest.Mock).mockReturnValue({ kind: 'v2', pack: { schemaVersion: 2, name: 'js-ts', sensors: {} } });
        (resolveParsedPackCompatibility as jest.Mock).mockRejectedValue(new Error('tool probe failed'));
        await expect(planSensorBootstrap(root, { mode: 'project-sensors' })).resolves.toMatchObject({ kind: 'blocked', reason: 'compatibility-unresolvable', changes: [] });
    });

    it.each([{ mode: 'invalid' }, { reason: 'line\nbreak' }, { dryRun: 'yes' }, { unknown: true }])('rejects invalid bootstrap options %j before planning', async input => {
        await expect(planSensorBootstrap(root, input as never)).rejects.toThrow(/bootstrap (mode|reason|dryRun|options)/);
        expect(listPackSources).not.toHaveBeenCalled();
    });

    it('accepts a Windows absolute registry path without treating it as project state', async () => {
        await expect(planSensorBootstrap(root, { mode: 'project-sensors', registryRoot: 'C:\\awm\\registries\\baseline' })).resolves.toMatchObject({
            kind: 'blocked', reason: 'registry-root-not-configured', changes: [],
        });
    });

    it('rejects applying a dry-run plan before any publisher runs', () => {
        expect(() => applySensorBootstrap({ kind: 'create', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, dryRun: true, changes: [], manifest: { schemaVersion: 3, mode: 'native-gate', reason: 'CI' } })).toThrow('dry-run');
        expect(writeProjectFile).not.toHaveBeenCalled();
    });

    it('publishes native declarations and project sensors through distinct native boundaries', () => {
        expect(applySensorBootstrap({ kind: 'create', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, dryRun: false, changes: [{ path: '.awm/sensors.json', action: 'create' }], manifest: { schemaVersion: 3, mode: 'native-gate', reason: 'CI' } })).toBe('created');
        expect(writeProjectFile).toHaveBeenCalledWith(root, '.awm/sensors.json', expect.any(Buffer), { mode: 'create', createParents: true });
        expect(withProjectLease).toHaveBeenCalledWith(root, expect.any(Function));
        const manifest = { schemaVersion: 3 as const, mode: 'project-sensors' as const, pack: 'js-ts', source: { registry: 'baseline' }, sensors: {} };
        expect(applySensorBootstrap({ kind: 'create', projectRoot: root, manifestPath: `${root}/.awm/sensors.json`, dryRun: false, changes: [{ path: '.awm/sensors.json', action: 'create' }], manifest, source })).toBe('created');
        expect(materializePortableSensors).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: root, pack: 'js-ts', source, sensors: {} }));
    });

    it('delegates a validated migration to the fenced replacement', () => {
        const candidate = { schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', source: { registry: 'baseline' }, sensors: {} };
        const migration = { candidate, equivalent: true, equivalence: {} } as never;
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bootstrap-plan-'));
        const manifestPath = path.join(project, 'sensors.json');
        try {
            const bytes = Buffer.from('{"schemaVersion":2}\n');
            fs.writeFileSync(manifestPath, bytes);
            const plan = { kind: 'migrate' as const, projectRoot: project, manifestPath, dryRun: false, changes: [{ path: '.awm/sensors.json', action: 'replace' }] as [{ path: '.awm/sensors.json'; action: 'replace' }], migration, source, originalDigest: createHash('sha256').update(bytes).digest('hex') };
            expect(applySensorBootstrap(plan)).toBe('migrated');
            expect(replaceV2ManifestWithV3).toHaveBeenCalledWith(plan.manifestPath, candidate, source);
        } finally { fs.rmSync(project, { recursive: true, force: true }); }
    });

    it('rejects a migration plan whose manifest changed after planning', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bootstrap-stale-'));
        const manifestPath = path.join(project, 'sensors.json');
        try {
            fs.writeFileSync(manifestPath, 'replacement');
            const plan = { kind: 'migrate' as const, projectRoot: project, manifestPath, dryRun: false, changes: [{ path: '.awm/sensors.json', action: 'replace' }] as [{ path: '.awm/sensors.json'; action: 'replace' }], migration: { candidate: {}, equivalent: true, equivalence: {} } as never, source, originalDigest: createHash('sha256').update('original').digest('hex') };
            expect(() => applySensorBootstrap(plan)).toThrow('stale');
            expect(replaceV2ManifestWithV3).not.toHaveBeenCalled();
        } finally { fs.rmSync(project, { recursive: true, force: true }); }
    });
});
