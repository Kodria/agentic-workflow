import crypto from 'crypto';
import type { JournalState, RoutingAttempt, RoutingEnvelopeRecord } from '../journal/types';

function assertTimestamp(value: string): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('routing timestamp is invalid'); }
function digest(value: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function clone(state: JournalState): JournalState { const next = structuredClone(state); if (!Array.isArray(next.routingAttempts)) next.routingAttempts = []; return next; }
export function reserveRoutingAttempt(state: JournalState, input: { obligationId: string; lineageId: string; envelope: RoutingEnvelopeRecord; fingerprint: string }, now: string): { state: JournalState; attemptId: string } {
    assertTimestamp(now); if (!input || !input.obligationId || !input.lineageId || !/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new Error('routing reservation is invalid');
    const next = clone(state); const envelopeDigest = digest(input.envelope); const existing = next.routingAttempts!.find(item => item.lineageId === input.lineageId && item.envelopeDigest === envelopeDigest && item.fingerprint === input.fingerprint && ['reserved', 'active'].includes(item.state));
    if (existing) return { state: next, attemptId: existing.id };
    const attempts = next.routingAttempts!.filter(item => item.lineageId === input.lineageId && item.envelope.role === 'implementer');
    if (input.envelope.role === 'implementer' && attempts.length >= 3) throw new Error('routing implementation budget exhausted');
    const attempt = attempts.length + 1; const id = `route-${crypto.createHash('sha256').update(`${input.lineageId}\0${attempt}\0${envelopeDigest}\0${input.fingerprint}`).digest('hex').slice(0, 24)}`;
    next.routingAttempts!.push({ id, obligationId: input.obligationId, lineageId: input.lineageId, attempt, envelope: structuredClone(input.envelope), envelopeDigest, fingerprint: input.fingerprint, state: 'reserved' });
    return { state: next, attemptId: id };
}
export function observeRoutingAttempt(state: JournalState, input: { attemptId: string; nativeAgentId: string }, now: string): JournalState {
    assertTimestamp(now); if (!input || !input.attemptId || !input.nativeAgentId) throw new Error('routing observation is invalid'); const next = clone(state); const attempt = next.routingAttempts!.find(item => item.id === input.attemptId); if (!attempt) throw new Error('routing attempt is unknown'); if (attempt.state !== 'reserved' && attempt.state !== 'active') throw new Error('routing attempt cannot be observed'); attempt.state = 'active'; attempt.nativeAgentId = input.nativeAgentId; return next;
}
