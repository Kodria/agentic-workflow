// src/providers/index.ts
import os from 'os';
import path from 'path';

export type AgentTarget = 'antigravity' | 'opencode' | 'claude-code';
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow' | 'agent';

type ArtifactConfig = {
    global: string;
    local: string;
};

export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
};

const homedir = os.homedir();

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
        agent:    { global: path.join(homedir, '.config/opencode/agents'), local: '.agents/profiles' }
    },
    'claude-code': {
        label: 'Claude Code',
        skill:    { global: path.join(homedir, '.claude/skills'),  local: '.claude/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.claude/agents'),  local: '.claude/agents' }
    }
};

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    const provider = PROVIDERS[agent];
    if (!provider) throw new Error(`Unknown agent target: ${agent}`);

    const config = provider[type];
    if (!config) throw new Error(`${type}s are not supported by ${provider.label}.`);

    return config[scope];
}
