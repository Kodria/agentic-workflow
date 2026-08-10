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

### C3 · Integridad de contenido en artefactos renderizados

Para `.mdc` y `.instructions.md`, el diagnóstico comprueba que el archivo **existe y tiene la extensión correcta** — no que su contenido esté intacto. Un archivo correcto por fuera y corrupto por dentro pasa como sano. Hueco conocido y declarado en `support-matrix.md`.

### C4 · `awm update` no reconcilia el scope de proyecto

`update` reconcilia artefactos de máquina; los de proyecto son trabajo de `awm sync`. Un proyecto en el que nadie corre `sync` queda desactualizado en silencio.

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
