import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/** Identidad de commit local al tmpdir del fixture — jamas toca ~/.gitconfig
 *  ni ninguna config global (CLAUDE.md: `~/.awm` y el entorno real del dueño
 *  son territorio prohibido para sesiones de desarrollo/tests). */
const git = (repo: string, args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: repo, encoding: 'utf8' });

/** Crea un repo git aislado en un tmpdir propio. El caller es responsable de
 *  `fs.rmSync(repo, { recursive: true, force: true })` en su `afterEach`. */
export function initRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-git-fixture-'));
    // `-b main` fija el nombre de la rama inicial explicitamente: sin esto el
    // default depende de `init.defaultBranch` (global, no tocable desde aca
    // per CLAUDE.md) y varia entre instalaciones de git (master vs main).
    git(repo, ['init', '-q', '-b', 'main']);
    return repo;
}

/** Escribe `name` con `content`, lo commitea y devuelve el SHA resultante. */
export function commitFile(repo: string, name: string, content: string): string {
    fs.writeFileSync(path.join(repo, name), content);
    git(repo, ['add', '--', name]);
    git(repo, ['commit', '-qm', `add ${name}`]);
    return git(repo, ['rev-parse', 'HEAD']).trim();
}
