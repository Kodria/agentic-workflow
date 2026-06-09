# Body B-2 — Gate de calidad determinístico — Diseño
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

**Fecha:** 2026-06-06
**Origen:** Harness shakedown lab (`docs/harness-shakedown/`). Body B-2 agrupa los Hallazgos #2 y #3 + el ⭐ insight central (alcance-vs-seguridad).
**Rama:** `harness-shakedown-lab`

**Principio rector:** la garantía de calidad debe ser **determinística y agnóstica** — dispara sin importar qué agente escribió el código. El lab probó que el "verde" del arnés viene hoy del **juicio del agente** (no-determinístico: Claude embarcó `splitBill(100,0)→Infinity`, OpenCode lo cazó+arregló), no de un gate. B-2 mueve la garantía del juicio a capas que el arnés ejecuta.

**Alcance:** el **gate determinístico genérico** que envía AWM. NO incluye:
- El **trinquete de aprendizaje** (ledger + harness-retro como fase) → **Body B-3** (capa 5 del portafolio; hoy aspiracional).
- La **entrega agnóstica de `CONSTITUTION.md`** (Hallazgo #6) → **Body B-1**.

---

## Contexto del lab (evidencia ejecutada)

| Defecto | Evidencia real |
|---|---|
| **Pack `generic` → falso verde (#2)** | `awm init` corre `stepSensors`→`initSensors` con el dir **vacío** (greenfield) → `detectStack` = `generic` → manifest con solo `security` (semgrep, `fast:false`). Nadie re-detecta tras el scaffolding. `run --fast` (el hook) filtra `fast:false` → `results.length===0` → `overall:'skipped'`, exit 0: **cero sensores, verde benigno.** `run` full → solo semgrep `pass`: un proyecto TS dice "pass" sin correr nunca tsc/lint. |
| **Hueco de Body A** | `not_certified` solo dispara cuando **no hay manifest** (`run.ts:124,126`). Con un manifest `generic` en un proyecto JS, devuelve `skipped`/`pass` — leído como verde. Body A tapó "sin manifest", no "manifest equivocado para el stack real". |
| **Sin sensor `test`** | El pack `js-ts` tiene `typecheck`+`lint`+`security`+`depcheck`+`mutation` pero **ningún `test`**. Aun con re-detección perfecta, los tests unitarios no son gate. En el lab los 4 tests de `splitBill` los corría el agente (`npx vitest`), nunca el gate. |
| **Juicio de QA no-determinístico (#3)** | Misma skill `post-implementation-qa`, código idéntico, resultados opuestos: Claude QA "0 hallazgos" (waiveó por "fuera de alcance"); OpenCode QA "C1 BLOCKER + C2". La capa de juicio *es capaz* de cazar el bug, no lo *garantiza*. |

**⭐ El principio que falta:** el alcance puede excluir *features*, nunca *seguridad*. Una función pública jamás debería devolver `Infinity`/`NaN` en silencio.

---

## Arquitectura: dos momentos + defensa en profundidad

- **Momento per-edit** (hook `awm sensors run --fast`): tsc + lint. Rápido, tras cada edición.
- **Momento de completitud** (`awm sensors run` full, leído por `verification-before-completion`/QA): + tests + semgrep + depcheck. Es el que **certifica**.
- **El portafolio** se reparte entre lo que el gate **ejecuta** (capas 2-3), lo que se **hereda** como criterio (capas 1, 4) y el **trinquete** que las hace crecer (capa 5 → B-3).

**Frontera genérico/específico (principio fijado):**
> AWM (el marco) envía el **mecanismo** del gate + reglas **genéricas y agnósticas a clases de problema** (eval, secrets, SQL injection). Las reglas **específicas** de un bug que reincide las crece **harness-retro dentro del proyecto**, sobre los config files copiados al proyecto. El framework nunca enumera bugs puntuales. (El bug `splitBill→Infinity` valida la cadena como *ejemplo en un proyecto de prueba*, no como artefacto del framework.)

---

## Componente 1 — Fix #2: re-detección de pack (la "B refinada")

**Dónde:** `cli/src/commands/sensors/run.ts` + `init.ts`.

Función nueva `reconcilePack(manifestDir, manifest)`, llamada por `runSensors` justo tras leer el manifest (`run.ts:126`):

1. **Upgrade-only, idempotente.** Si `manifest.pack === 'generic'` **y** `detectStack(manifestDir)` ahora devuelve un pack real (`js-ts`/`python`) → reconstruye con `buildManifest` (que mergea `existingSensors`, preservando customizaciones), reescribe `sensors.json`, y emite en el output `packUpgraded: 'generic→js-ts'`. Si el pack ya es real → no-op (2da corrida no toca nada).
2. **Piso honesto.** Tras correr, si el resultado sería el verde benigno actual —`results.length===0` o todo `skipped`— **pero** `detectStack` encuentra indicadores en el árbol → `overall` pasa a `not_certified`, no `skipped`. Tapa `run.ts:155-156`: "manifest existe pero ningún sensor real corrió sobre un stack que sí existe" deja de leerse como verde.
3. **`generic` legítimo sigue honesto.** Proyecto sin indicadores → `not_certified` como hoy (Body A). No se inventa un pack.

**Trade-off declarado:** `run` puede reescribir `sensors.json` **una vez**. Guardas que lo vuelven seguro: solo upgrade desde `generic`, idempotente, preserva sensores existentes, reportado. Es el precio de que el gate se auto-corrija **sin depender de que el agente note nada** — el requisito agnóstico. `detectStack` es un par de `existsSync`; correrlo en cada `run --fast` es trivial.

---

## Componente 2 — Sensor `test` en el pack `js-ts` (capa 2)

**Dónde:** `registry/sensor-packs/js-ts/pack.json`.

```json
"test": {
  "fast": false,
  "enabled": true,
  "defaultCmd": "npm test --silent",
  "formatter": "generic"
}
```

**Decisiones:**
1. **`npm test` (script del proyecto), no un runner hardcodeado.** Lo más agnóstico: respeta el runner elegido (vitest/jest/node:test). Si el proyecto no definió script → falla honestamente.
2. **`fast: false` → momento de completitud, no per-edit.** Correr la suite tras cada edit es pesado; el momento que certifica es la completitud. El hook per-edit sigue siendo tsc+lint.
3. **Exit ≠ 0 ⇒ `fail`, no `skipped`.** Requisito explícito: las fallas de test son findings reales que bloquean. A confirmar en plan: que el mapeo de veredicto trate el exit no-cero del runner como `fail`.

**Límite — qué NO hace:** ejecuta los tests que *existen*; no verifica que existan tests de entradas límite. Esa *convención* es prosa (Componentes 4-5). La forma rigurosa y determinística ("solo probaste el caso feliz") es **mutation testing** — el pack ya trae `mutation` (stryker) `enabled:false`: principista-pero-diferido (lento/pesado), no se activa en este ciclo.

**Migración:** proyectos que upgradeen `generic→js-ts` heredan el sensor `test`; sin script → `fail`/`not_certified` honesto. Verificar que el propio `cli/` tenga script `test` seteado para no volverse rojo.

---

## Componente 3 — Frontera genérico/específico (capa 3)

**No agrega código nuevo.** AWM sigue enviando solo las 3 reglas semgrep genéricas que ya tiene (`registry/sensor-packs/js-ts/.semgrep.awm.yml`: eval, secrets, SQL injection). **No** se hornea ninguna regla nacida de una prueba (p.ej. división→Infinity).

La contribución de B-2 acá es **declarativa**: fijar el principio de frontera (arriba) en este doc para que la implementación no derive al overfitting. Las reglas específicas las crece **harness-retro per-proyecto** — mecanismo que ya existe (árbol de remediación → `.semgrep.awm.yml`/`eslint.config.awm.mjs`/`tests/structural/`/`CONSTITUTION.md` del proyecto).

**Dependencia honesta:** ese trinquete hoy **no dispara** (sin trigger ni memoria — ver B-3). Hasta que B-3 shippee, la capa 3-específica/5 es aspiracional. B-2 entrega el gate genérico (Componentes 1-2), que es la mayor ganancia de determinismo.

---

## Componente 4 — Invariante de seguridad genérico (capa 1)

**Dónde:** la fuente de `awm-context.md` en el registry (canal machine-global, generado del registry, entregado **agnósticamente** a Claude vía hook y a OpenCode vía `config-instructions`→`instructions[]`).

**Qué:** un *principio* genérico (no una regla específica):
> Toda función pública valida sus entradas y falla ruidosamente; nunca devuelve `Infinity`/`NaN`/`undefined` en silencio. El alcance puede excluir features, nunca el piso de robustez/seguridad.

**Por qué acá:** es una regla **genérica** de AWM → su hogar es `awm-context.md`, no `CONSTITUTION.md` (que es para lineamientos **específicos** del proyecto). Esto evita la sobre-extensión del framework (no se inyectan opiniones específicas) y es agnóstico de fábrica (el canal ya llega a ambos agentes). Feedforward, hereda criterio → "respaldo, no garantía".

---

## Componente 5 — Lente de seguridad en QA (capa 4)

**Dónde:** `registry/skills/post-implementation-qa/SKILL.md` (+ su `deep-review-prompt.md`).

**Qué:** regla genérica al criterio de QA:
> "Documentado-fuera-de-alcance NO exime invariantes de seguridad/robustez." Una función pública que devuelve `Infinity`/`NaN`/`undefined` en silencio, o que crashea con entradas límite, es un hallazgo **Type-C aunque el diseño lo haya declarado fuera de alcance.**

**Genérico, no overfitting:** es el *principio* alcance-vs-seguridad como lente de review; no nombra `splitBill` ni división.

**Honestidad sobre su valor:** la capa más débil — **juicio LLM, no-determinístico** (justo lo que el lab mostró divergiendo). Es **respaldo**, no garantía; sube la probabilidad de que el juicio cace lo que el gate estático no puede probar. (Su *delivery* inconsistente a OpenCode es #5/B-1; acá solo cambia el contenido, genérico.)

---

## Error handling

- **`reconcilePack`:** la re-detección/reescritura va en su propio try/catch; un fallo de FS no aborta la corrida de sensores — degrada a "no se pudo reconciliar", el `run` sigue. La reescritura es atómica (escribir y reemplazar) para no dejar un `sensors.json` corrupto.
- **Sensor `test` sin script:** `npm test` con exit no-cero → `fail` honesto, nunca verde silencioso.
- **Idempotencia:** correr `run` dos veces sobre un pack ya upgradeado no cambia nada la segunda vez.

## Testing

- **`reconcilePack`:** unit — (a) `generic` + indicadores presentes → upgrade a `js-ts`, manifest reescrito, `packUpgraded` reportado; (b) pack ya `js-ts` → no-op; (c) `generic` sin indicadores → no toca nada, `not_certified`; (d) preserva `existingSensors` customizados en el merge.
- **Piso honesto:** `run --fast` sobre un manifest `generic` con `package.json` en el árbol → `overall: 'not_certified'`, no `skipped`. Sin indicadores → `not_certified` (Body A, regresión).
- **Sensor `test`:** fixture con tests que pasan → `pass`; con un test roto → `fail` (no `skipped`); sin script `test` → `fail` honesto.
- **Migración `cli/`:** confirmar que `awm sensors run` desde `cli/` corre el nuevo sensor `test` y queda `pass` (script seteado).

## Componentes y límites (para aislamiento)

| Unidad | Propósito | Depende de |
|---|---|---|
| `reconcilePack` | `(pack=generic, indicadores?) → upgrade idempotente + piso honesto` | `detectStack`, `buildManifest`, lectura/escritura de `sensors.json` |
| Sensor `test` (pack js-ts) | tests del proyecto como gate de completitud | `npm test`, mapeo exit→veredicto |
| Frontera genérico/específico | Principio doctrinal (sin código) | — |
| Invariante genérico (awm-context) | Feedforward agnóstico de robustez | fuente de `awm-context.md` en registry |
| Lente de seguridad QA | Criterio de review (respaldo) | `post-implementation-qa/SKILL.md` |

## Límite de alcance (lo que NO entra en B-2)

- **Trinquete de aprendizaje** (ledger cross-sesión + harness-retro como fase terminal del flujo) → **Body B-3**. Sin esto, la capa 5 es aspiracional.
- **Entrega agnóstica de `CONSTITUTION.md`** (Hallazgo #6) → **Body B-1**.
- **Mutation testing** activado por defecto → diferido (pesado); queda `enabled:false` en el pack.
- **Hallazgos #1, #4, #5** (install/repair agnóstico) → **Body B-1**.
