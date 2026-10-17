import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess, { execFileSync } from 'child_process';

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
    /** Writes `files`, commits them and returns the new HEAD. `date` (an ISO instant) becomes the author and committer date; omitted, git uses the clock. */
    commit: (files: Record<string, string>, message: string, date?: string) => string;
    /** Runs git with the author and committer date set to `date` (an ISO instant): merges and annotated tags carry a date too. */
    gitAt: (date: string, ...args: string[]) => string;
    cleanup: () => void;
}

/** The git runner of a repository: identity and config isolation in an explicit environment, optional explicit dates. */
function gitApi(root: string, home: string): Pick<TestRepo, 'git' | 'gitAt' | 'commit'> {
    const env = {
        ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    };
    const run = (extra: Record<string, string>, args: string[]) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: { ...env, ...extra } }).trim();
    const dates = (date: string): Record<string, string> => {
        const stamp = `${Math.floor(Date.parse(date) / 1000)} +0000`;
        return { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
    };
    const git = (...args: string[]) => run({}, args);
    const gitAt = (date: string, ...args: string[]) => run(dates(date), args);
    const commit = (files: Record<string, string>, message: string, date?: string): string => {
        for (const [rel, content] of Object.entries(files)) {
            const abs = path.join(root, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
        git('add', '-A');
        run(date === undefined ? {} : dates(date), ['commit', '-q', '-m', message]);
        return git('rev-parse', 'HEAD');
    };
    return { git, gitAt, commit };
}

/** Isolated repo: HOME/AWM_HOME point at a tmpdir; never touches the real ~/.awm. */
export function makeRepo(): TestRepo {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-')));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' });
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-chg-')));
    const { git, gitAt, commit } = gitApi(root, home);
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
    return { root, home, git, gitAt, commit, cleanup };
}

/** The version of the installed git as [major, minor], or null when it cannot be read. */
export function gitVersion(): [number, number] | null {
    try {
        const m = /^git version (\d+)\.(\d+)/.exec(execFileSync('git', ['--version'], { encoding: 'utf8' }));
        return m ? [Number(m[1]), Number(m[2])] : null;
    } catch {
        return null;
    }
}

/** True when the installed git is `major.minor` or newer (false when its version cannot be read). */
export function gitAtLeast(major: number, minor: number): boolean {
    const v = gitVersion();
    return v !== null && (v[0] > major || (v[0] === major && v[1] >= minor));
}

/** `test` where symlinks and POSIX modes exist; reported as skipped (not as passed) on Windows. */
export const posixOnly: typeof test = process.platform === 'win32' ? (test.skip as typeof test) : test;

/**
 * A copy of `template` in its own directory (same throwaway home, same git isolation): a few milliseconds instead of the
 * several git processes `makeRepo` spawns. For suites that need a fresh repository per test. `cleanup` removes only the copy;
 * the template's `cleanup` removes the shared home and restores the environment.
 */
export function cloneRepo(template: TestRepo): TestRepo {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-chg-')));
    fs.cpSync(template.root, root, { recursive: true });
    const { git, gitAt, commit } = gitApi(root, template.home);
    return { root, home: template.home, git, gitAt, commit, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/**
 * Wall-clock bound for the linear-time tests. A quadratic regression on the hostile inputs takes tens of seconds, so a
 * generous bound still catches it, while several git spawns on a slow Windows/macOS runner stay far below it.
 */
export const LINEAR_TIME_BOUND_MS = 5000;

/** Casts a deliberately wrong value to whatever the function under test declares. */
export const bad = (v: unknown) => v as never;

/**
 * Spies on every git child the code under test spawns (`child_process.execFileSync`): records each argv in `calls` and then runs
 * the real git, unless `intercept` throws (to simulate a failing or timed-out git). Undo with `restore()` (or `jest.restoreAllMocks`).
 */
export function spyOnGit(intercept?: (args: string[]) => void): { calls: string[][]; restore: () => void } {
    const calls: string[][] = [];
    const real = childProcess.execFileSync as (...a: unknown[]) => unknown;
    const spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args: string[], opts: unknown) => {
        if (cmd === 'git') calls.push(args);
        intercept?.(args);
        return real(cmd, args, opts);
    }) as never);
    return { calls, restore: () => spy.mockRestore() };
}

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

/** Runs git in `cwd` and returns trimmed stdout (the caller decides on identity and config isolation). */
export type GitRunner = (cwd: string, ...args: string[]) => string;

/**
 * Offline fixture: a nested repository at `relPath` registered as a gitlink of the repository at `root`, hidden by
 * `.gitmodules` `ignore = all` and the repo-local `diff.ignoreSubmodules=all`, then committed. Returns helpers to run git
 * inside it and to commit there (which moves the checkout away from the recorded gitlink).
 */
export function makeHiddenSubmodule(root: string, run: GitRunner, relPath = 'vendor/sm') {
    const dir = path.join(root, ...relPath.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const inSm = (...args: string[]) => run(dir, ...args);
    const commitInSm = (name: string): string => { fs.writeFileSync(path.join(dir, name), name); inSm('add', '-A'); inSm('commit', '-q', '-m', `feat: ${name}`); return inSm('rev-parse', 'HEAD'); };
    inSm('init', '-q', '-b', 'main');
    const first = commitInSm('one');
    fs.writeFileSync(path.join(root, '.gitmodules'), `[submodule "${relPath}"]\n\tpath = ${relPath}\n\turl = ./nowhere\n\tignore = all\n`);
    run(root, 'config', 'diff.ignoreSubmodules', 'all');
    run(root, 'add', '.gitmodules');
    run(root, 'update-index', '--add', '--cacheinfo', `160000,${first},${relPath}`);
    run(root, 'commit', '-q', '-m', 'chore: add submodule');
    return { dir, inSm, commitInSm };
}
