import fs from 'fs';
import os from 'os';
import path from 'path';

const projectModule = '../../../src/commands/sensors/project';

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensor-project-'));
}

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
}

function v3Manifest(packageRoot?: string): Record<string, unknown> {
    return {
        schemaVersion: 3,
        mode: 'project-sensors',
        pack: 'js-ts',
        source: { registry: 'baseline' },
        ...(packageRoot ? { packageRoot } : {}),
        sensors: {},
    };
}

describe('sensor project authority', () => {
    const roots: string[] = [];
    afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

    function resolve(startCwd: string): any {
        return require(projectModule).resolveSensorProject(startCwd);
    }

    it('selects the nearest regular manifest without crossing the Git boundary', () => {
        const root = tempDir(); roots.push(root);
        fs.mkdirSync(path.join(root, '.git'));
        writeJson(path.join(root, '.awm/sensors.json'), v3Manifest());
        writeJson(path.join(root, 'packages/app/.awm/sensors.json'), v3Manifest());
        fs.mkdirSync(path.join(root, 'packages/app/src'), { recursive: true });
        const result = resolve(path.join(root, 'packages/app/src'));
        expect(result).toMatchObject({ state: 'configured', projectRoot: path.join(root, 'packages/app'), manifestPath: path.join(root, 'packages/app/.awm/sensors.json') });
    });

    it('treats a .git file as a worktree boundary and rejects an escaping packageRoot', () => {
        const root = tempDir(); roots.push(root);
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere');
        writeJson(path.join(root, '.awm/sensors.json'), v3Manifest('../outside'));
        fs.mkdirSync(path.join(root, 'cli/src'), { recursive: true });
        expect(resolve(path.join(root, 'cli/src'))).toMatchObject({ state: 'invalid', projectRoot: root });
    });

    it('inspects only the exact CWD outside Git and returns missing for absent or malformed manifests', () => {
        const parent = tempDir(); roots.push(parent);
        writeJson(path.join(parent, '.awm/sensors.json'), v3Manifest());
        const cwd = path.join(parent, 'child'); fs.mkdirSync(cwd);
        expect(resolve(cwd)).toMatchObject({ state: 'missing', projectRoot: cwd });
        fs.mkdirSync(path.join(cwd, '.awm'));
        fs.writeFileSync(path.join(cwd, '.awm/sensors.json'), '{bad json');
        expect(resolve(cwd)).toMatchObject({ state: 'invalid', projectRoot: cwd });
    });

    it('rejects a symlinked manifest and a packageRoot that is not a directory', () => {
        const root = tempDir(); roots.push(root);
        fs.mkdirSync(path.join(root, '.git'));
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        writeJson(path.join(root, 'elsewhere.json'), v3Manifest());
        fs.symlinkSync(path.join(root, 'elsewhere.json'), path.join(root, '.awm/sensors.json'));
        expect(resolve(root)).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/regular file/) });
        fs.unlinkSync(path.join(root, '.awm/sensors.json'));
        fs.symlinkSync(path.join(root, 'missing.json'), path.join(root, '.awm/sensors.json'));
        expect(resolve(root)).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/regular file/) });
        fs.unlinkSync(path.join(root, '.awm/sensors.json'));
        writeJson(path.join(root, '.awm/sensors.json'), v3Manifest('not-a-directory'));
        fs.writeFileSync(path.join(root, 'not-a-directory'), 'file');
        expect(resolve(root)).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/existing directory/) });
        writeJson(path.join(root, '.awm/sensors.json'), v3Manifest('missing-directory'));
        expect(resolve(root)).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/existing directory/) });
    });

    it('rejects invalid UTF-8 and packageRoot symlinks escaping the manifest directory', () => {
        const root = tempDir(); roots.push(root);
        fs.mkdirSync(path.join(root, '.git'));
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(path.join(root, '.awm/sensors.json'), Buffer.from([0xff, 0xfe]));
        expect(resolve(root)).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/UTF-8/) });
        writeJson(path.join(root, '.awm/sensors.json'), v3Manifest('linked-package'));
        const outside = tempDir(); roots.push(outside);
        fs.symlinkSync(outside, path.join(root, 'linked-package'));
        expect(resolve(root)).toMatchObject({ state: 'invalid', reason: expect.stringMatching(/escapes/) });
    });

    it('never selects a parent manifest above the Git boundary', () => {
        const parent = tempDir(); roots.push(parent);
        writeJson(path.join(parent, '.awm/sensors.json'), v3Manifest());
        const root = path.join(parent, 'repository');
        fs.mkdirSync(path.join(root, '.git'), { recursive: true });
        expect(resolve(root)).toMatchObject({ state: 'missing', projectRoot: root });
    });
});
