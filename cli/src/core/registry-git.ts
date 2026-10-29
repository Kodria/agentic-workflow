import { simpleGit, type SimpleGit } from 'simple-git';

export type RegistryGit = SimpleGit;

export const REGISTRY_GIT_TIMEOUT_MS = 60_000;

/**
 * Non-`GIT_*` keys that simple-git 4 treats as guarded when supplied via `.env()`.
 * Omit them from the copy so `.env(copy)` does not reject (editor/pager/visual family).
 * Kept in sync with `@simple-git/argv-parser` GitEnvKeys non-prefix entries.
 */
const NON_PREFIX_GUARDED_ENV = new Set(['editor', 'pager', 'prefix', 'ssh_askpass', 'visual']);

/** Copy parent env without guarded GIT_* / editor keys, then force non-interactive prompts. */
export function buildRegistryGitEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(parent)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (lower.startsWith('git_')) continue;
        if (NON_PREFIX_GUARDED_ENV.has(lower)) continue;
        env[key] = value;
    }
    env.GIT_TERMINAL_PROMPT = '0';
    return env;
}

export function listIgnoredGuardedGitEnvNames(parent: NodeJS.ProcessEnv = process.env): string[] {
    return Object.keys(parent)
        .filter((key) => {
            const lower = key.toLowerCase();
            return lower.startsWith('git_') && lower !== 'git_terminal_prompt';
        })
        .sort((a, b) => a.localeCompare(b));
}

/** Operator notice for SG-5 — names only, never values. */
export function formatIgnoredGitEnvNotice(names: string[]): string {
    const listed = names.join(', ');
    return (
        `⚠ Ignoring ambient GIT_* env vars: ${listed}. `
        + 'Use file-based git config instead '
        + '(e.g. git config --global http.sslCAInfo <path>, credential.helper, core.sshCommand / ~/.ssh/config).'
    );
}

let ignoredGitEnvWarned = false;

/** Test seam: clear the once-per-process SG-5 flag. */
export function resetIgnoredGitEnvNoticeForTests(): void {
    ignoredGitEnvWarned = false;
}

/**
 * Before the first network registry git op: warn once listing ignored ambient
 * GIT_* names (except GIT_TERMINAL_PROMPT) and point at file-based remedies (SG-5).
 */
export function warnIgnoredGitEnvOnce(
    log: (message: string) => void = (message) => console.warn(message),
    parent: NodeJS.ProcessEnv = process.env,
): void {
    if (ignoredGitEnvWarned) return;
    const names = listIgnoredGuardedGitEnvNames(parent);
    if (names.length === 0) return;
    ignoredGitEnvWarned = true;
    log(formatIgnoredGitEnvNotice(names));
}

export function createRegistryGit(baseDir?: string): RegistryGit {
    const git = simpleGit({
        ...(baseDir !== undefined ? { baseDir } : {}),
        allowEnvironment: ['GIT_TERMINAL_PROMPT'],
        timeout: { block: 60_000 },
    });
    return git.env(buildRegistryGitEnv());
}
