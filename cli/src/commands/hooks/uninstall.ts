import { getHookConfig } from '../../providers';
import { uninstallClaudeHook } from './claude';
import { uninstallCodexHook } from './codex';
import { uninstallCursorHook } from './cursor';
import type { UninstallOptions, UninstallResult } from './shared';

export type { UninstallOptions, UninstallResult };

export function uninstallHook(options: UninstallOptions): UninstallResult {
    const config = getHookConfig(options.agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${options.agent}`);
    }

    switch (config.type) {
        case 'cc-settings-merge':
            return uninstallClaudeHook(options.agent as 'claude-code');
        case 'codex-hooks-json':
            return uninstallCodexHook(options.agent as 'codex');
        case 'cursor-hooks-json':
            return uninstallCursorHook(options.agent as 'cursor');
        /* istanbul ignore next -- HookConfig['type'] is exhaustively handled above */
        default: {
            const exhaustive: never = config.type;
            throw new Error(`Unknown hook config type: ${String(exhaustive)}`);
        }
    }
}
