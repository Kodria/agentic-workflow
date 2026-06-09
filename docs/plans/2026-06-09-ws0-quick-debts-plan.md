# WS-0 Quick Debts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar las 3 deudas rápidas de la era anterior (F-6 hook resync en `awm update`, F-7 branding, F-8 golden output E2E) según WS-0 de `docs/plans/2026-06-09-distribution-roadmap.md`.

**Architecture:** F-6 agrega una función `resyncInstalledHooks()` en `cli/src/commands/hooks/resync.ts` que refresca **solo los artefactos del hook** (`session-start`, `run-hook.cmd`, symlink de `using-awm.md`) para agentes donde el usuario ya optó por el hook (gate: entrada AWM presente en `settings.json`). NO toca `settings.json` — eso evita el spam de backups que produce `installHook` en cada update y respeta el opt-in. El handler de `update` la llama en un try/catch no-fatal, igual que `regenerateGlobalContext` y `reconcileAllSkillLinks`. F-7 es un edit de 2 líneas. F-8 es la corrida manual del protocolo de `cli/tests/integration/README.md`.

**Tech Stack:** TypeScript, Jest + ts-jest (`npm test` desde `cli/`, corre con `--runInBand`), Commander, picocolors.

**Rama:** `feature/close-plans-distribution-roadmap` (ya contiene el roadmap).

---

## File Structure

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| Modify | `registry/skills/brainstorming/scripts/frame-template.html:5,199` | F-7: branding AWM |
| Modify | `cli/src/commands/hooks/install.ts` | Exportar `syncFile` (hoy module-private) |
| Create | `cli/src/commands/hooks/resync.ts` | F-6: `resyncInstalledHooks()` |
| Create | `cli/tests/commands/hooks/resync.test.ts` | F-6: tests |
| Modify | `cli/src/index.ts:354-363` (handler `update`) | F-6: wiring no-fatal |
| Create | `cli/tests/integration/golden-output-2026-06-09.txt` | F-8: golden output |
| Modify | `docs/plans/2026-06-09-distribution-roadmap.md` | Cierre: checkboxes WS-0 + fila de tabla |

**Hechos clave para el implementador** (verificados 2026-06-09):
- `REGISTRY_DIR` se exporta de `cli/src/core/registry.ts:9` (`~/.awm/cli-source` o `$AWM_HOME/cli-source`). El layout de registry dentro es `registry/hooks/` y `registry/skills/`.
- Solo `claude-code` tiene `hooks` en `PROVIDERS` (`cli/src/providers/index.ts`); `getHookConfig(agent)` devuelve `undefined` para el resto. `config.scriptsDir` = `~/.awm/hooks`, `config.settingsPath` = `~/.claude/settings.json`, `config.matcher` = `'startup|clear|compact'`, `config.eventName` = `'SessionStart'`.
- `computeHookStatus(agent)` (`cli/src/commands/hooks/status.ts`) expone `checks.settingsEntry.ok` — ese es el gate de opt-in.
- Los tests de hooks usan el patrón tmpdir + `process.env.HOME`/`AWM_HOME` + `jest.resetModules()` + `require()` tardío (ver `cli/tests/commands/hooks/install.test.ts`). Copiar ese patrón exacto.
- `npm test` se corre desde `cli/`. Un solo archivo: `npx jest tests/commands/hooks/resync.test.ts`.

---

### Task 1: F-7 — Branding del Visual Companion

**Files:**
- Modify: `registry/skills/brainstorming/scripts/frame-template.html:5,199`

- [ ] **Step 1: Editar las 2 líneas**

Línea 5: `<title>Superpowers Brainstorming</title>` → `<title>AWM Brainstorming</title>`

Línea 199: `<h1><a href="https://github.com/obra/superpowers" style="color: inherit; text-decoration: none;">Superpowers Brainstorming</a></h1>` → `<h1><a href="https://github.com/Kodria/agentic-workflow" style="color: inherit; text-decoration: none;">AWM Brainstorming</a></h1>`

- [ ] **Step 2: Verificar que no queda branding residual**

Run: `grep -rn "Superpowers Brainstorming" registry/skills/brainstorming/`
Expected: sin resultados (exit code 1)

- [ ] **Step 3: Commit**

```bash
git add registry/skills/brainstorming/scripts/frame-template.html
git commit -m "fix(brainstorming): rebrand visual companion Superpowers→AWM (WS-0 F-7)"
```

---

### Task 2: F-6 — `resyncInstalledHooks()` con TDD

**Files:**
- Modify: `cli/src/commands/hooks/install.ts` (exportar `syncFile`)
- Create: `cli/src/commands/hooks/resync.ts`
- Test: `cli/tests/commands/hooks/resync.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `cli/tests/commands/hooks/resync.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('resyncInstalledHooks', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    function writeRegistry(sessionStartContent: string) {
        const regHooks = path.join(tmpRegistry, 'registry/hooks');
        const regSkill = path.join(tmpRegistry, 'registry/skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), sessionStartContent, { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
    }

    function writeSettingsWithAwmEntry(scriptsDir: string) {
        const settingsPath = path.join(tmpHome, '.claude/settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|clear|compact',
                    hooks: [{ type: 'command', command: `${path.join(scriptsDir, 'run-hook.cmd')} session-start`, async: false }]
                }]
            }
        }, null, 2));
    }

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-resync-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-resync-registry-'));
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

    it('refreshes stale COPIED hook scripts when the settings entry is present', () => {
        writeRegistry('#!/usr/bin/env bash\necho "NEW VERSION"');
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        // hook instalado por copy, versión vieja
        fs.writeFileSync(path.join(scriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD VERSION"', { mode: 0o755 });
        fs.writeFileSync(path.join(scriptsDir, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'resynced' }]);
        const synced = fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8');
        expect(synced).toContain('NEW VERSION');
        // sigue siendo copy (no symlink) y sigue ejecutable
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(false);
        expect(() => fs.accessSync(path.join(scriptsDir, 'session-start'), fs.constants.X_OK)).not.toThrow();
        // el symlink de la skill apunta al registry
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(true);
    });

    it('does NOT touch anything when the hook was never installed (no settings entry)', () => {
        writeRegistry('#!/usr/bin/env bash\necho "NEW VERSION"');

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'not-installed' }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/hooks/session-start'))).toBe(false);
    });

    it('preserves symlink install method', () => {
        writeRegistry('#!/usr/bin/env bash\necho "V2"');
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.symlinkSync(path.join(tmpRegistry, 'registry/hooks/session-start'), path.join(scriptsDir, 'session-start'));
        fs.symlinkSync(path.join(tmpRegistry, 'registry/hooks/run-hook.cmd'), path.join(scriptsDir, 'run-hook.cmd'));
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'resynced' }]);
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(true);
    });

    it('skips with registry-missing when the registry has no hooks dir', () => {
        // registry vacío (sin registry/hooks/session-start)
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'registry-missing' }]);
        // el script viejo queda intacto — nunca dejar al usuario sin hook
        expect(fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8')).toContain('OLD');
    });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd cli && npx jest tests/commands/hooks/resync.test.ts`
Expected: FAIL — `Cannot find module '../../../src/commands/hooks/resync'`

- [ ] **Step 3: Exportar `syncFile` en `install.ts`**

En `cli/src/commands/hooks/install.ts:18`, cambiar:

```typescript
function syncFile(source: string, dest: string, method: 'symlink' | 'copy'): void {
```

por:

```typescript
export function syncFile(source: string, dest: string, method: 'symlink' | 'copy'): void {
```

- [ ] **Step 4: Implementar `resync.ts`**

Crear `cli/src/commands/hooks/resync.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { AgentTarget, PROVIDERS, getHookConfig } from '../../providers';
import { computeHookStatus } from './status';
import { syncFile } from './install';

export type ResyncAction = 'resynced' | 'not-installed' | 'registry-missing';

export type ResyncResult = {
    agent: AgentTarget;
    action: ResyncAction;
};

function detectInstallMethod(scriptsDir: string): 'symlink' | 'copy' {
    try {
        return fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink() ? 'symlink' : 'copy';
    } catch {
        return 'copy';
    }
}

/**
 * Refresca los artefactos del hook (scripts + symlink de skill) para los agentes
 * donde el usuario YA instaló el hook (gate: entrada AWM en settings.json).
 * NO toca settings.json — eso es territorio de `awm hooks install` y evita
 * crear un backup de settings en cada `awm update`.
 */
export function resyncInstalledHooks(registryRoot: string): ResyncResult[] {
    const results: ResyncResult[] = [];

    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        const config = getHookConfig(agent);
        if (!config) continue;

        const status = computeHookStatus(agent);
        if (!status.checks.settingsEntry.ok) {
            results.push({ agent, action: 'not-installed' });
            continue;
        }

        const sourceHooks = path.join(registryRoot, 'registry/hooks');
        const sourceSkill = path.join(registryRoot, 'registry/skills/using-awm/SKILL.md');
        if (!fs.existsSync(path.join(sourceHooks, 'session-start')) || !fs.existsSync(sourceSkill)) {
            results.push({ agent, action: 'registry-missing' });
            continue;
        }

        const method = detectInstallMethod(config.scriptsDir);
        fs.mkdirSync(config.scriptsDir, { recursive: true });
        syncFile(path.join(sourceHooks, 'session-start'), path.join(config.scriptsDir, 'session-start'), method);
        syncFile(path.join(sourceHooks, 'run-hook.cmd'), path.join(config.scriptsDir, 'run-hook.cmd'), method);

        // la skill SIEMPRE va por symlink (mismo criterio que installHook)
        const skillDest = path.join(config.scriptsDir, 'using-awm.md');
        try { fs.unlinkSync(skillDest); } catch { /* not exists */ }
        fs.symlinkSync(sourceSkill, skillDest);

        results.push({ agent, action: 'resynced' });
    }

    return results;
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd cli && npx jest tests/commands/hooks/resync.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Correr la suite completa (regresiones)**

Run: `cd cli && npm test`
Expected: todo verde

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/hooks/install.ts cli/src/commands/hooks/resync.ts cli/tests/commands/hooks/resync.test.ts
git commit -m "feat(hooks): resyncInstalledHooks — refresh hook artifacts without touching settings (WS-0 F-6)"
```

---

### Task 3: F-6 — Wiring en el handler de `update`

**Files:**
- Modify: `cli/src/index.ts` (import + bloque tras la reconciliación de symlinks, hoy líneas 354-363)

- [ ] **Step 1: Agregar el import**

Junto a los imports existentes de `cli/src/index.ts` (zona de la línea 22, donde está `registerHooksCommand`):

```typescript
import { resyncInstalledHooks } from './commands/hooks/resync';
```

- [ ] **Step 2: Insertar el bloque en el handler de `update`**

Inmediatamente después del bloque `try { for (const { agent, result } of reconcileAllSkillLinks(...)) ... } catch { ... }` (línea ~363) y antes del `outro(...)`:

```typescript
          try {
              for (const r of resyncInstalledHooks(REGISTRY_DIR)) {
                  if (r.action === 'resynced') {
                      console.log(pc.green(`  ✓ Re-synced ${r.agent} hook scripts`));
                  } else if (r.action === 'registry-missing') {
                      console.warn(pc.yellow(`  ⚠  ${r.agent} hook installed but registry hooks missing — run 'awm hooks install'`));
                  }
              }
          } catch {
              // el resync de hooks no debe abortar un update exitoso
          }
```

Nota: `REGISTRY_DIR` debe importarse de `./core/registry` si `index.ts` aún no lo importa (hoy importa `REGISTRY_CONTENT_DIR` de `./core/bundles`; verificar con `grep -n "REGISTRY_DIR" cli/src/index.ts` y agregar `import { REGISTRY_DIR } from './core/registry';` si falta).

- [ ] **Step 3: Build + suite completa**

Run: `cd cli && npm run build && npm test`
Expected: build OK, suite verde

- [ ] **Step 4: Verificación funcional local**

```bash
# en esta máquina el hook está instalado → debe reportar el resync
awm update
```
Expected: línea `✓ Re-synced claude-code hook scripts` (o nada si symlink, pero sin errores) y `awm hooks status` reporta HEALTHY después.

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(update): re-sync installed hooks on awm update (WS-0 F-6 closes pendientes #3)"
```

---

### Task 4: F-8 — E2E manual con golden output

**Files:**
- Create: `cli/tests/integration/golden-output-2026-06-09.txt`

Protocolo completo en `cli/tests/integration/README.md`. Requiere `claude` CLI en PATH y API key activa (consume tokens). **Este task es manual e interactivo — no delegarlo a un subagente sin supervisión.**

- [ ] **Step 1: Correr el protocolo del README**

Seguir `cli/tests/integration/README.md` paso a paso (HOME aislado con `mktemp -d`, `awm hooks install`, `awm hooks status` → HEALTHY, proyecto de prueba, `claude -p "Make a React todo list" > /tmp/awm-e2e-output.txt`, restaurar HOME).

- [ ] **Step 2: Verificar criterio de aceptación**

Run: `grep -i "brainstorming\|development-process" /tmp/awm-e2e-output.txt`
Expected: al menos un match — el agente invoca el orquestador o brainstorming ANTES de proponer código. Si no hay match, el bootstrap no está disparando: NO guardar golden output; abrir `systematic-debugging`.

- [ ] **Step 3: Guardar y committear el golden output**

```bash
cp /tmp/awm-e2e-output.txt cli/tests/integration/golden-output-2026-06-09.txt
git add cli/tests/integration/golden-output-2026-06-09.txt
git commit -m "test(e2e): golden output del bootstrap hook 2026-06-09 (WS-0 F-8 closes pendientes #1)"
```

---

### Task 5: Cierre del WS-0 en el roadmap (regla #3)

**Files:**
- Modify: `docs/plans/2026-06-09-distribution-roadmap.md`

- [ ] **Step 1: Marcar los checkboxes de WS-0**

En la sección "WS-0 — Deudas rápidas de la era anterior": marcar `[x]` los 3 ítems + el ítem de cierre, anotando al lado de cada uno `(plan: 2026-06-09-ws0-quick-debts-plan.md)`.

- [ ] **Step 2: Actualizar la tabla "Estado de cierre"**

Fila WS-0: columna "Plan ejecutado" → `[2026-06-09-ws0-quick-debts-plan.md](2026-06-09-ws0-quick-debts-plan.md)`. La columna QA queda ☐ — se marca ☑ recién cuando `post-implementation-qa` agregue `awm-qa-complete` a ESTE plan.

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-06-09-distribution-roadmap.md
git commit -m "docs(roadmap): WS-0 items executed — pending QA gate (F-6, F-7, F-8)"
```

---

## Post-plan (no son tasks de este plan — los dispara `development-process`)

1. `post-implementation-qa` sobre este plan → marker `awm-qa-complete` + ☑ en la columna QA del roadmap.
2. `harness-retro` → marker `awm-retro-complete`.
3. `finishing-a-development-branch` → merge/PR de `feature/close-plans-distribution-roadmap` (incluye roadmap + WS-0).
