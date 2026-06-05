# AWM Update — Rebuild CLI after Registry Pull
<!-- awm-qa-complete: 2026-06-05 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que `awm update` compile el CLI después de hacer pull del registry, de modo que los clientes reciban el nuevo código sin tener que correr `npm run build` manualmente.

**Architecture:** Una función `buildCli(cliDir?)` en `registry.ts` ejecuta `npm run build` en `~/.awm/cli-source/cli/` usando `spawnSync`. Si falla, el update no aborta — solo muestra un warning (el source actualizado queda listo para el próximo intento). El comando `update` en `index.ts` la invoca con su propio spinner entre el pull y el regen del contexto.

**Tech Stack:** TypeScript/Node CLI, Jest, `child_process.spawnSync` (Node built-in, cero dependencias nuevas).

**Contexto:** AWM es un CLI distribuible. `awm update` hace `git pull` de `~/.awm/cli-source` pero no rebuilda el `dist/` — los clientes corren código viejo hasta que regeneran el build manualmente. Este plan cierra ese gap.

---

## File Structure

| Archivo | Cambio |
|---|---|
| `cli/src/core/registry.ts` | Agregar `buildCli(cliDir?)` + import `spawnSync` |
| `cli/tests/core/registry.test.ts` | Agregar tests para `buildCli` (mock `spawnSync`) |
| `cli/src/index.ts` | Invocar `buildCli()` en el comando `update` con spinner propio |

---

## Task 1: `buildCli()` en `registry.ts` + tests

**Files:**
- Modify: `cli/src/core/registry.ts`
- Modify: `cli/tests/core/registry.test.ts`

### Contexto para el implementador

`registry.ts` ya exporta `REGISTRY_DIR = path.join(AWM_HOME, 'cli-source')`. El CLI instalado vive en `path.join(REGISTRY_DIR, 'cli')`. El script de build es `npm run build` que corre `tsc && chmod +x dist/src/index.js` en ese directorio.

El test existente usa `jest.mock('fs')` y `jest.mock('simple-git')`. Para `buildCli` se necesita también `jest.mock('child_process')`.

---

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `cli/tests/core/registry.test.ts`, después del `describe('Registry Manager', ...)` existente:

```typescript
import { spawnSync } from 'child_process';
jest.mock('child_process');

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe('buildCli', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns success when npm run build exits 0', () => {
        mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from(''), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result).toEqual({ success: true });
        expect(mockSpawnSync).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: '/fake/cli', shell: true }));
    });

    it('returns failure with error message when build exits non-zero', () => {
        mockSpawnSync.mockReturnValue({ status: 1, stderr: Buffer.from('tsc error: Type mismatch'), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result.success).toBe(false);
        expect(result.error).toContain('tsc error');
    });

    it('returns failure when spawnSync throws (e.g. npm not found)', () => {
        mockSpawnSync.mockImplementation(() => { throw new Error('npm not found'); });
        const { buildCli } = require('../../src/core/registry');
        expect(() => buildCli('/fake/cli')).not.toThrow();
        const result = buildCli('/fake/cli');
        expect(result.success).toBe(false);
    });

    it('uses REGISTRY_DIR/cli as default cwd', () => {
        mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from(''), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli, REGISTRY_DIR } = require('../../src/core/registry');
        buildCli();
        expect(mockSpawnSync).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: `${REGISTRY_DIR}/cli` }));
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd cli && npx jest tests/core/registry.test.ts --no-coverage
```
Expected: FAIL — `buildCli is not a function` o similar.

- [ ] **Step 3: Implementar `buildCli()` en `registry.ts`**

Agregar el import de `spawnSync` al inicio del archivo (junto a los imports existentes):

```typescript
import { spawnSync } from 'child_process';
```

Agregar la función al final del archivo:

```typescript
export type BuildResult = { success: true } | { success: false; error: string };

export function buildCli(cliDir: string = path.join(REGISTRY_DIR, 'cli')): BuildResult {
    try {
        const result = spawnSync('npm', ['run', 'build'], {
            cwd: cliDir,
            stdio: 'pipe',
            shell: true,
        });
        if (result.status !== 0) {
            const msg = result.stderr?.toString().trim() || 'tsc build failed with no output';
            return { success: false, error: msg };
        }
        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd cli && npx jest tests/core/registry.test.ts --no-coverage
```
Expected: PASS (todos los tests del archivo — los 3 existentes de `syncRegistry` + los 4 nuevos de `buildCli`).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/registry.ts cli/tests/core/registry.test.ts
git commit -m "feat(registry): buildCli() compiles CLI after registry pull"
```

---

## Task 2: Wiring en `awm update`

**Files:**
- Modify: `cli/src/index.ts` (~líneas 327-341)

### Contexto para el implementador

El comando `update` en `index.ts` actualmente:
1. Crea spinner, llama `syncRegistry()`
2. Llama `regenerateGlobalContext()` (inner try/catch)
3. Llama `outro(...)`

Hay que agregar el paso de build entre (1) y (2), con su propio spinner. Si el build falla, muestra un warning pero **no aborta el update** — el source está actualizado, solo el binary queda en la versión anterior.

---

- [ ] **Step 1: Agregar el import de `buildCli`**

En `cli/src/index.ts`, en la línea con `import { syncRegistry } from './core/registry';`, extenderla para incluir `buildCli`:

```typescript
import { syncRegistry, buildCli } from './core/registry';
```

- [ ] **Step 2: Wiring en el bloque `update`**

Localizar el bloque `update` (actual, líneas ~327-344):

```typescript
      try {
          await syncRegistry();
          s.stop('Registry updated successfully.');

          try {
              const regen = regenerateGlobalContext();
              const refreshed = regen.filter((r) => r.action === 'refreshed').map((r) => r.agent);
              if (refreshed.length > 0) {
                  console.log(pc.green(`  ✓ Regenerated AWM context for: ${refreshed.join(', ')}`));
              }
          } catch {
              // context regeneration failure must not abort a successful registry update
          }

          outro('✅ All symlinked skills and workflows are now up-to-date.');
      } catch (e: any) {
```

Reemplazar el cuerpo del `try` (dejar el `catch` intacto) por:

```typescript
      try {
          await syncRegistry();
          s.stop('Registry updated successfully.');

          const buildSpinner = spinner();
          buildSpinner.start('Compiling latest CLI...');
          const build = buildCli();
          if (build.success) {
              buildSpinner.stop('CLI compiled successfully.');
          } else {
              buildSpinner.stop(pc.yellow('CLI build skipped — running previous version.'));
              console.warn(pc.yellow(`  ⚠  ${build.error}`));
          }

          try {
              const regen = regenerateGlobalContext();
              const refreshed = regen.filter((r) => r.action === 'refreshed').map((r) => r.agent);
              if (refreshed.length > 0) {
                  console.log(pc.green(`  ✓ Regenerated AWM context for: ${refreshed.join(', ')}`));
              }
          } catch {
              // context regeneration failure must not abort a successful registry update
          }

          outro('✅ All symlinked skills and workflows are now up-to-date.');
      } catch (e: any) {
```

- [ ] **Step 3: Verificar que compila**

```bash
cd cli && npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 4: Build + smoke test**

```bash
cd cli && npm run build && node dist/src/index.js update --help
```
Expected: help del comando `update` visible, sin crash.

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): awm update rebuilds CLI after registry pull"
```

---

## Task 3: Full suite + tsc (regresión)

**Files:** ninguno (verificación de integración).

- [ ] **Step 1: Compilar TypeScript estricto**

```bash
cd cli && npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 2: Correr la suite completa**

```bash
cd cli && npm test
```
Expected: todos los tests verdes (los nuevos de `buildCli` + sin regresión en el resto).

- [ ] **Step 3: Commit (solo si tsc/test requirió ajustes)**

```bash
git add -A
git commit -m "chore: full suite green after buildCli wiring"
```

---

## Self-Review

**1. Spec coverage:**
- `awm update` llama `buildCli()` → Task 2 ✔
- `buildCli()` corre `npm run build` en `REGISTRY_DIR/cli/` → Task 1 ✔
- Fallo de build no aborta el update → Task 2 (warning, no throw) ✔
- Tests para `buildCli` → Task 1 ✔
- Regresión → Task 3 ✔

**2. Placeholder scan:** sin TBD/TODO. Todo step trae código completo.

**3. Type consistency:**
- `BuildResult = { success: true } | { success: false; error: string }` — definido en Task 1, usado en Task 2 via `build.success` / `build.error`. Consistente.
- `buildCli(cliDir?: string): BuildResult` — firma consistente entre test (llamada con `/fake/cli`) e impl (default `REGISTRY_DIR/cli`).
