# Ciclo de vida de procesos — elicitación, generación y verificación (R1b) Implementation Plan

<!-- awm-qa-complete: 2026-08-24 -->
<!-- awm-retro-complete: 2026-08-24 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar el skill `process-lifecycle` — la mitad *escritora* del ciclo de vida: elicita un proceso como entrevista HTA, genera el orquestador y sus artefactos derivados, verifica que quedó compuesto en una instalación real, y permite modificar un modelo ya activo.

**Architecture:** Dos repos. En `agentic-workflow` (CLI) se abre la única superficie que faltaba: un comando read-only que expone la lista de orquestadores **tal como queda compuesta** en el payload de contexto, reusando `buildContext`/`collectDeclaredOrchestrators` sin reimplementar nada. En `awm-baseline-registry` (contenido) vive el skill, que consume ese comando para cerrar su ciclo de verificación, delega todo craft de escritura a `writing-skills`, y aporta el overlay de obligaciones de fase que hoy es tierra de nadie.

**Tech Stack:** TypeScript + commander + jest (CLI); Markdown + tests de contrato en Node nativo (`node:test` / `node:assert`) sobre el registry.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

## Alcance

Cubre del design doc [`2026-08-23-process-lifecycle-design.md`](2026-08-23-process-lifecycle-design.md): **R2.1–R2.8** (elicitación), **R3.1–R3.6** (generación y verificación), **R4.1** (modificar un modelo `active`), y **R7.1–R7.4** (robustez y no regresión) en lo que este cambio toca.

**Ya entregado por R1a, no se re-implementa:** el contrato del modelo (`R1.*`), `awm process list|show --json` como único parser (`R5.1`, `R5.2`), el adapter del Dashboard (`R5.3`) y la frontera de sanitización del Dashboard (`R5.4`). Este plan **consume** ese contrato.

**Fuera de alcance, deliberado:** extracción desde procesos existentes (`R4.2`–`R4.4`) y captura retrospectiva — son las releases siguientes.

## Estado verificado del código (leído, no supuesto)

Todo lo de esta sección se leyó de los archivos reales antes de escribir el plan. Los números de línea son del estado actual (`agentic-workflow` @ `e666206` v9.1.0, `awm-baseline-registry` @ `3387b02`).

1. **`buildContext` no tiene superficie read-only.** `cli/src/core/context/provider.ts:53` es la única definición; sus cuatro call sites (`core/context/orchestrator.ts:57` y `:92`, `commands/hooks/claude.ts:43`) **escriben** el skill materializado. Ningún comando del CLI llega a `buildContext` hoy. Ésa es exactamente la brecha que `R3.5` necesita cerrar.

2. **`sanitizeForMarkdown` es privada.** `provider.ts:36-38`, invocada solo desde `renderDeclared` (`:44-46`). Elimina `\r?\n` y los caracteres `` ` * _ # < > ``. **No elimina bytes de control C0 ni secuencias ANSI (`\x1b`)** — a diferencia de `stripControlChars` (`cli/src/commands/process/index.ts:31-34`), que sí lo hace para su propia salida a terminal. Un comando nuevo que imprima estos valores a una terminal necesita ambos.

3. **`ctx.markdown` incluye el `SKILL.md` crudo del registry.** `provider.ts:58` lo lee con `readFileSync` y `:62` lo concatena sin filtro alguno. **Por eso el comando de este plan NO imprime `ctx.markdown`** — emite solo los campos estructurados de cada orquestador declarado. Imprimir el payload entero abriría a la terminal el contenido crudo de un registry externo, que es justo el hallazgo *blocker* que la QA de R1a corrigió en `process show`.

4. **`collectDeclaredOrchestrators()` vs `collectAndWarn()`.** Ambas tocan el filesystem. La diferencia es quién escribe los warnings: `collectDeclaredOrchestrators` (`core/orchestrators.ts:124`) **devuelve** `{ declared, diagnostics }` sin imprimir; `collectAndWarn` (`:148`) es un wrapper que hace `console.warn` y descarta los diagnósticos. Un comando read-only debe usar **la primera** y rutear los diagnósticos a su propio stderr — el precedente es `core/context/regenerate.ts:37`.

5. **El dedupe ya existe y gana el primero en orden de `listRegistries()`** (`orchestrators.ts:130-137`), con diagnóstico por duplicado descartado. El comando no re-implementa dedupe: reporta lo que la composición real produce.

6. **`scripts/validate-portability.mjs:528` hardcodea `38` directorios de skill.** Agregar uno obliga a cambiarlo a `39` en la misma tanda o el gate falla en PR y en release.

7. **`validate-portability.mjs` prohíbe vocabulario acoplado a un provider en todo `.md` bajo `skills/`** (`:53-65`): `` `Task|Read|Write|Edit|Bash|Glob|Grep|Skill|WebFetch|WebSearch|NotebookEdit` tool ``, `TodoWrite`, `AskUserQuestion`, `Task("`, `superpowers:`. **El `SKILL.md` nuevo cae bajo esta regla** y debe escribirse en vocabulario agnóstico ("el mecanismo nativo de la plataforma", no el nombre de una herramienta concreta).

8. **Un test nuevo no corre si no se lo agrega a mano** a las dos listas: `.github/workflows/validate.yml:26-43` y `.github/workflows/auto-tag.yml:52-71`.

9. **`check-skill-version-bumps.sh`**: un `SKILL.md` **nuevo** pasa sin bump (`git show BASE:$f` falla → `old_version="NEW-FILE"`), pero **todo bundle que lo liste debe bumpear** su versión en `bundle.json` **y** `catalog.json`, que deben coincidir byte a byte.

10. **`minCliVersion` no se toca.** Hoy `awm-registry.json` declara `8.5.0`, con aserción exacta en `tests/r3-release-metadata.test.mjs:46` acoplada al ancla del CHANGELOG (`:47`). Por la enmienda del design doc, el skill **degrada** en vez de bloquear el registry entero — así que ni el manifiesto ni ese test se tocan en este plan.

## File Structure

### `agentic-workflow` (CLI)

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/text.ts` (crear) | `stripControlChars` compartido. Hoy vive privado en `commands/process/index.ts`; dos consumidores lo necesitan y duplicarlo es la forma de defecto que `AGENTS.md` documenta como `defensive-guard-consistency` |
| `cli/src/core/context/provider.ts` (modificar) | Exportar `composedOrchestrators()` — la lista deduplicada **y saneada** tal como entra al payload. `renderDeclared` pasa a consumirla, así el comando y el payload no pueden divergir |
| `cli/src/commands/context/index.ts` (crear) | `awm context orchestrators [--json] [--verify <name>]`. Funciones puras que devuelven `{code, stdout, stderr}` + `emit()`, patrón de `commands/process/index.ts` |
| `cli/src/index.ts` (modificar) | Import + `registerContextCommand(program)` |
| `docs/cli-reference.md` (modificar) | Sección `### \`awm context\`` |

### `awm-baseline-registry` (contenido)

| Archivo | Responsabilidad |
|---|---|
| `tests/r11-process-lifecycle-contract.test.mjs` (crear) | El contrato ejecutable del skill. Se escribe **antes** que el skill: es su especificación |
| `skills/process-lifecycle/SKILL.md` (crear) | El skill: elicitación HTA, generación, verificación, modificación, y el overlay de fase |
| `bundles/process/bundle.json` (crear) | Bundle nuevo, `dependsOn: ["authoring"]`, scope `baseline` |
| `bundles/authoring/bundle.json` (modificar) | `scope` → `baseline`; descripción sin la nota stale |
| `catalog.json` (modificar) | Alta de `process`; `authoring` a `baseline` + bump |
| `README.md` (modificar) | Tabla de bundles |
| `scripts/validate-portability.mjs` (modificar) | `38` → `39` |
| `.github/workflows/validate.yml`, `.github/workflows/auto-tag.yml` (modificar) | Cablear el test nuevo en ambas listas |

---

## Task 1: `stripControlChars` compartido y `composedOrchestrators` exportada

_Requirements: R5.2, R5.4_

**Files:**
- Create: `cli/src/core/text.ts`
- Modify: `cli/src/commands/process/index.ts:31-34` (quitar la copia local, importar)
- Modify: `cli/src/core/context/provider.ts:36-51`
- Test: `cli/tests/core/context/provider.test.ts` (extender)

- [x] **Step 1: Escribir el test que falla**

Agregar al final de `cli/tests/core/context/provider.test.ts`:

```ts
import { composedOrchestrators } from '../../../src/core/context/provider';

describe('composedOrchestrators', () => {
    it('devuelve los valores tal como entran al payload, ya saneados', () => {   // verifies R5.2
        const out = composedOrchestrators([
            { name: 'mi-proceso', appliesWhen: 'cuando *algo*', terminatesTo: 'development-process' },
        ]);
        expect(out).toEqual([
            { name: 'mi-proceso', appliesWhen: 'cuando algo', terminatesTo: 'development-process' },
        ]);
    });

    it('neutraliza saltos de linea y markdown estructural', () => {              // verifies R5.4
        const out = composedOrchestrators([
            { name: 'x', appliesWhen: 'a\n## Forjado', terminatesTo: '`b`' },
        ]);
        expect(out[0].appliesWhen).toBe('a  Forjado');
        expect(out[0].terminatesTo).toBe('b');
    });

    it('lo que renderiza el payload sale de esta misma funcion', () => {         // verifies R5.2
        // Si renderDeclared dejara de consumirla, el comando y el payload
        // podrian divergir en silencio — que es el modo de falla que R5.2 prohibe.
        const declared = [{ name: 'p', appliesWhen: 'w', terminatesTo: 't' }];
        const composed = composedOrchestrators(declared);
        const ctx = buildContext({ registryRoot: fixtureRoot, profileExtensions: [], declaredOrchestrators: declared });
        expect(ctx.markdown).toContain(`- **${composed[0].name}** — applies when: ${composed[0].appliesWhen}.`);
    });
});
```

*(`fixtureRoot` y `buildContext` ya están importados/creados por los `describe` existentes de este archivo — reusar el mismo helper de fixture que usa `describe('buildContext')`.)*

Y crear `cli/tests/core/text.test.ts`:

```ts
import { stripControlChars } from '../../src/core/text';

describe('stripControlChars', () => {
    it('elimina ESC y demas bytes de control C0', () => {                        // verifies R5.4
        expect(stripControlChars('a\x1b[31mb\x00c\x07d')).toBe('a[31mbcd');
    });

    it('preserva \\n y \\t, que son whitespace legitimo', () => {                // verifies R5.4
        expect(stripControlChars('a\nb\tc')).toBe('a\nb\tc');
    });

    it('elimina DEL (0x7F)', () => {                                            // verifies R5.4
        expect(stripControlChars('a\x7Fb')).toBe('ab');
    });
});
```

- [x] **Step 2: Correr los tests y verificar que fallan**

Run: `cd cli && npx jest tests/core/text.test.ts tests/core/context/provider.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../src/core/text'` y `composedOrchestrators is not a function`

- [x] **Step 3: Crear el módulo compartido**

```ts
// cli/src/core/text.ts
/** Neutraliza bytes de control C0 (incluyendo ESC `\x1b`) y DEL de texto que
 *  proviene de un registry no confiable antes de escribirlo a una terminal
 *  humana. `\n` y `\t` se preservan porque son whitespace legítimo.
 *
 *  Vive en core/ y no dentro de un comando porque tiene DOS consumidores:
 *  `awm process show` (vista de texto del modelo) y `awm context orchestrators`
 *  (campos declarados por un registry). Duplicarlo es la forma exacta que
 *  `AGENTS.md` documenta bajo `defensive-guard-consistency`: endurecer una copia
 *  y dejar la otra atrás. */
export function stripControlChars(text: string): string {
    // eslint-disable-next-line no-control-regex -- necesitamos matchear C0 deliberadamente
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
```

- [x] **Step 4: Que `commands/process` consuma el compartido**

En `cli/src/commands/process/index.ts`, borrar la función local `stripControlChars` (líneas 31-34 y su bloque de JSDoc `:22-30`) y agregar el import junto a los demás:

```ts
import { stripControlChars } from '../../core/text';
```

El resto del archivo no cambia — las llamadas ya se llaman igual.

- [x] **Step 5: Exportar `composedOrchestrators` y que `renderDeclared` la consuma**

En `cli/src/core/context/provider.ts`, reemplazar `renderDeclared` (líneas 40-51) por:

```ts
/**
 * La lista de orquestadores declarados TAL COMO entra al payload de contexto:
 * saneada campo por campo con `sanitizeForMarkdown`.
 *
 * Exportada porque `awm context orchestrators` debe poder mostrar exactamente
 * lo que el agente va a recibir, no una segunda derivación de los mismos datos.
 * Si el comando aplicara su propio saneo, comando y payload podrían divergir en
 * silencio — el modo de falla que R5.2 prohíbe para el modelo de proceso y que
 * vale igual acá.
 */
export function composedOrchestrators(list: DeclaredOrchestrator[]): DeclaredOrchestrator[] {
    return list.map(o => ({
        name: sanitizeForMarkdown(o.name),
        appliesWhen: sanitizeForMarkdown(o.appliesWhen),
        terminatesTo: sanitizeForMarkdown(o.terminatesTo),
    }));
}

function renderDeclared(list: DeclaredOrchestrator[]): string {
    if (list.length === 0) return '';
    const rows = composedOrchestrators(list)
        .map(o => `- **${o.name}** — applies when: ${o.appliesWhen}. Terminates to: \`${o.terminatesTo}\`.`)
        .join('\n');
    return `## Declared orchestrators\n\nConsider these before the built-in pair:\n\n${rows}\n\n`;
}
```

- [x] **Step 6: Correr los tests y verificar que pasan**

Run: `cd cli && npx jest tests/core/text.test.ts tests/core/context/provider.test.ts tests/commands/process.test.ts --runInBand`
Expected: PASS — incluidos los 3 tests de sanitización preexistentes de `provider.test.ts` y el de ANSI de `process.test.ts`, que prueban que el refactor no cambió comportamiento

- [x] **Step 7: Gate de sensores y commit**

```bash
cd cli && npm run build && cd .. && node cli/dist/src/index.js sensors run
```
Expected: `"overall": "pass"`

```bash
git add cli/src/core/text.ts cli/tests/core/text.test.ts cli/src/core/context/provider.ts cli/tests/core/context/provider.test.ts cli/src/commands/process/index.ts
git commit -m "refactor(context): exponer la lista compuesta y compartir el saneo de control chars"
```

---

## Task 2: `awm context orchestrators`

_Requirements: R3.5, R7.1, R7.2_

**Files:**
- Create: `cli/src/commands/context/index.ts`
- Modify: `cli/src/index.ts:50` (import), `cli/src/index.ts:805` (registro)
- Test: `cli/tests/commands/context.test.ts`

**Nota post-implementation-qa:** el code-quality review de esta task extrajo `cli/src/core/command-result.ts` (`CommandResult`/`diagnosticsToStderr`/`emit`) por duplicación byte-idéntica con `commands/process/index.ts`. No traza a un `R#` propio — es refactor de calidad dentro de una task ya revisada y aprobada, no scope creep: sin él, un tercer comando repetiría la misma copia por tercera vez.

- [x] **Step 1: Escribir el test que falla**

```ts
// cli/tests/commands/context.test.ts
import { runContextOrchestrators } from '../../src/commands/context';

const collected = (declared: { name: string; appliesWhen: string; terminatesTo: string }[], diagnostics: string[] = []) =>
    ({ declared, diagnostics });

const uno = { name: 'mi-proceso', appliesWhen: 'cuando hay una tarea', terminatesTo: 'development-process' };

describe('awm context orchestrators', () => {
    it('lista los orquestadores compuestos', () => {                             // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: false });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stdout).toContain('development-process');
    });

    it('sin declarados sale 0 y lo dice, no falla', () => {                      // verifies R7.2
        const r = runContextOrchestrators(collected([]), { json: false });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/no declared orchestrators/i);
    });

    it('emite los diagnosticos sin dejar de listar los sanos', () => {           // verifies R7.1
        const r = runContextOrchestrators(collected([uno], ['/r/awm-registry.json: boom']), { json: false });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stderr).toContain('boom');
    });

    it('--json emite la lista compuesta como JSON', () => {                      // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: true });
        expect(r.code).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ orchestrators: [uno] });
    });

    it('--verify sale 0 cuando el nombre esta compuesto', () => {                // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: false, verify: 'mi-proceso' });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/composed/i);
    });

    it('--verify sale 2 y nombra lo disponible cuando no esta', () => {          // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: false, verify: 'no-existe' });
        expect(r.code).toBe(2);
        expect(r.stderr).toContain('no-existe');
        expect(r.stderr).toContain('mi-proceso');
    });

    it('sanea bytes de control antes de escribir a la terminal', () => {         // verifies R5.4
        const hostil = { name: 'x\x1b[31m', appliesWhen: 'w\x07', terminatesTo: 't\x00' };
        const r = runContextOrchestrators(collected([hostil]), { json: false });
        // eslint-disable-next-line no-control-regex -- verificamos la ausencia deliberada de C0
        expect(r.stdout).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    });
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/commands/context.test.ts --runInBand`
Expected: FAIL — módulo inexistente

- [x] **Step 3: Escribir el comando**

```ts
// cli/src/commands/context/index.ts
// `awm context` — superficie READ-ONLY sobre el payload de contexto que AWM
// entrega a cada sesión de agente.
//
// Existe por R3.5: el ciclo de verificación de `process-lifecycle` debe poder
// confirmar que un orquestador declarado por un registry aparece EFECTIVAMENTE
// compuesto, y hasta acá `buildContext` solo era alcanzable escribiendo el skill
// materializado desde el hook de SessionStart.
//
// Deliberadamente NO imprime `ctx.markdown`: ese string incluye el SKILL.md crudo
// del registry (provider.ts:58-62), contenido externo sin filtro. Este comando
// emite solo los campos estructurados de cada declaración, que ya pasaron por
// `sanitizeForMarkdown` y acá además por `stripControlChars`.
import { Command } from 'commander';
import { collectDeclaredOrchestrators, type DeclaredOrchestrator } from '../../core/orchestrators';
import { composedOrchestrators } from '../../core/context/provider';
import { stripControlChars } from '../../core/text';

export interface CommandResult { code: 0 | 2; stdout: string; stderr: string }
export interface CollectedOrchestrators { declared: DeclaredOrchestrator[]; diagnostics: string[] }
export interface OrchestratorsOptions { json: boolean; verify?: string }

function diagnosticsToStderr(diagnostics: string[]): string {
    return diagnostics.map((d) => `warning: ${d}\n`).join('');
}

export function runContextOrchestrators(collected: CollectedOrchestrators, opts: OrchestratorsOptions): CommandResult {
    const stderr = diagnosticsToStderr(collected.diagnostics);
    const composed = composedOrchestrators(collected.declared);

    if (opts.verify !== undefined) {
        const found = composed.some((o) => o.name === opts.verify);
        if (!found) {
            const available = composed.map((o) => o.name).join(', ') || '(none)';
            return {
                code: 2, stdout: '',
                stderr: `${stderr}awm context orchestrators: "${stripControlChars(opts.verify)}" is not composed — available: ${stripControlChars(available)}\n`,
            };
        }
        return { code: 0, stdout: `"${stripControlChars(opts.verify)}" is composed into the session context.\n`, stderr };
    }

    if (opts.json) {
        // JSON.stringify ya escapa los caracteres de control como parte de
        // producir JSON válido, así que esta rama no necesita stripControlChars.
        return { code: 0, stdout: `${JSON.stringify({ orchestrators: composed }, null, 2)}\n`, stderr };
    }

    if (composed.length === 0) {
        return { code: 0, stdout: 'No declared orchestrators in the installed registries.\n', stderr };
    }
    const rows = composed
        .map((o) => `${stripControlChars(o.name)}  applies when: ${stripControlChars(o.appliesWhen)}  -> ${stripControlChars(o.terminatesTo)}`)
        .join('\n');
    return { code: 0, stdout: `${rows}\n`, stderr };
}

export function registerContextCommand(program: Command): void {
    const context = program.command('context').description('read-only view of the context AWM delivers to every agent session');

    context
        .command('orchestrators')
        .description('list the declared orchestrators as they are composed into the session context')
        .option('--json', 'emit the composed list as JSON')
        .option('--verify <name>', 'exit 0 only if that orchestrator is composed; 2 otherwise')
        .action((opts: { json?: boolean; verify?: string }) => emit(runContextOrchestrators(
            collectDeclaredOrchestrators(),
            { json: opts.json === true, verify: opts.verify },
        )));
}

function emit(result: CommandResult): void {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.code !== 0) process.exitCode = result.code;
}
```

- [x] **Step 4: Registrar el comando**

En `cli/src/index.ts`, junto a los demás imports de comandos (después de la línea 50):

```ts
import { registerContextCommand } from './commands/context';
```

y junto a las demás llamadas de registro (después de la línea 805):

```ts
registerContextCommand(program);
```

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `cd cli && npx jest tests/commands/context.test.ts --runInBand`
Expected: PASS — 7 tests

- [x] **Step 6: Commit**

```bash
git add cli/src/commands/context/index.ts cli/src/index.ts cli/tests/commands/context.test.ts
git commit -m "feat(context): awm context orchestrators, superficie read-only del payload"
```

---

## Task 3: Verificación end-to-end y referencia de CLI

_Requirements: R3.5, R7.3, R7.4_

**Files:**
- Test: `cli/tests/integration/context-orchestrators-e2e.test.ts`
- Modify: `docs/cli-reference.md`

- [x] **Step 1: Escribir el test e2e contra el binario compilado**

```ts
// cli/tests/integration/context-orchestrators-e2e.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(CLI_ROOT, 'dist', 'src', 'index.js');

/** Registry de prueba con un orquestador declarado. Nunca toca el ~/.awm real (R7.4). */
function seedRegistry(): string {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-e2e-')));
    const awmHome = path.join(home, '.awm');
    const root = path.join(awmHome, 'registries', 'test-registry');
    fs.mkdirSync(path.join(root, 'skills', 'using-awm'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'),
        JSON.stringify([{ name: 'test-registry', remote: 'https://example.invalid/test.git' }]));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: { name: 'ejemplo-proceso', appliesWhen: 'cuando hay una tarea sin plan', terminatesTo: 'development-process' },
    }));
    fs.writeFileSync(path.join(root, 'skills', 'using-awm', 'SKILL.md'), '---\nname: using-awm\nversion: "1.0.0"\n---\n\n# using-awm\n');
    return home;
}

function run(home: string, ...args: string[]) {
    return spawnSync(process.execPath, [DIST, ...args], {
        cwd: CLI_ROOT, encoding: 'utf8',
        env: { ...process.env, HOME: home, AWM_HOME: path.join(home, '.awm') },
    });
}

describe('awm context orchestrators (binario real)', () => {
    let home: string;
    beforeAll(() => { home = seedRegistry(); });
    afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

    it('reporta el orquestador declarado por el registry sembrado', () => {      // verifies R3.5
        const r = run(home, 'context', 'orchestrators');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('ejemplo-proceso');
    });

    it('--json emite la lista parseable', () => {                                // verifies R3.5
        const r = run(home, 'context', 'orchestrators', '--json');
        expect(r.status).toBe(0);
        expect(JSON.parse(r.stdout).orchestrators[0].name).toBe('ejemplo-proceso');
    });

    it('--verify cierra el ciclo de verificacion con exit code', () => {         // verifies R3.5
        expect(run(home, 'context', 'orchestrators', '--verify', 'ejemplo-proceso').status).toBe(0);
        const ausente = run(home, 'context', 'orchestrators', '--verify', 'no-existe');
        expect(ausente.status).toBe(2);
        expect(ausente.stderr).toContain('ejemplo-proceso');
    });
});
```

- [x] **Step 2: Buildear y correr el e2e**

Run: `cd cli && npm run build && npx jest tests/integration/context-orchestrators-e2e.test.ts --runInBand`
Expected: PASS — 3 tests

- [x] **Step 3: Documentar el comando**

En `docs/cli-reference.md`, agregar una sección con la misma forma que las vecinas (`### \`awm preflight\`` está en la línea 136, `### \`awm context-budget\`` en la 164), ubicada junto a ellas:

```markdown
### `awm context orchestrators`

Vista read-only de los orquestadores que los registries instalados declaran, **tal como quedan compuestos** en el contexto que recibe cada sesión de agente.

```bash
awm context orchestrators              # listado legible
awm context orchestrators --json       # lista compuesta como JSON
awm context orchestrators --verify mi-proceso   # exit 0 si está compuesto, 2 si no
```

Emite solo los campos declarados (`name`, `appliesWhen`, `terminatesTo`), no el payload completo: ese incluye contenido crudo del registry. Las declaraciones inválidas se reportan como `warning:` en stderr sin impedir listar las sanas.

`--verify` es lo que cierra el ciclo de verificación de `process-lifecycle`: confirma que un proceso recién generado aparece compuesto en una instalación real, no solo que el registry instaló.
```

- [x] **Step 4: Suite completa y sensores**

Run: `cd cli && npx jest --runInBand`
Expected: 0 fallos. La línea base antes de este plan es **263 suites**; debe crecer, nunca decrecer.

```bash
cd /home/user/agentic-workflow && node cli/dist/src/index.js sensors run
```
Expected: `"overall": "pass"`

- [x] **Step 5: Commit**

```bash
git add cli/tests/integration/context-orchestrators-e2e.test.ts docs/cli-reference.md
git commit -m "test(context): e2e contra el binario real y referencia de CLI"
```

---

## Task 4: El contrato ejecutable del skill

_Requirements: R2.1, R2.2, R2.3, R2.5, R2.6, R2.7, R2.8, R3.2, R3.3, R3.4, R3.5, R3.6, R4.1, R7.1_

**Files:**
- Create (repo `awm-baseline-registry`): `tests/r11-process-lifecycle-contract.test.mjs`

Se escribe **antes** que el skill, siguiendo el precedente exacto de `tests/r10-documentation-phase-contract.test.mjs`: en un artefacto de prosa, el test de contrato *es* la especificación, y es lo único que impide que el skill derive en silencio.

- [x] **Step 1: Escribir el test que falla**

```javascript
// tests/r11-process-lifecycle-contract.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');

const SKILL = 'skills/process-lifecycle/SKILL.md';

test('R2.1: pregunta primero en que registry vive el proceso', () => {
  const text = read(SKILL);                                    // verifies R2.1
  assert.match(text, /^name:\s*process-lifecycle\s*$/m,
    'the frontmatter name must match the directory name — directory wins for discovery');
  assert.match(text, /registry de destino|en qué registry/i,
    'the skill must ask which registry hosts the process before eliciting content');
});

test('R2.2 y R2.3: escribe en el clon del registry y rechaza ~/.awm', () => {
  const text = read(SKILL);                                    // verifies R2.2, R2.3
  assert.match(text, /~\/\.awm/,
    'the skill must name the installer territory it refuses to write to');
  assert.match(text, /\bnunca\b[^.]*~\/\.awm|~\/\.awm[^.]*\bnunca\b|rechaz[ao][^.]*~\/\.awm/i,
    'refusing to write under ~/.awm must be stated as a hard rule, not a preference');
  assert.match(text, /working copy|clon del registry/i,
    'the skill must state that the model is written into the registry working copy');
});

test('R2.4 y R2.5: elicitacion HTA con criterio de parada', () => {
  const text = read(SKILL);                                    // verifies R2.4, R2.5
  for (const marker of ['SG-', 'OP-']) {
    assert.ok(text.includes(marker), `the skill must use the ${marker} id scheme from the model contract`);
  }
  assert.match(text, /skill invocable/i,
    'the skill must state the stop criterion: decomposition ends when an operation could be an invocable skill');
});

test('R2.6: un draft existente se retoma leyendolo', () => {
  const text = read(SKILL);                                    // verifies R2.6
  assert.match(text, /status:\s*draft|`draft`/,
    'the skill must name the draft status it resumes from');
  assert.match(text, /\bno\b[^.]*volver a relatar|retoma|reanuda/i,
    'resuming must read the model, never ask the user to re-tell the process');
});

test('R2.7: delega el craft de escritura a writing-skills', () => {
  const text = read(SKILL);                                    // verifies R2.7
  assert.match(text, /REQUIRED SUB-SKILL:\s*`?writing-skills`?/,
    'the skill must delegate skill-writing craft with the canonical requirement marker');
});

test('R2.8: aporta el overlay de obligaciones de fase', () => {
  const text = read(SKILL);                                    // verifies R2.8
  const overlay = ['disparador', 'marker', 'terminación', 'gate', 'modo'];
  for (const obligation of overlay) {
    assert.match(text, new RegExp(obligation, 'i'),
      `the phase overlay must cover "${obligation}" — it is the tierra de nadie writing-skills does not carry`);
  }
});

test('R3.1: genera en loop dirigido con aprobacion por fase', () => {
  const text = read(SKILL);                                    // verifies R3.1
  assert.match(text, /aprobación por fase|aprobacion por fase/i,
    'generation must be a directed loop with per-phase approval — not a single-shot constellation');
  for (const artifact of ['orquestador', 'bundle']) {
    assert.match(text, new RegExp(artifact, 'i'),
      `the generation step must name the ${artifact} it produces`);
  }
});

test('R3.2 y R3.3: la declaracion se deriva del modelo, no se edita aparte', () => {
  const text = read(SKILL);                                    // verifies R3.2, R3.3
  assert.match(text, /awm-registry\.json/,
    'the skill must name the manifest it generates');
  for (const field of ['appliesWhen', 'terminatesTo']) {
    assert.ok(text.includes(field), `the skill must name the derived field ${field}`);
  }
  assert.match(text, /entry_point[^.]*false[^.]*\bno\b|\bno\b[^.]*orchestrator[^.]*entry_point/i,
    'entry_point false must emit no orchestrator block at all');
});

test('R3.4: verifica colision de nombres antes de escribir', () => {
  const text = read(SKILL);                                    // verifies R3.4
  assert.match(text, /colisi[óo]n|collision/i,
    'the skill must check the name against installed content before writing');
});

test('R3.5 y R3.6: el ciclo de verificacion llega a composicion real y recien ahi promueve', () => {
  const text = read(SKILL);                                    // verifies R3.5, R3.6
  assert.match(text, /awm context orchestrators/,
    'the verification cycle must use the read-only CLI surface, not a hand-rolled check');
  assert.match(text, /--verify/,
    'the skill must use the flag whose exit code is the verification verdict');
  assert.doesNotMatch(text, /~\/\.claude\/skills\/using-awm/,
    'verification must NOT read the materialized using-awm — that is a provider-specific path and a second source of truth');
  assert.match(text, /status:\s*active|`active`/,
    'the skill must name the status it promotes to');
});

test('R4.1: un modelo active se puede cargar, editar y regenerar', () => {
  const text = read(SKILL);                                    // verifies R4.1
  assert.match(text, /awm process show/,
    'loading an existing model must go through the CLI parser, never a second parser');
  assert.match(text, /regenera|regeneración/i,
    'the skill must describe regenerating the derived artifacts after an edit');
});

test('R7.1: sin el comando de verificacion degrada, no bloquea', () => {
  const text = read(SKILL);                                    // verifies R7.1
  assert.match(text, /\bnunca\b[^.]*bloquea|no bloquea|sin bloquear/i,
    'the skill must state that it never blocks the user when it cannot run');
  assert.match(text, /degrada|degradación/i,
    'the skill must describe its honest degradation path');
});

test('el skill declara como lee el modo de ejecucion', () => {
  const text = read(SKILL);                                    // verifies R7.1
  assert.match(text, /^## Modo de ejecución/m,
    'every skill that can run post-plan must declare how it reads the execution mode');
  assert.match(text, /desatendido/,
    'the skill must describe its unattended behavior');
});

const BUNDLE = 'bundles/process/bundle.json';

test('empaque: el bundle process depende de authoring y ambos son baseline', () => {
  const bundle = JSON.parse(read(BUNDLE));                     // verifies R2.7
  assert.equal(bundle.scope, 'baseline');
  assert.deepEqual(bundle.dependsOn, ['authoring'],
    'process depends on authoring: shipping it without writing-skills installed is the "uninstalled successor" degradation');
  assert.ok(bundle.skills.includes('process-lifecycle'));

  const authoring = JSON.parse(read('bundles/authoring/bundle.json'));
  assert.equal(authoring.scope, 'baseline',
    'authoring must be baseline too, or process ships a REQUIRED SUB-SKILL nobody has');
  assert.doesNotMatch(authoring.description, /enable only in the agentic-workflow repo/i,
    'that note went stale when authoring became an end-user activity');

  const catalog = JSON.parse(read('catalog.json'));
  for (const name of ['process', 'authoring']) {
    const entry = catalog.bundles.find(b => b.name === name);
    assert.ok(entry, `catalog.json must list ${name}`);
    assert.equal(entry.scope, 'baseline');
    const manifest = JSON.parse(read(`bundles/${name}/bundle.json`));
    assert.equal(entry.version, manifest.version,
      `${name}: catalog and bundle versions must agree byte for byte`);
  }
});
```

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd /home/user/awm-baseline-registry && node tests/r11-process-lifecycle-contract.test.mjs`
Expected: FAIL — `ENOENT: skills/process-lifecycle/SKILL.md`

- [x] **Step 3: Commit**

```bash
cd /home/user/awm-baseline-registry
git add tests/r11-process-lifecycle-contract.test.mjs
git commit -m "test(process-lifecycle): contrato ejecutable del skill, antes del skill"
```

---

## Task 5: El skill `process-lifecycle`

_Requirements: R2.1–R2.8, R3.1–R3.6, R4.1, R7.1_

**Files:**
- Create (repo `awm-baseline-registry`): `skills/process-lifecycle/SKILL.md`

**Skills:** writing-skills

El contrato que este archivo debe satisfacer es el test de la Task 4, que ya está en verde-rojo. **Este archivo se escribe hasta que ese test pasa** — no hay margen de interpretación sobre qué debe contener.

- [x] **Step 1: Escribir el frontmatter exacto**

```yaml
---
name: process-lifecycle
version: "1.0.0"
license: Apache-2.0
description: Use when creating, modifying, or verifying an AWM process — elicits the process as a hierarchical interview, generates its orchestrator, declaration, bundle and phase skills into a registry working copy, and verifies the result appears composed in a real installation before promoting it to active.
---
```

`license: Apache-2.0` es obligatorio: `scripts/validate-portability.mjs:306-312` rechaza cualquier `SKILL.md` que no lo declare, porque es el campo que sobrevive a `awm export` donde el LICENSE del repo no viaja.

- [x] **Step 2: Escribir el cuerpo, con estas secciones**

Estructura obligatoria (cada una existe porque el test de la Task 4 la exige, o porque el precedente `post-implementation-docs` la establece):

| Sección | Qué debe contener |
|---|---|
| `# Process Lifecycle` + `## Overview` | Qué hace y qué **no**: compone procesos, no enseña a escribir un skill |
| `**Announce at start:**` | Frase de anuncio, patrón de todos los skills del registry |
| `## Modo de ejecución (lectura del campo)` | Bloque canónico + `### Modo desatendido` |
| `## Cuándo aplica` | Los cuatro modos: crear, retomar un `draft`, modificar un `active`, verificar |
| `## El artefacto` | El contrato del modelo, **citado desde R1a, no redefinido** |
| `## Paso 1 — Registry de destino` | R2.1/R2.2/R2.3: pregunta el registry ANTES de elicitar; escribe en el working copy; rechazo duro de `~/.awm` |
| `## Paso 2 — Elicitación` | R2.4/R2.5: entrevista jerárquica `SG-#`→`OP-#`, criterio de parada "puede ser una skill invocable" |
| `## Paso 3 — Generación` | R3.1/R3.2/R3.3: loop dirigido con aprobación por fase; `appliesWhen`/`terminatesTo` derivados; sin bloque `orchestrator` si `entry_point: false` |
| `## El overlay de fase` | R2.8: las cinco obligaciones (disparador acotado, markers, terminación nombrada, herencia de gates, lectura de modo) + `REQUIRED SUB-SKILL: writing-skills` para todo lo demás |
| `## Paso 4 — Verificación` | R3.4/R3.5/R3.6: colisión de nombres; `awm context orchestrators --verify <name>`; promoción a `active` solo con exit 0 |
| `## Modificar un proceso activo` | R4.1: `awm process show --json` → editar → regenerar |
| `## Degradación` | R7.1: sin el comando de verificación, informa qué CLI hace falta y sigue; nunca promueve sin verificar; nunca bloquea |
| `## Red Flags` | Anti-patrones |
| `## Integration` | Tabla de skills relacionados |

**Restricción de vocabulario, no negociable:** `scripts/validate-portability.mjs:53-65` rechaza el archivo si contiene `` `Task` tool ``, `` `Read` tool `` (y el resto de la lista), `TodoWrite`, `AskUserQuestion`, `Task("` o `superpowers:`. Escribir en términos agnósticos: "el mecanismo nativo de la plataforma para cargar un skill", nunca el nombre de una herramienta concreta.

- [x] **Step 3: Correr el contrato hasta verde**

Run: `cd /home/user/awm-baseline-registry && node tests/r11-process-lifecycle-contract.test.mjs`
Expected: los 13 tests que leen `SKILL.md` en verde. Iterar el `SKILL.md` hasta lograrlo; el test es la especificación.

*(El test 14 del archivo, el de empaque, sigue en rojo hasta la Task 6 — es esperado: lee `bundles/process/bundle.json`, que todavía no existe.)*

- [x] **Step 4: Correr el validador de portabilidad**

Run: `cd /home/user/awm-baseline-registry && node scripts/validate-portability.mjs`
Expected: FAIL — `skills: expected exactly 38 immediate skill directories, found 39`. Es el gate de la Task 6, no un defecto de este paso.

- [x] **Step 5: Commit**

```bash
cd /home/user/awm-baseline-registry
git add skills/process-lifecycle/SKILL.md
git commit -m "feat(process-lifecycle): skill de elicitacion, generacion y verificacion de procesos"
```

---

## Task 6: Empaque — bundle `process`, `authoring` a baseline

_Requirements: R2.7, R7.2_

**Files:**
- Create: `bundles/process/bundle.json`
- Modify: `bundles/authoring/bundle.json`, `catalog.json`, `README.md:41-48`, `scripts/validate-portability.mjs:528-530`

- [x] **Step 1: Crear el bundle**

```json
{
  "name": "process",
  "version": "1.0.0",
  "description": "Process lifecycle: elicit, generate, verify and modify an AWM process and its orchestrator.",
  "scope": "baseline",
  "dependsOn": ["authoring"],
  "skills": ["process-lifecycle"],
  "workflows": [],
  "agents": []
}
```

- [x] **Step 2: Mover `authoring` a baseline**

`bundles/authoring/bundle.json` completo tras el cambio (bump de `1.1.1` a `1.2.0` — es un cambio aditivo de alcance, minor por `CONSTITUTION.md`):

```json
{
  "name": "authoring",
  "version": "1.2.0",
  "description": "Harness authoring and skill creation.",
  "scope": "baseline",
  "dependsOn": ["dev"],
  "skills": ["writing-skills"],
  "workflows": [],
  "agents": []
}
```

La nota *"enable only in the agentic-workflow repo"* se retira porque quedó stale: desde R1+R2 la autoría de registries es actividad de usuario final, y `process` declara `dependsOn: ["authoring"]` — si `authoring` siguiera en `project`, `baseline` entregaría un skill cuyo `REQUIRED SUB-SKILL` no está instalado.

- [x] **Step 3: Actualizar el catálogo**

`catalog.json` completo tras el cambio (respetar el alineado por columnas existente):

```json
{
  "version": 1,
  "bundles": [
    { "name": "dev",       "source": "./bundles/dev",       "version": "3.5.0", "scope": "baseline" },
    { "name": "product",   "source": "./bundles/product",   "version": "1.3.1", "scope": "baseline" },
    { "name": "frontend",  "source": "./bundles/frontend",  "version": "2.1.1", "scope": "project" },
    { "name": "authoring", "source": "./bundles/authoring", "version": "1.2.0", "scope": "baseline" },
    { "name": "process",   "source": "./bundles/process",   "version": "1.0.0", "scope": "baseline" }
  ]
}
```

- [x] **Step 4: Subir el conteo de skills**

En `scripts/validate-portability.mjs`, líneas 528-530:

```javascript
  if (directories.length !== 39) {
    errors.push(`skills: expected exactly 39 immediate skill directories, found ${directories.length}`);
  }
```

- [x] **Step 5: Actualizar la tabla del README**

En `README.md`, la tabla de bundles (líneas 41-48) pasa a:

```markdown
| Bundle | Scope | What it adds |
|---|---|---|
| `dev` | baseline | The engineering spine: spec-driven development, quality gates, sensors, advisory skills |
| `product` | baseline | The business layer: discovery, briefs, architecture assessment and extraction, readiness gate |
| `process` | baseline | The process lifecycle: elicit, generate, verify and modify a process and its orchestrator |
| `authoring` | baseline | Harness authoring: writing and verifying skills |
| `frontend` | project | Frontend craft: design intake, component implementation, visual fidelity gate |
```

- [x] **Step 6: Correr los gates**

```bash
cd /home/user/awm-baseline-registry
node scripts/validate-portability.mjs
node tests/validate-portability.test.mjs
node tests/r11-process-lifecycle-contract.test.mjs
```
Expected: los tres en verde. El primero imprime `portable: 39 skills validated`.

- [x] **Step 7: Commit**

```bash
git add bundles/process/bundle.json bundles/authoring/bundle.json catalog.json README.md scripts/validate-portability.mjs
git commit -m "feat(bundles): bundle process y authoring a baseline"
```

---

## Task 7: Cablear el test en CI y cierre

_Requirements: R7.2, R7.3_

**Files:**
- Modify: `.github/workflows/validate.yml:26-43`, `.github/workflows/auto-tag.yml:52-71`

Un test que no está en las dos listas **no corre** — se enumeran a mano, no hay descubrimiento automático.

- [x] **Step 1: Agregar el test a `validate.yml`**

Inmediatamente después de la línea `- run: node tests/r10-documentation-phase-contract.test.mjs`:

```yaml
      - run: node tests/r11-process-lifecycle-contract.test.mjs
```

- [x] **Step 2: Agregar el test a `auto-tag.yml`**

En el bloque `Verify registry before tagging`, inmediatamente después de `node tests/r10-documentation-phase-contract.test.mjs`:

```yaml
          node tests/r11-process-lifecycle-contract.test.mjs
```

- [x] **Step 3: Correr la lista completa de validación local**

```bash
cd /home/user/awm-baseline-registry
node scripts/validate-portability.mjs
node tests/validate-portability.test.mjs
node tests/r3-release-metadata.test.mjs
node tests/cycle-evidence-capture-contract.test.mjs
node tests/r3-retro-contract.test.mjs
node tests/r8-sensor-gate-contract.test.mjs
node tests/r9-declared-orchestrators-contract.test.mjs
node tests/r10-documentation-phase-contract.test.mjs
node tests/r11-process-lifecycle-contract.test.mjs
node tests/release-skill-version-gate.test.mjs
node tests/codex-session-start.test.mjs
node tests/session-start.test.mjs
```
Expected: todos en verde.

- [x] **Step 4: Correr el gate de version bumps**

```bash
cd /home/user/awm-baseline-registry && ./scripts/check-skill-version-bumps.sh origin/main
```
Expected: `OK: every edited SKILL.md and affected bundle/catalog version advanced.`

**Este paso no es opcional ni un adelanto del gate — es el gate.** `AGENTS.md` de ese repo lo declara obligatorio antes de reportar una task terminada, tras haber reincidido dos veces.

- [x] **Step 5: Suite del CLI completa**

```bash
cd /home/user/agentic-workflow/cli && npx jest --runInBand
cd /home/user/agentic-workflow && node cli/dist/src/index.js sensors run
```
Expected: 0 fallos, `"overall": "pass"`.

- [x] **Step 6: Commit**

```bash
cd /home/user/awm-baseline-registry
git add .github/workflows/validate.yml .github/workflows/auto-tag.yml
git commit -m "ci: cablear el contrato de process-lifecycle en validate y auto-tag"
```

---

## Criterios de aceptación de R1b

- [ ] **CA-1.1** *(heredado, nunca ejecutado)* — con un registry de prueba instalado, iniciar una sesión **real** y comprobar que el orquestador aparece entre los considerados.
- [ ] **CA-4.1** *(heredado, nunca ejecutado)* — una persona ajena al CLI sigue el método y produce un registry instalable. **Verificable con persona real, no simulación.**
- [ ] **CA-1.4 — demo de aceptación** — declarar el orquestador del proceso personal en [`Kodria/awm-personal-registry`](https://github.com/Kodria/awm-personal-registry), hoy 3 skills sueltas sin `awm-registry.json` ni declaración. Es el consumidor que motivó el proyecto entero.

CA-1.1 y CA-4.1 requieren una persona: se ejecutan **después** del merge, no dentro del ciclo. CA-1.4 es ejecutable por un agente contra el registry personal y puede correrse apenas `process` esté instalado.

## Traceability matrix

| Req | Task(s) | Test(s) |
|---|---|---|
| R2.1 | T4, T5 | `R2.1: pregunta primero en que registry vive el proceso` |
| R2.2 | T4, T5 | `R2.2 y R2.3: escribe en el clon del registry y rechaza ~/.awm` |
| R2.3 | T4, T5 | `R2.2 y R2.3: escribe en el clon del registry y rechaza ~/.awm` |
| R2.4 | T4, T5 | `R2.4 y R2.5: elicitacion HTA con criterio de parada` |
| R2.5 | T4, T5 | `R2.4 y R2.5: elicitacion HTA con criterio de parada` |
| R2.6 | T4, T5 | `R2.6: un draft existente se retoma leyendolo` |
| R2.7 | T4, T5, T6 | `R2.7: delega el craft de escritura a writing-skills`; `empaque: el bundle process depende de authoring` |
| R2.8 | T4, T5 | `R2.8: aporta el overlay de obligaciones de fase` |
| R3.1 | T4, T5 | `R3.1: genera en loop dirigido con aprobacion por fase` |
| R3.2 | T4, T5 | `R3.2 y R3.3: la declaracion se deriva del modelo, no se edita aparte` |
| R3.3 | T4, T5 | `R3.2 y R3.3: la declaracion se deriva del modelo, no se edita aparte` |
| R3.4 | T4, T5 | `R3.4: verifica colision de nombres antes de escribir` |
| R3.5 | T2, T3, T4, T5 | `--verify sale 0/2`; `--verify cierra el ciclo de verificacion con exit code` (e2e); `R3.5 y R3.6: el ciclo llega a composicion real` |
| R3.6 | T4, T5 | `R3.5 y R3.6: ... y recien ahi promueve` |
| R4.1 | T4, T5 | `R4.1: un modelo active se puede cargar, editar y regenerar` |
| R5.2 | T1 | `devuelve los valores tal como entran al payload`; `lo que renderiza el payload sale de esta misma funcion` |
| R5.4 | T1, T2 | `neutraliza saltos de linea y markdown estructural`; `elimina ESC y demas bytes de control C0`; `sanea bytes de control antes de escribir a la terminal` |
| R7.1 | T2, T4, T5 | `emite los diagnosticos sin dejar de listar los sanos`; `R7.1: sin el comando de verificacion degrada, no bloquea` |
| R7.2 | T2, T6, T7 | `sin declarados sale 0 y lo dice, no falla`; `node scripts/validate-portability.mjs` en verde |
| R7.3 | T7 | la suite del CLI (incluida `awm context orchestrators`) corre en las tres plataformas en `ci.yml` |
| R7.4 | T3 | `seedRegistry()` usa tmpdir con `HOME`/`AWM_HOME` sobreescritos; ningún test toca el `~/.awm` real |

**Nota de precisión de la matriz (corregida en post-implementation-qa).** `R7.3` es el único requisito cuya verificación **no** aporta este plan: para el lado CLI, la equivalencia entre plataformas la prueba la matriz ya existente `ci.yml` (ubuntu/macos/windows), no un test nuevo. Para el lado registry, la afirmación original de esta nota — que `sensor-pack-certification.yml` corre la matriz de tres plataformas sobre el registry, cubriendo así `tests/r11-process-lifecycle-contract.test.mjs` y `scripts/validate-portability.mjs` — era **inexacta**: ese workflow corre una matriz de tres plataformas, pero solo sobre los tests de sensor-pack (ESLint/Python/Semgrep/ShellCheck), no sobre los tests Node de este plan. `validate.yml`/`auto-tag.yml` corren esos tests únicamente en `ubuntu-latest`. Riesgo residual aceptado: son scripts Node puros (`fs`/`JSON.parse`/regex, sin invocar herramientas de shell ni asumir separadores de ruta), con probabilidad baja de divergencia entre plataformas — pero **no verificada**, a diferencia de la suite del CLI. Se declara el hueco explícitamente en vez de repetir la cita errónea.

`R3.1` sí tiene aserción propia desde el self-review de este plan: sin ella quedaba como *forward gap* — task sin test, que el Analyze Gate rechaza.
