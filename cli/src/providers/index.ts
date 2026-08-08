// src/providers/index.ts
import path from 'path';
import { awmHome, homeDir } from '../core/paths';

export const AGENT_TARGETS = ['antigravity', 'opencode', 'claude-code', 'codex', 'cursor', 'copilot'] as const;

export type AgentTarget = typeof AGENT_TARGETS[number];
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow' | 'agent';
/** Runtime-enumerable, so the renderer table in `core/renderers/registry.ts` can be
 *  checked for completeness against it (tests/structural/renderer-table-is-single-source).
 *  A type-only union cannot be iterated, which is part of why four partial copies of the
 *  renderer→extension mapping could drift apart unnoticed. */
export const RENDERER_IDS = ['link', 'codex-agent-toml', 'cursor-mdc', 'copilot-instructions'] as const;

export type RendererId = typeof RENDERER_IDS[number];


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
    global: string | null;
    local: string;
    renderer: RendererId;
    /** Explains WHY `global` is null, when it is. Surfaced by getTargetPath's error. */
    globalUnsupportedReason?: string;
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
    | { type: 'managed-agents-md'; globalPath: string | null; localFile: string };

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
        /** Patron con UN grupo de captura que extrae la version del stdout del binario.
         *  Sin esto, `provider-version.ts` traia el formato de Codex horneado
         *  (`/^codex-cli (\d+\.\d+\.\d+)$/`), asi que el segundo provider que
         *  declarara un `versionCommand` habria fallado a parsear la salida de un
         *  binario que respondio perfectamente. */
        versionPattern: RegExp;
    };
};

export class UnsupportedRendererError extends Error {}

/** Shared message shape for "this scope isn't supported by this provider" —
 *  used everywhere a `null` `ArtifactConfig.global` is resolved (this file's
 *  `getTargetPath`, and `install-planner.ts`'s `physicalTarget`/`skillTargetDir`,
 *  which duplicate the resolution logic for their own return-shape needs). */
export function unsupportedScopeError(
    artifactType: string,
    scope: Scope,
    providerLabel: string,
    reason: string | undefined,
): Error {
    return new Error(
        `${artifactType} ${scope} scope is not supported by ${providerLabel}` +
        (reason ? `: ${reason}` : '.'),
    );
}

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
            versionCommand: { command: 'codex', args: ['--version'], versionPattern: /^codex-cli (\d+\.\d+\.\d+)$/ },
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
        cursor: {
            label: 'Cursor',
            skill: {
                global: path.join(home, '.cursor/rules'),
                local: '.cursor/rules',
                renderer: 'cursor-mdc',
            },
            workflow: null,
            agent: null,
            injection: {
                type: 'managed-agents-md',
                // Cursor has no confirmed user-level/global AGENTS.md-equivalent file — its
                // "User Rules" live inside Cursor's own app settings, not a plain file on disk
                // (per docs research done for this task, R4 Task 4.1). Until a primary source
                // confirms a real global path, `null` here is the honest answer, not a guess.
                globalPath: null,
                localFile: 'AGENTS.md',
            },
        },
        copilot: {
            label: 'Copilot',
            skill: {
                global: null,
                globalUnsupportedReason: 'GitHub Copilot has no user-level skill discovery mechanism — skills must be installed per-project.',
                local: '.github/instructions',
                renderer: 'copilot-instructions',
            },
            workflow: null,
            agent: null,
            injection: {
                type: 'managed-agents-md',
                // Copilot is inherently repository-scoped — confirmed no ~/.copilot or
                // equivalent user-level AGENTS.md file exists. Task 4.2 owns the actual
                // runtime handling of a null globalPath (project-only injection).
                globalPath: null,
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

    const targetPath = scope === 'global' ? config.global : config.local;
    if (targetPath === null) {
        throw unsupportedScopeError(type, scope, provider.label, config.globalUnsupportedReason);
    }
    return targetPath;
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

/**
 * Guards callers that only know how to stage a target via a plain
 * symlink/copy (`core/executor.ts`'s stageArtifact) — today, that means
 * `core/provider-artifacts.ts`'s legacy single-artifact scan/preflight and
 * `src/index.ts`'s legacy interactive `awm add` flow, neither of which goes
 * through install-planner.ts/install-transaction.ts's render-at-stage-time
 * pipeline. Throws for ANY non-'link' renderer, including cursor-mdc/
 * copilot-instructions (Task 4.3): a raw, unrendered copy of a SKILL.md into
 * `.cursor/rules/` or `.github/instructions/` is not a degraded-but-usable
 * install the way it might first appear — it lacks the frontmatter
 * (`alwaysApply`/`applyTo`) and filename extension (`.mdc`/`.instructions.md`)
 * both providers require to even recognize the file, so it would silently
 * install something neither Cursor nor Copilot ever reads. These two
 * renderers are only reachable through commands/add.ts's proper pipeline,
 * which never calls this function.
 */
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
