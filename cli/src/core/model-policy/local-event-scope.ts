import type { EventScope } from './capabilities-v2';
import { queryLocalClaudeScope } from './local-claude-scope';
import { queryLocalCodexScope } from './local-codex-scope';

export type LocalEventScope = { state: 'current'; scope: EventScope } | { state: 'unverified'; reason: string };

/** Provider-specific, read-only scope discovery for dispatch-time drift checks. */
export async function queryLocalEventScope(cwd: string, target: string, runtimeKind: string): Promise<LocalEventScope> {
    if (target === 'codex') return queryLocalCodexScope(cwd, runtimeKind);
    if (target === 'claude-code') return queryLocalClaudeScope(cwd, runtimeKind);
    return { state: 'unverified', reason: 'PROVIDER_UNSUPPORTED' };
}
