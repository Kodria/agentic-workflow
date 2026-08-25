# R3a Context Kernel Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar un CLI que detecte la declaración `projectContextSchema: 1`, valide Context Kernel v1 y distinga proyecto legacy, migración válida y migración parcial sin cambiar todavía ningún proyecto cliente.

**Architecture:** El manifest del registry activa la capacidad; un único módulo TypeScript inspecciona el índice y sus archivos con validación fail-closed, y `preflight` sólo traduce ese estado a pass, advisory o failure. La ausencia de declaración conserva byte por byte la lista de checks anterior; la ausencia de kernel bajo un registry compatible produce una advertencia no bloqueante y mantiene el camino seguro de contexto completo.

**Tech Stack:** Node.js 22, TypeScript 5.9, Jest 30, Commander, `picocolors`, JSON y Markdown. No se agrega ninguna dependencia.

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

## Fuente y frontera de la entrega

- Diseño aprobado: `docs/plans/2026-08-25-r3-context-kernel-selective-retrieval-design.md` en `Kodria/agentic-workflow@c81aab088d`.
- Issue rector y ledger: `Kodria/agentic-workflow#126`.
- Base congelada: `0e3ce7ea331647e007aebd369976aa3a12a22652` (`v9.2.1`).
- R3a no modifica `AGENTS.md`, `CONSTITUTION.md`, `CLAUDE.md` ni crea cards. Tampoco activa avisos si ningún registry declara el schema.
- R3b no puede comenzar hasta que el paquete de R3a esté publicado y su commit npm coincida con el merge de esta rama.
- Remediación emergente de gate (commit `7f7e84c`): el registry baseline v2 certifica `dependency-cruiser` 16.10.4 y el proyecto retenía 17.4.3. Se sustituyó ese único pin directo y su lockfile por el pin certificado, junto con la evidencia de `.awm/sensors.json`; no se agregó una dependencia, capacidad de medición ni API de modelo. El cambio queda incluido para que los gates sean reproducibles en cualquier worktree.

## Requirements

- **R3.1** — Una declaración activa `projectContextSchema: 1` agrega el check `context-kernel`; sin declaración, el reporte pre-R3 no cambia.
- **R3.2** — Un proyecto sin metadata R3 muestra advisory persistente y remedy, conserva `ready` si los checks bloqueantes pasan e identifica `legacy full context`.
- **R3.3** — Cualquier artefacto parcial o inválido falla, deja el reporte `degraded` y bloquea el handoff desatendido.
- **R3.12** — Un proyecto legacy conserva contexto completo y todos los gates existentes sin exigir migración.
- **R3.15** — Inspección, validación y medición no agregan invocaciones de modelo, dependencias ni almacenes de prompts, cuerpos fuente, secretos o respuestas.
- **R3.16** — Los checkpoints enlazan bytes, resultados, commits, release y PR desde issue #126; uso del proveedor no observable se registra como `unobservable` y no se presenta reducción estructural como ahorro facturado.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/context-kernel/types.ts` | Contrato cerrado de schema 1 y estados `legacy`, `valid`, `invalid`. |
| `cli/src/core/context-kernel/inspect.ts` | Parser único, cardinalidad de markers/anchors, contención realpath y clasificación. |
| `cli/src/core/registries.ts` | Parsear la declaración opcional y resolver el primer registry activo que la declara. |
| `cli/src/commands/preflight/checks.ts` | Insertar el check condicional y reducir advisory sin volverlo failure. |
| `cli/src/commands/preflight/index.ts` | Render amarillo `⚠`; JSON y exit code siguen gobernados por `status`. |
| `cli/tests/core/context-kernel/inspect.test.ts` | Tabla de schema, marker, anchor, path, symlink, cardinalidad y estados. |
| `cli/tests/core/registry-manifest.test.ts` | Declaración válida, ausente e inválida. |
| `cli/tests/commands/preflight/preflight.test.ts` | Cuatro estados integrados y renderer/exit code. |
| `docs/cli-reference.md` | Contrato visible del nuevo row. |
| `docs/runbook.md` | Remedio operativo y garantía de que `awm update` no migra archivos. |
| Este plan | Ledger R2 T4 y R3 T0/T1 con evidencia exacta. |

## Estado congelado y definición de medición

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `AGENTS.md` | 32,778 | `967d70c83cdbb69af36f1dcd313ac1b83f32ec5a2bff203706ada284597131d4` |
| `CONSTITUTION.md` | 30,164 | `db8751796453223e27357bf0593d84e83c0bc00d2700d05bff531e9c030723b7` |
| `CLAUDE.md` | 4,539 | `444f00ac58d96acf8d7cdbff909388279a1a46238ad83ba8fd2b63af6d5e6d22` |
| **R3 T0 fijo** | **67,481** | suma estructural; no equivale a tokens facturados |

Provider tokens/cache/cost: `unobservable`. Owner quota: sólo se agrega si el owner entrega el dato; no se deriva de bytes.

### Task 1: Declaración de registry y validador único Context Kernel v1

_Requirements: R3.1, R3.3, R3.15_

**Files:**
- Create: `cli/src/core/context-kernel/types.ts`
- Create: `cli/src/core/context-kernel/inspect.ts`
- Modify: `cli/src/core/registries.ts`
- Test: `cli/tests/core/context-kernel/inspect.test.ts`
- Test: `cli/tests/core/registry-manifest.test.ts`

- [x] **Step 1: Aislar el entorno de registries de los tests**

En ambos archivos de test, crear un `AWM_HOME` temporal en `beforeEach`, restaurarlo en `afterEach` y cargar los módulos después de fijar el entorno. Esto impide que el baseline global del operador active R3 accidentalmente.

```ts
let root: string;
let previousAwmHome: string | undefined;

beforeEach(() => {
    jest.resetModules();
    previousAwmHome = process.env.AWM_HOME;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-context-kernel-'));
    process.env.AWM_HOME = path.join(root, 'awm-home');
    fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
});

afterEach(() => {
    if (previousAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = previousAwmHome;
    fs.rmSync(root, { recursive: true, force: true });
});
```

- [x] **Step 2: Escribir primero los tests rojos del manifest**

```ts
it('reads projectContextSchema 1 without changing legacy manifests', () => { // verifies R3.1
    writeManifest({ minCliVersion: '9.2.1', projectContextSchema: 1 });
    expect(readRegistryManifest(contentRoot())).toEqual({
        overrides: new Set(), minCliVersion: '9.2.1', projectContextSchema: 1,
    });
    writeManifest({ minCliVersion: '9.2.1' });
    expect(readRegistryManifest(contentRoot()).projectContextSchema).toBeUndefined();
});

it.each([0, 2, -1, 1.5, '1', null])('rejects unsupported schema %p', value => { // verifies R3.3
    writeManifest({ projectContextSchema: value });
    expect(() => readRegistryManifest(contentRoot())).toThrow(/projectContextSchema.*exactly 1/);
});
```

Run: `cd cli && npx jest tests/core/registry-manifest.test.ts --runInBand`

Expected: FAIL porque `RegistryManifest` aún no expone ni valida el campo.

- [x] **Step 3: Extender el parser existente, sin crear un segundo lector**

```ts
export interface RegistryManifest {
    overrides: Set<string>;
    minCliVersion?: string;
    projectContextSchema?: 1;
}

const rawSchema = (raw as Record<string, unknown>)?.projectContextSchema;
let projectContextSchema: 1 | undefined;
if (rawSchema !== undefined) {
    if (rawSchema !== 1) {
        throw new Error(`Invalid registry manifest at ${file}: "projectContextSchema" must be exactly 1, got ${JSON.stringify(rawSchema)}`);
    }
    projectContextSchema = 1;
}
return { overrides: new Set(overrides as string[]), minCliVersion, projectContextSchema };
```

Agregar un resolver que recorra `listRegistries()` en su orden vigente, ignore roots sin contenido y devuelva la primera declaración válida como `{ registry, schema: 1 }`. Los errores de manifest se devuelven como diagnóstico para que preflight pueda fallar ruidosamente; no se silencian.

- [x] **Step 4: Escribir los tests rojos de inspección**

La fábrica `writeValidKernel(root)` crea exactamente dos kernel files, un card y este índice:

```json
{
  "schema": 1,
  "kernelFiles": ["AGENTS.md", "CONSTITUTION.md"],
  "maxFixedBytes": 33740,
  "entries": [
    {"id":"CTX-PROCESS-001","tier":"kernel","path":"CONSTITUTION.md","anchor":"awm-context:CTX-PROCESS-001","when":"always"},
    {"id":"CTX-RELEASE-001","tier":"selective","path":"docs/awm/context/releases.md","anchor":"awm-context:CTX-RELEASE-001","when":"release automation"}
  ]
}
```

```ts
it('classifies no R3 artifacts as legacy', () => {                         // verifies R3.1
    expect(inspectContextKernel(root)).toEqual({ state: 'legacy' });
});

it('accepts the canonical fixture', () => {                                // verifies R3.3
    writeValidKernel(root);
    expect(inspectContextKernel(root)).toEqual(expect.objectContaining({ state: 'valid', schema: 1 }));
});

it.each([
    ['unknown top-level field', (x: any) => { x.extra = true; }],
    ['future schema', (x: any) => { x.schema = 2; }],
    ['duplicate id', (x: any) => { x.entries[1].id = x.entries[0].id; }],
    ['duplicate anchor', (x: any) => { x.entries[1].anchor = x.entries[0].anchor; }],
    ['absolute path', (x: any) => { x.entries[1].path = '/tmp/outside.md'; }],
    ['traversal', (x: any) => { x.entries[1].path = '../outside.md'; }],
    ['empty when', (x: any) => { x.entries[1].when = ''; }],
])('rejects %s', (_name, mutate) => {                                      // verifies R3.3
    const index = writeValidKernel(root); mutate(index); writeIndex(root, index);
    expect(inspectContextKernel(root)).toEqual(expect.objectContaining({ state: 'invalid' }));
});

it('rejects an external symlink and a dangling card', () => {               // verifies R3.3
    const index = writeValidKernel(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-outside-'));
    fs.rmSync(path.join(root, index.entries[1].path));
    fs.symlinkSync(path.join(outside, 'card.md'), path.join(root, index.entries[1].path));
    expect(inspectContextKernel(root).state).toBe('invalid');
    fs.rmSync(outside, { recursive: true, force: true });
});

it.each(['start marker missing', 'end marker duplicated', 'anchor outside region', 'anchor duplicated'])
('rejects %s', mutation => {                                                // verifies R3.3
    writeValidKernel(root); mutateFixture(root, mutation);
    expect(inspectContextKernel(root)).toEqual(expect.objectContaining({ state: 'invalid' }));
});
```

Run: `cd cli && npx jest tests/core/context-kernel/inspect.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [x] **Step 5: Implementar tipos cerrados y clasificación fail-closed**

```ts
export type ContextTier = 'kernel' | 'selective';
export type ContextEntryV1 = { id: string; tier: ContextTier; path: string; anchor: string; when: string };
export type ContextIndexV1 = { schema: 1; kernelFiles: string[]; maxFixedBytes: number; entries: ContextEntryV1[] };
export type ContextKernelInspection =
    | { state: 'legacy' }
    | { state: 'valid'; schema: 1; index: ContextIndexV1; fixedBytes: number }
    | { state: 'invalid'; detail: string; remedy: string };
```

`inspectContextKernel(cwd)` debe aplicar, en este orden, sin coerción:

1. Resolver `cwd` con `realpath`; si no es directorio, lanzar por input público inválido.
2. Si no existe el índice y no aparece ningún marker R3 en los root context files, devolver `legacy`.
3. Si aparece cualquier marker sin índice, devolver `invalid`.
4. Parsear JSON, exigir exactamente `schema`, `kernelFiles`, `maxFixedBytes`, `entries`, y exactamente los cinco campos de cada entry.
5. Exigir schema entero `1`, arrays no vacíos/únicos, límite entero positivo, IDs `^CTX-[A-Z0-9]+(?:-[A-Z0-9]+)*$` de máximo 80 bytes, y `when`/`anchor` no vacíos de máximo 500 bytes.
6. Resolver cada path desde el root; rechazar absolutos, separadores no normalizados, `.`/`..`, inexistentes, destinos no regulares y `realpath` fuera del root.
7. Exigir una pareja exacta `<!-- AWM:CONTEXT-KERNEL:START v1 -->` / `<!-- AWM:CONTEXT-KERNEL:END v1 -->` por kernel file, en orden.
8. Exigir cada anchor exactamente una vez. Los entries `kernel` sólo apuntan a `kernelFiles` y su anchor queda dentro de markers; los `selective` quedan fuera de regiones protegidas.
9. Sumar bytes UTF-8 de `AGENTS.md`, `CONSTITUTION.md` y `CLAUDE.md` existentes, y rechazar si superan `maxFixedBytes`.
10. Toda falla de artefacto retorna `invalid` con path y remedy estable; nunca retorna `undefined`.

- [x] **Step 6: Verificar el módulo y registrar un commit cohesivo**

Run:

```bash
cd cli
npx jest tests/core/registry-manifest.test.ts tests/core/context-kernel/inspect.test.ts --runInBand
npx tsc --noEmit
```

Expected: suites PASS y TypeScript sin errores.

```bash
git add cli/src/core/context-kernel cli/src/core/registries.ts cli/tests/core/context-kernel cli/tests/core/registry-manifest.test.ts
git commit -m "feat(preflight): validate context kernel v1"
```

### Task 2: Integrar pass, advisory y failure en preflight

_Requirements: R3.1, R3.2, R3.3, R3.12_

**Files:**
- Modify: `cli/src/commands/preflight/checks.ts`
- Modify: `cli/src/commands/preflight/index.ts`
- Modify: `cli/tests/commands/preflight/preflight.test.ts`

- [x] **Step 1: Escribir cuatro escenarios integrados antes del código**

```ts
it('does not add a row when no registry declares the schema', async () => {  // verifies R3.1, R3.12
    installRegistry({ minCliVersion: '9.2.1' });
    const report = await preflight(project);
    expect(report.checks.map(c => c.id)).not.toContain('context-kernel');
});

it('keeps legacy ready but renders a persistent warning and remedy', async () => { // verifies R3.2, R3.12
    installRegistry({ projectContextSchema: 1 });
    const report = await preflight(readyLegacyProject());
    expect(report.status).toBe('ready');
    expect(report.checks).toContainEqual(expect.objectContaining({
        id: 'context-kernel', ok: false, advisory: true,
        detail: expect.stringMatching(/legacy full context/),
        remedy: expect.stringMatching(/project-context-init/),
    }));
    expect(formatReport(report)).toMatch(/⚠.*context-kernel.*legacy full context/s);
    expect(exitCodeFor(report)).toBe(0);
});

it('passes a valid kernel', async () => {                                    // verifies R3.1
    installRegistry({ projectContextSchema: 1 }); writeValidKernel(readyProject());
    expect(await preflight(readyProject())).toEqual(expect.objectContaining({ status: 'ready' }));
});

it('degrades partial or invalid migration', async () => {                    // verifies R3.3
    installRegistry({ projectContextSchema: 1 }); writePartialKernel(readyProject());
    const report = await preflight(readyProject());
    expect(report.status).toBe('degraded');
    expect(exitCodeFor(report)).toBe(1);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'context-kernel', advisory: false, ok: false }));
});
```

También fijar que `JSON.stringify(report)` conserva `status`, `checks`, `ok`, `detail`, `remedy` y sólo agrega `advisory` al nuevo row; ningún consumidor debe inferir status desde el color.

Run: `cd cli && npx jest tests/commands/preflight/preflight.test.ts --runInBand`

Expected: FAIL por id/severity desconocidos.

- [x] **Step 2: Implementar el reducer sin convertir advisory en éxito falso**

```ts
export type PreflightCheck = {
    id: 'context' | 'context-kernel' | 'manifest' | 'tools' | 'pack' | 'host' | 'sensors-baseline' | 'sensors-execution';
    ok: boolean;
    advisory?: boolean;
    detail: string;
    remedy?: string;
};

const blockingFailure = (check: PreflightCheck): boolean => !check.ok && check.advisory !== true;
const status = !manifestExists ? 'not_configured'
    : checks.some(blockingFailure) ? 'degraded'
    : 'ready';
```

El nuevo `checkContextKernel(cwd)` sólo se agrega cuando el resolver del registry devuelve schema 1:

- `legacy` → `{ ok:false, advisory:true, detail:'legacy full context — Context Kernel v1 migration available', remedy:'run project-context-init and review the generated rule trace; awm update never rewrites project files' }`.
- `valid` → pass con schema y bytes fijos.
- `invalid` o manifest inválido → failure bloqueante con su diagnóstico y el camino seguro full-context.

El renderer evalúa primero `advisory === true`, usa `pc.yellow('⚠')`, y luego conserva los branches `✔`/`✘` existentes.

- [x] **Step 3: Ejecutar regresión enfocada y suite del comando**

Run:

```bash
cd cli
npx jest tests/commands/preflight/preflight.test.ts tests/core/context-kernel/inspect.test.ts tests/core/registry-manifest.test.ts --runInBand
npx tsc --noEmit
```

Expected: PASS; un advisory legacy produce exit 0, una migración parcial exit 1.

- [x] **Step 4: Commit**

```bash
git add cli/src/commands/preflight cli/tests/commands/preflight/preflight.test.ts
git commit -m "feat(preflight): surface context kernel migration state"
```

### Task 3: Documentación, no-dependencias y prueba de mutación

_Requirements: R3.2, R3.3, R3.12, R3.15_

**Files:**
- Modify: `docs/cli-reference.md`
- Modify: `docs/runbook.md`
- Test: `cli/tests/core/context-kernel/inspect.test.ts`
- Test: `cli/tests/commands/preflight/preflight.test.ts`

- [x] **Step 1: Documentar el contrato operativo exacto**

Agregar una tabla de tres filas: valid/pass/selective eligible, absent/advisory/legacy full context, partial-invalid/failure/degraded. Debajo, escribir literalmente estas garantías:

```markdown
`awm update` and `awm preflight` never rewrite project-owned `AGENTS.md`,
`CONSTITUTION.md`, `CLAUDE.md`, `.awm/context/index.json`, or context cards.
Migration is explicit and reviewed through `project-context-init`. A legacy advisory
preserves the complete-context quality path; a partial migration is blocking.
```

- [x] **Step 2: Probar que no apareció infraestructura ni dependencia de medición**

Run:

```bash
node -e "const {execFileSync}=require('node:child_process'); const now=require('./cli/package.json'); const base=JSON.parse(execFileSync('git',['show','origin/main:cli/package.json'],{encoding:'utf8'})); const clean=x=>Object.fromEntries(Object.entries(x||{}).filter(([name])=>name!=='dependency-cruiser')); if(JSON.stringify(clean(now.devDependencies))!==JSON.stringify(clean(base.devDependencies))) process.exit(1)"
rg -n "openai|anthropic|embedding|vector|prompt store|response store" cli/src/core/context-kernel cli/src/commands/preflight
```

Expected: el primer comando exit 0: salvo el pin directo existente `dependency-cruiser`, no cambia ninguna dependencia directa. El lockfile sólo puede diferir transitivamente por esa sustitución certificada documentada arriba. El segundo comando exit 1 sin coincidencias.

- [x] **Step 3: Ejecutar mutaciones reales y restaurarlas**

Mutación A: cambiar temporalmente el branch que rechaza `schema !== 1` para aceptar `2`; el test `future schema` debe FAIL con exit distinto de cero. Restaurar el archivo.

Mutación B: cambiar temporalmente `blockingFailure` para considerar advisory como blocking; el test legacy-ready debe FAIL. Restaurar el archivo.

Run después de restaurar:

```bash
cd cli
npx jest tests/core/context-kernel/inspect.test.ts tests/commands/preflight/preflight.test.ts --runInBand
```

Expected: ambas mutaciones demostraron rojo y la restauración queda PASS. Registrar comandos, mensajes y commit probado en el ledger de este plan.

- [x] **Step 4: Commit**

```bash
git add docs/cli-reference.md docs/runbook.md cli/tests/core/context-kernel/inspect.test.ts cli/tests/commands/preflight/preflight.test.ts
git commit -m "docs(preflight): explain context kernel migration states"
```

### Task 4: Certificar R3a y preparar el handoff post-merge

_Requirements: R3.3, R3.12, R3.15, R3.16_

**Files:**
- Modify: `docs/plans/2026-08-25-r3a-context-kernel-preflight-plan.md`
- Verify: `.github/workflows/ci.yml`
- Verify: `.github/workflows/release.yml`

- [x] **Step 1: Completar el ledger sin inventar telemetría**

Agregar bajo `## Release Evidence` una tabla con R2 T4, R3 T0 y R3 T1. Para cada fila registrar: commit, bytes fijos, dispatches reales, retrievals/fallbacks naturales, tests/sensors, defectos y correcciones, provider usage (`unobservable` salvo dato nativo), cuota owner sólo si fue entregada, PR y release. R2 T4 corresponde a esta primera corrida normal posterior a baseline v3.8.0; no se ejecuta benchmark sintético.

Verificación:

```bash
rg -n '^\| R2 T4 |^\| R3 T0 |^\| R3 T1 |unobservable|67,481|issue #126' docs/plans/2026-08-25-r3a-context-kernel-preflight-plan.md
```

Expected: las tres filas y la semántica honesta están presentes. Esto verifica R3.16.

- [x] **Step 2: Ejecutar gates locales completos una sola vez**

```bash
cd cli
npm run build
npx tsc --noEmit
npx jest --runInBand
cd ..
awm sensors run
git diff --check
```

Expected: build/typecheck/tests/sensors PASS y diff limpio. No repetir la suite si el commit no cambia.

- [x] **Step 3: Verificar que cada requirement tiene prueba específica**

```bash
rg -n 'verifies R3\.(1|2|3|12|15|16)' cli/tests docs/plans/2026-08-25-r3a-context-kernel-preflight-plan.md
```

Expected: aparece cada uno de los seis IDs; las aserciones correspondientes coinciden con la matriz inferior.

- [x] **Step 4: Commit de evidencia y handoff de branch**

```bash
git add docs/plans/2026-08-25-r3a-context-kernel-preflight-plan.md
git commit -m "docs(performance): record r3a evidence"
git status --short
```

Expected: working tree limpio.

El cierre normal usa `post-implementation-qa` → `post-implementation-docs` → `harness-retro` → `finishing-a-development-branch`. El PR debe titularse `feat(preflight): add context kernel v1 awareness` para que el release automático elija minor; nunca ejecutar `npm publish` manualmente.

- [ ] **Step 5: Handoff post-merge para aceptación de release**

Este paso no es requisito para que R3a quede lista para PR. Sólo inicia después del
merge autorizado; entonces el responsable de release ejecuta:

```bash
gh run list --repo Kodria/agentic-workflow --workflow ci.yml --limit 3
gh run list --repo Kodria/agentic-workflow --workflow release.yml --limit 3
R3A_MERGE_SHA="$(gh pr list --repo Kodria/agentic-workflow --head feat/issue-126-r3a-context-kernel-preflight --state merged --json mergeCommit --jq '.[0].mergeCommit.oid')"
R3A_NPM_SHA="$(npm view agentic-workflow-manager gitHead)"
test "$R3A_MERGE_SHA" = "$R3A_NPM_SHA"
npm view agentic-workflow-manager version
```

Expected: CI y release success, SHAs idénticos y versión semver publicada. Publicar un comentario en issue #126 con PR, merge SHA, versión npm, T0/T1, gates y `R3b unblocked by published CLI`; verificarlo con `gh issue view 126 --repo Kodria/agentic-workflow --comments`. Antes de merge esos campos permanecen explícitamente `pending`; no se reclama CI, publicación npm ni desbloqueo de R3b.

## Traceability Matrix

| Req | Task(s) | Verificación específica |
|---|---|---|
| R3.1 | T1, T2 | manifest válido/ausente; row presente/ausente; fixture válido |
| R3.2 | T2, T3 | `legacy ready`, glyph `⚠`, remedy y documentación de tres estados |
| R3.3 | T1, T2, T3, T4 | tabla de inputs inválidos, symlink/marker/anchor, partial degraded, mutation-red, suite completa |
| R3.12 | T2, T3, T4 | ausencia de declaración y legacy conservan camino completo; regresión completa |
| R3.15 | T1, T3, T4 | búsqueda sin APIs/stores, mutaciones y gates locales; el único diff de dependencia es el pin certificado de `dependency-cruiser` para el sensor existente, no una capacidad de modelo o store |
| R3.16 | T4 | filas R2 T4/T0/T1; CI/npm/comentario quedan como aceptación post-merge verificable |

Forward gaps: ninguno. Backward gaps: ninguno; cada task y test está anclado arriba. No hay UI ni tracks paralelos: los tres módulos comparten tipos, fixtures y estado de preflight, por lo que el plan es serial.

## Release Evidence

Esta sección registra sólo evidencia observada. Los bytes estructurales no equivalen a tokens facturados y provider usage/cost sigue siendo `unobservable`; no se formula ninguna afirmación de ahorro económico.

| Checkpoint | Commit / alcance observado | Bytes fijos | Dispatches / retrievals | Tests, sensores, defectos y correcciones | Provider usage / cuota owner | PR / release |
|---|---|---:|---|---|---|---|
| R2 T4 | Ciclo normal posterior a baseline R2 `v3.8.0`; evidencia previa: agentic-workflow PR #128, merge `9a2dbfe` | 67,481 estructurales observados | Sin benchmark sintético; la telemetría de dispatch/retrieval del proveedor no fue capturada | Evidencia previa registró revisión independiente, regresiones focales, build, suite CLI y sensores pass | provider usage/cost: `unobservable`; cuota: no observada en ese checkpoint | PR #128 merged; release de R2 `v3.8.0` ya publicada |
| R3 T0 | Snapshot congelado antes de la implementación R3a, plan `1c624c7` | 67,481 estructurales | No hubo llamada de medición ni retrieval artificial; no hay contador de dispatches del proveedor | Inventario/hash congelados en este plan; sin defecto ni corrección aplicable al snapshot | provider usage/cost: `unobservable`; cuota: no observada | PR/release: `pending` antes de creación/merge R3a |
| R3 T1 | Ejecución real R3a en commits `84fec3b`…`f7d91c5` | 67,481 estructurales de referencia; no es medición de ahorro | Implementación y revisiones SDD reales de T1–T3; el agregado exacto de dispatches/retrievals no se instrumentó | Tests focales, TypeScript, mutaciones A/B y sensores raíz documentados abajo; correcciones incluyeron manifest inválido multi-registry, renderer bloqueante y contrato certificado del sensor | provider usage/cost: `unobservable`; cuota: observación del owner: 8% de cuota en los desarrollos de esta sesión, no atribuible ni convertible a ahorro R3a | PR: `pending` antes de creación; merge/npm release: `pending` |

La aceptación de release de R3a queda en Step 5 post-merge: CI, merge SHA, npm
`gitHead`, versión publicada, comentario en issue #126 y el desbloqueo de R3b no
se anticipan en esta evidencia pre-PR.

### Task 3 execution evidence

- No-infrastructure gate: passed. The direct dependency comparison excludes the
  already-certified `dependency-cruiser` pin; no other direct dependency changed.
  The Context Kernel and preflight sources returned no matches for
  `openai|anthropic|embedding|vector|prompt store|response store` (expected
  `rg` exit 1).
- Mutation A: temporarily changed the schema guard to accept `2`.
  `npx jest tests/core/context-kernel/inspect.test.ts --runInBand` exited 1;
  the `future schema` case failed (along with fixtures intentionally rejected by
  the mutation). Source restored before the green run.
- Mutation B: temporarily treated advisory checks as blocking.
  `npx jest tests/commands/preflight/preflight.test.ts --runInBand --testNamePattern='keeps legacy ready'`
  exited 1 because expected `ready` became `degraded`. Source restored before
  the green run.
- Restored verification: 64 focused assertions passed, `npx tsc --noEmit`
  passed, and root `awm sensors run` reported `overall: pass` (lint, typecheck,
  depcheck; baseline 1, new findings 0).
