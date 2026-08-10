# Backlog de verificación y deuda — 2026-08-09

**Qué falta para que la matriz de soporte no tenga ningún ⚠, y qué deuda de producto quedó identificada.**

Este documento es la fuente. Los issues de GitHub apuntan acá en vez de repetir el contenido — dos copias de un plan divergen en una semana, que es el modo de falla sobre el que este repo ya escribió varias retros.

## Estado al cerrar el 2026-08-09

| Proveedor | Instalación | Contexto | Hooks |
|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ⚠ | ⛔ no tiene |
| Cursor | ✅ | ⚠ | ⛔ no tiene |
| Copilot | ✅ (solo proyecto) | ⚠ | ⛔ no tiene |
| Antigravity | ✅ | ⛔ no tiene | ⛔ no tiene |

| Sistema | Suite en CI | Playbook a mano |
|---|---|---|
| Linux | ✅ | ✅ |
| Windows | ✅ | ⚠ |
| macOS | ✅ | ⚠ |
| WSL | — | ⚠ |

**Los ⚠ no son trabajo de código.** Son "nadie corrió esto contra el binario real". La lección de Codex —que pasó ⚠ → ❌ → ✅ en un día— es que la corrida encuentra cosas que ninguna cantidad de tests unitarios encuentra.

---

## A · Verificación por proveedor

Cada uno pide: tener el binario, correr [`core-acceptance.md`](../testing/core-acceptance.md), después la sección del agente en [`agent-matrix.md`](../testing/agent-matrix.md), y registrar el resultado en la hoja del playbook **y** en [`support-matrix.md`](../support-matrix.md).

**Antes de empezar, siempre:** `AWM_HOME` aislado + proyecto scratch. Y leer el aviso de aislamiento al final de `agent-matrix.md`: los archivos de config del agente (`~/.codex/hooks.json`, `~/.claude/settings.json`) **no** viven bajo `AWM_HOME`, así que una corrida de prueba los toca de verdad.

### A1 · OpenCode — cerrar "entrega de contexto"

- **Checks:** AG-01…AG-06 + OC-01.
- **La pregunta que decide:** `~/.config/opencode/opencode.json` recibe el campo `instructions` apuntando al contenido gestionado por AWM — pero **nadie observó que OpenCode lo lea**. AG-06 contra el binario real es lo único que lo cierra.
- **Cierra cuando:** una sesión de OpenCode nombra skills instaladas o cita el contexto del proyecto, y queda la respuesta textual.

### A2 · Cursor — cerrar "entrega de contexto"

- **Checks:** AG-01…AG-06 + CU-01.
- **Medido el 2026-08-09:** `awm add dev --agent cursor` instala **24** reglas en `.cursor/rules/*.mdc`, con frontmatter válido y el cuerpo completo (236 líneas). Lo que falta es lo otro: **que Cursor cargue un `.mdc` con `alwaysApply: false`** cuando corresponde.
- **Cierra cuando:** una sesión de Cursor demuestra tener el contenido de una skill que solo pudo venir del `.mdc`.

### A3 · Copilot — cerrar "entrega de contexto"

- **Checks:** AG-01…AG-06 + CP-01, CP-02.
- **Medido el 2026-08-09:** instala **29** archivos en `.github/instructions/*.instructions.md` con `applyTo: "**"` y cuerpo completo. Falta que **Copilot honre ese `applyTo`**.
- **Ojo:** Copilot no tiene scope global por diseño. `awm add -a copilot --scope global` **debe** fallar nombrando esa razón; un stack trace genérico ahí es un bug (CP-01).

### A4 · Antigravity — cerrar "lectura de workflows"

- **Checks:** AG-01…AG-06 + AN-01.
- **La pregunta:** es el único proveedor con `global_workflows`, y que Antigravity los **lea** nunca se observó.
- **AN-01 importa aparte:** `doctor` debe reportar tier `context-only` **sin** emitir filas de hook o injection en rojo — no tiene esos mecanismos, y un ✖ ahí sería falsa alarma con remedio imposible.

---

## B · Verificación por sistema operativo

CI corre la suite de unidad/integración en las tres plataformas. **Eso no es lo mismo que correr el playbook**: CI no instala ningún binario de agente ni ejercita el flujo de un usuario.

### B1 · macOS — playbook a mano

- **Correr:** `core-acceptance.md` completo + la sección macOS de [`os-matrix.md`](../testing/os-matrix.md) + `agent-matrix` para los agentes que tengas ahí.
- **Por qué vale igual con CI en verde:** la primera corrida de macOS *en CI* encontró un defecto de producto real (rutas de backup duplicadas por `/var` → `/private/var`). El playbook ejercita rutas que la suite no toca.

### B2 · Windows nativo — playbook a mano

- **Correr:** `core-acceptance.md` (versión PowerShell del setup) + la sección Windows de `os-matrix.md`.
- **Mirar con atención:** junctions vs symlinks, `PATHEXT`, separadores, y **la recuperación ante caída de `awm watch`**, que hoy está declarada ⚠ en Windows a propósito (ver `support-matrix.md`, capacidades por comando).

### B3 · WSL — sin verificar

- **Correr:** `core-acceptance.md` + la sección WSL de `os-matrix.md`.
- **El riesgo específico:** rutas cruzadas entre el sistema de archivos de Windows y el de Linux. Un symlink creado desde WSL hacia `/mnt/c` no se comporta igual que uno nativo.

---

## C · Deuda de producto identificada

No bloquea nada hoy, y está enunciada como trabajo, no como defecto oculto.

### ~~C1 · `awm context-budget` fija la línea base en cero~~ — ✅ cerrado 2026-08-09 (#56)

**Reproducido el 2026-08-09 con la v6.0.0.** El comando mide `AGENTS.md`, `CONSTITUTION.md` y `CLAUDE.md`. En un proyecto recién inicializado esos archivos **todavía no existen** — son pasos `pending` que escribe una sesión de agente. Entonces:

```
$ awm context-budget          # proyecto nuevo
✔  Context budget pinned at 0KB (~0k tokens per session).

$ # el agente escribe AGENTS.md, que es el flujo documentado
$ awm context-budget
⚠  Context budget exceeded: 3KB vs 0KB (over by 3KB).
```

El 0KB no es un error de medición: no hay nada que medir todavía. El problema es **fijar** sobre eso. El camino feliz garantiza una falsa alarma en la corrida siguiente, y una alarma que siempre suena se aprende a ignorar.

**Resuelto:** con cero archivos presentes el comando reporta `unmeasurable`, **no escribe config**, y explica que esos archivos los escribe una sesión de agente. La corrida siguiente fija bien. Sale `0` — no es un error, es "todavía no hay nada que medir".

### ~~C2 · `hooks.json` acumula una entrada por cada `AWM_HOME` usado~~ — ✅ cerrado 2026-08-09

Abierto desde D-010. `awm init` reconoce como propia solo la entrada que apunta al `AWM_HOME` actual; con otro, **agrega una segunda**. Una corrida de playbook aislada deja en el `hooks.json` real una entrada permanente hacia un directorio temporal ya borrado, y el agente intenta ejecutarla en cada sesión.

D-011 redujo el daño (las rutas del agente ahora se resuelven bien), pero la acumulación seguía.

**Resuelto:** `awm init` poda las entradas con **nuestra forma** cuyo script ya no existe, en Claude Code y en Codex. Tres condiciones, porque es el archivo de configuración del usuario y no se le borran líneas por parecido vago: el `matcher` es exactamente el nuestro, el ejecutable se llama como el script que AWM instala, y esa ruta **no existe**. Una instalación paralela viva no cumple la tercera, así que sobrevive intacta — y la entrada del `AWM_HOME` actual nunca se poda, aunque su script todavía no esté en disco.

### ~~C3 · Integridad de contenido en artefactos renderizados~~ — ✅ cerrado 2026-08-09

Para `.mdc` y `.instructions.md`, el diagnóstico comprobaba que el archivo **existía y tenía la extensión correcta** — no que su contenido estuviera intacto. Un archivo correcto por fuera y vacío o truncado por dentro pasaba como sano: el agente cargaba nada y `doctor` decía que sí.

**Resuelto:** cada renderer declara su **marcador de integridad** en la misma tabla que ya declaraba su extensión (`core/renderers/registry.ts`), y el check lo consume. Un `.mdc` sin `alwaysApply:` o un `.instructions.md` sin `applyTo:` se reporta `broken`, con el nombre del archivo y remedio propio (`reinstall-rendered-artifacts` — no es una usurpación ni un symlink colgante: es nuestro archivo incompleto).

**De paso, un cuarto duplicado menos:** `codex-agent-toml` era el único renderer con verificación de contenido, y su marcador estaba horneado dentro de `tomlAgentsHealthy`. Ahora los tres salen de la tabla, así que un renderer nuevo no puede agregarse sin declarar el suyo. El guard estructural del registry detectó —durante este mismo cambio— que yo había escrito `'.toml'` a mano en el sitio nuevo.

### ~~C4 · Los artefactos **renderizados** quedan viejos~~ — ✅ cerrado 2026-08-09

**El enunciado original estaba mal, y medirlo lo corrigió.** No es "scope de proyecto": es **formato de instalación**.

| Instalación | ¿Se actualiza sola con `awm update`? |
|---|---|
| **Symlink** (`claude-code`, `codex`, `opencode`, `antigravity`) | **Sí.** Apunta al registry: el cambio se ve al instante, en todos los proyectos a la vez. |
| **Renderizada** (`.mdc`, `.instructions.md`, `.toml`) | **No.** Son archivos generados: se quedan con el contenido de la versión anterior. |

Así que solo Cursor, Copilot y los perfiles de agente de Codex quedan viejos — y nada lo decía.

**Cerrado: la detección.** `awm doctor` re-renderiza cada artefacto desde la fuente que el ledger declara y compara. Si difiere, reporta `stale`, nombra el archivo y degrada `overall`. Es una comparación **exacta**, no una heurística de timestamps: un registry re-clonado no produce falsos positivos.

**Medido — y la primera medición estuvo mal, así que vale decir cómo.** La tabla inicial
afirmaba que ningún comando refrescaba salvo `awm add`. Dos errores míos: `awm update --yes`
no existe (el comando erroró y nunca corrió), y editar el `SKILL.md` del registry a mano no
sirve como fuente de verdad porque `awm update` hace `git pull` y descarta esa edición. Al
medirlo bien, corrompiendo el **destino** en vez de la fuente:

| Artefacto | Comando que lo refresca |
|---|---|
| Global (baseline, máquina) | **`awm update`** ✅ |
| Proyecto, declarado en `profile.json` | **`awm sync`** ✅ |
| Proyecto, bundle **baseline** con `--scope local` | **ninguno** ❌ |

**Ese tercer caso era el hueco real**, y no era raro: `awm add dev --scope local` es
exactamente lo que el playbook AG-03 pide correr para verificar cualquier proveedor.
`shouldRecordExtension` exigía que el bundle fuese de scope `project`, así que un baseline
instalado localmente no entraba al profile — y `awm sync` reconcilia lo que el profile
declara. Esos artefactos no los tocaba nadie.

**Resuelto:** el criterio pasa a ser el **alcance efectivo**, no el del bundle. Si alguien
pidió artefactos de proyecto, el profile lo dice — que es además lo que hace que un
compañero que clona el repo y corre `awm sync` obtenga lo mismo.

El remedio que `doctor` ofrece depende del alcance: `awm update` para lo global, `awm sync`
para lo de proyecto. La primera versión de este chequeo ofrecía `reinstall-bundle`, basada
en la medición equivocada — el mismo defecto de "remedio que corre limpio sin cambiar nada"
que D-010 cerró, repetido y corregido.

**Verificado contra el binario:** artefacto de proyecto viejo → `awm sync` lo arregla;
artefacto global viejo → `awm update` lo arregla; `profile.json` registra el install local.

### ~~C7 · El aviso de versión nueva contamina `--json`~~ — ✅ cerrado 2026-08-09

`⬆ awm vX available` se imprimía por **stdout** al final de cualquier comando, así que se
mezclaba con la salida de `--json` y rompía a cualquiera que parsee: `awm doctor --json | jq`
fallaba con un `SyntaxError` que no menciona la causa. Encontrado tropezando con él mientras
se verificaba C4.

**Resuelto:** va por `stderr`. stdout es la interfaz de máquina; los avisos al humano no van ahí.

### C5 · Packs `python` y `shell` contra proyectos reales

Existen y están completos. Nadie los corrió contra un repo Python o de shell de verdad.

### C6 · CI con binarios de agente reales

Es la razón de fondo de que A1–A4 sean trabajo manual. Si CI pudiera instalar Cursor/Copilot/OpenCode/Antigravity, esas verificaciones dejarían de depender de que alguien se acuerde. Es el ítem más caro y el que más rinde a largo plazo.

---

## Cómo registrar un resultado

Las reglas están en [`docs/testing/README.md`](../testing/README.md) y no son formalidad:

- **PASS** — lo observado coincide con lo esperado.
- **FAIL** — no coincide. **Se pega la salida real.** Es el resultado más valioso.
- **BLOCKED** — no se pudo correr. **Nunca se registra como PASS.**

Y las dos que invalidan una corrida entera: no arreglar el entorno para que un check pase y después declararlo PASS, y no editar a mano nada bajo `$AWM_HOME`.

Un nivel de la matriz sube **citando la evidencia**, no la intención. Si algo se verifica y no funciona, va a ❌ — perder evidencia negativa es peor que no haberla tenido.

---

## D · Iniciativa de optimización del ciclo SDD (issue #20) — plan de cierre

Los dos dolores medidos en el diagnóstico original pesan hoy, y atacan cosas distintas:

| Dolor | Qué lo ataca | Estado |
|---|---|---|
| **Tiempo de ciclo** (~115 min post-plan, tracks independientes en serie) | **R5** — paralelismo por worktree | construido 95/117, sin verificar |
| **Costo en tokens** (1.57M, revisión:implementación 4.2:1) | **R2/R3** — detectar clases de defecto sin sensor, para que las agarre un linter y no un revisor | sin empezar |

**El orden es R5 → R2 → R3, y no por antigüedad.**

R5 primero porque está a tres tareas del final y **cada día que espera cuesta más**: seis
días parado produjeron 136 commits de divergencia. No es apego a lo hecho — es que 4223
líneas ya revisadas son el valor más barato disponible, y su costo de integración crece solo.

R2 antes que R3 porque R3 lee del mismo vocabulario de cobertura que R2 define; construir R3
primero significaría inventarlo dos veces.

### D1 · Cerrar R5 — Tasks 15, 16, 17

- [ ] **Task 15 — E2E local de aceptación (CA-4.1–4.3).** Workload determinista con modo
      serial y paralelo; CA-4.1 sobre *tree hash*, no historial (dos órdenes de merge
      distintos producen el mismo árbol: comparar historial daría un falso rojo); CA-4.2 con
      seam de `worktreeAdder`; CA-4.3 con un solo lockfile, que es el caso que C5 declara
      invalidante. Se corre acá.
- [ ] **Task 16 — E2E contra binarios reales.** El validador **se escribe antes** de
      recolectar evidencia, para que la matriz salga solo de lo observado. Claude Code se
      corre acá; Codex va al VPC. Precondición ya cumplida: los dos proveedores quedaron
      verificados el 2026-08-09.
- [ ] **Task 17 — Regresión, documentación operativa y handoff.** Incluye el flujo diario y
      el fallback (hoy `awm track` no tiene una línea de doc), auto-verificación del CLI
      compilado, y `post-implementation-qa` + `harness-retro`.

**Hasta que 15–17 estén, el PR #63 no se mergea.** Publicar `awm track` sin documentación
operativa ni criterios de aceptación ejecutados sería aplicarle a 4223 líneas un estándar
más bajo que el que este repo le aplica a un cambio de tres.

**Riesgo activo mientras espera:** la divergencia. #63 se rebasa cada vez que `main` se
mueve, en vez de dejarlo envejecer otros seis días.

### D2 · R2 — cobertura de sensores declarada vs configurada

Desbloqueado por [D-013](../decisions.md#d-013) (el set de referencia vive en el `pack.json`
del registry) y [D-014](../decisions.md#d-014) (reporta, nunca instala).

Compara lo que el pack declara esperado contra lo que el proyecto tiene configurado, y
nombra lo que falta **con el comando para agregarlo**. Un pack sin set de referencia se
reporta como tal; no se inventa un default — misma razón por la que se eliminaron los
`FALLBACK_DEFAULTS`.

### D3 · R3 — detección empírica desde el ledger

Desbloqueado por [D-015](../decisions.md#d-015) (umbral ≥2, señal y no compuerta).
Depende de R2: usa su vocabulario de cobertura para responder "este cluster converge y
**ningún sensor lo cubre**".

Ordena y destaca; no filtra en silencio. Un umbral que descarta sin decirlo convierte al
ledger en el lugar donde la evidencia se pierde.
