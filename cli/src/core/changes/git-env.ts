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
 * Makes git fail on a missing object (partial clone) instead of fetching it from the promisor remote. Needs git 2.43 or newer:
 * an older git ignores the variable and keeps its previous behaviour (it fetches the object), so the read-only guarantee for
 * partial clones is only given from 2.43 on.
 */
const NO_LAZY_FETCH = 'GIT_NO_LAZY_FETCH';

/** The environment every git child of the change-record code runs in: pathspec variables removed, lazy fetching off. */
export function gitChildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (PATHSPEC_ENV.has(name.toUpperCase())) delete env[name];
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

/** The one place the options of every git child are built: no shell, utf8, stdin closed, bounded time, scrubbed environment. */
export function gitSpawnOptions(cwd: string, extras: GitSpawnExtras = {}) {
    return {
        cwd,
        encoding: 'utf8' as const,
        stdio: ['ignore', 'pipe', extras.stderr ?? 'pipe'] as ['ignore', 'pipe', 'pipe' | 'ignore'],
        timeout: GIT_TIMEOUT_MS,
        env: gitChildEnv(),
        ...(extras.maxBuffer === undefined ? {} : { maxBuffer: extras.maxBuffer }),
    };
}

/**
 * Runs `git args` in `cwd` with gitSpawnOptions and returns its stdout. The one execFileSync of the change-record code: the
 * stdio option is spelled out at the call (never left to Node's default relay of the child's stderr onto ours), as
 * tests/structural/exec-invocation-explicit-stdio.test.ts requires. Throws like execFileSync does.
 */
export function execGit(cwd: string, args: string[], extras: GitSpawnExtras = {}): string {
    const options = gitSpawnOptions(cwd, extras);
    return execFileSync('git', args, { ...options, stdio: options.stdio });
}
