# Ledger Clustering + Export Path Cleanup Implementation Plan
<!-- awm-qa-complete: 2026-07-29 -->
<!-- awm-retro-complete: 2026-07-29 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que `awm ledger recurring` detecte convergencia entre revisores independientes (no solo firmas idénticas), y que el export mecánico a claude.ai deje de embarcar paths intra-registry que nunca resuelven.

**Architecture:** Dos releases independientes en un solo documento. Release A mueve la decisión de agrupamiento del ledger a un módulo puro nuevo (`core/ledger/cluster.ts`) que une entradas por tres señales — firma exacta, mismo archivo en `ref`, y afinidad léxica — y etiqueta cada cluster como `exact` o `convergent`; `store.ts` queda como dueño único del I/O. Release B agrega una función pura de limpieza de paths al transform de claude-ai, aplicada solo al body y solo en el camino mecánico (los overrides siguen verbatim).

**Tech Stack:** TypeScript, Node 20+, Jest + ts-jest (`cd cli && npm test`), Commander.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

## Nota de alcance — dos releases, un documento

Los dos issues son **subsistemas independientes**: no comparten código, tipos ni archivos, y cada uno produce software funcionando por su cuenta. Se documentan juntos por pedido explícito (cerrar los dos temas en un ciclo), no porque estén acoplados.

**Consecuencia operativa:** Release A (Tasks 1–4) y Release B (Tasks 5–7) se pueden ejecutar en cualquier orden, o en paralelo en ramas distintas. Ningún task de B depende de un task de A. Si uno de los dos se cae en QA, el otro se mergea igual.

| Release | Issue | Alcance |
|---|---|---|
| A | [#14](https://github.com/Kodria/agentic-workflow/issues/14) | `awm ledger recurring` agrupa por similitud, etiqueta convergencia |
| B | [#12](https://github.com/Kodria/agentic-workflow/issues/12) | El transform mecánico limpia paths intra-registry muertos |

---

## Requirements

### Release A — recurrence clustering (#14)

- **R1.1** El sistema DEBE agrupar en un mismo cluster las entradas que comparten `signature` idéntica. *(Piso de regresión: es el único caso que la herramienta hoy sí atrapa — el mismo emisor reincidiendo entre tareas.)*
- **R1.2** CUANDO dos entradas del mismo ledger citan el mismo archivo fuente en `ref` Y comparten al menos un token normalizado entre `signature` + `desc`, el sistema DEBE ubicarlas en un mismo cluster aunque sus `signature` difieran.
- **R1.3** CUANDO dos entradas no comparten archivo en `ref` Y su afinidad léxica combinada es ≥ `LEXICAL_AFFINITY_MIN`, el sistema DEBE ubicarlas en un mismo cluster.
- **R1.4** El sistema NO DEBE unir dos entradas de `polarity` distinta apoyándose solo en R1.2 o R1.3. *(Un win y un finding en el mismo archivo no son el mismo hecho.)*
- **R1.5** El sistema DEBE etiquetar cada cluster como `exact` cuando contiene una sola `signature` distinta y `convergent` cuando contiene dos o más, y DEBE reportar todas las signatures distintas del cluster.
- **R1.6** El sistema DEBE normalizar tokens bajando a minúsculas, partiendo en fronteras no alfanuméricas, descartando tokens de menos de dos caracteres y descartando un set fijo de stopwords.
- **R1.7** El sistema DEBE tratar un `ref` como locus de archivo solo cuando su porción previa al primer `:` contiene `/` o termina en extensión de archivo; cualquier otro `ref` (ej. `PR #16`) NO DEBE aportar señal de agrupamiento.
- **R1.8** El sistema DEBE mantener poblados los campos existentes de `RecurringCluster` (`signature`, `count`, `entries`), siendo `signature` la firma más frecuente del cluster y, en empate, la primera en orden lexicográfico.
- **R1.9** El sistema DEBE ordenar los clusters por `count` descendente, luego `convergent` antes que `exact`, luego por `signature` representativa ascendente.
- **R1.10** La referencia del CLI DEBE describir que el agrupamiento cubre convergencia entre emisores distintos, no solo firmas idénticas.

### Release B — export path cleanup (#12)

- **R2.1** CUANDO el contenido completo de un paréntesis es un path intra-registry, opcionalmente prefijado por `see`, el transform mecánico DEBE eliminar el paréntesis junto con el espacio horizontal que lo precede.
- **R2.2** CUANDO un path intra-registry aparece en cualquier otra posición del body, el transform DEBE reemplazar el path por una referencia humana sin path.
- **R2.3** La forma sin path DEBE ser `` the `<skill>` skill `` para `skills/<skill>/SKILL.md`, y `` the `<skill>` skill's <file> reference `` para `skills/<skill>/references/<file>.md`, con los guiones de `<file>` renderizados como espacios.
- **R2.4** El transform DEBE aplicar la limpieza únicamente al body, dejando el bloque de frontmatter sin más cambios que los que ya hacía (quitar `version`/`portable`, extender `description`).
- **R2.5** Una skill exportada vía override `port.claude-ai.md` DEBE quedar verbatim — sin limpieza de paths.
- **R2.6** El transform DEBE dejar intacto un path que es parte de una URL o de un path más largo (es decir, precedido por `/`), porque esas referencias sí resuelven para el destinatario.
- **R2.7** La referencia del CLI DEBE mencionar la limpieza de paths como parte del transform mecánico.

### Fuera de alcance (decidido, no pendiente)

- **Punto 2 del issue #12** (omitir `references/` cuando hay override) — se descarta por YAGNI. Copiar `references/` es inofensivo y `pack.ts` lo hace byte-idéntico por R3.2; romper esa invariante para ahorrar peso muerto inofensivo no se justifica.
- **Limpieza de paths dentro de `references/*.md`** — queda fuera por la misma razón: `pack.ts` copia ese árbol byte-idéntico y esa garantía vale más que el residuo. Residuo conocido y aceptado: `skills/product-brief/references/brief-template.md:5` cita `skills/readiness-gate/references/brief-contract.md` y seguirá citándolo en el artefacto exportado. Es una línea de comentario en un template que el override de `product-brief` nunca referencia.
- **Vocabulario controlado de `signature` en los emisores** (punto 4 del issue #14) — complementario, no sustituto, y vive en los prompts de revisión del registry (`awm-baseline-registry`), no en este repo.
- **Prosa de `harness-retro` sobre el nuevo campo `kind`** — vive en `awm-baseline-registry`. El campo se agrega acá de forma retrocompatible; si el retro quiere leerlo, es un cambio de contenido en el otro repo.

---

## File structure

### Release A

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/ledger/cluster.ts` | **Nuevo.** Decisión de agrupamiento, 100% pura: normalización de tokens, afinidad, normalización de `ref`, union-find y armado/orden de clusters. Sin `fs`, sin `git`. |
| `cli/src/core/ledger/store.ts` | Queda como dueño único del I/O: `recurring()` pasa a delegar en `clusterEntries` y re-exporta el tipo. |
| `cli/src/commands/ledger/index.ts` | Solo la descripción del subcomando (`recurring`). |
| `cli/tests/core/ledger/cluster.test.ts` | **Nuevo.** Unit puro de las primitivas y del agrupamiento. |
| `cli/tests/core/ledger/store.test.ts` | Actualiza fixtures que asumían agrupamiento exacto; agrega el pin de convergencia sobre archivo. |
| `docs/cli-reference.md` | Sección `awm ledger recurring`. |

El agrupamiento va en archivo aparte y no dentro de `store.ts` porque son dos responsabilidades con fronteras distintas: `store.ts` hace I/O (y por eso sus tests necesitan tmpdirs), mientras que la decisión de qué es "el mismo hallazgo" es pura y se testea sin tocar disco. Mezclarlas obligaría a montar un ledger en disco para probar un umbral de similitud.

### Release B

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/export/transform.ts` | Agrega `stripIntraRegistryPaths` (pura) y la aplica al body dentro de `claudeAiTransform`. |
| `cli/tests/core/export/transform.test.ts` | Unit de la limpieza, incluyendo los casos reales del registry y el guard de URLs. |
| `cli/tests/core/export/engine.test.ts` | Pin de que el override sigue verbatim (fixture extendido con un path). |
| `docs/cli-reference.md` | Sección `awm export <name>`. |

La limpieza vive dentro de `transform.ts` (56 líneas hoy) y no en un módulo nuevo: es la misma responsabilidad —adaptar contenido canónico al formato claude.ai— y el archivo sigue siendo chico y enfocado después del cambio.

---

# Release A — recurrence clustering (#14)

### Task 1: Primitivas puras de similitud

_Requirements: R1.6, R1.7_

**Files:**
- Create: `cli/src/core/ledger/cluster.ts`
- Test: `cli/tests/core/ledger/cluster.test.ts`

- [ ] **Step 1: Escribir los tests rojos de las primitivas**

Crear `cli/tests/core/ledger/cluster.test.ts`:

```ts
import { normalizeTokens, affinity, normalizeRef } from '../../../src/core/ledger/cluster';

describe('normalizeTokens', () => {
    test('lowercases and splits slugs on non-alphanumeric boundaries', () => {  // verifies R1.6
        expect([...normalizeTokens('Validator-Skips_Agents.References')].sort())
            .toEqual(['agents', 'references', 'skips', 'validator']);
    });

    test('drops tokens shorter than two characters', () => {  // verifies R1.6
        expect([...normalizeTokens('a b ok x')].sort()).toEqual(['ok']);
    });

    test('drops stopwords so they cannot inflate affinity', () => {  // verifies R1.6
        expect([...normalizeTokens('the gate walks only the skills')].sort())
            .toEqual(['gate', 'skills', 'walks']);
    });

    test('merges tokens across every text it is given', () => {  // verifies R1.6
        expect([...normalizeTokens('gate-walks', 'skills dir')].sort())
            .toEqual(['dir', 'gate', 'skills', 'walks']);
    });
});

describe('affinity', () => {
    test('is the overlap coefficient, so a contained short set scores 1', () => {  // verifies R1.6
        const short = normalizeTokens('validator gate');
        const long = normalizeTokens('validator gate walks the skills directory only');
        expect(affinity(short, long)).toBe(1);
    });

    test('is 0 for disjoint sets', () => {  // verifies R1.6
        expect(affinity(normalizeTokens('alpha slug'), normalizeTokens('beta timeout'))).toBe(0);
    });

    test('is 0 when either side is empty', () => {  // verifies R1.6
        expect(affinity(new Set<string>(), normalizeTokens('alpha'))).toBe(0);
    });
});

describe('normalizeRef', () => {
    test('strips the line number and keeps the file locus', () => {  // verifies R1.7
        expect(normalizeRef('scripts/validate-portability.mjs:41')).toBe('scripts/validate-portability.mjs');
    });

    test('accepts a bare filename with an extension', () => {  // verifies R1.7
        expect(normalizeRef('split.ts:12')).toBe('split.ts');
    });

    test('rejects a non-file ref: a whole PR is not a defect locus', () => {  // verifies R1.7
        expect(normalizeRef('PR #16')).toBeNull();
    });

    test('rejects a URL, whose pre-colon portion carries no locus', () => {  // verifies R1.7
        expect(normalizeRef('https://github.com/Kodria/agentic-workflow/pull/15')).toBeNull();
    });

    test('returns null for a missing ref', () => {  // verifies R1.7
        expect(normalizeRef(undefined)).toBeNull();
    });
});
```

- [ ] **Step 2: Correr los tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/core/ledger/cluster.test.ts`

Expected: FAIL — `Cannot find module '../../../src/core/ledger/cluster'`.

- [ ] **Step 3: Implementar las primitivas**

Crear `cli/src/core/ledger/cluster.ts`:

```ts
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
```

- [ ] **Step 4: Correr los tests para comprobar GREEN**

Run: `cd cli && npm test -- --runTestsByPath tests/core/ledger/cluster.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/ledger/cluster.ts cli/tests/core/ledger/cluster.test.ts
git commit -m "feat(ledger): add pure similarity primitives for recurrence clustering"
```

---

### Task 2: Agrupamiento por tres señales, con etiqueta de convergencia

_Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.8, R1.9_

**Files:**
- Modify: `cli/src/core/ledger/cluster.ts`
- Test: `cli/tests/core/ledger/cluster.test.ts`

- [ ] **Step 1: Escribir los tests rojos del agrupamiento**

Primero, reemplazar la línea de import del tope de `cli/tests/core/ledger/cluster.test.ts` por estas dos:

```ts
import { normalizeTokens, affinity, normalizeRef, clusterEntries } from '../../../src/core/ledger/cluster';
import type { LedgerEntry } from '../../../src/core/ledger/types';
```

Después, agregar al final del archivo:

```ts
function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        ts: '2026-07-25T00:00:00.000Z',
        branch: 'feat-x',
        phase: 'post-qa',
        source_skill: 'post-implementation-qa',
        polarity: 'finding',
        class: 'logica',
        signature: 'some-finding',
        severity: 'important',
        desc: 'something is wrong',
        ref: 'src/some.ts:1',
        ...over,
    };
}

describe('clusterEntries — exact signature floor', () => {
    test('groups identical signatures and honours min', () => {  // verifies R1.1
        const clusters = clusterEntries([
            entry({ signature: 'dup', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }),
            entry({ signature: 'dup', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }),
            entry({ signature: 'solo', desc: 'beta timeout on retry', ref: 'src/b.ts:9' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ signature: 'dup', count: 2, kind: 'exact' });
    });

    test('unions identical signatures even across unrelated files and descriptions', () => {  // verifies R1.1
        const clusters = clusterEntries([
            entry({ signature: 'same-slug', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }),
            entry({ signature: 'same-slug', desc: 'beta timeout on retry', ref: 'src/b.ts:9' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].count).toBe(2);
    });

    test('unions identical signatures regardless of polarity, as before', () => {  // verifies R1.1
        const clusters = clusterEntries([
            entry({ signature: 'same-slug', polarity: 'finding' }),
            entry({ signature: 'same-slug', polarity: 'win' }),
        ], 2);
        expect(clusters).toHaveLength(1);
    });
});

describe('clusterEntries — convergence on a shared file', () => {
    // El caso real del 2026-07-25: tres lentes aisladas, tres slugs distintos,
    // un solo defecto (el gate de portabilidad recorría solo skills/).
    const threeLenses = () => [
        entry({
            signature: 'validator-skips-agents-references',
            desc: 'the portability validator never walks agents/ references',
            ref: 'scripts/validate-portability.mjs:41',
            source_skill: 'fidelity-lens',
        }),
        entry({
            signature: 'validator-scope-skills-only',
            desc: 'validator scope covers skills only, missing sibling trees',
            ref: 'scripts/validate-portability.mjs:41',
            source_skill: 'logic-lens',
        }),
        entry({
            signature: 'gate-walks-skills-only',
            desc: 'the gate walks skills and nothing else',
            ref: 'scripts/validate-portability.mjs:58',
            source_skill: 'robustness-lens',
        }),
    ];

    test('clusters three independent lenses on one defect', () => {  // verifies R1.2
        const clusters = clusterEntries(threeLenses(), 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].count).toBe(3);
    });

    test('labels the cluster convergent and lists every distinct signature', () => {  // verifies R1.5
        const clusters = clusterEntries(threeLenses(), 2);
        expect(clusters[0].kind).toBe('convergent');
        expect(clusters[0].signatures).toEqual([
            'gate-walks-skills-only',
            'validator-scope-skills-only',
            'validator-skips-agents-references',
        ]);
    });

    test('does NOT merge two unrelated defects that happen to share a file', () => {  // verifies R1.2
        const clusters = clusterEntries([
            entry({
                signature: 'gate-walks-skills-only',
                desc: 'the gate walks skills and nothing else',
                ref: 'scripts/validate-portability.mjs:58',
            }),
            entry({
                signature: 'exit-code-swallowed',
                desc: 'process exits zero after a failed assertion',
                ref: 'scripts/validate-portability.mjs:58',
            }),
        ], 2);
        expect(clusters).toEqual([]);
    });

    test('does NOT merge a win with a finding on the strength of a shared file', () => {  // verifies R1.4
        const clusters = clusterEntries([
            entry({ signature: 'gate-walks-skills-only', desc: 'the gate walks skills only', ref: 'a.mjs:1', polarity: 'finding' }),
            entry({ signature: 'gate-walks-skills-fix', desc: 'the gate walks skills only, now fixed', ref: 'a.mjs:1', polarity: 'win' }),
        ], 2);
        expect(clusters).toEqual([]);
    });

    test('a non-file ref contributes no clustering signal', () => {  // verifies R1.7
        const clusters = clusterEntries([
            entry({ signature: 'alpha-defect', desc: 'alpha slug mismatch', ref: 'PR #16' }),
            entry({ signature: 'beta-defect', desc: 'beta timeout on retry', ref: 'PR #16' }),
        ], 2);
        expect(clusters).toEqual([]);
    });
});

describe('clusterEntries — lexical convergence without a shared file', () => {
    test('clusters near-identical wording across different files', () => {  // verifies R1.3
        const clusters = clusterEntries([
            entry({ signature: 'vacuous-test-asserts-nothing', desc: 'test asserts nothing meaningful', ref: 'tests/a.test.ts:3' }),
            entry({ signature: 'vacuous-test-asserts-nothing-either', desc: 'test asserts nothing meaningful', ref: 'tests/b.test.ts:7' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].kind).toBe('convergent');
    });

    test('leaves weakly-related findings on different files apart', () => {  // verifies R1.3
        const clusters = clusterEntries([
            entry({ signature: 'validator-scope-skills-only', desc: 'validator scope covers skills', ref: 'src/a.ts:1' }),
            entry({ signature: 'gate-walks-skills-only', desc: 'the gate walks skills', ref: 'src/b.ts:1' }),
        ], 2);
        expect(clusters).toEqual([]);
    });
});

describe('clusterEntries — representative and ordering', () => {
    test('representative signature is the most frequent one', () => {  // verifies R1.8
        const clusters = clusterEntries([
            entry({ signature: 'zeta-frequent', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
            entry({ signature: 'zeta-frequent', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
            entry({ signature: 'alpha-rare', desc: 'gate walks skills only, second lens', ref: 'a.mjs:1' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].signature).toBe('zeta-frequent');
        expect(clusters[0].count).toBe(3);
    });

    test('ties on frequency resolve to the lexicographically first signature', () => {  // verifies R1.8
        const clusters = clusterEntries([
            entry({ signature: 'zeta-lens', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
            entry({ signature: 'alpha-lens', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
        ], 2);
        expect(clusters[0].signature).toBe('alpha-lens');
    });

    test('sorts by count desc, then convergent before exact, then signature asc', () => {  // verifies R1.9
        const clusters = clusterEntries([
            // convergent cluster of 2 on one file
            entry({ signature: 'mid-one', desc: 'gate walks skills only', ref: 'mid.mjs:1' }),
            entry({ signature: 'mid-two', desc: 'gate walks skills only, other lens', ref: 'mid.mjs:1' }),
            // exact cluster of 2, unrelated
            entry({ signature: 'exact-dup', desc: 'alpha slug mismatch', ref: 'exact.ts:1' }),
            entry({ signature: 'exact-dup', desc: 'alpha slug mismatch', ref: 'exact.ts:1' }),
            // exact cluster of 3, unrelated — highest count wins regardless of kind
            entry({ signature: 'top-dup', desc: 'beta timeout on retry', ref: 'top.ts:1' }),
            entry({ signature: 'top-dup', desc: 'beta timeout on retry', ref: 'top.ts:1' }),
            entry({ signature: 'top-dup', desc: 'beta timeout on retry', ref: 'top.ts:1' }),
        ], 2);
        expect(clusters.map((c) => [c.signature, c.count, c.kind])).toEqual([
            ['top-dup', 3, 'exact'],
            ['mid-one', 2, 'convergent'],
            ['exact-dup', 2, 'exact'],
        ]);
    });

    test('an empty ledger yields no clusters', () => {  // verifies R1.1
        expect(clusterEntries([], 2)).toEqual([]);
    });
});
```

- [ ] **Step 2: Correr los tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/core/ledger/cluster.test.ts`

Expected: FAIL — `clusterEntries is not a function` (las primitivas del Task 1 siguen en verde).

- [ ] **Step 3: Implementar tipos, umbrales y union-find**

Agregar al final de `cli/src/core/ledger/cluster.ts`:

```ts
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
            (best, s) => ((freq.get(s) as number) > (freq.get(best) as number) ? s : best),
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
```

- [ ] **Step 4: Correr los tests para comprobar GREEN**

Run: `cd cli && npm test -- --runTestsByPath tests/core/ledger/cluster.test.ts`

Expected: PASS, 26 tests (los 12 del Task 1 más los 14 nuevos).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/ledger/cluster.ts cli/tests/core/ledger/cluster.test.ts
git commit -m "feat(ledger): cluster by ref and lexical affinity, labelling convergence"
```

---

### Task 3: Conectar `recurring()` al agrupamiento nuevo

_Requirements: R1.1, R1.2, R1.5, R1.8_

**Files:**
- Modify: `cli/src/core/ledger/store.ts:42-60`
- Test: `cli/tests/core/ledger/store.test.ts:85-115`

> **Contexto que el implementador necesita:** el fixture `entry()` de
> `store.test.ts` (líneas 11–25) define un `ref` (`src/split.ts:12`) y un `desc`
> (`splitBill(100,0) returns Infinity`) **idénticos** para todas las entradas, y
> los tests existentes solo sobreescriben `signature`. Eso era correcto cuando el
> agrupamiento era exacto, pero con R1.2 esas entradas ahora comparten archivo y
> descripción, así que convergen a un solo cluster. Los tests se actualizan para
> dar loci y descripciones distintas a las entradas que el test quiere separadas
> — **no** para relajar las aserciones. Si un test empieza a pasar porque se le
> quitó una aserción, está mal hecho.

- [ ] **Step 1: Actualizar los tests existentes y agregar el pin de convergencia**

En `cli/tests/core/ledger/store.test.ts`, reemplazar el bloque `describe('ledger store — recurring', ...)` completo (líneas 85–115) por:

```ts
describe('ledger store — recurring', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('groups by signature and reports clusters with count >= min', () => {  // verifies R1.1
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'solo', ref: 'src/other.ts:3', desc: 'pagination cursor skips a page' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ signature: 'dup', count: 2, kind: 'exact' });
        expect(clusters[0].entries).toHaveLength(2);
    });

    test('respects --min: count 2 is excluded when min is 3', () => {  // verifies R1.1
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        expect(recurring(cwd, 'feat-x', 3)).toEqual([]);
    });

    test('sorts clusters by count descending', () => {  // verifies R1.9
        addEntry(cwd, entry({ signature: 'a', ref: 'src/a.ts:1', desc: 'alpha slug mismatch' }));
        addEntry(cwd, entry({ signature: 'a', ref: 'src/a.ts:1', desc: 'alpha slug mismatch' }));
        addEntry(cwd, entry({ signature: 'b', ref: 'src/b.ts:1', desc: 'beta timeout on retry' }));
        addEntry(cwd, entry({ signature: 'b', ref: 'src/b.ts:1', desc: 'beta timeout on retry' }));
        addEntry(cwd, entry({ signature: 'b', ref: 'src/b.ts:1', desc: 'beta timeout on retry' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters.map(c => c.signature)).toEqual(['b', 'a']);
    });

    test('reports independent lenses on one file as a single convergent cluster', () => {  // verifies R1.2, R1.5
        addEntry(cwd, entry({
            signature: 'validator-scope-skills-only',
            desc: 'validator scope covers skills only',
            ref: 'scripts/validate-portability.mjs:41',
        }));
        addEntry(cwd, entry({
            signature: 'gate-walks-skills-only',
            desc: 'the gate walks skills and nothing else',
            ref: 'scripts/validate-portability.mjs:58',
        }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ count: 2, kind: 'convergent' });
        expect(clusters[0].signatures).toEqual(['gate-walks-skills-only', 'validator-scope-skills-only']);
    });
});
```

- [ ] **Step 2: Correr los tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/core/ledger/store.test.ts`

Expected: FAIL — el test de convergencia falla (`toHaveLength(1)` recibe `[]`, porque el agrupamiento exacto no une firmas distintas) y los tres primeros pasan.

- [ ] **Step 3: Delegar `recurring()` en `clusterEntries`**

En `cli/src/core/ledger/store.ts`, reemplazar el bloque completo que va desde `export interface RecurringCluster {` hasta el cierre de `export function recurring(...)` (líneas 42–60) por:

```ts
export type { RecurringCluster, ClusterKind } from './cluster';

export function recurring(cwd: string, branch: string, min: number): RecurringCluster[] {
    return clusterEntries(listEntries(cwd, branch), min);
}
```

Y agregar el import al encabezado del archivo, debajo de `import type { LedgerEntry } from './types';`:

```ts
import { clusterEntries } from './cluster';
import type { RecurringCluster } from './cluster';
```

- [ ] **Step 4: Correr la suite completa para comprobar GREEN sin regresiones**

Run: `cd cli && npm test`

Expected: PASS en toda la suite. Si `tests/commands/ledger/index.test.ts` falla, es señal de que asume la forma vieja del cluster — revisar la aserción concreta antes de tocarla: los campos `signature`, `count` y `entries` siguen presentes por R1.8, así que un fallo ahí indica una aserción sobre el objeto completo (`toEqual`) que debe pasar a `toMatchObject` o incorporar `kind` y `signatures`.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/ledger/store.ts cli/tests/core/ledger/store.test.ts
git commit -m "fix(ledger): recurring groups by similarity, not exact signature only"
```

---

### Task 4: Documentar el agrupamiento nuevo

_Requirements: R1.10_

**Files:**
- Modify: `cli/src/commands/ledger/index.ts:64`
- Modify: `docs/cli-reference.md:268-274`

- [ ] **Step 1: Actualizar la descripción del subcomando**

En `cli/src/commands/ledger/index.ts`, en la definición del subcomando `recurring`, reemplazar:

```ts
        .description('print signature clusters with count >= min (recurrence signal)')
```

por:

```ts
        .description('print recurrence clusters with count >= min (exact signature repeats and cross-reviewer convergence)')
```

- [ ] **Step 2: Actualizar la referencia del CLI**

En `docs/cli-reference.md`, reemplazar la sección `### awm ledger recurring` completa (líneas 268–274) por:

```markdown
### `awm ledger recurring`

Print recurrence clusters whose count meets a threshold (the recurrence signal `harness-retro` reads).

```
awm ledger recurring [--min <n>]    # default --min 2
```

Clustering uses three signals, in order of confidence: identical `signature`, then a shared
source file in `ref` plus at least one word in common, then strong word overlap alone. Each
cluster carries a `kind`:

| `kind` | Meaning |
|---|---|
| `exact` | One distinct signature — the same emitter recurring across tasks. |
| `convergent` | Two or more distinct signatures — independent reviewers landing on one defect, the stronger signal of a systemic problem. |

Convergent clusters also list every distinct signature in `signatures`; `signature` itself is the
most frequent one in the cluster. A `ref` that is not a file locus (e.g. `PR #16`) contributes no
clustering signal, and a win is never merged with a finding on the strength of a shared file.
```

- [ ] **Step 3: Verificar que el build y la suite siguen verdes**

Run: `cd cli && npm run build && npm test`

Expected: build sin errores de TypeScript, suite en PASS.

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/ledger/index.ts docs/cli-reference.md
git commit -m "docs(ledger): document exact vs convergent recurrence clusters"
```

---

# Release B — export path cleanup (#12)

### Task 5: Función pura de limpieza de paths intra-registry

_Requirements: R2.1, R2.2, R2.3, R2.6_

**Files:**
- Modify: `cli/src/core/export/transform.ts`
- Test: `cli/tests/core/export/transform.test.ts`

> **Contexto que el implementador necesita:** los casos de este test no son
> inventados — son las cinco formas que realmente aparecen hoy en las skills
> `portable: true` de `awm-baseline-registry` (`product-discovery` líneas 14, 20,
> 98, 100 y `product-brief` línea 70). Cubrirlas es el criterio de éxito del
> issue.

- [ ] **Step 1: Escribir los tests rojos de la limpieza**

Agregar al final de `cli/tests/core/export/transform.test.ts` (y extender su import de `../../../src/core/export/transform` para incluir `stripIntraRegistryPaths`):

```ts
describe('stripIntraRegistryPaths', () => {
    test('drops a parenthetical whose only content is a see-path', () => {  // verifies R2.1
        expect(stripIntraRegistryPaths(
            'crystallize into a `product-brief` (see `skills/product-brief/SKILL.md`) — the handoff.',
        )).toBe('crystallize into a `product-brief` — the handoff.');
    });

    test('drops a bare-path parenthetical without leaving a space before the comma', () => {  // verifies R2.1
        expect(stripIntraRegistryPaths(
            'Same discipline as `brainstorming` (see `skills/brainstorming/SKILL.md`), applied at the business level.',
        )).toBe('Same discipline as `brainstorming`, applied at the business level.');
    });

    test('drops a parenthetical holding only a references path', () => {  // verifies R2.1
        expect(stripIntraRegistryPaths(
            "conforming to the brief contract's frontmatter (`skills/readiness-gate/references/brief-contract.md`), using:",
        )).toBe("conforming to the brief contract's frontmatter, using:");
    });

    test('rewrites a path in place when the parenthetical carries more text', () => {  // verifies R2.2, R2.3
        expect(stripIntraRegistryPaths(
            'the literal YAML block below (see `skills/readiness-gate/references/brief-contract.md` for the full normative rules).',
        )).toBe(
            "the literal YAML block below (see the `readiness-gate` skill's brief contract reference for the full normative rules).",
        );
    });

    test('rewrites a bare unquoted path in prose', () => {  // verifies R2.2, R2.3
        expect(stripIntraRegistryPaths(
            'shape are normative — see skills/readiness-gate/references/brief-contract.md.',
        )).toBe("shape are normative — see the `readiness-gate` skill's brief contract reference.");
    });

    test('renders a SKILL.md path as a nameless skill reference', () => {  // verifies R2.3
        expect(stripIntraRegistryPaths('invoke `skills/readiness-gate/SKILL.md` to certify it.'))
            .toBe('invoke the `readiness-gate` skill to certify it.');
    });

    test('leaves a GitHub URL containing the same path untouched', () => {  // verifies R2.6
        const url = 'see https://github.com/Kodria/awm-baseline-registry/blob/main/skills/readiness-gate/SKILL.md for the source.';
        expect(stripIntraRegistryPaths(url)).toBe(url);
    });

    test('leaves a markdown link whose target is a URL untouched', () => {  // verifies R2.6
        const link = '[the gate](https://github.com/Kodria/awm-baseline-registry/blob/main/skills/readiness-gate/references/brief-contract.md)';
        expect(stripIntraRegistryPaths(link)).toBe(link);
    });

    test('leaves prose with no intra-registry path byte-identical', () => {  // verifies R2.2
        const body = '# Heading\n\nA body that cites `docs/plans/x.md` and nothing else.\n';
        expect(stripIntraRegistryPaths(body)).toBe(body);
    });

    test('handles several paths in one body', () => {  // verifies R2.1, R2.2
        expect(stripIntraRegistryPaths(
            'hand off to `product-brief` (`skills/product-brief/SKILL.md`) then invoke `skills/readiness-gate/SKILL.md`.',
        )).toBe('hand off to `product-brief` then invoke the `readiness-gate` skill.');
    });
});
```

- [ ] **Step 2: Correr los tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/core/export/transform.test.ts`

Expected: FAIL — `stripIntraRegistryPaths is not a function`.

- [ ] **Step 3: Implementar la limpieza**

Agregar a `cli/src/core/export/transform.ts`, arriba de `claudeAiTransform`:

```ts
// Paths intra-registry: resuelven en Claude Code (donde el registry está en
// disco) y nunca en claude.ai, donde solo se sube la skill portable. Se limpian
// en el artefacto exportado en vez de editar el SKILL.md canónico, que en Claude
// Code sí los necesita.
const PATH_SRC = '(?:skills\\/[a-z0-9][a-z0-9-]*\\/references\\/[A-Za-z0-9._-]+\\.md'
    + '|skills\\/[a-z0-9][a-z0-9-]*\\/SKILL\\.md)';
/** `(see <path>)` o `(<path>)` — el paréntesis entero se va, junto con el
 * espacio horizontal previo, porque la oración ya nombra la skill. */
const PAREN_ONLY = new RegExp('[ \\t]*\\((?:see[ \\t]+)?`?(' + PATH_SRC + ')`?\\)', 'g');
/** Cualquier otra aparición: se reescribe en el lugar, conservando la oración. */
const IN_PLACE = new RegExp('`?(' + PATH_SRC + ')`?', 'g');

/** Un path precedido por `/` es el final de una URL o de un path más largo (un
 * enlace a GitHub, por ejemplo). Esas referencias SÍ resuelven para quien lee la
 * skill en claude.ai, así que no se tocan. */
function isEmbeddedInUrl(haystack: string, matchStart: number, matched: string): boolean {
    const pathStart = matchStart + matched.indexOf('skills/');
    return pathStart > 0 && haystack[pathStart - 1] === '/';
}

function pathlessForm(p: string): string {
    const skillMd = /^skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md$/.exec(p);
    if (skillMd) return `the \`${skillMd[1]}\` skill`;
    const ref = /^skills\/([a-z0-9][a-z0-9-]*)\/references\/([A-Za-z0-9._-]+)\.md$/.exec(p);
    if (!ref) throw new Error(`unreachable: "${p}" matched PATH_SRC but neither shape`);
    return `the \`${ref[1]}\` skill's ${ref[2].replace(/-/g, ' ')} reference`;
}

export function stripIntraRegistryPaths(body: string): string {
    const withoutParentheticals = body.replace(
        PAREN_ONLY,
        (match, _p: string, offset: number) => (isEmbeddedInUrl(body, offset, match) ? match : ''),
    );
    return withoutParentheticals.replace(
        IN_PLACE,
        (match, p: string, offset: number) =>
            (isEmbeddedInUrl(withoutParentheticals, offset, match) ? match : pathlessForm(p)),
    );
}
```

- [ ] **Step 4: Correr los tests para comprobar GREEN**

Run: `cd cli && npm test -- --runTestsByPath tests/core/export/transform.test.ts`

Expected: PASS — los 10 tests nuevos más los ya existentes de `claudeAiTransform`.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/export/transform.ts cli/tests/core/export/transform.test.ts
git commit -m "feat(export): add pathless rewriting of intra-registry references"
```

---

### Task 6: Aplicarla al body del transform mecánico, sin tocar overrides

_Requirements: R2.4, R2.5_

**Files:**
- Modify: `cli/src/core/export/transform.ts` (última línea de `claudeAiTransform`)
- Test: `cli/tests/core/export/transform.test.ts`
- Test: `cli/tests/core/export/engine.test.ts:36`

- [ ] **Step 1: Escribir los tests rojos del wiring**

Agregar al `describe('claudeAiTransform', ...)` de `cli/tests/core/export/transform.test.ts`:

```ts
    test('cleans intra-registry paths in the body', () => {  // verifies R2.1, R2.4
        const md = [
            '---',
            'name: product-discovery',
            'version: "1.0.0"',
            'portable: true',
            'description: "Explores problem space."',
            '---',
            'Hand off to `product-brief` (see `skills/product-brief/SKILL.md`) at the end.',
            '',
        ].join('\n');
        const out = claudeAiTransform(md, 'product-discovery');
        expect(out).toContain('Hand off to `product-brief` at the end.');
        expect(out).not.toContain('skills/product-brief/SKILL.md');
    });

    test('leaves the frontmatter block free of body rewriting', () => {  // verifies R2.4
        const md = [
            '---',
            'name: weird',
            'description: "Mentions skills/readiness-gate/SKILL.md inside the description."',
            '---',
            'Body with no paths.',
            '',
        ].join('\n');
        const out = claudeAiTransform(md, 'weird');
        expect(out).toContain('Mentions skills/readiness-gate/SKILL.md inside the description.');
    });
```

En `cli/tests/core/export/engine.test.ts`, reemplazar la línea 36 (el override del fixture) por una que incluya un path intra-registry, para que el pin de verbatim tenga algo que proteger:

```ts
    fs.writeFileSync(path.join(ported, 'port.claude-ai.md'), '---\nname: ported\ndescription: "Custom port."\n---\nOverride body, verbatim, citing `skills/readiness-gate/SKILL.md` on purpose.\n');
```

Y agregar este test al `describe('runExport (engine end-to-end)', ...)`:

```ts
    it('does not rewrite paths inside a verbatim override', () => {  // verifies R2.5
        runExport({ name: 'dev', out, roots: [root], zip: okZip });
        const portedMd = fs.readFileSync(path.join(out, 'claude-ai/ported/SKILL.md'), 'utf-8');
        expect(portedMd).toContain('citing `skills/readiness-gate/SKILL.md` on purpose');
    });
```

- [ ] **Step 2: Correr los tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/core/export/transform.test.ts tests/core/export/engine.test.ts`

Expected: FAIL en `cleans intra-registry paths in the body` (el body sale sin tocar). Los otros dos pasan ya — el de frontmatter y el de override describen comportamiento que debe **seguir** valiendo después del wiring, y son la red que detecta si el paso siguiente se pasa de largo.

- [ ] **Step 3: Aplicar la limpieza al body**

En `cli/src/core/export/transform.ts`, reemplazar la última línea de `claudeAiTransform`:

```ts
  return `---\n${fmLines.join('\n')}\n---\n${body}`;
```

por:

```ts
  // Solo el body: el frontmatter ya se editó arriba y sus campos no son prosa
  // navegable (R2.4).
  return `---\n${fmLines.join('\n')}\n---\n${stripIntraRegistryPaths(body)}`;
```

- [ ] **Step 4: Correr la suite completa para comprobar GREEN sin regresiones**

Run: `cd cli && npm test`

Expected: PASS en toda la suite, incluidos `tests/commands/export.test.ts` y `tests/core/export/pack.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/export/transform.ts cli/tests/core/export/transform.test.ts cli/tests/core/export/engine.test.ts
git commit -m "fix(export): strip dead intra-registry paths from mechanically exported bodies"
```

---

### Task 7: Documentar la limpieza en la referencia del CLI

_Requirements: R2.7_

**Files:**
- Modify: `docs/cli-reference.md:124-126`

- [ ] **Step 1: Actualizar la descripción del transform mecánico**

En `docs/cli-reference.md`, dentro de la sección `### awm export <name>`, reemplazar el bullet:

```markdown
- If `skills/<name>/port.claude-ai.md` exists in the registry, it is used verbatim;
  otherwise a mechanical transform strips AWM-only frontmatter fields (`version`,
  `portable`) and appends a deference line to the description.
```

por:

```markdown
- If `skills/<name>/port.claude-ai.md` exists in the registry, it is used verbatim;
  otherwise a mechanical transform strips AWM-only frontmatter fields (`version`,
  `portable`), appends a deference line to the description, and rewrites
  intra-registry paths in the body (`skills/<other>/SKILL.md`,
  `skills/<other>/references/<file>.md`) into pathless prose — those paths resolve
  in Claude Code but never in claude.ai, where only the portable skill is uploaded.
  Paths embedded in a URL are left alone, since those do resolve for the reader.
```

- [ ] **Step 2: Verificar que el build y la suite siguen verdes**

Run: `cd cli && npm run build && npm test`

Expected: build sin errores, suite en PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/cli-reference.md
git commit -m "docs(export): document intra-registry path cleanup in the mechanical transform"
```

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|---|---|---|
| R1.1 | T2, T3 | `groups identical signatures and honours min`, `unions identical signatures even across unrelated files and descriptions`, `unions identical signatures regardless of polarity, as before`, `an empty ledger yields no clusters`, `groups by signature and reports clusters with count >= min`, `respects --min: count 2 is excluded when min is 3` |
| R1.2 | T2, T3 | `clusters three independent lenses on one defect`, `does NOT merge two unrelated defects that happen to share a file`, `reports independent lenses on one file as a single convergent cluster` |
| R1.3 | T2 | `clusters near-identical wording across different files`, `leaves weakly-related findings on different files apart` |
| R1.4 | T2 | `does NOT merge a win with a finding on the strength of a shared file` |
| R1.5 | T2, T3 | `labels the cluster convergent and lists every distinct signature`, `reports independent lenses on one file as a single convergent cluster` |
| R1.6 | T1 | `lowercases and splits slugs on non-alphanumeric boundaries`, `drops tokens shorter than two characters`, `drops stopwords so they cannot inflate affinity`, `merges tokens across every text it is given`, `is the overlap coefficient, so a contained short set scores 1`, `is 0 for disjoint sets`, `is 0 when either side is empty` |
| R1.7 | T1, T2 | `strips the line number and keeps the file locus`, `accepts a bare filename with an extension`, `rejects a non-file ref: a whole PR is not a defect locus`, `rejects a URL, whose pre-colon portion carries no locus`, `returns null for a missing ref`, `a non-file ref contributes no clustering signal` |
| R1.8 | T2 | `representative signature is the most frequent one`, `ties on frequency resolve to the lexicographically first signature` |
| R1.9 | T2, T3 | `sorts by count desc, then convergent before exact, then signature asc`, `sorts clusters by count descending` |
| R1.10 | T4 | Manual: leer la sección `awm ledger recurring` de `docs/cli-reference.md` y confirmar que nombra `exact` y `convergent` con su significado. Sin test automático — es prosa de documentación, y un `grep` de las palabras probaría que aparecen, no que explican. |
| R2.1 | T5, T6 | `drops a parenthetical whose only content is a see-path`, `drops a bare-path parenthetical without leaving a space before the comma`, `drops a parenthetical holding only a references path`, `handles several paths in one body`, `cleans intra-registry paths in the body` |
| R2.2 | T5 | `rewrites a path in place when the parenthetical carries more text`, `rewrites a bare unquoted path in prose`, `leaves prose with no intra-registry path byte-identical`, `handles several paths in one body` |
| R2.3 | T5 | `rewrites a path in place when the parenthetical carries more text`, `rewrites a bare unquoted path in prose`, `renders a SKILL.md path as a nameless skill reference` |
| R2.4 | T6 | `leaves the frontmatter block free of body rewriting`, `cleans intra-registry paths in the body` |
| R2.5 | T6 | `does not rewrite paths inside a verbatim override` |
| R2.6 | T5 | `leaves a GitHub URL containing the same path untouched`, `leaves a markdown link whose target is a URL untouched` |
| R2.7 | T7 | Manual: leer el bullet del transform mecánico en `docs/cli-reference.md` y confirmar que describe la reescritura de paths y la excepción de URLs. Sin test automático, misma razón que R1.10. |

## Analyze gate

- **Cobertura hacia adelante:** los 17 requirements tienen ≥1 task. Los 15 requirements de comportamiento tienen ≥1 test automático. R1.10 y R2.7 son requirements de documentación y se verifican por lectura, declarado explícitamente arriba en vez de disfrazado con un `grep` de palabras.
- **Cobertura hacia atrás:** los 7 tasks trazan a requirements. Ningún test queda sin ID: cada `test`/`it` nuevo lleva su comentario `// verifies Rx.y`.
- **Sin huérfanos:** los tres tests preexistentes de `store.test.ts` que este plan modifica quedan anclados a R1.1 y R1.9 — antes no tenían ID porque el módulo no tenía requirements escritos.

## Verificación de cierre

Antes de cerrar cualquiera de los dos issues:

```bash
cd cli && npm run build && npm test
```

Ambos issues piden un criterio observable sobre contenido real del registry, no solo unit tests. Para Release B, la verificación end-to-end es exportar la skill que hoy tiene el problema:

```bash
# Requiere el registry baseline instalado (awm update).
awm export product-discovery --out /tmp/awm-export-check
grep -rn "skills/[a-z-]*/" /tmp/awm-export-check/claude-ai/product-discovery/SKILL.md
```

Expected: sin coincidencias. Un match en `references/` de otra skill portable no es una regresión — está declarado fuera de alcance arriba.
