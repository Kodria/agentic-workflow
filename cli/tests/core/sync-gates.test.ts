// cli/tests/core/sync-gates.test.ts
//
// Gate por unidad para verifyMinCliVersions (WS-4).
// Patrón replicado de profile-pins.test.ts: tmpHome aislado, jest.resetModules(), require tardío.
// El exit-1 del handler NO se testea aquí — el gate de pins (B1) estableció el patrón
// de testear la unidad pura; los handlers se testean por integración.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ${cmd}`, { cwd, stdio: 'pipe' });

function makeRegistryWithManifest(base: string, name: string, manifest: Record<string, unknown>): string {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    GIT(dir, 'init -q -b main');
    fs.writeFileSync(path.join(dir, 'awm-registry.json'), JSON.stringify(manifest));
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    return dir;
}

describe('verifyMinCliVersions (gate de awm sync / awm update)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-minCli-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-minCli-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('CLI igual a minCliVersion → sin failures', async () => {
        const source = makeRegistryWithManifest(tmpWork, 'src', { minCliVersion: '2.0.0' });
        const { writeRegistriesConfig, syncRegistries, verifyMinCliVersions } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'baseline', remote: source }]);
        await syncRegistries();
        // Inyectamos la versión actual como igual al mínimo requerido
        expect(verifyMinCliVersions('2.0.0')).toEqual([]);
    });

    it('CLI mayor que minCliVersion → sin failures', async () => {
        const source = makeRegistryWithManifest(tmpWork, 'src', { minCliVersion: '2.0.0' });
        const { writeRegistriesConfig, syncRegistries, verifyMinCliVersions } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'baseline', remote: source }]);
        await syncRegistries();
        expect(verifyMinCliVersions('2.1.0')).toEqual([]);
    });

    it('CLI menor que minCliVersion → 1 failure con name y min', async () => {
        const source = makeRegistryWithManifest(tmpWork, 'src', { minCliVersion: '2.0.0' });
        const { writeRegistriesConfig, syncRegistries, verifyMinCliVersions } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'baseline', remote: source }]);
        await syncRegistries();
        const failures = verifyMinCliVersions('1.0.0');
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ name: 'baseline', min: '2.0.0' });
    });

    it('registry sin minCliVersion → sin failures independientemente de la versión del CLI', async () => {
        const source = makeRegistryWithManifest(tmpWork, 'src', { overrides: [] });
        const { writeRegistriesConfig, syncRegistries, verifyMinCliVersions } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'baseline', remote: source }]);
        await syncRegistries();
        expect(verifyMinCliVersions('0.0.1')).toEqual([]);
    });

    it('múltiples registries: solo el que falla genera un failure', async () => {
        const src1 = makeRegistryWithManifest(tmpWork, 'r1', { minCliVersion: '2.0.0' });
        const src2 = makeRegistryWithManifest(tmpWork, 'r2', { minCliVersion: '1.0.0' });
        const { writeRegistriesConfig, syncRegistries, verifyMinCliVersions } = require('../../src/core/registries');
        writeRegistriesConfig([
            { name: 'alpha', remote: src1 },
            { name: 'beta', remote: src2 },
        ]);
        await syncRegistries();
        // CLI 1.5.0: cumple con beta (>=1.0.0) pero NO con alpha (>=2.0.0)
        const failures = verifyMinCliVersions('1.5.0');
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ name: 'alpha', min: '2.0.0' });
    });
});
