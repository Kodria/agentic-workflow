# Harness Stabilization (Body A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar los dos verdes falsos del harness — el sensor gate que pasa silencioso sin config, y los symlinks de skills rotos que nadie detecta — haciendo el estado real visible, honesto y auto-reparable.

**Architecture:** Dos componentes independientes. C1 reescribe el veredicto de `awm sensors run` a tres estados (`pass`/`fail`/`not_certified`) con auto-discovery del manifest caminando hacia arriba, y cierra el loop en las skills de gate. C2 agrega un módulo de integridad de symlinks que doctor reporta (read-only), init repara, y `awm update` endurece — reusando el patrón `linkState`/`classifyLinks` y el wiring de update ya existente.

**Tech Stack:** TypeScript/Node CLI, Jest, `fs`/`path` (built-ins), commander, picocolors.

**Diseño de referencia:** `docs/plans/2026-06-05-harness-stabilization-design.md`

---

## File Structure

| Archivo | Cambio | Responsabilidad |
|---|---|---|
| `cli/src/commands/sensors/types.ts` | Modify | Agregar `'not_certified'` a `RunOutput.overall` |
| `cli/src/commands/sensors/run.ts` | Modify | Auto-discovery (walk-up) + veredicto `not_certified` + DEGRADED=fail |
| `cli/src/commands/sensors/index.ts` | Modify | Handler: emitir JSON siempre, exit 0/1 (not_certified=0) |
| `cli/package.json` | Modify | `eslint` + `dependency-cruiser` en devDependencies |
| `cli/src/core/skill-integrity.ts` | Create | Clasificar y reparar symlinks globales de skills |
| `cli/src/core/diagnostics/types.ts` | Modify | `MachineFacts.globalSkills` |
| `cli/src/core/diagnostics/context.ts` | Modify | Poblar `globalSkills` (read-only) |
| `cli/src/core/diagnostics/checks.ts` | Modify | Fila `machine.globalSkills` |
| `cli/src/core/init/types.ts` | Modify | `InitActions.repairGlobalSkills` |
| `cli/src/core/init/steps.ts` | Modify | `stepGlobalSkillsRepair` + default action |
| `cli/src/core/init/orchestrator.ts` | Modify | Insertar el step en el orden de máquina |
| `cli/src/index.ts` | Modify | Endurecer `awm update` con reparación de symlinks |
| `registry/skills/verification-before-completion/SKILL.md` | Modify | Reconocer `not_certified` |
| `registry/skills/subagent-driven-development/implementer-prompt.md` | Modify | Reconocer `not_certified` |

---

## Componente 1 — Sensor gate honesto

### Contexto para el implementador

`cli/src/commands/sensors/run.ts` hoy:
- `readManifest(cwd)` (líneas 46-50) hace `path.join(cwd, '.awm/sensors.json')` — **sin walk-up**.
- `runSensors` (líneas 91-127): si no hay manifest → `return { sensors: [], overall: 'skipped' }`. El `overall` se computa al final (líneas 121-124) como `'fail' | 'skipped' | 'pass'`.
- `runSensor` (líneas ~60-89): cuando un binario no existe, `npx <tool>` sale non-zero; el catch (líneas 82-87) hace `errors.length > 0 ? 'fail' : 'skipped'` con `skipReason: exit N`. Un tool faltante cae en **skipped**, no fail.

`cli/src/commands/sensors/index.ts` handler de `run` (dentro de `registerSensorsCommand`):
```typescript
.action((opts) => {
    const output = runSensors({ fast: opts.fast, slow: opts.slow, all: opts.all });
    if (output.sensors.length > 0) {
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    }
    if (output.overall === 'fail') process.exit(1);
});
```

**Decisión de señal (del diseño):** `not_certified` sale **exit 0** pero el JSON siempre lleva `overall: 'not_certified'`. La distinción es por el campo, no por el exit code (exit 2 es blocking en hooks de Claude).

---

### Task 1: Estado `not_certified` + auto-discovery del manifest

**Files:**
- Modify: `cli/src/commands/sensors/types.ts`
- Modify: `cli/src/commands/sensors/run.ts`
- Test: `cli/tests/commands/sensors/run.test.ts` (puede existir; si no, crear)

- [ ] **Step 1: Escribir el test que falla**

Agregar en `cli/tests/commands/sensors/run.test.ts` (crear el archivo si no existe, con los imports de arriba):

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSensors } from '../../../src/commands/sensors/run';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensors-'));
}

describe('runSensors — not_certified + auto-discovery', () => {
    it('returns not_certified when no manifest exists anywhere up the tree', () => {
        const dir = mkTmp();
        const out = runSensors({ cwd: dir });
        expect(out.overall).toBe('not_certified');
        expect(out.sensors).toEqual([]);
    });

    it('discovers .awm/sensors.json in a parent directory (walk-up)', () => {
        const root = mkTmp();
        fs.mkdirSync(path.join(root, '.awm'));
        // Manifest con un sensor trivial que siempre pasa (echo no produce errores parseables).
        fs.writeFileSync(
            path.join(root, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'test', sensors: { noop: { cmd: 'echo ok', fast: true } } }),
        );
        const nested = path.join(root, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        const out = runSensors({ cwd: nested });
        expect(out.overall).not.toBe('not_certified');
        expect(out.sensors.length).toBe(1);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts --no-coverage`
Expected: FAIL — `overall` es `'skipped'` (no `'not_certified'`), y el walk-up no encuentra el manifest del padre.

- [ ] **Step 3: Agregar `not_certified` al tipo**

En `cli/src/commands/sensors/types.ts`, cambiar:
```typescript
export type RunOutput = {
    sensors: SensorResult[];
    overall: 'pass' | 'fail' | 'skipped';
};
```
por:
```typescript
export type RunOutput = {
    sensors: SensorResult[];
    overall: 'pass' | 'fail' | 'skipped' | 'not_certified';
};
```

- [ ] **Step 4: Implementar auto-discovery + not_certified en run.ts**

En `cli/src/commands/sensors/run.ts`, agregar un helper de walk-up justo después de `readManifest` (línea ~50):

```typescript
/**
 * Walk up from `startCwd` looking for the nearest ancestor that contains
 * `.awm/sensors.json` (git/.git pattern). Returns that directory, or null
 * if none is found before the filesystem root.
 */
function findManifestDir(startCwd: string): string | null {
    let dir = path.resolve(startCwd);
    while (true) {
        if (fs.existsSync(path.join(dir, MANIFEST_FILE))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null; // reached filesystem root
        dir = parent;
    }
}
```

Luego reemplazar el cuerpo inicial de `runSensors` (líneas 91-94):
```typescript
export function runSensors(opts: RunOptions = {}): RunOutput {
    const cwd = opts.cwd ?? process.cwd();
    const manifest = readManifest(cwd);
    if (!manifest) return { sensors: [], overall: 'skipped' };
```
por:
```typescript
export function runSensors(opts: RunOptions = {}): RunOutput {
    const startCwd = opts.cwd ?? process.cwd();
    const manifestDir = findManifestDir(startCwd);
    if (!manifestDir) return { sensors: [], overall: 'not_certified' };
    const manifest = readManifest(manifestDir);
    if (!manifest) return { sensors: [], overall: 'not_certified' };
    const cwd = manifestDir; // ejecutar sensores y baseline desde donde vive el manifest
```

(El resto de `runSensors` sigue usando `cwd` para `readBaseline(cwd)` y `runSensor(..., cwd)`, ahora apuntando a `manifestDir`. No cambia nada más en esas líneas.)

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts --no-coverage`
Expected: PASS (ambos tests).

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/sensors/types.ts cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run.test.ts
git commit -m "feat(sensors): not_certified state + manifest auto-discovery (walk-up)"
```

---

### Task 2: DEGRADED (tool faltante) cuenta como fail

**Files:**
- Modify: `cli/src/commands/sensors/run.ts`
- Test: `cli/tests/commands/sensors/run.test.ts`

### Contexto

Hoy un sensor cuyo binario no existe (`npx eslint` sin eslint instalado) cae en `status: 'skipped'` con `skipReason: 'exit N: ...'` (líneas 82-87 de run.ts), y el `overall` ignora skipped → puede dar `pass`. El gate no puede certificar lo que no pudo correr: un tool faltante debe ser `fail`.

Distinguimos "tool faltante" por el patrón de error de npm/Node: el mensaje contiene `command not found`, `not found`, `ENOENT`, o `could not determine executable` (npx). Es heurística pero suficiente; cualquier otro exit non-zero sin errores parseables sigue siendo skipped legítimo (ej. un script que aborta por otra razón).

- [ ] **Step 1: Escribir el test que falla**

Agregar en `cli/tests/commands/sensors/run.test.ts`:

```typescript
describe('runSensors — missing tool is a fail, not a skip', () => {
    it('marks a sensor whose binary is missing as fail', () => {
        const root = mkTmp();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(
            path.join(root, '.awm', 'sensors.json'),
            JSON.stringify({
                pack: 'test',
                sensors: { ghost: { cmd: 'awm-nonexistent-binary-xyz --check', fast: true } },
            }),
        );
        const out = runSensors({ cwd: root });
        const ghost = out.sensors.find((s) => s.name === 'ghost');
        expect(ghost?.status).toBe('fail');
        expect(out.overall).toBe('fail');
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts --no-coverage -t "missing tool"`
Expected: FAIL — `ghost.status` es `'skipped'`, `overall` no es `'fail'`.

- [ ] **Step 3: Implementar la detección de tool faltante en runSensor**

En `cli/src/commands/sensors/run.ts`, dentro del `catch` de `runSensor` (líneas ~82-87), antes del `return ... skipReason` final, agregar la rama de tool faltante. El bloque actual:
```typescript
        // Non-zero exit — the normal path for linters/typecheckers that found
        // findings. Parse the output; if it yields findings, that's a fail.
        if (errors.length > 0) return { name, status: 'fail', errors };
        return { name, status: 'skipped', errors: [], skipReason: `exit ${err.status}: ${raw.slice(0, 200)}` };
```
reemplazarlo por:
```typescript
        // Non-zero exit — the normal path for linters/typecheckers that found
        // findings. Parse the output; if it yields findings, that's a fail.
        if (errors.length > 0) return { name, status: 'fail', errors };
        // A missing tool (binary not installed) must NOT pass silently — the gate
        // cannot certify what it could not run. Treat it as a fail with a clear message.
        const lower = raw.toLowerCase();
        const toolMissing =
            lower.includes('command not found') ||
            lower.includes('not found') ||
            lower.includes('enoent') ||
            lower.includes('could not determine executable');
        if (toolMissing) {
            return {
                name,
                status: 'fail',
                errors: [{ message: `sensor tool not available: ${raw.slice(0, 200)}` }],
            };
        }
        return { name, status: 'skipped', errors: [], skipReason: `exit ${err.status}: ${raw.slice(0, 200)}` };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd cli && npx jest tests/commands/sensors/run.test.ts --no-coverage`
Expected: PASS (todos los de run.test.ts).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run.test.ts
git commit -m "feat(sensors): missing tool counts as fail, not silent skip"
```

---

### Task 3: Handler de `run` — emitir veredicto siempre + exit codes

**Files:**
- Modify: `cli/src/commands/sensors/index.ts`
- Test: `cli/tests/commands/sensors/index.test.ts` (crear si no existe)

### Contexto

El handler hoy solo imprime si `sensors.length > 0` y solo sale 1 si `overall === 'fail'`. Resultado: `not_certified` (sensors vacío) → sin output, exit 0 → indistinguible de pass. Nuevo: emitir el JSON **siempre**, exit 1 solo en `fail`, exit 0 en el resto (incluido `not_certified`, cuya señal va en el campo `overall`).

- [ ] **Step 1: Escribir el test que falla**

Como el handler llama `process.exit`, testeamos la lógica de mapeo extrayéndola a una función pura. Crear en `cli/tests/commands/sensors/index.test.ts`:

```typescript
import { exitCodeFor, RunOutputLike } from '../../../src/commands/sensors/index';

describe('exitCodeFor — sensor run verdict → exit code', () => {
    const base = (overall: RunOutputLike['overall']): RunOutputLike => ({ sensors: [], overall });
    it('pass → 0', () => expect(exitCodeFor(base('pass'))).toBe(0));
    it('skipped → 0', () => expect(exitCodeFor(base('skipped'))).toBe(0));
    it('not_certified → 0 (signal is in overall, not exit code)', () =>
        expect(exitCodeFor(base('not_certified'))).toBe(0));
    it('fail → 1', () => expect(exitCodeFor(base('fail'))).toBe(1));
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/commands/sensors/index.test.ts --no-coverage`
Expected: FAIL — `exitCodeFor` / `RunOutputLike` no existen.

- [ ] **Step 3: Implementar `exitCodeFor` y reescribir el handler**

En `cli/src/commands/sensors/index.ts`, agregar arriba (después de los imports) la función pura y su tipo, y exportarlos:

```typescript
export type RunOutputLike = { sensors: unknown[]; overall: 'pass' | 'fail' | 'skipped' | 'not_certified' };

/** Map a sensor run verdict to a process exit code. fail → 1; everything else → 0.
 *  not_certified intentionally exits 0: its signal lives in `overall`, because
 *  exit code 2 is a blocking error in Claude Code hooks. */
export function exitCodeFor(output: RunOutputLike): number {
    return output.overall === 'fail' ? 1 : 0;
}
```

Reemplazar el `.action` del subcomando `run`:
```typescript
        .action((opts) => {
            const output = runSensors({ fast: opts.fast, slow: opts.slow, all: opts.all });
            if (output.sensors.length > 0) {
                process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            }
            if (output.overall === 'fail') process.exit(1);
        });
```
por:
```typescript
        .action((opts) => {
            const output = runSensors({ fast: opts.fast, slow: opts.slow, all: opts.all });
            // Emit the verdict ALWAYS — an empty `sensors` with overall:'not_certified'
            // must be visible, never a silent exit-0 that reads as "clean".
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            const code = exitCodeFor(output);
            if (code !== 0) process.exit(code);
        });
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd cli && npx jest tests/commands/sensors/index.test.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/index.ts cli/tests/commands/sensors/index.test.ts
git commit -m "feat(sensors): run always emits verdict; not_certified exits 0 via overall field"
```

---

### Task 4: Instalar eslint + dependency-cruiser en devDeps de cli/

**Files:**
- Modify: `cli/package.json`

### Contexto

`cli/.awm/sensors.json` referencia `npx eslint` y `npx depcruise`, pero no están en devDependencies → `awm sensors status` reporta DEGRADED y (tras Task 2) `awm sensors run` desde `cli/` daría `fail`. Instalarlos lleva el run de `cli/` a `pass`.

- [ ] **Step 1: Instalar las dependencias**

```bash
cd cli && npm install --save-dev eslint dependency-cruiser
```
Expected: ambos paquetes aparecen en `cli/package.json` devDependencies, sin errores.

- [ ] **Step 2: Verificar que los binarios resuelven localmente**

```bash
cd cli && npx eslint --version && npx depcruise --version
```
Expected: ambas versiones se imprimen sin descargar nada remoto.

- [ ] **Step 3: Verificar el status de sensores desde cli/**

```bash
cd cli && awm sensors status
```
Expected: `eslint` y `depcheck` ahora con ✔ (instalados). El `overall` puede seguir DEGRADED solo si queda otro tool faltante; eslint y depcheck deben pasar a ✔.

- [ ] **Step 4: Commit**

```bash
git add cli/package.json cli/package-lock.json
git commit -m "chore(cli): add eslint + dependency-cruiser to devDeps so sensors run locally"
```

---

### Task 5: Cerrar el loop en las skills de gate

**Files:**
- Modify: `registry/skills/verification-before-completion/SKILL.md`
- Modify: `registry/skills/subagent-driven-development/implementer-prompt.md`

### Contexto

El bug raíz era que las skills leían `exit 0` como "sensores OK". Ahora `not_certified` también sale 0; la distinción está en `overall`. Las skills deben leer el veredicto, no el exit code, y tratar `not_certified` como "no certifica" — nunca verde.

- [ ] **Step 1: Localizar la sección de sensores en verification-before-completion**

```bash
grep -n "sensors run\|overall\|awm sensors" registry/skills/verification-before-completion/SKILL.md
```
Expected: encuentra la(s) línea(s) donde se instruye correr `awm sensors run`.

- [ ] **Step 2: Agregar la regla de `not_certified` en verification-before-completion**

Insertar el siguiente bloque inmediatamente después de la instrucción existente de correr `awm sensors run` (ubicada en el Step 1):

```markdown
**Lee el veredicto, no el exit code.** `awm sensors run` emite JSON con un campo `overall`:
- `overall: "pass"` → sensores corrieron, sin hallazgos nuevos. Verde.
- `overall: "fail"` → hay hallazgos nuevos o un tool faltante. Bloquea hasta resolver.
- `overall: "not_certified"` → no hay `.awm/sensors.json` en el árbol. **NO es un pass.** Decláralo explícito como "sin sensores configurados — gate no certificado". Nunca lo reportes como "sensores OK".

`exit 0` NO significa "limpio" por sí solo: `not_certified` también sale 0. La señal autoritativa es `overall`.
```

- [ ] **Step 3: Agregar la regla de `not_certified` en el implementer-prompt**

En `registry/skills/subagent-driven-development/implementer-prompt.md`, localizar el paso de sensores (el que dice correr `awm sensors run` antes de reportar DONE) y agregar, dentro de ese mismo paso:

```markdown
       **Lee `overall`, no el exit code.** `not_certified` (sin `.awm/sensors.json`)
       también sale exit 0 — NO lo reportes como "sensors pass". Si el veredicto es
       `not_certified`, dilo explícito: "sin sensores configurados, gate no certificado".
       Solo `overall: "pass"` cuenta como verde; `fail` se arregla antes de reportar DONE.
```

- [ ] **Step 4: Verificar que ambos archivos mencionan not_certified**

```bash
grep -l "not_certified" registry/skills/verification-before-completion/SKILL.md registry/skills/subagent-driven-development/implementer-prompt.md
```
Expected: ambos archivos listados.

- [ ] **Step 5: Commit**

```bash
git add registry/skills/verification-before-completion/SKILL.md registry/skills/subagent-driven-development/implementer-prompt.md
git commit -m "docs(skills): gate reads sensor 'overall' field; not_certified is never a pass"
```

---

## Componente 2 — Integridad de symlinks de skills

### Contexto para el implementador

`cli/src/core/diagnostics/context.ts` ya tiene el patrón a espejar:
- `linkState(dir, skill)` (líneas 19-25) → `'present' | 'broken' | 'absent'`.
- `classifyLinks(skillNames, dir)` (líneas 27-36) → `{ linked, broken }`.
- `gatherMachine` (líneas 81-139) computa `devCore.brokenLinks` pero **solo sobre el set baseline** (`resolveBundleSkills(baseline.name, ...)`), no sobre todo `~/.claude/skills`. Por eso los 19 huérfanos (skills fuera del baseline) pasan.

Constantes:
- `REGISTRY_DIR` = `~/.awm/cli-source` (de `../registry`).
- `REGISTRY_CONTENT_DIR` = `path.join(REGISTRY_DIR, 'registry')` (de `../bundles`) → ahí viven las skills en `registry/skills/<name>`.
- `PROVIDERS['claude-code'].skill.global` = `~/.claude/skills`.

---

### Task 6: Módulo `skill-integrity.ts` — clasificar y reparar

**Files:**
- Create: `cli/src/core/skill-integrity.ts`
- Test: `cli/tests/core/skill-integrity.test.ts`

### Contexto

Un symlink en `~/.claude/skills/<name>`:
- **valid** → es symlink y su target existe.
- **repairable** → es symlink colgante (target no existe) PERO existe `<registryContentDir>/skills/<name>` (se puede re-linkear a cli-source).
- **dead** → symlink colgante y la skill ya no existe en el registry (podar).

`repairGlobalSkills` re-linkea los repairable (borra el colgante, crea symlink nuevo a cli-source) y poda los dead (borra el colgante). Idempotente: los valid se saltan. Cada symlink en try/catch aislado.

- [ ] **Step 1: Escribir el test que falla**

Crear `cli/tests/core/skill-integrity.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { classifyGlobalSkills, repairGlobalSkills } from '../../src/core/skill-integrity';

function setup(): { skillsDir: string; registryContentDir: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-integrity-'));
    const skillsDir = path.join(tmp, 'claude-skills');
    const registryContentDir = path.join(tmp, 'registry');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(path.join(registryContentDir, 'skills'), { recursive: true });
    return { skillsDir, registryContentDir };
}

function makeRegistrySkill(registryContentDir: string, name: string): string {
    const dir = path.join(registryContentDir, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
    return dir;
}

describe('classifyGlobalSkills', () => {
    it('classifies valid / repairable / dead', () => {
        const { skillsDir, registryContentDir } = setup();

        // valid: symlink a una skill que existe en el registry
        const okTarget = makeRegistrySkill(registryContentDir, 'alpha');
        fs.symlinkSync(okTarget, path.join(skillsDir, 'alpha'), 'dir');

        // repairable: symlink colgante, pero la skill SÍ existe en el registry
        makeRegistrySkill(registryContentDir, 'beta');
        fs.symlinkSync(path.join('/nonexistent/old-root/beta'), path.join(skillsDir, 'beta'), 'dir');

        // dead: symlink colgante y la skill NO existe en el registry
        fs.symlinkSync(path.join('/nonexistent/old-root/gamma'), path.join(skillsDir, 'gamma'), 'dir');

        const result = classifyGlobalSkills(skillsDir, registryContentDir);
        expect(result.valid).toEqual(['alpha']);
        expect(result.repairable).toEqual(['beta']);
        expect(result.dead).toEqual(['gamma']);
    });

    it('returns empty arrays when the skills dir does not exist', () => {
        const result = classifyGlobalSkills('/nonexistent/dir', '/also/nonexistent');
        expect(result).toEqual({ valid: [], repairable: [], dead: [] });
    });
});

describe('repairGlobalSkills', () => {
    it('re-links repairable to cli-source and prunes dead; valid untouched; idempotent', () => {
        const { skillsDir, registryContentDir } = setup();

        const okTarget = makeRegistrySkill(registryContentDir, 'alpha');
        fs.symlinkSync(okTarget, path.join(skillsDir, 'alpha'), 'dir');
        makeRegistrySkill(registryContentDir, 'beta');
        fs.symlinkSync(path.join('/nonexistent/old-root/beta'), path.join(skillsDir, 'beta'), 'dir');
        fs.symlinkSync(path.join('/nonexistent/old-root/gamma'), path.join(skillsDir, 'gamma'), 'dir');

        const r1 = repairGlobalSkills(skillsDir, registryContentDir);
        expect(r1.relinked).toEqual(['beta']);
        expect(r1.pruned).toEqual(['gamma']);

        // beta ahora apunta a cli-source y resuelve
        expect(fs.existsSync(path.join(skillsDir, 'beta'))).toBe(true);
        expect(fs.realpathSync(path.join(skillsDir, 'beta')))
            .toBe(fs.realpathSync(path.join(registryContentDir, 'skills', 'beta')));
        // gamma podado
        expect(fs.existsSync(path.join(skillsDir, 'gamma'))).toBe(false);
        // alpha intacto
        expect(fs.existsSync(path.join(skillsDir, 'alpha'))).toBe(true);

        // idempotente: segunda corrida no cambia nada
        const r2 = repairGlobalSkills(skillsDir, registryContentDir);
        expect(r2.relinked).toEqual([]);
        expect(r2.pruned).toEqual([]);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/core/skill-integrity.test.ts --no-coverage`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `cli/src/core/skill-integrity.ts`**

```typescript
// src/core/skill-integrity.ts
//
// Integridad de symlinks de skills globales en ~/.claude/skills.
// Un symlink puede estar: valid (target existe), repairable (colgante pero la
// skill existe en el registry → re-linkeable), o dead (colgante y ya no existe).
import fs from 'fs';
import path from 'path';

export type SkillIntegrity = {
    valid: string[];
    repairable: string[];
    dead: string[];
};

export type RepairResult = {
    relinked: string[];
    pruned: string[];
    failed: string[];
};

function registrySkillPath(registryContentDir: string, name: string): string {
    return path.join(registryContentDir, 'skills', name);
}

/** Clasifica cada entrada de `skillsDir` (read-only, no muta nada). */
export function classifyGlobalSkills(skillsDir: string, registryContentDir: string): SkillIntegrity {
    const out: SkillIntegrity = { valid: [], repairable: [], dead: [] };
    let entries: string[];
    try { entries = fs.readdirSync(skillsDir); }
    catch { return out; } // dir ausente → nada que clasificar

    for (const name of entries) {
        const p = path.join(skillsDir, name);
        let lst: fs.Stats;
        try { lst = fs.lstatSync(p); } catch { continue; }
        if (!lst.isSymbolicLink()) continue; // dirs/archivos reales no son nuestro problema
        if (fs.existsSync(p)) { out.valid.push(name); continue; } // target vivo
        // symlink colgante → ¿reparable o muerto?
        if (fs.existsSync(registrySkillPath(registryContentDir, name))) out.repairable.push(name);
        else out.dead.push(name);
    }
    return out;
}

/** Re-linkea los repairable a cli-source y poda los dead. Idempotente. Cada
 *  symlink aislado en try/catch — una falla no aborta el resto. */
export function repairGlobalSkills(skillsDir: string, registryContentDir: string): RepairResult {
    const result: RepairResult = { relinked: [], pruned: [], failed: [] };
    const { repairable, dead } = classifyGlobalSkills(skillsDir, registryContentDir);

    for (const name of repairable) {
        const p = path.join(skillsDir, name);
        try {
            fs.rmSync(p, { force: true });
            fs.symlinkSync(registrySkillPath(registryContentDir, name), p, 'dir');
            result.relinked.push(name);
        } catch { result.failed.push(name); }
    }
    for (const name of dead) {
        const p = path.join(skillsDir, name);
        try { fs.rmSync(p, { force: true }); result.pruned.push(name); }
        catch { result.failed.push(name); }
    }
    return result;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd cli && npx jest tests/core/skill-integrity.test.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/skill-integrity.ts cli/tests/core/skill-integrity.test.ts
git commit -m "feat(core): skill-integrity module — classify + repair global skill symlinks"
```

---

### Task 7: Doctor reporta los symlinks globales rotos

**Files:**
- Modify: `cli/src/core/diagnostics/types.ts`
- Modify: `cli/src/core/diagnostics/context.ts`
- Modify: `cli/src/core/diagnostics/checks.ts`
- Test: `cli/tests/core/diagnostics/checks.test.ts` (puede existir; si no, crear)

### Contexto

Agregamos `globalSkills` a `MachineFacts`, lo poblamos en `gatherMachine` con `classifyGlobalSkills` (read-only), y agregamos una fila `machine.globalSkills` en `machineChecks`: ok si no hay repairable/dead; warn con remedy `awm init` si hay alguno.

- [ ] **Step 1: Escribir el test que falla**

En `cli/tests/core/diagnostics/checks.test.ts` (crear con imports si no existe):

```typescript
import { buildReport } from '../../../src/core/diagnostics/checks';
import { HarnessContext } from '../../../src/core/diagnostics/types';

function machineCtx(globalSkills: { valid: string[]; repairable: string[]; dead: string[] }): HarnessContext {
    return {
        machine: {
            cliSource: { present: true, version: '1.0.0', gitState: 'clean' },
            hook: { present: true, degraded: false },
            devCore: { present: true, brokenLinks: [] },
            ambient: { wanted: [], installed: [] },
            contextInjection: [],
            globalSkills,
        },
        project: null,
    };
}

describe('machineChecks — global skill integrity', () => {
    it('ok when no broken global skill links', () => {
        const report = buildReport(machineCtx({ valid: ['a'], repairable: [], dead: [] }));
        const row = report.results.find((r) => r.id === 'machine.globalSkills');
        expect(row?.status).toBe('ok');
    });

    it('warns with awm init remedy when there are broken links', () => {
        const report = buildReport(machineCtx({ valid: ['a'], repairable: ['b'], dead: ['c'] }));
        const row = report.results.find((r) => r.id === 'machine.globalSkills');
        expect(row?.status).toBe('warn');
        expect(row?.detail).toContain('2'); // 1 repairable + 1 dead
        expect(row?.remedy).toEqual({ kind: 'command', value: 'awm init' });
    });
});
```

> Nota: el reporte se construye con la función exportada que arma `CheckReport` desde un `HarnessContext`. Verificar el nombre real de esa función con `grep -n "export function" cli/src/core/diagnostics/checks.ts`; si no es `buildReport`, usar el nombre real en el test y en el import.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/core/diagnostics/checks.test.ts --no-coverage`
Expected: FAIL — `globalSkills` no existe en el tipo / no hay fila `machine.globalSkills`.

- [ ] **Step 3: Agregar `globalSkills` a MachineFacts**

En `cli/src/core/diagnostics/types.ts`, dentro de `interface MachineFacts`, agregar el campo después de `contextInjection`:
```typescript
    contextInjection: { agent: AgentTarget; state: InjectionState }[];
    globalSkills: { valid: string[]; repairable: string[]; dead: string[] };
```

- [ ] **Step 4: Poblar `globalSkills` en context.ts**

En `cli/src/core/diagnostics/context.ts`:

Agregar el import (junto a los existentes, después de la línea de `bundles`):
```typescript
import { classifyGlobalSkills } from '../skill-integrity';
import { REGISTRY_CONTENT_DIR } from '../bundles';
```

En `gatherMachine`, en el `return { ... }` final (líneas 132-138), agregar el campo:
```typescript
    return {
        cliSource: { present: cliPresent, version, gitState },
        hook: { present: hookPresent, degraded: hookDegraded },
        devCore: { present: devCorePresent, brokenLinks },
        ambient: { wanted, installed },
        contextInjection: gatherContextInjection(),
        globalSkills: classifyGlobalSkills(skillsDir, REGISTRY_CONTENT_DIR),
    };
```
(`skillsDir` ya está definido en línea 105: `const skillsDir = PROVIDERS['claude-code'].skill.global;`.)

- [ ] **Step 5: Agregar la fila en checks.ts**

En `cli/src/core/diagnostics/checks.ts`, dentro de `machineChecks`, después del bloque `machine.devCore` (línea ~48) y antes del loop de `machine.ambient`:
```typescript
    // machine.globalSkills — integridad de symlinks en ~/.claude/skills (fuera del baseline)
    const brokenGlobal = m.globalSkills.repairable.length + m.globalSkills.dead.length;
    if (brokenGlobal === 0) {
        out.push({ id: 'machine.globalSkills', level: 'machine', label: 'skills globales', status: 'ok', remedy: none });
    } else {
        out.push({ id: 'machine.globalSkills', level: 'machine', label: 'skills globales', status: 'warn',
            detail: `${brokenGlobal} enlaces rotos`, remedy: cmd('awm init') });
    }
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd cli && npx jest tests/core/diagnostics/checks.test.ts --no-coverage`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/diagnostics/types.ts cli/src/core/diagnostics/context.ts cli/src/core/diagnostics/checks.ts cli/tests/core/diagnostics/checks.test.ts
git commit -m "feat(doctor): report broken global skill symlinks (machine.globalSkills)"
```

---

### Task 8: Reparar en `awm init` (nuevo step)

**Files:**
- Modify: `cli/src/core/init/types.ts`
- Modify: `cli/src/core/init/steps.ts`
- Modify: `cli/src/core/init/orchestrator.ts`
- Test: `cli/tests/core/init/steps.test.ts` (puede existir; si no, crear)

### Contexto

Agregamos `repairGlobalSkills` a `InitActions`, un `stepGlobalSkillsRepair` que lo llama cuando hay repairable/dead, y lo insertamos en el orden de máquina del orquestador (después de `stepDevCore`). El step es idempotente: si no hay nada roto, `skipped`.

- [ ] **Step 1: Escribir el test que falla**

En `cli/tests/core/init/steps.test.ts` (crear con imports si no existe):

```typescript
import { stepGlobalSkillsRepair } from '../../../src/core/init/steps';
import type { InitDeps } from '../../../src/core/init/types';

function depsWith(globalSkills: { valid: string[]; repairable: string[]; dead: string[] }, spy: jest.Mock): InitDeps {
    return {
        cwd: '/tmp/x',
        ctx: { machine: { globalSkills } as any, project: null } as any,
        bundles: [],
        agent: 'claude-code',
        installMethod: 'symlink',
        registryRoot: '/reg',
        contentDir: '/reg/registry',
        confirmExtensions: async () => [],
        actions: { repairGlobalSkills: spy } as any,
    };
}

describe('stepGlobalSkillsRepair', () => {
    it('skips when nothing is broken', () => {
        const spy = jest.fn();
        const res = stepGlobalSkillsRepair(depsWith({ valid: ['a'], repairable: [], dead: [] }, spy));
        expect(res.action).toBe('skipped');
        expect(spy).not.toHaveBeenCalled();
    });

    it('applies repair when there are broken links', () => {
        const spy = jest.fn().mockReturnValue({ relinked: ['b'], pruned: ['c'], failed: [] });
        const res = stepGlobalSkillsRepair(depsWith({ valid: ['a'], repairable: ['b'], dead: ['c'] }, spy));
        expect(res.action).toBe('applied');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(res.detail).toContain('re-linked 1');
        expect(res.detail).toContain('pruned 1');
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/core/init/steps.test.ts --no-coverage -t "stepGlobalSkillsRepair"`
Expected: FAIL — `stepGlobalSkillsRepair` no existe.

- [ ] **Step 3: Agregar la acción a InitActions**

En `cli/src/core/init/types.ts`, dentro de `interface InitActions`, agregar después de `installContext`:
```typescript
    installContext: (op: ContextOp) => void;
    repairGlobalSkills: (skillsDir: string, registryContentDir: string) => { relinked: string[]; pruned: string[]; failed: string[] };
```

- [ ] **Step 4: Implementar el step y la default action en steps.ts**

En `cli/src/core/init/steps.ts`:

Agregar imports (junto a los existentes):
```typescript
import { repairGlobalSkills as realRepairGlobalSkills } from '../skill-integrity';
import { REGISTRY_CONTENT_DIR } from '../bundles';
import { PROVIDERS } from '../../providers';
```
(Si `getInjection` ya se importa de `'../../providers'`, agregar `PROVIDERS` a ese import existente en vez de duplicar la línea.)

Agregar la default action dentro de `defaultActions` (después de `installContext`):
```typescript
    installContext: (op) => { realInjectionOrchestrator.installContext(op); },

    repairGlobalSkills: (skillsDir, registryContentDir) => realRepairGlobalSkills(skillsDir, registryContentDir),
```

Agregar el step (después de `stepDevCore`, línea ~130):
```typescript
/** Step 3.5 – Repair broken global skill symlinks (orphans outside the baseline). */
export function stepGlobalSkillsRepair(d: InitDeps): StepResult {
    const { globalSkills } = d.ctx.machine;
    const broken = globalSkills.repairable.length + globalSkills.dead.length;
    if (broken === 0) return ok('machine.globalSkills', 'machine', 'skipped');

    const skillsDir = PROVIDERS['claude-code'].skill.global;
    const r = d.actions.repairGlobalSkills(skillsDir, REGISTRY_CONTENT_DIR);
    return ok('machine.globalSkills', 'machine', 'applied', `re-linked ${r.relinked.length}, pruned ${r.pruned.length}`);
}
```

- [ ] **Step 5: Insertar el step en el orquestador**

En `cli/src/core/init/orchestrator.ts`:

Agregar `stepGlobalSkillsRepair` al import de steps (línea 4-5):
```typescript
    stepCache, stepHook, stepContextInjection, stepDevCore, stepGlobalSkillsRepair, stepAmbient,
```

Insertar la llamada después de `stepDevCore` (línea ~37):
```typescript
    steps.push(await wrapStep('machine.devCore', 'machine', () => stepDevCore(deps)));
    steps.push(await wrapStep('machine.globalSkills', 'machine', () => stepGlobalSkillsRepair(deps)));
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd cli && npx jest tests/core/init/steps.test.ts --no-coverage -t "stepGlobalSkillsRepair"`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/init/types.ts cli/src/core/init/steps.ts cli/src/core/init/orchestrator.ts cli/tests/core/init/steps.test.ts
git commit -m "feat(init): stepGlobalSkillsRepair re-links and prunes broken global skills"
```

---

### Task 9: Endurecer `awm update` con reparación de symlinks

**Files:**
- Modify: `cli/src/index.ts`

### Contexto

`awm update` (en `cli/src/index.ts`, comando `update`) ya corre `syncRegistry()`, `buildCli()` y `regenerateGlobalContext()`, cada uno con su manejo de error. Agregamos un paso que reconcilia symlinks globales rotos en su propio try/catch — un cliente con layout viejo se auto-cura en el próximo `awm update`. No puede abortar un update exitoso.

- [ ] **Step 1: Agregar el import**

En `cli/src/index.ts`, junto a los imports existentes, agregar:
```typescript
import { repairGlobalSkills } from './core/skill-integrity';
import { REGISTRY_CONTENT_DIR } from './core/bundles';
import { PROVIDERS } from './providers';
```
(Si `PROVIDERS` ya se importa de `'./providers'` en index.ts —lo hace en línea 8—, no duplicar: ya está disponible.)

- [ ] **Step 2: Agregar el bloque de reparación en el comando update**

En el cuerpo del `try` del comando `update`, después del bloque de `regenerateGlobalContext` (el `try { const regen = ... } catch { ... }`) y antes de `outro(...)`, insertar:
```typescript
          try {
              const skillsDir = PROVIDERS['claude-code'].skill.global;
              const repair = repairGlobalSkills(skillsDir, REGISTRY_CONTENT_DIR);
              const touched = repair.relinked.length + repair.pruned.length;
              if (touched > 0) {
                  console.log(pc.green(`  ✓ Reconciled skill links: re-linked ${repair.relinked.length}, pruned ${repair.pruned.length}`));
              }
          } catch {
              // la reconciliación de symlinks no debe abortar un update exitoso
          }
```

- [ ] **Step 3: Verificar que compila**

Run: `cd cli && npx tsc --noEmit`
Expected: cero errores.

- [ ] **Step 4: Build + smoke test**

```bash
cd cli && npm run build && node dist/src/index.js update --help
```
Expected: help del comando `update`, sin crash.

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(update): reconcile broken global skill symlinks after registry pull"
```

---

## Task 10: Regresión completa + reparación real de esta máquina

**Files:** ninguno de código (verificación + reparación in-situ).

### Contexto

Tras todo lo anterior, corremos la suite completa, tsc, y aplicamos la reparación real a las 19 skills rotas de esta máquina vía el binario recién compilado.

- [ ] **Step 1: tsc estricto**

Run: `cd cli && npx tsc --noEmit`
Expected: cero errores.

- [ ] **Step 2: Suite completa**

Run: `cd cli && npm test`
Expected: todos los tests verdes (los nuevos de sensors/skill-integrity/diagnostics/init + sin regresión).

- [ ] **Step 3: Reparar las skills rotas reales de esta máquina**

```bash
cd cli && npm run build && node dist/src/index.js doctor
```
Expected: doctor ahora muestra `⚠ skills globales: N enlaces rotos`.

```bash
cd /Users/cencosud/Developments/personal/agentic-workflow && awm init
```
Expected: el step `machine.globalSkills` reporta `re-linked N, pruned M`.

- [ ] **Step 4: Verificar la reparación**

```bash
find ~/.claude/skills/ -type l ! -exec test -e {} \; -print | wc -l
```
Expected: `0` (cero symlinks rotos).

```bash
awm doctor
```
Expected: `✔ skills globales` (o ausencia de la fila de rotos).

- [ ] **Step 5: Verificar el sensor gate honesto end-to-end**

```bash
cd /Users/cencosud/Developments/personal/agentic-workflow && awm sensors run; echo "exit:$?"
```
Expected: JSON con `"overall": "not_certified"` visible, exit 0 (ya no un no-op silencioso).

```bash
cd cli && awm sensors run --fast; echo "exit:$?"
```
Expected: JSON con `overall: "pass"` (eslint/depcruise ya instalados), exit 0.

- [ ] **Step 6: Commit (si tsc/test requirió ajustes)**

```bash
git add -A
git commit -m "chore: full suite green after harness stabilization"
```

---

## Self-Review

**1. Spec coverage:**
- C1 not_certified + auto-discovery → Task 1 ✔
- C1 DEGRADED=fail → Task 2 ✔
- C1 handler exit codes + emitir siempre → Task 3 ✔
- C1 instalar eslint/depcruise → Task 4 ✔
- C1 cerrar loop en skills → Task 5 ✔
- C2 módulo classify+repair → Task 6 ✔
- C2 doctor detecta → Task 7 ✔
- C2 init repara → Task 8 ✔
- C2 endurecer update → Task 9 ✔
- Regresión + reparación real → Task 10 ✔

**2. Placeholder scan:** sin TBD/TODO. Cada step trae código completo. Única nota de verificación (nombre de `buildReport`) es explícita y accionable, no un placeholder.

**3. Type consistency:**
- `not_certified` agregado a `RunOutput.overall` (Task 1) y usado en `RunOutputLike`/`exitCodeFor` (Task 3) y skills (Task 5). Consistente.
- `SkillIntegrity = { valid, repairable, dead }` (Task 6) usado idéntico en `MachineFacts.globalSkills` (Task 7), `classifyGlobalSkills` return, y el step (Task 8). Consistente.
- `RepairResult = { relinked, pruned, failed }` (Task 6) usado en `InitActions.repairGlobalSkills` (Task 8) y el bloque de update (Task 9). Consistente.
- `classifyGlobalSkills(skillsDir, registryContentDir)` / `repairGlobalSkills(skillsDir, registryContentDir)` — misma firma en módulo, context.ts, step, y update. Consistente.
