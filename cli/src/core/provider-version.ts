import {
    execFileSync,
    type ExecFileSyncOptionsWithStringEncoding,
} from 'child_process';
import { AgentTarget, providerFor } from '../providers';
import { compareSemver } from './versioning';

type Exec = (
    command: string,
    args: string[],
    options: ExecFileSyncOptionsWithStringEncoding,
) => string | Buffer;

export function assertProviderSupported(
    agent: AgentTarget,
    exec: Exec = execFileSync,
): { provider: AgentTarget; version: string | null } {
    const provider = providerFor(agent);
    if (!provider.versionCommand || !provider.minimumVersion) {
        return { provider: agent, version: null };
    }

    let output: string;
    try {
        output = exec(provider.versionCommand.command, provider.versionCommand.args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
        }).toString();
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            throw new Error(
                'Codex is not installed or not available on PATH. ' +
                'Install the current stable @openai/codex release, then re-run.',
            );
        }
        throw new Error(`Codex version probe failed: ${(error as Error).message}`);
    }

    const match = output.match(/(?:^|\s)(\d+\.\d+\.\d+)(?=\s*$)/);
    if (!match) {
        throw new Error(`could not parse Codex version from: ${output.trim()}`);
    }
    if (compareSemver(match[1], provider.minimumVersion) < 0) {
        throw new Error(`requires Codex >= ${provider.minimumVersion}; found ${match[1]}`);
    }

    return { provider: agent, version: match[1] };
}
