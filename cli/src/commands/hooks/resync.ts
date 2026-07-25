import fs from 'fs';
import path from 'path';
import { AGENT_TARGETS, AgentTarget, getHookConfig } from '../../providers';
import { computeHookStatus } from './status';
import { claudeResyncSourcesExist, resyncClaudeHookFiles } from './claude';
import { codexResyncSourcesExist, resyncCodexHookFiles } from './codex';

export type ResyncAction = 'resynced' | 'not-installed' | 'registry-missing';

export type ResyncResult = {
    agent: AgentTarget;
    action: ResyncAction;
};

function detectInstallMethod(scriptsDir: string): 'symlink' | 'copy' {
    try {
        return fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink() ? 'symlink' : 'copy';
    } catch {
        return 'copy';
    }
}

export function resyncInstalledHooks(registryRoot: string): ResyncResult[] {
    const results: ResyncResult[] = [];

    for (const agent of AGENT_TARGETS) {
        const config = getHookConfig(agent);
        if (!config) continue;

        const status = computeHookStatus(agent);
        if (!status.checks.settingsEntry.ok) {
            results.push({ agent, action: 'not-installed' });
            continue;
        }

        const method = detectInstallMethod(config.scriptsDir);

        switch (config.type) {
            case 'cc-settings-merge': {
                if (!claudeResyncSourcesExist(registryRoot)) {
                    results.push({ agent, action: 'registry-missing' });
                    continue;
                }
                resyncClaudeHookFiles(config, registryRoot, method);
                results.push({ agent, action: 'resynced' });
                break;
            }
            case 'codex-hooks-json': {
                if (!codexResyncSourcesExist(registryRoot)) {
                    results.push({ agent, action: 'registry-missing' });
                    continue;
                }
                resyncCodexHookFiles(config, registryRoot, method);
                results.push({ agent, action: 'resynced' });
                break;
            }
            /* istanbul ignore next -- HookConfig['type'] is exhaustively handled above */
            default: {
                const exhaustive: never = config.type;
                throw new Error(`Unknown hook config type: ${String(exhaustive)}`);
            }
        }
    }

    return results;
}
