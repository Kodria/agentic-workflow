// Emisores de requests de track (R6.1): `add`/`join`/`remove` jamas mutan
// Git ni el journal directamente — el unico efecto observable es publicar
// una request inmutable que el supervisor del plan consume despues (mismo
// modelo single-writer de R1). La idempotencyKey se liga al journal
// (branch), al track y al tipo de intent, para que un retry genuino del
// mismo comando produzca la MISMA key (colapso seguro) mientras que dos
// intents distintos sobre el mismo track jamas colisionan.
import crypto from 'crypto';
import { emitRequest, type EmittedRequest, type RequestKind } from '../../core/journal/requests';

export function emitTrackRequest(
    repoRoot: string, branch: string, generationToken: string,
    kind: Extract<RequestKind, `track-${string}`>, trackId: string,
): EmittedRequest {
    if (trackId.length === 0) throw new Error('trackId obligatorio');
    const payload = { trackId };
    return emitRequest(repoRoot, branch, {
        kind, generationToken,
        idempotencyKey: crypto.createHash('sha256')
            .update(`${kind}\0${branch}\0${trackId}`).digest('hex'),
        payload,
    });
}
