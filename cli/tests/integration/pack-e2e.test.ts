// cli/tests/integration/pack-e2e.test.ts
//
// Verifica el criterio del roadmap sin publicar: el tarball de npm pack corre
// `awm update` end-to-end contra un registry fixture, sin el monorepo.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ${cmd}`, { cwd, stdio: 'pipe' });

jest.setTimeout(180_000);

it('el tarball empaquetado corre awm update sin el monorepo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-'));
    const cliDir = path.resolve(__dirname, '../..');
    try {
        execSync(`npm pack --pack-destination "${tmp}"`, { cwd: cliDir, stdio: 'pipe' });
        const tarball = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))!;
        execSync(`tar -xzf "${tarball}"`, { cwd: tmp });
        const pkgDir = path.join(tmp, 'package');

        // files whitelist: dist viaja, src no
        expect(fs.existsSync(path.join(pkgDir, 'dist/src/index.js'))).toBe(true);
        expect(fs.existsSync(path.join(pkgDir, 'src'))).toBe(false);

        // deps sin red: el node_modules del repo sirve al binario extraído
        fs.symlinkSync(path.join(cliDir, 'node_modules'), path.join(pkgDir, 'node_modules'));

        // registry fixture con un skill y tag v1.0.0
        const source = path.join(tmp, 'src-reg');
        fs.mkdirSync(path.join(source, 'skills/alpha'), { recursive: true });
        fs.writeFileSync(path.join(source, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: t\n---\n');
        GIT(source, 'init -q'); GIT(source, 'add -A'); GIT(source, 'commit -qm init'); GIT(source, 'tag v1.0.0');

        const home = path.join(tmp, 'home');
        const awmHome = path.join(home, '.awm');
        fs.mkdirSync(awmHome, { recursive: true });
        fs.writeFileSync(path.join(awmHome, 'registries.json'),
            JSON.stringify([{ name: 'baseline', remote: source }]));

        execSync(`node "${path.join(pkgDir, 'dist/src/index.js')}" update`, {
            env: { ...process.env, HOME: home, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
            stdio: 'pipe',
        });

        expect(fs.existsSync(path.join(awmHome, 'registries/baseline/skills/alpha/SKILL.md'))).toBe(true);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
