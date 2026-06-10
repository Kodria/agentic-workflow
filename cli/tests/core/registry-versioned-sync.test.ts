// cli/tests/core/registry-versioned-sync.test.ts
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

describe('syncRegistry versionado (fixtures git locales)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regver-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regver-work-'));
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

    const registryVersionFile = () => path.join(process.env.AWM_HOME!, 'cli-source/VERSION');

    it('clone fresco queda checkouteado en el último tag (no en HEAD)', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        // commit post-tag: HEAD del remote va más allá del último release
        fs.writeFileSync(path.join(source, 'VERSION'), 'unreleased');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm unreleased');

        const { syncRegistry } = require('../../src/core/registry');
        const resolved = await syncRegistry(source, { channel: 'stable' });

        expect(resolved).toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.0.0');
    });

    it('clone existente transiciona al tag nuevo tras un release en el remote', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' });

        addRelease(source, '1.1.0');
        const resolved = await syncRegistry(source, { channel: 'stable' });

        expect(resolved).toEqual({ kind: 'tag', ref: 'v1.1.0', version: '1.1.0' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.1.0');
    });

    it('rollback: pin a un tag anterior vuelve el contenido a esa versión', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0', '1.1.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.1.0');

        const resolved = await syncRegistry(source, { pin: '1.0.0', channel: 'stable' });

        expect(resolved).toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.0.0');
    });

    it('canal dev sigue HEAD del branch y recibe commits nuevos', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const first = await syncRegistry(source, { channel: 'dev' });
        expect(first).toEqual({ kind: 'head', ref: 'main' });

        fs.writeFileSync(path.join(source, 'VERSION'), 'head-2');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm head-2');
        await syncRegistry(source, { channel: 'dev' });

        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('head-2');
    });

    it('repo sin tags en canal stable → head-fallback y sigue HEAD', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', []);
        const { syncRegistry } = require('../../src/core/registry');
        const resolved = await syncRegistry(source, { channel: 'stable' });

        expect(resolved).toEqual({ kind: 'head-fallback', ref: 'main' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('init');
    });

    it('C2 regression: clone fresco limpiado si pin inexistente falla post-clone', async () => {
        // Si el clone se completa pero resolveTargetRef falla (pin no existe),
        // REGISTRY_DIR debe limpiarse para no quedar en estado inconsistente.
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const { REGISTRY_DIR } = require('../../src/core/registry');

        await expect(
            syncRegistry(source, { pin: '9.9.9', channel: 'stable' })
        ).rejects.toThrow();
        expect(fs.existsSync(REGISTRY_DIR)).toBe(false);
    });

    it('sin opts (callers legacy) → comportamiento stable por default', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['2.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const resolved = await syncRegistry(source);
        expect(resolved).toEqual({ kind: 'tag', ref: 'v2.0.0', version: '2.0.0' });
    });
});
