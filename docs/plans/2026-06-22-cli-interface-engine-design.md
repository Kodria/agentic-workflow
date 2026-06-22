# Motor de interfaz del CLI (list + add) — Design

**Estado:** Aprobado · 2026-06-22
**Rama:** `feat/cli-interface-engine`
**Alcance de esta entrega:** `awm list` (render estático) + `awm add` (selector interactivo). Motor reusable para que `remove` y otras superficies lo adopten luego sin reescritura.

---

## 1. Problema

Las listas densas del CLI son ilegibles e imposibles de trabajar:

- **`awm list`** — la alineación por `padEnd` (`src/utils/registry-view.ts:103-119`) se rompe cuando la descripción es larga: wrappea sin respetar la columna, quedan líneas cortadas a media palabra.
- **`awm add`** — el `multiselect` de `@clack/prompts` mete `nombre\n  descripción completa` en cada opción (`src/utils/registry-view.ts:178-186`). Con 24 skills de 2-4 líneas cada una, clack las renderiza **todas a la vez sin viewport navegable** → un muro de texto donde no se distinguen los ítems ni los checkboxes.

Un intento previo maquilló sobre clack sin separar el render del I/O; no resolvió la navegación de listas largas (clack es justamente lo que genera el muro).

## 2. Objetivo y no-objetivos

**Objetivo:** un motor de interfaz que haga legibles y navegables los listados densos y la selección interactiva, **100% funcional y compatible** en todo entorno donde corre AWM (incluido Claude Code web / Ubuntu, terminales embebidas, salida a pipe/CI).

**No-objetivos (YAGNI):**
- No es un TUI full-screen (alternate screen buffer): es la pieza frágil en terminales embebidas; se descarta a propósito.
- No se reescribe `remove` ni los selectores de agente/scope en esta entrega (son listas cortas que hoy no duelen). El motor se diseña reusable para adoptarlos después.
- No se elimina `@clack/prompts`: se conserva para spinner/intro/outro/confirm y selectores cortos. Solo se reemplazan los `multiselect` de listas largas.

## 3. Decisiones de diseño (cerradas en brainstorming)

| # | Decisión | Razón |
|---|---|---|
| D-1 | Motor = **selector de dos paneles**, sin full-screen | Resuelve el muro de texto sin la parte frágil (alternate screen). Compatibilidad primero. |
| D-2 | Alcance = **`list` + `add`**, motor reusable | Ataca el dolor concreto sin tocar lo que funciona. |
| D-3 | Navegación = **flechas + filtro al escribir** (`/`) | Lo más cercano a fzf sin full-screen; mayor salto de usabilidad en listas de 24 ítems. |
| D-4 | Render puro separado del I/O de terminal | El intento previo falló por mezclarlos; separarlos hace el 90% testeable sin terminal. |
| D-5 | `@clack/prompts` se conserva; sin dependencias nuevas pesadas | Blast radius mínimo; teclado crudo con `process.stdin.setRawMode`. |

## 4. Arquitectura

Regla rectora: **toda decisión de layout es una función pura `(datos, ancho) → string[]`**, sin tocar la terminal. El I/O (leer teclas, redibujar) vive en una cáscara delgada encima.

### 4.1 Componentes

| Módulo | Responsabilidad | Naturaleza |
|---|---|---|
| `src/ui/text.ts` | `visibleLength(str)` (mide ignorando ANSI/color), `truncate(str, w)` con `…`, `wrap(str, w)`. Respeta `NO_COLOR`. | Puro |
| `src/ui/tty.ts` | `isInteractive()` = `process.stdout.isTTY && process.stdin.isTTY`; `terminalSize()` → `{ columns, rows }` con fallback. | Mockeable |
| `src/ui/picker-view.ts` | Estado del selector → `string[]` del frame. Decide dos-paneles vs. un-panel según ancho. | Puro |
| `src/ui/picker.ts` | Motor interactivo: lee teclas crudas, mantiene estado vía `pickerReducer(state, key)` (puro), redibuja con `picker-view`. Devuelve los valores elegidos. | Reducer puro + cáscara I/O fina |
| `src/utils/registry-view.ts` | *Refactor:* renderers estáticos de `awm list` pasan a width-aware usando `text.ts`. | Puro |

Sin dependencias nuevas: teclado crudo con `process.stdin.setRawMode` + parseo mínimo de secuencias de teclas (flechas, espacio, enter, backspace, ctrl-c, esc, imprimibles).

### 4.2 Flujo de datos

```
discover* ──▶ buildPackageView ──▶ (PackageView[])
                                      │
         awm list ◀────────── registry-view (width-aware, puro) ──▶ string[] ──▶ stdout
                                      │
         awm add  ◀── picker.ts ──▶ pickerReducer (puro) ──▶ picker-view (puro) ──▶ string[] ──▶ stdout (redibujo inline)
                          │
                          └── lee teclas ◀── stdin (raw mode)
```

## 5. Interacción del selector (`awm add`)

- **Redibujado inline (sin full-screen):** subir el cursor N líneas (`ESC[nA`), limpiar hacia abajo (`ESC[0J`), reimprimir el frame. Misma técnica que clack; cero alternate-screen → compatible con terminales embebidas.
- **Teclas:** `↑/↓` mover · `espacio` seleccionar/deseleccionar · `/` o escribir → filtra en vivo por nombre · `backspace` borra filtro · `a` marca/desmarca todo lo visible · `⏎` confirma · `esc`/`ctrl-c` cancela.
- **Layout adaptativo:** dos paneles si `columns ≥ 72`; bajo ese umbral colapsa a **un panel** (lista arriba, descripción del ítem resaltado abajo). Nunca se desarma.
- **Mismo motor para nivel-1 (paquetes) y nivel-2 (artefactos):** paquetes (pocos, descripción corta) → un panel; artefactos (largos) → dos paneles. Una sola pieza, distinta data.
- **Viewport con scroll:** si los ítems (filtrados) exceden el alto disponible, se hace scroll manteniendo el cursor visible; se indica con marcadores de "más arriba/abajo".

## 6. Las 3 garantías de compatibilidad

1. **`awm list` a prueba de balas.** Width-aware con `process.stdout.columns`. Con TTY: trunca la columna de descripción con `…`. Sin TTY (pipe/archivo/`columns` indefinido): imprime la descripción completa (sin truncar), salida estable y machine-friendly. Nunca rompe alineación.
2. **Selector sin full-screen.** Ver §5.
3. **Fallback no-interactivo obligatorio.** Si `isInteractive()` es falso → **nunca** se entra al selector. `awm add <nombre…>`, `--all` y `--yes` funcionan sin UI. Si no hay TTY y no se pasan nombres → error que orienta: *"Terminal no interactiva. Pasá nombres: `awm add <skill>…` o usá `--all`."*

## 7. Manejo de errores y restauración de terminal

- `ctrl-c`/`esc` en el selector → cancela limpio. **Invariante:** la terminal siempre queda restaurada (`setRawMode(false)` + cursor visible) vía `finally` y handler de `SIGINT`, pase lo que pase. Nunca se queda en raw mode.
- Salida de cancelación equivalente a `isCancel` de clack (outro "cancelado", exit code apropiado).
- Terminal angosta/baja → un panel (no error). Ancho desconocido / no-TTY → no se entra al selector (garantía 3).
- Validación de entrada: el reducer nunca produce un cursor fuera de rango ni un viewport negativo aunque la lista filtrada quede vacía (estado "sin coincidencias" explícito, no crash).

## 8. Estrategia de testing

| Capa | Qué se prueba | Cómo |
|---|---|---|
| `text.ts` | `truncate`/`wrap`/`visibleLength` con ANSI, color, emoji doble-ancho, strings más largos que la columna | Unit puro |
| `picker-view.ts` | Frame exacto en dos-paneles y un-panel; umbral de ancho; viewport/scroll; estado "sin coincidencias" | Unit puro, aserción de líneas exactas |
| `pickerReducer` | Filtrar, toggle, wrap de cursor, select-all, borrar filtro, cursor nunca fuera de rango | Unit puro |
| `registry-view.ts` | `awm list` width-aware: truncado con TTY vs. completo sin TTY; alineación con descripciones largas | Unit puro |
| Fallback | `isInteractive()` y el path de error sin-TTY de `awm add` | Unit con mock de `isTTY` |
| Cáscara I/O cruda | Entrada/salida real de teclas, restauración de terminal | Runbook manual (mínima por diseño) |

**TDD:** test primero en cada capa pura. Los tests deben aislar el entorno (no asumir `isTTY` real): mockear `process.stdout.columns`/`isTTY` por test y restaurar en `afterEach` (patrón `stub-process-platform` de AGENTS.md, con `configurable: true`).

## 9. Archivos

- **Crear:** `src/ui/text.ts`, `src/ui/tty.ts`, `src/ui/picker-view.ts`, `src/ui/picker.ts`
- **Crear tests:** `tests/ui/text.test.ts`, `tests/ui/picker-view.test.ts`, `tests/ui/picker-reducer.test.ts`, `tests/ui/tty.test.ts`
- **Modificar:** `src/utils/registry-view.ts` (renderers width-aware), `tests/utils/registry-view.test.ts`
- **Modificar:** `src/index.ts` (cablear `awm list` al render width-aware; `awm add` nivel-1/nivel-2 al picker; fallback no-interactivo)

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Parseo de teclas crudo incompleto (teclas raras, secuencias multi-byte) | Conjunto acotado y conocido de teclas; default seguro (ignorar lo no mapeado); runbook manual |
| Emoji/ancho variable desalinea columnas | `visibleLength` consciente de doble-ancho; tests con emoji |
| Terminal embebida no soporta raw mode | Garantía 3: si falla `setRawMode`, degradar a fallback no-interactivo en vez de crashear |
| Regresión en `awm add` (flujo crítico de instalación) | Render puro testeado + el flujo no-interactivo (`<name>`/`--all`/`--yes`) intacto como red de seguridad |
