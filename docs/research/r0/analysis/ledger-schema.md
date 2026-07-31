# Esquema del ledger — suficiencia para mapear clusters a clases de defecto (R6, Step 2)

**Fuente:** `/home/user/agentic-workflow/cli/src/core/ledger/types.ts` (repo real, este mismo repo).

## El enum real

```ts
export type Polarity = 'win' | 'finding';
export type LedgerClass = 'structural' | 'logica' | 'proceso' | 'seguridad';
export type Severity = 'blocker' | 'important' | 'minor' | 'info';

export interface LedgerEntry {
    ts: string;
    branch: string;
    phase: string;
    source_skill: string;
    polarity: Polarity;
    class: LedgerClass;
    signature: string;
    severity: Severity;
    desc: string;
    ref?: string;
}
```

`LedgerClass` tiene exactamente 4 valores: `structural`, `logica`, `proceso`, `seguridad`. (Nota al margen, evidencia real: el ledger vivo de este repo contiene también valores `'estructural'` y `'arquitectura'` como `class` en algunas entradas — p.ej. `docs/research/r0/probes/consolidate.mjs` con `class: "arquitectura"` y `"estructural"` en `.awm/ledger/archive/...jsonl` línea 10 — que **no** están en el enum de `types.ts`. Esto es evidencia directa de shape drift ya ocurrido en producción: el tipo declara 4 valores pero el archivo real en disco tiene al menos 2 más, sin validación de shape en el punto de escritura/lectura. Es relevante para la pregunta de suficiencia: el enum como está *no se está cumpliendo* en la práctica.)

## El caso real: cluster de indentación

Búsqueda en `.awm/ledger/archive/claude__agentic-workflow-awm-issues-dqka6l-20260729T235946.jsonl` (archivo real de este repo) por el patrón de indentación citado en el brief (`docs/plans/2026-07-30-sdd-cycle-optimization-brief.md:29`: *"4 de ~9 hallazgos de revisión fueron indentación/convención... la clase entera de defecto no tenía detector mecánico"*). Tres entradas archivadas son ese cluster exacto:

```jsonl
{"ts":"2026-07-29T23:09:37.223Z", ..., "class":"structural", "signature":"transform-ts-mixed-indentation-introduced", "severity":"minor", "desc":"New code (isEmbeddedInUrl, pathlessForm, stripIntraRegistryPaths, lines ~13-47) uses 4-space indentation while the file's pre-existing functions (DEFERENCE_LINE, claudeAiTransform) use 2-space, introducing inconsistent style within the same file.", "ref":"cli/src/core/export/transform.ts:24"}

{"ts":"2026-07-29T23:24:00.711Z", ..., "class":"structural", "signature":"transform-test-indentation-mismatch-recurs", "severity":"important", "desc":"...this is the SECOND occurrence of the 4-space-vs-2-space mismatch in this plan (first caught in Task 5's review of transform.ts itself, signature transform-ts-mixed-indentation-introduced); worth curing at harness-retro rather than re-fixing locally each time.", "ref":"cli/tests/core/export/transform.test.ts:88"}

{"ts":"2026-07-29T23:33:50.093Z", ..., "class":"structural", "signature":"transform-test-strip-block-still-4space-test-style", "severity":"minor", "desc":"...a third, still-unfixed occurrence of the 4-space-vs-2-space pattern already caught and fixed twice elsewhere in this plan...", "ref":"cli/tests/core/export/transform.test.ts:118"}
```

Las tres tienen `class: "structural"` — el mismo valor que se le da a hallazgos completamente no relacionados en el mismo archivo (p.ej. `ledger-cluster-unused-ledgerentry-import`, `strip-paths-adjacent-parens-ok` en la línea 36, que es en realidad `class: "seguridad"`). El `signature` de las tres es distinto en cada ocurrencia (`transform-ts-mixed-indentation-introduced`, `transform-test-indentation-mismatch-recurs`, `transform-test-strip-block-still-4space-test-style`) — texto libre correlacionado solo por contenido de `desc`, no por ningún campo estructurado.

## ¿Bastan `class`/`signature`/`ref`/`desc` para mapear un cluster convergente a una clase de defecto con/sin sensor?

**No, no bastan tal como están tipados hoy — faltan dos cosas concretas, evidenciadas por el caso real de arriba:**

1. **Falta un identificador de "clase de defecto" independiente de `class` y `signature`.** `class: LedgerClass` es una taxonomía de 4 buckets (estructural/lógica/proceso/seguridad) — demasiado gruesa para responder "¿qué clase de defecto es esta?" (todas las entradas de indentación caen en `structural`, junto con decenas de hallazgos sin relación). `signature` es texto libre único por entrada (`transform-ts-mixed-indentation-introduced` vs `transform-test-indentation-mismatch-recurs` vs `transform-test-strip-block-still-4space-test-style`) — las tres describen la MISMA clase de defecto (indentación inconsistente 2 vs 4 espacios) pero tienen tres `signature` distintas. El propio harness lo reconoce en prosa (`"worth curing at harness-retro"`, `"the SECOND occurrence"`, `"a third... occurrence"`) porque un humano/agente leyó los `desc` y conectó los puntos — no hay campo estructurado que un consolidador automático (tipo PR-1 del brief) pueda agrupar sin NLP sobre `desc`.

2. **Falta un campo que diga si la clase de defecto tiene o no un sensor mecánico que la cubra.** Ninguno de `class`, `signature`, `ref`, `desc` codifica "¿existe un check automatizado para esto?". La evidencia de que faltaba es textual, otra vez en `desc` de una entrada de `cluster.test.ts` en el ledger vivo (no archivado): la nota de CONSTITUTION.md (`CONSTITUTION.md:37`) dice explícitamente *"**Sin sensor mecánico** — este repo no tiene una regla ESLint de indentación... evaluado y descartado por desproporcionado"* — ese hecho vive en prosa de CONSTITUTION.md, no en ningún campo del ledger.

**Vocabulario que falta, concretamente:**

- Un campo tipo `defectClass?: string` (o `pattern-id`) — un slug estable y reutilizable entre entradas (ej. `"mixed-indentation-in-existing-file"`), distinto de `signature` (que puede seguir siendo único por ocurrencia) y de `class` (que sigue siendo la taxonomía gruesa). Sin esto, "cluster convergente" solo se puede detectar agrupando manualmente por similitud de `desc`/`signature`, como de hecho ocurrió en este caso real (un agente humano-en-la-máquina notó la recurrencia mirando el histórico, no un consolidador determinístico).
- Un campo tipo `sensorCoverage?: 'none' | 'partial' | 'covered'` (o referencia al sensor-pack/regla que lo cubriría) para poder responder la pregunta de PR-1 del brief (`docs/plans/2026-07-30-sdd-cycle-optimization-brief.md:87`: *"si `class`/`signature`/`ref` bastan para mapear un cluster convergente a una 'clase de defecto sin sensor', o si hace falta vocabulario adicional"*) sin tener que releer `CONSTITUTION.md` en prosa para saber que ese caso específico no tiene sensor.

**Conclusión: no, el esquema actual (`class`/`signature`/`ref`/`desc`) no basta.** El caso real del cluster de indentación (3 entradas archivadas, `cli/src/core/ledger/types.ts`, `.awm/ledger/archive/claude__agentic-workflow-awm-issues-dqka6l-20260729T235946.jsonl` líneas 14/18/22) demuestra que la convergencia se detectó por lectura humana de `desc` en lenguaje natural y quedó documentada como regla en `CONSTITUTION.md:37` — ningún campo del `LedgerEntry` tipado hoy captura ni "estas 3 entradas son la misma clase de defecto" ni "esta clase de defecto no tiene sensor". Además, el enum real de `class` ya tiene drift observado en disco (`'estructural'`, `'arquitectura'` fuera de los 4 valores declarados), lo que agrava la falta de shape validation además de la falta de vocabulario.
