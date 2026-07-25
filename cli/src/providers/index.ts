// src/providers/index.ts
import path from 'path';
import { awmHome, homeDir } from '../core/paths';

export const AGENT_TARGETS = ['antigravity', 'opencode', 'claude-code', 'codex'] as const;

export type AgentTarget = typeof AGENT_TARGETS[number];
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow' | 'agent';
export type RendererId = 'link' | 'codex-agent-toml';

export function isAgentTarget(value: unknown): value is AgentTarget {
    return typeof value === 'string' &&
        (AGENT_TARGETS as readonly string[]).includes(value);
}

/** Assertion form of `isAgentTarget` — narrows or throws a clear, user-facing error. */
export function requireAgentTarget(value: unknown): AgentTarget {
    if (!isAgentTarget(value)) {
        throw new Error(`Invalid agent target: ${String(value)}. Use: ${AGENT_TARGETS.join(', ')}.`);
    }
    return value;
}

export type ArtifactConfig = {
    global: string;
    local: string;
    renderer: RendererId;
};

export type HookConfig = {
    type: 'cc-settings-merge' | 'codex-hooks-json';
    settingsPath: string;
    scriptsDir: string;
    matcher: string;
    eventName: string;
};

export type SettingsMergeHookConfig = HookConfig & {
    type: 'cc-settings-merge';
};

export type InjectionConfig =
    | { type: 'cc-settings-merge' }
    | { type: 'config-instructions'; configPath: string; field: 'instructions' }
    | { type: 'managed-agents-md'; globalPath: string; localFile: string };

export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
    hooks?: HookConfig;
    injection?: InjectionConfig;
    minimumVersion?: string;
    versionCommand?: {
        command: string;
        args: string[];
    };
};

export class UnsupportedRendererError extends Error {}

export function providers(): Record<AgentTarget, ProviderConfig> {
    const home = homeDir();
    const awm = awmHome();

    return {
        antigravity: {
            label: 'Antigravity',
            skill: {
                global: path.join(home, '.gemini/antigravity/skills'),
                local: '.agent/skills',
                renderer: 'link',
            },
            workflow: {
                global: path.join(home, '.gemini/antigravity/global_workflows'),
                local: '.agent/workflows',
                renderer: 'link',
            },
            agent: null,
        },
        opencode: {
            label: 'OpenCode',
            skill: {
                global: path.join(home, '.agents/skills'),
                local: '.agents/skills',
                renderer: 'link',
            },
            workflow: null,
            agent: {
                global: path.join(home, '.config/opencode/agents'),
                local: '.agents/profiles',
                renderer: 'link',
            },
            injection: {
                type: 'config-instructions',
                configPath: path.join(home, '.config/opencode/opencode.json'),
                field: 'instructions',
            },
        },
        'claude-code': {
            label: 'Claude Code',
            skill: {
                global: path.join(home, '.claude/skills'),
                local: '.claude/skills',
                renderer: 'link',
            },
            workflow: null,
            agent: {
                global: path.join(home, '.claude/agents'),
                local: '.claude/agents',
                renderer: 'link',
            },
            hooks: {
                type: 'cc-settings-merge',
                settingsPath: path.join(home, '.claude/settings.json'),
                scriptsDir: path.join(awm, 'hooks'),
                matcher: 'startup|clear|compact',
                eventName: 'SessionStart',
            },
            injection: { type: 'cc-settings-merge' },
        },
        codex: {
            label: 'Codex',
            minimumVersion: '0.145.0',
            versionCommand: { command: 'codex', args: ['--version'] },
            skill: {
                global: path.join(home, '.agents/skills'),
                local: '.agents/skills',
                renderer: 'link',
            },
            workflow: null,
            agent: {
                global: path.join(home, '.codex/agents'),
                local: '.codex/agents',
                renderer: 'codex-agent-toml',
            },
            hooks: {
                type: 'codex-hooks-json',
                settingsPath: path.join(home, '.codex/hooks.json'),
                scriptsDir: path.join(awm, 'hooks/codex'),
                matcher: 'startup|resume|clear|compact',
                eventName: 'SessionStart',
            },
            injection: {
                type: 'managed-agents-md',
                globalPath: path.join(home, '.codex/AGENTS.md'),
                localFile: 'AGENTS.md',
            },
        },
    };
}

export function providerFor(agent: AgentTarget): ProviderConfig {
    if (!isAgentTarget(agent)) {
        throw new Error(`Unknown agent target: ${String(agent)}`);
    }
    return providers()[agent];
}

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    if (!(['skill', 'workflow', 'agent'] as unknown[]).includes(type)) {
        throw new Error(`Unknown artifact type: ${String(type)}`);
    }
    if (!(['global', 'local'] as unknown[]).includes(scope)) {
        throw new Error(`Unknown scope: ${String(scope)}`);
    }

    const provider = providerFor(agent);
    const config = provider[type];
    if (!config) throw new Error(`${type}s are not supported by ${provider.label}.`);

    return config[scope];
}

export function getHookConfig(agent: AgentTarget): HookConfig | undefined {
    return providerFor(agent).hooks;
}

export function getSettingsMergeHookConfig(agent: AgentTarget): SettingsMergeHookConfig {
    const config = getHookConfig(agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${agent}`);
    }
    if (config.type !== 'cc-settings-merge') {
        throw new Error(`${providerFor(agent).label} hook strategy is not implemented yet`);
    }
    return config as SettingsMergeHookConfig;
}

export function assertLinkRenderer(
    type: ArtifactType,
    agent: AgentTarget,
): ArtifactConfig | null {
    if (!(['skill', 'workflow', 'agent'] as unknown[]).includes(type)) {
        throw new Error(`Unknown artifact type: ${String(type)}`);
    }
    const config = providerFor(agent)[type];
    if (config && config.renderer !== 'link') {
        throw new UnsupportedRendererError(
            `Renderer '${config.renderer}' for ${agent} ${type} artifacts is not implemented yet`,
        );
    }
    return config;
}

export function getInjection(agent: AgentTarget): InjectionConfig | undefined {
    return providerFor(agent).injection;
}
