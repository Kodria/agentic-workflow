import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import type { RoutingAttempt, RoutingSelection } from '../journal/types';
import { awmHome } from '../paths';
import { evaluateEventReceipt } from './capabilities-v2';
import { claudeAgentIdDigest, publishCodexObservation, readStoredEventReceipt } from './event-store';
import { queryLocalEventScope } from './local-event-scope';
import { readMachineKey } from './machine-key';
import { validateRuntimeKey } from './capabilities';
import { queryCodexChildThreadObservation } from './native-codex';
import { signNativeRoutingProof, type NativeRoutingProof } from './native-routing-proof';
import { selectionPolicyDigest } from './selection-policy-digest';
import { readEffectivePolicy } from './store';

function sameSelection(left: RoutingSelection, right: RoutingSelection): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/** A bounded, read-mostly native observation for an already-dispatched child.
 * Codex may refresh only its matching claim; Claude's Stop hook is the writer.
 * No inference is started here. */
export async function observeNativeRoutingChild(input: { attempt: RoutingAttempt; nativeAgentId: string; parentThreadId?: string; cwd: string; now: Date; consumedEventDigests: string[] }): Promise<NativeRoutingProof> {
    if (!input || !input.attempt?.nativeEvidenceRequired || !input.attempt.reservedAt || input.attempt.state !== 'reserved'
        || typeof input.nativeAgentId !== 'string' || input.nativeAgentId.length === 0 || input.nativeAgentId.length > 128
        || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
        || !Array.isArray(input.consumedEventDigests) || input.consumedEventDigests.length > 4096
        || input.consumedEventDigests.some(item => typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item)))
        throw new Error('native routing observation is invalid');
    const key = readMachineKey(awmHome());
    if (!key) throw new Error('native routing machine key is missing');
    const envelope = input.attempt.envelope;
    const local = await queryLocalEventScope(input.cwd, envelope.runtime.target, envelope.runtime.kind);
    if (local.state !== 'current' || JSON.stringify(local.scope.runtime) !== JSON.stringify(envelope.runtime))
        throw new Error('native routing runtime or account scope drifted');
    const policy = readEffectivePolicy(input.cwd);
    if (policy.state !== 'approved' || policy.policy.contentDigest !== envelope.policyDigest)
        throw new Error('native routing policy drifted');
    const mapping = policy.policy.content.mappings.find(row => row.target === envelope.runtime.target && row.runtimeKind === envelope.runtime.kind);
    if (!mapping) throw new Error('native routing mapping is absent');
    const receipt = readStoredEventReceipt(validateRuntimeKey(envelope.runtime));
    if (receipt.state !== 'present') throw new Error('native routing receipt is absent or invalid');
    const currentness = evaluateEventReceipt(receipt.receipt, local.scope, envelope.resolved,
        selectionPolicyDigest(mapping, envelope.resolved), input.now);
    if (currentness.state !== 'current') throw new Error(`native routing receipt drifted: ${currentness.reason}`);
    let observed: RoutingSelection;
    let observedAt: string;
    let eventDigest: string;
    let source: NativeRoutingProof['source'];
    let actualModel: string | undefined;
    if (envelope.runtime.target === 'codex') {
        if (typeof input.parentThreadId !== 'string' || input.parentThreadId.length === 0 || input.parentThreadId.length > 128)
            throw new Error('Codex parent thread identity is required');
        const child = await queryCodexChildThreadObservation({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000,
            parentThreadId: input.parentThreadId, childThreadId: input.nativeAgentId,
            codexHome: path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')) });
        if (!child.acceptedSelectionVerified || child.childRuntimeVersion !== envelope.runtime.version || !child.observedAt)
            throw new Error('Codex child turn selection is not natively verified');
        observed = child.configuredSelection;
        observedAt = child.observedAt;
        const codexObservedMs = Date.parse(observedAt);
        if (!Number.isFinite(codexObservedMs) || codexObservedMs < Date.parse(input.attempt.reservedAt)
            || codexObservedMs > input.now.getTime() + 60_000 || input.now.getTime() - codexObservedMs > 15 * 60_000)
            throw new Error('Codex native child turn is stale or predates reservation');
        eventDigest = createHash('sha256').update(JSON.stringify({ parent: child.parentThreadId, child: child.childThreadId,
            turn: child.turnId, selection: observed, runtimeVersion: child.childRuntimeVersion,
            accountScopeDigest: local.scope.runtime.accountScopeDigest })).digest('hex');
        source = 'codex-turn-context';
        if (input.consumedEventDigests.includes(eventDigest)) throw new Error('Codex native child turn was already consumed');
        if (sameSelection(observed, envelope.resolved)) {
            publishCodexObservation({ scope: local.scope, observation: child, expectedSelection: envelope.resolved,
                mappingDigest: selectionPolicyDigest(mapping, envelope.resolved), now: input.now });
        }
    } else if (envelope.runtime.target === 'claude-code') {
        const claim = receipt.receipt.claims.find(item => sameSelection(item.selection, envelope.resolved));
        const agentDigest = claudeAgentIdDigest(input.nativeAgentId, key);
        const event = claim?.nativeEvents?.find(item => item.nativeAgentIdDigest === agentDigest)
            ?? (claim?.nativeAgentIdDigest === agentDigest ? { eventDigest: claim.eventDigest, observedAt: claim.observedAt } : undefined);
        if (!claim || claim.source !== 'claude-assistant-transcript' || claim.nativeAgentType !== envelope.nativeAgentType || !event)
            throw new Error('Claude Stop hook does not match this routed native child');
        observed = claim.selection;
        observedAt = event.observedAt;
        eventDigest = event.eventDigest;
        source = 'claude-assistant-transcript';
        if (claim.actualModel !== 'unverified') actualModel = claim.actualModel.id;
        if (input.consumedEventDigests.includes(eventDigest)) throw new Error('Claude native child event was already consumed');
    } else throw new Error('native routing provider is unsupported');
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs) || observedMs < Date.parse(input.attempt.reservedAt)
        || observedMs > input.now.getTime() + 60_000 || input.now.getTime() - observedMs > 15 * 60_000)
        throw new Error('native routing event is stale or predates reservation');
    return signNativeRoutingProof({ attemptId: input.attempt.id, nativeAgentId: input.nativeAgentId, source,
        eventDigest, observedAt, selection: observed, ...(actualModel === undefined ? {} : { actualModel }) }, key);
}
