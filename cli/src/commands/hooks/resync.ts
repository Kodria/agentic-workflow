import fs from 'fs';
import path from 'path';
import { AgentTarget, PROVIDERS, getHookConfig } from '../../providers';
import { computeHookStatus } from './status';
import { syncFile } from './install';

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

    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        const config = getHookConfig(agent);
        if (!config) continue;

        const status = computeHookStatus(agent);
        if (!status.checks.settingsEntry.ok) {
            results.push({ agent, action: 'not-installed' });
            continue;
        }

        const sourceHooks = path.join(registryRoot, 'registry/hooks');
        const sourceSkill = path.join(registryRoot, 'registry/skills/using-awm/SKILL.md');
        if (!fs.existsSync(path.join(sourceHooks, 'session-start')) || !fs.existsSync(path.join(sourceHooks, 'run-hook.cmd')) || !fs.existsSync(sourceSkill)) {
            results.push({ agent, action: 'registry-missing' });
            continue;
        }

        const method = detectInstallMethod(config.scriptsDir);
        fs.mkdirSync(config.scriptsDir, { recursive: true });
        syncFile(path.join(sourceHooks, 'session-start'), path.join(config.scriptsDir, 'session-start'), method);
        syncFile(path.join(sourceHooks, 'run-hook.cmd'), path.join(config.scriptsDir, 'run-hook.cmd'), method);

        const skillDest = path.join(config.scriptsDir, 'using-awm.md');
        try { fs.unlinkSync(skillDest); } catch { /* not exists */ }
        fs.symlinkSync(sourceSkill, skillDest);

        results.push({ agent, action: 'resynced' });
    }

    return results;
}
