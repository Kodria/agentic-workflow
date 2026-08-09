# Matriz de soporte

**Qué soporta AWM, con qué nivel de evidencia, y qué no soporta todavía.**

Este documento existe para que nadie tenga que inferir. Si una combinación no está acá, no está soportada. Si está marcada `⚠ sin verificar`, no se puede presentar como funcionando — se puede presentar como *implementado y pendiente de verificación*, que es una afirmación distinta y honesta.

---

## Los cuatro niveles

Un solo vocabulario, usado igual en todas las tablas de abajo. La distinción entre los dos primeros es la que más se malinterpreta y la que más importa:

| Nivel | Qué significa exactamente | Qué se puede afirmar en público |
|---|---|---|
| **✅ Verificado** | Implementado **y** ejercitado por una comprobación automática que corre en CI, o por un playbook ejecutado con resultado registrado. | "Funciona." |
| **⚠ Sin verificar** | Implementado según la documentación del proveedor, pero **ninguna máquina lo ejecutó nunca** contra el binario real. | "Está implementado; falta verificarlo." Nunca "funciona". |
| **⛔ No soportado** | Decisión deliberada, con una razón. No es un bug ni una tarea pendiente. | "No lo soportamos, y esta es la razón." |
| **🔜 Planeado** | Reconocido como faltante. Es trabajo por hacer, con lo que falta enunciado. | "Todavía no." |

> **Regla dura:** `BLOCKED` en un playbook (no pude correrlo) **nunca** se registra como verificado. Una combinación sin verificar es sin verificar; decir otra cosa es cómo una matriz de soporte empieza a mentir.

---

## Capacidades por proveedor

Esta sección se **genera desde `cli/src/providers/index.ts`**. No se edita a mano.

Existe generada porque la versión escrita a mano ya mintió: afirmaba que Antigravity instalaba en `~/.agents/skills` y `.agents/skills`, cuando el código dice `~/.gemini/antigravity/skills` y `.agent/skills` (singular), y omitía que es el único proveedor con `global_workflows`. Una tabla citada en una presentación y desalineada del código es peor que no tenerla.

<!-- BEGIN GENERATED: provider-capabilities -->

### Dónde aterriza cada artefacto

| Agente | Tier | Skills (global) | Skills (proyecto) | Formato |
|---|---|---|---|---|
| `antigravity` | context-only | `~/.gemini/antigravity/skills` | `.agent/skills` | `link` |
| `opencode` | config-managed | `~/.agents/skills` | `.agents/skills` | `link` |
| `claude-code` | hooks-native | `~/.claude/skills` | `.claude/skills` | `link` |
| `codex` | hooks-native | `~/.agents/skills` | `.agents/skills` | `link` |
| `cursor` | agents-md-managed | `~/.cursor/rules` | `.cursor/rules` | `cursor-mdc` |
| `copilot` | agents-md-managed | **no soportado** | `.github/instructions` | `copilot-instructions` |

### Perfiles de agente, workflows, hooks y contexto

| Agente | Perfiles de agente | Workflows | Hooks | Entrega de contexto | Versión mínima |
|---|---|---|---|---|---|
| `antigravity` | — (no aplica) | `~/.gemini/antigravity/global_workflows` | — (no tiene) | — (ninguna) | — (sin gate) |
| `opencode` | `~/.config/opencode/agents` · `link` | — (no aplica) | — (no tiene) | `~/.config/opencode/opencode.json` → campo `instructions` | — (sin gate) |
| `claude-code` | `~/.claude/agents` · `link` | — (no aplica) | `cc-settings-merge` | hook `SessionStart` | — (sin gate) |
| `codex` | `~/.codex/agents` · `codex-agent-toml` | — (no aplica) | `codex-hooks-json` | `AGENTS.md` + `~/.codex/AGENTS.md` | 0.145.0 |
| `cursor` | — (no aplica) | — (no aplica) | — (no tiene) | `AGENTS.md` del proyecto (sin equivalente global) | — (sin gate) |
| `copilot` | — (no aplica) | — (no aplica) | — (no tiene) | `AGENTS.md` del proyecto (sin equivalente global) | — (sin gate) |

> Generado desde `cli/src/providers/index.ts`. **No editar a mano** — `npm run docs:matrix` lo regenera y
> `tests/structural/support-matrix-is-current.test.ts` falla si el documento y el código se separan.

<!-- END GENERATED: provider-capabilities -->

### Qué significa cada tier

| Tier | Cargan las skills | Disparan los hooks | Las fases del proceso se **imponen** |
|---|---|---|---|
| `hooks-native` | sí | sí | sí — el harness re-ancla el contexto en cada sesión |
| `config-managed` | sí | no | no — el contexto se entrega, la disciplina se lee |
| `agents-md-managed` | sí (renderizadas) | no | no — ídem |
| `context-only` | sí | no | no — sin mecanismo de entrega automática |

La parte determinística —`awm sensors run`, su código de salida y el gate de calidad— es **idéntica en los seis**. Es un comando real con un exit code real: no depende de que el agente coopere. Lo que varía por tier es cuánto se re-ancla el *contexto*, no cuánto se verifica el *código*.

---

## Estado de soporte por proveedor

| Proveedor | Instalación de artefactos | Entrega de contexto | Hooks | Evidencia |
|---|---|---|---|---|
| **Claude Code** | ✅ Verificado | ✅ Verificado | ✅ Verificado | Suite + E2E aislado en CI (ubuntu, windows, macos) + playbook [`agent-matrix`](testing/agent-matrix.md) corrido contra el binario real (AG-01…AG-06, CC-01, CC-02), incluido **AG-06 con control negativo**: un `HOME` sin AWM responde que no tiene ninguna skill de AWM, así que lo que la sesión nombró vino de la instalación observada y no de su ambiente. |
| **Codex** | ✅ Verificado | ✅ Verificado | ⚠ Sin verificar | Suite + `tests/integration/codex-provider-isolated` + playbook [`agent-matrix`](testing/agent-matrix.md) contra `codex-cli 0.146.0` real (Ubuntu, 2026-08-09): instalación y `.toml` parseado con `tomllib`, AG-06 nombró skills instaladas. **Los hooks siguen ⚠**: `doctor` reportó `hook.trust: pending-trust` — el hook está instalado y **la transición de confianza nunca ocurrió**, así que nunca se lo observó disparar. AG-06 no lo cierra: Codex también recibe contexto por el bloque gestionado en `AGENTS.md` (`context.global: delivered`), que es otro camino. |
| **OpenCode** | ✅ Verificado | ⚠ Sin verificar | ⛔ No tiene | El escritor de `opencode.json` está cubierto por tests; que OpenCode *lea* ese campo no fue observado. |
| **Cursor** | ✅ Verificado | ⚠ Sin verificar | ⛔ No tiene | El `.mdc` se genera y se valida su forma. Que Cursor **cargue** un `.mdc` con `alwaysApply: false` no fue observado. |
| **Copilot** | ✅ Verificado (solo proyecto) | ⚠ Sin verificar | ⛔ No tiene | El `.instructions.md` se genera. Que Copilot **honre** `applyTo: "**"` no fue observado. |
| **Antigravity** | ✅ Verificado | ⛔ No tiene mecanismo | ⛔ No tiene | Que Antigravity **lea** `global_workflows/` no fue observado. |

### Las decisiones ⛔, con su razón

Ninguna de estas es una tarea pendiente. Son límites del proveedor, no del producto:

- **Copilot no tiene scope global.** GitHub Copilot no expone ningún mecanismo de descubrimiento de skills a nivel usuario. Las skills van por proyecto. `awm add -a copilot --scope global` **debe fallar nombrando esa razón**; un stack trace genérico ahí es un bug.
- **Cursor no tiene archivo de contexto global.** Sus "User Rules" viven dentro de la configuración de la app, no en un archivo en disco. AWM **no inventa una ruta**: declara `null` y lo reporta como N/A, no como error.
- **Antigravity no tiene mecanismo de entrega de contexto.** Ni hooks ni archivo de instrucciones. Recibe artefactos; la disciplina de proceso se lee, no se impone.
- **OpenCode, Cursor, Copilot y Antigravity no tienen hooks.** No existe el mecanismo en esos productos. `awm doctor` **no emite fila de hook** para ellos — un ✖ ahí sería una falsa alarma con un remedio imposible.

---

## Estado de soporte por sistema operativo

| Sistema | Nivel | Evidencia |
|---|---|---|
| **Linux** | ✅ Verificado | Matriz de CI en cada PR (`ubuntu-latest`), suite completa |
| **Windows** | ✅ Verificado | Matriz de CI en cada PR (`windows-latest`), suite completa. Cubre junctions, PATHEXT y separadores. |
| **macOS** | ✅ Verificado | Matriz de CI en cada PR (`macos-latest`), suite completa. Su primera corrida encontró un defecto real de producto (ver abajo), que es la diferencia entre "debería funcionar" y evidencia. |
| **WSL** | ⚠ Sin verificar | Se comporta como Linux por diseño; sin ejecución registrada. Ver la advertencia de rutas cruzadas en [os-matrix](testing/os-matrix.md). |

**Node.js:** 22 o superior (declarado en `engines`). Versiones menores no están soportadas.

### Capacidades por comando, donde el soporte NO es uniforme

Casi todo el CLI se comporta igual en los cuatro sistemas. Estas son las excepciones, enunciadas para que nadie las descubra en una demo:

| Capacidad | Linux / macOS / WSL | Windows nativo |
|---|---|---|
| `init` · `update` · `sync` · `add` · `remove` · `sensors` · `preflight` · `doctor` · `export` · `backup` · hooks | ✅ Verificado | ✅ Verificado (matriz de CI) |
| Instalación por **symlink** (updates se propagan solos) | ✅ Verificado | ✅ Verificado vía *junction* para directorios. Para archivos requiere Modo Desarrollador; si no, cae a **copia** — funciona, pero `awm update` deja de propagar y hay que reinstalar. |
| `awm watch` — supervisión y gate | ✅ Verificado | ✅ Verificado |
| `awm watch` — **el wrapper sobrevive a la muerte del supervisor** | ✅ Verificado | ⚠ **Sin verificar.** En POSIX la garantía se sostiene con `detached: true` (sesión nueva, sobrevive un SIGKILL al padre). En win32, dos rondas reales de CI no encontraron una configuración de spawn que sostenga la misma garantía, así que el E2E de crash-recovery tiene alcance POSIX. Ver `cli/src/core/journal/process.ts`. |

Esa última fila es la única capacidad del producto con un nivel distinto según el sistema operativo. No es una regresión pendiente: es un límite conocido, con el intento registrado.

### Lo que encontró agregar macOS

Vale registrarlo porque justifica la distinción entre los dos primeros niveles. macOS estaba en `⚠` únicamente porque nadie lo había agregado a la matriz — "nada es específico de macOS en el código" era el argumento. Su primera corrida encontró un defecto de producto:

En macOS `/var/folders/…` es un symlink a `/private/var/folders/…`. `planInitMutationTargets` derivaba unos destinos de `cwd` tal cual y otros de `findProjectRoot(cwd)`, que canonicaliza — así que enumeraba **el mismo archivo dos veces**, una por forma. Esa lista es la que el backup respalda y la que el rollback restaura: un archivo con dos entradas se respalda dos veces y se restaura dos veces, en el mecanismo cuyo único trabajo es dejar el disco como estaba. En Linux y Windows las dos formas coinciden y el `Set` lo tapaba.

El bug no era de macOS: cualquier `cwd` alcanzado a través de un symlink lo reproduce. macOS solo fue el primero en pisarlo. Está cubierto por un test que arma esa situación a mano y falla en cualquier sistema.

### Advertencia de Windows que sí es real

Crear un symlink de directorio en Windows requiere `SeCreateSymbolicLinkPrivilege`, denegado por defecto en cuentas sin privilegios. AWM usa **junctions** para directorios (no requieren privilegio) y cae a **copia** para archivos cuando el symlink falla. La consecuencia práctica: en el modo copia, `awm update` **no propaga** cambios del registry automáticamente — hay que volver a instalar. Está soportado y funciona; simplemente no es el mismo mecanismo.

---

## Registries de contenido

| Registry | Nivel | Rol |
|---|---|---|
| `awm-baseline-registry` | ✅ Verificado | Sembrado por defecto en `awm init` |
| `awm-documentation-registry` | ⚠ Sin verificar | Opt-in vía `awm registry add` |
| Registries propios de un equipo | ✅ Verificado | Cualquier repo git con el layout de contenido. Ver [runbook](runbook.md). |
| Hosts de git | ✅ Verificado | Agnóstico al host (GitHub, GitLab, self-hosted): se resuelve por URL de git, sin API del proveedor. |

## Packs de sensores

| Pack | Nivel | Herramientas |
|---|---|---|
| `js-ts` | ✅ Verificado | tsc, eslint, semgrep, tests |
| `python` | ⚠ Sin verificar | mypy, ruff |
| `shell` | ⚠ Sin verificar | shellcheck |
| `generic` | ✅ Verificado | semgrep |

Un pack ausente del registry instalado **no se inventa**: `awm sensors init` cae a un pack que sí exista, nombra el que falta, y `awm preflight` falla mientras el gate esté vacío.

---

## 🔜 Lo que falta desarrollar

Enunciado como trabajo, no como defecto. Esto es lo que hay que construir para subir de nivel algo que hoy está en ⚠ o para ampliar el alcance:

| # | Falta | Por qué importa | Qué destraba |
|---|---|---|---|
| 1 | **CI con binarios de agente reales** | Es la única razón por la que Cursor, Copilot, OpenCode y Antigravity siguen en ⚠. Ninguna cantidad de tests unitarios la sustituye. | Sube 4 proveedores de ⚠ a ✅ |
| 2 | **Verificación de integridad de contenido en artefactos renderizados** | Para `.mdc` / `.instructions.md` el diagnóstico comprueba que el archivo *existe y tiene la extensión correcta*, no que su contenido esté intacto. Un archivo correcto por fuera y corrupto por dentro pasa. | Cierra un hueco conocido en `skills.global` |
| 3 | **Reconciliación de scope de proyecto en `awm update`** | `update` reconcilia artefactos de máquina; los de proyecto son trabajo de `awm sync`. Un proyecto sin `sync` queda desactualizado en silencio. | Elimina un paso manual |
| 4 | **Pruebas de los packs `python` y `shell` contra proyectos reales** | Existen y están completos; nadie los corrió contra un repo Python o de shell de verdad. | Sube 2 packs a ✅ |
| 5 | **Un séptimo proveedor** | El modelo de capacidades ya lo soporta como una edición localizada (tabla de renderers + entrada de provider). No hay ninguno pedido todavía. | Amplía la cobertura |
| 6 | **Observar el hook de Codex disparando, con la confianza otorgada** | Es lo único que separa a Codex de ✅ en hooks. La corrida real del playbook dejó `hook.trust: pending-trust`: instalado, nunca disparado. Pide una corrida donde una persona acepte la confianza en la UI de Codex y **después** observe el re-anclaje de sesión. | Sube Codex a ✅ en hooks |

---

## Cómo verificar todo esto vos mismo

Nada de esta matriz pide que confíes en ella. Cada afirmación tiene una forma de comprobarse:

| Afirmación | Cómo la comprobás |
|---|---|
| Las capacidades por proveedor | `npm run docs:matrix` — si el documento cambia, el documento estaba mal |
| Que la tabla no puede quedar desalineada | `npx jest tests/structural/support-matrix-is-current` |
| Linux y Windows | La matriz de CI de cualquier PR |
| Todo lo demás | Los playbooks: [core-acceptance](testing/core-acceptance.md), [os-matrix](testing/os-matrix.md), [agent-matrix](testing/agent-matrix.md) |

Los playbooks están escritos para que los corras vos **o para que se los pases a un agente y los corra él**. Piden `--json` y aserciones sobre campos parseados y códigos de salida, no sobre texto legible.
