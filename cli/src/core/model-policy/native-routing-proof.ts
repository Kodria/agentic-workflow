import { createHmac, timingSafeEqual } from 'crypto';
import { isRoutingSelection, type RoutingSelection } from '../journal/types';

const DOMAIN = 'AWM native routing attempt/v1\0';
export type NativeRoutingProof = {
    schema: 'native-routing-proof/v1';
    attemptId: string;
    nativeAgentId: string;
    source: 'codex-turn-context' | 'claude-assistant-transcript';
    eventDigest: string;
    observedAt: string;
    selection: RoutingSelection;
    actualModel?: string;
    mac: string;
};
type ProofBody = Omit<NativeRoutingProof, 'schema' | 'mac'>;

function validBody(value: unknown): value is ProofBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return Object.keys(row).length === (row.actualModel === undefined ? 6 : 7) && Object.keys(row).every(key => ['attemptId', 'nativeAgentId', 'source', 'eventDigest', 'observedAt', 'selection', 'actualModel'].includes(key))
        && typeof row.attemptId === 'string' && row.attemptId.length > 0 && row.attemptId.length <= 128
        && typeof row.nativeAgentId === 'string' && row.nativeAgentId.length > 0 && row.nativeAgentId.length <= 128
        && (row.source === 'codex-turn-context' || row.source === 'claude-assistant-transcript')
        && typeof row.eventDigest === 'string' && /^[a-f0-9]{64}$/.test(row.eventDigest)
        && typeof row.observedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observedAt)
        && Number.isFinite(Date.parse(row.observedAt)) && isRoutingSelection(row.selection)
        && (row.actualModel === undefined || (row.source === 'claude-assistant-transcript' && typeof row.actualModel === 'string' && row.actualModel.length > 0 && row.actualModel.length <= 128));
}
function signature(body: ProofBody, key: Buffer): string {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('native routing machine key is invalid');
    return createHmac('sha256', key).update(DOMAIN).update(JSON.stringify(body)).digest('hex');
}
export function signNativeRoutingProof(input: ProofBody, key: Buffer): NativeRoutingProof {
    if (!validBody(input)) throw new Error('native routing proof body is invalid');
    const body = { attemptId: input.attemptId, nativeAgentId: input.nativeAgentId, source: input.source,
        eventDigest: input.eventDigest, observedAt: input.observedAt, selection: input.selection,
        ...(input.actualModel === undefined ? {} : { actualModel: input.actualModel }) };
    return { schema: 'native-routing-proof/v1', ...body, mac: signature(body, key) };
}
export function verifyNativeRoutingProof(value: unknown, expected: { attemptId: string; nativeAgentId: string; reservedAt: string; selection: RoutingSelection }, key: Buffer, now: Date): value is NativeRoutingProof {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !expected || typeof expected !== 'object'
        || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== (row.actualModel === undefined ? 8 : 9) || row.schema !== 'native-routing-proof/v1' || typeof row.mac !== 'string' || !/^[a-f0-9]{64}$/.test(row.mac)) return false;
    const body = { attemptId: row.attemptId, nativeAgentId: row.nativeAgentId, source: row.source,
        eventDigest: row.eventDigest, observedAt: row.observedAt, selection: row.selection,
        ...(row.actualModel === undefined ? {} : { actualModel: row.actualModel }) };
    if (!validBody(body) || body.attemptId !== expected.attemptId || body.nativeAgentId !== expected.nativeAgentId
        || !isRoutingSelection(expected.selection)
        || typeof expected.reservedAt !== 'string' || !Number.isFinite(Date.parse(expected.reservedAt))) return false;
    const observedMs = Date.parse(body.observedAt);
    if (observedMs < Date.parse(expected.reservedAt) || observedMs > now.getTime() + 60_000 || now.getTime() - observedMs > 15 * 60_000) return false;
    return timingSafeEqual(Buffer.from(row.mac, 'hex'), Buffer.from(signature(body, key), 'hex'));
}
