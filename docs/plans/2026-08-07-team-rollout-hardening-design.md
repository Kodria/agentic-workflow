# Team Rollout Hardening — Design

**Fecha:** 2026-08-07
**Estado:** aprobación pendiente
**Repos involucrados:** `agentic-workflow` (CLI) + `awm-baseline-registry` (contenido)
**Rama de trabajo (ambos repos):** `claude/retomar-ramas-trabajo-2f9ws9`

## Contexto y problema

AWM pasa de sistema personal (un operador que sabe qué configuró) a framework de
**consumo** multi-equipo. El modelo de gobierno NO cambia: un solo owner/maintainer
publica CLI y registry. Lo que se multiplica son los entornos que ejecutan: Windows,
GitLab, Cursor/Copilot, repos legacy sin tests, stacks variados.

La evaluación de esta sesión (contra código, no impresiones) encontró que el flujo
**no cierra** para varios de esos entornos. Este diseño ordena el cierre.

## Hallazgos que motivan cada release

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| H1 | `computeSensorStatus` usa `which` (POSIX). En Windows todo sensor por PATH da "not found" → preflight `DEGRADED` → gate de `writing-plans` bloquea SIEMPRE | `cli/src/commands/sensors/status.ts:50`. **Ya publicado en v3.9.0** — es hotfix, no prevención | P0 |
| H2 | `finishing-a-development-branch` hardcodea `gh pr create`. Cero menciones a GitLab/MR en los 37 skills. En modo desatendido la Opción 2 es el camino automático → equipo GitLab se levanta sin PR con todo el trabajo hecho | `skills/finishing-a-development-branch/SKILL.md` Opción 2 | P0 |
| H3 | Python vive en `FALLBACK_DEFAULTS` del CLI (viola "registry = fuente única de contenido") y no se le copian config files. Shell no existe. Todo stack no detectado cae a `generic` = solo semgrep → gate hueco o trabado | `cli/src/commands/sensors/init.ts:44-51`; `sensor-packs/` solo tiene `generic` y `js-ts` | P0 |
| H4 | Providers soportados: `antigravity`, `opencode`, `claude-code`, `codex`. Los equipos usan **Cursor y Copilot** → AWM ni se instala para ellos | `cli/src/providers/index.ts:5` | P0 |
| H5 | Repos legacy: `awm sensors baseline` (el trinquete correcto) existe pero nada en el flujo lo hace descubrir. Un repo con años de deuda golpea un gate rojo sin guía | flujo completo; preflight no lo menciona | P1 |
| H6 | El CLI publica a npm en cada merge sin correr sus 1272 tests; no existe workflow de PR | `.github/workflows/` = solo `release.yml`, que hace `npm ci && npm run build` | P1 |
| H7 | CONSTITUTION/AGENTS de AWM codifican preferencias personales, no política de producto | lectura de ambos docs | P2 |

## Alcance

### Stacks soportados (decisión del owner, 2026-08-07)

Node.js, TypeScript, NestJS, Next.js, React, AWS Lambdas (Node), **Python** y Shell.
No se requieren otros lenguajes por ahora.

> **Supuesto a confirmar:** el owner dictó "photon"; se interpreta **Python** (ya
> existe medio-soportado vía fallback y encaja con Lambdas). Si era otra cosa,
> ajustar R3 antes de ejecutarla.

NestJS/Next.js/React/Lambdas-Node son todos `package.json` → los cubre el pack
`js-ts` existente. No se crean packs por framework: la frontera genérico/específico
de CLAUDE.md manda — las reglas por framework las crece `harness-retro` en cada
proyecto.

### Agentes soportados

Hoy: Claude Code, Codex (+ OpenCode, Antigravity). Se agregan: **Cursor** y
**GitHub Copilot**.

### Hosts de git

GitHub (owner) y **GitLab** (equipos). Bitbucket fuera de alcance.

### Fuera de alcance (explícito)

- **Contabilización de tokens**: deseable de reportes de eficiencia, pospuesto por
  decisión del owner — la propiedad absoluta es que el framework cumpla su propósito.
- Apertura del repo a contribuidores externos. El gobierno sigue siendo unipersonal.
- Otros lenguajes (Go, Java, .NET, Ruby...) y otros hosts de git.
- Piso de política organizacional de sensores (mínimos obligatorios) — se documenta
  como decisión pendiente en CONSTITUTION, no se implementa.

## Decisiones de diseño

### D1 — Resolución de binarios portable (H1)

Reemplazar `which` por resolución multiplataforma en `status.ts`: en `win32` usar
`where`, en el resto `command -v` vía shell (más POSIX que `which`, que no está
garantizado). Auditar el resto del camino de preflight/status por POSIX-ismos.
Tests con `process.platform` mockeado — patrón ya usado por `exec.ts` (`taskkill`).

### D2 — Host de git detectado, con degradación honesta (H2)

**No** se construye una abstracción de host en el CLI (YAGNI — dos hosts, un caso
de uso: crear PR/MR al cerrar rama). La detección es mecánica en el skill:

1. `git remote get-url origin` → contiene `github.com` → `gh pr create`;
   contiene `gitlab` (incluye self-hosted con `gitlab` en el dominio) → `glab mr create`.
2. CLI del host ausente o dominio no reconocido → **degradación honesta**: push +
   imprimir la URL de compare/new-MR + reportar exactamente qué faltó. En modo
   desatendido esto es un final VÁLIDO: trabajo pusheado, instrucción clara, jamás
   un fallo mudo en el último paso.
3. La detección corre ANTES de empezar el cierre, no después del push — si no hay
   CLI del host, el operador se entera cuando todavía está presente (mismo principio
   que el preflight gate: los descubrimientos van donde hay alguien mirando).

`awm preflight` gana un check `host` **advisory** (nunca bloquea): informa qué CLI
de host se detectó/faltó. Bloquear por esto castigaría flujos que no crean PR.

### D3 — Todo stack soportado es un pack en el registry (H3)

- **`python` pack** en el registry (mypy/ruff/semgrep, config files incluidos) y
  **eliminación de `FALLBACK_DEFAULTS`** del CLI. El CLI no vuelve a ser fuente de
  contenido. Sin registry alcanzable + stack sin pack → `inconclusive`, no un
  default inventado.
- **`shell` pack**: shellcheck (lint) + semgrep. Detección: presencia de `*.sh` en
  raíz/`scripts/` **solo si** no hay marcador de stack más fuerte (package.json,
  pyproject) — shell suele ser secundario.
- **`awm sensors init --pack <name>`**: override explícito del operador para
  cualquier caso que la heurística no cubra. La detección es conveniencia; la
  declaración es contrato.
- `detectStack` ordena por especificidad: js-ts > python > shell > generic.

### D4 — Cursor y Copilot como providers (H4)

La arquitectura existente (`ProviderConfig` + estrategias de inyección) alcanza.
Ambos agentes **leen `AGENTS.md` nativamente** → reutilizan la estrategia
`managed-agents-md` que hoy usa Codex. No se inventa mecanismo nuevo.

| Aspecto | Cursor | Copilot |
|---|---|---|
| Contexto feedforward | `managed-agents-md` (bloque AWM en `AGENTS.md`) | `managed-agents-md` |
| Skills (proyecto) | `.cursor/rules/` (archivos `.mdc` referenciando `SKILL.md`) | `.github/instructions/*.instructions.md` |
| Skills (global) | `~/.cursor/rules/` | no soportado → `global` = error claro, no silencio |
| Workflows/agents | `null` (no existe el concepto) | `null` |
| Hooks de sesión | no existen → sin `hooks` config | no existen |

**Limitación estructural que el diseño acepta y DOCUMENTA en vez de disimular:**
ni Cursor ni Copilot tienen Skill tool ni hooks de sesión. El spine de AWM
(invocación disciplinada de skills, gates de fase) se degrada a **contexto leído**:
el bloque en `AGENTS.md` instruye leer `SKILL.md` en los triggers. Es tier-2 por
naturaleza del agente, no bug de AWM. `awm doctor` reporta el tier de cada provider
instalado para que nadie espere paridad que el agente no puede dar. El runbook
(Cap. 4) documenta la matriz de capacidades por agente.

### D5 — Adopción en repos legacy (H5)

El mecanismo existe (`awm sensors baseline`); el hueco es de descubrimiento:

- `awm preflight` gana check advisory `baseline`: sensores configurados + sin
  `sensors.baseline.json` → sugerir el trinquete (texto, nunca bloqueo, no corre
  los sensores — preflight sigue barato).
- `awm sensors init` en repo con working tree grande imprime el hint del baseline.
- Runbook: sección "Adoptar AWM en un repo existente" (deuda → baseline → trinquete).

### D6 — CI del propio CLI (H6)

Workflow `ci.yml` en `pull_request`: `tsc --noEmit` + suite completa, matriz
`ubuntu` + `windows` (la matriz de Windows es lo que habría atrapado H1 antes de
publicarlo). `release.yml` corre la suite ANTES de publicar. El publish sigue
automático — la condición nueva es que esté verde.

### D7 — Gobierno en voz de producto (H7)

CONSTITUTION/AGENTS de `agentic-workflow` se reescriben como política: matriz de
soporte (stacks/agentes/hosts/OS declarados aquí), reglas de release ya vigentes,
doctrina fail-closed, frontera atendido/desatendido, y las decisiones de este
diseño como reglas citables. Deja de ser notas-a-mí-mismo.

## Orden y dependencias

R1 (Windows) es hotfix de algo publicado → primero y solo.
R2 (host git) y R3 (packs) son independientes entre sí; ambos solo dependen de R1
por higiene de release. R4 (providers) es el mayor y no depende de R2/R3.
R5 (legacy) toca preflight → después de R1. R6 (CI) cuanto antes, pero sin
bloquear los hotfixes; se ubica tras R1 para que la matriz Windows proteja el resto.
R7 (gobierno) al final: documenta lo que ya quedó verdadero.

## Riesgos

- **Formatos de Cursor/Copilot cambian rápido** (rules `.mdc`, instructions).
  Mitigación: verificar formato vigente contra docs oficiales al ejecutar R4, no
  confiar en memoria; los tests fijan el formato elegido.
- **`glab` no instalado en máquinas de equipo** → cubierto por degradación honesta
  (D2.2) y check advisory de preflight.
- **Windows sin CI hasta R6**: R1 se verifica con tests de plataforma mockeada;
  la verificación real en Windows llega con la matriz de R6. Gap aceptado y breve.
