import {
    execFileSync,
    type ExecFileSyncOptionsWithStringEncoding,
} from 'child_process';
import { AgentTarget, providerFor } from '../providers';
import { compareSemver } from './versioning';
import { isWindowsNative } from './paths';

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
            // Windows can't CreateProcess a `.cmd` shim directly (npm installs
            // `codex` as `codex.cmd`, not `codex.exe`) — execFileSync needs a
            // shell to resolve and run it, or it throws ENOENT even though
            // typing `codex --version` in the same shell works fine. Safe here
            // (unlike sensors.json's `cmd`, core/paths.ts's resolveOnPath):
            // `provider.versionCommand.command`/`args` are hardcoded first-party
            // config (providers/index.ts), never attacker-controlled input.
            // Found running the issue #55 Windows playbook: `awm init -a codex`
            // reported "Codex is not installed" on a machine where it plainly
            // was — `codex --version` worked fine typed directly.
            shell: isWindowsNative(),
        }).toString();
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // `provider.label` y `versionCommand`, no "Codex" literal. Esta funcion es
        // generica sobre AgentTarget desde siempre, pero cada mensaje y el patron de
        // parseo nombraban al unico provider que hoy declara `versionCommand` — el
        // segundo en declararlo habria reportado "Codex no esta instalado" al no
        // encontrar SU binario, y habria fallado a parsear una salida perfectamente
        // valida contra el formato de otro programa.
        if (code === 'ENOENT') {
            throw new Error(
                `${provider.label} is not installed or not available on PATH ` +
                `(tried \`${provider.versionCommand.command}\`). Install it, then re-run.`,
            );
        }
        throw new Error(`${provider.label} version probe failed: ${(error as Error).message}`);
    }

    const match = output.trim().match(provider.versionCommand.versionPattern);
    if (!match) {
        throw new Error(`could not parse ${provider.label} version from: ${output.trim()}`);
    }
    if (compareSemver(match[1], provider.minimumVersion) < 0) {
        throw new Error(`requires ${provider.label} >= ${provider.minimumVersion}; found ${match[1]}`);
    }

    return { provider: agent, version: match[1] };
}
