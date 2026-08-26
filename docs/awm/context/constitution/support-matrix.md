<!-- awm-context:CTX-CONSTITUTION-024 -->
## Matriz de soporte

<!-- awm-context:CTX-CONSTITUTION-025 -->
Esta matriz es una **declaración de contrato**: qué combinaciones de stack/agente/host/OS están soportadas HOY, no una lista de aspiraciones.

<!-- awm-context:CTX-CONSTITUTION-026 -->
> **División de trabajo con [`docs/support-matrix.md`](docs/support-matrix.md):** acá viven las
> *reglas* — qué tier tiene cada agente y **por qué**, qué decisión hay detrás de cada
> límite. Allá vive el *estado*: las rutas de instalación (generadas desde
> `providers/index.ts` y bloqueadas por un test) y el nivel de evidencia de cada
> combinación (`verificado` / `sin verificar` / `no soportado` / `planeado`). Las rutas no
> se escriben a mano en ninguno de los dos documentos: esa duplicación ya produjo una
> tabla que afirmaba durante varias releases que Antigravity instalaba donde no instala. Cada fila está verificada contra el código fuente citado — no contra la prosa de ningún plan (los planes documentan intención; el código es la verdad, ver "Auto-verificación del CLI" en AGENTS.md). Al agregar una fila nueva, verificarla del mismo modo antes de escribirla.

<!-- awm-context:CTX-CONSTITUTION-027 -->
**Stacks** (`cli/src/commands/sensors/init.ts`, `detectStack()` / `STACK_DETECTORS`): `js-ts` (indicador `package.json`), `python` (`pyproject.toml` | `setup.py` | `setup.cfg` | `requirements.txt` | `Pipfile`), `shell` (fallback: glob `*.sh` en la raíz o en `scripts/`, solo si no hay marcador js-ts/python más fuerte), `generic` (fallback puro, cuando nada matchea). Orden de especificidad: `js-ts > python > shell > generic`. `awm sensors init --pack <name>` es el override explícito del operador para cualquier caso que la heurística no cubra — la detección es conveniencia, la declaración es contrato. Sin registry alcanzable, o sin `pack.json` para el stack detectado, el manifest generado es honesto y vacío (`FALLBACK_DEFAULTS` fue eliminado del CLI en R3) — el CLI nunca vuelve a inventar defaults propios.

<!-- awm-context:CTX-CONSTITUTION-028 -->
**Agentes** (`cli/src/providers/index.ts`, `AGENT_TARGETS`; tier estructural vía `providerTier()` en `cli/src/core/diagnostics/provider-checks.ts`):

<!-- awm-context:CTX-CONSTITUTION-029 -->
| Agente | Tier | Por qué |
|---|---|---|
| `claude-code` | hooks-native | tiene `hooks` |
| `codex` | hooks-native | tiene `hooks`; versión mínima `0.145.0` |
| `opencode` | config-managed | `injection.type === 'config-instructions'` |
| `cursor` | agents-md-managed | `injection.type === 'managed-agents-md'`; `globalPath: null` — sin archivo global de contexto confirmado |
| `copilot` | agents-md-managed | ídem; además sin directorio de skills global (`globalUnsupportedReason`) |
| `antigravity` | context-only | sin `hooks` ni `injection` |

<!-- awm-context:CTX-CONSTITUTION-030 -->
El tier es una clasificación estructural, no una promesa de paridad: un provider `agents-md-managed`/`context-only` degrada el spine de AWM (invocación disciplinada de skills, gates de fase) a contexto leído por el propio agente — es una limitación del agente objetivo, no un defecto de AWM. `awm doctor` reporta el tier de cada provider instalado para que nadie espere de un agente una capacidad que su arquitectura no puede dar.

<!-- awm-context:CTX-CONSTITUTION-031 -->
**Hosts de git** (`cli/src/commands/preflight/checks.ts`, `checkHost()`/`extractHost()`): host contiene `github.com` → advierte si `gh` no está en PATH; host contiene `gitlab` → advierte si `glab` no está en PATH; cualquier otro host (Bitbucket, Azure DevOps, servidor git interno) → "git host not recognized — PR/MR automation not applicable". El check es **advisory únicamente** — `ok` es siempre `true`; nunca cambia el `status` de `preflight`. El CLI nunca invoca `gh`/`glab` directamente — ese dispatch vive en las skills `finishing-a-development-branch`/`receiving-code-review` (contenido del registry, no de este repo, ver "`~/.awm` es territorio del instalador" arriba); este repo solo detecta y advierte.

<!-- awm-context:CTX-CONSTITUTION-032 -->
**OS** (`cli/src/core/paths.ts`, `isWindowsNative()`; `.github/workflows/ci.yml`): Linux, macOS y Windows nativo (`process.platform === 'win32'` — WSL reporta `linux` y no cuenta como nativo) son soportados y verificados de forma continua: la matriz `ubuntu-latest` + `windows-latest`, Node 22, suite completa (`tsc --noEmit` + `jest --runInBand`), corre en cada PR y en cada push a `main` desde R6. Windows dejó de ser "hotfixeado y con suerte" para ser continuamente verde — cualquier regresión de portabilidad la atrapa la matriz antes del merge, no un usuario en producción (el origen de esta doctrina: H1/R1, un bug de portabilidad publicado en v3.9.0 que bloqueaba `preflight` SIEMPRE en Windows, nunca atrapado porque no existía CI de plataforma).

<!-- awm-context:CTX-CONSTITUTION-033 -->
Excepción honesta y acotada — no un hedge genérico de "algunas cosas pueden no andar": 4 tests E2E del ciclo de vida completo del controlador externo de `awm watch` (spawn → captura de identidad → adopción, bajo un crash real del supervisor) — 2 en `cli/tests/commands/watch/supervisor-loop.test.ts` y 2 en `cli/tests/commands/watch/e2e-crash.test.ts` — no convergieron en `windows-latest` real pese a 4 rondas de fixes basados en evidencia (R6: WMI-based `refIsAlive` removido, `activitySnapshot` degradado fuera de `ps`/`pgrep`, el flag `detached` de `spawnStructured` probado en ambos sentidos). Quedan `itPosix`-scoped, documentados en el comentario extenso sobre `refIsAlive` en `cli/src/core/journal/process.ts`. El gap es específicamente el crash-recovery del supervisor de `awm watch` — el resto del CLI (`init`/`update`/`sync`/`sensors`/`preflight`/`doctor`/hooks) corre verde en Windows bajo la misma matriz y no está afectado.

<!-- awm-context:CTX-CONSTITUTION-034 -->
Fuera de esta matriz — no soportado, por decisión explícita del owner, no por omisión (ver `docs/plans/2026-08-07-team-rollout-hardening-design.md`, "Alcance"): otros lenguajes (Go, Java, .NET, Ruby, ...), otros hosts de git (Bitbucket, Azure DevOps), y apertura del repo a contribuidores externos.
