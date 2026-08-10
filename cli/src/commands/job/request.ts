import crypto from 'crypto';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { emitRequest, EmittedRequest } from '../../core/journal/requests';
import { readJournal } from '../../core/journal/store';
import { dirtyPaths } from '../../core/tracks/git';

export interface RequestJobOptions {
    satisfies?: string | string[];
    // R7/C4 (Task 12): SOLO el finalizer (`watch/tracks.ts`) pasa esto — activa
    // el guard "canónico único" de Step 6 del plan ANTES de emitir la request.
    // Ningún caller de la CLI (`awm job request`) lo usa jamás.
    verificationKind?: 'track-integration';
}

function argvDigest(argv: string[]): string {
    return crypto.createHash('sha256').update(JSON.stringify(argv)).digest('hex');
}

/** El agente NO ejecuta: registra la intencion (design R3.1). La idempotencyKey
 *  es hash(fingerprint + commandDigest + satisfies) => get-or-create atomico
 *  (RNF-T.7). El cwd relativo REAL es parte del fingerprint (R3.4). `satisfies`
 *  enlaza el job con el/los item(s) de VerificationPlan que pretende satisfacer
 *  (R1.4c). R7 Task 12: `satisfies` migra a `string | string[]` — un caller
 *  singular (todo el codigo pre-Task-12) produce la MISMA idempotencyKey que
 *  antes (`[opts.satisfies].join('\0') === opts.satisfies`, y
 *  `[].join('\0') === ''` para `undefined`): la identidad mecanica de jobs
 *  existentes no cambia. El finalizer es el ÚNICO caller que pasa un array con
 *  MÁS de un elemento — siempre el conjunto COMPLETO y ordenado de
 *  `track-integration:*` de la cohorte (nunca un subconjunto, ver Step 5). */
export function requestJob(
    repoRoot: string, branch: string, generationToken: string, argv: string[], paths: string[], cwdRel: string,
    opts: RequestJobOptions = {},
): EmittedRequest {
    const fp = computeFingerprint(repoRoot, argv, paths, cwdRel);
    // La obligacion es parte de la identidad de la REQUEST, no de la ejecucion:
    // apply.ts reutiliza el job mecanicamente equivalente y enlaza los items
    // nuevos. El set se deduplica y ordena SIEMPRE — dos pedidos del mismo
    // comando con el mismo conjunto de satisfiers (en cualquier orden) deben
    // colapsar a la MISMA idempotencyKey.
    const satisfies = opts.satisfies === undefined ? []
        : Array.isArray(opts.satisfies) ? [...new Set(opts.satisfies)].sort() : [opts.satisfies];
    const idempotencyKey = crypto.createHash('sha256')
        .update(`${fp.fingerprint}:${fp.commandDigest}:${satisfies.join('\0')}`).digest('hex');
    if (opts.verificationKind === 'track-integration') {
        // Step 6 (R7.1/C3/C4): el job canónico de integración final SOLO se
        // pide con todos los merges aplicados, árbol limpio, y exactamente el
        // argv registrado como contrato de la cohorte — cualquier desviación
        // se rechaza ANTES de tocar el requestsDir (fail-closed, nunca se
        // emite una request que `apply.ts` tendría que rechazar después).
        const r = readJournal(repoRoot, branch);
        if (r.corrupt || r.state === null) throw new Error('track-integration requiere journal legible (R1.6)');
        const s = r.state;
        if (s.tracks?.some((t) => t.phase !== 'MERGED_UNVERIFIED')) {
            throw new Error('track-integration requiere todos los merges aplicados');
        }
        if (dirtyPaths(repoRoot).length > 0) throw new Error('track-integration requiere árbol limpio');
        if (s.trackIntegration === undefined) throw new Error('track-integration requiere un contrato canónico registrado');
        if (argvDigest(argv) !== argvDigest(s.trackIntegration.argv)) throw new Error('argv de integración no canónico');
    }
    return emitRequest(repoRoot, branch, {
        kind: 'job-request', generationToken, idempotencyKey,
        payload: {
            argv, paths, cwd: cwdRel,
            fingerprint: fp.fingerprint, commandDigest: fp.commandDigest, expandedPaths: fp.expandedPaths,
            ...(satisfies.length > 0 ? { satisfies } : {}),
        },
    });
}
