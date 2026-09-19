import path from 'path';
import { parseJsonNoDuplicate } from '../plan/json';
import { capabilityReceiptDigest, validateCapabilityReceipt } from './capabilities';
import { canonicalPolicyDigest } from './canonical';
import { readBoundedCandidate } from './store';
import { validatePolicyContent } from './validate';

/**
 * Read-only disclosure of the canonical digest a candidate file would be
 * approved under.
 *
 * Requiring `--expected-digest` on approval is deliberate: approval must be an
 * explicit operator act. That only holds if the operator can observe the digest
 * first, so this path exists to observe it and nothing else — it approves
 * nothing, writes nothing, and never consults the clock. Freshness stays the
 * approval path's business; a receipt can legitimately be digested before the
 * window it will be approved in.
 *
 * The digest is computed over the VALIDATED canonical form, exactly as the
 * approval path computes it, so a digest emitted here is the digest approval
 * will demand. An invalid document yields an error rather than a digest that
 * approval would then reject.
 */
export type CandidateSchema = 'model-policy/v1' | 'routing-capabilities/v1';
export interface CandidateDigest { schema: CandidateSchema; digest: string }
export interface CandidateDigestInput { file: string; cwd: string }

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function assertPath(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || CONTROL.test(value)) throw new Error(`${label} must be a bounded path without control characters`);
}

export function candidateDigest(input: CandidateDigestInput): CandidateDigest {
    if (!input || typeof input !== 'object') throw new Error('digest input is required');
    assertPath(input.file, 'file'); assertPath(input.cwd, 'cwd');
    const raw = readBoundedCandidate(path.resolve(path.resolve(input.cwd), input.file));
    if (raw === null) throw new Error('digest candidate is absent');
    const parsed = parseJsonNoDuplicate(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('digest candidate must be a JSON object');
    const schema = (parsed as Record<string, unknown>).schema;
    if (schema === 'model-policy/v1') return { schema, digest: canonicalPolicyDigest(validatePolicyContent(parsed)) };
    if (schema === 'routing-capabilities/v1') return { schema, digest: capabilityReceiptDigest(validateCapabilityReceipt(parsed)) };
    throw new Error('digest candidate must declare schema model-policy/v1 or routing-capabilities/v1');
}
