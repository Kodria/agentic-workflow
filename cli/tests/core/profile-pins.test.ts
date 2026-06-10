// cli/tests/core/profile-pins.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ${cmd}`, { cwd, stdio: 'pipe' });

function makeTaggedRepo(base: string, name: string, versions: string[]): string {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    GIT(dir, 'init -q -b main');
    fs.writeFileSync(path.join(dir, 'VERSION'), 'init');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    for (const v of versions) {
        fs.writeFileSync(path.join(dir, 'VERSION'), v);
        GIT(dir, 'add -A');
        GIT(dir, `commit -qm ${v}`);
        GIT(dir, `tag v${v}`);
    }
    return dir;
}

function addRelease(source: string, version: string): void {
    fs.writeFileSync(path.join(source, 'VERSION'), version);
    GIT(source, 'add -A');
    GIT(source, `commit -qm ${version}`);
    GIT(source, `tag v${version}`);
}

describe('verifyProjectPins (gate de awm sync)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pins-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pins-work-'));
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

    it('match: máquina en la versión pineada → sin failures', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' }); // queda en v1.0.0
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([]);
    });

    it('mismatch: la máquina avanzó más allá del pin → failure con actual y required', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' });
        addRelease(source, '1.1.0');
        await syncRegistry(source, { channel: 'stable' }); // máquina avanza a v1.1.0

        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([
            { name: 'base', required: '1.0.0', actual: '1.1.0', reason: 'mismatch' },
        ]);
    });

    it('registry pineado no configurado en la máquina → missing-registry', async () => {
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ equipo: '2.0.0' })).toEqual([
            { name: 'equipo', required: '2.0.0', actual: null, reason: 'missing-registry' },
        ]);
    });

    it('máquina siguiendo HEAD (sin tag) con pin declarado → mismatch con actual null', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', []);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' }); // head-fallback
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([
            { name: 'base', required: '1.0.0', actual: null, reason: 'mismatch' },
        ]);
    });

    it('CRITERIO ROADMAP end-to-end: pineado no recibe main hasta bump; rollback funciona', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        const versionFile = path.join(tmpHome, '.awm/cli-source/VERSION');

        // proyecto pineado a 1.0.0, máquina en 1.0.0 → ok
        await syncRegistry(source, { channel: 'stable' });
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([]);

        // el remote avanza (release 1.1.0) y la máquina updatea → el proyecto pineado FALLA (no recibe el cambio en silencio)
        addRelease(source, '1.1.0');
        await syncRegistry(source, { channel: 'stable' });
        expect(fs.readFileSync(versionFile, 'utf-8')).toBe('1.1.0');
        expect((await verifyProjectPins({ base: '1.0.0' }))[0]?.reason).toBe('mismatch');

        // bump explícito del profile → pasa
        expect(await verifyProjectPins({ base: '1.1.0' })).toEqual([]);

        // rollback: pin de máquina a 1.0.0 → contenido vuelve y el proyecto pineado a 1.0.0 pasa
        await syncRegistry(source, { pin: '1.0.0', channel: 'stable' });
        expect(fs.readFileSync(versionFile, 'utf-8')).toBe('1.0.0');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([]);
    });
});
