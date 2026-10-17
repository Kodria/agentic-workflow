// Leaf module: how every git child of the change-record code is spawned. No sibling imports.

import { execFileSync } from 'child_process';

export const GIT_TIMEOUT_MS = 15000;

/**
 * Variables that change how pathspecs are read (`:/`, `:(exclude)` ...) and so the meaning of every range/count/status we ask
 * for: literal/glob/noglob/icase would turn a plain exclusion into a literal name, a glob or a case-insensitive match. They are
 * removed from the child's environment, matched case-insensitively (Windows environment names are case-insensitive, and a
 * plain-object copy of process.env is not); everything else (GIT_CONFIG_*, GIT_AUTHOR_*, HOME ...) is passed through untouched.
 */
const PATHSPEC_ENV = new Set(['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS']);

/**
 * Variables that relocate the repository, its index or its object store: inherited ones would make git answer for a different
 * repository than the `cwd` we pass (a fail-open). The same set read-only-observation.ts removes for its own git children.
 */
const LOCATION_ENV = new Set([
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX',
]);

/**
 * Makes git fail on a missing object (partial clone) instead of fetching it from the promisor remote. Needs git 2.43 or newer:
 * an older git ignores the variable and keeps its previous behaviour (it fetches the object), so the read-only guarantee for
 * partial clones is only given from 2.43 on.
 */
const NO_LAZY_FETCH = 'GIT_NO_LAZY_FETCH';

/** The environment every git child of the change-record code runs in: pathspec and repository-location variables removed, lazy fetching off. */
export function gitChildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (PATHSPEC_ENV.has(name.toUpperCase()) || LOCATION_ENV.has(name.toUpperCase())) delete env[name];
    // A partial clone would otherwise fetch a missing object from its promisor remote the moment a read needs it: that writes
    // the object database and uses the network. Reading must stay read-only, so a missing object is a plain failure instead.
    // (Windows environment names are case-insensitive: drop any other spelling first.)
    for (const name of Object.keys(env)) if (name.toUpperCase() === NO_LAZY_FETCH) delete env[name];
    env[NO_LAZY_FETCH] = '1';
    return env;
}

export interface GitSpawnExtras {
    /** Output limit in bytes; Node's default when omitted. */
    maxBuffer?: number;
    /** `pipe` (default) keeps stderr for the caller's error handling; `ignore` discards it. */
    stderr?: 'pipe' | 'ignore';
}

/** The options of every git child except `stdio` (execGit spells that out): no shell, utf8, bounded time, scrubbed environment. */
export function gitSpawnOptions(cwd: string, extras: GitSpawnExtras = {}) {
    return {
        cwd,
        encoding: 'utf8' as const,
        timeout: GIT_TIMEOUT_MS,
        env: gitChildEnv(),
        ...(extras.maxBuffer === undefined ? {} : { maxBuffer: extras.maxBuffer }),
    };
}

/**
 * Runs `git args` in `cwd` with gitSpawnOptions and returns its stdout. The one execFileSync of the change-record code, with the
 * stdio option spelled out at the call (stdin closed, stdout piped, stderr as asked; never Node's default relay of the child's
 * stderr onto ours), as tests/structural/exec-invocation-explicit-stdio.test.ts requires. Throws like execFileSync does.
 */
export function execGit(cwd: string, args: string[], extras: GitSpawnExtras = {}): string {
    return execFileSync('git', args, { ...gitSpawnOptions(cwd, extras), stdio: ['ignore', 'pipe', extras.stderr ?? 'pipe'] });
}

/** Like execGit, but returns the raw bytes of stdout (no decoding): for content that must be checked as UTF-8 strictly. */
export function execGitBytes(cwd: string, args: string[], extras: GitSpawnExtras = {}): Buffer {
    return execFileSync('git', args, { ...gitSpawnOptions(cwd, extras), encoding: 'buffer' as const, stdio: ['ignore', 'pipe', extras.stderr ?? 'pipe'] });
}
