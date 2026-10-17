import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Jest gives each test file a copy of `process.env` that child processes never see, so git's identity, config
// isolation and dates travel in an explicit environment object. HOME/AWM_HOME are still overridden on `process.env`
// (and restored) so that no code under test can reach the real `~/.awm`.
const ENV_KEYS = ['HOME', 'AWM_HOME'];

export interface TestRepo {
    /** Repository root, resolved through realpathSync.native. */
    root: string;
    /** The throwaway HOME directory (also a convenient parent for a directory that is not a repository). */
    home: string;
    git: (...args: string[]) => string;
    commit: (files: Record<string, string>, message: string, date?: string) => string;
    cleanup: () => void;
}

/** Isolated repo: HOME/AWM_HOME point at a tmpdir; never touches the real ~/.awm. */
export function makeRepo(): TestRepo {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-')));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm') });
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-chg-')));
    const env = (extra: Record<string, string> = {}) => ({
        ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...extra,
    });
    const run = (args: string[], extra?: Record<string, string>) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: env(extra) }).trim();
    const git = (...args: string[]) => run(args);
    const commit = (files: Record<string, string>, message: string, date?: string): string => {
        for (const [rel, content] of Object.entries(files)) {
            const abs = path.join(root, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
        git('add', '-A');
        run(['commit', '-q', '-m', message], date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : undefined);
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
