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
