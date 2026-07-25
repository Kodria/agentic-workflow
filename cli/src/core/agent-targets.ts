import type { AwmPreferences } from '../utils/config';
import { isAgentTarget, type AgentTarget } from '../providers';

export type ResolveAgentTargetsInput = {
    prefs: { readonly enabledAgents: Readonly<AwmPreferences['enabledAgents']> };
    explicit?: string;
};

export function resolveAgentTargets(input: {
    prefs: { readonly enabledAgents: Readonly<AwmPreferences['enabledAgents']> };
    explicit?: string;
}): AgentTarget[] {
    if (!input || typeof input !== 'object' ||
        !input.prefs || !Array.isArray(input.prefs.enabledAgents) ||
        !input.prefs.enabledAgents.every(isAgentTarget)) {
        throw new Error('resolveAgentTargets requires valid enabledAgents preferences');
    }
    if (input.explicit !== undefined && typeof input.explicit !== 'string') {
        throw new Error('--agent must be a comma-separated provider list');
    }
    if (input.explicit === undefined) return [...input.prefs.enabledAgents];

    const raw = input.explicit
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    if (raw.length === 0) throw new Error('--agent requires at least one provider');

    const agents = Array.from(new Set(raw));
    for (const agent of agents) {
        if (!isAgentTarget(agent)) throw new Error(`Invalid agent "${agent}".`);
        if (!input.prefs.enabledAgents.includes(agent)) {
            throw new Error(`${agent} is not enabled; run awm init --agent ${agent}`);
        }
    }
    return agents as AgentTarget[];
}

export type ResolveAgentTargetsResult =
    | { ok: true; targets: AgentTarget[] }
    | { ok: false; error: string };

/**
 * Non-throwing wrapper over `resolveAgentTargets` — every one of `add`,
 * `remove`, `sync`, `update` and `doctor` needs the exact same
 * try/resolve/catch shape, but each has a different failure-handling style
 * (`process.exit` in `index.ts`'s interactive Commander actions vs. returning
 * `{ code: 1, ... }` from the testable `run*Core` functions). Keeping this
 * wrapper pure (no logging, no process.exit) lets every call site reuse the
 * SAME resolution logic while choosing its own way to report/exit on
 * failure, rather than duplicating the try/catch at each of the 6+ sites.
 */
export function resolveAgentTargetsOrError(input: ResolveAgentTargetsInput): ResolveAgentTargetsResult {
    try {
        return { ok: true, targets: resolveAgentTargets(input) };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
}
