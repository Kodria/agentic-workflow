# Sensor Gate Honesty and Execution Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los issues #95–#98 haciendo que legacy y schema-v2 compartan una ejecución acotada y honesta, que solo `pass` sea verde, y que el handoff desatendido compruebe empíricamente los sensores antes de empezar.

**Architecture:** El CLI adapta ambos formatos de manifest a `PreparedSensorExecution`, resuelve una sola vez baseline/diff/base, ejecuta todos los procesos por una ruta común y separa evidencia estática (`READY`) de certificación empírica. El CLI se publica primero; después el registry incorpora timeouts recomendados, `changedCommand`, el overlay seguro de ESLint 8 y los contratos de skills que bloquean cualquier verdict no concluyente.

**Tech Stack:** TypeScript 5.9, Node.js 22, Commander 14, Jest 30, `child_process.spawn` sin shell para schema-v2, JSON Schema y tests `node:test`/`node:assert` en `awm-baseline-registry`, GitHub Actions sobre Ubuntu/macOS/Windows.

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

## Fuentes, bases y límites

- Diseño aprobado: `docs/plans/2026-08-21-sensor-gate-honesty-design.md`, commit `c0e97c0`.
- Issues: `Kodria/agentic-workflow#95`, `#96`, `#97` y `#98`.
- Base CLI: `origin/main@8b98e3c`; rama activa: `fix/issues-95-98-sensor-gate-honesty`.
- Base registry: `origin/main@1fb1d0d`, tag `v2.0.2`. Al comenzar T9, crear una rama nueva desde ese `origin/main`; la rama local actual del registry no es base autorizada.
- `cli/.awm/ledger/` es evidencia no rastreada del usuario. No moverla, borrarla, normalizarla ni incluirla en ningún commit.
- `awm preflight`, `awm context-budget`, `awm sensors` y `awm ledger` se ejecutan desde la raíz de `agentic-workflow`, salvo que el paso indique expresamente otro repositorio o el binario compilado.
- El plan es serial: el registry no puede publicar campos que el parser estricto de CLI 8.1.4 rechaza, y `minCliVersion` solo puede fijarse después de observar la versión estable realmente publicada.
- Dos PR coordinados son el resultado esperado: CLI primero, registry después. Merge, npm publish y auto-tag son estados externos; si no están disponibles, conservar evidencia y detenerse en ese bloqueo sin debilitar el contrato.
- No hay UI ni tracks paralelos. Ambos repos comparten contratos, artefactos de release y aceptación publicada.

## Contratos fijados

```ts
type TimeoutSource = 'project' | 'pack' | 'fallback';
type RequestedScope = 'full' | 'changed';
type EffectiveScope = 'full' | 'changed';

type PreparedSensorExecution = {
    name: string;
    command:
        | { kind: 'legacy'; value: string }
        | { kind: 'structured'; value: StructuredCommand };
    formatter?: string;
    timeoutMs: number;
    timeoutSource: TimeoutSource;
    requestedScope: RequestedScope;
    effectiveScope: EffectiveScope;
    scopeReason?: string;
    files?: number;
};

type ExecutionEvidence = {
    timeoutMs: number;
    timeoutSource: TimeoutSource;
    elapsedMs: number;
    requestedScope: RequestedScope;
    effectiveScope: EffectiveScope;
    files?: number;
    scopeReason?: string;
};
```

Invariantes que los implementadores y revisores deben conservar:

1. El manifest v2 solo autoriza `enabled`, `fast`, `timeout` y `variantId`; el comando ejecutable se re-resuelve desde el registry vivo.
2. Todo timeout es un entero seguro positivo. La precedencia es proyecto → pack → fallback `10_000`/`120_000`; no existe valor ilimitado.
3. `changedCommand` es una segunda orden estructurada, con un único argumento literal `{files}` y `fileInput.extensions` no vacío. Los nombres se insertan como argv, nunca como shell text.
4. `--changed` sin soporte o con diff irresoluble ejecuta full y lo dice. Diff resuelto con cero archivos aplicables produce `pass` scoped para ese sensor, pero no evita que otros sensores full se ejecuten.
5. Baseline solo transforma resultados con verdict propio; jamás vuelve verde `inconclusive` o `skipped`.
6. El reducer semántico conserva `pass | fail | not_certified | skipped`; el proceso devuelve 0 únicamente para `pass` y asigna `process.exitCode` después de escribir stdout.
7. `status` es estático y usa `READY | DEGRADED | NOT_CONFIGURED`; `preflight --verify-sensors` es empírico, full, read-only y exige `pass`.
8. En modo desatendido, cualquier non-pass detiene progreso. Un timeout solo se amplía tras diagnóstico de progreso saludable, con override finito justificado y rerun concluyente.

## Estructura de archivos

| Archivo | Responsabilidad única |
|---|---|
| `cli/src/commands/sensors/compatibility/timeout.ts` | Validar y resolver timeout con procedencia |
| `cli/src/commands/sensors/compatibility/{types,contract,manifest}.ts` | Campos v2 opcionales `timeout` y `changedCommand`, fail-closed |
| `cli/src/commands/sensors/init.ts` | Preservar override de proyecto durante rematerialización |
| `cli/src/commands/sensors/prepare.ts` | Adaptar legacy/v2, seleccionar scope/comando y producir `PreparedSensorExecution` |
| `cli/src/commands/sensors/result.ts` | Interpretar `ExecResult`, aplicar baseline y adjuntar evidencia |
| `cli/src/commands/sensors/verdict.ts` | Reducer global y mapping único a exit code |
| `cli/src/commands/sensors/{run,exec,types}.ts` | Contexto único, dispatch común, elapsed y contrato público |
| `cli/src/commands/sensors/{index,status}.ts` | Wiring del proceso y readiness estática |
| `cli/src/commands/preflight/{checks,index}.ts` | Modo empírico opcional y render accionable |
| `cli/tests/commands/sensors/**/*.test.ts` | Regresiones unitarias y de integración de #95–#97 |
| `cli/tests/commands/preflight/preflight.test.ts` | Gate estático/empírico y read-only |
| `cli/tests/integration/{sensor-compatibility,preflight-json-pipe}.e2e.test.ts` | Binario, stdout y compatibilidad publicada |
| `docs/{cli-reference,configuration}.md` y `docs/testing/{core-acceptance,os-matrix}.md` | Contrato operativo y matriz nativa |
| `../awm-baseline-registry/sensor-packs/pack.schema.json` | Contrato publicable de timeout/changedCommand |
| `../awm-baseline-registry/sensor-packs/js-ts/{pack.json,eslint.config.awm.cjs}` | Recomendaciones, scoping y overlay ESLint 8 seguro |
| `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/**` | Proyecto TS/JS real con output generado |
| `../awm-baseline-registry/tests/sensor-pack-*.test.mjs` | Parser espejo, semántica, certificación y mutaciones |
| `../awm-baseline-registry/skills/{writing-plans,executing-plans,subagent-driven-development,verification-before-completion}/SKILL.md` | Gates empírico y desatendido |
| `../awm-baseline-registry/{awm-registry.json,catalog.json,CHANGELOG.md}` | Compatibilidad mínima y release |

## Orden de entrega

```text
T1 contrato timeout/changedCommand
 -> T2 preparación común y scope
 -> T3 executor/result/baseline
 -> T4 orquestación/reducer común
 -> T5 exit code del comando
 -> T6 status READY
 -> T7 preflight empírico
 -> T8 documentación, aceptación y release CLI
 -> T9 contrato y pack registry
 -> T10 ESLint 8 y fixture TS real
 -> T11 gates de skills desatendidos
 -> T12 certificación y release registry
 -> T13 aceptación publicada y cierre de issues
```

### Task 1: Extender el contrato v2 sin romper manifests existentes

_Requirements: R3, R3.1, R3.3, R3.4, R4, R10_

**Files:**
- Create: `cli/src/commands/sensors/compatibility/timeout.ts`
- Modify: `cli/src/commands/sensors/compatibility/types.ts`
- Modify: `cli/src/commands/sensors/compatibility/contract.ts`
- Modify: `cli/src/commands/sensors/compatibility/manifest.ts`
- Modify: `cli/src/commands/sensors/init.ts`
- Test: `cli/tests/commands/sensors/compatibility/contract.test.ts`
- Test: `cli/tests/commands/sensors/compatibility/manifest.test.ts`
- Test: `cli/tests/commands/sensors/init.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos de timeout y changedCommand**

```ts
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1000'])('rejects v2 timeout %p before execution (R3.3)', (timeout) => {
    const manifest = validV2Manifest();
    (manifest.sensors.lint as Record<string, unknown>).timeout = timeout;
    expect(() => parseSensorManifest(manifest, '/project/.awm/sensors.json')).toThrow(/timeout.*positive safe integer/);
});

test('accepts one standalone files placeholder in changedCommand (R4)', () => {
    const pack = validPackV2();
    pack.sensors.lint.variants[0].changedCommand = {
        executable: 'eslint', resolution: 'node-modules-bin',
        args: ['--format', 'json', '{files}'],
        fileInput: { placeholder: '{files}', extensions: ['.js', '.ts'] },
    };
    expect(parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json').kind).toBe('v2');
});

test.each([
    { args: ['{files}', '{files}'], fileInput: { placeholder: '{files}', extensions: ['.ts'] } },
    { args: ['prefix-{files}'], fileInput: { placeholder: '{files}', extensions: ['.ts'] } },
    { args: ['{files}'], fileInput: { placeholder: '{files}', extensions: [] } },
])('rejects unsafe changedCommand %# (R4)', (changedCommand) => {
    const pack = validPackV2();
    pack.sensors.lint.variants[0].changedCommand = { executable: 'eslint', resolution: 'node-modules-bin', ...changedCommand };
    expect(() => parseSensorPack(pack, '/registry/sensor-packs/js-ts/pack.json')).toThrow(/changedCommand|fileInput|\{files\}/);
});
```

- [x] **Step 2: Ejecutar el corpus focal y comprobar rojo**

Run: `cd cli && npx jest tests/commands/sensors/compatibility/contract.test.ts tests/commands/sensors/compatibility/manifest.test.ts tests/commands/sensors/init.test.ts --runInBand`

Expected: FAIL porque `timeout` es campo desconocido en v2 y `changedCommand` aún no pertenece a `SensorVariant`.

- [x] **Step 3: Implementar validación compartida y tipos aditivos**

```ts
// compatibility/timeout.ts
export function positiveTimeout(value: unknown, location: string): number {
    if (typeof location !== 'string' || location.trim() === '') throw new Error('timeout location must be a nonempty string');
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${location} must be a positive safe integer`);
    }
    return value;
}

export function resolveTimeout(input: {
    project?: number; pack?: number; fast: boolean;
}): { timeoutMs: number; source: 'project' | 'pack' | 'fallback' } {
    if (!input || typeof input !== 'object' || typeof input.fast !== 'boolean') throw new Error('timeout resolution input is invalid');
    if (input.project !== undefined) return { timeoutMs: positiveTimeout(input.project, 'project timeout'), source: 'project' };
    if (input.pack !== undefined) return { timeoutMs: positiveTimeout(input.pack, 'pack timeout'), source: 'pack' };
    return { timeoutMs: input.fast ? 10_000 : 120_000, source: 'fallback' };
}
```

Agregar `changedCommand?: StructuredCommand` a `SensorVariant`, `timeout?: number` a `SensorPackSensor` y al sensor de `SensorManifestV2`. `parseVariant` acepta/parsa `changedCommand`; `parseSensor` acepta `timeout`; `parseV2Sensor` acepta `timeout`. Mantener estricto el resto de campos.

- [x] **Step 4: Preservar el override de proyecto en init**

En el objeto v2 materializado de `init.ts`, copiar solo `prior.timeout`:

```ts
sensors[name] = {
    enabled: prior?.enabled ?? true,
    fast: prior?.fast ?? sensor.fast ?? false,
    ...(prior?.timeout !== undefined ? { timeout: prior.timeout } : {}),
    variantId: variant.id,
    command: variant.command,
    assets: variant.assets,
    ...(variant.policyRef ? { policyRef: variant.policyRef } : {}),
    initializedCompatibility,
};
```

No copiar `command`, `assets`, formatter ni environment desde el manifest previo.

- [x] **Step 5: Verificar verde y mutación discriminante**

Run: `cd cli && npx jest tests/commands/sensors/compatibility/contract.test.ts tests/commands/sensors/compatibility/manifest.test.ts tests/commands/sensors/init.test.ts --runInBand`

Expected: PASS. Luego retirar temporalmente la copia de `prior.timeout`, ejecutar el test de preservación y observar FAIL; restaurar y obtener PASS.

- [x] **Step 6: Commit**

```bash
git add cli/src/commands/sensors/compatibility cli/src/commands/sensors/init.ts cli/tests/commands/sensors/compatibility cli/tests/commands/sensors/init.test.ts
git commit -m "feat(sensors): add bounded v2 execution options"
```

### Task 2: Preparar legacy y v2 mediante una representación común

_Requirements: R1, R1.1, R1.2, R1.3, R3.1, R4.1, R4.2, R4.3, R4.4, R4.6, R10.2_

**Files:**
- Create: `cli/src/commands/sensors/prepare.ts`
- Modify: `cli/src/commands/sensors/types.ts`
- Modify: `cli/src/commands/sensors/changed.ts`
- Test: `cli/tests/commands/sensors/prepare.test.ts`
- Test: `cli/tests/commands/sensors/changed.test.ts`
- Test: `cli/tests/commands/sensors/changed-windows.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos del adaptador y de scope literal**

```ts
test('v2 uses the live command and project > pack > fallback timeout (R1.1, R3.1)', () => {
    const prepared = prepareV2Sensor(v2Input({ projectTimeout: 90_000, packTimeout: 30_000 }));
    expect(prepared.command).toEqual({ kind: 'structured', value: liveVariant.changedCommand });
    expect(prepared.timeoutMs).toBe(90_000);
    expect(prepared.timeoutSource).toBe('project');
});

test('expands changed paths as literal argv entries (R4.1, R10.2)', () => {
    const prepared = prepareV2Sensor(v2Input({ changed: { files: ['src/a b.ts', 'src/$x.ts'], base: 'HEAD' } }));
    expect(prepared.command.kind).toBe('structured');
    expect(prepared.command.value.args).toEqual(['--format', 'json', 'src/a b.ts', 'src/$x.ts']);
    expect(prepared.effectiveScope).toBe('changed');
});

test('falls back full with an explicit reason when changedCommand is absent (R4.2)', () => {
    const prepared = prepareV2Sensor(v2Input({ changed: { files: ['src/a.ts'], base: 'HEAD' }, changedCommand: undefined }));
    expect(prepared.effectiveScope).toBe('full');
    expect(prepared.scopeReason).toMatch(/does not support changed scope/);
});

test('returns a zero-file pass plan without a process (R4.4)', () => {
    const prepared = prepareV2Sensor(v2Input({ changed: { files: ['README.md'], base: 'HEAD' } }));
    expect(prepared).toMatchObject({ effectiveScope: 'changed', files: 0, syntheticStatus: 'pass' });
});
```

- [x] **Step 2: Ejecutar tests y comprobar rojo**

Run: `cd cli && npx jest tests/commands/sensors/prepare.test.ts tests/commands/sensors/changed.test.ts tests/commands/sensors/changed-windows.test.ts --runInBand`

Expected: FAIL porque `prepareV2Sensor`/`PreparedSensorExecution` no existen.

- [x] **Step 3: Implementar el contrato de preparación**

```ts
export type PreparedSensorExecution = {
    name: string;
    command?: { kind: 'legacy'; value: string } | { kind: 'structured'; value: StructuredCommand };
    formatter?: string;
    timeoutMs: number;
    timeoutSource: 'project' | 'pack' | 'fallback';
    requestedScope: 'full' | 'changed';
    effectiveScope: 'full' | 'changed';
    scopeReason?: string;
    files?: number;
    syntheticStatus?: 'pass' | 'skipped' | 'inconclusive';
    syntheticReason?: string;
};

export function expandFileInput(command: StructuredCommand, files: string[]): StructuredCommand {
    if (!command.fileInput) throw new Error('changed command requires fileInput');
    const index = command.args.indexOf(command.fileInput.placeholder);
    if (index < 0 || command.args.lastIndexOf(command.fileInput.placeholder) !== index) {
        throw new Error('changed command requires exactly one standalone {files} argument');
    }
    return { ...command, args: [...command.args.slice(0, index), ...files, ...command.args.slice(index + 1)] };
}
```

El input v2 recibe manifest parseado y resolución viva. Solo busca `variantId` en `live.pack`; nunca lee `manifest.command` para dispatch. El adaptador legacy conserva `changedCmd` y el rechazo Win32 actual; ambos adaptadores llaman a `resolveTimeout`.

- [x] **Step 4: Validar argumentos incompatibles antes de Git/proceso**

Agregar en el entry de preparación, antes de cargar manifest, baseline o diff:

```ts
export function validateRunOptions(opts: RunOptions): void {
    if (!opts || typeof opts !== 'object') throw new Error('run options must be an object');
    if (opts.changed && opts.ignoreBaseline) {
        throw new Error('refusing to combine --changed with a baseline capture: a partial run cannot define the accepted set');
    }
}
```

El test espía `changedFiles`, `runCommand` y `runStructuredCommand` y afirma cero llamadas ante esa combinación.

- [x] **Step 5: Verde, mutación y commit**

Run: `cd cli && npx jest tests/commands/sensors/prepare.test.ts tests/commands/sensors/changed.test.ts tests/commands/sensors/changed-windows.test.ts --runInBand`

Expected: PASS. Sustituir temporalmente argv literal por `files.join(' ')`: el caso de espacio/$ debe fallar; restaurar.

```bash
git add cli/src/commands/sensors/prepare.ts cli/src/commands/sensors/types.ts cli/src/commands/sensors/changed.ts cli/tests/commands/sensors/prepare.test.ts cli/tests/commands/sensors/changed*.test.ts
git commit -m "refactor(sensors): prepare legacy and v2 execution uniformly"
```

### Task 3: Unificar executor, interpretación, baseline y evidencia

_Requirements: R1, R2, R2.1, R3.2, R3.4, R5.2, R7.1_

**Files:**
- Create: `cli/src/commands/sensors/result.ts`
- Modify: `cli/src/commands/sensors/exec.ts`
- Modify: `cli/src/commands/sensors/run.ts`
- Modify: `cli/src/commands/sensors/types.ts`
- Test: `cli/tests/commands/sensors/exec.test.ts`
- Test: `cli/tests/commands/sensors/exec-windows.test.ts`
- Test: `cli/tests/commands/sensors/baseline.test.ts`
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos de elapsed, baseline v2 y non-pass incompleto**

```ts
test('records bounded execution evidence on timeout (R3.2, R3.4, R7.1)', async () => {
    const result = await executePrepared(sensor({ timeoutMs: 25, timeoutSource: 'project' }));
    expect(result.status).toBe('inconclusive');
    expect(result.execution).toMatchObject({ timeoutMs: 25, timeoutSource: 'project', effectiveScope: 'full' });
    expect(result.execution!.elapsedMs).toBeGreaterThanOrEqual(0);
});

test('applies the same baseline to structured findings (R2)', () => {
    const accepted = [fingerprint('lint', { file: 'src/a.ts', line: 1, message: 'x' })];
    expect(applyBaseline({ name: 'lint', status: 'fail', errors: [{ file: 'src/a.ts', line: 1, message: 'x' }] }, accepted))
        .toMatchObject({ status: 'pass', baselineCount: 1, newCount: 0 });
});

test.each(['inconclusive', 'skipped'] as const)('baseline never changes %s to pass (R2.1)', (status) => {
    expect(applyBaseline({ name: 'lint', status, errors: [], skipReason: 'fixture' }, ['anything']).status).toBe(status);
});
```

- [x] **Step 2: Ejecutar focal y comprobar rojo**

Run: `cd cli && npx jest tests/commands/sensors/exec.test.ts tests/commands/sensors/baseline.test.ts tests/commands/sensors/run-inconclusive.test.ts --runInBand`

Expected: FAIL por ausencia de `elapsedMs`/`execution` y de `executePrepared`.

- [x] **Step 3: Medir elapsed en el executor común**

```ts
export type ExecResult = {
    stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null;
    timedOut: boolean; overflowed: boolean; elapsedMs: number; spawnError?: NodeJS.ErrnoException;
};

const startedAt = process.hrtime.bigint();
const finish = (extra: Partial<ExecResult>) => {
    if (settled) return;
    settled = true;
    timers.forEach(clearTimeout);
    const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    resolve({ stdout, stderr, code: null, signal: null, timedOut, overflowed, elapsedMs, ...extra });
};
```

Los tests mockeados que construyen `ExecResult` añaden `elapsedMs` explícito; no se infiere ni se deja `undefined`.

- [x] **Step 4: Implementar `executePrepared` e `interpretResult`**

`executePrepared` selecciona `runCommand` o `runStructuredCommand` por discriminante y siempre pasa el timeout validado. `interpretResult` conserva findings parciales, clasifica spawn/timeout/overflow/parse/exit como fail o inconclusive según el contrato actual y adjunta:

```ts
const execution = {
    timeoutMs: prepared.timeoutMs,
    timeoutSource: prepared.timeoutSource,
    elapsedMs: raw.elapsedMs,
    requestedScope: prepared.requestedScope,
    effectiveScope: prepared.effectiveScope,
    ...(prepared.files !== undefined ? { files: prepared.files } : {}),
    ...(prepared.scopeReason ? { scopeReason: prepared.scopeReason } : {}),
};
```

Aplicar baseline después de interpretar únicamente `pass`/`fail`; re-exportar `applyBaseline` desde `run.ts` para no romper imports públicos existentes.

- [x] **Step 5: Verificar y probar mutación**

Run: `cd cli && npx jest tests/commands/sensors/exec.test.ts tests/commands/sensors/exec-windows.test.ts tests/commands/sensors/baseline.test.ts tests/commands/sensors/run-inconclusive.test.ts --runInBand`

Expected: PASS. Retirar temporalmente el guard de `inconclusive` en `applyBaseline`: el test R2.1 debe fallar; restaurar.

- [x] **Step 6: Commit**

```bash
git add cli/src/commands/sensors/result.ts cli/src/commands/sensors/exec.ts cli/src/commands/sensors/run.ts cli/src/commands/sensors/types.ts cli/tests/commands/sensors
git commit -m "fix(sensors): preserve evidence through common execution"
```

### Task 4: Reemplazar el early-return v2 por una orquestación y reducer comunes

_Requirements: R1, R1.1, R1.2, R1.3, R2, R2.1, R4.3, R4.4, R4.5, R4.6, R5.1, R5.2, R10_

**Files:**
- Create: `cli/src/commands/sensors/verdict.ts`
- Modify: `cli/src/commands/sensors/run.ts`
- Modify: `cli/src/commands/sensors/types.ts`
- Test: `cli/tests/commands/sensors/run.test.ts`
- Test: `cli/tests/commands/sensors/run-changed.test.ts`
- Test: `cli/tests/commands/sensors/run-partial.test.ts`
- Test: `cli/tests/commands/sensors/run-tool-missing.test.ts`
- Test: `cli/tests/commands/sensors/run-is-read-only.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Congelar legacy y escribir regresiones v2 rojas**

```ts
test('loads baseline and changed files once for a mixed v2 run (R1.2)', async () => {
    await runSensors({ cwd: fixture.root, changed: true });
    expect(readBaselineSpy).toHaveBeenCalledTimes(1);
    expect(changedFilesSpy).toHaveBeenCalledTimes(1);
});

test('does not short-circuit mixed empty-changed and full sensors (R4.5)', async () => {
    const output = await runSensors({ cwd: mixedFixture.root, changed: true });
    expect(output.sensors).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'lint', status: 'pass', execution: expect.objectContaining({ effectiveScope: 'changed', files: 0 }) }),
        expect.objectContaining({ name: 'test', status: 'fail', execution: expect.objectContaining({ effectiveScope: 'full' }) }),
    ]));
    expect(output.overall).toBe('fail');
});

test('git failure runs full and never claims changed scope (R4.3, R4.6)', async () => {
    const output = await runSensors({ cwd: noGitFixture.root, changed: true });
    expect(output.changedScope?.error).toMatch(/git/i);
    expect(output.sensors.every(sensor => sensor.execution?.effectiveScope !== 'changed')).toBe(true);
});
```

- [x] **Step 2: Comprobar rojo sin alterar los tests legacy**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts tests/commands/sensors/run-changed.test.ts tests/commands/sensors/run-partial.test.ts tests/commands/sensors/run-tool-missing.test.ts tests/commands/sensors/run-is-read-only.test.ts --runInBand`

Expected: tests legacy existentes PASS; nuevos casos v2 FAIL por el early return.

- [x] **Step 3: Implementar contexto y reducer únicos**

```ts
export function reduceVerdict(results: SensorResult[]): RunOutput['overall'] {
    if (results.some(result => result.status === 'fail')) return 'fail';
    if (results.some(result => result.status === 'inconclusive')) return 'not_certified';
    if (results.some(result => result.status === 'pass')) return 'pass';
    return 'skipped';
}
```

`runSensors` ejecuta en este orden: validar opciones → localizar/parsar manifest → cargar baseline una vez → resolver changed/base una vez → resolver live v2 una vez si aplica → preparar todas las entradas → pool común → interpretar/baseline → reducer. Eliminar `runV2Sensor` y el `return` v2 separado. Los synthetic pass/skipped/inconclusive entran al mismo reducer.

- [x] **Step 4: Asegurar fail-closed y read-only**

La tabla de regresión debe cubrir spawn error, tool missing, timeout limpio, overflow limpio, salida no parseable, variant drift y cero seleccionados. Ninguno puede devolver `pass`. Capturar `git status --porcelain=v1` antes/después del fixture v2 y afirmar igualdad byte a byte.

- [x] **Step 5: Verde y mutación discriminante**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts tests/commands/sensors/run-changed.test.ts tests/commands/sensors/run-partial.test.ts tests/commands/sensors/run-tool-missing.test.ts tests/commands/sensors/run-is-read-only.test.ts --runInBand`

Expected: PASS. Reintroducir temporalmente el early return v2 anterior: los casos baseline/changed/mixed deben fallar; restaurar.

- [x] **Step 6: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/src/commands/sensors/verdict.ts cli/src/commands/sensors/types.ts cli/tests/commands/sensors
git commit -m "fix(sensors): unify legacy and v2 run semantics"
```

### Task 5: Hacer que solo `pass` salga con código cero

_Requirements: R5, R5.1, R5.2_

**Files:**
- Modify: `cli/src/commands/sensors/index.ts`
- Modify: `cli/src/commands/sensors/verdict.ts`
- Test: `cli/tests/commands/sensors/index.test.ts`
- Test: `cli/tests/commands/sensors/router.test.ts`
- Test: `cli/tests/integration/sensor-compatibility.e2e.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir la tabla roja de cuatro verdicts y flush**

```ts
test.each([
    ['pass', 0], ['fail', 1], ['not_certified', 1], ['skipped', 1],
] as const)('maps %s to exit %i (R5)', (overall, expected) => {
    expect(exitCodeFor({ sensors: [], overall })).toBe(expected);
});

test('writes JSON before assigning a nonzero exit code (R5.1)', async () => {
    await invokeRun({ overall: 'not_certified', sensors: [] });
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"overall": "not_certified"'));
    expect(process.exitCode).toBe(1);
    expect(processExit).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Ejecutar y comprobar rojo**

Run: `cd cli && npx jest tests/commands/sensors/index.test.ts tests/commands/sensors/router.test.ts --runInBand`

Expected: FAIL para `not_certified` y `skipped`, y/o por uso de `process.exit`.

- [x] **Step 3: Centralizar mapping y wiring**

```ts
export function exitCodeForVerdict(overall: RunOutput['overall']): 0 | 1 {
    return overall === 'pass' ? 0 : 1;
}
```

`index.ts` delega en esta función, escribe JSON completo y luego asigna `process.exitCode = code`; no llama `process.exit()`.

- [x] **Step 4: Verde, mutación y commit**

Run: `cd cli && npx jest tests/commands/sensors/index.test.ts tests/commands/sensors/router.test.ts tests/integration/sensor-compatibility.e2e.test.ts --runInBand`

Expected: PASS. Cambiar temporalmente `not_certified` a 0: el test tabular y el e2e deben fallar; restaurar.

```bash
git add cli/src/commands/sensors/index.ts cli/src/commands/sensors/verdict.ts cli/tests/commands/sensors/index.test.ts cli/tests/commands/sensors/router.test.ts cli/tests/integration/sensor-compatibility.e2e.test.ts
git commit -m "fix(sensors): fail the process on every non-pass verdict"
```

### Task 6: Renombrar el status estático a readiness honesta

_Requirements: R6, R6.1, R6.2_

**Files:**
- Modify: `cli/src/commands/sensors/types.ts`
- Modify: `cli/src/commands/sensors/status.ts`
- Modify: `cli/src/commands/sensors/index.ts`
- Test: `cli/tests/commands/sensors/status.test.ts`
- Test: `cli/tests/commands/sensors/status-windows.test.ts`
- Test: `cli/tests/commands/sensors/router.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir regresiones rojas de estados y coste**

```ts
test.each([
    ['valid-v2', 'READY'], ['missing-tool', 'DEGRADED'], ['absent', 'NOT_CONFIGURED'],
] as const)('reports %s as %s (R6.1)', async (fixture, expected) => {
    expect((await computeSensorStatus(pathFor(fixture))).overall).toBe(expected);
});

test('status never runs the project sensor command (R6.2)', async () => {
    await computeSensorStatus(validRoot);
    expect(runStructuredCommandSpy).not.toHaveBeenCalled();
    expect(runCommandSpy).not.toHaveBeenCalled();
});

test('human output makes no empirical health claim (R6)', async () => {
    const text = await invokeStatus(validRoot);
    expect(text).toContain('READY');
    expect(text).not.toMatch(/HEALTHY|project certified/i);
});
```

- [x] **Step 2: Comprobar rojo**

Run: `cd cli && npx jest tests/commands/sensors/status.test.ts tests/commands/sensors/status-windows.test.ts tests/commands/sensors/router.test.ts --runInBand`

Expected: FAIL porque el enum/render actual usa `HEALTHY`.

- [x] **Step 3: Cambiar semántica y prosa sin ampliar ejecución**

```ts
export type SensorStatusResult = {
    overall: 'READY' | 'DEGRADED' | 'NOT_CONFIGURED';
    pack: string | null;
    checks: Record<string, SensorCheck>;
};
```

Mantener discovery, resolución, assets, versiones y probes estáticos existentes. La prosa puede describir `registry-certified range` dentro del detalle de compatibilidad, pero headline/summary no dice que el proyecto ejecutó o certificó.

- [x] **Step 4: Verde, mutación y commit**

Run: `cd cli && npx jest tests/commands/sensors/status.test.ts tests/commands/sensors/status-windows.test.ts tests/commands/sensors/router.test.ts --runInBand`

Expected: PASS. Restaurar temporalmente `HEALTHY`: el test de render debe fallar; volver a `READY`.

```bash
git add cli/src/commands/sensors/types.ts cli/src/commands/sensors/status.ts cli/src/commands/sensors/index.ts cli/tests/commands/sensors/status*.test.ts cli/tests/commands/sensors/router.test.ts
git commit -m "fix(sensors): report static readiness without health claims"
```

### Task 7: Añadir preflight empírico, read-only y accionable

_Requirements: R7, R7.1, R7.2_

**Files:**
- Modify: `cli/src/commands/preflight/checks.ts`
- Modify: `cli/src/commands/preflight/index.ts`
- Modify: `cli/src/commands/sensors/types.ts`
- Test: `cli/tests/commands/preflight/preflight.test.ts`
- Test: `cli/tests/integration/preflight-json-pipe.e2e.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos del modo opcional**

```ts
test('default preflight remains static (R6.2)', async () => {
    await preflight(validRoot);
    expect(runSensorsSpy).not.toHaveBeenCalled();
});

test('verify-sensors requires empirical pass (R7)', async () => {
    runSensorsSpy.mockResolvedValue({ overall: 'not_certified', sensors: [timedOutLint] });
    const report = await preflight(validRoot, { verifySensors: true });
    expect(report.status).toBe('degraded');
    expect(report.checks).toContainEqual(expect.objectContaining({
        id: 'sensors-execution', ok: false,
        detail: expect.stringMatching(/lint.*30000ms.*elapsed.*timeout/i),
    }));
});

test('empirical preflight is read-only (R7.2)', async () => {
    const before = snapshotTree(validRoot);
    await preflight(validRoot, { verifySensors: true });
    expect(snapshotTree(validRoot)).toEqual(before);
});
```

- [x] **Step 2: Ejecutar y comprobar rojo**

Run: `cd cli && npx jest tests/commands/preflight/preflight.test.ts tests/integration/preflight-json-pipe.e2e.test.ts --runInBand`

Expected: FAIL porque no existe `verifySensors` ni el check `sensors-execution`.

- [x] **Step 3: Implementar opción y check empírico**

```ts
export type PreflightOptions = { verifySensors?: boolean };

export async function checkSensorExecution(cwd: string): Promise<PreflightCheck> {
    const output = await runSensors({ cwd, all: true });
    if (output.overall === 'pass') return { id: 'sensors-execution', ok: true, detail: 'all selected sensors completed with pass' };
    const failed = output.sensors.filter(sensor => sensor.status !== 'pass');
    return {
        id: 'sensors-execution', ok: false,
        detail: renderExecutionFailure(output.overall, failed),
        remedy: 'diagnose the named sensor; if a healthy progressing run needs longer, set a finite sensor timeout and rerun awm preflight --verify-sensors',
    };
}
```

`preflight(cwd, opts)` agrega el check solo si `opts.verifySensors === true`. Commander registra `.option('--verify-sensors', 'run the complete sensor gate before unattended execution')` y pasa la opción. El render usa nombre, status, timeout efectivo, elapsed y reason sanitizado; no vuelca stdout/stderr crudo.

- [x] **Step 4: Probar el fallo real de exit 2/unparseable y la ausencia de diff**

El e2e crea un comando v2 estructurado que termina 2 sin findings parseables, ejecuta `dist/src/index.js preflight --verify-sensors --json --cwd "$FIXTURE_ROOT"`, afirma exit 1, JSON válido, `status: degraded`, sensor/reason, y tree snapshot idéntico.

- [x] **Step 5: Verde, mutación y commit**

Run: `cd cli && npm run build && npx jest tests/commands/preflight/preflight.test.ts tests/integration/preflight-json-pipe.e2e.test.ts --runInBand`

Expected: PASS. Cambiar temporalmente la condición a `overall !== 'fail'`: el caso `not_certified` debe fallar; restaurar.

```bash
git add cli/src/commands/preflight cli/src/commands/sensors/types.ts cli/tests/commands/preflight/preflight.test.ts cli/tests/integration/preflight-json-pipe.e2e.test.ts
git commit -m "feat(preflight): verify sensor execution before handoff"
```

### Task 8: Documentar, verificar y publicar primero el CLI

_Requirements: R3, R3.1, R3.2, R3.4, R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R5, R5.1, R6, R6.1, R6.2, R7, R7.1, R7.2, R10, R10.1, R10.2_

**Files:**
- Modify: `docs/cli-reference.md`
- Modify: `docs/configuration.md`
- Modify: `docs/testing/core-acceptance.md`
- Modify: `docs/testing/os-matrix.md`
- Modify: `CHANGELOG.md`
- Test: `cli/tests/integration/sensor-compatibility.e2e.test.ts`
- Test: `cli/tests/structural/support-matrix-is-current.test.ts`

**Skills:** `test-driven-development`, `requesting-code-review`, `verification-before-completion`

- [x] **Step 1: Escribir/actualizar aceptación ejecutable**

`CORE-12` y `CORE-13` ejecutan y verifican: legacy sin campos nuevos; v2 sin campos nuevos; v2 timeout proyecto/pack/fallback; changed supported/unsupported/empty/Git error; cuatro verdicts/exit; status READY estático; preflight empírico read-only. `os-matrix.md` repite el contrato en Ubuntu, macOS y Windows nativo y comprueba que v2 no usa shell.

- [x] **Step 2: Actualizar documentación canónica**

Documentar JSON aditivo con `execution.timeoutMs`, `timeoutSource`, `elapsedMs`, requested/effective scope, files/reason; tabla de exits; diferencia `status` vs `preflight --verify-sensors`; precedencia y ejemplo de timeout finito:

```json
{
  "schemaVersion": 2,
  "pack": "js-ts",
  "sensors": {
    "test": { "enabled": true, "fast": false, "timeout": 600000, "variantId": "npm-script" }
  }
}
```

Aclarar que el ejemplo omite campos materializados solo para mostrar el override, no es un manifest completo copiables.

- [x] **Step 3: Ejecutar suites completas y sensores**

```bash
cd cli
npm ci
npm run typecheck
npm run lint
npm run depcheck
npm test -- --runInBand
npm run build
cd ..
awm sensors run
git diff --check
```

Expected: todos exit 0 y `awm sensors run` produce `overall: pass`. Confirmar que `cli/.awm/ledger/` sigue no rastreado y no staged.

- [x] **Step 4: Ejecutar mutaciones obligatorias y review**

Repetir las mutaciones discriminantes de T1–T7 contra sus tests exactos. Invocar `requesting-code-review`; corregir cada hallazgo con test rojo/verde y commit separado cuando cambie comportamiento.

- [x] **Step 5: Commit documental y PR CLI**

```bash
git add docs/cli-reference.md docs/configuration.md docs/testing/core-acceptance.md docs/testing/os-matrix.md CHANGELOG.md cli/tests/integration/sensor-compatibility.e2e.test.ts
git commit -m "docs(sensors): define empirical execution readiness"
git push -u origin fix/issues-95-98-sensor-gate-honesty
gh pr create --repo Kodria/agentic-workflow --base main --head fix/issues-95-98-sensor-gate-honesty --title "fix(sensors): make execution gates conclusive" --body "Fixes #95. Fixes #96. Fixes #97. Coordinates the CLI prerequisite for #98."
gh pr checks --repo Kodria/agentic-workflow --watch
```

Expected: PR real y matriz Linux/macOS/Windows verde.

- [ ] **Step 6: Esperar merge y observar la publicación estable**

Tras merge autorizado, observar `.github/workflows/release.yml`, no ejecutar `npm publish` manual:

```bash
gh run list --repo Kodria/agentic-workflow --workflow release.yml --limit 5
npm view agentic-workflow-manager version
```

Guardar `CLI_RELEASE_VERSION` solo cuando npm muestre una versión posterior a 8.1.4 que contenga el merge. Crear `ACCEPTANCE_PREFIX=$(mktemp -d)`, verificarla con `npm install --prefix "$ACCEPTANCE_PREFIX" "agentic-workflow-manager@${CLI_RELEASE_VERSION}"` y ejecutar `--version`, `sensors run`, `status` y `preflight --verify-sensors` sobre fixtures legacy/v2. No avanzar a T9 sin esta evidencia.

### Task 9: Publicar el contrato de registry y scoping recomendado

_Requirements: R3.1, R3.4, R4, R4.1, R4.2, R4.6, R10, R10.1, R10.2_

**Files:**
- Modify: `../awm-baseline-registry/sensor-packs/pack.schema.json`
- Modify: `../awm-baseline-registry/sensor-packs/README.md`
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/pack.json`
- Modify: `../awm-baseline-registry/tests/support/sensor-pack-v2-validator.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-shape.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-schema-equivalence.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-js-ts-variants.test.mjs`

**Skills:** `test-driven-development`

- [ ] **Step 1: Crear rama limpia del registry y verificar base**

```bash
git -C ../awm-baseline-registry fetch origin
git -C ../awm-baseline-registry switch -c fix/issues-95-98-sensor-gate-honesty origin/main
git -C ../awm-baseline-registry rev-parse HEAD
```

Expected: `1fb1d0df90c92031c5ca6fad4c79148bab1a3528` o un `origin/main` posterior revisado antes de editar; worktree limpio.

- [ ] **Step 2: Escribir tests rojos de equivalencia parser/schema**

```js
test('accepts timeout and shell-free changedCommand identically (R3.1, R4)', () => {
  const candidate = structuredClone(validPack);
  candidate.sensors.lint.timeout = 30000;
  candidate.sensors.lint.variants[0].changedCommand = {
    executable: 'eslint', resolution: 'node-modules-bin',
    args: ['--format', 'json', '{files}'],
    fileInput: { placeholder: '{files}', extensions: ['.js', '.jsx', '.ts', '.tsx'] },
  };
  assert.equal(validateWithSchema(candidate), true);
  assert.doesNotThrow(() => validatePackV2(candidate, 'fixture'));
});
```

Agregar corpus inválido para timeout 0/fraccional/unsafe y changedCommand con shell, placeholder embebido/duplicado o extensions vacío; JSON Schema y parser espejo deben rechazar exactamente el mismo corpus.

- [ ] **Step 3: Implementar schema/parser y declarar el pack**

Añadir `timeout` entero mínimo 1 al sensor y `changedCommand` con el mismo `$defs.structuredCommand`; reforzar que `fileInput` implica exactamente un `{files}` mediante validator semántico. En `js-ts/pack.json`, declarar timeouts finitos por costo y `changedCommand` únicamente para sensores file-local realmente seguros (lint y security); typecheck/test/depcheck/format siguen full y lo reportará el CLI.

- [ ] **Step 4: Verificar y probar mutación**

Run:

```bash
cd ../awm-baseline-registry
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-schema-equivalence.test.mjs
node tests/sensor-pack-js-ts-variants.test.mjs
```

Expected: PASS. Quitar temporalmente un `{files}` o poner timeout 0 en el pack productivo: el test exacto debe fallar; restaurar.

- [ ] **Step 5: Commit**

```bash
git -C ../awm-baseline-registry add sensor-packs/pack.schema.json sensor-packs/README.md sensor-packs/js-ts/pack.json tests/support/sensor-pack-v2-validator.mjs tests/sensor-pack-shape.test.mjs tests/sensor-pack-schema-equivalence.test.mjs tests/sensor-pack-js-ts-variants.test.mjs
git -C ../awm-baseline-registry commit -m "feat(sensors): add bounded changed execution contracts"
```

### Task 10: Corregir el overlay ESLint 8 y certificar TypeScript real

_Requirements: R9, R9.1, R9.2, R9.3_

**Files:**
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/eslint.config.awm.cjs`
- Modify: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/package.json`
- Modify: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/package-lock.json`
- Create: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/.eslintrc.js`
- Create: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/tsconfig.json`
- Create: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/src/clean.ts`
- Create: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/scripts/unused.js`
- Create: `../awm-baseline-registry/tests/fixtures/eslint-certification/eslint-8/dist/generated.js`
- Modify: `../awm-baseline-registry/tests/sensor-pack-eslint-semantics.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-eslint.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-certification.test.mjs`

**Skills:** `test-driven-development`, `verification-before-completion`

- [ ] **Step 1: Convertir el fixture ESLint 8 en un proyecto JS/TS real**

Pinnear `eslint@8.57.1`, `@typescript-eslint/parser` y `@typescript-eslint/eslint-plugin` compatibles. `.eslintrc.js` habilita parser/plugin y `@typescript-eslint/no-unused-vars` para `*.ts`, deshabilitando base `no-unused-vars`/`no-undef` allí. `clean.ts` usa tipos válidos; `scripts/unused.js` contiene una variable JS sin uso; `dist/generated.js` contiene sintaxis que produciría parse noise si no fuera ignorada.

- [ ] **Step 2: Escribir certificación roja con proceso real**

```js
test('eslint 8 overlay preserves TS rules, ignores output, and keeps JS rules (R9-R9.3)', () => {
  const run = spawnSync(eslintBin, ['.', '--config', copiedOverlay, '--format', 'json'], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'false' }, shell: false,
  });
  assert.ok(run.status === 0 || run.status === 1, `unexpected eslint exit ${run.status}: ${run.stderr}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.some(entry => entry.filePath.endsWith('clean.ts') && entry.messages.some(m => ['no-undef', 'no-unused-vars'].includes(m.ruleId))), false);
  assert.equal(report.some(entry => /[\\/]dist[\\/]/.test(entry.filePath)), false);
  assert.equal(report.some(entry => entry.filePath.endsWith(path.join('scripts', 'unused.js')) && entry.messages.some(m => m.ruleId === 'no-unused-vars')), true);
});
```

- [ ] **Step 3: Comprobar que el asset publicado reproduce #98**

Run: `cd ../awm-baseline-registry && node tests/sensor-pack-certification.test.mjs`

Expected antes del fix: FAIL; exit 2, false positives TS o ruido de `dist` reproduce #98.

- [ ] **Step 4: Implementar overlay seguro**

```js
module.exports = {
  extends: ['./.eslintrc.js'],
  ignorePatterns: ['dist/', 'build/', 'coverage/'],
  rules: { 'no-unreachable': 'error' },
  overrides: [{
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    rules: {
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used' }],
      'no-undef': 'error',
    },
  }],
};
```

No incluir `scripts/` en ignores. No reactivar reglas base dentro de una override TS.

- [ ] **Step 5: Verde, mutación y commit**

Run:

```bash
cd ../awm-baseline-registry
node tests/sensor-pack-eslint-semantics.test.mjs
node tests/sensor-pack-eslint.test.mjs
node tests/sensor-pack-certification.test.mjs
```

Expected: PASS. Reponer temporalmente `no-undef`/`no-unused-vars` globales y retirar `dist/`: la certificación debe fallar; restaurar.

```bash
git -C ../awm-baseline-registry add sensor-packs/js-ts/eslint.config.awm.cjs tests/fixtures/eslint-certification/eslint-8 tests/sensor-pack-eslint-semantics.test.mjs tests/sensor-pack-eslint.test.mjs tests/sensor-pack-certification.test.mjs
git -C ../awm-baseline-registry commit -m "fix(eslint): preserve TypeScript-aware project rules"
```

### Task 11: Convertir el preflight empírico y el non-pass en gates del workflow

_Requirements: R7.3, R8, R8.1_

**Files:**
- Modify: `../awm-baseline-registry/skills/writing-plans/SKILL.md`
- Modify: `../awm-baseline-registry/skills/executing-plans/SKILL.md`
- Modify: `../awm-baseline-registry/skills/subagent-driven-development/SKILL.md`
- Modify: `../awm-baseline-registry/skills/verification-before-completion/SKILL.md`
- Modify: `../awm-baseline-registry/skills/writing-plans/plan-document-reviewer-prompt.md`
- Create: `../awm-baseline-registry/tests/r8-sensor-gate-contract.test.mjs`
- Modify: `../awm-baseline-registry/scripts/check-skill-version-bumps.sh`

**Skills:** `test-driven-development`, `writing-skills`, `verification-before-completion`

- [ ] **Step 1: Escribir tests semánticos rojos, no greps genéricos**

```js
test('writing-plans requires empirical preflight before unattended handoff (R7.3)', () => {
  const text = read('skills/writing-plans/SKILL.md');
  assert.match(text, /Modo de ejecución:\*\* `desatendido`[\s\S]*awm preflight --verify-sensors/);
  assert.match(text, /non-zero[\s\S]*stop[\s\S]*Do not offer the execution choice/i);
});

for (const file of EXECUTION_SKILLS) test(`${file} stops every non-pass before progression (R8)`, () => {
  const text = read(file);
  assert.match(text, /pass.*only.*continue|continue.*only.*pass/is);
  assert.match(text, /fail.*not_certified.*skipped/is);
  assert.match(text, /do not mark.*complete|must not.*QA|must not.*PR/is);
});

test('timeout remediation stays finite, justified, and conclusive (R8.1)', () => {
  const text = read('skills/verification-before-completion/SKILL.md');
  assert.match(text, /healthy progressing process/is);
  assert.match(text, /finite.*override/is);
  assert.match(text, /rerun.*pass|conclusive rerun/is);
});
```

- [ ] **Step 2: Ejecutar y comprobar rojo**

Run: `cd ../awm-baseline-registry && node tests/r8-sensor-gate-contract.test.mjs`

Expected: FAIL porque `writing-plans` solo invoca preflight estático y los skills no enumeran todos los non-pass.

- [ ] **Step 3: Actualizar skills y autoridad**

En `writing-plans`, mantener `awm preflight` estático para modo interactivo y exigir adicionalmente `awm preflight --verify-sensors` justo antes del handoff cuando el plan dice `desatendido`. Non-zero bloquea el handoff mientras el humano está presente.

En ejecución/verificación: correr `awm sensors run`; continuar solo con `overall: pass`. Ante `fail | not_certified | skipped`, invocar `systematic-debugging`, no marcar checkbox/commit como completo, no avanzar a review/QA/retro/PR. Si la causa es timeout, distinguir proceso colgado de proceso saludable que progresa; solo el segundo permite editar un timeout finito con justificación en el plan/commit y exige rerun `pass`.

- [ ] **Step 4: Bump de skills y prueba discriminante**

Incrementar la versión minor de cada skill modificada y actualizar el contrato de version bumps. Run:

```bash
cd ../awm-baseline-registry
node tests/r8-sensor-gate-contract.test.mjs
bash scripts/check-skill-version-bumps.sh origin/main HEAD
```

Expected: PASS. Retirar temporalmente `not_certified` de una skill de ejecución: el test exacto debe fallar; restaurar.

- [ ] **Step 5: Commit**

```bash
git -C ../awm-baseline-registry add skills/writing-plans skills/executing-plans skills/subagent-driven-development skills/verification-before-completion tests/r8-sensor-gate-contract.test.mjs scripts/check-skill-version-bumps.sh
git -C ../awm-baseline-registry commit -m "fix(workflow): stop unattended work on inconclusive gates"
```

### Task 12: Certificar y publicar el registry coordinado

_Requirements: R3.1, R4, R7.3, R8, R8.1, R9, R9.1, R9.2, R9.3, R10.1, R10.2_

**Files:**
- Modify: `../awm-baseline-registry/awm-registry.json`
- Modify: `../awm-baseline-registry/catalog.json`
- Modify: `../awm-baseline-registry/CHANGELOG.md`
- Modify: `../awm-baseline-registry/.github/workflows/sensor-pack-certification.yml`
- Test: `../awm-baseline-registry/tests/sensor-pack-certification.test.mjs`
- Test: `../awm-baseline-registry/tests/r8-sensor-gate-contract.test.mjs`

**Skills:** `test-driven-development`, `requesting-code-review`, `verification-before-completion`

- [x] **Step 1: Fijar la versión mínima al CLI publicado real**

Editar `awm-registry.json.minCliVersion` con `${CLI_RELEASE_VERSION}` observado en T8, no con una versión anticipada. Actualizar catálogo/changelog mediante el patrón vigente del registry; el cambio breaking debe producir el siguiente major/minor que determine su workflow, sin tag manual.

- [ ] **Step 2: Ejecutar todos los gates locales del registry**

```bash
cd ../awm-baseline-registry
node scripts/validate-portability.mjs
node tests/validate-portability.test.mjs
node tests/codex-session-start.test.mjs
node tests/session-start.test.mjs
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-schema-equivalence.test.mjs
node tests/sensor-pack-js-ts-variants.test.mjs
node tests/sensor-pack-eslint-semantics.test.mjs
node tests/sensor-pack-eslint.test.mjs
node tests/sensor-pack-certification.test.mjs
node tests/sensor-pack-support-matrix.test.mjs
node tests/r8-sensor-gate-contract.test.mjs
```

Expected: todos exit 0, incluyendo proceso real ESLint 8. Ejecutar `git diff --check` y confirmar que no hay rutas temporales, node_modules ni outputs generados staged.

- [x] **Step 3: Review y PR registry**

Invocar `requesting-code-review`, corregir todos los hallazgos con TDD y volver a correr la suite completa. Luego:

```bash
git -C ../awm-baseline-registry add sensor-packs tests skills scripts .github awm-registry.json catalog.json CHANGELOG.md
git -C ../awm-baseline-registry commit -m "feat(sensors)!: publish conclusive execution gates"
git -C ../awm-baseline-registry push -u origin fix/issues-95-98-sensor-gate-honesty
gh pr create --repo Kodria/awm-baseline-registry --base main --head fix/issues-95-98-sensor-gate-honesty --title "feat(sensors)!: publish conclusive execution gates" --body "Completes the registry portion of Kodria/agentic-workflow#98. Requires agentic-workflow-manager >= ${CLI_RELEASE_VERSION}."
gh pr checks --repo Kodria/awm-baseline-registry --watch
```

Expected: PR real y workflows verdes; ninguna publicación antes del CLI.

- [x] **Step 4: Observar merge y auto-tag**

Tras merge autorizado, obtener el tag nuevo con `gh release list --repo Kodria/awm-baseline-registry --limit 5` y verificar que su commit contiene el PR y `minCliVersion=${CLI_RELEASE_VERSION}`. Guardarlo como `REGISTRY_RELEASE_TAG`.

### Task 13: Aceptación publicada, evidencia por issue y reconciliación final

_Requirements: R1, R1.1, R1.2, R1.3, R2, R2.1, R3, R3.1, R3.2, R3.3, R3.4, R4, R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R5, R5.1, R5.2, R6, R6.1, R6.2, R7, R7.1, R7.2, R7.3, R8, R8.1, R9, R9.1, R9.2, R9.3, R10, R10.1, R10.2_

**Files:**
- Create: `docs/research/sensor-gate-honesty/published-acceptance.json`
- Create: `docs/research/sensor-gate-honesty/README.md`
- Modify: `docs/plans/2026-08-21-sensor-gate-honesty-plan.md`

**Skills:** `test-driven-development`, `requesting-code-review`, `verification-before-completion`

- [x] **Step 1: Instalar únicamente artefactos publicados en aislamiento**

Crear directorios con `mktemp -d`, instalar `agentic-workflow-manager@${CLI_RELEASE_VERSION}` con un prefix temporal y clonar/checkout exacto `${REGISTRY_RELEASE_TAG}`. No tocar el home real ni `~/.awm`. Registrar versión, tag y hashes, no paths temporales.

- [x] **Step 2: Ejecutar matriz publicada legacy/v2**

Casos mínimos: legacy baseline, v2 baseline, timeout project/pack/fallback, timeout inválido antes de spawn, changed literal/unsupported/empty/Git error/mixed, cuatro verdicts/exit, status READY sin ejecutar, preflight empírico exit-2 read-only, ESLint 8 TS/JS/generated. Cada caso guarda argv, verdict semántico, process exit y hash del fixture sanitizado.

- [x] **Step 3: Confirmar evidencia nativa 3-OS**

Enlazar las corridas verdes de los PRs/workflows para Ubuntu, macOS y Windows. No sustituir Windows nativo con Wine ni inferir portabilidad desde Linux. `published-acceptance.json` contiene:

```js
const acceptance = {
  cliVersion: process.env.CLI_RELEASE_VERSION,
  registryTag: process.env.REGISTRY_RELEASE_TAG,
  issues: [95, 96, 97, 98],
  platforms: { linux: 'pass', macos: 'pass', windows: 'pass' },
  verdict: 'pass',
};
if (!/^\d+\.\d+\.\d+$/.test(acceptance.cliVersion ?? '')) throw new Error('CLI_RELEASE_VERSION must be an exact stable semver');
if (!/^v\d+\.\d+\.\d+$/.test(acceptance.registryTag ?? '')) throw new Error('REGISTRY_RELEASE_TAG must be an exact v-prefixed tag');
```

Serializar este objeto con newline final. El test de aceptación vuelve a validar ambos formatos y rechaza claves ausentes o valores diferentes de `pass` en la matriz.

- [ ] **Step 4: Reconciliar ambos repos**

```bash
git status --short --branch
git diff origin/main...HEAD --check
git -C ../awm-baseline-registry status --short --branch
git -C ../awm-baseline-registry diff origin/main...HEAD --check
cd cli && npm ci && npm run typecheck && npm run lint && npm run depcheck && npm test -- --runInBand && npm run build
cd ../../awm-baseline-registry && node tests/sensor-pack-certification.test.mjs && node tests/r8-sensor-gate-contract.test.mjs
```

Expected: solo archivos del alcance, suites verdes y ledger del usuario sin stage.

- [ ] **Step 5: Persistir aceptación y comentar issues con evidencia específica**

```bash
git add docs/research/sensor-gate-honesty docs/plans/2026-08-21-sensor-gate-honesty-plan.md
git commit -m "docs(sensors): record published gate acceptance"
```

Comentar #95 con baseline/changed/timeout y PR CLI; #96 con tabla verdict/exit; #97 con status/preflight real; #98 con PR/tag registry y certificación ESLint 8. Cerrar cada issue únicamente si sus criterios están demostrados por links y artefactos publicados; dejar baton exacto para cualquiera que dependa de un estado externo aún pendiente.

- [ ] **Step 6: Review final y transferencia automática**

Invocar `requesting-code-review`, corregir todos los hallazgos, ejecutar `awm preflight --verify-sensors` y `awm sensors run` con `overall: pass`, marcar solo checkboxes realmente completados y transferir a `post-implementation-qa`, `harness-retro` y `finishing-a-development-branch`. Los markers de QA/retro los agregan sus skills, nunca este paso.

## Matriz de trazabilidad

| Req | Task(s) | Test(s) que demuestra el requisito |
|---|---|---|
| R1 | T2, T3, T4, T13 | `prepare.test.ts` adapta ambos kinds; `run.test.ts` ejecuta ambos por `executePrepared`; matriz publicada legacy/v2 |
| R1.1 | T2, T4, T13 | `prepare.test.ts` prueba que command del manifest v2 no se despacha y sí la variante viva; aceptación v2 publicada |
| R1.2 | T2, T4, T13 | `run.test.ts` espía una lectura de baseline, diff y base por corrida; aceptación mixed |
| R1.3 | T2, T4, T13 | `prepare.test.ts` afirma error y cero Git/spawn para changed+capture; CLI e2e publicado |
| R2 | T3, T4, T13 | `baseline.test.ts` suprime finding estructurado exacto; e2e baseline v2 |
| R2.1 | T3, T4, T13 | `baseline.test.ts` tabula inconclusive/skipped sin conversión; aceptación non-pass |
| R3 | T1, T8, T13 | `manifest.test.ts` acepta/preserva timeout v2; core acceptance y manifest publicado |
| R3.1 | T1, T2, T8, T9, T12, T13 | `prepare.test.ts` tabla project/pack/fallback; schema/pack tests; aceptación publicada |
| R3.2 | T3, T8, T13 | `run-inconclusive.test.ts` afirma timeout source/value/elapsed; JSON publicado |
| R3.3 | T1, T2, T13 | corpus inválido de `manifest.test.ts` y spy cero procesos; fixture publicado inválido |
| R3.4 | T1, T3, T8, T9, T13 | `timeout.ts`/`exec.test.ts` rechazan no positivo y siempre programan deadline; schema y aceptación |
| R4 | T1, T9, T13 | corpus `contract.test.ts` + `sensor-pack-schema-equivalence.test.mjs`; pack publicado |
| R4.1 | T2, T8, T9, T13 | `prepare.test.ts` conserva espacio/$ como argv separados; OS matrix y aceptación |
| R4.2 | T2, T4, T8, T9, T13 | `prepare.test.ts` full+reason sin changedCommand; core acceptance |
| R4.3 | T2, T4, T8, T13 | `run-changed.test.ts` Git error → full + evidence; aceptación no-git |
| R4.4 | T2, T4, T8, T13 | `run-changed.test.ts` synthetic pass changed/files:0 sin spawn; aceptación empty |
| R4.5 | T4, T8, T13 | `run-changed.test.ts` mixed empty lint + failing full test → global fail; aceptación mixed |
| R4.6 | T2, T4, T8, T9, T13 | `prepare.test.ts`/`run-changed.test.ts` requested/effective/reason; JSON publicado |
| R5 | T5, T8, T13 | tabla de `index.test.ts` y proceso e2e para los cuatro verdicts |
| R5.1 | T4, T5, T13 | e2e parsea JSON distinto para fail/not_certified/skipped con exit 1 |
| R5.2 | T3, T4, T5, T13 | `run-inconclusive.test.ts` tabla timeout/spawn/overflow/parse/exit; aceptación exit 2 |
| R6 | T6, T8, T13 | `status.test.ts` render READY sin HEALTHY/project certified; binario publicado |
| R6.1 | T6, T8, T13 | tabla READY/DEGRADED/NOT_CONFIGURED en `status.test.ts`; core acceptance |
| R6.2 | T6, T7, T8, T13 | spies cero commands en status/default preflight; aceptación publicada |
| R7 | T7, T8, T13 | `preflight.test.ts` pass/non-pass; e2e `--verify-sensors` publicado |
| R7.1 | T3, T7, T8, T13 | `preflight.test.ts` verifica nombre/timeout/elapsed/reason para cada non-pass |
| R7.2 | T7, T8, T13 | snapshot de tree unit/e2e antes/después; aceptación publicada |
| R7.3 | T11, T12, T13 | `r8-sensor-gate-contract.test.mjs` ancla modo desatendido y preflight empírico; tag publicado |
| R8 | T11, T12, T13 | `r8-sensor-gate-contract.test.mjs` enumera todos los non-pass y prohíbe progreso/QA/PR |
| R8.1 | T11, T12, T13 | test específico de proceso saludable, override finito justificado y rerun concluyente |
| R9 | T10, T12, T13 | certificación real afirma ausencia de base TS false positives/crash |
| R9.1 | T10, T12, T13 | fixture `scripts/unused.js` exige finding base `no-unused-vars` |
| R9.2 | T10, T12, T13 | fixture excluye dist/build/coverage y conserva scripts |
| R9.3 | T10, T12, T13 | `sensor-pack-certification.test.mjs` afirma exit 0/1, JSON válido, TS/JS/generated; aceptación publicada |
| R10 | T1, T4, T8, T9, T13 | tests legacy y v2 sin campos nuevos + aceptación de ambos manifests publicados |
| R10.1 | T8, T9, T12, T13 | T9 bloqueado por npm estable; test/manifest fija `minCliVersion`; hashes publicados |
| R10.2 | T2, T4, T8, T9, T12, T13 | `changed-windows.test.ts`, exec shell:false, CI nativa 3-OS y aceptación enlazada |

## Analyze gate

- Forward: cada requisito R1–R10.2 tiene al menos una task de implementación y una prueba conductual específica.
- Backward: T1–T13 trazan a requisitos; los pasos de release/aceptación verifican R10.1/R10.2 y no introducen producto nuevo.
- No hay tasks UI, artifacts UI ni tracks paralelos.
- Los tipos `TimeoutSource`, `PreparedSensorExecution`, `ExecutionEvidence`, `PreflightOptions` y los campos JSON conservan los mismos nombres en todas las tasks.
- La aceptación final rechaza tokens de sustitución no resueltos antes de commit.
