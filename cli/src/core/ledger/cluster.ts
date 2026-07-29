// cli/src/core/ledger/cluster.ts
//
// Decisión de agrupamiento del ledger (issue #14) — funciones puras, sin fs ni
// git: store.ts es dueño del I/O, este módulo es dueño de "qué es el mismo
// hallazgo". El agrupamiento por firma exacta atrapa al mismo emisor
// reincidiendo; lo que este módulo agrega es la convergencia de varios
// revisores aislados sobre un mismo defecto, que es la señal más fuerte de
// sistemicidad y la que el agrupamiento exacto no puede ver.
import type { LedgerEntry } from './types';

/** Palabras sin valor discriminante de identidad de defecto: se descartan antes
 * de medir afinidad para que no inflen el score de dos hallazgos distintos. */
const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'not', 'but',
    'its', 'has', 'have', 'was', 'are', 'were', 'when', 'then', 'than', 'only',
    'all', 'any', 'via', 'per', 'out', 'off', 'over', 'under',
]);

export function normalizeTokens(...texts: string[]): Set<string> {
    const out = new Set<string>();
    for (const text of texts) {
        for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
            if (token.length < 2) continue;
            if (STOPWORDS.has(token)) continue;
            out.add(token);
        }
    }
    return out;
}

/** Coeficiente de solapamiento — |A∩B| / min(|A|,|B|). Elegido sobre Jaccard
 * porque el caso normal acá es un slug corto contra una descripción larga, y
 * Jaccard castiga esa diferencia de longitud incluso cuando el set corto está
 * completamente contenido en el largo. */
export function affinity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared++;
    return shared / Math.min(a.size, b.size);
}

/** El locus de archivo de un `ref`, o null cuando el ref no apunta a un archivo.
 * `PR #16` devuelve null a propósito: un PR entero no es un locus de defecto, y
 * agrupar por él fundiría todo lo hallado en una misma review. */
export function normalizeRef(ref: string | undefined): string | null {
    if (!ref) return null;
    const locus = ref.split(':')[0].trim();
    if (!locus) return null;
    if (!locus.includes('/') && !/\.[a-z0-9]+$/i.test(locus)) return null;
    return locus;
}
