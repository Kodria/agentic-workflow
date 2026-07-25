import type { AwmPreferences } from '../utils/config';
import { isAgentTarget, type AgentTarget } from '../providers';

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
