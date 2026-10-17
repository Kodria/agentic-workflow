import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Git's identity and config isolation travel in an explicit environment object for the helper's own git calls.
// HOME, AWM_HOME and the git config variables are also overridden on `process.env` (and restored), so that code under
// test (which hands process.env to git) can never reach the real `~/.awm` or the developer's / system git config.
const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];

export interface TestRepo {
    /** Repository root, resolved through realpathSync.native. */
    root: string;
    /** The throwaway HOME directory (also a convenient parent for a directory that is not a repository). */
    home: string;
    git: (...args: string[]) => string;
    commit: (files: Record<string, string>, message: string) => string;
    cleanup: () => void;
}

/** Isolated repo: HOME/AWM_HOME point at a tmpdir; never touches the real ~/.awm. */
export function makeRepo(): TestRepo {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-')));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' });
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-chg-')));
    const env = {
        ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    };
    const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env }).trim();
    const commit = (files: Record<string, string>, message: string): string => {
        for (const [rel, content] of Object.entries(files)) {
            const abs = path.join(root, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
        git('add', '-A');
        git('commit', '-q', '-m', message);
        return git('rev-parse', 'HEAD');
    };
    const cleanup = () => {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    };
    try {
        git('init', '-q', '-b', 'main');
        commit({ '.gitignore': '.awm/\n', 'README.md': 'x' }, 'chore: init');
    } catch (error) {
        cleanup();
        throw error;
    }
    return { root, home, git, commit, cleanup };
}

/**
 * Wall-clock bound for the linear-time tests. A quadratic regression on the hostile inputs takes tens of seconds, so a
 * generous bound still catches it, while several git spawns on a slow Windows/macOS runner stay far below it.
 */
export const LINEAR_TIME_BOUND_MS = 5000;

/** Casts a deliberately wrong value to whatever the function under test declares. */
export const bad = (v: unknown) => v as never;

/** Sets variables on process.env (the environment runGit hands to git) for the duration of `fn`. */
export function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

/** Checks out `feat/x` and returns the commit it forked from (main). */
export function branchOff(repo: TestRepo): string {
    repo.git('checkout', '-q', '-b', 'feat/x');
    return repo.git('rev-parse', 'main');
}

/** A directory that is not a git repository. */
export const nonRepoDir = (repo: TestRepo): string => fs.mkdtempSync(path.join(repo.home, 'plain-'));

/** A commit carrying a forged `gpgsig` header, written straight into the object store (no gpg needed). */
export function commitForgedSigned(repo: TestRepo, message: string, file = 'signed.ts'): string {
    fs.writeFileSync(path.join(repo.root, file), '1');
    repo.git('add', '-A');
    const body = [`tree ${repo.git('write-tree')}`, `parent ${repo.git('rev-parse', 'HEAD')}`, 'author t <t@t> 1700000000 +0000', 'committer t <t@t> 1700000000 +0000',
        'gpgsig -----BEGIN PGP SIGNATURE-----', ' ', ' forged', ' -----END PGP SIGNATURE-----', '', message, ''].join('\n');
    const bodyFile = path.join(repo.home, 'forged-commit.txt');
    fs.writeFileSync(bodyFile, body);
    const sha = repo.git('hash-object', '-t', 'commit', '-w', bodyFile);
    repo.git('reset', '-q', '--hard', sha);
    return sha;
}

/** Repo-local config (the helper only isolates the global one): git prints verification text before each signed commit. */
export function showSignaturesInLog(repo: TestRepo): void {
    repo.git('config', 'log.showSignature', 'true');
    repo.git('config', 'gpg.program', process.execPath); // any program that writes to stderr; the output is what matters, not a real gpg
}
