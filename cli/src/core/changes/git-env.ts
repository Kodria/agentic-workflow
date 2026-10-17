// Leaf module: how every git child of the change-record code is spawned. No sibling imports.

export const GIT_TIMEOUT_MS = 15000;

/**
 * Variables that change how pathspecs are read (`:/`, `:(exclude)` ...) and so the meaning of every range/count/status we ask
 * for: literal/glob/noglob/icase would turn a plain exclusion into a literal name, a glob or a case-insensitive match. They are
 * removed from the child's environment, matched case-insensitively (Windows environment names are case-insensitive, and a
 * plain-object copy of process.env is not); everything else (GIT_CONFIG_*, GIT_AUTHOR_*, HOME ...) is passed through untouched.
 */
const PATHSPEC_ENV = new Set(['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS']);

/** The environment every git child of the change-record code runs in. */
export function gitChildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (PATHSPEC_ENV.has(name.toUpperCase())) delete env[name];
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
