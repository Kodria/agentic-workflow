# Body B-2 — Gate de calidad determinístico — Implementation Plan

<!-- awm-qa-complete: 2026-06-06 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el gate de sensores de AWM sea determinístico — que se auto-corrija cuando el pack quedó en `generic` sobre un stack real, que nunca dé verde benigno sin haber corrido sensores reales, y que los tests del proyecto sean parte del gate.

**Architecture:** Dos cambios de ingeniería en el CLI (`reconcilePack` + piso honesto en `run.ts`; sensor `test` como sensor de exit-code) y tres cambios de contenido genérico en el registry (invariante de robustez en `awm-context`, lente de seguridad en QA, principio de frontera doctrinal). El grueso está en `cli/src/commands/sensors/`.

**Tech Stack:** TypeScript, Node, Jest (`jest --runInBand`), Commander CLI. Tests en `cli/tests/`.

**Design doc:** `docs/plans/2026-06-06-b2-deterministic-gate-design.md`

**Nota sobre Componente 3 (frontera genérico/específico):** es **doctrinal, sin código** — ya quedó fijado en el design doc y se re-afirma en la Task 5. No tiene tarea de implementación propia más allá de esa nota.

**TDD obligatorio:** usar @superpowers:test-driven-development en cada tarea con código. Test que falla → mínimo código → test pasa → commit.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `cli/src/commands/sensors/run.ts` | `reconcilePack` (upgrade-only) + piso honesto + cableado en `runSensors` + handling de sensor de exit-code | Modify |
| `cli/src/commands/sensors/types.ts` | `RunOutput.packUpgraded?` | Modify |
| `cli/src/commands/sensors/formatters/test.ts` | Formatter del sensor `test` (exit-code) | Create |
| `registry/sensor-packs/js-ts/pack.json` | Sensor `test` en el pack | Modify |
| `cli/tests/commands/sensors/run.test.ts` | Tests de reconcile, piso honesto, sensor test | Modify |
| `cli/src/core/context/provider.ts` | (sin cambio de código) — la fuente es la skill | — |
| `registry/skills/using-awm/SKILL.md` | Invariante de robustez genérico (Componente 4) | Modify |
| `cli/tests/core/context/provider.test.ts` | Test de que `buildContext` arrastra el invariante | Create/Modify |
| `registry/skills/post-implementation-qa/SKILL.md` | Lente de seguridad (Componente 5) | Modify |
| `registry/skills/post-implementation-qa/deep-review-prompt.md` | Lente de seguridad en el prompt de review | Modify |

---

## Task 1: `reconcilePack` + piso honesto (Componente 1)

**Files:**
- Modify: `cli/src/commands/sensors/types.ts` (agregar `packUpgraded?`)
- Modify: `cli/src/commands/sensors/run.ts` (nueva `reconcilePack`, piso honesto, cableado)
- Test: `cli/tests/commands/sensors/run.test.ts`

- [ ] **Step 1: Agregar `packUpgraded?` a `RunOutput`**

En `cli/src/commands/sensors/types.ts`, modificar `RunOutput`:

```ts
export type RunOutput = {
    sensors: SensorResult[];
    overall: 'pass' | 'fail' | 'skipped' | 'not_certified';
    /** Set when reconcilePack upgraded the manifest off the `generic` fallback
     *  (e.g. "generic→js-ts"). Absent on no-op runs. */
    packUpgraded?: string;
};
```

- [ ] **Step 2: Escribir el test que falla — upgrade `generic→js-ts`**

En `cli/tests/commands/sensors/run.test.ts`, agregar al final (antes del cierre del archivo). Usa el registry real del repo como `registryRoot`:

```ts
describe('reconcilePack', () => {
    const REPO_REGISTRY = path.resolve(__dirname, '../../../../registry');

    function tmpProject(pack: string, withPackageJson: boolean): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reconcile-'));
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.awm', 'sensors.json'),
            JSON.stringify({ pack, sensors: pack === 'generic'
                ? { security: { cmd: 'semgrep .', fast: false } }
                : {} }),
        );
        if (withPackageJson) fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        return dir;
    }

    it('upgrades generic→js-ts when package.json is present', () => {
        const { reconcilePack } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('generic', true);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = reconcilePack(dir, manifest, REPO_REGISTRY);
            expect(res.manifest.pack).toBe('js-ts');
            expect(res.upgradedFrom).toBe('generic');
            expect(Object.keys(res.manifest.sensors)).toContain('typecheck');
            // persisted to disk
            const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            expect(onDisk.pack).toBe('js-ts');
        } finally { fs.rmSync(dir, { recursive: true }); }
    });

    it('is a no-op when pack is already real (idempotent)', () => {
        const { reconcilePack } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('js-ts', true);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = reconcilePack(dir, manifest, REPO_REGISTRY);
            expect(res.manifest.pack).toBe('js-ts');
            expect(res.upgradedFrom).toBeUndefined();
        } finally { fs.rmSync(dir, { recursive: true }); }
    });

    it('does not upgrade a truly generic project (no indicators)', () => {
        const { reconcilePack } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('generic', false);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = reconcilePack(dir, manifest, REPO_REGISTRY);
            expect(res.manifest.pack).toBe('generic');
            expect(res.upgradedFrom).toBeUndefined();
        } finally { fs.rmSync(dir, { recursive: true }); }
    });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts -t reconcilePack`
Expected: FAIL — `reconcilePack is not a function`.

- [ ] **Step 4: Implementar `reconcilePack` en `run.ts`**

En `cli/src/commands/sensors/run.ts`, agregar el import y la función. Cerca de los otros imports:

```ts
import os from 'os';
import { detectStack, initSensors } from './init';
```

Y la función (después de `readManifest`):

```ts
function defaultRegistryRoot(): string {
    const home = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');
    return path.join(home, 'cli-source', 'registry');
}

/**
 * Upgrade-only, idempotent pack reconciliation. If the manifest sits on the
 * `generic` fallback but the tree now has real stack indicators (package.json,
 * pyproject.toml…), re-detect and rebuild via initSensors — which merges existing
 * custom sensors and copies the pack's config files. Never downgrades, never
 * touches a real pack. FS/registry failures degrade to a no-op (the honest floor
 * in runSensors covers the gap).
 */
export function reconcilePack(
    manifestDir: string,
    manifest: SensorManifest,
    registryRoot?: string,
): { manifest: SensorManifest; upgradedFrom?: string } {
    if (manifest.pack !== 'generic') return { manifest };
    const detection = detectStack(manifestDir);
    if (detection.pack === 'generic') return { manifest }; // truly generic — stay honest
    const root = registryRoot ?? defaultRegistryRoot();
    if (!fs.existsSync(root)) return { manifest }; // can't rebuild without registry
    try {
        const { manifest: rebuilt } = initSensors({ cwd: manifestDir, registryRoot: root, configure: true });
        return { manifest: rebuilt, upgradedFrom: 'generic' };
    } catch {
        return { manifest }; // never abort the run on a reconcile failure
    }
}
```

- [ ] **Step 5: Cablear reconcile + piso honesto en `runSensors`**

En `runSensors`, tras leer el manifest (línea ~126) y al computar `overall` (línea ~154-159):

```ts
    const manifest = readManifest(manifestDir);
    if (!manifest) return { sensors: [], overall: 'not_certified' };
    const reconciled = reconcilePack(manifestDir, manifest);
    const activeManifest = reconciled.manifest;
    const cwd = manifestDir;

    // ... el loop usa activeManifest.sensors en vez de manifest.sensors ...
```

Cambiar el `for (const [name, config] of Object.entries(manifest.sensors))` a `Object.entries(activeManifest.sensors)`.

Y al final:

```ts
    let overall: RunOutput['overall'] = results.some(r => r.status === 'fail') ? 'fail'
        : results.length > 0 && results.every(r => r.status === 'skipped') ? 'skipped'
        : results.length === 0 ? 'skipped'
        : 'pass';

    // Honest floor: a benign-green 'skipped' over a tree that clearly HAS a stack
    // (indicators present) is a false green — the gate ran nothing real. Never green.
    if (overall === 'skipped' && detectStack(manifestDir).pack !== 'generic') {
        overall = 'not_certified';
    }

    return {
        sensors: results,
        overall,
        ...(reconciled.upgradedFrom ? { packUpgraded: `${reconciled.upgradedFrom}→${activeManifest.pack}` } : {}),
    };
```

- [ ] **Step 6: Correr los tests de reconcile y verificar que pasan**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts -t reconcilePack`
Expected: PASS (3 tests).

- [ ] **Step 7: Escribir el test del piso honesto**

En el `describe('runSensors')` existente, agregar (este test fuerza "sin registry" seteando `AWM_HOME` a un temp vacío, así reconcile NO upgradea y el piso entra):

```ts
    it('returns not_certified (not skipped) for a generic manifest over a real stack', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-floor-'));
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'generic', sensors: { security: { cmd: 'semgrep .', fast: false } } }));
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        const prevHome = process.env.AWM_HOME;
        process.env.AWM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-nohome-')); // no cli-source → no upgrade
        try {
            const { runSensors } = load();
            const result = runSensors({ fast: true, cwd: dir }); // --fast filters the fast:false security sensor → empty
            expect(result.overall).toBe('not_certified');
        } finally {
            process.env.AWM_HOME = prevHome;
            fs.rmSync(dir, { recursive: true });
        }
    });
```

- [ ] **Step 8: Correr y verificar PASS**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts`
Expected: PASS (todos, incluido el piso honesto y el `not_certified when manifest does not exist` original).

- [ ] **Step 9: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/src/commands/sensors/types.ts cli/tests/commands/sensors/run.test.ts
git commit -m "feat(sensors): reconcilePack upgrade-only + honest floor (B-2 #2 fix)"
```

---

## Task 2: Sensor `test` como sensor de exit-code (Componente 2)

**Files:**
- Create: `cli/src/commands/sensors/formatters/test.ts`
- Modify: `cli/src/commands/sensors/run.ts` (`getFormatter` + handling de exit-code en `runSensor`)
- Modify: `registry/sensor-packs/js-ts/pack.json`
- Test: `cli/tests/commands/sensors/run.test.ts`

- [ ] **Step 1: Escribir el test que falla — éxito no es finding, fallo sí**

En `cli/tests/commands/sensors/run.test.ts`, dentro del `describe('runSensors')`. Estos tests usan el `mockExecSyncFn` existente. Un manifest con sensor `test`:

```ts
    it('test sensor: passing run (exit 0 with output) is pass, not fail', () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockExecSyncFn.mockReturnValue('Tests: 6 passed, 6 total\n'); // runner prints on success
        const { runSensors } = load();
        const result = runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('pass');
    });

    it('test sensor: failing run (non-zero exit) is fail, not skipped', () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockExecSyncFn.mockImplementation(() => {
            const err: any = new Error('jest failed');
            err.status = 1;
            err.stdout = 'Tests: 1 failed, 5 passed\n';
            err.stderr = '';
            throw err;
        });
        const { runSensors } = load();
        const result = runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('fail');
        expect(result.overall).toBe('fail');
    });
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts -t "test sensor"`
Expected: FAIL — el "passing run" da `fail` (formatter genérico convierte el output en finding); falta el formatter `test`.

- [ ] **Step 3: Crear el formatter `test`**

Create `cli/src/commands/sensors/formatters/test.ts`:

```ts
import { SensorError } from '../types';

/**
 * Tests are an exit-code sensor: the runner's exit status IS the signal, not the
 * parsed output. A passing run prints output ("6 passed") that must NOT be treated
 * as findings — so the success path yields no errors. The failure path (non-zero
 * exit) is handled in runSensor via isExitCodeSensor, not here.
 */
export function parseTestOutput(_raw: string): SensorError[] {
    return [];
}
```

- [ ] **Step 4: Cablear formatter + exit-code handling en `run.ts`**

En `getFormatter`:

```ts
function getFormatter(name: string): (raw: string) => SensorError[] {
    if (name === 'typecheck') return parseTscOutput;
    if (name === 'lint') return parseEslintOutput;
    if (name === 'security') return parseSemgrepOutput;
    if (name === 'test') return parseTestOutput;
    return parseGenericOutput;
}

function isExitCodeSensor(name: string): boolean {
    return name === 'test';
}
```

Agregar el import: `import { parseTestOutput } from './formatters/test';`

En `runSensor`, en el bloque `catch`, justo **antes** del `return { ... status: 'skipped' ... skipReason: 'exit N' }` final (línea ~117):

```ts
        // Exit-code sensors (tests): any genuine non-zero exit is a real failure,
        // even when no per-line findings can be parsed from the output.
        if (isExitCodeSensor(name)) {
            return { name, status: 'fail', errors: [{ message: `SENSOR[${name}] failed (exit ${err.status})` }] };
        }
        return { name, status: 'skipped', errors: [], skipReason: `exit ${err.status}: ${raw.slice(0, 200)}` };
```

- [ ] **Step 5: Correr y verificar PASS**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts -t "test sensor"`
Expected: PASS (2 tests).

- [ ] **Step 6: Agregar el sensor `test` al pack js-ts**

En `registry/sensor-packs/js-ts/pack.json`, dentro de `"sensors"`, agregar tras `"depcheck"`:

```json
    "test": {
      "fast": false,
      "enabled": true,
      "defaultCmd": "npm test --silent",
      "formatter": "generic"
    },
```

(El `formatter` del pack.json es metadata informativa; el formatter real lo elige `getFormatter` por nombre — `test` → `parseTestOutput`.)

- [ ] **Step 7: Verificar que el JSON es válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('registry/sensor-packs/js-ts/pack.json','utf-8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 8: Commit**

```bash
git add cli/src/commands/sensors/formatters/test.ts cli/src/commands/sensors/run.ts registry/sensor-packs/js-ts/pack.json cli/tests/commands/sensors/run.test.ts
git commit -m "feat(sensors): add test sensor (exit-code) to js-ts pack (B-2 layer 2)"
```

---

## Task 3: Invariante de robustez genérico en `awm-context` (Componente 4)

**Files:**
- Modify: `registry/skills/using-awm/SKILL.md` (fuente de `awm-context.md`)
- Test: `cli/tests/core/context/provider.test.ts`

- [ ] **Step 1: Escribir el test que falla — `buildContext` arrastra el invariante**

Localizar el test existente de provider, o crear `cli/tests/core/context/provider.test.ts`. Verificar primero si existe:

Run: `ls cli/tests/core/context/ 2>/dev/null`

Test (crear el archivo si no existe; el `registryRoot` es la raíz del repo, donde vive `registry/skills/using-awm/SKILL.md`):

```ts
import path from 'path';
import { buildContext } from '../../../src/core/context/provider';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('buildContext — generic robustness invariant', () => {
    it('carries the public-function input-validation invariant into awm-context', () => {
        const ctx = buildContext({ registryRoot: REPO_ROOT, profileExtensions: [] });
        expect(ctx.markdown).toMatch(/valida.*entradas|input validation|falla ruidosamente|fail loudly/i);
    });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd cli && npx jest tests/core/context/provider.test.ts`
Expected: FAIL — el invariante todavía no está en `using-awm/SKILL.md`.

- [ ] **Step 3: Agregar la sección al `using-awm/SKILL.md`**

En `registry/skills/using-awm/SKILL.md`, agregar al final una sección claramente delimitada (es contenido genérico de AWM, no política de skills — por eso va en su propio bloque):

```markdown
## Invariantes de robustez (agnósticos, AWM)

Reglas genéricas que AWM hereda a todo agente vía contexto inyectado. No son específicas de ningún proyecto:

- **Toda función pública valida sus entradas y falla ruidosamente.** Nunca devuelvas `Infinity`/`NaN`/`undefined` en silencio ante entradas inválidas o límite: lanzá un error explícito.
- **El alcance puede excluir *features*, nunca *seguridad/robustez*.** Que el diseño declare algo "fuera de alcance" justifica omitir una feature, no omitir la validación de entradas ni un invariante de robustez. La validación de entradas es un piso, no una feature.
```

- [ ] **Step 4: Correr y verificar PASS**

Run: `cd cli && npx jest tests/core/context/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add registry/skills/using-awm/SKILL.md cli/tests/core/context/provider.test.ts
git commit -m "feat(context): generic robustness invariant in awm-context (B-2 layer 1)"
```

---

## Task 4: Lente de seguridad en QA (Componente 5)

**Files:**
- Modify: `registry/skills/post-implementation-qa/SKILL.md`
- Modify: `registry/skills/post-implementation-qa/deep-review-prompt.md`

(Sin tests automatizados — es prosa de skill. Verificación = lectura.)

- [ ] **Step 1: Agregar la regla a la tabla de Tipos en `SKILL.md`**

En `registry/skills/post-implementation-qa/SKILL.md`, justo después de la tabla "Tipos de Hallazgos" (línea ~34), agregar:

```markdown
> **Lente de seguridad (alcance ≠ exención).** "Documentado-fuera-de-alcance" NO exime invariantes de seguridad/robustez. Una función pública que devuelve `Infinity`/`NaN`/`undefined` en silencio, o que crashea con entradas límite/inválidas, es un hallazgo **Type C aunque el diseño lo haya declarado fuera de alcance.** El alcance excluye *features*, nunca el piso de robustez.
```

- [ ] **Step 2: Agregar la lente al `deep-review-prompt.md`**

En `registry/skills/post-implementation-qa/deep-review-prompt.md`, dentro de la lista "**Type C — Quality bugs**" (línea ~36-42), agregar un bullet:

```markdown
    - Safety/robustness invariants violated even if the design declared them out of scope — a public function returning Infinity/NaN/undefined silently, or crashing on boundary/invalid input, is Type C regardless of stated scope
```

- [ ] **Step 3: Verificar las ediciones (lectura)**

Run: `grep -n "alcance ≠ exención\|out of scope" registry/skills/post-implementation-qa/SKILL.md registry/skills/post-implementation-qa/deep-review-prompt.md`
Expected: una coincidencia en cada archivo.

- [ ] **Step 4: Commit**

```bash
git add registry/skills/post-implementation-qa/SKILL.md registry/skills/post-implementation-qa/deep-review-prompt.md
git commit -m "feat(qa): security lens — scope does not exempt safety invariants (B-2 layer 4)"
```

---

## Task 5: Fijar el principio de frontera genérico/específico (Componente 3, doctrinal)

**Files:**
- Modify: `CLAUDE.md` (o `AGENTS.md` si es la fuente de verdad del repo — verificar cuál existe)

(Sin código. Ancla el principio donde el repo guarda sus reglas, para que futuros cambios no horneen específicos en los packs.)

- [ ] **Step 1: Detectar el archivo de reglas del repo**

Run: `ls CLAUDE.md AGENTS.md 2>/dev/null`
Usar el que exista (preferir `CLAUDE.md` si están ambos).

- [ ] **Step 2: Agregar la nota de frontera**

Agregar bajo una sección de convenciones de sensores/packs (o crear "## Sensores y packs"):

```markdown
## Sensores y packs — frontera genérico/específico

Los sensor-packs de AWM (`registry/sensor-packs/`) envían solo reglas **genéricas y agnósticas a clases de problema** (eval, secrets, SQL injection, validación de entradas). NO se hornean reglas nacidas de un bug puntual de un proyecto. Las reglas **específicas** las crece `harness-retro` **dentro del proyecto**, sobre los config files copiados (`.semgrep.awm.yml`, `eslint.config.awm.mjs`, `tests/structural/`). El framework nunca enumera bugs puntuales.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fix generic/specific boundary for sensor packs (B-2 Component 3)"
```

---

## Task 6: Verificación integral (Componente 1-2 sobre el propio `cli/`)

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Build del CLI**

Run: `cd cli && npm run build`
Expected: compila sin errores de TypeScript.

- [ ] **Step 2: Suite completa de tests**

Run: `cd cli && npm test`
Expected: PASS (jest --runInBand, toda la suite verde, incluidos los nuevos tests de reconcile / piso honesto / sensor test).

- [ ] **Step 3: Confirmar que el script `test` de `cli/` corre verde (lo que el sensor `test` invocaría)**

Run: `cd cli && npm test`
Expected: el comando que el sensor `test` ejecutaría (`npm test` → `jest --runInBand`) sale exit 0. Confirma que agregar el sensor `test` al pack js-ts no vuelve rojo a `cli/`.
**Caveat de recursión:** si algún test invocara `awm sensors run` con `--all` sobre la raíz de `cli/`, dispararía el sensor `test` recursivamente. Verificar con `grep -rn "runSensors\|sensors run" cli/tests/` que los tests usan dirs temporales, no la raíz de `cli/`.

- [ ] **Step 4: Repro manual del fix #2 (upgrade end-to-end)**

```bash
T=$(mktemp -d) && cd "$T" && git init -q && mkdir -p .awm
echo '{"pack":"generic","sensors":{"security":{"cmd":"semgrep .","fast":false}}}' > .awm/sensors.json
echo '{"scripts":{"test":"echo ok"}}' > package.json
awm sensors run --fast
```
Expected: el output JSON muestra `packUpgraded: "generic→js-ts"` y un `overall` honesto (no un `skipped` vacío). Limpiar: `rm -rf "$T"`.

- [ ] **Step 5: Commit (si hubo ajustes de verificación)**

Si los pasos anteriores no requirieron cambios, no hay commit. Si hubo fixes, commitearlos con mensaje descriptivo.

---

## Self-Review (cobertura del spec)

| Componente del design | Task |
|---|---|
| 1. Fix #2 (reconcilePack + piso honesto) | Task 1 |
| 2. Sensor `test` (exit-code) | Task 2 |
| 3. Frontera genérico/específico (doctrinal) | Task 5 |
| 4. Invariante genérico → awm-context | Task 3 |
| 5. Lente de seguridad en QA | Task 4 |
| Verificación (cli/ no se vuelve rojo) | Task 6 |

**Diferido explícito (NO en este plan):** trinquete de aprendizaje (B-3), entrega agnóstica de CONSTITUTION (B-1, Hallazgo #6), mutation testing activado.
