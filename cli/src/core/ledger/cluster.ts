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

/** Umbral sin `ref` compartido: alto, porque la afinidad léxica es la única
 * evidencia disponible y un falso positivo acá funde hallazgos de archivos
 * distintos.
 *
 * Con `ref` compartido no hay umbral de ratio: alcanza **un token en común**
 * (`score > 0`). Es deliberado y no es lo mismo que "un umbral muy bajo":
 * compartir archivo ya es evidencia fuerte y barata de mismo locus, así que lo
 * único que falta descartar es el par sin ninguna palabra en común — dos
 * defectos genuinamente distintos que caen en el mismo archivo. Un ratio bajo
 * (probamos 0.2) hacía que el caso real del issue —tres lentes, siete a nueve
 * tokens cada una, un solo token compartido por par— cayera exactamente sobre
 * el borde: agrupaba por casualidad aritmética, y cualquier palabra más en una
 * descripción lo habría vuelto a romper. */
export const LEXICAL_AFFINITY_MIN = 0.6;

export type ClusterKind = 'exact' | 'convergent';

export interface RecurringCluster {
    /** Firma más frecuente del cluster (empate → primera lexicográfica). */
    signature: string;
    count: number;
    /** `exact`: una sola firma, el mismo emisor reincidiendo. `convergent`:
     * varias firmas, revisores independientes sobre un mismo defecto — señal
     * más fuerte de sistemicidad, por eso se etiqueta en vez de fundirse. */
    kind: ClusterKind;
    /** Todas las firmas distintas del cluster, orden ascendente. */
    signatures: string[];
    entries: LedgerEntry[];
}

/** Devuelve, por índice de entrada, el índice raíz de su cluster. */
function unify(entries: LedgerEntry[]): number[] {
    const parent = entries.map((_, i) => i);
    const find = (i: number): number => {
        let node = i;
        while (parent[node] !== node) {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        return node;
    };
    const union = (a: number, b: number): void => {
        const rootA = find(a);
        const rootB = find(b);
        // La raíz más baja gana: hace el resultado independiente del orden de
        // comparación, y por lo tanto determinístico.
        if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    };

    const tokens = entries.map((e) => normalizeTokens(e.signature, e.desc));
    const refs = entries.map((e) => normalizeRef(e.ref));

    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (entries[i].signature === entries[j].signature) {
                union(i, j);           // R1.1 — piso preservado, sin más condiciones
                continue;
            }
            if (entries[i].polarity !== entries[j].polarity) continue;  // R1.4
            const score = affinity(tokens[i], tokens[j]);
            const sameFile = refs[i] !== null && refs[i] === refs[j];
            // Mismo archivo: cualquier palabra en común alcanza (R1.2).
            // Archivos distintos: la afinidad tiene que sostener sola (R1.3).
            const unionable = sameFile ? score > 0 : score >= LEXICAL_AFFINITY_MIN;
            if (unionable) union(i, j);
        }
    }
    return entries.map((_, i) => find(i));
}

export function clusterEntries(entries: LedgerEntry[], min: number): RecurringCluster[] {
    const roots = unify(entries);
    const byRoot = new Map<number, LedgerEntry[]>();
    for (let i = 0; i < entries.length; i++) {
        const group = byRoot.get(roots[i]) ?? [];
        group.push(entries[i]);
        byRoot.set(roots[i], group);
    }

    const clusters: RecurringCluster[] = [];
    for (const group of byRoot.values()) {
        const freq = new Map<string, number>();
        for (const e of group) freq.set(e.signature, (freq.get(e.signature) ?? 0) + 1);
        const signatures = [...freq.keys()].sort();
        // signatures viene ascendente y la comparación es estricta, así que un
        // empate de frecuencia deja parada la primera lexicográfica (R1.8).
        const representative = signatures.reduce(
            (best, s) => (freq.get(s)! > freq.get(best)! ? s : best),
            signatures[0],
        );
        clusters.push({
            signature: representative,
            count: group.length,
            kind: signatures.length > 1 ? 'convergent' : 'exact',
            signatures,
            entries: group,
        });
    }

    return clusters
        .filter((c) => c.count >= min)
        .sort((a, b) =>
            b.count - a.count
            || (a.kind === b.kind ? 0 : a.kind === 'convergent' ? -1 : 1)
            || a.signature.localeCompare(b.signature));
}
