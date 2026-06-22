// src/providers/index.ts
import path from 'path';
import { homeDir, awmHome } from '../core/paths';

export type AgentTarget = 'antigravity' | 'opencode' | 'claude-code';
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow' | 'agent';

type ArtifactConfig = {
    global: string;
    local: string;
};

export type HookConfig = {
    type: 'cc-settings-merge';
    settingsPath: string;
    scriptsDir: string;
    matcher: string;
    eventName: string;
};

export type InjectionConfig =
    | { type: 'cc-settings-merge' }  // routing discriminant only; hook params come from provider.hooks
    | { type: 'config-instructions'; configPath: string; field: 'instructions' };

export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
    hooks?: HookConfig;
    injection?: InjectionConfig;
};

const homedir = homeDir();
const awmHomeDir = awmHome();

export const PROVIDERS: Record<AgentTarget, ProviderConfig> = {
    antigravity: {
        label: 'Antigravity',
        skill:    { global: path.join(homedir, '.gemini/antigravity/skills'),           local: '.agent/skills' },
        workflow: { global: path.join(homedir, '.gemini/antigravity/global_workflows'), local: '.agent/workflows' },
        agent:    null
    },
    opencode: {
        label: 'OpenCode',
        skill:    { global: path.join(homedir, '.agents/skills'),          local: '.agents/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.config/opencode/agents'), local: '.agents/profiles' },
        injection: {
            type: 'config-instructions',
            configPath: path.join(homedir, '.config/opencode/opencode.json'),
            field: 'instructions',
        },
    },
    'claude-code': {
        label: 'Claude Code',
        skill:    { global: path.join(homedir, '.claude/skills'),  local: '.claude/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.claude/agents'),  local: '.claude/agents' },
        hooks: {
            type: 'cc-settings-merge',
            settingsPath: path.join(homedir, '.claude/settings.json'),
            scriptsDir: path.join(awmHomeDir, 'hooks'),
            matcher: 'startup|clear|compact',
            eventName: 'SessionStart'
        },
        injection: { type: 'cc-settings-merge' }
    }
};

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    const provider = PROVIDERS[agent];
    if (!provider) throw new Error(`Unknown agent target: ${agent}`);

    const config = provider[type];
    if (!config) throw new Error(`${type}s are not supported by ${provider.label}.`);

    return config[scope];
}

export function getHookConfig(agent: AgentTarget): HookConfig | undefined {
    const provider = PROVIDERS[agent];
    return provider?.hooks;
}

export function getInjection(agent: AgentTarget): InjectionConfig | undefined {
    return PROVIDERS[agent]?.injection;
}
