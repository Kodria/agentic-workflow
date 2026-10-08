import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../../src/commands/sensors/bootstrap', () => ({
    planSensorBootstrap: jest.fn(),
    applySensorBootstrap: jest.fn(),
}));

import { buildManifest, detectSourceDirs, detectStack, initSensors } from '../../../src/commands/sensors/init';
import { applySensorBootstrap, planSensorBootstrap } from '../../../src/commands/sensors/bootstrap';

function makeRegistry(): string {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
    const packDir = path.join(registryRoot, 'sensor-packs', 'js-ts');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
        name: 'js-ts',
        sensors: { typecheck: { fast: true, defaultCmd: 'npx tsc --noEmit', formatter: 'tsc' } },
    }));
    return registryRoot;
}

describe('legacy detection helpers', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('detects the supported project stacks in priority order', () => {
        fs.writeFileSync(path.join(tmpDir, 'deploy.sh'), '#!/bin/sh\n');
        expect(detectStack(tmpDir).pack).toBe('shell');
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('uses detected source directories when reading a legacy pack default', () => {
        const registryRoot = makeRegistry();
        try {
            fs.mkdirSync(path.join(tmpDir, 'app'));
            expect(detectSourceDirs(tmpDir)).toEqual(['app']);
            expect(buildManifest('js-ts', undefined, registryRoot, tmpDir).sensors.typecheck).toMatchObject({
                cmd: 'npx tsc --noEmit', formatter: 'tsc', fast: true,
            });
        } finally { fs.rmSync(registryRoot, { recursive: true, force: true }); }
    });
});

describe('initSensors compatibility API', () => {
    let tmpDir: string;
    let registryRoot: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-'));
        registryRoot = makeRegistry();
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(registryRoot, { recursive: true, force: true });
    });

    it('delegates compatibility creation to the portable bootstrap without persisting registryRoot', async () => {
        const manifest = { schemaVersion: 3 as const, mode: 'project-sensors' as const, pack: 'js-ts', source: { registry: 'baseline' }, sensors: {} };
        (planSensorBootstrap as jest.Mock).mockResolvedValue({
            kind: 'create', projectRoot: tmpDir, manifestPath: path.join(tmpDir, '.awm', 'sensors.json'),
            changes: [{ path: '.awm/sensors.json', action: 'create' }], dryRun: false, manifest,
        });
        (applySensorBootstrap as jest.Mock).mockReturnValue('created');

        const result = await initSensors({ cwd: tmpDir, registryRoot, configure: false });

        expect(planSensorBootstrap).toHaveBeenCalledWith(tmpDir, {
            mode: 'project-sensors', registryRoot, configure: false, pack: undefined, packageRoot: undefined,
        });
        expect(applySensorBootstrap).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', manifest }));
        expect(JSON.stringify(result.manifest)).not.toContain(registryRoot);
    });

    it('keeps an already portable declaration as a no-op', async () => {
        (planSensorBootstrap as jest.Mock).mockResolvedValue({
            kind: 'noop', projectRoot: tmpDir, manifestPath: path.join(tmpDir, '.awm', 'sensors.json'), changes: [], dryRun: false,
        });

        await expect(initSensors({ cwd: tmpDir })).resolves.toMatchObject({ status: 'already-configured', configured: [] });
        expect(applySensorBootstrap).not.toHaveBeenCalled();
    });

    it('surfaces blocked or migration plans instead of falling back to v2 materialization', async () => {
        (planSensorBootstrap as jest.Mock).mockResolvedValueOnce({
            kind: 'blocked', projectRoot: tmpDir, manifestPath: path.join(tmpDir, '.awm', 'sensors.json'), changes: [], dryRun: false,
            reason: 'source-unavailable', remedy: 'install-registry-or-run-awm-update',
        }).mockResolvedValueOnce({
            kind: 'migrate', projectRoot: tmpDir, manifestPath: path.join(tmpDir, '.awm', 'sensors.json'),
            changes: [{ path: '.awm/sensors.json', action: 'replace' }], dryRun: false, migration: {}, source: {}, originalDigest: 'digest',
        });

        await expect(initSensors({ cwd: tmpDir })).rejects.toThrow('source-unavailable: install-registry-or-run-awm-update');
        await expect(initSensors({ cwd: tmpDir })).rejects.toThrow('does not migrate');
        expect(applySensorBootstrap).not.toHaveBeenCalled();
    });
});

describe('buildManifest project-declared preserve (S3)', () => {
    let tmpDir: string;
    let registryRoot: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-s3-'));
        registryRoot = makeRegistry();
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(registryRoot, { recursive: true, force: true });
    });

    it('preserves an existing source:project entry byte-stable when regenerating pack sensors (RF-3.1)', () => {
        const projectEntry = {
            source: 'project' as const,
            enabled: true,
            fast: true,
            command: { executable: 'terraform', resolution: 'path' as const, args: ['fmt', '-check'] },
            formatter: 'exit-code',
            description: 'keep-me',
        };
        // Collides with a pack default name: per-field merge would otherwise inject pack `cmd`.
        const existing = {
            pack: 'js-ts',
            sensors: {
                typecheck: projectEntry,
            },
        };

        const merged = buildManifest('js-ts', existing as never, registryRoot, tmpDir);

        expect(merged.sensors.typecheck).toEqual(projectEntry);
        expect(merged.sensors.typecheck).not.toHaveProperty('cmd');
    });

    it('writes an only-project manifest without forcing pack:"generic" (RF-3.2)', () => {
        const projectEntry = {
            source: 'project' as const,
            enabled: true,
            command: { executable: 'terraform', resolution: 'path' as const, args: ['fmt', '-check'] },
            formatter: 'exit-code',
        };

        const onlyProject = buildManifest(null as unknown as string, {
            sensors: { 'iac-format': projectEntry },
        } as never, undefined, tmpDir);

        expect(onlyProject).not.toMatchObject({ pack: 'generic' });
        expect(Object.prototype.hasOwnProperty.call(onlyProject, 'pack')).toBe(false);
        expect(onlyProject.sensors['iac-format']).toEqual(projectEntry);
        expect(JSON.stringify(onlyProject)).not.toMatch(/"pack"\s*:/);
    });

    it('preserves source:project entries when materialize regenerates pack sensors (RF-3.1)', () => {
        const { materializePortableSensors } = require('../../../src/commands/sensors/compatibility/materialize');
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-mat-home-'));
        const previousHome = process.env.AWM_HOME;
        try {
            process.env.AWM_HOME = home;
            const packDir = path.join(home, 'registries', 'baseline', 'sensor-packs', 'js-ts');
            fs.mkdirSync(packDir, { recursive: true });
            fs.writeFileSync(path.join(packDir, 'eslint.config.awm.mjs'), 'export default []\n');
            fs.writeFileSync(path.join(packDir, 'pack.json'), JSON.stringify({
                schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
                coverage: { schemaVersion: 1, classes: {} },
                sensors: { lint: { variants: [] } },
            }));
            const projectEntry = {
                source: 'project' as const,
                enabled: true,
                command: { executable: 'terraform', resolution: 'path' as const, args: ['fmt', '-check'] },
                formatter: 'exit-code',
                description: 'preserve-me',
            };
            fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
                schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', source: { registry: 'baseline' },
                sensors: { 'iac-format': projectEntry },
            }));
            const evidence = {
                state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-10',
                toolVersion: '10.0.0', runtimeVersion: process.versions.node, certifiedRange: '>=10 <11', evidence: [],
            };
            const result = materializePortableSensors({
                projectRoot: tmpDir,
                pack: 'js-ts',
                source: {
                    path: path.join(packDir, 'pack.json'),
                    content: fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8'),
                    registry: { name: 'baseline', remote: 'https://example.test/baseline.git', contentRoot: path.join(home, 'registries', 'baseline') },
                },
                configure: false,
                sensors: {
                    lint: {
                        enabled: true, variantId: 'eslint-10',
                        command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                        assets: ['eslint.config.awm.mjs'],
                        initializedCompatibility: evidence,
                    },
                },
            });
            expect(result.manifest.sensors['iac-format']).toEqual(projectEntry);
            expect(JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf8')).sensors['iac-format']).toEqual(projectEntry);
        } finally {
            if (previousHome === undefined) delete process.env.AWM_HOME;
            else process.env.AWM_HOME = previousHome;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
