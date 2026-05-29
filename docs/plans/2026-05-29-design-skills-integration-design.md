# Integración de skills de diseño al flujo AWM

**Fecha:** 2026-05-29
**Estado:** Diseño aprobado
**Branch:** feature/new-skills

## Problema

`development-process` ejecuta bien el ciclo de desarrollo (brainstorming → plan → ejecución con TDD → finishing), pero **la capa frontend produce resultados genéricos**: las landings salen templated, sin conceptos de diseño responsive ni craft, y obligan a iterar manualmente sobre lo ya construido.

Esto contradice la filosofía objetivo del usuario: **el desarrollo debe ser desatendido y, al terminar, todo debería estar perfecto** — solo correcciones menores, nunca re-iterar sobre lo construido.

Se instalaron 4 skills de diseño vía `npx skills add` (canal skills.sh, en `~/.agents/skills/`), invisibles para AWM (`registry/`, `processes.json`, el pipeline). El objetivo es (1) traerlas al registry y (2) integrarlas al flujo para cerrar el agujero de craft frontend.

### Tres causas raíz del "sale genérico"

1. **Brief de diseño débil** — `brainstorming`/`writing-plans` no capturan dirección de diseño (referencias, vibe, densidad, responsive). Sin brief explícito, el LLM cae en su estética default.
2. **Ejecución sin reglas de craft** — la fase de ejecución tiene TDD obligatorio pero ninguna regla anti-slop, tipografía, color o responsive.
3. **No hay loop visual** — el sistema nunca *ve* lo que construyó. "Perfecto al terminar de forma desatendida" es imposible sin que el pipeline renderice → mire → critique → corrija solo.

## Enfoque elegido

**Enfoque 3 — Híbrido:** gate liviano de taste siempre activo en ejecución + motor pesado (impeccable) on-demand cuando el trabajo es UI-céntrico + handoff Stitch→código reforzado. Ataca las 3 causas raíz simultáneamente.

Enfoques descartados:
- **1 (Taste horneado liviano):** no alcanza el craft profundo; reconstruye a mano valor de impeccable.
- **2 (impeccable como único motor):** demasiado pesado para cada cambio menor; dos motores de ejecución a mantener.

## Inventario de skills y roles (resuelve la colisión de triggers)

El riesgo de traer las 4 tal cual es que sus `description` se pisan ("design, redesign, polish, animate, frontend…") y Claude no sabría cuál disparar. Se resuelve con roles disjuntos y **un único punto de entrada orquestador**.

| Skill | Rol tras integración | ¿Dispara solo? |
|---|---|---|
| **`frontend-craft`** *(nueva)* | **Único gate de entrada** de craft frontend. Consolida reglas accionables (anti-slop, tipografía, color, responsive hard-rules) y decide cuándo escalar a impeccable. Es lo que invoca development-process en ejecución. | ✅ Sí (único trigger por contexto frontend) |
| **`emil-design-eng`** | Base de conocimiento (animación, springs, easing, micro-interacciones, polish). Vendorizada como **referencia** de `frontend-craft`. | ❌ No (description neutralizada) |
| **`design-taste-frontend`** | Base de conocimiento anti-slop + Design Read + dials. Alimenta el Design Brief y el gate. **Referencia**, no trigger. | ❌ No |
| **`impeccable`** | **Motor pesado** de craft+QA (craft/shape/audit/polish/live). Invocado por `frontend-craft` para trabajo UI-céntrico o por el loop visual. También disponible para correcciones post-finish. | ⚠️ Invocado, no por colisión |
| **`ui-design`** *(existente)* | Diseño visual pre-implementación con Stitch. Mismo rol; handoff mejorado. | ✅ Sí (ya integrado a `## UI Screens`) |

**Principio:** una skill orquestadora (`frontend-craft`) que usa emil + design-taste como conocimiento e impeccable como motor pesado. Un solo trigger, cero ambigüedad; el sistema decide la profundidad, no el usuario.

## Plan de vendoring (cómo entran al registry)

| Artefacto | Destino | Notas |
|---|---|---|
| `frontend-craft` (nueva) | `registry/skills/frontend-craft/` | SKILL.md orquestador + `reference/`. Description acotada: dispara solo ante implementación/ajuste de UI. |
| `emil-design-eng` | `registry/skills/frontend-craft/reference/emil-*.md` | Referencia dentro de frontend-craft, no skill top-level. Contenido íntegro. |
| `design-taste-frontend` | `registry/skills/frontend-craft/reference/taste-*.md` | Referencia. Conservar §0 (Design Read), dials, anti-slop, hard-rules. |
| `impeccable` | `registry/skills/impeccable/` | Skill top-level, copia completa (~40 scripts, ~27 refs, agents). |
| `extract-design-md` (Google) | `registry/skills/extract-design-md/` | Stitch spec desde código/pantalla. |
| `code-to-design` (Google) | `registry/skills/code-to-design/` | Round-trip código↔Stitch. |
| `react-components` (Google) | `registry/skills/react-components/` | Stitch → sistema de componentes React (handoff clave). |

### Fix técnico y alcance de impeccable

**Alcance acotado (decisión 2026-05-29):** se vendoriza solo **knowledge + detector estático + sub-comandos no-live**. Se descarta la capa `live`/Codex (modo de variantes en browser y asset-producer), porque (a) portar su orquestación de agentes Codex→Claude es un proyecto aparte y (b) se solapa con el loop visual de Playwright del Plan B.

- **Conservar:** `reference/*.md` de diseño (menos `live.md`/`codex.md`), detector estático (`scripts/detector/`, `detect.mjs`, `detect-csp.mjs`), y scripts de soporte no-live: `context.mjs`, `context-signals.mjs`, `critique-storage.mjs`, `design-parser.mjs`, `is-generated.mjs`, `palette.mjs`, `pin.mjs`, `cleanup-deprecated.mjs`, `command-metadata.json`, `impeccable-paths.mjs`.
- **Eliminar:** todos los `scripts/live-*.mjs`, `scripts/live-browser*.js`, `scripts/modern-screenshot.umd.js`, el dir `agents/` (defs Codex/openai), `reference/live.md`, `reference/codex.md`, y la fila `live` de la tabla de comandos del SKILL.md.
- **Fix de paths:** los scripts resuelven datos contra el `cwd` del proyecto (correcto, no se tocan). Solo hay que reescribir las invocaciones literales `node .agents/skills/impeccable/scripts/X.mjs` (en `SKILL.md`, `reference/init.md`, `reference/critique.md`, `reference/polish.md`) para que resuelvan contra el directorio base de la skill.
- **De-tuning a Claude:** reescribir prosa con sabor GPT ("GPT is capable…") en SKILL.md y refs restantes.
- Dependencias: solo Node builtins + `@babel/parser` (carga lazy).
- Método de instalación: **copy** (trae scripts; debe viajar con el repo destino).

### Registro y agrupación

- **`skills-lock.json`:** registrar procedencia (source GitHub + hash) de emil (`emilkowalski/skill`), design-taste (`Leonxlnx/taste-skill`), impeccable (`pbakaus/impeccable`), y las 3 de Google (`google-labs-code/stitch-skills`).
- **`registry/processes.json`:**
  - `frontend-craft` → proceso **`core-dev`** (parte inseparable del pipeline).
  - `impeccable` + `ui-design` + `extract-design-md` + `code-to-design` + `react-components` → proceso nuevo **`frontend-design`** (capacidad opcional pesada, instalable por separado).

## Cambios al pipeline (development-process)

Tres inserciones autónomas, una por causa raíz:

### ① Design Brief — en `brainstorming` (causa #1)
Cuando una feature tiene UI, sub-paso obligatorio que captura dirección de diseño en una sección nueva del design doc `## Design Direction`: referencias/vibe, público, densidad, modo claro/oscuro, targets responsive. Reutiliza el "Design Read" (§0) y los dials de design-taste.

### ② Frontend-craft gate — en ejecución (causa #2)
`executing-plans` y `subagent-driven-development` ganan una regla **cross-cutting obligatoria** (como TDD): si la tarea toca UI → invocar `frontend-craft` antes de darla por hecha. El gate aplica reglas anti-slop/tipografía/color/responsive y decide si escala a `impeccable` (UI-céntrico) o aplica solo reglas (cambio menor).

### ③ Loop de verificación visual — frontera ejecución→finishing (causa #3)
Enganchado en `verification-before-completion`. Hace posible "perfecto al terminar":

```
render app (apoyado en skills run/verify) → screenshot (Playwright MCP) →
critique contra Design Brief + checklist AI-tells →
  ¿pasa? → finishing
  ¿no pasa? → auto-fix (frontend-craft/impeccable polish) → repetir (máx N=3)
después de N=3 sin pasar → escalar al usuario con reporte (= "corrección menor")
```

- Usa el MCP de **Playwright** (ya conectado) para que el sistema vea su output.
- Levanta la app apoyándose en las skills `run`/`verify` existentes (no reinventa detección de dev server).
- Tope **N=3** rondas antes de escalar.

### Lifecycle resultante

```
brainstorming (+Design Brief si hay UI)
   → ui-design/Stitch (opcional, si ## UI Screens)
   → writing-plans
   → ejecución (executing-plans / subagent-driven-development)
        └─ [gate] frontend-craft en toda tarea UI → escala a impeccable si UI-céntrico
   → verificación visual (render→screenshot→critique→auto-fix, máx N=3)
   → finishing
```

### Archivos a editar
- `brainstorming/SKILL.md` — sub-paso Design Brief + sección `## Design Direction` en el doc.
- `development-process/SKILL.md` — tabla cross-cutting + lifecycle actualizado.
- `executing-plans/SKILL.md` y `subagent-driven-development/SKILL.md` — regla del gate frontend-craft.
- `verification-before-completion/SKILL.md` — paso de verificación visual.

## Capa Stitch (ui-design + stitch-skills de Google)

El handoff actual de `ui-design` es pobre: pasa una referencia de pantalla y la implementación arranca casi de cero (otra fuente de "genérico"). Se cierra adoptando 3 stitch-skills de Google (mismo MCP).

- `ui-design` **mantiene su rol** de orquestador en el pipeline (lee `## UI Screens`, genera, termina en writing-plans). No se reemplaza.
- **Se enriquece:** al aprobar pantallas, dispara `extract-design-md` → vuelca tokens/spec al design doc, y deja listo `react-components` para ejecución.

**Cadena de fidelidad de diseño:**
```
Stitch (diseño) → extract-design-md (spec) → ## Design Direction del doc →
frontend-craft gate (implementación fiel) → loop visual (verifica contra esa spec)
```
El diseño de Stitch deja de tirarse a la basura.

`taste-design` (Google) queda **descartada** por solapamiento con frontend-craft. Resto de stitch-skills (remotion, shadcn, stitch-loop) fuera de alcance.

## Alcance de esta iteración

Incluye todo lo anterior: `frontend-craft` (con emil + design-taste como refs), `impeccable` vendorizado y de-tuneado, loop de verificación visual, Design Brief en brainstorming, y las 3 stitch-skills de Google.

## Criterios de éxito

1. Las skills de diseño viven en `registry/`, en `skills-lock.json` y en `processes.json` (core-dev + frontend-design); instalables vía `awm add`.
2. `frontend-craft` es el único trigger frontend; emil/design-taste no colisionan.
3. impeccable funciona en Claude Code (paths resueltos, prompts de-tuneados).
4. development-process aplica Design Brief, gate de craft y loop visual de forma autónoma.
5. El handoff Stitch→código conserva la spec de diseño.
6. Una landing de prueba ejecutada de punta a punta sale **no-genérica y responsive sin iteración manual** más allá de correcciones menores.

## Riesgos

- **Costo de tokens** del loop visual y de impeccable — mitigado por el gate liviano que escala solo cuando amerita y por el tope N=3.
- **De-tuning de impeccable** puede requerir varias pasadas para rendir bien en Claude.
- **Dependencia del MCP de Stitch y Playwright** — si no están conectados, las fases degradan con gracia (skip + aviso).
