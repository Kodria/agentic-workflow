# Body B-1 — Instalación/reparación agnóstica — Implementation Plan

<!-- awm-qa-complete: 2026-06-06 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `awm init --agent <X>` deje a cualquier agente (Claude u OpenCode) tan funcional como a Claude — diagnóstico/reparación de skills scoped al agente target, prosa sin sesgo a `~/.claude`, y `CONSTITUTION.md` entregado a OpenCode.

**Architecture:** Cinco unidades aislables sobre el CLI de AWM (`cli/src`) + dos ediciones de prosa en `registry/skills`. El plumbing de install ya es agnóstico; B-1 des-hardcodea los dos diagnósticos + la reparación (`PROVIDERS['claude-code']` → agente target), guarda un crash de clack con opciones vacías, y agrega un canal de entrega per-proyecto para `CONSTITUTION.md` a agentes con inyección `config-instructions`.

**Tech Stack:** TypeScript, Node `fs`, `@clack/prompts`, Jest (`jest --runInBand`). Comandos de test se corren **desde `cli/`**.

**Design doc:** `docs/plans/2026-06-06-b1-agnostic-install-design.md`

**Orden de implementación:** Unidad 5 (desbloquea `awm init` greenfield) → Unidad 1 → Unidad 2 → Unidad 3 → Unidad 4.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `cli/src/commands/init.ts` | Extraer `makeConfirmExtensions` con guarda de array vacío | T1 |
| `cli/src/core/init/steps.ts` | Guarda en `stepProfile`; agnostizar `stepGlobalSkillsRepair`; nuevo `stepConstitutionInjection` + binding | T1, T3, T5 |
| `cli/src/core/diagnostics/context.ts` | `gatherMachine(bundles, agent)` agnóstico; `GatherOptions.agent` | T2 |
| `cli/src/core/init/orchestrator.ts` | Pasar `agent` al `gatherContext` final; wire `stepConstitutionInjection` | T2, T5 |
| `cli/src/core/skill-integrity.ts` | `reconcileAllSkillLinks` (repara todos los providers) | T3 |
| `cli/src/index.ts` | `awm update` usa `reconcileAllSkillLinks` | T3 |
| `cli/src/core/context/project-constitution-inject.ts` | **Nuevo** — `injectProjectConstitution` (opencode.json local) | T5 |
| `cli/src/core/init/types.ts` | Nueva acción `injectProjectConstitution` en `InitActions` | T5 |
| `registry/skills/writing-skills/SKILL.md` | Des-Claude-izar línea de paths | T4 |
| `registry/skills/project-constitution/SKILL.md` | Des-Claude-izar referencias de path/sesión | T4 |

---

## Task 1: Unidad 5 — Guarda de multiselect vacío (#1 crash)

**Root cause:** en dir greenfield `detectExtensions` no halla señales → `confirmExtensions([])` invoca `@clack/prompts` `multiselect({ options: [] })` → clack hace `s[0].disabled` sobre array vacío → `Cannot read properties of undefined (reading 'disabled')`. Guarda en dos capas: `stepProfile` (no llamar `confirmExtensions` si no hay propuestas nuevas) + `makeConfirmExtensions` (retornar `[]` antes de tocar clack).

**Files:**
- Modify: `cli/src/commands/init.ts:89-102` (extraer factory + guarda)
- Modify: `cli/src/core/init/steps.ts:176-181` (guarda en `stepProfile`)
- Test: `cli/tests/commands/init.test.ts`, `cli/tests/core/init/steps.test.ts`

- [ ] **Step 1: Write the failing test for `makeConfirmExtensions`**

En `cli/tests/commands/init.test.ts`, agregá al inicio del archivo el import (junto a los imports existentes) y un nuevo `describe`:

```ts
import { makeConfirmExtensions } from '../../src/commands/init';

describe('makeConfirmExtensions (#1 empty-multiselect guard)', () => {
    it('returns [] for empty proposed without invoking clack (non-yes path)', async () => {
        const fn = makeConfirmExtensions(false);
        await expect(fn([], [])).resolves.toEqual([]);
    });

    it('auto-confirms all proposed in --yes mode', async () => {
        const fn = makeConfirmExtensions(true);
        await expect(fn(['frontend'], ['package.json: next'])).resolves.toEqual(['frontend']);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/commands/init.test.ts -t "empty-multiselect"`
Expected: FAIL — `makeConfirmExtensions is not exported` / not a function.

- [ ] **Step 3: Extract `makeConfirmExtensions` with the empty guard**

En `cli/src/commands/init.ts`, reemplazá el bloque inline (líneas 89-102) dentro de `runInit`:

```ts
        // confirmExtensions: with --yes auto-confirm all proposed; without --yes show interactive multiselect
        const confirmExtensions = opts.yes
            ? async (proposed: string[]) => proposed  // --yes: auto-confirm all; signals not shown
            : async (proposed: string[], signals: string[]) => {
                  const { multiselect, isCancel } = await import('@clack/prompts');
                  const choice = await multiselect({
                      message: `Extensiones detectadas (${signals.join(', ')}) — ¿activar?`,
                      options: proposed.map((p) => ({ value: p, label: p })),
                      initialValues: proposed,
                      required: false,
                  });
                  if (isCancel(choice)) return [];
                  return choice as string[];
              };
```

por una llamada al factory:

```ts
        const confirmExtensions = makeConfirmExtensions(!!opts.yes);
```

Y agregá la función exportada **antes** de `registerInitCommand` (cerca del final del archivo):

```ts
/**
 * Builds the extension-confirmation callback. The non-`--yes` path opens a clack
 * `multiselect`; clack crashes ("Cannot read properties of undefined (reading
 * 'disabled')") when handed an empty options array, so we short-circuit empty
 * `proposed` BEFORE importing/invoking it (#1, greenfield dirs detect no signals).
 */
export function makeConfirmExtensions(
    yes: boolean,
): (proposed: string[], signals: string[]) => Promise<string[]> {
    if (yes) return async (proposed: string[]) => proposed;
    return async (proposed: string[], signals: string[]) => {
        if (proposed.length === 0) return [];
        const { multiselect, isCancel } = await import('@clack/prompts');
        const choice = await multiselect({
            message: `Extensiones detectadas (${signals.join(', ')}) — ¿activar?`,
            options: proposed.map((p) => ({ value: p, label: p })),
            initialValues: proposed,
            required: false,
        });
        if (isCancel(choice)) return [];
        return choice as string[];
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (desde `cli/`): `npx jest tests/commands/init.test.ts -t "empty-multiselect"`
Expected: PASS (2 passing).

- [ ] **Step 5: Write the failing test for the `stepProfile` guard**

En `cli/tests/core/init/steps.test.ts`, dentro de `describe('stepProfile', ...)`, agregá:

```ts
    it('does not invoke confirmExtensions when no new extensions are proposed (#1 guard)', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-ext-'));
        try {
            const a = spies();
            const confirm = jest.fn(async (p: string[]) => p);
            const ctx: HarnessContext = {
                machine: machine(),
                project: project({ root, profile: { present: true, extensions: [] } }),
            };
            const r = await stepProfile(deps(ctx, a, { confirmExtensions: confirm }));
            expect(confirm).not.toHaveBeenCalled();
            expect(r.action).toBe('skipped');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
```

(Un dir temporal vacío → `detectExtensions` no encuentra señales → `newProposed` vacío.)

- [ ] **Step 6: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/core/init/steps.test.ts -t "no new extensions are proposed"`
Expected: FAIL — `confirm` SÍ fue llamado (hoy `stepProfile` llama `confirmExtensions([])` siempre).

- [ ] **Step 7: Add the guard in `stepProfile`**

En `cli/src/core/init/steps.ts`, en `stepProfile` (líneas 176-181), insertá el early-return tras calcular `newProposed`:

```ts
    const { proposed, signals } = detectExtensions(proj.root);
    const alreadyPresent = proj.profile.extensions;
    const newProposed = proposed.filter((p) => !alreadyPresent.includes(p));
    if (newProposed.length === 0) return ok('project.profile', 'project', 'skipped', 'sin extensiones nuevas');

    const confirmed = await d.confirmExtensions(newProposed, signals);
    if (confirmed.length === 0) return ok('project.profile', 'project', 'skipped');
```

- [ ] **Step 8: Run both step tests to verify they pass**

Run (desde `cli/`): `npx jest tests/core/init/steps.test.ts -t "stepProfile"`
Expected: PASS (incluye el caso nuevo y los existentes).

- [ ] **Step 9: Run the full suite (no regressions)**

Run (desde `cli/`): `npm test`
Expected: todo verde.

- [ ] **Step 10: Commit**

```bash
git add cli/src/commands/init.ts cli/src/core/init/steps.ts cli/tests/commands/init.test.ts cli/tests/core/init/steps.test.ts
git commit -m "fix(init): guard empty multiselect — fixes project.profile crash (#1)"
```

---

## Task 2: Unidad 1 — `gatherMachine` agnóstico por agente (#4a, el linchpin)

`gatherMachine` calcula la salud de skills (`devCore`, `globalSkills`, `ambient.installed`) contra `PROVIDERS['claude-code'].skill.global` siempre. Se thread-ea el agente target y se calcula contra `PROVIDERS[agent].skill.global`. Backward-compatible: default `'claude-code'`.

**Files:**
- Modify: `cli/src/core/diagnostics/context.ts:82,106,168-181`
- Modify: `cli/src/commands/init.ts:77` (pasar `agent`)
- Modify: `cli/src/core/init/orchestrator.ts:50` (pasar `agent`)
- Test: `cli/tests/core/diagnostics/context.test.ts`

- [ ] **Step 1: Write the failing test**

En `cli/tests/core/diagnostics/context.test.ts`, agregá (asegurate de tener `import fs from 'fs'; import os from 'os'; import path from 'path';` arriba):

```ts
describe('gatherMachine — agnostic skill health (#4)', () => {
    it('classifies the target agent skills dir, not always Claude', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = home;
        try {
            jest.resetModules();
            const { gatherContext } = require('../../../src/core/diagnostics/context');

            // OpenCode skills dir gets a dangling symlink (not in the registry) → 'dead'.
            const ocSkills = path.join(home, '.agents/skills');
            fs.mkdirSync(ocSkills, { recursive: true });
            fs.symlinkSync(path.join(home, 'no-such-target'), path.join(ocSkills, 'ghost'), 'dir');

            const oc = gatherContext({ cwd: home, bundles: [], agent: 'opencode' });
            expect(oc.machine.globalSkills.dead).toContain('ghost');

            // Claude's dir is empty → its 'dead' list must NOT pick up OpenCode's orphan.
            const cc = gatherContext({ cwd: home, bundles: [], agent: 'claude-code' });
            expect(cc.machine.globalSkills.dead).not.toContain('ghost');
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/core/diagnostics/context.test.ts -t "agnostic skill health"`
Expected: FAIL — `gatherContext` ignora `agent`; ambos miran `~/.claude/skills` → `oc...dead` no contiene `ghost`.

- [ ] **Step 3: Thread `agent` into `gatherMachine` and `gatherContext`**

En `cli/src/core/diagnostics/context.ts`:

(a) Cambiá la firma de `gatherMachine` (línea 82):

```ts
function gatherMachine(bundles: BundleDefinition[], agent: AgentTarget = 'claude-code'): MachineFacts {
```

(b) Cambiá la línea 106 (`devCore`):

```ts
    const skillsDir = PROVIDERS[agent].skill.global;
```

(c) Cambiá `GatherOptions` y `gatherContext` (líneas 168-181):

```ts
export interface GatherOptions {
    cwd?: string;
    bundles?: BundleDefinition[];
    agent?: AgentTarget;
}

export function gatherContext(opts: GatherOptions = {}): HarnessContext {
    const cwd = opts.cwd ?? process.cwd();
    const bundles = opts.bundles ?? discoverBundles();
    const agent = opts.agent ?? 'claude-code';
    const root = findProjectRoot(cwd);
    return {
        machine: gatherMachine(bundles, agent),
        project: root ? gatherProject(root, bundles) : null,
    };
}
```

(`AgentTarget` ya está importado en este archivo, línea 7. El único `skillsDir` definido en 106 alimenta devCore, `ambient.installed` y `globalSkills` — los tres quedan agnósticos con este cambio.)

- [ ] **Step 4: Run the test to verify it passes**

Run (desde `cli/`): `npx jest tests/core/diagnostics/context.test.ts -t "agnostic skill health"`
Expected: PASS.

- [ ] **Step 5: Pass `agent` from the init callers**

En `cli/src/commands/init.ts`, línea 77:

```ts
        const ctx = gatherContext({ cwd, bundles, agent });
```

En `cli/src/core/init/orchestrator.ts`, línea 50 (el gather del reporte `after`):

```ts
    const after = runChecks(gatherContext({ cwd: deps.cwd, bundles: deps.bundles, agent: deps.agent }));
```

- [ ] **Step 6: Run the full suite (no regressions)**

Run (desde `cli/`): `npm test`
Expected: todo verde (el default `'claude-code'` preserva el comportamiento de doctor y demás callers).

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/diagnostics/context.ts cli/src/commands/init.ts cli/src/core/init/orchestrator.ts cli/tests/core/diagnostics/context.test.ts
git commit -m "feat(init): gatherMachine scopes skill health to target agent (#4)"
```

---

## Task 3: Unidad 2 — Reparación de skills agnóstica (#4b)

`stepGlobalSkillsRepair` repara `~/.claude/skills`; `awm update` también. Se scopean: el step al agente target, y `update` (sin `--agent`) a **todos** los providers con skills.

**Files:**
- Modify: `cli/src/core/init/steps.ts:141`
- Create helper in: `cli/src/core/skill-integrity.ts`
- Modify: `cli/src/index.ts:353-362`
- Test: `cli/tests/core/init/steps.test.ts`, `cli/tests/core/skill-integrity.test.ts`

- [ ] **Step 1: Write the failing test for the step**

En `cli/tests/core/init/steps.test.ts`, asegurate del import de PROVIDERS (agregá si falta, junto a los imports):

```ts
import { PROVIDERS } from '../../../src/providers';
```

Dentro de `describe('stepGlobalSkillsRepair', ...)`, agregá:

```ts
    it('repairs the target agent skills dir, not Claude (#4)', () => {
        const a = spies();
        (a as any).repairGlobalSkills = jest.fn(() => ({ relinked: ['b'], pruned: [], failed: [] }));
        const m = machine();
        m.globalSkills = { valid: [], repairable: ['b'], dead: [] };
        const r = stepGlobalSkillsRepair(deps({ machine: m, project: null }, a, { agent: 'opencode' }));
        expect(r.action).toBe('applied');
        expect(a.repairGlobalSkills).toHaveBeenCalledWith(PROVIDERS['opencode'].skill.global, expect.any(String));
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/core/init/steps.test.ts -t "target agent skills dir"`
Expected: FAIL — se llamó con el path de `claude-code`, no el de `opencode`.

- [ ] **Step 3: Agnostize `stepGlobalSkillsRepair`**

En `cli/src/core/init/steps.ts`, línea 141:

```ts
    const skillsDir = PROVIDERS[d.agent].skill.global;
```

- [ ] **Step 4: Run the step test to verify it passes**

Run (desde `cli/`): `npx jest tests/core/init/steps.test.ts -t "stepGlobalSkillsRepair"`
Expected: PASS (caso nuevo + los existentes, que usan `agent: 'claude-code'` por default).

- [ ] **Step 5: Write the failing test for `reconcileAllSkillLinks`**

En `cli/tests/core/skill-integrity.test.ts`, agregá (con `import os from 'os'; import path from 'path'; import fs from 'fs';` arriba si faltan):

```ts
describe('reconcileAllSkillLinks (#4 — awm update, all providers)', () => {
    it('repairs every provider dir that exists and skips absent ones', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = home;
        try {
            jest.resetModules();
            const { reconcileAllSkillLinks } = require('../../src/core/skill-integrity');

            // OpenCode dir exists with a dead orphan; Claude dir does NOT exist.
            const ocSkills = path.join(home, '.agents/skills');
            fs.mkdirSync(ocSkills, { recursive: true });
            fs.symlinkSync(path.join(home, 'no-such-target'), path.join(ocSkills, 'ghost'), 'dir');

            const res = reconcileAllSkillLinks(path.join(home, 'no-registry'));
            const oc = res.find((r: any) => r.agent === 'opencode');
            const cc = res.find((r: any) => r.agent === 'claude-code');
            expect(oc).toBeTruthy();
            expect(oc.result.pruned).toContain('ghost');
            expect(cc).toBeFalsy(); // claude dir absent → not in results
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/core/skill-integrity.test.ts -t "reconcileAllSkillLinks"`
Expected: FAIL — `reconcileAllSkillLinks` no existe.

- [ ] **Step 7: Add `reconcileAllSkillLinks`**

En `cli/src/core/skill-integrity.ts`, agregá el import arriba y la función al final:

```ts
import { PROVIDERS, AgentTarget } from '../providers';
```

```ts
/** Reconcilia los symlinks de skills de TODOS los providers con soporte de skills
 *  cuyo dir global existe. Es mantenimiento machine-global (awm update): no hay un
 *  único agente target. Cada provider en su propio path; un dir ausente se omite. */
export function reconcileAllSkillLinks(
    registryContentDir: string,
): { agent: AgentTarget; result: RepairResult }[] {
    const out: { agent: AgentTarget; result: RepairResult }[] = [];
    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        const skill = PROVIDERS[agent].skill;
        if (!skill || !fs.existsSync(skill.global)) continue;
        out.push({ agent, result: repairGlobalSkills(skill.global, registryContentDir) });
    }
    return out;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run (desde `cli/`): `npx jest tests/core/skill-integrity.test.ts -t "reconcileAllSkillLinks"`
Expected: PASS.

- [ ] **Step 9: Wire `reconcileAllSkillLinks` into `awm update`**

En `cli/src/index.ts`, reemplazá el bloque de reconciliación (líneas 353-362):

```ts
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

por:

```ts
          try {
              for (const { agent, result } of reconcileAllSkillLinks(REGISTRY_CONTENT_DIR)) {
                  const touched = result.relinked.length + result.pruned.length;
                  if (touched > 0) {
                      console.log(pc.green(`  ✓ Reconciled ${agent} skill links: re-linked ${result.relinked.length}, pruned ${result.pruned.length}`));
                  }
              }
          } catch {
              // la reconciliación de symlinks no debe abortar un update exitoso
          }
```

Actualizá el import de `skill-integrity` en `cli/src/index.ts`: reemplazá `repairGlobalSkills` por `reconcileAllSkillLinks` en la línea de import correspondiente (buscá `from './core/skill-integrity'`). Si `repairGlobalSkills` ya no se usa en `index.ts`, quitalo del import para no dejar un símbolo sin usar (lint).

- [ ] **Step 10: Run the full suite (no regressions)**

Run (desde `cli/`): `npm test`
Expected: todo verde.

- [ ] **Step 11: Commit**

```bash
git add cli/src/core/init/steps.ts cli/src/core/skill-integrity.ts cli/src/index.ts cli/tests/core/init/steps.test.ts cli/tests/core/skill-integrity.test.ts
git commit -m "feat(init): agnostic skill repair — target agent + awm update over all providers (#4)"
```

---

## Task 4: Unidad 3 — Des-Claude-izar la prosa (#5)

Endurecimiento: que el cuerpo de las skills no empuje al modelo hacia `~/.claude/skills`. Test de regresión por grep.

**Files:**
- Modify: `registry/skills/writing-skills/SKILL.md:13`
- Modify: `registry/skills/project-constitution/SKILL.md:11,64,118`
- Test: `cli/tests/registry/prose-agnostic.test.ts` (nuevo)

- [ ] **Step 1: Write the failing regression test**

Creá `cli/tests/registry/prose-agnostic.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('skill prose stays agent-agnostic (#5)', () => {
    const files = ['writing-skills/SKILL.md', 'project-constitution/SKILL.md'];
    for (const f of files) {
        it(`${f} does not push the model to the ~/.claude/skills path`, () => {
            const txt = fs.readFileSync(path.join(REPO_ROOT, 'registry/skills', f), 'utf-8');
            expect(txt).not.toMatch(/~\/\.claude\/skills/);
            expect(txt).not.toMatch(/\.claude\/settings\.json/);
        });
    }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/registry/prose-agnostic.test.ts`
Expected: FAIL — `writing-skills/SKILL.md` contiene `~/.claude/skills`; `project-constitution/SKILL.md` contiene `~/.claude/settings.json`.

- [ ] **Step 3: De-Claude-ize `writing-skills/SKILL.md`**

En `registry/skills/writing-skills/SKILL.md`, línea 13, reemplazá:

```markdown
**Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex)** 
```

por:

```markdown
**Personal skills live in your agent's skills directory.** AWM installs them there for you (`awm add` / `awm init`) — you invoke a skill via the Skill tool, you don't need to know or hardcode the on-disk path. 
```

- [ ] **Step 4: De-Claude-ize `project-constitution/SKILL.md`**

En `registry/skills/project-constitution/SKILL.md`:

(a) Línea 118 — reemplazá:

```markdown
If status is not `HEALTHY`, tell the user to run `awm hooks install` so the SessionStart hook is registered in `~/.claude/settings.json`. The hook reads `$PWD/CONSTITUTION.md` automatically — no further configuration needed.
```

por:

```markdown
If status is not `HEALTHY`, tell the user to run `awm hooks install` so the SessionStart hook is registered for their agent. The hook reads `$PWD/CONSTITUTION.md` automatically — no further configuration needed.
```

(b) Línea 11 — reemplazá:

```markdown
`CONSTITUTION.md` is the project's non-negotiable rulebook: testing discipline, architecture invariants, sensor obligations, code style, process. It lives at the repo root. The AWM SessionStart hook reads `$PWD/CONSTITUTION.md` and appends its content to `additionalContext` on every Claude Code session — so the agent sees these rules from the first token.
```

por:

```markdown
`CONSTITUTION.md` is the project's non-negotiable rulebook: testing discipline, architecture invariants, sensor obligations, code style, process. It lives at the repo root. AWM delivers it to the agent on every session — via the SessionStart hook (Claude Code) or the project-local config `instructions` (agents like OpenCode) — so the agent sees these rules from the first token.
```

(c) Línea 64 — reemplazá:

```markdown
> Non-negotiable rules for this repo. The AWM SessionStart hook injects this file into every Claude Code session as `additionalContext`. Rules here override agent defaults.
```

por:

```markdown
> Non-negotiable rules for this repo. AWM delivers this file into every agent session as feedforward context. Rules here override agent defaults.
```

- [ ] **Step 5: Run the regression test to verify it passes**

Run (desde `cli/`): `npx jest tests/registry/prose-agnostic.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 6: Run the full suite (no regressions)**

Run (desde `cli/`): `npm test`
Expected: todo verde.

- [ ] **Step 7: Commit**

```bash
git add registry/skills/writing-skills/SKILL.md registry/skills/project-constitution/SKILL.md cli/tests/registry/prose-agnostic.test.ts
git commit -m "docs(skills): de-Claude-ize skill prose so agents don't resolve to ~/.claude (#5)"
```

---

## Task 5: Unidad 4 — CONSTITUTION.md → OpenCode (#6)

`awm init` escribe un `$PWD/opencode.json` con `instructions: ['CONSTITUTION.md']` (ref relativa) para agentes con inyección `config-instructions` (hoy OpenCode), cuando existe `CONSTITUTION.md`. Claude lo recibe vía el hook → no-op. Agnóstico por construcción.

**Files:**
- Create: `cli/src/core/context/project-constitution-inject.ts`
- Modify: `cli/src/core/init/types.ts` (acción nueva)
- Modify: `cli/src/core/init/steps.ts` (binding en `defaultActions` + `stepConstitutionInjection`)
- Modify: `cli/src/core/init/orchestrator.ts` (wire del step)
- Test: `cli/tests/core/context/project-constitution-inject.test.ts` (nuevo), `cli/tests/core/init/steps.test.ts`

- [ ] **Step 1: Write the failing test for the pure function**

Creá `cli/tests/core/context/project-constitution-inject.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { injectProjectConstitution } from '../../../src/core/context/project-constitution-inject';

function tmpProject(withConstitution: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-const-'));
    if (withConstitution) fs.writeFileSync(path.join(root, 'CONSTITUTION.md'), '# rules\n');
    return root;
}

describe('injectProjectConstitution (#6)', () => {
    it('writes project-local opencode.json with a relative CONSTITUTION.md instruction', () => {
        const root = tmpProject(true);
        try {
            expect(injectProjectConstitution(root, 'opencode')).toBe('injected');
            const cfg = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8'));
            expect(cfg.instructions).toEqual(['CONSTITUTION.md']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('is idempotent (no duplicate entry on a second run)', () => {
        const root = tmpProject(true);
        try {
            injectProjectConstitution(root, 'opencode');
            expect(injectProjectConstitution(root, 'opencode')).toBe('already');
            const cfg = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8'));
            expect(cfg.instructions).toEqual(['CONSTITUTION.md']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('preserves existing instructions and appends', () => {
        const root = tmpProject(true);
        try {
            fs.writeFileSync(path.join(root, 'opencode.json'),
                JSON.stringify({ $schema: 'x', instructions: ['./AGENTS.md'] }, null, 2));
            expect(injectProjectConstitution(root, 'opencode')).toBe('injected');
            const cfg = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8'));
            expect(cfg.instructions).toEqual(['./AGENTS.md', 'CONSTITUTION.md']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns no-constitution and writes nothing when CONSTITUTION.md is absent', () => {
        const root = tmpProject(false);
        try {
            expect(injectProjectConstitution(root, 'opencode')).toBe('no-constitution');
            expect(fs.existsSync(path.join(root, 'opencode.json'))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns not-applicable for Claude (hook delivers it) and writes nothing', () => {
        const root = tmpProject(true);
        try {
            expect(injectProjectConstitution(root, 'claude-code')).toBe('not-applicable');
            expect(fs.existsSync(path.join(root, 'opencode.json'))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('throws a clear error when instructions is a non-array', () => {
        const root = tmpProject(true);
        try {
            fs.writeFileSync(path.join(root, 'opencode.json'),
                JSON.stringify({ instructions: 'oops' }));
            expect(() => injectProjectConstitution(root, 'opencode')).toThrow(/must be an array/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (desde `cli/`): `npx jest tests/core/context/project-constitution-inject.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implement the pure function**

Creá `cli/src/core/context/project-constitution-inject.ts`:

```ts
// cli/src/core/context/project-constitution-inject.ts
import fs from 'fs';
import path from 'path';
import { AgentTarget, PROVIDERS } from '../../providers';

export type ConstitutionInjectResult =
    | 'injected'        // se agregó la entrada
    | 'already'         // ya estaba (idempotente)
    | 'no-constitution' // no hay $PWD/CONSTITUTION.md
    | 'not-applicable'; // el agente no usa config-instructions (p.ej. Claude → hook)

/**
 * Entrega el `CONSTITUTION.md` del proyecto a agentes cuyo mecanismo de contexto es
 * `config-instructions` (hoy OpenCode), agregando una entrada **relativa**
 * `CONSTITUTION.md` al `instructions[]` de un `opencode.json` en la raíz del
 * proyecto (commiteable, viaja con el repo). Claude lo recibe vía el hook
 * SessionStart, así que para Claude es no-op. Agnóstico por construcción:
 * cualquier agente futuro con inyección `config-instructions` hereda el trato.
 */
export function injectProjectConstitution(projectRoot: string, agent: AgentTarget): ConstitutionInjectResult {
    const inj = PROVIDERS[agent].injection;
    if (!inj || inj.type !== 'config-instructions') return 'not-applicable';
    if (!fs.existsSync(path.join(projectRoot, 'CONSTITUTION.md'))) return 'no-constitution';

    const configPath = path.join(projectRoot, path.basename(inj.configPath)); // p.ej. 'opencode.json'
    const field = inj.field; // 'instructions'
    const REF = 'CONSTITUTION.md';

    let cfg: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json' };
    if (fs.existsSync(configPath)) {
        try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
        catch { throw new Error(`${configPath} is not valid JSON. Fix it manually, then re-run.`); }
    }

    const current = cfg[field];
    if (current !== undefined && !Array.isArray(current)) {
        throw new Error(`${configPath}: '${field}' field must be an array. Fix it manually, then re-run.`);
    }
    const list: string[] = Array.isArray(current) ? current : [];
    if (list.includes(REF)) return 'already';

    list.push(REF);
    cfg[field] = list;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    return 'injected';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (desde `cli/`): `npx jest tests/core/context/project-constitution-inject.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Add the action to `InitActions`**

En `cli/src/core/init/types.ts`, agregá el import del tipo de resultado y la acción al final de la interfaz `InitActions` (después de `repairGlobalSkills`):

```ts
import type { ConstitutionInjectResult } from '../context/project-constitution-inject';
```

```ts
    injectProjectConstitution: (o: { projectRoot: string; agent: AgentTarget }) => ConstitutionInjectResult;
```

- [ ] **Step 6: Bind it in `defaultActions` and add the step**

En `cli/src/core/init/steps.ts`:

(a) Import (junto a los otros imports de `../context/...`):

```ts
import { injectProjectConstitution as realInjectProjectConstitution } from '../context/project-constitution-inject';
```

(b) En `defaultActions`, después de `repairGlobalSkills` (línea ~66):

```ts
    injectProjectConstitution: (o) => realInjectProjectConstitution(o.projectRoot, o.agent),
```

(c) Agregá el step nuevo después de `stepConstitution` (después de la línea 228):

```ts
/** Step 8b – Entregar CONSTITUTION.md a agentes con inyección config-instructions
 *  (opencode) vía un opencode.json local del proyecto. Claude lo recibe por el hook. */
export function stepConstitutionInjection(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.constitutionInjection', 'project', 'skipped', 'no project');

    const inj = getInjection(d.agent);
    if (!inj || inj.type !== 'config-instructions') {
        return ok('project.constitutionInjection', 'project', 'skipped', 'cubierto por hook');
    }
    if (!proj.constitution.present) {
        return ok('project.constitutionInjection', 'project', 'skipped', 'sin CONSTITUTION.md');
    }

    const res = d.actions.injectProjectConstitution({ projectRoot: proj.root, agent: d.agent });
    if (res === 'injected') return ok('project.constitutionInjection', 'project', 'applied');
    return ok('project.constitutionInjection', 'project', 'skipped', res);
}
```

(`getInjection` ya está importado en `steps.ts`, línea 18.)

- [ ] **Step 7: Wire the step into the orchestrator**

En `cli/src/core/init/orchestrator.ts`:

(a) Agregá `stepConstitutionInjection` al import desde `./steps` (líneas 3-6).

(b) En el bloque de nivel proyecto, después de la línea de `project.constitution` (línea 46):

```ts
        steps.push(await wrapStep('project.constitution', 'project', () => stepConstitution(deps)));
        steps.push(await wrapStep('project.constitutionInjection', 'project', () => stepConstitutionInjection(deps)));
        steps.push(await wrapStep('project.context', 'project', () => stepContext(deps)));
```

- [ ] **Step 8: Update the steps-test spies and add a step test**

En `cli/tests/core/init/steps.test.ts`:

(a) Agregá `stepConstitutionInjection` al import desde `../../../src/core/init/steps` (líneas 4-8).

(b) En `spies()` (después de `repairGlobalSkills`, línea 55), agregá:

```ts
        injectProjectConstitution: jest.fn(() => 'injected' as const),
```

(c) Agregá un `describe` nuevo:

```ts
describe('stepConstitutionInjection (#6)', () => {
    it('injects for a config-instructions agent when CONSTITUTION.md is present', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: true } }) }, a, { agent: 'opencode' }),
        );
        expect(r.action).toBe('applied');
        expect(a.injectProjectConstitution).toHaveBeenCalledWith({ projectRoot: '/repo', agent: 'opencode' });
    });

    it('skips for Claude (delivered by the hook), never touching the action', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: true } }) }, a, { agent: 'claude-code' }),
        );
        expect(r.action).toBe('skipped');
        expect(a.injectProjectConstitution).not.toHaveBeenCalled();
    });

    it('skips when CONSTITUTION.md is absent', () => {
        const a = spies();
        const r = stepConstitutionInjection(
            deps({ machine: machine(), project: project({ constitution: { present: false } }) }, a, { agent: 'opencode' }),
        );
        expect(r.action).toBe('skipped');
        expect(a.injectProjectConstitution).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 9: Run the step + function tests**

Run (desde `cli/`): `npx jest tests/core/init/steps.test.ts tests/core/context/project-constitution-inject.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite — fix any missing-action compile errors**

Run (desde `cli/`): `npm test`
Expected: todo verde. Si algún otro test construye un `InitActions` literal y rompe por la acción nueva, agregale `injectProjectConstitution: jest.fn(() => 'injected' as const)` (o el no-op equivalente). Si `orchestrator.test.ts` usa `defaultActions`, ya queda cubierto por el binding.

- [ ] **Step 11: Commit**

```bash
git add cli/src/core/context/project-constitution-inject.ts cli/src/core/init/types.ts cli/src/core/init/steps.ts cli/src/core/init/orchestrator.ts cli/tests/core/context/project-constitution-inject.test.ts cli/tests/core/init/steps.test.ts
git commit -m "feat(init): deliver project CONSTITUTION.md to OpenCode via local opencode.json (#6)"
```

---

## Verificación integral (post-tareas)

- [ ] **Suite completa verde:** desde `cli/`, `npm test` → todo verde.
- [ ] **Sensores:** desde `cli/`, `awm sensors run` → `overall: pass` (o `not_certified` explicado). Arreglar findings nuevos.
- [ ] **Smoke manual de #1 (opcional, recomendado):** en un dir git fresco vacío, `awm init --agent opencode` (interactivo, sin `--yes`) ya **no** crashea en `project.profile`.

## Self-Review (autor del plan)

- **Cobertura del spec:** Unidad 1→T2, Unidad 2→T3, Unidad 3→T4, Unidad 4→T5, Unidad 5→T1. Error handling del diseño cubierto: path inexistente (T3 `reconcileAllSkillLinks` skip + `repairGlobalSkills` ya tolera ausencia), CONSTITUTION ausente (T5 `no-constitution`), `instructions` no-array (T5 throw), cero extensiones (T1 skipped). ✔
- **Sin placeholders:** cada step de código trae el código completo y el comando exacto con su resultado esperado. ✔
- **Consistencia de tipos:** `injectProjectConstitution(projectRoot, agent)` (función pura) vs acción `injectProjectConstitution({ projectRoot, agent })` (objeto) — intencional: la acción envuelve a la función. `ConstitutionInjectResult` exportado en T5 Step 3, consumido en types (T5 Step 5) y spies (`'injected' as const`). `reconcileAllSkillLinks(registryContentDir) → { agent, result }[]`. `gatherContext({..., agent})` con default `'claude-code'`. ✔
