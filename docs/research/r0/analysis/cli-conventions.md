# Convenciones del CLI relevantes para R2/R3 (controlador durable, runner, job, fingerprint) (R6, Step 3)

**Fuentes:** `/home/user/agentic-workflow/cli/src/commands/`, `/home/user/agentic-workflow/cli/tests/`, `/home/user/agentic-workflow/CONSTITUTION.md` (todas rutas reales de este repo).

## 1. Estructura de comandos (`cli/src/commands/`)

```
cli/src/commands/
├── add.ts
├── agent.ts
├── backup.ts
├── doctor.ts
├── export.ts
├── init.ts
├── pin.ts
├── sync.ts
├── update.ts
├── hooks/       index.ts, install.ts, uninstall.ts, status.ts, resync.ts, claude.ts, codex.ts, shared.ts
├── ledger/      index.ts
├── registry/    index.ts, add.ts, remove.ts, status.ts, install-bundles.ts
└── sensors/     index.ts, init.ts, install.ts, run.ts, status.ts, baseline.ts, types.ts
```

Patrón observado: comandos simples de un solo verbo son un único archivo plano en la raíz de `commands/` (`doctor.ts`, `sync.ts`, `pin.ts`). Comandos con múltiples subcomandos (namespace de verbos) se agrupan en un subdirectorio con un `index.ts` que registra los subcomandos y archivos separados por subcomando (`hooks/install.ts`, `sensors/run.ts`, `registry/add.ts`). `sensors/types.ts` es el único subdirectorio que además exporta un archivo de tipos dedicado (`SensorConfig`, `SensorManifest`, `SensorResult`, `SensorError`) — separando el contrato de datos del código de comando.

**Relevancia para R2/R3 (controlador/runner/job):** si el controlador durable se expone como comando CLI (ej. `awm run`, `awm job status`), el patrón ya establecido dicta un subdirectorio `commands/run/` o `commands/job/` con `index.ts` + un `types.ts` propio para el contrato de `Job`/estado — replicando la forma de `sensors/` en vez de inventar una nueva convención de organización.

## 2. Patrón de tests (tmpdirs, HOME override)

Evidencia real, `cli/tests/commands/hooks/install.test.ts:1-38`:

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('installHook (happy path + merge)', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-install-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-registry-'));
        // ... escribe fixtures dentro de tmpRegistry ...
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRegistry, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('installs on a clean system, creating settings.json with the AWM entry', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        ...
```

El mismo patrón se repite en `cli/tests/commands/sensors/install.test.ts:1-14` (tmpdir con `fs.mkdtempSync(path.join(os.tmpdir(), 'awm-install-'))`, `jest.resetModules()` en `beforeEach`, `fs.rmSync(tmpDir, { recursive: true })` en `afterEach`), aunque ese archivo no necesita override de `HOME`/`AWM_HOME` porque `settingsPath` se pasa explícito.

Reglas del patrón, confirmadas por ambos archivos:
- `mkdtempSync` bajo `os.tmpdir()`, nunca contra directorios reales del repo o del sistema.
- `process.env.HOME` / `process.env.AWM_HOME` se sobreescriben en `beforeEach` y se restauran exactamente (guardando el valor original, incluso `undefined`, y usando `delete` si era `undefined` — no `= undefined`) en `afterEach`.
- `jest.resetModules()` antes de cada test — necesario porque los módulos bajo test (`hooks/install`, `sensors/install`) leen `process.env.HOME`/`AWM_HOME` en tiempo de import/primera llamada, y sin reset quedarían con el valor cacheado de un test anterior.
- `require(...)` inline dentro de cada `it(...)`, después de fijar el `env`, en vez de `import` estático al top del archivo — consecuencia directa de necesitar el reset de módulos.
- Limpieza completa en `afterEach` con `force: true` para no dejar directorios huérfanos en `os.tmpdir()` entre corridas.

**Relevancia para R2/R3:** cualquier test de controlador/runner/job que lea/escriba estado durable (journal, job registry) DEBE seguir este mismo patrón — tmpdir aislado + override de `HOME`/`AWM_HOME` (o el env var equivalente que el job registry use) + reset de módulos — porque es el único patrón de aislamiento que existe en el repo y CLAUDE.md lo declara explícitamente obligatorio ("Tests: ningún test puede tocar el `~/.awm` real. Todos usan tmpdirs aislados... patrón de `cli/tests/commands/hooks/install.test.ts`").

## 3. Reglas de CONSTITUTION.md que aplican a args/enums/shape validation

Fuente: `/home/user/agentic-workflow/CONSTITUTION.md`.

- **Validación de argumentos CLI** (`CONSTITUTION.md:9`): *"Todo argumento CLI que espera un valor debe validar que el siguiente token no sea `undefined` ni empiece con `--`."* Patrón prohibido: `argv[++i] ?? 'default'`. Patrón exigido: `if (val === undefined || val.startsWith('--')) throw new Error('--flag requiere un valor')`. Aplica directamente a cualquier flag nuevo de un comando `awm run`/`awm job` (ej. `--fingerprint`, `--job-id`).

- **Shape validation más allá de sintaxis JSON** (`CONSTITUTION.md:13`): *"Un objeto leído de un archivo serializado (JSONL, JSON, config) puede ser sintácticamente válido y aun así tener shape inválido — el cast `as Tipo` no lo detecta en runtime."* Cita el caso real de `listEntries()` en el ledger, donde una entrada `.jsonl` histórica con `desc` faltante o `signature` numérico pasaba el `try/catch` de `JSON.parse` intacta y crasheaba `normalizeTokens`. Aplica directamente a un journal/job-state durable (R2/RF-2.1, RF-2.10): cualquier lectura de un job persistido debe validar shape, no solo sintaxis, antes de usar sus campos.

- **Enum de estado no debe significar dos cosas** (`CONSTITUTION.md:33`): *"Un valor de estado/enum nunca debe significar dos cosas distintas ('no aplica estructuralmente' vs 'está roto') — son estados separados, siempre."* Cita el caso real de `provider-checks.ts` reusando `'unsupported'` para "versión incompatible" y para "check no aplica a este provider", y de `skillsGlobalCheck` reusando `state: 'shared'` para "sano" y "roto". Aplica directamente al vocabulario de estados de job que RF-2.5/RF-2.7 del brief demandan (`running`, `suspected-stall`, `orphaned`) — cada estado debe ser un valor separado, nunca una sobrecarga.

- **Grep de valores viejos de enum al renombrar** (`CONSTITUTION.md:35`): *"Al agregar un valor nuevo a un enum de estado existente (`status`, `overall`, etc.), grep el árbol de tests COMPLETO por assertions contra los valores VIEJOS antes de marcar la tarea completa."* Evidencia real ya en el código: `SensorResult.status` en `cli/src/commands/sensors/types.ts` documenta en comentario el mismo tipo de distinción (`pass`/`fail`/`inconclusive`/`skipped`, con nota explícita de que `inconclusive` "Never green — it degrades `overall` to `not_certified`"), mostrando el patrón ya aplicado en producción para un enum de 4 estados con la misma disciplina que RF-2.5/RF-2.7 exige para estados de job.

- **Convención local del archivo, no del módulo hermano** (`CONSTITUTION.md:37`): al agregar código a un archivo ya existente, copiar la indentación/keyword ya establecidos de ESE archivo, no la convención de otro módulo tocado en la misma sesión — con el caso real de `transform.ts` (2-espacios/`it()`) vs `cluster.ts` (4-espacios/`test()`) como evidencia (ver `docs/research/r0/analysis/ledger-schema.md` para el detalle completo del cluster). Aplica a cualquier archivo de comando/test nuevo del controlador que conviva en el mismo PR con código de otro subsistema.

## Conclusión

Las convenciones reales que un futuro `commands/run/` o `commands/job/` (R2/R3) debe heredar sin negociar: (1) subdirectorio con `index.ts` + `types.ts` dedicado si hay más de un subcomando o un contrato de datos no trivial (patrón `sensors/`); (2) tests con tmpdir + override de `HOME`/`AWM_HOME` + `jest.resetModules()` + `require()` inline (patrón `hooks/install.test.ts`, `sensors/install.test.ts`, obligatorio por CLAUDE.md); (3) validación de args fail-fast, shape validation de todo estado leído de disco, y estados de enum nunca sobrecargados — las tres reglas de `CONSTITUTION.md` con más impacto directo en el diseño de un journal/job-state durable.
