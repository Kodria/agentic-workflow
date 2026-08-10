// Emisores de requests de track (R6.1): `add`/`join`/`remove` jamas mutan
// Git ni el journal directamente — el unico efecto observable es publicar
// una request inmutable que el supervisor del plan consume despues (mismo
// modelo single-writer de R1). La idempotencyKey se liga al journal
// (branch), al track y al tipo de intent, para que un retry genuino del
// mismo comando produzca la MISMA key (colapso seguro) mientras que dos
// intents distintos sobre el mismo track jamas colisionan.
import crypto from 'crypto';
import { emitRequest, type EmittedRequest, type RequestKind } from '../../core/journal/requests';
import { headSha, dirtyPaths } from '../../core/tracks/git';

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

/**
 * `track-finalize-request`: el autoreporte del controller del PLAN — "corrí la QA global
 * sobre el HEAD ya mergeado de todos los tracks, corregí los hallazgos y comiteé; este es
 * mi HEAD limpio".
 *
 * Es PLAN-scoped y no lleva `trackId`, por eso no pasa por `emitTrackRequest`.
 *
 * Sin este emisor la cohorte no tenía salida: `runRequestGlobalQa` (watch/tracks.ts) espera
 * `s.qaFinalizeRequested`, que solo se puebla aplicando esta request, y NADA en el producto
 * la emitía — el único lugar del repo que la producía era el harness de tests, llamando
 * `emitRequest` directo. Es decir, `COMPLETE` era alcanzable solo desde adentro de los
 * tests: en producción, con todos los tracks en `MERGED_UNVERIFIED`, el supervisor esperaba
 * para siempre una evidencia que ningún controller tenía forma de producir.
 *
 * El HEAD se LEE del repo, no se recibe por flag: el controller reporta el suyo, y un flag
 * solo abriría la puerta a reportar un HEAD ajeno. El árbol sucio se rechaza acá, en el
 * borde, para que el fallo diga qué falta en vez de manifestarse como una espera muda — pero
 * eso NO reemplaza la re-verificación independiente del supervisor (HEAD real + árbol
 * limpio en el momento de consumir la request), que sigue siendo la autoridad fail-closed.
 * El chequeo del borde es un diagnóstico, nunca la prueba.
 */
export function emitFinalizeRequest(
    repoRoot: string, branch: string, generationToken: string,
): EmittedRequest & { qaHeadSha: string } {
    const dirty = dirtyPaths(repoRoot);
    if (dirty.length > 0) {
        throw new Error(
            `el arbol del plan tiene ${dirty.length} ruta(s) sin comitear (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''}): `
            + 'la QA global se reporta sobre un HEAD limpio — comiteá las correcciones antes de finalizar',
        );
    }
    const qaHeadSha = headSha(repoRoot);
    // La key liga el SHA: re-reportar el mismo HEAD colapsa (retry seguro), y un HEAD nuevo
    // — porque la QA encontró algo más y se comiteó otra corrección — es una request nueva.
    const emitted = emitRequest(repoRoot, branch, {
        kind: 'track-finalize-request', generationToken,
        idempotencyKey: crypto.createHash('sha256')
            .update(`track-finalize-request\0${branch}\0${qaHeadSha}`).digest('hex'),
        payload: { qaHeadSha },
    });
    return { ...emitted, qaHeadSha };
}
