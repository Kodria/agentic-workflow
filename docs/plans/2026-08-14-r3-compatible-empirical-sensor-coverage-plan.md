# R3 Compatible and Empirical Sensor Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar cobertura de sensores version-aware y empírica, certificada para los cuatro packs oficiales e integrada al ciclo de retrospectiva sin falsos verdes ni mutaciones implícitas.

**Architecture:** Un resolver central del CLI interpreta contratos de pack v2, descubre evidencia local y produce seis estados de compatibilidad consumidos por `init`, `status`, `preflight`, `run` y `coverage`. La cobertura estática conserva la semántica global de R2, incorpora compatibilidad, y se cruza de forma determinista con findings tipados de todos los ledgers del proyecto; el registry declara variantes y certificación, mientras el CLI conserva toda decisión ejecutable y de seguridad.

**Tech Stack:** TypeScript 5.9, Node.js >=22, Commander 14, Jest 30, `semver` 7, procesos `spawn` con argv; JSON/ESM y `node:assert` en `awm-baseline-registry`; GitHub Actions sobre Ubuntu, macOS y Windows; Markdown activo en inglés.

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

- Diseño aprobado: `docs/plans/2026-08-14-r3-compatible-empirical-sensor-coverage-design.md`, commit `7b3b4a1`.
- Brief: `docs/plans/2026-07-30-sdd-cycle-optimization-brief.md`; DA-5 está cerrada por D-015.
- Issues coordinados: `Kodria/agentic-workflow#20` y antecedente absorbido `#70`.
- Base CLI: `main@e28e78c`; rama activa `feat/issue-20-r3-empirical-coverage`.
- Base registry: `main@2bd3930`, tag `v1.16.0`; crear `feat/issue-20-r3-compatible-packs` desde `origin/main` al comenzar T9.
- El ledger no rastreado bajo `cli/.awm/ledger/` es evidencia producida por el harness: no mover, borrar, normalizar ni incluir por accidente en commits.
- Los comandos `awm ledger`, `awm preflight`, `awm context-budget` y `awm sensors` se ejecutan desde la raíz de `agentic-workflow`, salvo que el paso nombre explícitamente el binario compilado bajo `cli/`.
- El trabajo es serial: CLI v7 debe existir antes de elevar `minCliVersion` y publicar packs v2. No se declaran tracks paralelos porque `package-lock.json`, contratos, fixtures, documentación generada y tags son recursos compartidos.
- Dos PRs coordinados son el camino normal: consumidor CLI primero; registry después. El merge/publicación es autoridad externa; si no ha ocurrido, la corrida conserva el objetivo y se detiene únicamente en ese bloqueo explícito, sin reinterpretar el orden.

## Contratos fijados para la ejecución

```ts
type CompatibilityState =
    | 'certified'
    | 'compatible-unverified'
    | 'incompatible'
    | 'missing-tool'
    | 'unverifiable'
    | 'not-applicable';

type StructuredCommand = {
    executable: string;
    resolution: 'node-modules-bin' | 'python-environment' | 'path';
    args: string[];
    fileInput?: { placeholder: '{files}'; extensions: string[] };
};

type CompatibilityEvidence = {
    state: CompatibilityState;
    reason: string;
    variantId: string | null;
    toolVersion: string | null;
    runtimeVersion: string | null;
    certifiedRange: string | null;
    evidence: Array<{ kind: string; status: string; path?: string }>;
};
```

Reglas que ningún implementador puede reinterpretar:

1. Pack v2 y manifiesto de proyecto v2 usan `schemaVersion: 2`; `coverage.schemaVersion` dentro del pack permanece `1`; el envelope JSON público pasa a `2`.
2. Un pack sin `schemaVersion` y un manifiesto sin `schemaVersion` son legacy: siguen operando por la ruta string actual, pero siempre como `compatible-unverified`.
3. Los comandos v2 son lógicos y portables; nunca guardan paths absolutos. El ejecutable se resuelve en cada corrida.
4. Los probes son un enum cerrado de introspección (`version`, `eslint-print-config`, `typescript-show-config`, `semgrep-validate`, `package-script-present`, `config-present`); el registry no puede suministrar un argv ejecutable arbitrario.
5. `spawn(..., { shell: false })` es obligatorio para v2. `shell: true` sobrevive solo en la ruta legacy explícita.
6. `not-applicable` no es éxito. Se excluye del denominador solo cuando todos los detectores de la clase son no aplicables; evidencia empírica posterior produce `applicability-contradiction`.
7. Precedencia de clase: `certified` > `coverage-unverifiable` > `gap` > `not-applicable`.
8. El análisis empírico lee únicamente `.awm/ledger/*.jsonl` y `.awm/ledger/archive/*.jsonl` de la raíz del proyecto, sin búsqueda recursiva de subrepositorios.
9. El estado empírico es: `evidence` si hay findings válidos y cero skips; `partial` si hay findings válidos y skips; `no-evidence` si ambos son cero; `inconclusive` si no hay findings válidos y sí hay skips.
10. Los límites producen reason codes y `omittedEvidenceRefs`; nunca truncan en silencio. `desc`, líneas JSON crudas, environment y salida de probes no aparecen en el reporte.

## Estructura de archivos

| Archivo | Responsabilidad única |
|---|---|
| `cli/src/commands/sensors/compatibility/types.ts` | Tipos v2 de packs, variantes, comandos, evidencia y resolución |
| `cli/src/commands/sensors/compatibility/contract.ts` | Parser fail-closed del pack v2 y normalización legacy |
| `cli/src/commands/sensors/compatibility/manifest.ts` | Parser único de `.awm/sensors.json`, migración y serialización v2 |
| `cli/src/commands/sensors/compatibility/pack-source.ts` | Resolver el pack exacto en orden de registries con lectura contenida |
| `cli/src/commands/sensors/compatibility/discovery.ts` | OS, runtimes, tools, package manager, scripts y configs locales |
| `cli/src/commands/sensors/compatibility/probe.ts` | Probes cerrados, argv, timeout/output bounded y evidencia sanitizada |
| `cli/src/commands/sensors/compatibility/resolve.ts` | Selección pura de variante y seis estados con precedencia única |
| `cli/src/commands/sensors/compatibility/materialize.ts` | Escritura atómica v2, assets seleccionados, preservación y huérfanos |
| `cli/src/commands/sensors/{init,status,run,exec,types}.ts` | Integrar resolver y coexistencia explícita v2/legacy |
| `cli/src/commands/preflight/checks.ts` | Reusar compatibilidad sin reinterpretar estados |
| `cli/src/core/ledger/{types,store,scan}.ts` | `defectClass`, validación durable y scan acotado active/archive |
| `cli/src/commands/sensors/coverage/{contract,evidence,evaluate,resolve,index,render,empirical}.ts` | Cobertura estática v2, análisis empírico y render seguro |
| `cli/src/commands/{ledger,sensors}/index.ts` | `--defect-class`, `--min` y errores CLI antes de I/O |
| `cli/tests/commands/sensors/compatibility/*.test.ts` | Contrato, discovery, probes, resolución y materialización |
| `cli/tests/core/ledger/scan.test.ts` | Límites, active/archive, symlinks y reason codes |
| `cli/tests/commands/sensors/coverage/empirical.test.ts` | Clustering por clase, cruces, status y determinismo |
| `cli/tests/integration/sensor-coverage.e2e.test.ts` | Binario compilado, legacy/v2, read-only y envelope completo |
| `cli/scripts/sensor-support-matrix.ts` | Generar la sección de sensores desde manifests del registry |
| `docs/{framework,configuration,project-setup,runbook,cli-reference,support-matrix,architecture,decisions}.md` | Propietarios editoriales canónicos de R3 |
| `docs/testing/{README,core-acceptance,os-matrix}.md` | Política y evidencia de certificación |
| `sensor-packs/pack.schema.json` | Esquema publicable de autor para pack v2 |
| `sensor-packs/README.md` | Referencia canónica de autores de packs |
| `sensor-packs/SUPPORT.md` | Matriz generada del registry; nunca edición manual |
| `sensor-packs/{generic,js-ts,python,shell}/pack.json` | Variantes, rangos, probes, commands y assets v2 |
| `tests/sensor-pack-{shape,coverage,variants,certification,support-matrix}.test.mjs` | Gates estructurales y reales del registry |
| `tests/r3-retro-contract.test.mjs` | Orden coverage-before-archive y emisión opcional de defect class |
| `scripts/render-sensor-support-matrix.mjs` | Renderer determinista desde los manifests productivos |
| `skills/{harness-retro,setup-sensors,...}` | Integración del feedback y emisión tipada cuando se conoce la clase |
| `.github/workflows/{validate,auto-tag,sensor-pack-certification}.yml` | Certificación 3-OS que bloquea aceptación y tag |

## Orden de entrega

```text
T1 contratos/parsers
 -> T2 discovery/probes/resolver/exec argv
 -> T3 init/materialización/status/preflight/run
 -> T4 cobertura estática v2
 -> T5 ledger tipado y scan bounded
 -> T6 cobertura empírica y CLI
 -> T7 documentación y freshness CLI
 -> T8 aceptación + PR CLI + npm 8.0.0
 -> T9 gate/schema/autores registry
 -> T10 pack js-ts
 -> T11 packs python/shell/generic
 -> T12 retro + certificación + release registry v2.0.0
 -> T13 aceptación publicada, issues y reconciliación final
```

### Task 1: Contratos v2 y frontera única de manifiestos

_Requirements: R1.1, R1.6, R1.7, R7.1, R7.2, R7.4, R7.5, R8.5_

**Files:**
- Create: `cli/src/commands/sensors/compatibility/types.ts`
- Create: `cli/src/commands/sensors/compatibility/contract.ts`
- Create: `cli/src/commands/sensors/compatibility/manifest.ts`
- Create: `cli/tests/commands/sensors/compatibility/contract.test.ts`
- Create: `cli/tests/commands/sensors/compatibility/manifest.test.ts`
- Modify: `cli/src/commands/sensors/types.ts`
- Modify: `cli/src/commands/sensors/coverage/contract.ts`
- Modify: `cli/package.json`
- Modify: `cli/package-lock.json`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir fixtures y tests rojos del pack v2**

```ts
// cli/tests/commands/sensors/compatibility/contract.test.ts
import { parseSensorPack } from '../../../../src/commands/sensors/compatibility/contract';

export const validPackV2 = {
    schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
    sensors: {
        lint: {
            applicability: { allFiles: ['package.json'] },
            variants: [{
                id: 'eslint-10-flat', priority: 100,
                requirements: { tool: 'eslint', toolRange: '>=10.0.0 <11.0.0', runtime: 'node', runtimeRange: '>=20.19.0' },
                certifiedRange: '>=10.0.0 <11.0.0',
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.', '--config', 'eslint.config.awm.mjs', '--format', 'json'] },
                assets: ['eslint.config.awm.mjs'], formatter: 'eslint-llm', probe: { kind: 'eslint-print-config' },
            }],
        },
    },
    coverage: { schemaVersion: 1, classes: { 'lint-errors': {
        description: 'Lint errors', detectors: [{ sensor: 'lint' }],
        remedy: { summary: 'Configure lint', command: 'awm sensors init --pack js-ts' },
    } } },
};

test('accepts pack v2 and keeps nested coverage v1 (R1.1, R7.1, R7.4)', () => {
    expect(parseSensorPack(validPackV2, '/registry/js-ts/pack.json').kind).toBe('v2');
});

test.each([
    [{ ...validPackV2, schemaVersion: 3 }, /unsupported pack schemaVersion 3/],
    [{ ...validPackV2, sensors: { lint: { variants: [] } } }, /variants.*nonempty/],
    [{ ...validPackV2, sensors: { lint: { ...validPackV2.sensors.lint,
        variants: [{ ...validPackV2.sensors.lint.variants[0], id: '../escape' }] } } }, /variant id/],
    [{ ...validPackV2, sensors: { lint: { ...validPackV2.sensors.lint,
        variants: [{ ...validPackV2.sensors.lint.variants[0], assets: ['../secret'] }] } } }, /asset.*relative/],
    [{ ...validPackV2, sensors: { lint: { ...validPackV2.sensors.lint,
        variants: [{ ...validPackV2.sensors.lint.variants[0], command: { executable: 'sh', resolution: 'path', args: ['-c', 'touch pwned'] } }] } } }, /executable|argument/],
    [{ ...validPackV2, coverage: { ...validPackV2.coverage, schemaVersion: 2 } }, /coverage.schemaVersion.*1/],
])('rejects malformed or future contracts %# (R1.6, R7.5)', (input, error) => {
    expect(() => parseSensorPack(input, 'fixture/pack.json')).toThrow(error as RegExp);
});
```

- [x] **Step 2: Ejecutar el corpus rojo**

Run: `cd cli && npx jest tests/commands/sensors/compatibility/contract.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [x] **Step 3: Agregar `semver` como dependencia directa y definir tipos cerrados**

Run: `cd cli && npm install semver@^7.7.4 && npm install --save-dev @types/semver@^7.7.1`

Implementar en `types.ts` los tipos del bloque contractual, `PackV2`, `LegacyPack`, `SensorVariant`, `ProbeKind`, `ManifestV2`, `LegacyManifest` y `ParsedSensorManifest`. Todos los arrays devueltos son copias, todos los enums se validan desde `unknown` y ningún command acepta NUL, saltos de línea, shell (`sh`, `bash`, `cmd`, `powershell`) ni placeholders embebidos dentro de otro argumento.

- [x] **Step 4: Implementar `parseSensorPack` con rangos y solapamientos fail-closed**

```ts
export function parseSensorPack(input: unknown, source: unknown): ParsedPack {
    const root = object(input, source, 'pack');
    if (!('schemaVersion' in root)) return parseLegacyPack(root, source);
    if (root.schemaVersion !== 2) invalid(source, `unsupported pack schemaVersion ${String(root.schemaVersion)}; supported: legacy, 2`);
    const pack = parseV2Pack(root, source);
    for (const [sensor, definition] of Object.entries(pack.sensors)) {
        assertUniqueVariantIds(sensor, definition.variants, source);
        assertNoEqualPriorityOverlap(sensor, definition.variants, source);
    }
    return { kind: 'v2', pack };
}
```

`assertNoEqualPriorityOverlap` usa `semver.intersects`; rangos o versiones inválidas lanzan con source+field. `coverage` se delega al parser v1 existente y no cambia de versión.

- [x] **Step 5: Escribir tests rojos de manifiesto legacy/v2 y migración**

```ts
// cli/tests/commands/sensors/compatibility/manifest.test.ts
test('normalizes a string-command manifest as legacy unverified (R1.4, R7.2)', () => {
    const parsed = parseSensorManifest({ pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } }, 'legacy');
    expect(parsed).toMatchObject({ kind: 'legacy', pack: 'js-ts' });
});

test('accepts v2 selected variant and structured command (R7.2)', () => {
    expect(parseSensorManifest({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: {
        enabled: true, variantId: 'eslint-10-flat',
        command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
        initializedCompatibility: { state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10-flat',
            toolVersion: '10.4.1', runtimeVersion: '24.19.0', certifiedRange: '>=10 <11', evidence: [] },
    } } }, 'v2').kind).toBe('v2');
});

test.each([null, {}, { schemaVersion: 3, pack: 'x', sensors: {} },
    { schemaVersion: 2, pack: 'x', sensors: { lint: { command: { executable: '', resolution: 'path', args: [] } } } }])
    ('rejects impossible manifests %# (R7.5, R8.5)', (input) => {
        expect(() => parseSensorManifest(input, 'fixture/.awm/sensors.json')).toThrow();
    });
```

- [x] **Step 6: Implementar el parser único y retirar la duplicación de coverage**

`compatibility/manifest.ts` exporta `parseSensorManifest`, `serializeManifestV2` y `legacyCompatibility`. `coverage/contract.ts` conserva solo `parseCoverageContract` y tipos del catálogo; todos los consumidores importarán el parser de manifiesto nuevo en tareas posteriores.

- [x] **Step 7: Ejecutar tests, probar mutación y commit**

Run:

```bash
cd cli
npx jest tests/commands/sensors/compatibility/contract.test.ts tests/commands/sensors/compatibility/manifest.test.ts tests/commands/sensors/coverage/contract.test.ts --runInBand
npm run typecheck
```

Expected: PASS. Mutación: cambiar temporalmente `root.schemaVersion !== 2` por `!== 3`; el caso future debe fallar. Restaurar, confirmar PASS.

Commit:

```bash
git add cli/package.json cli/package-lock.json cli/src/commands/sensors/types.ts cli/src/commands/sensors/compatibility cli/src/commands/sensors/coverage/contract.ts cli/tests/commands/sensors/compatibility cli/tests/commands/sensors/coverage/contract.test.ts
git commit -m "feat(sensors)!: add versioned compatibility contracts"
```

### Task 2: Discovery, probes cerrados y resolución determinista

_Requirements: R1.2, R1.3, R1.4, R1.5, R2.1, R2.2, R2.7, R2.8, R8.4, R9.1_

**Files:**
- Create: `cli/src/commands/sensors/compatibility/pack-source.ts`
- Create: `cli/src/commands/sensors/compatibility/discovery.ts`
- Create: `cli/src/commands/sensors/compatibility/probe.ts`
- Create: `cli/src/commands/sensors/compatibility/resolve.ts`
- Create: `cli/tests/commands/sensors/compatibility/pack-source.test.ts`
- Create: `cli/tests/commands/sensors/compatibility/discovery.test.ts`
- Create: `cli/tests/commands/sensors/compatibility/probe.test.ts`
- Create: `cli/tests/commands/sensors/compatibility/resolve.test.ts`
- Modify: `cli/src/commands/sensors/exec.ts`
- Modify: `cli/tests/commands/sensors/exec.test.ts`
- Modify: `cli/tests/commands/sensors/exec-windows.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos del executor argv y probes**

```ts
test('passes metacharacters literally with shell false (R2.8)', async () => {
    const marker = path.join(tmp, 'must-not-exist');
    const result = await runStructuredCommand({ executable: process.execPath, resolution: 'path',
        args: ['-e', 'process.stdout.write(process.argv[1])', `;touch ${marker}`] }, { cwd: tmp, timeout: 5_000 });
    expect(result.stdout).toContain(`;touch ${marker}`);
    expect(fs.existsSync(marker)).toBe(false);
});

test.each(['eslint-print-config', 'typescript-show-config', 'semgrep-validate', 'version'] as const)
    ('runs the closed probe %s and sanitizes output (R2.8, R8.4)', async (kind) => {
        const result = await runCompatibilityProbe({ kind }, fixtureEvidence, fakeExecutor);
        expect(result).toEqual(expect.objectContaining({ status: expect.stringMatching(/matched|unverifiable/) }));
        expect(JSON.stringify(result)).not.toContain('SECRET_VALUE');
    });
```

- [x] **Step 2: Ejecutar tests rojos**

Run: `cd cli && npx jest tests/commands/sensors/compatibility/probe.test.ts tests/commands/sensors/exec.test.ts --runInBand`

Expected: FAIL por exports inexistentes.

- [x] **Step 3: Implementar executor estructurado preservando legacy**

```ts
export function runStructuredCommand(command: ResolvedCommand, opts: ExecOptions): Promise<ExecResult> {
    validateResolvedCommand(command);
    return collectSpawn(command.executablePath, command.args, { ...opts, shell: false });
}

export function runCommand(cmd: string, opts: ExecOptions): Promise<ExecResult> {
    if (typeof cmd !== 'string' || cmd.trim() === '') throw new Error('runCommand: cmd must be a non-empty legacy string');
    return collectSpawn(cmd, [], { ...opts, shell: true });
}
```

Extraer `collectSpawn` sin cambiar timeout, overflow ni kill-tree. En Windows resolver `.cmd`/`.exe` con PATHEXT sin insertar shell para ejecutables reales; wrappers `.cmd` legacy permanecen por la ruta legacy y nunca certifican v2.

- [x] **Step 4: Implementar discovery y fuente exacta del pack**

`discoverProjectEvidence(cwd, pack)` retorna OS, runtime/tool versions, `packageManager`, conflictos de lockfiles, scripts y configs como paths relativos. `resolvePackSource` recorre `listRegistries()` y elige el primer registry que contenga exactamente `sensor-packs/<pack>/pack.json`; verifica archivo regular, realpath contenido y máximo 1 MiB.

- [x] **Step 5: Escribir el corpus rojo de los seis estados y precedencia**

```ts
test.each([
    ['certified', evidence({ tool: '10.4.1', probe: 'matched' }), 'eslint-10-flat'],
    ['compatible-unverified', evidence({ tool: '11.0.0', operational: true, probe: 'matched' }), 'eslint-future'],
    ['incompatible', evidence({ tool: '7.32.0', operational: false }), null],
    ['missing-tool', evidence({ tool: null }), null],
    ['unverifiable', evidence({ tool: '10.4.1', probe: 'inconclusive' }), 'eslint-10-flat'],
    ['not-applicable', evidence({ applicable: false }), null],
])('resolves %s without conflating states (R1.2-R1.4, R2.2)', (state, discovered, variantId) => {
    expect(resolveSensorCompatibility(validPackV2.sensors.lint, discovered)).toMatchObject({ state, variantId });
});

test('fails an equal-priority match instead of using array order (R1.5)', () => {
    expect(() => resolveSensorCompatibility(ambiguousSensor, evidence({ tool: '10.4.1' }))).toThrow(/ambiguous.*variant/);
});

test('reports conflicting lockfiles as unverifiable (R2.7)', () => {
    expect(resolveProjectCompatibility(projectWith('package-lock.json', 'pnpm-lock.yaml'), pack))
        .toMatchObject({ sensors: { lint: { state: 'unverifiable', reason: 'package-manager-conflict' } } });
});
```

- [x] **Step 6: Implementar probes y resolver puro**

El resolver filtra aplicabilidad, ordena por `priority` descendente y especificidad, y exige un único ganador. `certified` requiere rango certificado y probe `matched`; rango operativo+probe sin certificación produce `compatible-unverified`; fallo concluyente de rango produce `incompatible`; ausencia produce `missing-tool`; evidencia incompleta produce `unverifiable`. Legacy llama `legacyCompatibility()` y nunca ejecuta probe declarativo.

- [x] **Step 7: Ejecutar corpus, mutaciones y commit**

Run:

```bash
cd cli
npx jest tests/commands/sensors/compatibility tests/commands/sensors/exec.test.ts tests/commands/sensors/exec-windows.test.ts --runInBand
npm run typecheck
```

Expected: PASS. Mutaciones discriminantes: (a) ejecutar structured con `shell:true`; (b) convertir futuro operativo en certified; (c) elegir primer empate. Cada test específico debe quedar rojo, luego restaurar.

Commit:

```bash
git add cli/src/commands/sensors/compatibility cli/src/commands/sensors/exec.ts cli/tests/commands/sensors/compatibility cli/tests/commands/sensors/exec.test.ts cli/tests/commands/sensors/exec-windows.test.ts
git commit -m "feat(sensors): resolve toolchain compatibility safely"
```

### Task 3: Inicialización v2, materialización selectiva y revalidación en el ciclo

_Requirements: R2.3, R2.4, R2.5, R2.6, R6.1, R6.2, R6.3, R7.2_

**Files:**
- Create: `cli/src/commands/sensors/compatibility/materialize.ts`
- Create: `cli/tests/commands/sensors/compatibility/materialize.test.ts`
- Modify: `cli/src/commands/sensors/init.ts`
- Modify: `cli/src/commands/sensors/status.ts`
- Modify: `cli/src/commands/sensors/run.ts`
- Modify: `cli/src/commands/sensors/index.ts`
- Modify: `cli/src/commands/preflight/checks.ts`
- Modify: `cli/src/core/init/steps.ts`
- Modify: `cli/tests/commands/sensors/init.test.ts`
- Modify: `cli/tests/commands/sensors/init-pack-unavailable.test.ts`
- Modify: `cli/tests/commands/sensors/status.test.ts`
- Modify: `cli/tests/commands/sensors/status-windows.test.ts`
- Modify: `cli/tests/commands/sensors/run.test.ts`
- Modify: `cli/tests/commands/sensors/run-changed.test.ts`
- Modify: `cli/tests/commands/sensors/run-is-read-only.test.ts`
- Modify: `cli/tests/commands/preflight/preflight.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos de materialización y preservación**

```ts
test('copies only selected assets and writes manifest v2 atomically (R2.3)', async () => {
    const result = await materializeResolvedSensors({ projectRoot, packRoot, resolutions: certifiedLintOnly });
    expect(result.configured).toEqual(['eslint.config.awm.mjs']);
    expect(fs.existsSync(path.join(projectRoot, 'tsconfig.awm.json'))).toBe(false);
    expect(readJson('.awm/sensors.json')).toMatchObject({ schemaVersion: 2,
        sensors: { lint: { variantId: 'eslint-10-flat' } } });
});

test('preserves a modified destination and reports it (R2.4)', async () => {
    fs.writeFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'owner content');
    const before = hashTree(projectRoot);
    const result = await materializeResolvedSensors(input);
    expect(result.preserved).toEqual(['eslint.config.awm.mjs']);
    expect(fs.readFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'utf8')).toBe('owner content');
    expect(hashWithoutManifest(projectRoot)).toBe(before);
});

test('reports old AWM asset as orphaned and never deletes it (R2.5)', async () => {
    seedOldManifestWithAsset('eslint.config.awm.cjs');
    const result = await materializeResolvedSensors(inputFor('eslint-10-flat'));
    expect(result.orphaned).toEqual(['eslint.config.awm.cjs']);
    expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.cjs'))).toBe(true);
});
```

- [x] **Step 2: Ejecutar tests rojos**

Run: `cd cli && npx jest tests/commands/sensors/compatibility/materialize.test.ts tests/commands/sensors/init.test.ts --runInBand`

Expected: FAIL por materializador inexistente y manifest legacy actual.

- [x] **Step 3: Implementar materialización transaccional**

`materializeResolvedSensors` valida root/paths, calcula assets desde la variante, usa archivos temporales+rename para cada asset y manifest, y hace rollback best-effort de archivos que creó si falla antes del commit del manifest. Un destino existente jamás se reemplaza. Huérfanos se derivan de `initializedAssets` del manifest previo y solo se reportan.

- [x] **Step 4: Reescribir `initSensors` como orquestador async del resolver**

```ts
export async function initSensors(opts: InitOptions = {}): Promise<InitResult> {
    const cwd = validateProjectRoot(opts.cwd ?? process.cwd());
    const detection = opts.pack ? explicitDetection(opts.pack) : detectStack(cwd);
    const source = resolvePackSource(detection.pack, { registryRoot: opts.registryRoot });
    const existing = readExistingManifestFailClosed(cwd);
    const compatibility = await resolveProjectCompatibility({ cwd, parsedPack: source.pack });
    const materialized = await materializeResolvedSensors({ cwd, source, existing, compatibility,
        configure: opts.configure ?? true });
    return { detection, compatibility, ...materialized };
}
```

Un manifest corrupto o future-version falla sin sobrescribir. `--no-configure` escribe selección/evidencia, pero no assets. Pack ausente conserva el fallback honesto actual.

- [x] **Step 5: Escribir tests rojos de revalidación compartida**

```ts
test.each(['status', 'preflight', 'run'] as const)('%s re-resolves live drift (R2.6, R6.2, R6.3)', async (consumer) => {
    const deps = dependencyHarness({ manifestVariant: 'eslint-9-flat', liveTool: '10.4.1' });
    const result = await invokeConsumer(consumer, deps);
    expect(result).toEqual(expect.objectContaining({ reason: 'variant-drift' }));
    expect(deps.resolveProjectCompatibility).toHaveBeenCalledTimes(1);
});

test('run never dispatches a known incompatible command (R6.3)', async () => {
    const executor = jest.fn();
    const result = await runSensors({ all: true }, depsWithState('incompatible', executor));
    expect(executor).not.toHaveBeenCalled();
    expect(result.overall).toBe('not_certified');
});
```

- [x] **Step 6: Integrar status, preflight y run sin cambiar sus propietarios**

`computeSensorStatus` traduce resolver state: certified sano; compatible-unverified/unverifiable degradado; incompatible/missing-tool degradado; not-applicable informativo. `checkTools` consume ese resultado. `runSensors` parsea manifest por la frontera única, re-resuelve, ejecuta v2 con `runStructuredCommand`, expande `{files}` como argumentos separados y ejecuta legacy con `runCommand`, siempre degradando la certificación legacy.

- [x] **Step 7: Probar read-only y regresión completa dirigida**

Run:

```bash
cd cli
npx jest tests/commands/sensors/init.test.ts tests/commands/sensors/init-pack-unavailable.test.ts tests/commands/sensors/status.test.ts tests/commands/sensors/status-windows.test.ts tests/commands/sensors/run.test.ts tests/commands/sensors/run-changed.test.ts tests/commands/sensors/run-is-read-only.test.ts tests/commands/preflight/preflight.test.ts --runInBand
npm run typecheck
```

Expected: PASS. Mutación: retirar la revalidación de `run`; `variant-drift` debe quedar rojo. Restaurar.

- [x] **Step 8: Commit**

```bash
git add cli/src/commands/sensors cli/src/commands/preflight/checks.ts cli/src/core/init/steps.ts cli/tests/commands/sensors cli/tests/commands/preflight/preflight.test.ts
git commit -m "feat(sensors): materialize and revalidate compatible variants"
```

### Task 4: Cobertura estática v2 con compatibilidad honesta

_Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R7.3, R7.4_

**Files:**
- Modify: `cli/src/commands/sensors/coverage/contract.ts`
- Modify: `cli/src/commands/sensors/coverage/evidence.ts`
- Modify: `cli/src/commands/sensors/coverage/evaluate.ts`
- Modify: `cli/src/commands/sensors/coverage/resolve.ts`
- Modify: `cli/src/commands/sensors/coverage/index.ts`
- Modify: `cli/src/commands/sensors/coverage/render.ts`
- Modify: `cli/tests/commands/sensors/coverage/contract.test.ts`
- Modify: `cli/tests/commands/sensors/coverage/evidence.test.ts`
- Modify: `cli/tests/commands/sensors/coverage/evaluate.test.ts`
- Modify: `cli/tests/commands/sensors/coverage/resolve.test.ts`
- Modify: `cli/tests/commands/sensors/coverage/index.test.ts`
- Modify: `cli/tests/commands/sensors/coverage/render.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tablas rojas de precedencia**

```ts
test.each([
    [['certified', 'incompatible'], 'covered'],
    [['compatible-unverified', 'missing-tool'], 'unverifiable'],
    [['unverifiable', 'not-applicable'], 'unverifiable'],
    [['incompatible', 'not-applicable'], 'missing'],
    [['not-applicable', 'not-applicable'], 'not-applicable'],
] as const)('reduces detector states %p to %s (R3.1-R3.4, R3.7)', (states, expected) => {
    expect(evaluateCoverageClass(classContract, observationsFor(states)).status).toBe(expected);
});

test('empirical evidence contradicts not-applicable (R3.5)', () => {
    expect(crossEmpiricalOutcome('not-applicable', true)).toBe('applicability-contradiction');
});

test('overall keeps R2 static semantics (R3.6)', () => {
    expect(evaluateCoverage(contract, observations).overall).toBe('gaps');
});
```

- [x] **Step 2: Ejecutar tabla roja**

Run: `cd cli && npx jest tests/commands/sensors/coverage/evaluate.test.ts --runInBand`

Expected: FAIL porque `not-applicable` y compatibilidad no existen.

- [x] **Step 3: Adjuntar evidencia de compatibilidad sanitizada**

`observeDetector` recibe `CompatibilityResolution` y produce el status R2 más `compatibility`. El renderer solo acepta `state`, reason code, variant ID, versiones normalizadas, rango y evidencia sanitizada; rechaza full command, raw output, environment y fields desconocidos.

- [x] **Step 4: Implementar el reducer y envelope v2**

```ts
const rank: Record<CoverageClassStatus, number> = {
    covered: 4, unverifiable: 3, missing: 2, 'not-applicable': 1,
};

export function reduceClassStatus(detectors: DetectorObservation[]): CoverageClassStatus {
    if (!Array.isArray(detectors) || detectors.length === 0) throw new Error('coverage class requires detectors');
    return detectors.map(toClassStatus).sort((a, b) => rank[b] - rank[a])[0];
}
```

`CoverageEnvelope.schemaVersion` pasa a 2; `overall` sigue `gaps` si hay missing, `inconclusive` si no hay missing y hay unverifiable, `covered` si el resto es covered/not-applicable y existe al menos una clase aplicable cubierta. Cero clases aplicables es `inconclusive`, nunca covered.

- [x] **Step 5: Actualizar resolución y render exhaustivo**

`resolveCoverageInputs` siempre devuelve `projectRoot`, usa parser de manifest único y pack-source central. `renderCoverageJson` valida static+compatibility aun cuando reason sea `not_configured`/`no_reference`; `renderCoverageHuman` nombra gaps y estados inciertos, omite clases cubiertas y N/A del cuerpo, y resume todas las categorías.

- [x] **Step 6: Ejecutar tests, mutación y commit**

Run:

```bash
cd cli
npx jest tests/commands/sensors/coverage --runInBand
npm run typecheck
```

Expected: PASS. Mutación: invertir `unverifiable`/`missing` en `rank`; el caso mixto debe fallar. Restaurar.

Commit:

```bash
git add cli/src/commands/sensors/coverage cli/tests/commands/sensors/coverage
git commit -m "feat(sensors): make static coverage compatibility-aware"
```

### Task 5: `defectClass` y lectura acotada de ledgers activos/archivados

_Requirements: R5.1, R5.2, R5.3, R5.11, R5.12, R8.1, R8.2, R8.3_

**Files:**
- Modify: `cli/src/core/ledger/types.ts`
- Modify: `cli/src/core/ledger/store.ts`
- Create: `cli/src/core/ledger/scan.ts`
- Modify: `cli/src/commands/ledger/index.ts`
- Create: `cli/tests/core/ledger/scan.test.ts`
- Modify: `cli/tests/core/ledger/store.test.ts`
- Modify: `cli/tests/commands/ledger/index.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos del flag y gramática**

```ts
test('persists an optional reusable defect class (R5.2)', () => {
    invokeLedgerAdd(['--polarity', 'finding', '--class', 'logica', '--signature', 'x',
        '--severity', 'important', '--desc', 'private detail', '--defect-class', 'lint-errors']);
    expect(readLastEntry()).toMatchObject({ defectClass: 'lint-errors' });
});

test.each(['', 'Bad_ID', '../escape', 'a b', '-leading', 'trailing-'])
    ('rejects invalid defect class %p before write (R5.11)', (value) => {
        const before = snapshotLedger();
        expect(() => invokeLedgerAdd([...requiredArgs, '--defect-class', value])).toThrow(/defect-class.*kebab-case/);
        expect(snapshotLedger()).toBe(before);
    });

test('keeps an entry without defectClass valid and unclassified (R5.3)', () => {
    expect(parseLedgerEntry(legacyEntry, 'line 1')).toMatchObject({ defectClass: undefined });
});
```

- [x] **Step 2: Ejecutar tests rojos**

Run: `cd cli && npx jest tests/commands/ledger/index.test.ts tests/core/ledger/store.test.ts --runInBand`

Expected: FAIL por option/type inexistente.

- [x] **Step 3: Implementar parser durable completo y CLI**

```ts
export const DEFECT_CLASS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function parseLedgerEntry(input: unknown, source: string): LedgerParseResult {
    if (!isRecord(input)) return malformed(source, 'not-object');
    if (!isPolarity(input.polarity) || !isLedgerClass(input.class) || !isSeverity(input.severity))
        return malformed(source, 'invalid-enum');
    if ('defectClass' in input && (typeof input.defectClass !== 'string' || !DEFECT_CLASS.test(input.defectClass)))
        return malformed(source, 'invalid-defect-class');
    return valid(copyLedgerEntry(input));
}
```

`ledger add` valida el flag antes de construir/escribir. `listEntries` conserva tolerancia legacy, usa el parser y omite malformed sin cambiar su retorno público.

- [x] **Step 4: Escribir corpus rojo del scan bounded**

```ts
test('reads direct active and archive files in deterministic order (R5.1)', () => {
    seedLedger('b.jsonl', finding('lint-errors'));
    seedArchive('a-2026.jsonl', finding('static-type-errors'));
    const scan = scanProjectLedgers(root);
    expect(scan.entries.map((e) => e.source)).toEqual([
        '.awm/ledger/b.jsonl:1', '.awm/ledger/archive/a-2026.jsonl:1',
    ].sort());
});

test.each(['external-symlink', 'directory-entry', 'oversize-file', 'too-many-files', 'invalid-json', 'invalid-defect-class'])
    ('reports %s without following or hiding it (R5.12, R8.1, R8.2)', (fixture) => {
        const scan = scanProjectLedgers(buildFixture(fixture), TEST_LIMITS);
        expect(scan.sources.skippedFindings).toBeGreaterThan(0);
        expect(scan.sources.skippedByReason).toHaveProperty(reasonFor(fixture));
    });
```

- [x] **Step 5: Implementar `scanProjectLedgers`**

Límites iniciales constantes y configurables por dependencia de test: 256 archivos, 4 MiB por archivo, 20 000 líneas/entries, 64 KiB por línea, 128 refs renderizables por clase y profundidad JSON 16. Usar `lstat`+`realpath`, rechazar symlinks/nonregular/escape, leer solo los dos directorios directos y ordenar path+línea. Wins se parsean y contabilizan como válidos, pero `validFindings` y la salida de análisis solo incluyen findings.

- [x] **Step 6: Probar sanitización, mutación y commit**

Run:

```bash
cd cli
npx jest tests/core/ledger tests/commands/ledger/index.test.ts --runInBand
npm run typecheck
```

Expected: PASS. Mutación: reemplazar `lstatSync` por `statSync`; fixture symlink debe fallar. Restaurar.

Commit:

```bash
git add cli/src/core/ledger cli/src/commands/ledger/index.ts cli/tests/core/ledger cli/tests/commands/ledger/index.test.ts
git commit -m "feat(ledger): record defect classes and scan evidence safely"
```

### Task 6: Analizador empírico, `--min` y envelope completo

_Requirements: R5.4, R5.5, R5.6, R5.7, R5.8, R5.9, R5.10, R6.6, R6.7, R9.3_

**Files:**
- Create: `cli/src/commands/sensors/coverage/empirical.ts`
- Create: `cli/tests/commands/sensors/coverage/empirical.test.ts`
- Modify: `cli/src/commands/sensors/coverage/index.ts`
- Modify: `cli/src/commands/sensors/coverage/render.ts`
- Modify: `cli/src/commands/sensors/index.ts`
- Modify: `cli/tests/commands/sensors/coverage/index.test.ts`
- Modify: `cli/tests/commands/sensors/coverage/render.test.ts`
- Modify: `cli/tests/commands/sensors/index.test.ts`
- Modify: `cli/tests/integration/sensor-coverage.e2e.test.ts`
- Modify: `cli/tests/fixtures/sensor-coverage/**`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir corpus rojo de clustering y outcomes**

```ts
test('clusters only inside defectClass and keeps singles below min (R5.4, R5.6)', () => {
    const report = evaluateEmpiricalCoverage(scanOf([
        finding('lint-errors', 'same-signature', 'a.ts:1'),
        finding('static-type-errors', 'same-signature', 'b.ts:1'),
    ]), staticCoveredFixture(), 2);
    expect(report.classes).toHaveLength(2);
    expect(report.classes.every((c) => c.occurrences === 1 && c.recurrent === false)).toBe(true);
});

test.each([
    ['covered', 'covered-by-sensor'], ['missing', 'gap'], ['incompatible', 'gap'],
    ['missing-tool', 'gap'], ['unverifiable', 'coverage-unverifiable'],
    ['compatible-unverified', 'coverage-unverifiable'], ['not-applicable', 'applicability-contradiction'],
] as const)('crosses %s to %s (R5.9)', (staticState, outcome) => {
    expect(outcomeFor(staticState, true)).toBe(outcome);
});

test('does not infer missing class from text (R5.3, R5.10)', () => {
    const report = evaluateEmpiricalCoverage(scanOf([{ ...finding(undefined), desc: 'lint-errors' }]), staticFixture(), 2);
    expect(report.unclassified.occurrences).toBe(1);
    expect(report.classes).toEqual([]);
});
```

- [x] **Step 2: Ejecutar corpus rojo**

Run: `cd cli && npx jest tests/commands/sensors/coverage/empirical.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [x] **Step 3: Implementar analizador puro y sanitización de evidencia**

Agrupar findings con clase, llamar `clusterEntries(group, 1)`, remover `entries` del output, calcular severidad por `blocker > important > minor > info`, deduplicar/sortear refs permitiendo solo path relativo con línea, `PR #n` o hash; retirar ANSI/OSC/controls y limitar a 256 chars. `omittedEvidenceRefs` registra el excedente. `unclassified` solo lleva count+refs, nunca desc/signature inferida.

- [x] **Step 4: Fijar parser de `--min` antes de I/O**

```ts
export function parsePositiveSafeInteger(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value)) throw new InvalidArgumentError('--min must be a positive safe integer');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new InvalidArgumentError('--min must be a positive safe integer');
    return parsed;
}

sensors.command('coverage')
    .option('--json', 'emit the versioned machine-readable envelope')
    .option('--min <count>', 'recurrence emphasis threshold', parsePositiveSafeInteger, 2);
```

Tests `0`, `-1`, `1.5`, `2x`, `Infinity`, `NaN` y overflow deben afirmar que `runCoverage` no fue llamado.

- [x] **Step 5: Integrar análisis incluso con static inconclusive**

`runCoverage(cwd, { min, ...deps })` siempre escanea el ledger y emite empirical. `not_configured`/`no_reference` no hacen early return antes del análisis; findings con static no disponible son `coverage-unverifiable`. `overall` y exit siguen estáticos. `render.ts` valida exhaustivamente empirical, including impossible counters/status, y muestra resumen humano.

- [x] **Step 6: Extender E2E read-only**

Fixture con ledger activo+archive, finding tipado, unclassified, win y línea malformed. Ejecutar binario compilado con default y `--min 3`; comparar hashes de proyecto y AWM_HOME antes/después; afirmar schema 2, static estable, empirical partial, singles visibles y cero `desc`/secretos en stdout.

- [x] **Step 7: Ejecutar tests, mutaciones y commit**

Run:

```bash
cd cli
npx jest tests/commands/sensors/coverage tests/commands/sensors/index.test.ts tests/integration/sensor-coverage.e2e.test.ts --runInBand
npm run build
```

Expected: PASS. Mutaciones: (a) volver a `clusterEntries(group,min)` debe ocultar singles y fallar; (b) cambiar overall según empirical debe fallar; (c) eco de `desc` debe fallar el test de secreto. Restaurar.

Commit:

```bash
git add cli/src/commands/sensors/coverage cli/src/commands/sensors/index.ts cli/tests/commands/sensors/coverage cli/tests/commands/sensors/index.test.ts cli/tests/integration/sensor-coverage.e2e.test.ts cli/tests/fixtures/sensor-coverage
git commit -m "feat(sensors): report deterministic empirical coverage"
```

### Task 7: Documentación canónica y freshness del CLI

_Requirements: R10.1, R10.2, R10.4, R10.5, R10.6, R10.7, R10.8, R10.9, R10.10, R10.11, R10.12, R10.14_

**Files:**
- Modify: `docs/framework.md`
- Modify: `docs/configuration.md`
- Modify: `docs/project-setup.md`
- Modify: `docs/runbook.md`
- Modify: `docs/cli-reference.md`
- Modify: `docs/support-matrix.md`
- Modify: `docs/architecture.md`
- Modify: `docs/testing/README.md`
- Modify: `docs/testing/core-acceptance.md`
- Modify: `docs/testing/os-matrix.md`
- Modify: `docs/decisions.md`
- Modify: `CHANGELOG.md`
- Modify: `cli/package.json`
- Modify: `cli/scripts/support-matrix.ts`
- Create: `cli/scripts/sensor-support-matrix.ts`
- Modify: `cli/tests/structural/active-documentation.test.ts`
- Modify: `cli/tests/structural/support-matrix-is-current.test.ts`
- Create: `cli/tests/structural/sensor-documentation-contract.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos por propietario canónico**

```ts
test.each([
    ['docs/framework.md', ['Static coverage', 'Empirical coverage', 'retrospective feedback loop']],
    ['docs/configuration.md', ['pack schema v2', 'legacy pack', 'compatible-unverified']],
    ['docs/project-setup.md', ['version-aware', 'hardening opt-in']],
    ['docs/runbook.md', ['awm sensors coverage --min', 'compatibility drift', 'orphaned asset']],
    ['docs/cli-reference.md', ['schemaVersion: 2', '--defect-class', '--min']],
    ['docs/architecture.md', ['compatibility resolver', 'bounded probe']],
] as const)('%s owns its R3 subject (R10.1-R10.7)', (file, phrases) => {
    const text = read(file);
    phrases.forEach((phrase) => expect(text).toContain(phrase));
});

test('parses every documented v2 example with production parsers (R10.10)', () => {
    for (const example of fencedJsonExamples(['docs/configuration.md', 'docs/cli-reference.md'])) {
        expect(() => parseDocumentedSensorExample(example)).not.toThrow();
    }
});

test('documents exact Commander flags (R10.9)', () => {
    expect(compiledHelp('sensors coverage')).toContain('--min <count>');
    expect(compiledHelp('ledger add')).toContain('--defect-class <stable-id>');
    expect(read('docs/cli-reference.md')).toContain('--min <count>');
});
```

- [x] **Step 2: Ejecutar contrato documental rojo**

Run: `cd cli && npx jest tests/structural/sensor-documentation-contract.test.ts --runInBand`

Expected: FAIL por contenido y generator inexistentes.

- [x] **Step 3: Extender el generador de matriz sin editar tablas manualmente**

`sensor-support-matrix.ts` recibe `--registry-root`, parsea los cuatro manifests con `parseSensorPack`, genera solo entre `BEGIN/END GENERATED: sensor-pack-support`, y expone función pura. `cli/package.json` hace que `npm run docs:matrix` ejecute, en orden, el renderer existente y el renderer de sensores. `support-matrix-is-current.test.ts` usa una fixture v2 inicialmente byte-equivalente a los manifests que se entregarán en T10/T11; T13 coteja el tag productivo exacto.

- [x] **Step 4: Actualizar cada documento en inglés y una sola vez**

Aplicar el mapa del diseño: framework explica el loop; configuration enlaza a `sensor-packs/README.md`; project setup cubre new/legacy y niveles; runbook cubre retro/manual/drift; CLI reference define flags/states/exits/envelope; support matrix es generada; architecture define fronteras; testing define la matriz; decisions registra compatibilidad, falso verde, schemas y retro placement; changelog marca breaking y migración. README/hub solo cambian si hace falta un enlace, no contenido duplicado.

- [x] **Step 5: Ejecutar freshness, links, idioma y mutación**

Run:

```bash
cd cli
npm run build
npm run docs:matrix
npx jest tests/structural/active-documentation.test.ts tests/structural/support-matrix-is-current.test.ts tests/structural/sensor-documentation-contract.test.ts --runInBand
```

Expected: PASS y `git diff --exit-code docs/support-matrix.md` después de regenerar. Mutación: cambiar un flag documentado a `--minimum`; contrato debe fallar. Restaurar.

- [x] **Step 6: Commit**

```bash
git add docs/framework.md docs/configuration.md docs/project-setup.md docs/runbook.md docs/cli-reference.md docs/support-matrix.md docs/architecture.md docs/testing docs/decisions.md CHANGELOG.md cli/package.json cli/scripts cli/tests/structural
git commit -m "docs(sensors): explain compatible empirical coverage"
```

### Task 8: Certificación CLI, regresión completa y PR consumidor

_Requirements: R7.6, R7.8, R9.1, R9.3, R10.13_

**Files:**
- Create: `cli/tests/fixtures/sensor-compatibility/**`
- Modify: `cli/tests/integration/sensor-coverage.e2e.test.ts`
- Create: `cli/tests/integration/sensor-compatibility.e2e.test.ts`
- Create: `docs/research/r3/README.md`
- Create: `docs/research/r3/cli-contract.json`

**Skills:** `test-driven-development`, `requesting-code-review`, `verification-before-completion`

- [x] **Step 1: Crear E2E rojo para legacy, v2 y drift**

```ts
test.each(['linux', 'darwin', 'win32'] as const)('keeps compatibility semantics on %s (R9.1)', async (platform) => {
    const result = await runIsolatedFixture({ platform, manifest: 'v2', pack: 'v2', toolVersion: '10.4.1' });
    expect(result.coverage.static.classes.find((c) => c.id === 'lint-errors'))
        .toMatchObject({ status: 'covered', detectors: [{ compatibility: { state: 'certified' } }] });
});

test('legacy runs but never certifies and init migrates explicitly (R7.2, R7.8)', async () => {
    const before = await runIsolatedFixture({ manifest: 'legacy', action: 'coverage' });
    expect(before.coverage.overall).toBe('inconclusive');
    const migrated = await runIsolatedFixture({ manifest: 'legacy', action: 'init' });
    expect(migrated.manifest.schemaVersion).toBe(2);
});
```

- [x] **Step 2: Integrar fixtures portables y la matriz CI**

Fixtures nunca dependen de binarios globales: tools fake controlados emiten versiones/probe output. La matriz real de release sigue Ubuntu/macOS/Windows Node 22. Añadir E2E a suite Jest normal, no job opcional.

- [x] **Step 3: Ejecutar suite CLI completa y sensores reales**

Run desde raíz:

```bash
cd cli
npm ci
npm run typecheck
npm test -- --runInBand
npm run build
cd ..
node cli/dist/src/index.js sensors run
node cli/dist/src/index.js sensors coverage --json --min 2
```

Expected: typecheck/build/tests PASS; sensors `overall: pass`; coverage JSON schema 2 parseable, proyecto byte-idéntico antes/después y static/empirical presentes.

- [x] **Step 4: Guardar evidencia reproducible sin datos locales**

`docs/research/r3/cli-contract.json` incluye schema versions, estados, hashes de fixtures y comandos; no incluye homes, descriptions del ledger ni salida raw. `README.md` de research explica reproducción y marca que la certificación de packs queda pendiente del registry tag.

- [x] **Step 5: Solicitar review antes del PR y corregir todo hallazgo**

Invocar `requesting-code-review`; por cada hallazgo agregar un test discriminante rojo/verde. Reejecutar Step 3 y `git diff --check`. No mezclar `cli/.awm/ledger/` en staging.

- [x] **Step 6: Push y PR del consumidor con release major verificable**

```bash
git status --short --branch
git diff origin/main...HEAD --check
git push -u origin feat/issue-20-r3-empirical-coverage
gh pr create --repo Kodria/agentic-workflow --base main --head feat/issue-20-r3-empirical-coverage --title "feat(sensors)!: add compatible empirical coverage" --body "Refs #20; resolves the CLI portion of #70; registry v2 remains ordered after npm 8.0.0."
gh pr checks --watch
```

Expected: PR URL real y CI verde en tres OS. Tras merge, esperar release workflow verde y verificar `npm view agentic-workflow-manager@8.0.0 version` devuelve `8.0.0` antes de T9. No elevar todavía el registry.

### Task 9: Contrato de autor pack v2 y gate estructural del registry

_Requirements: R1.1, R1.6, R1.7, R4.10, R7.1, R9.4, R10.3_

**Files:**
- Create: `../awm-baseline-registry/sensor-packs/pack.schema.json`
- Create: `../awm-baseline-registry/sensor-packs/README.md`
- Create: `../awm-baseline-registry/tests/fixtures/sensor-packs/valid/**`
- Create: `../awm-baseline-registry/tests/fixtures/sensor-packs/invalid/**`
- Modify: `../awm-baseline-registry/tests/sensor-pack-shape.test.mjs`
- Create: `../awm-baseline-registry/tests/sensor-pack-variants.test.mjs`
- Modify: `../awm-baseline-registry/tests/support/sensor-pack-coverage-validator.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-coverage.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-coverage-mutations.test.mjs`

**Skills:** `test-driven-development`

- [x] **Step 1: Crear rama limpia del registry después de CLI 7 publicado**

```bash
git -C ../awm-baseline-registry fetch origin
git -C ../awm-baseline-registry switch -c feat/issue-20-r3-compatible-packs origin/main
git -C ../awm-baseline-registry status --short --branch
```

Expected: rama nueva limpia desde `origin/main`; si ya existe, verificar que su base coincide y reutilizar sin reescribir trabajo ajeno.

- [x] **Step 2: Escribir corpus rojo de pack v2**

```js
test('valid fixture carries v2 variants and coverage v1', () => {
  const pack = readFixture('valid/js-ts/pack.json');
  assert.equal(pack.schemaVersion, 2);
  assert.equal(pack.coverage.schemaVersion, 1);
  validatePackV2(pack, fixtureRoot('valid/js-ts'));
});

for (const [fixture, message] of [
  ['overlap', /equal-priority overlap/], ['asset-escape', /asset.*outside/],
  ['shell-command', /structured command/], ['future-schema', /schemaVersion/],
  ['unknown-probe', /probe/], ['missing-asset', /asset.*exists/],
]) test(`rejects ${fixture}`, () => assert.throws(() => validateFixture(fixture), message));
```

- [x] **Step 3: Implementar schema y validador cerrado**

`pack.schema.json` refleja exactamente el contrato T1, con `additionalProperties:false`, IDs kebab, arrays nonempty, commands argv y probes enum. `sensor-pack-variants.test.mjs` agrega validaciones semánticas: overlap, referencias, assets reales/contenidos, coverage detector→sensor, comando→asset, y clases genéricas sin nombres de proyecto.

- [x] **Step 4: Escribir la referencia canónica de autores**

En inglés: v2 completo, legacy, custom registries, operational vs certified, future compatible-unverified, probes cerrados, assets, native/baseline/hardening, ejemplos válidos, migración y enlace al CLI configuration guide. No duplicar tablas de soporte.

- [x] **Step 5: Ejecutar el gate compatible con legacy y commit del contrato**

Run:

```bash
cd ../awm-baseline-registry
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-variants.test.mjs
node tests/sensor-pack-coverage.test.mjs
node tests/sensor-pack-coverage-mutations.test.mjs
```

Expected: fixtures válidas/invalidas discriminan y todos los comandos salen 0. El validador acepta los cuatro packs productivos legacy como `compatible-unverified`; la exigencia de que todo pack oficial sea v2 se activa únicamente en T11, cuando la migración completa puede quedar verde en el mismo commit. No agregar todavía el test nuevo a workflows.

Commit:

```bash
git add sensor-packs/pack.schema.json sensor-packs/README.md tests/fixtures/sensor-packs tests/sensor-pack-shape.test.mjs tests/sensor-pack-variants.test.mjs tests/support/sensor-pack-coverage-validator.mjs tests/sensor-pack-coverage.test.mjs tests/sensor-pack-coverage-mutations.test.mjs
git commit -m "test(sensors): define the pack v2 author contract"
```

### Task 10: Variantes certificables del pack `js-ts`

_Requirements: R4.2, R4.3, R4.4, R4.5, R4.6, R9.2_

**Files:**
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/eslint.config.awm.mjs`
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/eslint.config.awm.cjs`
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/.dep-cruiser.awm.js`
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/tsconfig.awm.json`
- Modify: `../awm-baseline-registry/tests/sensor-pack-eslint.test.mjs`
- Create: `../awm-baseline-registry/tests/sensor-pack-js-ts-variants.test.mjs`
- Create: `../awm-baseline-registry/tests/fixtures/certification-pins.json`
- Create: `../awm-baseline-registry/scripts/resolve-certification-pins.mjs`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos de las variantes obligatorias**

```js
const expectedLint = ['eslint-8-eslintrc', 'eslint-8-flat', 'eslint-9-flat', 'eslint-10-flat'];
assert.deepEqual(pack.sensors.lint.variants.map((v) => v.id).sort(), expectedLint.sort());

test('TypeScript native is applicable only when TS capability exists (R4.3, R4.4)', () => {
  const typecheck = pack.sensors.typecheck;
  assert.deepEqual(typecheck.applicability.anyFiles, ['tsconfig.json', 'tsconfig.*.json']);
  assert.ok(typecheck.variants.every((v) => !v.assets.includes('tsconfig.awm.json')));
  assert.equal(pack.hardening['typescript-strict'].assets[0], 'tsconfig.awm.json');
});

test('commands are local argv and test variants cover npm/pnpm/yarn/bun (R4.5, R4.6)', () => {
  for (const sensor of Object.values(pack.sensors)) for (const variant of sensor.variants) {
    assert.equal(typeof variant.command.executable, 'string');
    assert.ok(!['npx', 'pnpx'].includes(variant.command.executable));
    assert.ok(Array.isArray(variant.command.args));
  }
  assert.deepEqual(pack.sensors.test.variants.map((v) => v.id).sort(),
    ['bun-script', 'npm-script', 'pnpm-script', 'yarn-script']);
});
```

- [x] **Step 2: Generar y congelar pins de certificación**

`resolve-certification-pins.mjs` consulta registries oficiales una sola vez para las familias declaradas (`eslint@8/9/10`, TypeScript, Prettier, dependency-cruiser, Stryker), selecciona el patch más reciente de cada frontera, escribe JSON ordenado con `resolvedAt` y URL fuente, y falla si una versión no satisface el rango del manifest. Ejecutar:

`cd ../awm-baseline-registry && node scripts/resolve-certification-pins.mjs --write`

Expected: `tests/fixtures/certification-pins.json` reproducible y sin tags flotantes en CI posterior.

- [x] **Step 3: Implementar manifests y assets por nivel**

ESLint declara las cuatro variantes; flat v8 usa env estático allowlisted si hace falta, v9/v10 no dependen de eslintrc. TypeScript normal ejecuta `tsc --noEmit` contra config nativa sin asset; `tsconfig.awm.json` vive solo en `hardening`. Prettier/depcruise/Stryker/test script declaran probes/version ranges y argv. `formatter` queda en cada variante.

- [x] **Step 4: Certificar carga real de ESLint y configs nativas**

Extender `sensor-pack-eslint.test.mjs` para matriz de pins y cuatro formas de config. Cada fixture instala exact version pin en tmpdir, ejecuta el command resuelto y afirma config/código de salida. Casos native config dañada deben fallar; ausencia de config usa baseline compatible solo donde la variante lo declara.

- [x] **Step 5: Ejecutar gate completo js-ts y mutaciones**

Run:

```bash
cd ../awm-baseline-registry
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-variants.test.mjs
node tests/sensor-pack-js-ts-variants.test.mjs
node tests/sensor-pack-eslint.test.mjs
node tests/sensor-pack-coverage.test.mjs
```

Expected: todos los comandos salen 0; `js-ts` pasa como v2 y los otros tres packs siguen aceptados por la ruta legacy `compatible-unverified`. Mutaciones: mover `tsconfig.awm.json` a assets default y usar `npx`; ambos casos deben fallar.

- [x] **Step 6: Commit**

```bash
git add sensor-packs/js-ts tests/sensor-pack-eslint.test.mjs tests/sensor-pack-js-ts-variants.test.mjs tests/fixtures/certification-pins.json scripts/resolve-certification-pins.mjs
git commit -m "feat(sensors): certify version-aware JavaScript variants"
```

### Task 11: Variantes de Python, Shell y Generic con Semgrep compartido

_Requirements: R4.1, R4.7, R4.8, R4.9, R9.2_

**Files:**
- Modify: `../awm-baseline-registry/sensor-packs/python/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/shell/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/generic/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/generic/.semgrep.awm.yml`
- Modify: `../awm-baseline-registry/sensor-packs/python/.semgrep.awm.yml`
- Modify: `../awm-baseline-registry/sensor-packs/shell/.semgrep.awm.yml`
- Create: `../awm-baseline-registry/sensor-packs/shared/semgrep-policy.json`
- Create: `../awm-baseline-registry/tests/sensor-pack-python-shell-generic.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-rules-fire.test.mjs`
- Modify: `../awm-baseline-registry/tests/sensor-pack-variants.test.mjs`
- Modify: `../awm-baseline-registry/tests/fixtures/certification-pins.json`

**Skills:** `test-driven-development`

- [x] **Step 1: Escribir tests rojos por capacidad**

```js
test('python variants cover native configured tools (R4.7)', () => {
  for (const sensor of ['typecheck', 'lint', 'test', 'security']) {
    assert.ok(python.sensors[sensor].variants.length > 0, `${sensor} without variants`);
  }
  assert.ok(python.sensors.typecheck.variants.some((v) => v.requirements.configFiles.includes('pyproject.toml')));
});

test('shell uses CLI-expanded files and no find shell (R4.8)', () => {
  const command = shell.sensors.lint.variants[0].command;
  assert.deepEqual(command.args.slice(-1), ['{files}']);
  assert.doesNotMatch(JSON.stringify(command), /find|exec|sh -c/);
});

test('generic declares only Semgrep capability (R4.9)', () => {
  assert.deepEqual(Object.keys(generic.sensors), ['security']);
  assert.equal(generic.sensors.security.applicability.kind, 'explicit-or-supported-language');
});
```

- [x] **Step 2: Ampliar pins y declarar rangos operativos/certificados**

Ejecutar el mismo resolver para Python 3.9/actual, mypy, Ruff, pytest, Semgrep y ShellCheck; persistir versiones exactas. Mutmut permanece opt-in. Rangos se validan contra pins, no se deducen del latest en CI.

- [x] **Step 3: Migrar los tres packs y compartir política Semgrep**

Cada pack referencia `shared/semgrep-policy.json` para requisitos/probe, manteniendo reglas YAML específicas por lenguaje. ShellCheck usa `{files}` como argumento entero. Python resuelve environment local y configs nativas. Generic es N/A/inconclusive fuera de su capacidad explícita, nunca covered por vacío. `sensor-pack-variants.test.mjs` activa ahora la aserción productiva de que los cuatro packs oficiales usan `schemaVersion: 2`; desde este punto el gate ya no permite legacy oficial.

- [x] **Step 4: Convertir rules-fire en gate real sin skip**

Eliminar el skip por Semgrep ausente dentro del job de certificación: el workflow instalará el pin. Los tests disparan una regla real por pack y fallan si salida no contiene el rule ID esperado.

- [x] **Step 5: Ejecutar todos los packs, mutaciones y commit**

Run:

```bash
cd ../awm-baseline-registry
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-variants.test.mjs
node tests/sensor-pack-js-ts-variants.test.mjs
node tests/sensor-pack-python-shell-generic.test.mjs
node tests/sensor-pack-coverage.test.mjs
node tests/sensor-pack-coverage-mutations.test.mjs
node --test tests/sensor-pack-rules-fire.test.mjs
```

Expected: PASS para los cuatro packs. Mutaciones: cambiar generic N/A a certified sin tool y reintroducir `find`; tests rojos. Restaurar.

Commit:

```bash
git add sensor-packs tests/sensor-pack-python-shell-generic.test.mjs tests/sensor-pack-rules-fire.test.mjs tests/fixtures/certification-pins.json
git commit -m "feat(sensors): certify Python shell and generic packs"
```

### Task 12: Retroalimentación, soporte generado y release seguro del registry

_Requirements: R6.4, R6.5, R6.7, R9.2, R9.4, R10.2, R10.3, R10.5, R10.6, R10.7, R10.8, R10.11, R10.12, R10.13_

**Files:**
- Modify: `../awm-baseline-registry/skills/harness-retro/SKILL.md`
- Modify: `../awm-baseline-registry/skills/setup-sensors/SKILL.md`
- Modify: `../awm-baseline-registry/skills/subagent-driven-development/SKILL.md`
- Modify: `../awm-baseline-registry/skills/subagent-driven-development/spec-reviewer-prompt.md`
- Modify: `../awm-baseline-registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`
- Modify: `../awm-baseline-registry/skills/post-implementation-qa/SKILL.md`
- Modify: `../awm-baseline-registry/skills/post-implementation-qa/deep-review-prompt.md`
- Modify: `../awm-baseline-registry/skills/verification-before-completion/SKILL.md`
- Modify: `../awm-baseline-registry/skills/systematic-debugging/SKILL.md`
- Create: `../awm-baseline-registry/tests/r3-retro-contract.test.mjs`
- Create: `../awm-baseline-registry/scripts/render-sensor-support-matrix.mjs`
- Create: `../awm-baseline-registry/sensor-packs/SUPPORT.md`
- Create: `../awm-baseline-registry/tests/sensor-pack-support-matrix.test.mjs`
- Create: `../awm-baseline-registry/tests/sensor-pack-certification.test.mjs`
- Create: `../awm-baseline-registry/.github/workflows/sensor-pack-certification.yml`
- Modify: `../awm-baseline-registry/.github/workflows/validate.yml`
- Modify: `../awm-baseline-registry/.github/workflows/auto-tag.yml`
- Modify: `../awm-baseline-registry/awm-registry.json`
- Modify: `../awm-baseline-registry/bundles/dev/bundle.json`
- Modify: `../awm-baseline-registry/catalog.json`
- Modify: `../awm-baseline-registry/CHANGELOG.md`

**Skills:** `test-driven-development`, `writing-skills`, `verification-before-completion`

- [x] **Step 1: Escribir contrato rojo del orden terminal y emisión tipada**

```js
test('runs coverage exactly once before archive (R6.4)', () => {
  const retro = read('skills/harness-retro/SKILL.md');
  assert.equal(count(retro, 'awm sensors coverage --json'), 1);
  assert.ok(retro.indexOf('awm sensors coverage --json') < retro.indexOf('awm ledger archive'));
});

test('keeps interactive and unattended authority distinct (R6.5)', () => {
  const retro = read('skills/harness-retro/SKILL.md');
  assert.match(retro, /interactive.*human.*remedy/is);
  assert.match(retro, /unattended.*existing.*triage/is);
  assert.match(retro, /coverage.*read-only/is);
});

for (const prompt of EMITTERS) test(`${prompt} emits defect class only when known`, () => {
  const text = read(prompt);
  assert.match(text, /--defect-class/);
  assert.match(text, /omit.*when.*not.*known/is);
});

test('keeps empirical coverage terminal and out of implementation QA (R6.7)', () => {
  assert.doesNotMatch(read('skills/post-implementation-qa/SKILL.md'), /awm sensors coverage/);
  assert.match(read('skills/harness-retro/SKILL.md'), /awm sensors coverage --json/);
});
```

- [x] **Step 2: Actualizar skills y versiones sin ampliar autoridad**

Agregar coverage como nuevo paso del checklist tras leer el ledger y antes de triage/archive. Interactivo presenta outcomes; desatendido usa solo reglas vigentes y registra recomendaciones no autorizadas. Emisores agregan flag únicamente al mapear un catálogo exacto. `setup-sensors` queda como escape para custom/compatible-unverified/hardening. Bumps: harness-retro `2.4.0`, setup-sensors `1.1.0`, SDD `1.7.0`, QA `1.5.0`, verification `1.2.0`, debugging `1.1.0`.

- [x] **Step 3: Crear renderer y freshness del soporte del registry**

```js
export function renderSensorSupport(packs, pins) {
  validateInputs(packs, pins);
  return stableRows(packs).map(({ pack, sensor, variant, range, os, evidence }) =>
    `| \`${pack}\` | \`${sensor}\` | \`${variant}\` | \`${range}\` | ${os} | ${evidence} |`).join('\n');
}
```

`SUPPORT.md` tiene markers y solo contenido generado. Test regenera y compara bytes; incluye certified/compatible-unverified/not-applicable, tool/range/OS y fecha/pins, sin prosa duplicada.

- [x] **Step 4: Construir workflow de certificación que bloquee el tag**

Workflow reusable con resolver/contract suite en Ubuntu/macOS/Windows; real tools min/current principalmente Ubuntu; smoke current macOS/Windows; future sintético debe ser compatible-unverified. `validate.yml` lo llama. `auto-tag.yml` también lo llama y el job `tag` declara `needs: sensor-certification`; no confiar en un workflow paralelo.

- [x] **Step 5: Elevar contratos/versiones y registrar ruptura**

Solo ahora, con `agentic-workflow-manager@8.1.0` publicado: `awm-registry.json.minCliVersion` → `8.1.0`; bundle `dev` y catalog `2.10.0` → `3.0.0`; changelog explica pack v2, migración, retro y compatibilidad. El PR usa conventional breaking para que tag `v1.16.1` → `v2.0.0`.

- [x] **Step 6: Ejecutar todos los gates locales**

Run:

```bash
cd ../awm-baseline-registry
node scripts/validate-portability.mjs
node tests/validate-portability.test.mjs
node tests/codex-session-start.test.mjs
node tests/session-start.test.mjs
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-variants.test.mjs
node tests/sensor-pack-js-ts-variants.test.mjs
node tests/sensor-pack-python-shell-generic.test.mjs
node tests/sensor-pack-coverage.test.mjs
node tests/sensor-pack-coverage-mutations.test.mjs
node --test tests/sensor-pack-rules-fire.test.mjs
node tests/sensor-pack-certification.test.mjs
node scripts/render-sensor-support-matrix.mjs --check
node tests/sensor-pack-support-matrix.test.mjs
node tests/r3-retro-contract.test.mjs
```

Expected: todos exit 0. Mutaciones obligatorias: coverage después de archive, auto-tag sin `needs`, support edit manual y probe future→certified; cada test correspondiente debe fallar, luego restaurar.

- [x] **Step 7: Commit, review y PR registry**

```bash
git -C ../awm-baseline-registry add skills sensor-packs tests scripts .github awm-registry.json bundles/dev/bundle.json catalog.json CHANGELOG.md
git -C ../awm-baseline-registry commit -m "feat(sensors)!: publish compatible pack contracts"
git -C ../awm-baseline-registry push -u origin feat/issue-20-r3-compatible-packs
gh pr create --repo Kodria/awm-baseline-registry --base main --head feat/issue-20-r3-compatible-packs --title "feat(sensors)!: publish compatible pack contracts" --body "Refs Kodria/agentic-workflow#20 and closes the registry portion of Kodria/agentic-workflow#70. Requires agentic-workflow-manager >=7.0.0."
gh pr checks --repo Kodria/awm-baseline-registry --watch
```

Antes de push invocar review y corregir cada hallazgo con test discriminante. Expected: PR real, CI 3-OS verde. Tras merge, esperar auto-tag y verificar `git ls-remote --tags origin refs/tags/v2.0.0` antes de T13.

### Task 13: Aceptación publicada, reconciliación e issues

> **Cierre de alcance — 2026-08-15:** por instrucción explícita del owner se
> cierra R3 con el gate publicado existente, sin expandir una segunda matriz de
> fixtures. La evidencia persistida ancla npm `8.1.2`, registry `v2.0.1`, los
> casos `new`/`legacy`/`future`, el ciclo ledger→coverage→archive y la matriz
> nativa de CI verde en Ubuntu/macOS/Windows. No se afirma una certificación de
> consumidor npm independiente en macOS o Windows.

_Requirements: R7.7, R7.8, R9.1, R9.2, R9.3, R9.4, R10.11, R10.13_

**Files:**
- Modify: `docs/research/r3/README.md`
- Create: `docs/research/r3/published-acceptance.json`
- Modify: `docs/support-matrix.md`
- Modify: `docs/plans/2026-08-14-r3-compatible-empirical-sensor-coverage-plan.md`

**Skills:** `test-driven-development`, `requesting-code-review`, `verification-before-completion`

- [ ] **Step 1: Instalar consumidor publicado y pin exacto en homes temporales**

Crear tmpdirs con `mktemp -d`; instalar `agentic-workflow-manager@8.1.0` allí y clonar/registrar exclusivamente `awm-baseline-registry@v2.0.0`. No tocar `~/.awm`. Guardar comandos y hashes, no rutas temporales absolutas.

- [ ] **Step 2: Ejecutar matriz end-to-end new/legacy/future**

Casos: JS ESLint 8 eslintrc/flat, 9, 10; JS sin TS; TS native/hardening opt-in; npm/pnpm/Yarn/Bun; Python native configs; shell; generic; legacy manifest/pack; future version sintética. Para cada caso ejecutar `init`, `status`, `preflight`, `run`, `coverage --json --min 2`; afirmar estados y que solo init escribe.

- [ ] **Step 3: Verificar retro real antes de archive**

En fixture con finding tipado y unclassified, ejecutar el flujo de `harness-retro` con CLI publicado; capturar coverage antes de archive, luego afirmar ledger archivado y recomendación preservada. No simular el orden solo con grep: el test T12 cubre estructura y este paso cubre ejecución.

- [ ] **Step 4: Regenerar/cotejar matriz contra tag exacto**

Run:

```bash
cd cli
npx ts-node scripts/sensor-support-matrix.ts --registry-root ../../awm-baseline-registry --registry-tag v2.0.0 --registry-commit c35c087a0801c0b4e69e0a4ac3eafef9ecdf37cd
npx jest tests/structural/support-matrix-is-current.test.ts --runInBand
git diff --check ../docs/support-matrix.md
```

Expected: tabla idéntica a manifests de `v2.0.0`. `published-acceptance.json` registra `cliVersion:8.1.0`, `registryTag:v2.0.0`, commit/tag hashes, resultado 3-OS y hashes de fixtures.

- [ ] **Step 5: Ejecutar reconciliación completa de ambos repos**

```bash
git status --short --branch
git diff origin/main...HEAD --check
git -C ../awm-baseline-registry status --short --branch
git -C ../awm-baseline-registry diff origin/main...HEAD --check
cd cli && npm ci && npm run typecheck && npm test -- --runInBand && npm run build
cd ../../awm-baseline-registry && node tests/sensor-pack-certification.test.mjs && node tests/r3-retro-contract.test.mjs && node scripts/render-sensor-support-matrix.mjs --check
```

Expected: solo artefactos R3 intencionales; suites verdes; no harness evidence accidental. Si la matriz final cambió después del PR CLI, crear un commit docs en la rama CLI y actualizar el mismo PR si sigue abierto; si ya fue mergeado, abrir PR documental mínimo enlazado al par R3 en lugar de falsear el tag.

- [ ] **Step 6: Actualizar issues con URLs y evidencia real**

Resolver URLs y abortar si falta alguna:

```bash
CLI_PR_URL=$(gh pr list --repo Kodria/agentic-workflow --head feat/r3-pack-hardening-bridge --state all --json url --jq '.[0].url')
REGISTRY_PR_URL=$(gh pr list --repo Kodria/awm-baseline-registry --head feat/issue-20-r3-compatible-packs --state all --json url --jq '.[0].url')
test -n "$CLI_PR_URL" && test -n "$REGISTRY_PR_URL"
```

Comentar issue #20 con PRs, npm 8.1.0, registry v2.0.0, comandos, schemas, matriz y retro. Cerrar #70 citando las variantes ESLint/TS y hardening opt-in. Cerrar #20 solo si sus demás releases están completas; si no, dejar baton exacto sin afirmar cierre global.

- [ ] **Step 7: Persistir aceptación, solicitar review final y transferir a QA/retro/finishing**

```bash
git add docs/research/r3/README.md docs/research/r3/published-acceptance.json docs/support-matrix.md docs/plans/2026-08-14-r3-compatible-empirical-sensor-coverage-plan.md
git commit -m "docs(sensors): record published R3 acceptance"
```

Invocar `requesting-code-review`, corregir todo hallazgo, marcar únicamente checkboxes realmente completados y confirmar que cualquier corrección quedó comprometida. Luego ejecutar `post-implementation-qa`, `harness-retro` y `finishing-a-development-branch` según el estado. No agregar manualmente markers antes de que cada skill produzca su evidencia.

## Matriz de trazabilidad

| Req | Task(s) | Test(s) que demuestra el requisito |
|---|---|---|
| R1.1 | T1, T9 | `contract.test.ts` acepta pack v2 con coverage v1; `sensor-pack-variants.test.mjs` valida el mismo contrato publicable |
| R1.2 | T2 | `resolve.test.ts` distingue `certified` y `compatible-unverified` por rango y probe |
| R1.3 | T2 | `resolve.test.ts` verifica versión futura operativa como `compatible-unverified` |
| R1.4 | T1, T2 | `manifest.test.ts` y `resolve.test.ts` mantienen legacy operativo sin certificar |
| R1.5 | T2 | `resolve.test.ts` rechaza matches ambiguos de igual prioridad |
| R1.6 | T1, T9 | corpus inválido de `contract.test.ts` y fixtures invalid de `sensor-pack-variants.test.mjs` |
| R1.7 | T1, T9 | tests de IDs únicos, kebab-case y solapamiento estable en ambos parsers |
| R2.1 | T2 | `discovery.test.ts` prueba evidencia local de OS, runtimes, tools, scripts y configs |
| R2.2 | T2 | tabla de seis estados en `resolve.test.ts` |
| R2.3 | T3 | `materialize.test.ts` afirma assets seleccionados y manifest v2 atómico |
| R2.4 | T3 | `materialize.test.ts` preserva destinos modificados byte a byte |
| R2.5 | T3 | `materialize.test.ts` reporta huérfanos sin borrarlos |
| R2.6 | T3 | tests parametrizados de status/preflight/run re-resuelven drift vivo |
| R2.7 | T2 | `resolve.test.ts` convierte lockfiles conflictivos en `unverifiable` |
| R2.8 | T2 | `exec.test.ts` y `probe.test.ts` prueban argv literal con `shell:false` |
| R3.1 | T4 | tabla de precedencia de `evaluate.test.ts`: certified produce covered |
| R3.2 | T4 | tabla de precedencia: estados inciertos producen unverifiable |
| R3.3 | T4 | tabla de precedencia: incompatible/missing-tool producen missing |
| R3.4 | T4 | tabla de precedencia: solo todos N/A producen not-applicable |
| R3.5 | T4 | `evaluate.test.ts` prueba `applicability-contradiction` |
| R3.6 | T4 | `evaluate.test.ts` conserva el overall estático de R2 |
| R3.7 | T4 | caso mixto de `evaluate.test.ts` prueba precedencia covered > uncertain > gap > N/A |
| R4.1 | T11 | `sensor-pack-python-shell-generic.test.mjs` más `sensor-pack-variants.test.mjs` cubren los cuatro packs v2 |
| R4.2 | T10 | `sensor-pack-js-ts-variants.test.mjs` exige ESLint 8 eslintrc/flat, 9 y 10 |
| R4.3 | T10 | test TypeScript usa config nativa y separa hardening |
| R4.4 | T10 | test de aplicabilidad TypeScript produce N/A sin capacidad TS |
| R4.5 | T10 | test de variantes de script exige npm, pnpm, Yarn y Bun |
| R4.6 | T10 | test recorre lint/typecheck/format/dependencies/test/mutation con argv local |
| R4.7 | T11 | test Python exige typecheck/lint/test/security y configs nativas |
| R4.8 | T11 | test Shell exige `{files}` y prohíbe `find`, `exec` y shell |
| R4.9 | T11 | test Generic limita capacidad a Semgrep y aplicabilidad explícita |
| R4.10 | T9 | schema+fixture tests distinguen native, baseline y hardening opt-in |
| R5.1 | T5 | `scan.test.ts` lee únicamente active/archive directos en orden determinista |
| R5.2 | T5 | tests de ledger persisten `defectClass` opcional |
| R5.3 | T5, T6 | parser conserva entradas sin clase; empirical no infiere desde texto |
| R5.4 | T6 | `empirical.test.ts` agrupa solo dentro de `defectClass` |
| R5.5 | T6 | tests de renderer validan clases, occurrences, severity, refs y outcome |
| R5.6 | T6 | `empirical.test.ts` conserva singles y usa `min` solo para recurrence |
| R5.7 | T6 | tests Commander rechazan seis valores inválidos antes de `runCoverage` |
| R5.8 | T6 | renderer tests prueban evidence/partial/no-evidence/inconclusive |
| R5.9 | T6 | tabla de `outcomeFor` cubre todos los cruces estático-empíricos |
| R5.10 | T6 | E2E prueba determinismo, read-only y ausencia de `desc`/secretos |
| R5.11 | T5 | `ledger/index.test.ts` rechaza clase inválida sin escribir |
| R5.12 | T5 | `scan.test.ts` cuenta entradas persistidas inválidas como skips tipados |
| R6.1 | T3 | `init.test.ts` prueba resolución/materialización en init |
| R6.2 | T3 | `preflight.test.ts` consume compatibilidad viva |
| R6.3 | T3 | `run.test.ts` afirma que incompatibilidad conocida no ejecuta el sensor |
| R6.4 | T12 | `r3-retro-contract.test.mjs` exige coverage una vez antes de archive |
| R6.5 | T12 | test de retro ancla autoridad interactiva y desatendida distinta |
| R6.6 | T6 | help/Commander tests exponen `coverage --min` manualmente |
| R6.7 | T6, T12 | contrato terminal prueba coverage ausente de QA y presente en harness-retro |
| R7.1 | T1, T9 | parsers y schema tests prueban pack v2/coverage v1 |
| R7.2 | T1, T3, T8 | manifest tests y E2E prueban legacy, v2 y migración explícita |
| R7.3 | T4 | renderer tests exigen envelope público `schemaVersion: 2` |
| R7.4 | T1, T4, T9 | contratos prueban `coverage.schemaVersion: 1` anidado |
| R7.5 | T1 | corpus future-schema rechaza versiones desconocidas con mensaje accionable |
| R7.6 | T8 | suite/release verifica versión CLI major `8.0.0` |
| R7.7 | T13 | aceptación exige dos URLs reales y registra ambos artefactos publicados |
| R7.8 | T8, T13 | E2E legacy y aceptación publicada prueban orden CLI-antes-registry |
| R8.1 | T5 | `scan.test.ts` cubre archivos, bytes, líneas, refs y profundidad acotados |
| R8.2 | T2, T5 | tests de pack-source y scan rechazan symlink/nonregular/escape |
| R8.3 | T5, T6 | scan+renderer prueban reason codes, omitted refs y sanitización |
| R8.4 | T2 | `probe.test.ts` convierte timeout/overflow/output inconcluso sin false green |
| R8.5 | T1 | tests de funciones públicas rechazan unknown/impossible inputs explícitamente |
| R9.1 | T2, T8, T13 | E2E sintético 3-OS y aceptación publicada verifican resolver portable |
| R9.2 | T10, T11, T12, T13 | gates reales de packs y certificación publicada cubren la matriz de tools |
| R9.3 | T6, T8, T13 | E2E de coverage/ledger corre en CI y contra CLI publicado |
| R9.4 | T9, T12, T13 | schema, workflow bloqueante y tag exacto prueban gate del registry |
| R10.1 | T7 | `sensor-documentation-contract.test.ts` prueba el owner map canónico |
| R10.2 | T7, T12 | contrato documental prueba lifecycle y retro en framework/skills |
| R10.3 | T9, T12 | tests de autores y referencias prueban pack schema/variantes/custom registries |
| R10.4 | T7 | contrato documental prueba setup para proyecto nuevo y legacy |
| R10.5 | T7, T12 | contratos prueban operación manual, retro y custom/hardening |
| R10.6 | T7, T12 | contrato documental prueba flags, estados, exits y envelope |
| R10.7 | T7, T12 | freshness prueba matriz de soporte generada y owners de arquitectura/testing |
| R10.8 | T7, T12 | contrato de decisions/changelog prueba ruptura, migración y falsos verdes |
| R10.9 | T7 | test compara help compilado con flags documentados exactos |
| R10.10 | T7 | ejemplos JSON documentados pasan los parsers productivos |
| R10.11 | T7, T12, T13 | tests de freshness regeneran ambas matrices y cotejan el tag publicado |
| R10.12 | T7, T12 | tests de documentación activa y enlaces prueban reachability bidireccional |
| R10.13 | T8, T12, T13 | evidencia exige npm 8.0.0, registry v2.0.0, hashes y URLs reales |
| R10.14 | T7 | `active-documentation.test.ts` verifica inglés y prohíbe prosa R3 fuera de owners |

## Auto-revisión y analyze gate

- **Cobertura forward:** 82/82 IDs del diseño tienen al menos una tarea y una prueba específica en la matriz.
- **Cobertura backward:** T1–T13 y sus pruebas están ancladas a IDs explícitos; branch/review/release son pasos de entrega de R7.6–R7.8, R9.1–R9.4 y R10.13, no scope huérfano.
- **Completitud de pasos:** cada cambio nombra archivo, corpus, comando, resultado esperado y commit; el scan pre-handoff de marcadores incompletos debe devolver cero.
- **Consistencia de tipos:** `CompatibilityState`, `StructuredCommand`, `CompatibilityEvidence`, pack/manifiesto/envelope schema y outcomes conservan los mismos nombres desde T1 hasta T13.
- **UI:** no hay archivos de pantalla ni artefactos de diseño; no aplica propagación de `frontend-craft`/design artifacts.
- **Resultado analyze:** PASS únicamente si el chequeo mecánico confirma `requirements=82`, `mapped=82`, `missing=0`, `orphanTasks=0` y toda fila tiene una prueba no vacía.

## Gate pre-handoff

Ejecutar, desde la raíz del repositorio y en este orden:

```bash
awm preflight
awm context-budget
```

`awm preflight` debe salir 0/ready antes de iniciar T1. `awm context-budget` es informativo: si reporta crecimiento, registrar en este plan la decisión humana tomada antes de la ejecución. La opción de ejecución ya fue elegida explícitamente: `subagent-driven-development`, modo `desatendido`, hasta PR; no se vuelve a abrir una elección interactiva al completar estos gates.

Resultados al cerrar el plan el 2026-08-14:

- `awm preflight`: exit 0, `Harness ready`, 5/5 sensores habilitados y ejecutables, baseline y host GitHub listos.
- `awm context-budget`: exit 0, 69 KB de 69 KB (aprox. 18k tokens por sesión); no requiere poda ni cambio de presupuesto.
