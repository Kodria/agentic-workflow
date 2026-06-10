// cli/tests/core/versioning.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ${cmd}`, { cwd, stdio: 'pipe' });

/** Repo fuente con un commit inicial y un commit+tag por cada versión dada (en orden). */
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

function cloneOf(source: string, base: string, name: string): string {
    const dir = path.join(base, name);
    GIT(base, `clone -q ${source} ${name}`);
    return dir;
}

describe('versioning core', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ver-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ver-work-'));
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

    describe('resolveTargetRef', () => {
        it('stable sin pin → último tag con orden semver numérico (v1.10.0 > v1.9.0)', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.9.0', '1.10.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'tag', ref: 'v1.10.0', version: '1.10.0' });
        });

        it('pin exacto gana, con y sin prefijo v', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0', '1.1.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            expect(await resolveTargetRef(clone, { pin: '1.0.0', channel: 'stable' }))
                .toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
            expect(await resolveTargetRef(clone, { pin: 'v1.0.0', channel: 'stable' }))
                .toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        });

        it('pin inexistente → error que lista las versiones disponibles', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            await expect(resolveTargetRef(clone, { pin: '9.9.9', channel: 'stable' }))
                .rejects.toThrow(/v9\.9\.9.*v1\.0\.0/s);
        });

        it('sin tags + stable → head-fallback al default branch', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', []);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'head-fallback', ref: 'main' });
        });

        it('canal dev → head del default branch aunque haya tags', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'dev' });
            expect(r).toEqual({ kind: 'head', ref: 'main' });
        });

        it('tags no semver se ignoran', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            GIT(source, 'tag latest');
            GIT(source, 'tag v2.0');
            GIT(source, 'tag release-3.0.0');
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        });

        it('hace fetch: ve tags creados en el remote después del clone', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            // tag nuevo en el remote, post-clone
            fs.writeFileSync(path.join(source, 'VERSION'), '1.1.0');
            GIT(source, 'add -A');
            GIT(source, 'commit -qm 1.1.0');
            GIT(source, 'tag v1.1.0');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'tag', ref: 'v1.1.0', version: '1.1.0' });
        });
    });

    describe('currentVersion', () => {
        it('en checkout exacto de un tag semver → versión sin prefijo v', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.2.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            GIT(clone, 'checkout -q v1.2.0');
            const { currentVersion } = require('../../src/core/versioning');
            expect(await currentVersion(clone)).toBe('1.2.0');
        });

        it('siguiendo un branch (sin tag exacto en HEAD) → null', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            // commit posterior al tag para que HEAD no coincida con ningún tag
            fs.writeFileSync(path.join(source, 'VERSION'), 'post');
            GIT(source, 'add -A');
            GIT(source, 'commit -qm post');
            const clone = cloneOf(source, tmpWork, 'clone');
            const { currentVersion } = require('../../src/core/versioning');
            expect(await currentVersion(clone)).toBeNull();
        });

        it('tag exacto pero no semver → null', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', []);
            GIT(source, 'tag release-1');
            const clone = cloneOf(source, tmpWork, 'clone');
            GIT(clone, 'checkout -q release-1');
            const { currentVersion } = require('../../src/core/versioning');
            expect(await currentVersion(clone)).toBeNull();
        });
    });

    describe('machineVersionOpts', () => {
        it('sin preferences → channel stable, sin pin', () => {
            const { machineVersionOpts } = require('../../src/core/versioning');
            expect(machineVersionOpts('base')).toEqual({ pin: undefined, channel: 'stable' });
        });

        it('lee channel dev y pin por nombre desde preferences', () => {
            const awmDir = path.join(tmpHome, '.awm');
            fs.mkdirSync(awmDir, { recursive: true });
            fs.writeFileSync(
                path.join(awmDir, 'preferences.json'),
                JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', channel: 'dev', pins: { base: '1.2.0', equipo: '0.3.0' } })
            );
            const { machineVersionOpts } = require('../../src/core/versioning');
            expect(machineVersionOpts('base')).toEqual({ pin: '1.2.0', channel: 'dev' });
            expect(machineVersionOpts('equipo')).toEqual({ pin: '0.3.0', channel: 'dev' });
            expect(machineVersionOpts('otro')).toEqual({ pin: undefined, channel: 'dev' });
        });

        it('preferences corruptas → defaults (stable, sin pin)', () => {
            const awmDir = path.join(tmpHome, '.awm');
            fs.mkdirSync(awmDir, { recursive: true });
            fs.writeFileSync(path.join(awmDir, 'preferences.json'), '{not json');
            const { machineVersionOpts } = require('../../src/core/versioning');
            expect(machineVersionOpts('base')).toEqual({ pin: undefined, channel: 'stable' });
        });
    });
});
