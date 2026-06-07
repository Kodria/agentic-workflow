# Body B-3 — El loop de aprendizaje (el trinquete) — Diseño

**Fecha:** 2026-06-06
**Origen:** Harness shakedown lab (`docs/harness-shakedown/`). Body B-3 cierra la capa 5 del portafolio de B-2: el trinquete de aprendizaje que hoy es aspiracional.
**Rama:** `harness-b3-learning-loop`

**Principio rector:** el harness debe **aprender de cada sesión de desarrollo — lo bueno y lo malo** — y convertir ese aprendizaje en **inputs concretos y alcanzables** que el agente lea/ejecute en desarrollos futuros, para que deje de cometer los mismos errores. El aprendizaje crece con el tiempo **sin saturar el contexto**, porque lo que evita la saturación es la **curación**, no el almacenamiento.

**Alcance:** el ledger persistente de hallazgos, su wiring de captura en las fases que ya producen hallazgos, la reescritura de `harness-retro` de "memoria humana" a "ledger-driven + interactiva", y su inserción como fase terminal de `development-process`. NO incluye nuevas clases de sensores ni cambios al gate determinístico (eso fue B-2).

---

## El problema (confirmado contra el código actual)

`harness-retro` está **muerto por diseño**, por dos huecos:

1. **Sin memoria.** Su paso 1 ("Confirm recurrence — ¿dónde falló antes?") depende de que un humano recuerde dos ocurrencias. La única "memoria" que consulta es `docs/harness-retros.md` + mensajes de commit `harness-retro:` — pero ese archivo se escribe **después** de completar un retro (paso 9). O sea: el harness solo "recuerda" lo que **ya** se volvió regla, nunca la primera ocurrencia cruda. Detectar la **segunda** ocurrencia es por lo tanto imposible.
2. **Sin trigger.** Es cross-cutting; nadie lo rutea como fase del flujo. El diamante "¿Hallazgo recurrente (≥2)?" en `post-implementation-qa` no tiene mecanismo que cuente ocurrencias — el agente tendría que *saber* que es recurrente, cosa que no puede sin memoria.

B-3 cierra ambos huecos: una **memoria de trabajo determinística** (el ledger) y un **trigger incondicional** (harness-retro como fase terminal).

---

## Arquitectura: dos niveles de memoria

El error clásico es tratar "memoria del LLM" como un solo archivo que crece y se inyecta cada sesión — eso satura el contexto sí o sí. B-3 separa:

- **Nivel 1 — Memoria de trabajo (efímera, fuera de contexto):** el ledger crudo por branch. Crece libremente durante un ciclo de desarrollo porque **nunca se inyecta al contexto** — solo lo lee `harness-retro`, una vez, al final. Se descarta del flujo al cerrar el branch (archivado en disco, no arrastrado al próximo plan).
- **Nivel 2 — Memoria de largo plazo (curada, acotada, ya en el camino de entrega):** `harness-retro` destila los hallazgos en inputs concretos escritos **solo en documentos que ya existen y que el agente ya lee/ejecuta** — `CONSTITUTION.md`, `AGENTS.md`, y el árbol de remediación (sensores). **Cero documentos feedforward nuevos.** El crecimiento queda acotado porque la curación **destila, fusiona y poda**, no anexa crudo.

```
Durante el branch:  cada review (subagentes SDD), post-qa, sensores, debugging  ──awm ledger add──▶  .awm/ledger/<branch>.jsonl
                    (errores Y aciertos)                                                              (memoria de trabajo, FUERA de contexto, gitignored)
                                                                                                              │
Al terminar:        development-process ──fase terminal──▶ harness-retro ──awm ledger list/recurring──────────┘
                                                                │
                                                    cura interactivamente (el usuario decide por item)
                                                                ▼
                            ┌───────────────────────────────────┼───────────────────────────────┐
                    sensor-catchable                      regla de proyecto                 estilo agente + WINS
                    eslint/semgrep/structural test         CONSTITUTION.md                       AGENTS.md
                    (el sensor lo caza)                    (agnóstico por B-1)               (leído cada sesión)
                                                                │
                                              luego: awm ledger archive — no se arrastra al próximo plan
```

---

## Componente 1 — `awm ledger` (memoria de trabajo determinística)

**Dónde:** subcomando nuevo en `cli/` (`cli/src/commands/ledger/`), análogo a `cli/src/commands/sensors/`.

El subcomando posee el append, el fingerprint y la query de recurrencia — el agente solo corre comandos (como `awm sensors run`). La cuenta "≥2" la computa la máquina, no el juicio del agente.

**Superficie CLI:**

| Comando | Qué hace |
|---|---|
| `awm ledger add --polarity <win\|finding> --class <structural\|logica\|proceso\|seguridad> --signature <slug> --severity <blocker\|important\|minor\|info> --desc "…" --ref <file:line>` | Anexa una entrada al ledger del branch actual (branch auto-detectado vía `git`). |
| `awm ledger list [--branch <b>]` | Devuelve los hallazgos del branch (lo que `harness-retro` consume). |
| `awm ledger recurring [--min N]` | Agrupa por `signature` y reporta clusters con cuenta ≥ N (default 2). **Señal informativa, no gate.** |
| `awm ledger archive [--branch <b>]` | Rota el ledger del branch a `.awm/ledger/archive/` al cerrar. El próximo branch arranca fresco. |

**Schema de entrada (jsonl), una entrada por línea:**

```json
{ "ts": "ISO-8601", "branch": "harness-b3-learning-loop", "phase": "post-qa",
  "source_skill": "post-implementation-qa", "polarity": "finding",
  "class": "logica", "signature": "public-fn-returns-infinity",
  "severity": "blocker", "desc": "splitBill(100,0) devuelve Infinity",
  "ref": "src/split.ts:12" }
```

**Ubicación y persistencia:**
- Ledger crudo en `.awm/ledger/<branch>.jsonl` — **por branch**, project-local. La separación por branch hace trivial "fresco por plan, descartado al cerrar".
- **`.awm/ledger/` va gitignored.** Es memoria de trabajo (como un build artifact). El intercambio entre devs ocurre limpio vía `CONSTITUTION.md`/`AGENTS.md` (commiteados), no compartiendo hallazgos crudos.

**Puntos de diseño:**
- `branch` se auto-detecta con `git rev-parse --abbrev-ref HEAD`; si no hay git (greenfield sin init), degrada a un branch sentinel (`_no-branch`) sin crashear.
- `signature` es un slug provisto por el caller (la skill o el sensor). Para sensores es natural y estable (`<sensor-name>:<rule-id>`); para hallazgos de review/QA la skill genera un slug canónico corto. El agrupamiento de `recurring` es por match exacto de `signature` (determinístico) — la interpretación semántica de "mismo root cause" la hace el humano en `harness-retro`, no la CLI.
- Append idempotente a nivel de archivo: jsonl append-only; entradas duplicadas exactas se permiten (cada ocurrencia cuenta — eso es justo lo que alimenta `recurring`).

---

## Componente 2 — Wiring de captura (todo hallazgo, bueno y malo)

**Dónde:** los prompts/skills que ya producen hallazgos hoy anexan al ledger vía `awm ledger add`.

| Fuente | Cuándo anexa | Qué |
|---|---|---|
| `subagent-driven-development` (spec reviewer + code-quality reviewer) | Tras cada review por tarea | Un `add` por hallazgo, **y los reviewers también emiten WINS** (`--polarity win`) — "esto se hizo bien". |
| `post-implementation-qa` (deep-review) | Tras el deep-review | Un `add` por hallazgo Type B/C. |
| `verification-before-completion` | Cuando una falla de sensor reincide (mismo `name`+`rule`) | Un `add` con `signature=<sensor>:<rule>`. |
| `systematic-debugging` | Al confirmar root cause de un bug | Un `add` con la clase del bug. |

**Cambio clave — capturar lo bueno:** los prompts de review/QA hoy solo emiten problemas. Para capturar "lo bueno", los prompts de los reviewers de SDD y el deep-review de QA deben **también surfacar lo que funcionó** (`--polarity win`). Sin esto nunca aprendemos los aciertos.

**Límite:** estos `add` los emite el agente siguiendo la prosa de la skill. El registro **determinístico** del *count* lo da la CLI (`recurring`); que el agente recuerde anexar lo refuerza la prosa de cada skill (igual que hoy se le pide correr `awm sensors run`). No introducimos un hook nuevo por ahora — el wiring vive en las skills.

---

## Componente 3 — `harness-retro` reescrita (ledger-driven, incondicional, interactiva)

**Dónde:** `registry/skills/harness-retro/SKILL.md`.

La skill deja de pedirle al usuario "¿dónde falló antes?" (memoria humana, paso 1 actual) y pasa a ser **ledger-driven**:

1. **Leer la sesión:** `awm ledger list` + `awm ledger recurring --min 2` → hallazgos del branch (errores + wins) con la cuenta de recurrencia.
2. **Presentar todo interactivamente:** errores Y aciertos, con la recurrencia como **pista, no ley**. Adiós al gate rígido ≥2 — el usuario puede estructuralizar con una sola ocurrencia si importa, o diferir una recurrente.
3. **El usuario decide por item** la acción concreta.
4. **Aplicar al destino curado correcto:**

   | Clase de hallazgo | Destino curado (ya existente) | Quién lo "alcanza" en el futuro |
   |---|---|---|
   | Atrapable por sensor (estructural/seguridad/lógica) | Árbol de remediación: `eslint.config.awm.mjs` / `.semgrep.awm.yml` / `tests/structural/` | El **sensor** lo caza (determinístico) |
   | Regla del proyecto (no-negociable) | `CONSTITUTION.md` | Entregado cada sesión (hook Claude / `instructions[]` OpenCode — agnóstico por B-1) |
   | Estilo de trabajo del agente + **los WINS** | `AGENTS.md` | Leído por el agente al inicio de cada sesión |

5. **Curar, no anexar crudo:** al escribir en `CONSTITUTION.md`/`AGENTS.md`, **fusionar y podar** entradas viejas que ya no aplican, para que los docs no crezcan sin techo. Es el mismo patrón que un índice curado, no un log infinito.
6. **Archivar:** `awm ledger archive` — el ledger del branch sale del flujo; el próximo plan arranca fresco.
7. **Log de auditoría:** se mantiene `docs/harness-retros.md` (paso existente) como evidencia commiteada de qué se estructuralizó.

**Matiz de agnosticismo (B-1):** las lecciones de **estilo de agente** y los wins aterrizan en `AGENTS.md` (la convención que *todo* agente lee), no en `CLAUDE.md` (solo Claude). Así un win aprendido con Claude lo hereda OpenCode. `CONSTITUTION.md` ya es agnóstico por B-1.

**El umbral ≥2 hoy:** el `min 2` de `recurring` deja de ser un gate automático y pasa a ser **una pista que harness-retro muestra**. La decisión es del usuario, por item.

---

## Componente 4 — `development-process` wiring (trigger incondicional)

**Dónde:** `registry/skills/development-process/SKILL.md`.

`harness-retro` se vuelve **fase terminal** del lifecycle: `post-qa → harness-retro → finishing`.

- **Siempre corre** (no condicionada a ≥2): lee el ledger; si está vacío, sale rápido y rutea a finishing.
- Se agrega la fila a la tabla de pipeline (Phase 4.5) y la regla de routing: tras `<!-- awm-qa-complete -->`, el estado pasa a "Retro pendiente" → invocar `harness-retro`; solo después → `finishing-a-development-branch`.

**Punto de diseño:** el orquestador detecta "retro pendiente" de forma determinística — p.ej. ausencia de un marker `<!-- awm-retro-complete -->` en el plan tras el `awm-qa-complete`, análogo al gate de QA. `harness-retro` agrega ese marker al cerrar.

---

## Componente 5 — Ciclo de vida de la memoria

- **Ledger crudo:** efímero, por branch, **fuera del contexto** (nunca inyectado), gitignored, archivado al cerrar, **no arrastrado** al próximo plan. Crece sin costo de contexto porque nadie lo inyecta.
- **Docs curados** (`CONSTITUTION.md`/`AGENTS.md`/sensores): commiteados, **acotados por curación** (harness-retro fusiona/poda). Es lo único que sobrevive — y ya está en el camino de entrega, así que B-3 suma **cero superficie nueva de contexto**.

---

## Error handling

- `awm ledger add` sin git/branch detectable → branch sentinel `_no-branch`, no crashea.
- `awm ledger add` con `.awm/ledger/` inexistente → crea el dir (igual que `initSensors` con `.awm/`).
- `awm ledger list`/`recurring` sobre un branch sin ledger → lista vacía, exit 0 (harness-retro sale rápido).
- `awm ledger archive` sobre un ledger inexistente → no-op, no crashea.
- jsonl con una línea malformada → se saltea esa línea con warning, no aborta la query (degradación honesta).

## Testing

- **`awm ledger add`:** anexa una entrada bien formada al `.awm/ledger/<branch>.jsonl`; crea el dir si falta; sin git → `_no-branch`.
- **`awm ledger recurring`:** dos entradas con misma `signature` → cluster con count 2 reportado; `--min 3` con count 2 → no lo reporta; signatures distintas → no agrupa.
- **`awm ledger list`:** devuelve todas las entradas del branch; branch sin ledger → vacío.
- **`awm ledger archive`:** mueve el ledger a `archive/`; el branch queda sin ledger activo; archivo inexistente → no-op.
- **Línea malformada:** `list`/`recurring` saltean la línea corrupta sin abortar.
- **Wiring (regresión de prosa):** grep — los prompts de SDD-reviewers, post-qa-deep-review, verification-before-completion y systematic-debugging contienen la instrucción `awm ledger add`; los reviewers/QA incluyen captura de `--polarity win`.
- **harness-retro:** la skill ya no contiene el paso "¿dónde falló antes?" (memoria humana) y sí contiene `awm ledger list`/`recurring`/`archive` + la tabla de destinos curados + el marker `awm-retro-complete`.
- **development-process:** la tabla de pipeline incluye la fase `harness-retro` entre QA y finishing; la regla de routing detecta "retro pendiente" por ausencia de `awm-retro-complete`.

## Componentes y límites (para aislamiento)

| Unidad | Propósito | Depende de |
|---|---|---|
| 1. `awm ledger` CLI | memoria de trabajo determinística (add/list/recurring/archive) | git branch detection, `.awm/ledger/`, jsonl |
| 2. Wiring de captura | las fases que producen hallazgos anexan (errores + wins) | prosa de SDD-reviewers, post-qa, verification, systematic-debugging |
| 3. harness-retro reescrita | ledger-driven, interactiva, cura en 2 niveles | `awm ledger`, árbol de remediación, CONSTITUTION/AGENTS.md |
| 4. development-process wiring | harness-retro como fase terminal incondicional | marker `awm-retro-complete`, tabla de pipeline |
| 5. Ciclo de vida | ledger efímero fuera de contexto; curados acotados | gitignore, `awm ledger archive`, poda en harness-retro |

## Orden de implementación sugerido

1. **Componente 1** (`awm ledger` CLI) — independiente, base de todo lo demás. TDD en `cli/`.
2. **Componente 3** (harness-retro reescrita) — consume la CLI; define el contrato que el wiring debe alimentar.
3. **Componente 2** (wiring de captura) — alimenta el ledger desde las fases; depende del schema de la CLI y del contrato de harness-retro.
4. **Componente 4** (development-process wiring) — cierra el trigger; depende de que harness-retro exista en su nueva forma.
5. **Componente 5** (gitignore + poda) — transversal; se aterriza junto con 1 (gitignore) y 3 (poda).

## Límite de alcance (lo que NO entra en B-3)

- Nuevas clases de sensores o cambios al gate determinístico → fue **B-2**.
- Clustering semántico automático de hallazgos (LLM agrupa "mismo root cause") → fuera de alcance por decisión: el agrupamiento de la CLI es por `signature` exacta (determinístico); la interpretación semántica la hace el humano en harness-retro. Si un día se quiere, hereda el ledger sin cambios.
- Un hook que fuerce el `awm ledger add` (en vez de prosa de skill) → diferido; el wiring vive en las skills, consistente con cómo se invoca `awm sensors run` hoy.
- Soporte de Antigravity → fuera de alcance hasta estabilizar Claude + OpenCode (la CLI y los docs curados quedan agnósticos por construcción).
