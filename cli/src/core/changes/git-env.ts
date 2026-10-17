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
