import crypto from 'crypto';
import { isRoutingEnvelope, isRoutingSelection, isWellFormedState, type JournalState, type RoutingEnvelopeRecord, type RoutingSelection } from '../journal/types';

function assertTimestamp(value: string): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('routing timestamp is invalid'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value !== null && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`; } return JSON.stringify(value); }
function digest(value: unknown): string { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function clone(state: JournalState): JournalState { const next = structuredClone(state); if (!Array.isArray(next.routingAttempts)) next.routingAttempts = []; return next; }
export function reserveRoutingAttempt(state: JournalState, input: { obligationId: string; lineageId: string; envelope: RoutingEnvelopeRecord; fingerprint: string }, now: string): { state: JournalState; attemptId: string } {
    assertTimestamp(now); if (!isWellFormedState(state) || !input || typeof input.obligationId !== 'string' || input.obligationId.length === 0 || input.obligationId.length > 128 || typeof input.lineageId !== 'string' || input.lineageId.length === 0 || input.lineageId.length > 128 || !isRoutingEnvelope(input.envelope) || !/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new Error('routing reservation is invalid');
    const next = clone(state); const envelopeDigest = digest(input.envelope); const existing = next.routingAttempts!.find(item => item.lineageId === input.lineageId && item.envelopeDigest === envelopeDigest && item.fingerprint === input.fingerprint && ['reserved', 'active'].includes(item.state));
    if (existing) return { state: next, attemptId: existing.id };
    if (input.envelope.role === 'implementer' && input.envelope.sliceId === undefined) throw new Error('routing implementer requires a slice');
    next.implementationLineages ??= [];
    const priorLineage = next.implementationLineages.find(lineage => lineage.id === input.lineageId);
    if (input.envelope.role === 'implementer' && priorLineage === undefined) next.implementationLineages.push({ id: input.lineageId, obligationId: input.obligationId, sliceId: input.envelope.sliceId!, planDigest: input.envelope.planDigest, executionDigest: input.envelope.executionDigest, attempts: 0 });
    if (priorLineage !== undefined && (priorLineage.obligationId !== input.obligationId || priorLineage.planDigest !== input.envelope.planDigest || priorLineage.executionDigest !== input.envelope.executionDigest || priorLineage.sliceId !== input.envelope.sliceId)) throw new Error('routing lineage binding mismatch');
    const attempts = next.routingAttempts!.filter(item => item.lineageId === input.lineageId && item.envelope.role === 'implementer');
    if (input.envelope.role === 'implementer' && attempts.length >= 3) throw new Error('routing implementation budget exhausted');
    const attempt = attempts.length + 1; const id = `route-${crypto.createHash('sha256').update(`${input.lineageId}\0${attempt}\0${envelopeDigest}\0${input.fingerprint}`).digest('hex').slice(0, 24)}`;
    next.routingAttempts!.push({ schema: 'routing-attempt/v1', id, obligationId: input.obligationId, lineageId: input.lineageId, attempt, envelope: structuredClone(input.envelope), envelopeDigest, fingerprint: input.fingerprint, state: 'reserved' });
    const lineage = next.implementationLineages.find(candidate => candidate.id === input.lineageId); if (lineage !== undefined) lineage.attempts = attempt;
    return { state: next, attemptId: id };
}
export function observeRoutingAttempt(state: JournalState, input: { attemptId: string; nativeAgentId: string; observed?: RoutingSelection; unavailableReason?: string }, now: string): JournalState {
    assertTimestamp(now); if (!isWellFormedState(state) || !input || typeof input.attemptId !== 'string' || input.attemptId.length === 0 || typeof input.nativeAgentId !== 'string' || input.nativeAgentId.length === 0 || input.nativeAgentId.length > 128 || (input.observed !== undefined && !isRoutingSelection(input.observed)) || (input.unavailableReason !== undefined && (typeof input.unavailableReason !== 'string' || input.unavailableReason.length === 0 || input.unavailableReason.length > 128))) throw new Error('routing observation is invalid'); const next = clone(state); const attempt = next.routingAttempts!.find(item => item.id === input.attemptId); if (!attempt) throw new Error('routing attempt is unknown'); if (attempt.state === 'active') { if (attempt.nativeAgentId === input.nativeAgentId && canonical(attempt.observed) === canonical(input.observed)) return next; throw new Error('routing observation is immutable'); } if (attempt.state !== 'reserved') throw new Error('routing attempt cannot be observed'); attempt.state = 'active'; attempt.nativeAgentId = input.nativeAgentId; if (input.observed) attempt.observed = structuredClone(input.observed); if (input.unavailableReason) attempt.reasonCode = input.unavailableReason; return next;
}
/** Read-only operational summary. Deliberately excludes envelopes, prompts and
 * native identities: this is safe to expose in a status command. */
export function routingReport(state: JournalState): { schema: 'routing-report/v1'; attempts: number; plannedByRole: Record<string, number>; actualByRole: Record<string, number>; byState: Record<string, number>; retries: number; fallbacks: number; unavailable: Record<string, number>; administrativeRepairs: number } {
    const attempts = state.routingAttempts ?? [];
    const plannedByRole: Record<string, number> = {}; const actualByRole: Record<string, number> = {}; const byState: Record<string, number> = {}; const unavailable: Record<string, number> = {};
    for (const attempt of attempts) {
        plannedByRole[attempt.envelope.role] = (plannedByRole[attempt.envelope.role] ?? 0) + 1;
        if (attempt.nativeAgentId !== undefined) actualByRole[attempt.envelope.role] = (actualByRole[attempt.envelope.role] ?? 0) + 1;
        byState[attempt.state] = (byState[attempt.state] ?? 0) + 1;
        for (const reason of attempt.envelope.unavailableEvidence) unavailable[reason] = (unavailable[reason] ?? 0) + 1;
    }
    return { schema: 'routing-report/v1', attempts: attempts.length, plannedByRole, actualByRole, byState, retries: attempts.filter((attempt) => attempt.attempt > 1).length, fallbacks: attempts.filter((attempt) => attempt.envelope.outcome === 'degraded').length, unavailable, administrativeRepairs: attempts.filter((attempt) => attempt.reasonCode !== undefined).length };
}
