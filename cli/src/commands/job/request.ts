import crypto from 'crypto';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { emitRequest, EmittedRequest } from '../../core/journal/requests';

/** El agente NO ejecuta: registra la intencion (design R3.1). La idempotencyKey
 *  es hash(fingerprint + commandDigest) => get-or-create atomico (RNF-T.7).
 *  El cwd relativo REAL es parte del fingerprint (R3.4). `satisfies` enlaza el
 *  job con el item de VerificationPlan que pretende satisfacer (R1.4c). */
export function requestJob(repoRoot: string, branch: string, generationToken: string, argv: string[], paths: string[], cwdRel: string, opts: { satisfies?: string } = {}): EmittedRequest {
    const fp = computeFingerprint(repoRoot, argv, paths, cwdRel);
    const idempotencyKey = crypto.createHash('sha256').update(`${fp.fingerprint}:${fp.commandDigest}`).digest('hex');
    return emitRequest(repoRoot, branch, {
        kind: 'job-request', generationToken, idempotencyKey,
        payload: {
            argv, paths, cwd: cwdRel,
            fingerprint: fp.fingerprint, commandDigest: fp.commandDigest, expandedPaths: fp.expandedPaths,
            ...(opts.satisfies !== undefined ? { satisfies: opts.satisfies } : {}),
        },
    });
}
