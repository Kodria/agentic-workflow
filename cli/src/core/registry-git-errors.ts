import { REGISTRY_GIT_TIMEOUT_MS } from './registry-git';
import { cleanText, clipMessage, esc } from './changes/text-safety';

/** Classified failure kinds for registry network git ops (SG-6). */
export type RegistryGitErrorClass =
    | 'authentication'
    | 'tls'
    | 'network'
    | 'ssh'
    | 'not-found'
    | 'timeout';

export type ClassifiedRegistryGitError = {
    class: RegistryGitErrorClass;
    /** Last `fatal:` line from git stderr/message when present; otherwise a short excerpt. */
    fatalLine: string | null;
    /** File-based / config remedy — never ambient GIT_* env values. */
    remedy: string;
};

const REMEDIES: Record<RegistryGitErrorClass, string> = {
    authentication: 'configure credential.helper (awm ignores ambient GIT_ASKPASS)',
    tls: 'git config --global http.sslCAInfo <path> or http.sslCAPath (awm ignores ambient GIT_SSL_*)',
    network: 'check connectivity / proxy via git config --global http.proxy (awm does not pass ambient GIT_* proxy vars)',
    ssh: 'set core.sshCommand or ~/.ssh/config (awm ignores ambient GIT_SSH_COMMAND)',
    'not-found': 'verify the remote URL and that the repository exists and is reachable',
    // simple-git `timeout.block` resets on stdout/stderr activity — idle bound, not wall-clock.
    // Only the plugin's "block timeout reached" is this class (audit M1); git/curl "timed out" → network.
    timeout:
        `check network connectivity; registry git children are killed after ${REGISTRY_GIT_TIMEOUT_MS / 1000}s `
        + 'without stdout/stderr activity',
};

/**
 * Strip credential-bearing userinfo from a remote URL (or URL-shaped substring) before
 * echoing it to operators. HTTPS `user:token@host` / `user@host` → scheme://host… only.
 * Does not JSON-escape or clip — callers run `cleanText`/`clipMessage`/`esc` for echo safety.
 */
export function redactRemoteForDisplay(remote: string): string {
    if (typeof remote !== 'string' || !remote) return '';
    // https://user:pass@host/... or https://user@host/...
    return remote.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1');
}

function errorText(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

/** Extract the last line that looks like git's `fatal: …` diagnostic. */
export function extractFatalLine(text: string): string | null {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/^fatal:/i.test(lines[i]!)) return lines[i]!;
    }
    return null;
}

/**
 * Map a registry git failure to a stable class + file-based remedy (SG-6).
 * Heuristics are substring-based on message/stderr; never includes env values.
 */
export function classifyRegistryGitError(err: unknown): ClassifiedRegistryGitError {
    const message = errorText(err);
    const fatalLine = extractFatalLine(message);

    let errorClass: RegistryGitErrorClass;
    // Audit M1: only simple-git's idle-block plugin text is `timeout`. Git/curl
    // "Connection timed out" / "timed out" are connectivity → `network`.
    if (/block timeout reached/i.test(message)) {
        errorClass = 'timeout';
    } else if (
        /ssl|tls|certificate|unable to get local issuer|certificate verify failed/i.test(message)
    ) {
        errorClass = 'tls';
    } else if (
        // Score repository-shaped not-found BEFORE broad SSH wording — GitHub SSH
        // often pairs "Repository not found" with "Could not read from remote repository".
        /repository not found|remote:\s*.*not found|fatal:\s*repository .+ not found|404\b/i.test(message)
    ) {
        errorClass = 'not-found';
    } else if (
        /host key verification|permission denied \(publickey\)/i.test(message)
    ) {
        errorClass = 'ssh';
    } else if (
        // Remaining SSH transport wording — but DNS/timeout under ssh: belongs to network.
        /\bssh\b/i.test(message)
        && !/could not resolve|name or service not known|timed?\s*out|connection timed out|terminal prompts disabled|authentication failed|could not read username/i.test(message)
    ) {
        errorClass = 'ssh';
    } else if (
        /terminal prompts disabled|authentication failed|could not read username|auth(entication)? (fail|required)|401\b|403\b|invalid credentials/i.test(message)
    ) {
        errorClass = 'authentication';
    } else if (
        /could not resolve host|could not resolve hostname|failed to connect|connection refused|network is unreachable|unable to connect|proxy|name or service not known|timed?\s*out|connection timed out/i.test(message)
    ) {
        errorClass = 'network';
    } else {
        // Default: treat unknown transport failures as network.
        errorClass = 'network';
    }

    const rawFatal = fatalLine ?? (message.trim() ? message.trim().split(/\r?\n/).pop()!.slice(0, 240) : null);
    return {
        class: errorClass,
        fatalLine: rawFatal === null ? null : redactRemoteForDisplay(rawFatal),
        remedy: REMEDIES[errorClass],
    };
}

/**
 * Operator-facing SG-6 line: registry name, remote when known, class, fatal, remedy.
 * Never includes ambient env values or URL userinfo credentials.
 */
export function formatClassifiedRegistryFailure(opts: {
    name: string;
    remote?: string;
    err: unknown;
}): string {
    const classified = classifyRegistryGitError(opts.err);
    const remotePart = opts.remote
        ? `; remote=${clipMessage(cleanText(redactRemoteForDisplay(opts.remote)))}`
        : '';
    const fatalPart = classified.fatalLine
        ? `; fatal: ${clipMessage(cleanText(classified.fatalLine.replace(/^fatal:\s*/i, '')))}`
        : '';
    return (
        `registry ${esc(opts.name)} sync failed (class=${classified.class}${remotePart}${fatalPart}); `
        + `remedy: ${classified.remedy}`
    );
}
