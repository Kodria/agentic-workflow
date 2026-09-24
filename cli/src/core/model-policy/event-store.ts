import { createHash, createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { awmHome } from '../paths';
import { parseJsonNoDuplicate } from '../plan/json';
import { secureFs } from '../secure-fs/native-bridge';
import { validateRuntimeKey } from './capabilities';
import { validateEventReceipt, type EventReceipt, type EventScope } from './capabilities-v2';
import { isNativeCodexChildObservation, type CodexChildThreadObservation } from './native-codex';
import { isNativeClaudeSubagentLifecycle, type ClaudeSubagentLifecycle } from './native-claude';
import { isNativeClaudeTranscriptObservation, type ClaudeTranscriptObservation } from './native-claude-transcript';
import { isNativeClaudeAgentDeclaration, type ClaudeAgentDeclaration } from './native-claude-agent-definition';
import { readMachineKey } from './machine-key';
import type { RuntimeKey, Selection } from './types';
import { assertDigest } from './validate';

const MAX_RECEIPT_BYTES = 256 * 1024;
const SEAL_DOMAIN = 'AWM routing-capabilities/v2 local receipt\0';
const CLAUDE_AGENT_DOMAIN = 'AWM Claude native agent ID/v1\0';

export function claudeAgentIdDigest(agentId: string, key: Buffer): string {
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(agentId) || !Buffer.isBuffer(key) || key.length !== 32)
        throw new Error('Claude native agent identity is invalid');
    return createHmac('sha256', key).update(CLAUDE_AGENT_DOMAIN).update(agentId).digest('hex');
}

export type EventReceiptRead = { state: 'absent' } | { state: 'present'; receipt: EventReceipt } | { state: 'invalid'; reason: string };

function receiptPath(runtime: RuntimeKey): string {
    const valid = validateRuntimeKey(runtime);
    return path.join(awmHome(), 'routing-capabilities-v2', valid.target, `${valid.kind}.json`);
}
function safeParents(file: string, create: boolean): void {
    const chain: string[] = [];
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) { chain.unshift(dir); if (dir === path.dirname(dir)) break; }
    for (const dir of chain) {
        try {
            const stat = fs.lstatSync(dir);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('event receipt has unsafe or symlinked ancestor');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
            fs.mkdirSync(dir, { mode: 0o700 });
        }
    }
}
function readFile(file: string): EventReceipt | null {
    try {
        safeParents(file, false);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('event receipt is unsafe or symlinked');
        const bytes = secureFs.readRegularFile(file, MAX_RECEIPT_BYTES).bytes;
        const parsed = parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('event receipt envelope is invalid');
        const envelope = parsed as Record<string, unknown>;
        if (Object.keys(envelope).length !== 2 || !Object.keys(envelope).every(key => ['receipt', 'mac'].includes(key))
            || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)) throw new Error('event receipt seal is invalid');
        const receipt = validateEventReceipt(envelope.receipt);
        const key = readMachineKey(awmHome());
        if (!key) throw new Error('event receipt machine key is missing');
        const expected = seal(receipt, key);
        if (!timingSafeEqual(Buffer.from(envelope.mac, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('event receipt seal does not match this machine');
        return receipt;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}
function seal(receipt: EventReceipt, key: Buffer): string {
    return createHmac('sha256', key).update(SEAL_DOMAIN).update(JSON.stringify(receipt)).digest('hex');
}
export function readStoredEventReceipt(runtime: RuntimeKey): EventReceiptRead {
    try {
        const value = readFile(receiptPath(runtime));
        return value === null ? { state: 'absent' } : { state: 'present', receipt: value };
    } catch (error) { return { state: 'invalid', reason: (error as Error).message.slice(0, 4096) }; }
}
function sameSelection(left: Selection, right: Selection): boolean {
    return left.selector.kind === right.selector.kind && left.selector.id === right.selector.id && left.effort.kind === right.effort.kind
        && (left.effort.kind !== 'explicit' || left.effort.value === (right.effort as { kind: 'explicit'; value: string }).value);
}
function sameScope(left: EventReceipt, right: EventScope): boolean {
    return left.runtime.target === right.runtime.target && left.runtime.kind === right.runtime.kind && left.runtime.version === right.runtime.version
        && left.runtime.accountScopeDigest === right.runtime.accountScopeDigest && left.binaryDigest === right.binaryDigest && left.configDigest === right.configDigest;
}

export type CodexEnrollment = { scope: EventScope; observation: CodexChildThreadObservation; expectedSelection: Selection; mappingDigest: string; now: Date };

/** The only Codex v2 writer takes a native observation, never a candidate JSON.
 * The CLI must call the native adapter and derive scope from this machine. */
export function publishCodexObservation(input: CodexEnrollment): EventReceipt {
    if (!input || typeof input !== 'object' || !isNativeCodexChildObservation(input.observation)) throw new Error('Codex native provenance is required');
    if (input.observation.provenance !== 'codex-app-server-thread-read'
        || input.observation.nativeDispatchVerified !== true || input.observation.acceptedSelectionVerified !== true
        || input.observation.actualModelVerified !== false || input.observation.tokenUsage !== 'unknown') throw new Error('Codex native selection is unverified');
    const scope = input.scope;
    if (!scope || scope.runtime?.target !== 'codex' || input.observation.childRuntimeVersion !== scope.runtime.version) throw new Error('Codex native runtime version mismatch');
    if (!sameSelection(input.observation.configuredSelection, input.expectedSelection)) throw new Error('Codex observed selection does not match approved selection');
    assertDigest(input.mappingDigest, 'mappingDigest');
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new Error('event receipt clock is invalid');
    const recordedAt = input.now.toISOString();
    if (typeof input.observation.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observation.observedAt))) throw new Error('Codex native turn timestamp is unavailable');
    const eventDigest = createHash('sha256').update(JSON.stringify({ parent: input.observation.parentThreadId, child: input.observation.childThreadId,
        turn: input.observation.turnId, selection: input.observation.configuredSelection, runtimeVersion: input.observation.childRuntimeVersion,
        accountScopeDigest: scope.runtime.accountScopeDigest })).digest('hex');
    const claim = { selection: input.expectedSelection, mappingDigest: input.mappingDigest, eventDigest,
        source: 'codex-turn-context' as const, observedAt: input.observation.observedAt, actualModel: 'unverified' as const, tokenUsage: 'unknown' as const };
    const initial = validateEventReceipt({ schema: 'routing-capabilities/v2', ...scope, recordedAt, claims: [claim] });
    const file = receiptPath(initial.runtime);
    const root = awmHome();
    return secureFs.withProjectLease(root, () => {
        const key = readMachineKey(root);
        if (!key) throw new Error('event receipt machine key is missing; run explicit setup');
        safeParents(file, true);
        const current = readFile(file);
        if (current && sameScope(current, scope)) {
            const prior = current.claims.find(item => sameSelection(item.selection, claim.selection));
            if (prior && prior.mappingDigest === claim.mappingDigest && prior.eventDigest === claim.eventDigest) return current;
        }
        const ageMs = input.now.getTime() - Date.parse(input.observation.observedAt!);
        if (ageMs < 0 || ageMs > 15 * 60 * 1000) throw new Error('Codex native turn is not fresh for enrollment');
        const claims = current && sameScope(current, scope) ? current.claims.filter(item => !sameSelection(item.selection, claim.selection)).concat(claim) : [claim];
        const next = validateEventReceipt({ ...initial, claims });
        const destination = path.relative(root, file).split(path.sep).join('/');
        const bytes = Buffer.from(`${JSON.stringify({ receipt: next, mac: seal(next, key) }, null, 2)}\n`);
        if (current) {
            const observed = secureFs.readRegularFile(file, MAX_RECEIPT_BYTES);
            secureFs.writeProjectTransaction(root, destination, bytes, { mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: observed.identity });
        } else secureFs.writeProjectTransaction(root, destination, bytes, { mode: 'create', createParents: false });
        return next;
    });
}

export type ClaudeEnrollment = { scope: EventScope; lifecycle: ClaudeSubagentLifecycle; transcript: ClaudeTranscriptObservation;
    declaredAgent?: ClaudeAgentDeclaration; expectedSelection: Selection; mappingDigest: string; now: Date };

/** Bind a native hook pair to the provider's assistant transcript. The transcript
 * reports a model, not effective effort or paid usage, so only runtime-default
 * effort may be enrolled and usage remains unknown. */
export function publishClaudeObservation(input: ClaudeEnrollment): EventReceipt {
    if (!input || typeof input !== 'object' || !isNativeClaudeSubagentLifecycle(input.lifecycle)
        || !isNativeClaudeTranscriptObservation(input.transcript)) throw new Error('Claude native hook and transcript provenance are required');
    if (!isNativeClaudeAgentDeclaration(input.declaredAgent) || input.declaredAgent.agentType !== input.lifecycle.agentType
        || input.declaredAgent.modelId !== input.transcript.actualModel) throw new Error('Claude declared agent model provenance is required');
    if (input.scope?.runtime?.target !== 'claude-code' || input.lifecycle.agentId !== input.transcript.agentId
        || input.expectedSelection?.selector?.kind !== 'model' || input.expectedSelection.selector.id !== input.transcript.actualModel
        || input.expectedSelection.effort.kind !== 'runtime-default') throw new Error('Claude native selection does not match approved model or effort');
    assertDigest(input.mappingDigest, 'mappingDigest');
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new Error('event receipt clock is invalid');
    const eventDigest = createHash('sha256').update(JSON.stringify({ session: input.lifecycle.sessionId, agent: input.lifecycle.agentId,
        transcriptDigest: input.transcript.evidenceDigest, accountScopeDigest: input.scope.runtime.accountScopeDigest })).digest('hex');
    const nativeAgentIdDigest = claudeAgentIdDigest(input.lifecycle.agentId, readMachineKey(awmHome())!);
    const nativeEvent = { nativeAgentIdDigest, eventDigest, observedAt: input.transcript.observedAt };
    const claim = { selection: input.expectedSelection, mappingDigest: input.mappingDigest, eventDigest,
        nativeAgentType: input.lifecycle.agentType,
        nativeAgentIdDigest, nativeEvents: [nativeEvent],
        source: 'claude-assistant-transcript' as const, observedAt: input.transcript.observedAt,
        actualModel: { id: input.transcript.actualModel, evidenceDigest: input.transcript.evidenceDigest }, tokenUsage: 'unknown' as const };
    const initial = validateEventReceipt({ schema: 'routing-capabilities/v2', ...input.scope, recordedAt: input.now.toISOString(), claims: [claim] });
    const file = receiptPath(initial.runtime);
    const root = awmHome();
    return secureFs.withProjectLease(root, () => {
        const key = readMachineKey(root);
        if (!key) throw new Error('event receipt machine key is missing; run explicit setup');
        safeParents(file, true);
        const current = readFile(file);
        if (current && sameScope(current, input.scope)) {
            const prior = current.claims.find(item => sameSelection(item.selection, claim.selection));
            if (prior && prior.mappingDigest === claim.mappingDigest && prior.eventDigest === claim.eventDigest) return current;
        }
        const ageMs = input.now.getTime() - Date.parse(input.transcript.observedAt);
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 15 * 60 * 1000) throw new Error('Claude native transcript is not fresh for enrollment');
        const prior = current && sameScope(current, input.scope) ? current.claims.find(item => sameSelection(item.selection, claim.selection)) : undefined;
        const previousEvents = prior?.nativeEvents ?? (prior?.nativeAgentIdDigest ? [{ nativeAgentIdDigest: prior.nativeAgentIdDigest,
            eventDigest: prior.eventDigest, observedAt: prior.observedAt }] : []);
        const recentEvents = previousEvents.filter(item => input.now.getTime() - Date.parse(item.observedAt) <= 15 * 60_000
            && item.nativeAgentIdDigest !== nativeAgentIdDigest && item.eventDigest !== eventDigest);
        const mergedClaim = { ...claim, nativeEvents: recentEvents.concat(nativeEvent).slice(-64) };
        const claims = current && sameScope(current, input.scope) ? current.claims.filter(item => !sameSelection(item.selection, claim.selection)).concat(mergedClaim) : [mergedClaim];
        const next = validateEventReceipt({ ...initial, claims });
        const destination = path.relative(root, file).split(path.sep).join('/');
        const bytes = Buffer.from(`${JSON.stringify({ receipt: next, mac: seal(next, key) }, null, 2)}\n`);
        if (current) {
            const observed = secureFs.readRegularFile(file, MAX_RECEIPT_BYTES);
            secureFs.writeProjectTransaction(root, destination, bytes, { mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: observed.identity });
        } else secureFs.writeProjectTransaction(root, destination, bytes, { mode: 'create', createParents: false });
        return next;
    });
}
