import type { RuntimeKey, Selection } from './types';
import { validateRuntimeKey } from './capabilities';
import { assertDigest, canonicalUtcTimestamp } from './validate';

export type EventClaim = {
    selection: Selection;
    mappingDigest: string;
    eventDigest: string;
    source: 'codex-turn-context' | 'claude-assistant-transcript';
    nativeAgentType?: string;
    nativeAgentIdDigest?: string;
    nativeEvents?: Array<{ nativeAgentIdDigest: string; eventDigest: string; observedAt: string }>;
    observedAt: string;
    actualModel: 'unverified' | { id: string; evidenceDigest: string };
    tokenUsage: 'unknown' | { input: number; output: number };
};
export type EventReceipt = {
    schema: 'routing-capabilities/v2';
    runtime: RuntimeKey;
    binaryDigest: string;
    configDigest: string;
    recordedAt: string;
    claims: EventClaim[];
};
export type EventScope = { runtime: RuntimeKey; binaryDigest: string; configDigest: string };
export type EventCurrentness = { state: 'current' } | { state: 'drift'; reason: 'RUNTIME_DRIFT' | 'ACCOUNT_DRIFT' | 'CONFIG_DRIFT' | 'POLICY_DRIFT' | 'FUTURE_EVIDENCE' | 'SELECTION_UNENROLLED' };

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} has unknown or missing fields`);
}
function digest(value: unknown, label: string): string {
    assertDigest(value, label);
    return value as string;
}
function selection(value: unknown): Selection {
    const item = record(value, 'selection'); exact(item, ['selector', 'effort'], 'selection');
    const selector = record(item.selector, 'selection.selector'); exact(selector, ['kind', 'id'], 'selection.selector');
    if (selector.kind !== 'model' && selector.kind !== 'tier') throw new Error('selection.selector.kind is invalid');
    if (typeof selector.id !== 'string' || selector.id.length === 0 || selector.id.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(selector.id)) throw new Error('selection.selector.id is invalid');
    const effort = record(item.effort, 'selection.effort');
    if (effort.kind === 'runtime-default') { exact(effort, ['kind'], 'selection.effort'); return { selector: { kind: selector.kind, id: selector.id }, effort: { kind: 'runtime-default' } }; }
    exact(effort, ['kind', 'value'], 'selection.effort');
    if (effort.kind !== 'explicit' || typeof effort.value !== 'string' || effort.value.length === 0 || effort.value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(effort.value)) throw new Error('selection.effort is invalid');
    return { selector: { kind: selector.kind, id: selector.id }, effort: { kind: 'explicit', value: effort.value } };
}
function key(value: Selection): string { return `${value.selector.kind}\0${value.selector.id}\0${value.effort.kind}\0${value.effort.kind === 'explicit' ? value.effort.value : ''}`; }
function finiteTokens(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
    return value as number;
}

/** Schema v2 is internal native evidence, never a candidate for v1 approval. */
export function validateEventReceipt(value: unknown): EventReceipt {
    const item = record(value, 'event receipt'); exact(item, ['schema', 'runtime', 'binaryDigest', 'configDigest', 'recordedAt', 'claims'], 'event receipt');
    if (item.schema !== 'routing-capabilities/v2') throw new Error('event receipt schema is invalid');
    const runtime = validateRuntimeKey(item.runtime);
    if (runtime.target !== 'codex' && runtime.target !== 'claude-code') throw new Error('event receipt provider target is unsupported');
    const binaryDigest = digest(item.binaryDigest, 'binaryDigest');
    const configDigest = digest(item.configDigest, 'configDigest');
    const recordedAt = canonicalUtcTimestamp(item.recordedAt, 'recordedAt');
    if (!Array.isArray(item.claims) || item.claims.length === 0 || item.claims.length > 64) throw new Error('event receipt claims are invalid');
    const claims = item.claims.map((raw, index): EventClaim => {
        const claim = record(raw, `claims[${index}]`);
        exact(claim, claim.source === 'claude-assistant-transcript'
            ? ['selection', 'mappingDigest', 'eventDigest', 'source', 'nativeAgentType', ...(claim.nativeAgentIdDigest === undefined ? [] : ['nativeAgentIdDigest']), ...(claim.nativeEvents === undefined ? [] : ['nativeEvents']), 'observedAt', 'actualModel', 'tokenUsage']
            : ['selection', 'mappingDigest', 'eventDigest', 'source', 'observedAt', 'actualModel', 'tokenUsage'], `claims[${index}]`);
        const selected = selection(claim.selection);
        const mappingDigest = digest(claim.mappingDigest, `claims[${index}].mappingDigest`);
        const eventDigest = digest(claim.eventDigest, `claims[${index}].eventDigest`);
        if (claim.source !== 'codex-turn-context' && claim.source !== 'claude-assistant-transcript') throw new Error(`claims[${index}].source is invalid`);
        if ((runtime.target === 'codex') !== (claim.source === 'codex-turn-context')) throw new Error(`claims[${index}].source does not match provider`);
        if (claim.source === 'claude-assistant-transcript' && (typeof claim.nativeAgentType !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(claim.nativeAgentType)))
            throw new Error(`claims[${index}].nativeAgentType is invalid`);
        if (claim.nativeAgentIdDigest !== undefined) {
            if (claim.source !== 'claude-assistant-transcript') throw new Error(`claims[${index}].nativeAgentIdDigest is invalid`);
            digest(claim.nativeAgentIdDigest, `claims[${index}].nativeAgentIdDigest`);
        }
        let nativeEvents: EventClaim['nativeEvents'];
        if (claim.nativeEvents !== undefined) {
            if (claim.source !== 'claude-assistant-transcript' || !Array.isArray(claim.nativeEvents)
                || claim.nativeEvents.length === 0 || claim.nativeEvents.length > 64) throw new Error(`claims[${index}].nativeEvents is invalid`);
            nativeEvents = claim.nativeEvents.map((raw, eventIndex) => {
                const event = record(raw, `claims[${index}].nativeEvents[${eventIndex}]`);
                exact(event, ['nativeAgentIdDigest', 'eventDigest', 'observedAt'], `claims[${index}].nativeEvents[${eventIndex}]`);
                const observedAt = canonicalUtcTimestamp(event.observedAt, `claims[${index}].nativeEvents[${eventIndex}].observedAt`);
                if (Date.parse(observedAt) > Date.parse(recordedAt)) throw new Error('Claude native event is newer than receipt');
                return { nativeAgentIdDigest: digest(event.nativeAgentIdDigest, 'nativeAgentIdDigest'),
                    eventDigest: digest(event.eventDigest, 'eventDigest'), observedAt };
            });
            if (new Set(nativeEvents.map(event => event.nativeAgentIdDigest)).size !== nativeEvents.length
                || new Set(nativeEvents.map(event => event.eventDigest)).size !== nativeEvents.length) throw new Error('Claude native events are duplicated');
        }
        const observedAt = canonicalUtcTimestamp(claim.observedAt, `claims[${index}].observedAt`);
        if (Date.parse(observedAt) > Date.parse(recordedAt)) throw new Error(`claims[${index}] is newer than receipt`);
        let actualModel: EventClaim['actualModel'];
        if (claim.actualModel === 'unverified') actualModel = 'unverified';
        else {
            const actual = record(claim.actualModel, `claims[${index}].actualModel`); exact(actual, ['id', 'evidenceDigest'], `claims[${index}].actualModel`);
            if (claim.source !== 'claude-assistant-transcript' || typeof actual.id !== 'string' || actual.id.length === 0 || actual.id.length > 128) throw new Error(`claims[${index}].actualModel is invalid`);
            actualModel = { id: actual.id, evidenceDigest: digest(actual.evidenceDigest, `claims[${index}].actualModel.evidenceDigest`) };
        }
        let tokenUsage: EventClaim['tokenUsage'];
        if (claim.tokenUsage === 'unknown') tokenUsage = 'unknown';
        else { const usage = record(claim.tokenUsage, `claims[${index}].tokenUsage`); exact(usage, ['input', 'output'], `claims[${index}].tokenUsage`); tokenUsage = { input: finiteTokens(usage.input, 'input tokens'), output: finiteTokens(usage.output, 'output tokens') }; }
        return { selection: selected, mappingDigest, eventDigest, source: claim.source,
            ...(claim.source === 'claude-assistant-transcript' ? { nativeAgentType: claim.nativeAgentType as string,
                ...(claim.nativeAgentIdDigest === undefined ? {} : { nativeAgentIdDigest: claim.nativeAgentIdDigest as string }),
                ...(nativeEvents === undefined ? {} : { nativeEvents }) } : {}), observedAt, actualModel, tokenUsage };
    });
    if (new Set(claims.map(claim => key(claim.selection))).size !== claims.length) throw new Error('event receipt has duplicate selections');
    return { schema: 'routing-capabilities/v2', runtime, binaryDigest, configDigest, recordedAt, claims };
}

/** Local, read-only comparison: no TTL, network call, rewrite or paid probe. */
export function evaluateEventReceipt(value: unknown, scopeValue: unknown, selectedValue: unknown, mappingDigestValue: unknown, now: Date): EventCurrentness {
    const receipt = validateEventReceipt(value);
    const scope = record(scopeValue, 'event scope'); exact(scope, ['runtime', 'binaryDigest', 'configDigest'], 'event scope');
    const runtime = validateRuntimeKey(scope.runtime);
    const binaryDigest = digest(scope.binaryDigest, 'binaryDigest');
    const configDigest = digest(scope.configDigest, 'configDigest');
    const selected = selection(selectedValue);
    const mappingDigest = digest(mappingDigestValue, 'mappingDigest');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('event currentness clock is invalid');
    if (Date.parse(receipt.recordedAt) > now.getTime()) return { state: 'drift', reason: 'FUTURE_EVIDENCE' };
    if (receipt.runtime.target !== runtime.target || receipt.runtime.kind !== runtime.kind || receipt.runtime.version !== runtime.version || receipt.binaryDigest !== binaryDigest) return { state: 'drift', reason: 'RUNTIME_DRIFT' };
    if (receipt.runtime.accountScopeDigest !== runtime.accountScopeDigest) return { state: 'drift', reason: 'ACCOUNT_DRIFT' };
    if (receipt.configDigest !== configDigest) return { state: 'drift', reason: 'CONFIG_DRIFT' };
    const claim = receipt.claims.find(item => key(item.selection) === key(selected));
    if (!claim) return { state: 'drift', reason: 'SELECTION_UNENROLLED' };
    if (claim.mappingDigest !== mappingDigest) return { state: 'drift', reason: 'POLICY_DRIFT' };
    return { state: 'current' };
}
