import { AgentTarget, getHookConfig } from '../../providers';
import { installClaudeHook } from './claude';
import { installCodexHook } from './codex';

export type InstallOptions = {
    agent: AgentTarget;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
};

export type InstallResult = {
    status: 'installed' | 'already-up-to-date';
    scriptsDir: string;
    settingsPath: string;
    backupPath: string | null;
};

export function installHook(options: InstallOptions): InstallResult {
    const config = getHookConfig(options.agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${options.agent}`);
    }

    switch (config.type) {
        case 'cc-settings-merge':
            return installClaudeHook(options);
        case 'codex-hooks-json':
            return installCodexHook(options);
        /* istanbul ignore next -- HookConfig['type'] is exhaustively handled above */
        default: {
            const exhaustive: never = config.type;
            throw new Error(`Unknown hook config type: ${String(exhaustive)}`);
        }
    }
}
