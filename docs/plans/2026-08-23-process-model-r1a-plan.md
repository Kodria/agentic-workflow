# Modelo durable de proceso y superficie CLI (R1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el CLI sea el único lector del modelo durable de un proceso — parsear `SKILL.md` con el discriminador `awm: process-model`, exponerlo por `awm process list` / `awm process show --json`, y poblar la sección `processes` del Dashboard vía adapter — sin que exista todavía nadie que escriba modelos.

**Architecture:** Un solo repo (`agentic-workflow`, CLI). Tres capas nuevas bajo `cli/src/core/process/`: contrato+frontmatter (`model.ts`), cuerpo por secciones (`body.ts`), descubrimiento entre registries (`discover.ts`). Encima, un comando `awm process` con dos subcomandos, y un adapter del Dashboard. **Ningún consumidor parsea el modelo por su cuenta** (R5.2) — el CLI parsea una vez y emite JSON.

La disciplina de lectura se hereda literal de `cli/src/core/orchestrators.ts`: **el parser nunca lanza**. Un modelo malformado se rechaza con diagnóstico y no invalida al registry que lo contiene ni a los demás. Ese módulo es el precedente a imitar, no una inspiración vaga.

**Tech Stack:** TypeScript, Commander (`program.command`), Jest (`npx jest --runInBand` desde `cli/`). **No es vitest.**

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

**Context Budget Gate:** corrido antes del handoff con el usuario presente. Reportó 73KB vs 69KB; se podó `AGENTS.md` (40KB → 30KB, cada ancla conservada, narrativa forense comprimida) y quedó en **64KB de 69KB**. No hay deuda de contexto pendiente que este plan deba arrastrar.

---

## Alcance: por qué R1a y no R1 entero

El design doc (`2026-08-23-process-lifecycle-design.md`) define R1 como R1.\* + R2.\* + R3.\* + R5.\* + R7.\* — 32 requirements sobre dos repos. Se parte en dos entregas por el `Scope Check` de `writing-plans` (subsistemas independientes, cada uno software funcionando y testeable):

| Entrega | Cubre | Repo | Cierra |
|---|---|---|---|
| **R1a (este plan)** | R1.\*, R5.\*, R7.\* | `agentic-workflow` | CA-1.2, CA-1.3 |
| R1b (plan aparte) | R2.\*, R3.\* | `awm-baseline-registry` + `awm-personal-registry` | CA-1.1, CA-4.1, CA-1.4 |

**El lector va antes que el escritor.** R1b genera modelos; R1a define contra qué contrato se los valida. Invertirlo produciría un escritor apuntando a un contrato no verificado. R1a es testeable solo con modelos escritos a mano como fixture — que es exactamente lo que R7.2 exige que siga funcionando cuando no hay ninguno.

---

## Estado verificado del código (leído, no supuesto)

Todo lo de esta sección se leyó del árbol en `6579ab2`. Los implementadores no deben re-derivarlo.

**1. El precedente de parser tolerante ya existe** — `cli/src/core/orchestrators.ts` (152 líneas):
- Envuelve `assertRegularRegistryFile` en try/catch porque esa función SÍ lanza (symlink → rechazo), y este lector no puede lanzar.
- Allowlist de campos con rechazo de desconocidos; `MAX_FIELD_LENGTH = 500` con justificación explícita (el texto va al payload de contexto de un proveedor de IA).
- `JSON.stringify(key)` en el diagnóstico, para que una clave con newlines no forje líneas de log.
- Dedupe por `name` entre registries: gana el primero en orden de `listRegistries()`, el duplicado se descarta **con diagnóstico**.

**2. `discoverSkills(roots)` ya enumera skills entre registries** — `cli/src/core/discovery.ts:87`. Devuelve `SkillArtifact[]` (`{ name, path, description, overrode? }`), donde `path` es el **directorio** del skill (no el `SKILL.md`). Ya resuelve overrides declarados. **Reusarlo; no re-caminar el filesystem.**

**3. `matchFrontmatterBlock(raw)`** — `cli/src/core/frontmatter.ts:24`. Devuelve el **contenido interno** del bloque `---...---`, o `null`. No parsea YAML.

**4. La sección `processes` ya existe reservada** — R0 la dejó en `collect.ts:363` como `section('processes', 'not_applicable', [])`, con comentario explícito de que R1 la puebla. **El bump de `DashboardSnapshotV1.schema` a 2 ya ocurrió en R0: este plan NO lo vuelve a tocar.** Los nueve ids ya están enumerados en los siete puntos (`types.ts:12`, `types.ts:26`, `validate.ts:3`, `render-html.ts:6`, `render-terminal.ts:13`, `collect.test.ts`, `contracts.test.ts`).

**5. El sanitizador es la restricción de diseño que más condiciona este plan** — `cli/src/core/dashboard/sanitize.ts`:

```ts
if (key === 'id') { ... return CANONICAL_FINDING_IDS.has(value) || PROVIDER_FINDING_ID.test(value) || PROJECT_FINDING_ID.test(value)
    ? value : `item-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`; }
if (key === 'label' && !CANONICAL_LABELS.has(value) && !PROVIDER_LABEL.test(value)) return '[redacted]';
...
if (entryKey === 'detail') continue;   // ← detail se DESCARTA en la frontera de source
```

Consecuencia dura, y es la decisión de diseño central de la Task 6: **el nombre de un proceso que viene de un registry externo no puede viajar en `label` (quedaría `[redacted]`) ni en `detail` (se descarta antes de llegar)**. La única vía es el `id`, y solo si matchea un patrón canónico. Por eso:

- Se agrega `PROCESS_FINDING_ID = /^process\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/` — el slug ya validado por el contrato (R1.2) no puede contener rutas, markup, `=`, ni las palabras que `DANGEROUS` caza.
- Se agrega `'Process'` a `CANONICAL_LABELS` — label fijo, no el nombre.
- El `detail` (el `status`) se computa **después** de la colección, exactamente como `planning` ya hace con `classifyPlanState` (`collect.ts:338`).

Cualquier otra vía filtra texto de registry externo a una superficie de render, que es justo lo que R5.4 prohíbe.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/process/types.ts` (crear) | Tipos del modelo + `KNOWN_PROCESS_SCHEMA` |
| `cli/src/core/process/model.ts` (crear) | Frontmatter: discriminador, `schema`, campos. Nunca lanza |
| `cli/src/core/process/body.ts` (crear) | Cuerpo: las seis secciones, `SG-#`/`OP-#`, tabla de ruteo |
| `cli/src/core/process/discover.ts` (crear) | Enumerar modelos entre registries, dedupe con diagnóstico |
| `cli/src/commands/process/index.ts` (crear) | `awm process list` / `awm process show --json` |
| `cli/src/index.ts` (modificar) | Registrar el comando |
| `cli/src/core/dashboard/collect.ts` (modificar) | Adapter `processes` + sección poblada |
| `cli/src/core/dashboard/sanitize.ts` (modificar) | `PROCESS_FINDING_ID` + label `'Process'` |
| `cli/tests/core/process/*.test.ts` (crear) | Unitarios de las tres capas |
| `cli/tests/commands/process.test.ts` (crear) | Los dos subcomandos |
| `cli/tests/structural/process-model-single-parser.test.ts` (crear) | R5.2 por forma, no por enumeración |

Un archivo por responsabilidad: el contrato de frontmatter y el del cuerpo cambian por razones distintas y en releases distintas (`schema` puede crecer solo por el cuerpo).

---

## El artefacto que se parsea

Fixture canónico, usado literal en los tests:

```markdown
---
awm: process-model
schema: 1
name: ejemplo-proceso
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

# Ejemplo

## Objetivo

G — Llevar una idea hasta una rama cerrada.

## Cuándo aplica

Cuando hay una tarea de desarrollo sin plan previo.

## Estructura

- SG-1 — Diseñar
  - OP-1.1 — Elicitar requisitos
  - OP-1.2 — Escribir el design doc
- SG-2 — Ejecutar
  - OP-2.1 — Implementar por tasks

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| No hay design doc | | OP-1.1 | SG-1 |
| Design doc aprobado | SG-1 | OP-2.1 | SG-2 |

## Terminación

finishing-a-development-branch

## Sin verificar

- Que el usuario tenga un registry propio instalado.
```

---

### Task 1: Contrato de frontmatter — discriminador, schema y campos

_Requirements: R1.1, R1.2, R1.3, R1.4, R1.9, R1.10_

**Files:**
- Create: `cli/src/core/process/types.ts`
- Create: `cli/src/core/process/model.ts`
- Test: `cli/tests/core/process/model.test.ts`

- [x] **Step 1: Escribir el test que falla**

```ts
// cli/tests/core/process/model.test.ts
import { parseProcessFrontmatter } from '../../../src/core/process/model';

const valid = `---
awm: process-model
schema: 1
name: ejemplo-proceso
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

# Ejemplo
`;

describe('parseProcessFrontmatter', () => {
    it('acepta el modelo canónico', () => {                                    // verifies R1.2
        const r = parseProcessFrontmatter(valid, 'skills/x/SKILL.md');
        expect(r.diagnostics).toEqual([]);
        expect(r.model).toEqual(expect.objectContaining({
            schema: 1, name: 'ejemplo-proceso', status: 'draft', entryPoint: true, terminatesTo: 'none',
        }));
    });

    it('no infiere: sin el discriminador no es un modelo', () => {              // verifies R1.2
        const r = parseProcessFrontmatter(valid.replace('awm: process-model\n', ''), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics).toEqual([]);   // no es un error: es "no es un modelo"
    });

    it('se detiene ante un schema más nuevo en vez de leerlo como el anterior', () => {  // verifies R1.4
        const r = parseProcessFrontmatter(valid.replace('schema: 1', 'schema: 2'), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/newer/i);
    });

    it.each(['0', '-1', '1.5', 'uno'])('rechaza schema no-entero-positivo %s', (bad) => {  // verifies R1.3
        const r = parseProcessFrontmatter(valid.replace('schema: 1', `schema: ${bad}`), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics).not.toEqual([]);
    });

    it.each(['active', 'draft'])('admite status %s', (s) => {                   // verifies R1.9
        expect(parseProcessFrontmatter(valid.replace('status: draft', `status: ${s}`), 'p').model?.status).toBe(s);
    });

    it('rechaza un status inventado', () => {                                   // verifies R1.9
        const r = parseProcessFrontmatter(valid.replace('status: draft', 'status: published'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/status/);
    });

    it('rechaza un campo desconocido en vez de ignorarlo', () => {              // verifies R1.10
        const r = parseProcessFrontmatter(valid.replace('created:', 'api_token: ghp_x\ncreated:'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/unknown field/i);
    });

    it('rechaza un name que no es slug', () => {                                // verifies R1.2
        const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', 'name: ../../etc/passwd'), 'p');
        expect(r.model).toBeUndefined();
    });

    it('nunca lanza ante entrada basura', () => {                               // verifies R1.4
        for (const junk of ['', '---\n', '---\n\x00\n---\n', 'no frontmatter']) {
            expect(() => parseProcessFrontmatter(junk, 'p')).not.toThrow();
        }
    });
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/core/process/model.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../../src/core/process/model'`

- [x] **Step 3: Escribir los tipos**

```ts
// cli/src/core/process/types.ts
/** Máximo schema que este CLI sabe evaluar. Solo crece (R1.3). */
export const KNOWN_PROCESS_SCHEMA = 1;

export type ProcessStatus = 'draft' | 'active';

export interface ProcessModelFrontmatter {
    schema: number;
    name: string;
    status: ProcessStatus;
    entryPoint: boolean;
    terminatesTo: string;
    created: string;
    updated: string;
}

export interface ProcessRoutingRow {
    when: string;
    requiredState: string;
    goesTo: string;
    endsAt: string;
}

export interface ProcessOperation { id: string; text: string }
export interface ProcessSubgoal { id: string; text: string; operations: ProcessOperation[] }

export interface ProcessModelBody {
    objective: string;
    appliesWhen: string;
    structure: ProcessSubgoal[];
    routing: ProcessRoutingRow[];
    termination: string;
    unverified: string[];
}

export interface ProcessModel extends ProcessModelFrontmatter {
    /** Path del SKILL.md del que salió. El modelo ES el SKILL.md (R1.1). */
    source: string;
    body: ProcessModelBody;
}

export interface ProcessParseResult<T> { model?: T; diagnostics: string[] }
```

- [x] **Step 4: Escribir el parser de frontmatter**

```ts
// cli/src/core/process/model.ts
// Lector del contrato de frontmatter del modelo durable de proceso.
// Disciplina heredada literal de core/orchestrators.ts: NUNCA lanza. Un modelo
// malformado se rechaza con diagnóstico y no invalida al registry que lo
// contiene ni a los demás (R7.1).
import { matchFrontmatterBlock } from '../frontmatter';
import { KNOWN_PROCESS_SCHEMA, type ProcessModelFrontmatter, type ProcessParseResult, type ProcessStatus } from './types';

/** El discriminador es literal: ningún documento se reconoce como modelo por su
 *  cuerpo, sus headings ni su nombre de archivo (R1.2). */
const DISCRIMINATOR = 'process-model';

const ALLOWED_FIELDS = ['awm', 'schema', 'name', 'status', 'entry_point', 'terminates_to', 'created', 'updated'] as const;
const STATUSES: readonly string[] = ['draft', 'active'];

/** Mismo razonamiento que MAX_FIELD_LENGTH en orchestrators.ts: este texto llega
 *  al payload de contexto de un proveedor de IA, así que no puede ser ilimitado. */
const MAX_FIELD_LENGTH = 500;

/** El slug es lo único del modelo que puede viajar dentro de un id del Dashboard
 *  (ver sanitize.ts). Por eso se valida acá y no en la frontera de render: si
 *  admitiera rutas, markup o `=`, el id dejaría de ser seguro por construcción. */
export const PROCESS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lector de pares `clave: valor` de un frontmatter plano. El contrato no admite
 *  anidamiento ni block scalars, así que no se arrastra un parser YAML: cualquier
 *  línea que no sea `clave: valor` es un rechazo, no una interpretación. */
function readPairs(block: string): { pairs: Map<string, string>; problems: string[] } {
    const pairs = new Map<string, string>();
    const problems: string[] = [];
    for (const raw of block.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) continue;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (!m) { problems.push(`line is not a "key: value" pair: ${JSON.stringify(line.slice(0, 80))}`); continue; }
        if (pairs.has(m[1])) { problems.push(`duplicate field ${JSON.stringify(m[1])}`); continue; }
        pairs.set(m[1], m[2].trim());
    }
    return { pairs, problems };
}

export function parseProcessFrontmatter(source: string, file: string): ProcessParseResult<ProcessModelFrontmatter> {
    let block: string | null;
    try { block = matchFrontmatterBlock(source); } catch { return { diagnostics: [] }; }
    if (block === null) return { diagnostics: [] };

    const { pairs, problems } = readPairs(block);

    // Sin discriminador NO es un modelo de proceso: no es un error, es otro
    // documento. Devolver diagnóstico acá inundaría de ruido a todo registry
    // (cada SKILL.md normal caería en esta rama).
    if (pairs.get('awm') !== DISCRIMINATOR) return { diagnostics: [] };

    for (const key of pairs.keys()) {
        if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
            problems.push(`unknown field ${JSON.stringify(key)} — the contract admits only ${ALLOWED_FIELDS.join(', ')}`);
        }
    }

    const rawSchema = pairs.get('schema');
    const schema = rawSchema !== undefined && /^\d+$/.test(rawSchema) ? Number(rawSchema) : Number.NaN;
    if (!Number.isInteger(schema) || schema < 1) {
        problems.push('"schema" must be a positive integer');
    } else if (schema > KNOWN_PROCESS_SCHEMA) {
        // R1.4: detenerse e informar. Interpretarlo como el contrato anterior es
        // exactamente lo que este branch existe para impedir.
        return { diagnostics: [`${file}: process model declares schema ${schema}, but this CLI understands up to ${KNOWN_PROCESS_SCHEMA} — install a newer agentic-workflow-manager to read it`] };
    }

    for (const field of ['name', 'status', 'entry_point', 'terminates_to', 'created', 'updated'] as const) {
        const value = pairs.get(field);
        if (value === undefined || value === '') problems.push(`"${field}" is required`);
        else if (value.length > MAX_FIELD_LENGTH) problems.push(`"${field}" must be at most ${MAX_FIELD_LENGTH} characters`);
    }

    const name = pairs.get('name') ?? '';
    if (name !== '' && !PROCESS_NAME.test(name)) problems.push('"name" must be a lowercase slug (a-z, 0-9, hyphen)');

    const status = pairs.get('status') ?? '';
    if (status !== '' && !STATUSES.includes(status)) problems.push(`"status" must be one of ${STATUSES.join(', ')}`);

    const entryPointRaw = pairs.get('entry_point') ?? '';
    if (entryPointRaw !== '' && entryPointRaw !== 'true' && entryPointRaw !== 'false') problems.push('"entry_point" must be true or false');

    const terminatesTo = pairs.get('terminates_to') ?? '';
    if (terminatesTo !== '' && terminatesTo !== 'none' && !PROCESS_NAME.test(terminatesTo)) {
        problems.push('"terminates_to" must be a lowercase slug or "none"');
    }

    for (const field of ['created', 'updated'] as const) {
        const value = pairs.get(field) ?? '';
        if (value !== '' && !DATE.test(value)) problems.push(`"${field}" must be YYYY-MM-DD`);
    }

    if (problems.length > 0) {
        return { diagnostics: [`${file}: invalid process model — ${problems.join('; ')}`] };
    }

    return {
        model: {
            schema, name, status: status as ProcessStatus, entryPoint: entryPointRaw === 'true',
            terminatesTo, created: pairs.get('created')!, updated: pairs.get('updated')!,
        },
        diagnostics: [],
    };
}
```

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/core/process/model.test.ts --runInBand`
Expected: PASS — 9 tests

- [x] **Step 6: Sensores y commit**

```bash
cd /home/user/agentic-workflow && node cli/dist/src/index.js sensors run
```
Expected: `"overall": "pass"` (buildear antes con `cd cli && npm run build` si el dist quedó viejo)

```bash
git add cli/src/core/process/types.ts cli/src/core/process/model.ts cli/tests/core/process/model.test.ts
git commit -m "feat(process): contrato de frontmatter del modelo durable"
```

---

### Task 2: Contrato del cuerpo — las seis secciones

_Requirements: R1.5, R1.6, R1.7, R1.8_

**Files:**
- Create: `cli/src/core/process/body.ts`
- Test: `cli/tests/core/process/body.test.ts`

- [x] **Step 1: Escribir el test que falla**

```ts
// cli/tests/core/process/body.test.ts
import { parseProcessBody } from '../../../src/core/process/body';

const body = `
# Ejemplo

## Objetivo

G — Llevar una idea hasta una rama cerrada.

## Cuándo aplica

Cuando hay una tarea de desarrollo sin plan previo.

## Estructura

- SG-1 — Diseñar
  - OP-1.1 — Elicitar requisitos
  - OP-1.2 — Escribir el design doc
- SG-2 — Ejecutar
  - OP-2.1 — Implementar por tasks

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| No hay design doc | | OP-1.1 | SG-1 |
| Design doc aprobado | SG-1 | OP-2.1 | SG-2 |

## Terminación

finishing-a-development-branch

## Sin verificar

- Que el usuario tenga un registry propio instalado.
`;

describe('parseProcessBody', () => {
    it('extrae las seis secciones', () => {                                     // verifies R1.5
        const r = parseProcessBody(body, 'p');
        expect(r.diagnostics).toEqual([]);
        expect(r.model!.objective).toBe('G — Llevar una idea hasta una rama cerrada.');
        expect(r.model!.appliesWhen).toBe('Cuando hay una tarea de desarrollo sin plan previo.');
        expect(r.model!.termination).toBe('finishing-a-development-branch');
        expect(r.model!.unverified).toEqual(['Que el usuario tenga un registry propio instalado.']);
    });

    it('descompone Estructura en SG-# con sus OP-#', () => {                    // verifies R1.6
        expect(parseProcessBody(body, 'p').model!.structure).toEqual([
            { id: 'SG-1', text: 'Diseñar', operations: [
                { id: 'OP-1.1', text: 'Elicitar requisitos' }, { id: 'OP-1.2', text: 'Escribir el design doc' }] },
            { id: 'SG-2', text: 'Ejecutar', operations: [{ id: 'OP-2.1', text: 'Implementar por tasks' }] },
        ]);
    });

    it('lee Ruteo con sus cuatro columnas, incluida la vacía', () => {          // verifies R1.7
        expect(parseProcessBody(body, 'p').model!.routing).toEqual([
            { when: 'No hay design doc', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' },
            { when: 'Design doc aprobado', requiredState: 'SG-1', goesTo: 'OP-2.1', endsAt: 'SG-2' },
        ]);
    });

    it('conserva las filas de Ruteo como datos, sin evaluarlas ni colapsarlas', () => {  // verifies R1.8
        // WCP16 Deferred Choice: la condición se evalúa al llegar a la decisión,
        // leyendo el estado real del proyecto. El parser no puede precomputar cuál
        // fila gana — si lo hiciera, `show --json` emitiría una decisión ya tomada.
        const r = parseProcessBody(body, 'p').model!;
        expect(r.routing).toHaveLength(2);
        expect(Object.keys(r)).not.toContain('activeRoute');
        expect(JSON.stringify(r.routing)).toContain('No hay design doc');
    });

    it.each(['## Objetivo', '## Ruteo', '## Terminación'])('rechaza si falta %s', (heading) => {  // verifies R1.5
        const r = parseProcessBody(body.replace(heading, '## Otra cosa'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/missing/i);
    });

    it('rechaza una tabla de Ruteo con número de columnas equivocado', () => {  // verifies R1.7
        const r = parseProcessBody(body.replace('| No hay design doc | | OP-1.1 | SG-1 |', '| No hay design doc | OP-1.1 |'), 'p');
        expect(r.model).toBeUndefined();
    });

    it('rechaza un id de operación que no cuelga de su subobjetivo', () => {    // verifies R1.6
        const r = parseProcessBody(body.replace('OP-2.1', 'OP-9.1'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/OP-9\.1/);
    });

    it('nunca lanza ante entrada basura', () => {                               // verifies R1.5
        for (const junk of ['', '## Objetivo', '| | | |', '#'.repeat(500)]) {
            expect(() => parseProcessBody(junk, 'p')).not.toThrow();
        }
    });
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/core/process/body.test.ts --runInBand`
Expected: FAIL — módulo inexistente

- [x] **Step 3: Escribir el parser del cuerpo**

```ts
// cli/src/core/process/body.ts
// Contrato del cuerpo del modelo (R1.5–R1.8). Igual que model.ts: nunca lanza.
//
// R1.8 (WCP16 Deferred Choice) es una restricción sobre lo que este módulo NO
// hace: las filas de `## Ruteo` se conservan verbatim como datos. Precomputar
// cuál aplica emitiría por `show --json` una decisión ya tomada, cuando la
// condición debe evaluarse al llegar a la decisión contra el estado real.
import type { ProcessModelBody, ProcessParseResult, ProcessSubgoal } from './types';

const REQUIRED = ['Objetivo', 'Cuándo aplica', 'Estructura', 'Ruteo', 'Terminación', 'Sin verificar'] as const;
const SG = /^-\s+(SG-\d+)\s+—\s+(.+)$/;
const OP = /^\s+-\s+(OP-(\d+)\.\d+)\s+—\s+(.+)$/;

/** Corta el documento en secciones de nivel 2. Las de nivel 1 (`# Titulo`) y el
 *  contenido previo al primer `##` se descartan: el contrato vive en los `##`. */
function splitSections(source: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    let current: string | null = null;
    for (const line of source.split(/\r?\n/)) {
        const m = /^##\s+(.+?)\s*$/.exec(line);
        if (m) { current = m[1]; if (!out.has(current)) out.set(current, []); continue; }
        if (current !== null) out.get(current)!.push(line);
    }
    return out;
}

function paragraph(lines: string[]): string {
    return lines.map((l) => l.trim()).filter((l) => l !== '').join(' ');
}

function parseStructure(lines: string[], problems: string[]): ProcessSubgoal[] {
    const subgoals: ProcessSubgoal[] = [];
    for (const raw of lines) {
        if (raw.trim() === '') continue;
        const sg = SG.exec(raw);
        if (sg) { subgoals.push({ id: sg[1], text: sg[2].trim(), operations: [] }); continue; }
        const op = OP.exec(raw);
        if (!op) { problems.push(`"Estructura" line is neither an SG-# nor an OP-#: ${JSON.stringify(raw.trim().slice(0, 80))}`); continue; }
        const owner = subgoals[subgoals.length - 1];
        // El prefijo numérico de la operación DEBE coincidir con su subobjetivo:
        // sin esto, OP-9.1 colgando de SG-2 pasaría y la jerarquía HTA sería una
        // ilusión tipográfica.
        if (!owner) { problems.push(`${op[1]} appears before any SG-#`); continue; }
        if (`SG-${op[2]}` !== owner.id) { problems.push(`${op[1]} does not belong to ${owner.id}`); continue; }
        owner.operations.push({ id: op[1], text: op[3].trim() });
    }
    if (subgoals.length === 0) problems.push('"Estructura" declares no SG-#');
    return subgoals;
}

function parseRouting(lines: string[], problems: string[]): ProcessModelBody['routing'] {
    const rows: ProcessModelBody['routing'] = [];
    const tableLines = lines.map((l) => l.trim()).filter((l) => l.startsWith('|'));
    for (const [index, line] of tableLines.entries()) {
        // `| a | b |` -> ['a','b']: se descartan los extremos vacíos que deja el
        // split, no las celdas internas vacías — la columna "Estado requerido"
        // vacía es WCP18 "sin hito", un valor con significado.
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (index === 0) {
            if (cells.length !== 4) problems.push('"Ruteo" header must have exactly 4 columns');
            continue;
        }
        if (/^-{1,}$/.test(cells.join(''))) continue;                  // separador
        if (cells.length !== 4) { problems.push(`"Ruteo" row ${index} must have exactly 4 columns, found ${cells.length}`); continue; }
        if (cells[0] === '' || cells[2] === '' || cells[3] === '') { problems.push(`"Ruteo" row ${index} needs Cuándo, Va a and Termina en`); continue; }
        rows.push({ when: cells[0], requiredState: cells[1], goesTo: cells[2], endsAt: cells[3] });
    }
    if (rows.length === 0) problems.push('"Ruteo" declares no transitions');
    return rows;
}

export function parseProcessBody(source: string, file: string): ProcessParseResult<ProcessModelBody> {
    const problems: string[] = [];
    const sections = splitSections(source);
    for (const heading of REQUIRED) {
        if (!sections.has(heading)) problems.push(`missing required section "## ${heading}"`);
    }
    if (problems.length > 0) return { diagnostics: [`${file}: invalid process model body — ${problems.join('; ')}`] };

    const structure = parseStructure(sections.get('Estructura')!, problems);
    const routing = parseRouting(sections.get('Ruteo')!, problems);
    const objective = paragraph(sections.get('Objetivo')!);
    const appliesWhen = paragraph(sections.get('Cuándo aplica')!);
    const termination = paragraph(sections.get('Terminación')!);
    const unverified = sections.get('Sin verificar')!
        .map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());

    for (const [label, value] of [['Objetivo', objective], ['Cuándo aplica', appliesWhen], ['Terminación', termination]] as const) {
        if (value === '') problems.push(`"${label}" is empty`);
    }

    if (problems.length > 0) return { diagnostics: [`${file}: invalid process model body — ${problems.join('; ')}`] };
    return { model: { objective, appliesWhen, structure, routing, termination, unverified }, diagnostics: [] };
}
```

- [x] **Step 4: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/core/process/body.test.ts --runInBand`
Expected: PASS — 11 tests

- [x] **Step 5: Commit**

```bash
git add cli/src/core/process/body.ts cli/tests/core/process/body.test.ts
git commit -m "feat(process): contrato del cuerpo — seis secciones, HTA y ruteo diferido"
```

---

### Task 3: Descubrimiento entre registries

_Requirements: R1.1, R7.1, R7.4_

**Files:**
- Create: `cli/src/core/process/discover.ts`
- Test: `cli/tests/core/process/discover.test.ts`

- [x] **Step 1: Escribir el test que falla**

```ts
// cli/tests/core/process/discover.test.ts
import { discoverProcessModels } from '../../../src/core/process/discover';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FIXTURE = `---
awm: process-model
schema: 1
name: NAME
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

## Objetivo

G — Objetivo.

## Cuándo aplica

Siempre.

## Estructura

- SG-1 — Uno
  - OP-1.1 — Hacer

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| Al empezar | | OP-1.1 | SG-1 |

## Terminación

none

## Sin verificar

- Nada.
`;

function registry(root: string, skills: Record<string, string>): string {
    for (const [name, content] of Object.entries(skills)) {
        fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), content);
    }
    return root;
}

describe('discoverProcessModels', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-discover-')); });
    afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('encuentra solo los SKILL.md con el discriminador', () => {              // verifies R1.1
        const root = registry(path.join(tmp, 'r1'), {
            'mi-proceso': FIXTURE.replace('NAME', 'mi-proceso'),
            'skill-normal': '---\nname: skill-normal\ndescription: otra cosa\n---\n\n# Normal\n',
        });
        const r = discoverProcessModels([root]);
        expect(r.models.map((m) => m.name)).toEqual(['mi-proceso']);
        expect(r.diagnostics).toEqual([]);
    });

    it('un modelo roto no impide descubrir los sanos', () => {                  // verifies R7.1
        const root = registry(path.join(tmp, 'r2'), {
            'sano': FIXTURE.replace('NAME', 'sano'),
            'roto': FIXTURE.replace('NAME', 'roto').replace('schema: 1', 'schema: cero'),
        });
        const r = discoverProcessModels([root]);
        expect(r.models.map((m) => m.name)).toEqual(['sano']);
        expect(r.diagnostics).toHaveLength(1);
    });

    it('deduplica por name entre registries y lo reporta', () => {              // verifies R1.1
        const a = registry(path.join(tmp, 'a'), { 'dup': FIXTURE.replace('NAME', 'dup') });
        const b = registry(path.join(tmp, 'b'), { 'dup': FIXTURE.replace('NAME', 'dup') });
        const r = discoverProcessModels([a, b]);
        expect(r.models).toHaveLength(1);
        expect(r.diagnostics.join(' ')).toMatch(/duplicates/i);
    });

    it('sin registries devuelve vacío sin diagnósticos', () => {                // verifies R7.1
        expect(discoverProcessModels([])).toEqual({ models: [], diagnostics: [] });
    });

    it('nunca lanza con un root inexistente', () => {                           // verifies R7.1
        expect(() => discoverProcessModels([path.join(tmp, 'no-existe')])).not.toThrow();
    });
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/core/process/discover.test.ts --runInBand`
Expected: FAIL — módulo inexistente

- [x] **Step 3: Escribir el descubridor**

```ts
// cli/src/core/process/discover.ts
// Enumera modelos de proceso entre todos los registries instalados.
//
// Reusa discoverSkills (core/discovery.ts), que ya resuelve overrides declarados
// y colisiones entre roots: re-caminar el filesystem acá crearía una segunda
// política de descubrimiento que se desincronizaría de la primera.
//
// Dedupe por `name` con el mismo criterio que collectDeclaredOrchestrators:
// gana el primero en orden de roots, el duplicado se descarta CON diagnóstico.
import fs from 'fs';
import path from 'path';
import { contentRoots } from '../registries';
import { discoverSkills } from '../discovery';
import { parseProcessFrontmatter } from './model';
import { parseProcessBody } from './body';
import type { ProcessModel } from './types';

export interface DiscoveredProcessModels { models: ProcessModel[]; diagnostics: string[] }

export function discoverProcessModels(roots: string[] = contentRoots()): DiscoveredProcessModels {
    const models: ProcessModel[] = [];
    const diagnostics: string[] = [];
    const seen = new Set<string>();

    let skills: ReturnType<typeof discoverSkills>;
    try {
        skills = discoverSkills(roots);
    } catch (e) {
        // discoverSkills SÍ lanza ante colisión de nombres no declarada. Este
        // lector no puede propagarla: un registry en conflicto no debe romper
        // `awm process list` ni el Dashboard (R7.1).
        return { models: [], diagnostics: [`process model discovery unavailable: ${e instanceof Error ? e.message : String(e)}`] };
    }

    for (const skill of skills) {
        const file = path.join(skill.path, 'SKILL.md');
        let source: string;
        try {
            source = fs.readFileSync(file, 'utf-8');
        } catch (e) {
            diagnostics.push(`${file}: cannot read (${e instanceof Error ? e.message : String(e)})`);
            continue;
        }

        const front = parseProcessFrontmatter(source, file);
        diagnostics.push(...front.diagnostics);
        if (!front.model) continue;                       // no es un modelo, o está roto

        const body = parseProcessBody(source, file);
        diagnostics.push(...body.diagnostics);
        if (!body.model) continue;

        if (seen.has(front.model.name)) {
            diagnostics.push(`${file}: process "${front.model.name}" duplicates one already declared by an earlier registry — shadowed duplicate dropped`);
            continue;
        }
        seen.add(front.model.name);
        models.push({ ...front.model, source: file, body: body.model });
    }

    return { models, diagnostics };
}
```

- [x] **Step 4: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/core/process/discover.test.ts --runInBand`
Expected: PASS — 5 tests

- [x] **Step 5: Commit**

```bash
git add cli/src/core/process/discover.ts cli/tests/core/process/discover.test.ts
git commit -m "feat(process): descubrimiento de modelos entre registries"
```

---

### Task 4: `awm process list` y `awm process show --json`

_Requirements: R5.1, R7.1, R7.2_

**Files:**
- Create: `cli/src/commands/process/index.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/tests/commands/process.test.ts`

- [x] **Step 1: Escribir el test que falla**

```ts
// cli/tests/commands/process.test.ts
import { runProcessList, runProcessShow } from '../../src/commands/process';
import type { ProcessModel } from '../../src/core/process/types';

function model(over: Partial<ProcessModel> = {}): ProcessModel {
    return {
        schema: 1, name: 'mi-proceso', status: 'draft', entryPoint: true, terminatesTo: 'none',
        created: '2026-08-23', updated: '2026-08-23', source: '/r/skills/mi-proceso/SKILL.md',
        body: {
            objective: 'G — Objetivo.', appliesWhen: 'Siempre.',
            structure: [{ id: 'SG-1', text: 'Uno', operations: [{ id: 'OP-1.1', text: 'Hacer' }] }],
            routing: [{ when: 'Al empezar', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' }],
            termination: 'none', unverified: ['Nada.'],
        },
        ...over,
    };
}

describe('awm process list', () => {
    it('reporta los procesos descubiertos', () => {                             // verifies R5.1
        const r = runProcessList({ models: [model()], diagnostics: [] });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stdout).toContain('draft');
    });

    it('sin modelos sale 0 y lo dice, no falla', () => {                        // verifies R7.2
        const r = runProcessList({ models: [], diagnostics: [] });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/no process models/i);
    });

    it('emite los diagnósticos sin dejar de listar los sanos', () => {          // verifies R7.1
        const r = runProcessList({ models: [model()], diagnostics: ['/r/x: invalid process model — boom'] });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stderr).toContain('boom');
    });
});

describe('awm process show --json', () => {
    it('emite el modelo parseado como JSON', () => {                            // verifies R5.1
        const r = runProcessShow({ models: [model()], diagnostics: [] }, 'mi-proceso', true);
        expect(r.code).toBe(0);
        const parsed = JSON.parse(r.stdout);
        expect(parsed).toEqual(expect.objectContaining({ name: 'mi-proceso', schema: 1, status: 'draft' }));
        expect(parsed.body.routing).toEqual([{ when: 'Al empezar', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' }]);
    });

    it('el JSON no filtra el path del filesystem del registry', () => {         // verifies R5.1
        const parsed = JSON.parse(runProcessShow({ models: [model()], diagnostics: [] }, 'mi-proceso', true).stdout);
        expect(JSON.stringify(parsed)).not.toContain('/r/skills');
    });

    it('un nombre inexistente sale 2 y nombra lo disponible', () => {           // verifies R7.1
        const r = runProcessShow({ models: [model()], diagnostics: [] }, 'no-existe', true);
        expect(r.code).toBe(2);
        expect(r.stderr).toMatch(/no-existe/);
    });
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/commands/process.test.ts --runInBand`
Expected: FAIL — módulo inexistente

- [x] **Step 3: Escribir el comando**

```ts
// cli/src/commands/process/index.ts
// `awm process` — el ÚNICO punto de parseo del modelo durable (R5.1). Todo
// consumidor (Dashboard incluido) consume esta salida, no reimplementa el parser.
import { Command } from 'commander';
import { discoverProcessModels, type DiscoveredProcessModels } from '../../core/process/discover';
import type { ProcessModel } from '../../core/process/types';

export interface CommandResult { code: 0 | 2; stdout: string; stderr: string }

/** `source` es un path absoluto del filesystem local: identifica la máquina, no
 *  el proceso. Se usa internamente para diagnósticos, y se omite de toda salida
 *  destinada a ser compartida o consumida por otro programa. */
function publicView(model: ProcessModel): Omit<ProcessModel, 'source'> {
    const { source: _source, ...rest } = model;
    return rest;
}

export function runProcessList(discovered: DiscoveredProcessModels): CommandResult {
    const stderr = discovered.diagnostics.map((d) => `warning: ${d}\n`).join('');
    if (discovered.models.length === 0) {
        return { code: 0, stdout: 'No process models declared by the installed registries.\n', stderr };
    }
    const rows = discovered.models
        .map((m) => `${m.name}  ${m.status}  ${m.entryPoint ? 'entry-point' : 'phase'}  -> ${m.terminatesTo}`)
        .join('\n');
    return { code: 0, stdout: `${rows}\n`, stderr };
}

export function runProcessShow(discovered: DiscoveredProcessModels, name: string, json: boolean): CommandResult {
    const stderr = discovered.diagnostics.map((d) => `warning: ${d}\n`).join('');
    const found = discovered.models.find((m) => m.name === name);
    if (!found) {
        const available = discovered.models.map((m) => m.name).join(', ') || '(none)';
        return { code: 2, stdout: '', stderr: `${stderr}awm process show: no process named "${name}" — available: ${available}\n` };
    }
    if (!json) {
        const view = publicView(found);
        const structure = view.body.structure
            .map((sg) => [`${sg.id} — ${sg.text}`, ...sg.operations.map((op) => `  ${op.id} — ${op.text}`)].join('\n')).join('\n');
        return { code: 0, stdout: `${view.name} (${view.status})\n\n${view.body.objective}\n\n${structure}\n`, stderr };
    }
    return { code: 0, stdout: `${JSON.stringify(publicView(found), null, 2)}\n`, stderr };
}

export function registerProcessCommand(program: Command): void {
    const process_ = program.command('process').description('declared process models (the CLI is their only parser)');

    process_
        .command('list')
        .description('list process models declared by the installed registries')
        .action(() => emit(runProcessList(discoverProcessModels())));

    process_
        .command('show <name>')
        .description('show one process model')
        .option('--json', 'emit the parsed model as JSON')
        .action((name: string, opts: { json?: boolean }) => emit(runProcessShow(discoverProcessModels(), name, opts.json === true)));
}

function emit(result: CommandResult): void {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.code !== 0) process.exitCode = result.code;
}
```

- [x] **Step 4: Registrar el comando**

En `cli/src/index.ts`, junto a los demás imports de comandos (línea ~49):

```ts
import { registerProcessCommand } from './commands/process';
```

y junto a las demás llamadas de registro (línea ~795):

```ts
registerProcessCommand(program);
```

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/commands/process.test.ts --runInBand`
Expected: PASS — 6 tests

- [x] **Step 6: Verificar contra el binario real**

```bash
cd cli && npm run build && node dist/src/index.js process list
```
Expected: `No process models declared by the installed registries.` con exit 0 — R7.2 verificado contra el binario, no contra el test.

- [x] **Step 7: Commit**

```bash
git add cli/src/commands/process/index.ts cli/src/index.ts cli/tests/commands/process.test.ts
git commit -m "feat(process): awm process list y show --json"
```

---

### Task 5: Adapter del Dashboard y frontera de sanitización

_Requirements: R5.3, R5.4_

**Files:**
- Modify: `cli/src/core/dashboard/sanitize.ts`
- Modify: `cli/src/core/dashboard/collect.ts`
- Test: `cli/tests/core/dashboard/processes-section.test.ts`

**Contexto obligatorio antes de tocar nada** — leer la sección "Estado verificado del código" punto 5 de este plan. El sanitizador **descarta `detail` en la frontera de source** y **redacta todo `label` fuera de `CANONICAL_LABELS`**. El nombre del proceso solo puede viajar en el `id`, y solo porque `PROCESS_NAME` (Task 1) ya garantizó que es un slug.

- [x] **Step 1: Escribir el test que falla**

```ts
// cli/tests/core/dashboard/processes-section.test.ts
import { collectDashboardSnapshot } from '../../../src/core/dashboard/collect';
import type { DashboardSourceAdapters } from '../../../src/core/dashboard/collect';
import fs from 'fs';
import os from 'os';
import path from 'path';

function adapters(processes: DashboardSourceAdapters['processes']): DashboardSourceAdapters {
    return { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined, processes };
}

describe('sección processes del Dashboard', () => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-processes-section-')); fs.writeFileSync(path.join(root, 'package.json'), '{}'); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    function section(a: DashboardSourceAdapters) {
        return collectDashboardSnapshot({ cwd: root, now: '2026-08-23T00:00:00.000Z', adapters: a })
            .sections.find((s) => s.id === 'processes')!;
    }

    it('puebla la sección desde el adapter', () => {                            // verifies R5.3
        const s = section(adapters(() => [{ name: 'mi-proceso', status: 'active' }]));
        expect(s.availability).toBe('available');
        expect(s.items).toEqual([expect.objectContaining({ id: 'process.mi-proceso', label: 'Process', state: 'ok', detail: 'active' })]);
    });

    it('un draft se reporta como attention, no como ok', () => {                // verifies R5.3
        expect(section(adapters(() => [{ name: 'x', status: 'draft' }])).items[0]).toEqual(expect.objectContaining({ state: 'attention', detail: 'draft' }));
    });

    it('sin procesos la sección queda not_applicable, como antes de R1a', () => {  // verifies R5.3
        expect(section(adapters(() => []))).toEqual(expect.objectContaining({ availability: 'not_applicable', items: [] }));
    });

    it('un adapter que lanza degrada a unavailable sin tumbar el snapshot', () => {  // verifies R5.3
        const s = section(adapters(() => { throw new Error('/home/u/secreto boom'); }));
        expect(s.availability).toBe('unavailable');
        expect(JSON.stringify(s)).not.toContain('secreto');
    });

    it('un registry externo no puede inyectar markup ni rutas por el nombre', () => {  // verifies R5.4
        // El nombre ya fue validado como slug por el contrato (Task 1). Este test
        // prueba la SEGUNDA barrera: aunque un adapter mal escrito dejara pasar
        // algo hostil, el sanitizador lo neutraliza antes del render.
        const s = section(adapters(() => [{ name: '<script>/etc/passwd', status: 'active' } as never]));
        const serialized = JSON.stringify(s);
        expect(serialized).not.toContain('<script>');
        expect(serialized).not.toContain('/etc/passwd');
    });
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/core/dashboard/processes-section.test.ts --runInBand`
Expected: FAIL — `processes` no existe en `DashboardSourceAdapters`

- [x] **Step 3: Extender el sanitizador (mínimamente)**

En `cli/src/core/dashboard/sanitize.ts`, agregar `'Process'` a `CANONICAL_LABELS`:

```ts
const CANONICAL_LABELS = new Set([
    'Preferences', 'Registries', 'Profile', 'Sensors', 'Optional source unavailable',
    'Extensions', 'Registry pins', 'Active bundles', 'Project context', 'Constitution', 'Static preflight', 'Documentation',
    'Process',
]);
```

agregar `'processes'` y `'name'`/`'status'` a `ALLOWED_KEYS`:

```ts
const ALLOWED_KEYS = new Set(['findings', 'label', 'id', 'state', 'detail', 'remediation', 'remediationVerified', 'execution', 'qa', 'docs', 'retro', 'history', 'lifecycle', 'journal', 'markers', 'tasks', 'total', 'completed', 'qaComplete', 'docsComplete', 'retroComplete', 'processes', 'name', 'status']);
```

y declarar el patrón de id junto a los otros, más su uso:

```ts
// El slug ya lo validó PROCESS_NAME en core/process/model.ts. Repetir la forma
// acá es deliberado: este módulo es la frontera de render y no puede confiar en
// que su input pasó por aquel validador — un adapter nuevo podría no hacerlo.
const PROCESS_FINDING_ID = /^process\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
```

```ts
        if (key === 'id') {
            if (value.trim() === '') throw new Error('Dashboard finding id is invalid');
            return CANONICAL_FINDING_IDS.has(value) || PROVIDER_FINDING_ID.test(value) || PROJECT_FINDING_ID.test(value) || PROCESS_FINDING_ID.test(value)
                ? value : `item-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
        }
```

- [x] **Step 4: Agregar el adapter y poblar la sección**

En `cli/src/core/dashboard/collect.ts`, extender la interfaz:

```ts
export interface ProcessDashboardSource { name: string; status: 'draft' | 'active' }

export interface DashboardSourceAdapters {
    machine(input: { cwd: string }): MachineDashboardSource;
    project(input: { root: string }): ProjectDashboardSource;
    plans(input: { root: string }): PlanDashboardSource[];
    execution(input: { root: string }): ExecutionDashboardSource | undefined;
    processes(input: { root: string }): ProcessDashboardSource[];
}
```

y en `EMPTY_ADAPTERS`:

```ts
const EMPTY_ADAPTERS: DashboardSourceAdapters = {
    machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined, processes: () => [],
};
```

En `productionDashboardAdapters`, agregar el adapter real — **consume el descubridor, no reparsea** (R5.2):

```ts
        processes: () => discoverProcessModels().models.map((m) => ({ name: m.name, status: m.status })),
```

con su import:

```ts
import { discoverProcessModels } from '../process/discover';
```

Y en el armado de `sections`, reemplazar la fila reservada por la real:

```ts
    const processesResult = optional(() => sanitizeDashboardSource(adapters.processes({ root })) as ProcessDashboardSource[]);
    // `detail` se computa DESPUÉS de la sanitización de source, igual que
    // `planning` hace con classifyPlanState: el sanitizador descarta todo
    // `detail` que venga del adapter (sanitize.ts), así que ponerlo antes sería
    // escribirlo para que se borre en silencio.
    const processItems: DashboardItemV1[] = (processesResult.value ?? []).map((p) => ({
        id: `process.${p.name}`,
        label: 'Process',
        state: p.status === 'active' ? 'ok' : 'attention',
        detail: p.status,
    }));
```

```ts
        // R1a puebla `processes` desde su adapter. Sin modelos declarados la
        // sección conserva `not_applicable` — el mismo valor que R0 dejó
        // reservado — para que un proyecto sin procesos se vea igual que antes.
        section('processes', processesResult.failed ? 'unavailable' : processItems.length === 0 ? 'not_applicable' : 'available',
            processesResult.failed ? [] : processItems),
```

*(Los ids `process.<slug>` se construyen después de sanitizar el source: el slug ya viene saneado, y `validateDashboardSnapshotV1` vuelve a validar la forma final.)*

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/core/dashboard/processes-section.test.ts --runInBand`
Expected: PASS — 5 tests

- [x] **Step 6: Correr la suite del Dashboard completa**

Run: `cd cli && npx jest tests/core/dashboard --runInBand`
Expected: PASS. Si `collect.test.ts` o `contracts.test.ts` fallan por la igualdad exacta de secciones, actualizarlos: la lista ordenada de nueve ids **no cambia** (R0 ya la fijó), solo cambia la `availability` de `processes` cuando hay modelos.

- [x] **Step 7: Commit**

```bash
git add cli/src/core/dashboard/sanitize.ts cli/src/core/dashboard/collect.ts cli/tests/core/dashboard/
git commit -m "feat(dashboard): poblar la seccion processes desde su adapter"
```

---

### Task 6: Un solo parser — test estructural

_Requirements: R5.2_

**Files:**
- Create: `cli/tests/structural/process-model-single-parser.test.ts`

**Por qué estructural y no una convención:** la lección `enum-de-N-puntos-sin-fuente-unica` de `AGENTS.md` dice que una regla que depende de que alguien la recuerde se rompe en el sitio N+1. R5.2 prohíbe que un consumidor implemente su propio parser; un test que prohíbe **la forma** lo detiene aunque quien lo escriba nunca haya leído el design doc.

- [x] **Step 1: Escribir el test**

```ts
// cli/tests/structural/process-model-single-parser.test.ts
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');

/** Módulos autorizados a conocer la sintaxis del modelo. Cualquier otro que la
 *  toque está reimplementando el parser, que es exactamente lo que R5.2 prohíbe. */
const PARSER_MODULES = ['core/process/model.ts', 'core/process/body.ts', 'core/process/discover.ts'];

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });
}

describe('R5.2 — el CLI parsea el modelo una sola vez', () => {
    it('ningún módulo fuera de core/process/ conoce la sintaxis del modelo', () => {  // verifies R5.2
        const offenders = sourceFiles(SRC).filter((file) => {
            const relative = path.relative(SRC, file).split(path.sep).join('/');
            if (PARSER_MODULES.includes(relative)) return false;
            const content = fs.readFileSync(file, 'utf-8');
            // El discriminador literal y los headings del contrato son la firma
            // de "acá alguien está parseando el modelo".
            return /process-model|##\s+Cuándo aplica|SG-\d|OP-\d/.test(content);
        });
        expect(offenders).toEqual([]);
    });

    it('el adapter del Dashboard consume el descubridor, no el filesystem', () => {   // verifies R5.2
        const collect = fs.readFileSync(path.join(SRC, 'core/dashboard/collect.ts'), 'utf-8');
        expect(collect).toContain('discoverProcessModels');
        expect(collect).not.toMatch(/SKILL\.md/);
    });
});
```

- [x] **Step 2: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/structural/process-model-single-parser.test.ts --runInBand`
Expected: PASS — 2 tests

- [x] **Step 3: Verificar que el guard realmente dispara (sabotaje y revert)**

```bash
cd cli
printf '\n// sabotaje temporal\nconst x = "process-model";\n' >> src/core/dashboard/render-html.ts
npx jest tests/structural/process-model-single-parser.test.ts --runInBand
```
Expected: **FAIL**, nombrando `core/dashboard/render-html.ts`.

```bash
git checkout src/core/dashboard/render-html.ts
npx jest tests/structural/process-model-single-parser.test.ts --runInBand
```
Expected: PASS. Un guard que no se verifica por reversión es decorativo.

- [x] **Step 4: Commit**

```bash
git add cli/tests/structural/process-model-single-parser.test.ts
git commit -m "test(process): guard estructural de parser unico (R5.2)"
```

---

### Task 7: No regresión, robustez y cierre

_Requirements: R7.1, R7.2, R7.3, R7.4_

**Files:**
- Test: `cli/tests/core/process/no-regression.test.ts`

- [x] **Step 1: Escribir el test**

```ts
// cli/tests/core/process/no-regression.test.ts
import { collectDashboardSnapshot } from '../../../src/core/dashboard/collect';
import { discoverProcessModels } from '../../../src/core/process/discover';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('R7 — ausencia de modelos y aislamiento', () => {
    let root: string;
    let home: string;
    const realHome = process.env.HOME;
    const realAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-noreg-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-home-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        // R7.4: ningún test toca el ~/.awm real.
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
    });
    afterEach(() => {
        process.env.HOME = realHome; process.env.AWM_HOME = realAwmHome;
        fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
    });

    it('sin modelos, el snapshot conserva las nueve secciones en orden', () => {  // verifies R7.2
        const snapshot = collectDashboardSnapshot({ cwd: root, now: '2026-08-23T00:00:00.000Z' });
        expect(snapshot.sections.map((s) => s.id)).toEqual(
            ['machine', 'project', 'planning', 'execution', 'qa', 'docs', 'retro', 'history', 'processes']);
        expect(snapshot.schema).toBe(2);
        expect(snapshot.sections.find((s) => s.id === 'processes')).toEqual(
            expect.objectContaining({ availability: 'not_applicable', items: [] }));
    });

    it('el descubridor no toca el ~/.awm real', () => {                          // verifies R7.4
        expect(() => discoverProcessModels()).not.toThrow();
        expect(fs.existsSync(path.join(String(realHome), '.awm', 'process-cache'))).toBe(false);
    });

    it('usa path.join y no separadores hardcodeados', () => {                    // verifies R7.3
        const src = fs.readFileSync(path.resolve(__dirname, '../../../src/core/process/discover.ts'), 'utf-8');
        expect(src).not.toMatch(/['"`][^'"`]*\/skills\//);
        expect(src).toContain('path.join');
    });
});
```

- [x] **Step 2: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/core/process/no-regression.test.ts --runInBand`
Expected: PASS — 3 tests

- [x] **Step 3: Suite completa**

Run: `cd cli && npx jest --runInBand`
Expected: 0 fallos. La línea base antes de este plan es **253 suites / 2941 tests** — el número debe crecer, nunca decrecer.

- [x] **Step 4: Gate de sensores**

```bash
cd /home/user/agentic-workflow && cd cli && npm run build && cd .. && node cli/dist/src/index.js sensors run
```
Expected: `"overall": "pass"`

- [x] **Step 5: Verificación end-to-end contra el binario real**

```bash
cd /home/user/agentic-workflow
node cli/dist/src/index.js process list
node cli/dist/src/index.js process show inexistente --json; echo "exit=$?"
node cli/dist/src/index.js doctor --full 2>&1 | grep -i process
```
Expected: list dice que no hay modelos (exit 0); show sale `exit=2` nombrando lo disponible; el Dashboard muestra `Processes` sin romper. **R7.2 se verifica acá, contra el binario — no por lectura del diff.**

- [x] **Step 6: Commit**

```bash
git add cli/tests/core/process/no-regression.test.ts
git commit -m "test(process): no regresion sin modelos y aislamiento de HOME"
```

---

## Criterios de aceptación de R1a

Se verifican después de las siete tasks, antes de cerrar la rama.

- [x] **CA-1.2** — `awm process list` reporta un proceso y `awm process show <name> --json` emite el modelo parseado. **Cómo:** crear un registry de prueba en un tmpdir con `AWM_HOME` sobreescrito, sembrar el fixture canónico de este plan, y correr ambos comandos contra el binario buildeado. No vale el test unitario: el criterio dice "reporta", y eso se prueba ejecutando.
- [x] **CA-1.3** — el Dashboard muestra la sección `processes` poblada por el adapter, sin parser propio. **Cómo:** `awm doctor --full` con ese mismo registry sembrado + el test estructural de la Task 6 en verde.
- [x] **Entrega sin dependencia de contenido** — R1a mergea solo. No hay nada que taggear en ningún registry: no existe todavía quien escriba modelos. R1b consume este contrato ya publicado.

**Fuera de alcance de R1a, y es deliberado:** promover `status` a `active` (R3.6, es R1b), elicitar/generar (R2.\*/R3.\*, es R1b), extraer procesos existentes (R4.\*, es R2 del design doc). El contrato de R1a **admite y valida** `status: active`, pero nadie en R1a lo escribe — el escritor único llega en R1b, como exige R1.9.

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|---|---|---|
| R1.1 | T1, T3 | `discover.test.ts` "encuentra solo los SKILL.md con el discriminador", "deduplica por name" |
| R1.2 | T1 | `model.test.ts` "acepta el modelo canónico", "no infiere", "rechaza un name que no es slug" |
| R1.3 | T1 | `model.test.ts` "rechaza schema no-entero-positivo %s" |
| R1.4 | T1 | `model.test.ts` "se detiene ante un schema más nuevo", "nunca lanza ante entrada basura" |
| R1.5 | T2 | `body.test.ts` "extrae las seis secciones", "rechaza si falta %s" |
| R1.6 | T2 | `body.test.ts` "descompone Estructura en SG-# con sus OP-#", "rechaza un id de operación que no cuelga" |
| R1.7 | T2 | `body.test.ts` "lee Ruteo con sus cuatro columnas", "rechaza una tabla con número de columnas equivocado" |
| R1.8 | T2 | `body.test.ts` "conserva las filas de Ruteo como datos, sin evaluarlas ni colapsarlas" |
| R1.9 | T1 | `model.test.ts` "admite status %s", "rechaza un status inventado" |
| R1.10 | T1 | `model.test.ts` "rechaza un campo desconocido en vez de ignorarlo" |
| R5.1 | T4 | `process.test.ts` "reporta los procesos descubiertos", "emite el modelo parseado como JSON" |
| R5.2 | T6 | `process-model-single-parser.test.ts` (ambos), verificado por sabotaje/revert |
| R5.3 | T5 | `processes-section.test.ts` "puebla la sección desde el adapter", "un draft se reporta como attention", "un adapter que lanza degrada" |
| R5.4 | T5 | `processes-section.test.ts` "un registry externo no puede inyectar markup ni rutas" |
| R7.1 | T3, T4 | `discover.test.ts` "un modelo roto no impide descubrir los sanos", "nunca lanza con un root inexistente"; `process.test.ts` "emite los diagnósticos sin dejar de listar los sanos" |
| R7.2 | T4, T7 | `process.test.ts` "sin modelos sale 0"; `no-regression.test.ts` "conserva las nueve secciones en orden" |
| R7.3 | T7 | `no-regression.test.ts` "usa path.join y no separadores hardcodeados" + matriz CI de tres plataformas |
| R7.4 | T7 | `no-regression.test.ts` "el descubridor no toca el ~/.awm real" |

**Sin huecos hacia adelante** (todo `R#` de R1a tiene ≥1 task y ≥1 test) **ni hacia atrás** (ninguna task o test sin `R#`).

**Precisión de la matriz:** las filas citan tests cuya aserción prueba la afirmación específica del requirement, no un marcador genérico compartido. Los dos casos que merecen nota: **R1.8** no se puede probar por lo que el parser hace sino por lo que **no** hace, así que su test afirma la ausencia de un campo de decisión precomputada y la conservación de ambas filas; **R7.3** no puede correr Windows desde acá, así que su test verifica la *causa* mecánica (separadores) y la verificación real la aporta la matriz de CI en las tres plataformas.
