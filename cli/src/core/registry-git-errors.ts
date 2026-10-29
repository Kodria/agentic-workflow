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
    timeout: 'check network connectivity; registry git operations time out after 60s',
};

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
    if (
        /timed?\s*out|timeout|block timeout/i.test(message)
    ) {
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
        /host key verification|permission denied \(publickey\)|\bssh\b/i.test(message)
        && !/terminal prompts disabled|authentication failed|could not read username/i.test(message)
    ) {
        errorClass = 'ssh';
    } else if (
        /terminal prompts disabled|authentication failed|could not read username|auth(entication)? (fail|required)|401\b|403\b|invalid credentials/i.test(message)
    ) {
        errorClass = 'authentication';
    } else if (
        /could not resolve host|failed to connect|connection refused|network is unreachable|unable to connect|proxy|name or service not known/i.test(message)
    ) {
        errorClass = 'network';
    } else {
        // Default: treat unknown transport failures as network.
        errorClass = 'network';
    }

    return {
        class: errorClass,
        fatalLine: fatalLine ?? (message.trim() ? message.trim().split(/\r?\n/).pop()!.slice(0, 240) : null),
        remedy: REMEDIES[errorClass],
    };
}

/**
 * Operator-facing SG-6 line: registry name, remote when known, class, fatal, remedy.
 * Never includes ambient env values.
 */
export function formatClassifiedRegistryFailure(opts: {
    name: string;
    remote?: string;
    err: unknown;
}): string {
    const classified = classifyRegistryGitError(opts.err);
    const remotePart = opts.remote ? `; remote=${opts.remote}` : '';
    const fatalPart = classified.fatalLine
        ? `; fatal: ${classified.fatalLine.replace(/^fatal:\s*/i, '')}`
        : '';
    return (
        `registry ${opts.name} sync failed (class=${classified.class}${remotePart}${fatalPart}); `
        + `remedy: ${classified.remedy}`
    );
}
