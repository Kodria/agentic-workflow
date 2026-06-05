# Multi-Agent Context Injection Layer (Fase 3) Implementation Plan
<!-- awm-qa-complete: 2026-06-04 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar la inyección de contexto AWM del agente, agregando una capa Strategy agnóstica y validándola con un adapter concreto para OpenCode, sin romper el install vivo de Claude Code.

**Architecture:** Un `ContextProvider` agnóstico computa el contenido canónico (markdown + hash). Un `ContextMaterializer` lo persiste idempotentemente a un archivo estable. Un `InjectionOrchestrator` despacha — por el descriptor `ProviderConfig.injection` (union discriminado) — a una `InjectionStrategy` concreta que cablea ese contenido en el mecanismo nativo del agente (`cc-settings-merge` para Claude, `config-instructions` para OpenCode).

**Tech Stack:** TypeScript/Node CLI, Jest (`jest --runInBand`), built-ins `crypto`/`fs`/`path` (cero dependencias nuevas).

**Diseño de referencia:** `docs/plans/2026-06-04-multi-agent-decoupling-design.md`

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `cli/src/core/context/types.ts` | Contratos: `AwmContext`, `MaterializedRef`, `InjectionState`, `InjectionInput` | Crear |
| `cli/src/core/context/strategies/strategy.ts` | Interface `InjectionStrategy` | Crear |
| `cli/src/core/context/provider.ts` | `buildContext()` + `sha256()` | Crear |
| `cli/src/core/context/materializer.ts` | `materialize()` + `globalContextPath()` | Crear |
| `cli/src/core/context/strategies/config-instructions.ts` | `ConfigInstructionsStrategy` (OpenCode) | Crear |
| `cli/src/core/context/strategies/hook-merge.ts` | `HookMergeStrategy` (envuelve `commands/hooks/*`) | Crear |
| `cli/src/core/context/orchestrator.ts` | `InjectionOrchestrator` | Crear |
| `cli/src/providers/index.ts` | `InjectionConfig` union + `getInjection()` | Modificar |
| `cli/src/core/diagnostics/types.ts` | `MachineFacts.contextInjection` | Modificar |
| `cli/src/core/diagnostics/checks.ts` | filas `machine.context.<agent>` | Modificar |

**Diferido (no en este plan, per §7 del diseño):** `ConventionFileStrategy` (`AGENTS.md` fallback) y el scope `local` de OpenCode. Se shippea **global-first**.

---

## Task 1: Validation spike — comportamiento de OpenCode con `instructions[]`

Spike manual (sin código) que valida la assumption marcada Media en el diseño **antes** de cablear el adapter. Si falla, el enfoque `config-instructions` se revisa.

- [ ] **Step 1: Verificar inclusión eager de `instructions[]`**

En un repo de prueba con `opencode` instalado, crear `opencode.json`:

```json
{ "$schema": "https://opencode.ai/config.json", "instructions": ["./awm-probe.md"] }
```

Crear `awm-probe.md` con una línea sentinela (`AWM_PROBE_TOKEN_42`). Abrir opencode y preguntar al agente: *"¿Ves el token AWM_PROBE_TOKEN_42 en tus instrucciones?"*
Expected: el agente confirma el token → `instructions[]` carga eager. Anotar la versión de opencode (`opencode --version`).

- [ ] **Step 2: Verificar tolerancia a archivo ausente**

Borrar `awm-probe.md` (dejando la entrada en `instructions[]`). Reabrir opencode.
Expected: opencode arranca (con warning o silencioso), **no** crashea. Anotar el comportamiento observado.

- [ ] **Step 3: Documentar el resultado**

Agregar al final de `docs/plans/2026-06-04-multi-agent-decoupling-design.md` una sección `## 11. Resultado del spike (Task 1)` con: versión de opencode probada, si la carga es eager (sí/no), y el comportamiento ante archivo ausente. Commit:

```bash
git add docs/plans/2026-06-04-multi-agent-decoupling-design.md
git commit -m "docs(f3): record opencode instructions[] spike results"
```

---

## Task 2: Contratos de contexto + interface `InjectionStrategy`

**Files:**
- Create: `cli/src/core/context/types.ts`
- Create: `cli/src/core/context/strategies/strategy.ts`
- Test: `cli/tests/core/context/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/core/context/types.test.ts
import { AwmContext, MaterializedRef, InjectionState, InjectionInput } from '../../../src/core/context/types';

describe('context contracts', () => {
    it('compiles AwmContext / MaterializedRef / InjectionInput with the expected shape', () => {
        const ctx: AwmContext = { markdown: '# AWM', sourceVersion: '1.0.0', contentHash: 'abc' };
        const ref: MaterializedRef = { absPath: '/tmp/awm-context.md', scope: 'global', contentHash: 'abc' };
        const input: InjectionInput = {
            ref, registryRoot: '/reg', installMethod: 'symlink', agent: 'opencode', scope: 'global',
        };
        const states: InjectionState[] = ['injected', 'absent', 'stale'];
        expect(ctx.contentHash).toBe(ref.contentHash);
        expect(input.agent).toBe('opencode');
        expect(states).toHaveLength(3);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/context/types.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/context/types'`.

- [ ] **Step 3: Create the contracts**

```typescript
// cli/src/core/context/types.ts
import { AgentTarget, Scope } from '../../providers';

export type AwmContext = {
    markdown: string;       // payload canónico (using-awm + extensiones activas)
    sourceVersion: string;  // versión del registry que lo generó
    contentHash: string;    // sha256(markdown) — clave de idempotencia
};

export type MaterializedRef = {
    absPath: string;
    scope: Scope;           // 'global' | 'local'
    contentHash: string;    // = AwmContext.contentHash; reescribe solo si cambia
};

export type InjectionState = 'injected' | 'absent' | 'stale';

export type InjectionInput = {
    ref: MaterializedRef;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
    agent: AgentTarget;
    scope: Scope;
};
```

```typescript
// cli/src/core/context/strategies/strategy.ts
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';

export interface InjectionStrategy {
    inject(input: InjectionInput, provider: ProviderConfig): void;
    remove(input: InjectionInput, provider: ProviderConfig): void;
    status(input: InjectionInput, provider: ProviderConfig): InjectionState;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/context/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/context/types.ts cli/src/core/context/strategies/strategy.ts cli/tests/core/context/types.test.ts
git commit -m "feat(context): contracts + InjectionStrategy interface"
```

---

## Task 3: `ProviderConfig.injection` (union discriminado) + `getInjection`

**Files:**
- Modify: `cli/src/providers/index.ts`
- Test: `cli/tests/providers/injection-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/providers/injection-config.test.ts
import os from 'os';
import path from 'path';
import { getInjection } from '../../src/providers';

describe('getInjection', () => {
    it('returns cc-settings-merge for claude-code', () => {
        const inj = getInjection('claude-code');
        expect(inj?.type).toBe('cc-settings-merge');
    });

    it('returns config-instructions for opencode pointing at the global opencode.json', () => {
        const inj = getInjection('opencode');
        expect(inj).toEqual({
            type: 'config-instructions',
            configPath: path.join(os.homedir(), '.config/opencode/opencode.json'),
            field: 'instructions',
        });
    });

    it('returns undefined for antigravity (no injection mechanism wired yet)', () => {
        expect(getInjection('antigravity')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/providers/injection-config.test.ts`
Expected: FAIL — `getInjection` is not exported.

- [ ] **Step 3: Add the union, wire claude-code + opencode, add the accessor**

In `cli/src/providers/index.ts`, after the `HookConfig` type (line ~20), add:

```typescript
export type InjectionConfig =
    | { type: 'cc-settings-merge'; settingsPath: string; scriptsDir: string; matcher: string; eventName: string }
    | { type: 'config-instructions'; configPath: string; field: 'instructions' };
```

In `ProviderConfig`, add the `injection` field (keep `hooks` for backward compat):

```typescript
export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
    hooks?: HookConfig;
    injection?: InjectionConfig;
};
```

In `PROVIDERS.opencode`, add after the `agent:` line:

```typescript
        injection: {
            type: 'config-instructions',
            configPath: path.join(homedir, '.config/opencode/opencode.json'),
            field: 'instructions',
        },
```

In `PROVIDERS['claude-code']`, add after the existing `hooks: { … }` block (same values, now also exposed as injection):

```typescript
        injection: {
            type: 'cc-settings-merge',
            settingsPath: path.join(homedir, '.claude/settings.json'),
            scriptsDir: path.join(awmHome, 'hooks'),
            matcher: 'startup|clear|compact',
            eventName: 'SessionStart',
        }
```

At the end of the file, add the accessor:

```typescript
export function getInjection(agent: AgentTarget): InjectionConfig | undefined {
    return PROVIDERS[agent]?.injection;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/providers/injection-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify no regression on existing provider tests**

Run: `cd cli && npx jest tests/providers/`
Expected: PASS (existing `index.test.ts` and `hooks-config.test.ts` still green).

- [ ] **Step 6: Commit**

```bash
git add cli/src/providers/index.ts cli/tests/providers/injection-config.test.ts
git commit -m "feat(providers): InjectionConfig union + getInjection accessor"
```

---

## Task 4: `ContextProvider` — `buildContext()` + `sha256()`

`buildContext` lee la skill canónica `using-awm` del registry (igual que `installHook` la referencia en `install.ts:57`), antepone un header con las extensiones activas, y computa el hash. `sourceVersion` sale del frontmatter `version:` de la skill.

**Files:**
- Create: `cli/src/core/context/provider.ts`
- Test: `cli/tests/core/context/provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/core/context/provider.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildContext, sha256 } from '../../../src/core/context/provider';

function tmpRegistry(skillBody: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
    const dir = path.join(root, 'registry/skills/using-awm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillBody);
    return root;
}

describe('sha256', () => {
    it('is deterministic and hex-encoded', () => {
        expect(sha256('hello')).toBe(sha256('hello'));
        expect(sha256('hello')).toMatch(/^[0-9a-f]{64}$/);
        expect(sha256('hello')).not.toBe(sha256('world'));
    });
});

describe('buildContext', () => {
    it('embeds the using-awm body, version from frontmatter, and active extensions', () => {
        const reg = tmpRegistry('---\nname: using-awm\nversion: "2.1.0"\n---\nBODY-MARKER');
        const ctx = buildContext({ registryRoot: reg, profileExtensions: ['frontend', 'docs'] });
        expect(ctx.markdown).toContain('BODY-MARKER');
        expect(ctx.markdown).toContain('frontend, docs');
        expect(ctx.sourceVersion).toBe('2.1.0');
        expect(ctx.contentHash).toBe(sha256(ctx.markdown));
    });

    it('falls back to version 0.0.0 when frontmatter has no version', () => {
        const reg = tmpRegistry('---\nname: using-awm\n---\nBODY');
        expect(buildContext({ registryRoot: reg, profileExtensions: [] }).sourceVersion).toBe('0.0.0');
    });

    it('throws an actionable error when the using-awm skill is missing', () => {
        const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        expect(() => buildContext({ registryRoot: reg, profileExtensions: [] })).toThrow('using-awm skill not found');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/context/provider.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/context/provider'`.

- [ ] **Step 3: Implement the provider**

```typescript
// cli/src/core/context/provider.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AwmContext } from './types';

export function sha256(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

export type ContextInput = {
    registryRoot: string;
    profileExtensions: string[];
};

function parseVersion(skill: string): string {
    const m = skill.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
    return m ? m[1].trim() : '0.0.0';
}

export function buildContext(input: ContextInput): AwmContext {
    const skillPath = path.join(input.registryRoot, 'registry/skills/using-awm/SKILL.md');
    if (!fs.existsSync(skillPath)) {
        throw new Error(`using-awm skill not found at ${skillPath}. Run 'awm update' first.`);
    }
    const skill = fs.readFileSync(skillPath, 'utf-8');
    const exts = input.profileExtensions.length ? input.profileExtensions.join(', ') : 'ninguna';
    const header = `<!-- AWM context (generated) -->\n# AWM\n\nExtensiones activas: ${exts}\n\n`;
    const markdown = header + skill;
    return { markdown, sourceVersion: parseVersion(skill), contentHash: sha256(markdown) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/context/provider.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/context/provider.ts cli/tests/core/context/provider.test.ts
git commit -m "feat(context): ContextProvider buildContext + sha256 (single source of truth)"
```

---

## Task 5: `ContextMaterializer` — `materialize()` idempotente por hash

**Files:**
- Create: `cli/src/core/context/materializer.ts`
- Test: `cli/tests/core/context/materializer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/core/context/materializer.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { materialize, globalContextPath } from '../../../src/core/context/materializer';
import { sha256 } from '../../../src/core/context/provider';
import { AwmContext } from '../../../src/core/context/types';

function ctxOf(markdown: string): AwmContext {
    return { markdown, sourceVersion: '1.0.0', contentHash: sha256(markdown) };
}

describe('globalContextPath', () => {
    it('points under AWM_HOME/context', () => {
        expect(globalContextPath()).toContain(path.join('context', 'awm-context.md'));
    });
});

describe('materialize', () => {
    it('writes the content and returns a ref with the matching hash', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mat-'));
        const abs = path.join(dir, 'awm-context.md');
        const ctx = ctxOf('CONTENT-A');
        const ref = materialize(ctx, abs, 'global');
        expect(ref).toEqual({ absPath: abs, scope: 'global', contentHash: ctx.contentHash });
        expect(fs.readFileSync(abs, 'utf-8')).toBe('CONTENT-A');
    });

    it('is a no-op when the on-disk hash already matches (mtime unchanged)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mat-'));
        const abs = path.join(dir, 'awm-context.md');
        const ctx = ctxOf('CONTENT-A');
        materialize(ctx, abs, 'global');
        const mtime1 = fs.statSync(abs).mtimeMs;
        materialize(ctx, abs, 'global'); // same content
        expect(fs.statSync(abs).mtimeMs).toBe(mtime1);
    });

    it('rewrites when the content changed', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mat-'));
        const abs = path.join(dir, 'awm-context.md');
        materialize(ctxOf('CONTENT-A'), abs, 'global');
        const ref = materialize(ctxOf('CONTENT-B'), abs, 'global');
        expect(fs.readFileSync(abs, 'utf-8')).toBe('CONTENT-B');
        expect(ref.contentHash).toBe(sha256('CONTENT-B'));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/context/materializer.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/context/materializer'`.

- [ ] **Step 3: Implement the materializer**

```typescript
// cli/src/core/context/materializer.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AwmContext, MaterializedRef } from './types';
import { sha256 } from './provider';
import { Scope } from '../../providers';

function awmHome(): string {
    return process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');
}

export function globalContextPath(): string {
    return path.join(awmHome(), 'context', 'awm-context.md');
}

export function materialize(ctx: AwmContext, absPath: string, scope: Scope): MaterializedRef {
    const onDisk = fs.existsSync(absPath) ? sha256(fs.readFileSync(absPath, 'utf-8')) : null;
    if (onDisk !== ctx.contentHash) {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, ctx.markdown, 'utf-8');
    }
    return { absPath, scope, contentHash: ctx.contentHash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/context/materializer.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/context/materializer.ts cli/tests/core/context/materializer.test.ts
git commit -m "feat(context): ContextMaterializer with hash-based idempotency"
```

---

## Task 6: `ConfigInstructionsStrategy` — adapter OpenCode

inject/remove/status sobre `instructions[]` de `opencode.json`. Centinela = el `ref.absPath`. Preserva entradas del usuario. `status`: entrada presente + hash del archivo coincide → `injected`; entrada presente pero archivo ausente/hash distinto → `stale`; sin entrada → `absent`.

**Files:**
- Create: `cli/src/core/context/strategies/config-instructions.ts`
- Test: `cli/tests/core/context/strategies/config-instructions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/core/context/strategies/config-instructions.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigInstructionsStrategy } from '../../../../src/core/context/strategies/config-instructions';
import { ProviderConfig } from '../../../../src/providers';
import { InjectionInput } from '../../../../src/core/context/types';
import { sha256 } from '../../../../src/core/context/provider';

function setup(opencodeJson?: object) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-oc-'));
    const configPath = path.join(dir, 'opencode.json');
    if (opencodeJson) fs.writeFileSync(configPath, JSON.stringify(opencodeJson, null, 2));
    const absPath = path.join(dir, '.awm/context/awm-context.md');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, 'CTX');
    const provider: ProviderConfig = {
        label: 'OpenCode', skill: { global: '', local: '' }, workflow: null, agent: null,
        injection: { type: 'config-instructions', configPath, field: 'instructions' },
    };
    const input: InjectionInput = {
        ref: { absPath, scope: 'global', contentHash: sha256('CTX') },
        registryRoot: '/reg', installMethod: 'symlink', agent: 'opencode', scope: 'global',
    };
    return { configPath, absPath, provider, input };
}

const strat = new ConfigInstructionsStrategy();

describe('ConfigInstructionsStrategy.inject', () => {
    it('creates opencode.json with the sentinel when it does not exist', () => {
        const { configPath, absPath, provider, input } = setup();
        strat.inject(input, provider);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain(absPath);
        expect(cfg.$schema).toBe('https://opencode.ai/config.json');
    });

    it('preserves user instructions and is idempotent (no duplicate)', () => {
        const { configPath, absPath, provider, input } = setup({ instructions: ['docs/rules.md'] });
        strat.inject(input, provider);
        strat.inject(input, provider);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain('docs/rules.md');
        expect(cfg.instructions.filter((e: string) => e === absPath)).toHaveLength(1);
    });
});

describe('ConfigInstructionsStrategy.remove', () => {
    it('removes only the sentinel, preserving user entries', () => {
        const { configPath, absPath, provider, input } = setup({ instructions: ['docs/rules.md'] });
        strat.inject(input, provider);
        strat.remove(input, provider);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toEqual(['docs/rules.md']);
    });
});

describe('ConfigInstructionsStrategy.status', () => {
    it('absent when no config / no entry', () => {
        const { provider, input } = setup();
        expect(strat.status(input, provider)).toBe('absent');
    });

    it('injected when entry present and materialized hash matches', () => {
        const { provider, input } = setup();
        strat.inject(input, provider);
        expect(strat.status(input, provider)).toBe('injected');
    });

    it('stale when entry present but materialized file content drifted', () => {
        const { absPath, provider, input } = setup();
        strat.inject(input, provider);
        fs.writeFileSync(absPath, 'DRIFTED');
        expect(strat.status(input, provider)).toBe('stale');
    });

    it('throws actionable error on malformed opencode.json instead of clobbering', () => {
        const { configPath, provider, input } = setup();
        fs.writeFileSync(configPath, '{ not json');
        expect(() => strat.inject(input, provider)).toThrow('not valid JSON');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/context/strategies/config-instructions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the strategy**

```typescript
// cli/src/core/context/strategies/config-instructions.ts
import fs from 'fs';
import path from 'path';
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';
import { InjectionStrategy } from './strategy';
import { sha256 } from '../provider';

type OpencodeConfig = { $schema?: string; instructions?: string[]; [k: string]: unknown };

export class ConfigInstructionsStrategy implements InjectionStrategy {
    private cfgOf(provider: ProviderConfig): { configPath: string } {
        const inj = provider.injection;
        if (!inj || inj.type !== 'config-instructions') {
            throw new Error('ConfigInstructionsStrategy requires a config-instructions provider');
        }
        return { configPath: inj.configPath };
    }

    private read(configPath: string): OpencodeConfig {
        if (!fs.existsSync(configPath)) return { $schema: 'https://opencode.ai/config.json', instructions: [] };
        const raw = fs.readFileSync(configPath, 'utf-8');
        try {
            return JSON.parse(raw) as OpencodeConfig;
        } catch {
            throw new Error(`${configPath} is not valid JSON. Fix it manually, then re-run.`);
        }
    }

    private write(configPath: string, cfg: OpencodeConfig): void {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    }

    inject(input: InjectionInput, provider: ProviderConfig): void {
        const { configPath } = this.cfgOf(provider);
        const cfg = this.read(configPath);
        const list = Array.isArray(cfg.instructions) ? cfg.instructions : [];
        if (!list.includes(input.ref.absPath)) list.push(input.ref.absPath);
        cfg.instructions = list;
        this.write(configPath, cfg);
    }

    remove(input: InjectionInput, provider: ProviderConfig): void {
        const { configPath } = this.cfgOf(provider);
        if (!fs.existsSync(configPath)) return;
        const cfg = this.read(configPath);
        cfg.instructions = (cfg.instructions ?? []).filter((e) => e !== input.ref.absPath);
        this.write(configPath, cfg);
    }

    status(input: InjectionInput, provider: ProviderConfig): InjectionState {
        const { configPath } = this.cfgOf(provider);
        if (!fs.existsSync(configPath)) return 'absent';
        const cfg = this.read(configPath);
        if (!(cfg.instructions ?? []).includes(input.ref.absPath)) return 'absent';
        if (!fs.existsSync(input.ref.absPath)) return 'stale';
        const onDisk = sha256(fs.readFileSync(input.ref.absPath, 'utf-8'));
        return onDisk === input.ref.contentHash ? 'injected' : 'stale';
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/context/strategies/config-instructions.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/context/strategies/config-instructions.ts cli/tests/core/context/strategies/config-instructions.test.ts
git commit -m "feat(context): ConfigInstructionsStrategy — OpenCode adapter"
```

---

## Task 7: `HookMergeStrategy` — refactor que envuelve el hook de Claude

Envuelve `installHook`/`uninstallHook`/`computeHookStatus` (existentes) tras la interface. **No cambia comportamiento** — los tests actuales del hook deben seguir verdes (characterization).

**Files:**
- Create: `cli/src/core/context/strategies/hook-merge.ts`
- Test: `cli/tests/core/context/strategies/hook-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/core/context/strategies/hook-merge.test.ts
import { HookMergeStrategy } from '../../../../src/core/context/strategies/hook-merge';
import * as install from '../../../../src/commands/hooks/install';
import * as uninstall from '../../../../src/commands/hooks/uninstall';
import * as status from '../../../../src/commands/hooks/status';
import { ProviderConfig } from '../../../../src/providers';
import { InjectionInput } from '../../../../src/core/context/types';

function input(): InjectionInput {
    return {
        ref: { absPath: '/tmp/awm-context.md', scope: 'global', contentHash: 'h' },
        registryRoot: '/reg', installMethod: 'symlink', agent: 'claude-code', scope: 'global',
    };
}
const provider = {} as ProviderConfig;
const strat = new HookMergeStrategy();

describe('HookMergeStrategy', () => {
    it('inject delegates to installHook with agent/registryRoot/installMethod', () => {
        const spy = jest.spyOn(install, 'installHook').mockReturnValue({} as any);
        strat.inject(input(), provider);
        expect(spy).toHaveBeenCalledWith({ agent: 'claude-code', registryRoot: '/reg', installMethod: 'symlink' });
        spy.mockRestore();
    });

    it('remove delegates to uninstallHook', () => {
        const spy = jest.spyOn(uninstall, 'uninstallHook').mockReturnValue({} as any);
        strat.remove(input(), provider);
        expect(spy).toHaveBeenCalledWith({ agent: 'claude-code' });
        spy.mockRestore();
    });

    it.each([
        ['HEALTHY', 'injected'],
        ['DEGRADED', 'stale'],
        ['NOT_INSTALLED', 'absent'],
    ])('status maps hook overall %s → %s', (overall, expected) => {
        const spy = jest.spyOn(status, 'computeHookStatus').mockReturnValue({ overall } as any);
        expect(strat.status(input(), provider)).toBe(expected);
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/context/strategies/hook-merge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

```typescript
// cli/src/core/context/strategies/hook-merge.ts
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';
import { InjectionStrategy } from './strategy';
import { installHook } from '../../../commands/hooks/install';
import { uninstallHook } from '../../../commands/hooks/uninstall';
import { computeHookStatus } from '../../../commands/hooks/status';

const STATE_BY_OVERALL: Record<string, InjectionState> = {
    HEALTHY: 'injected',
    DEGRADED: 'stale',
    NOT_INSTALLED: 'absent',
};

export class HookMergeStrategy implements InjectionStrategy {
    inject(input: InjectionInput, _provider: ProviderConfig): void {
        installHook({ agent: input.agent, registryRoot: input.registryRoot, installMethod: input.installMethod });
    }

    remove(input: InjectionInput, _provider: ProviderConfig): void {
        uninstallHook({ agent: input.agent });
    }

    status(input: InjectionInput, _provider: ProviderConfig): InjectionState {
        return STATE_BY_OVERALL[computeHookStatus(input.agent).overall] ?? 'absent';
    }
}
```

- [ ] **Step 4: Run tests — wrapper + existing hook suite stay green**

Run: `cd cli && npx jest tests/core/context/strategies/hook-merge.test.ts tests/commands/hooks tests/providers/hooks-config.test.ts`
Expected: PASS — wrapper passes AND the pre-existing hook tests are unchanged/green (characterization confirmed).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/context/strategies/hook-merge.ts cli/tests/core/context/strategies/hook-merge.test.ts
git commit -m "refactor(context): HookMergeStrategy wraps existing Claude hook behind the interface"
```

---

## Task 8: `InjectionOrchestrator` — despacho agente→estrategia

Único punto que conoce el mapeo. `installContext`: buildContext → materialize → strategy.inject. `uninstallContext`/`contextStatus` delegan.

**Files:**
- Create: `cli/src/core/context/orchestrator.ts`
- Test: `cli/tests/core/context/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cli/tests/core/context/orchestrator.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InjectionOrchestrator } from '../../../src/core/context/orchestrator';

function tmpRegistry(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
    const dir = path.join(root, 'registry/skills/using-awm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nversion: "1.0.0"\n---\nBODY');
    return root;
}

describe('InjectionOrchestrator (opencode, real strategy)', () => {
    let configPath: string;
    let absPath: string;
    let orch: InjectionOrchestrator;
    let registryRoot: string;

    beforeEach(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-oc-'));
        configPath = path.join(dir, 'opencode.json');
        absPath = path.join(dir, 'awm-context.md');
        registryRoot = tmpRegistry();
        orch = new InjectionOrchestrator({
            providerOverride: {
                label: 'OpenCode', skill: { global: '', local: '' }, workflow: null, agent: null,
                injection: { type: 'config-instructions', configPath, field: 'instructions' },
            },
            contextPathOverride: absPath,
        });
    });

    it('installContext materializes content and injects the sentinel; status reports injected', () => {
        orch.installContext({ agent: 'opencode', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] });
        expect(fs.existsSync(absPath)).toBe(true);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain(absPath);
        expect(orch.contextStatus({ agent: 'opencode', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] })).toBe('injected');
    });

    it('uninstallContext removes the sentinel; status reports absent', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        orch.uninstallContext(args);
        expect(orch.contextStatus(args)).toBe('absent');
    });

    it('throws when the agent has no injection mechanism', () => {
        const bare = new InjectionOrchestrator();
        expect(() => bare.installContext({ agent: 'antigravity', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] }))
            .toThrow('no injection mechanism');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/context/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

```typescript
// cli/src/core/context/orchestrator.ts
import { AgentTarget, Scope, ProviderConfig, PROVIDERS, getInjection } from '../../providers';
import { InjectionStrategy } from './strategies/strategy';
import { HookMergeStrategy } from './strategies/hook-merge';
import { ConfigInstructionsStrategy } from './strategies/config-instructions';
import { buildContext } from './provider';
import { materialize, globalContextPath } from './materializer';
import { InjectionInput, InjectionState } from './types';

export type ContextOp = {
    agent: AgentTarget;
    scope: Scope;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
    profileExtensions: string[];
};

type Overrides = { providerOverride?: ProviderConfig; contextPathOverride?: string };

export class InjectionOrchestrator {
    constructor(private overrides: Overrides = {}) {}

    private provider(agent: AgentTarget): ProviderConfig {
        return this.overrides.providerOverride ?? PROVIDERS[agent];
    }

    private strategy(agent: AgentTarget): InjectionStrategy {
        const inj = this.overrides.providerOverride?.injection ?? getInjection(agent);
        if (!inj) throw new Error(`agent '${agent}' has no injection mechanism configured`);
        switch (inj.type) {
            case 'cc-settings-merge': return new HookMergeStrategy();
            case 'config-instructions': return new ConfigInstructionsStrategy();
        }
    }

    private inputFor(op: ContextOp): InjectionInput {
        const ctx = buildContext({ registryRoot: op.registryRoot, profileExtensions: op.profileExtensions });
        const absPath = this.overrides.contextPathOverride ?? globalContextPath();
        const ref = materialize(ctx, absPath, op.scope);
        return { ref, registryRoot: op.registryRoot, installMethod: op.installMethod, agent: op.agent, scope: op.scope };
    }

    installContext(op: ContextOp): void {
        const provider = this.provider(op.agent);
        this.strategy(op.agent).inject(this.inputFor(op), provider);
    }

    uninstallContext(op: ContextOp): void {
        const provider = this.provider(op.agent);
        this.strategy(op.agent).remove(this.inputFor(op), provider);
    }

    contextStatus(op: ContextOp): InjectionState {
        const provider = this.provider(op.agent);
        return this.strategy(op.agent).status(this.inputFor(op), provider);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/context/orchestrator.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/context/orchestrator.ts cli/tests/core/context/orchestrator.test.ts
git commit -m "feat(context): InjectionOrchestrator dispatches agent→strategy"
```

---

## Task 9: Diagnostics — check `machine.context.<agent>`

Extiende `MachineFacts` con el estado de inyección por agente y agrega una fila por agente en `machineChecks`, alimentando el report que consumen `doctor` (lee) e `init` (actúa).

**Files:**
- Modify: `cli/src/core/diagnostics/types.ts`
- Modify: `cli/src/core/diagnostics/checks.ts`
- Test: `cli/tests/core/diagnostics/checks.test.ts` (extender)

- [ ] **Step 1: Write the failing test (append to existing suite)**

Add to `cli/tests/core/diagnostics/checks.test.ts`:

```typescript
describe('machine.context.<agent> checks', () => {
    function machineWith(contextInjection: { agent: string; state: 'injected' | 'absent' | 'stale' }[]) {
        return { ...healthyMachine(), contextInjection };
    }

    it('ok when context is injected for an agent', () => {
        const r = runChecks({ machine: machineWith([{ agent: 'opencode', state: 'injected' }]), project: null });
        const row = r.results.find((x) => x.id === 'machine.context.opencode')!;
        expect(row.status).toBe('ok');
        expect(row.remedy).toEqual({ kind: 'none' });
    });

    it('missing + awm init remedy when absent (degrades overall)', () => {
        const r = runChecks({ machine: machineWith([{ agent: 'opencode', state: 'absent' }]), project: null });
        const row = r.results.find((x) => x.id === 'machine.context.opencode')!;
        expect(row.status).toBe('missing');
        expect(row.remedy).toEqual({ kind: 'command', value: 'awm init' });
        expect(r.overall).toBe('degraded');
    });

    it('warn when stale', () => {
        const r = runChecks({ machine: machineWith([{ agent: 'claude-code', state: 'stale' }]), project: null });
        expect(r.results.find((x) => x.id === 'machine.context.claude-code')!.status).toBe('warn');
    });
});
```

Also update the existing `healthyMachine()` helper in that file to include the new field, so prior tests keep compiling:

```typescript
// inside healthyMachine(), add this property to the returned object:
        contextInjection: [],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/diagnostics/checks.test.ts`
Expected: FAIL — `contextInjection` not on `MachineFacts` (type error) / rows not produced.

- [ ] **Step 3: Extend the facts type**

In `cli/src/core/diagnostics/types.ts`, add the import and field:

```typescript
// at top, alongside other imports (add this line):
import { AgentTarget } from '../../providers';
import { InjectionState } from '../context/types';
```

Add to `MachineFacts`:

```typescript
    contextInjection: { agent: AgentTarget; state: InjectionState }[];
```

- [ ] **Step 4: Emit the rows in checks.ts**

In `cli/src/core/diagnostics/checks.ts`, inside `machineChecks`, before `return out;`, add:

```typescript
    // machine.context.<agent> — una fila por agente con contexto AWM gestionado
    for (const c of m.contextInjection) {
        if (c.state === 'injected') {
            out.push({ id: `machine.context.${c.agent}`, level: 'machine', label: `contexto AWM (${c.agent})`,
                status: 'ok', remedy: none });
        } else if (c.state === 'stale') {
            out.push({ id: `machine.context.${c.agent}`, level: 'machine', label: `contexto AWM (${c.agent})`,
                status: 'warn', detail: 'contexto desactualizado', remedy: cmd('awm init') });
        } else {
            out.push({ id: `machine.context.${c.agent}`, level: 'machine', label: `contexto AWM (${c.agent})`,
                status: 'missing', remedy: cmd('awm init') });
        }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/diagnostics/checks.test.ts`
Expected: PASS (new cases + all pre-existing diagnostics cases green).

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/diagnostics/types.ts cli/src/core/diagnostics/checks.ts cli/tests/core/diagnostics/checks.test.ts
git commit -m "feat(diagnostics): machine.context.<agent> injection-state check"
```

---

## Task 10: Compilación + suite completa (regresión)

**Files:** ninguno (verificación de integración).

- [ ] **Step 1: Compilar TypeScript estricto**

Run: `cd cli && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 2: Correr la suite completa**

Run: `cd cli && npm test`
Expected: todos los tests verdes (nuevos del paquete `context/` + diagnostics + hooks + providers sin regresión).

- [ ] **Step 3: Commit (si tsc/test requirió ajustes)**

```bash
git add -A
git commit -m "chore(f3): full suite + tsc green for context injection layer"
```

---

## Self-Review (ejecutado por quien escribió el plan)

**1. Spec coverage** — cada componente del diseño §4 tiene tarea:
- ContextProvider → T4 ✔ · ContextMaterializer → T5 ✔ · InjectionStrategy → T2 ✔ · HookMergeStrategy → T7 ✔ · ConfigInstructionsStrategy → T6 ✔ · ProviderConfig extendido → T3 ✔ · InjectionOrchestrator → T8 ✔ · diagnostics check → T9 ✔. Spike de riesgo §6 → T1 ✔. Compilación/regresión → T10 ✔.
- Diferidos (§7): `ConventionFileStrategy` y scope local — **intencionalmente fuera**, documentado.

**2. Placeholder scan** — sin TBD/TODO; todo step de código trae código completo y comando con expected.

**3. Type consistency** — nombres verificados de punta a punta: `AwmContext{markdown,sourceVersion,contentHash}`, `MaterializedRef{absPath,scope,contentHash}`, `InjectionState='injected'|'absent'|'stale'`, `InjectionInput{ref,registryRoot,installMethod,agent,scope}`, `InjectionStrategy.{inject,remove,status}(input,provider)`, `getInjection(agent)`, `buildContext({registryRoot,profileExtensions})`, `sha256(string)`, `materialize(ctx,absPath,scope)`, `globalContextPath()`, `InjectionOrchestrator.{installContext,uninstallContext,contextStatus}(ContextOp)`. Las firmas envueltas existen: `installHook({agent,registryRoot,installMethod})`, `uninstallHook({agent})`, `computeHookStatus(agent).overall`.

---

## Evaluación post-merge — Fase 3.1 (pendiente)

> **Evaluado**: 2026-06-04. Estado del merge: `main` @ `5532628`. Tests: 393/393.

### ¿Qué está construido y funciona?

La **capa de infraestructura** (Tasks 2–10) está completa, mergeada y testeada:
- `ContextProvider` · `ContextMaterializer` · `InjectionStrategy` · `HookMergeStrategy` · `ConfigInstructionsStrategy` · `InjectionOrchestrator` · `MachineFacts.contextInjection` · filas `machine.context.<agent>` en checks.

### ¿Qué falta para que el usuario pueda usar la feature?

#### BLOQUEANTE — Fase 3.1 (próxima sesión)

**W1 — Wiring `gatherMachine()` → `InjectionOrchestrator.contextStatus()`** (importante)
- Archivo: `cli/src/core/diagnostics/context.ts:107`
- Estado actual: `contextInjection: []` hardcodeado (stub).
- Lo que falta: iterar sobre los agentes que tienen `injection` configurado, llamar `InjectionOrchestrator.contextStatus()` para cada uno, y poblar el array.
- Impacto: sin esto, `awm doctor` nunca muestra el estado de contexto para OpenCode ni Claude.
- Precaución: `contextStatus()` puede tirar si el registry no existe → wrappear con try/catch → `absent` por defecto.

**W2 — Wiring `awm init` → `InjectionOrchestrator.installContext()`** (bloqueante para OpenCode)
- Archivos: `cli/src/core/init/steps.ts` (nuevo step) + `cli/src/core/init/orchestrator.ts` (incluirlo en la secuencia)
- Estado actual: `stepHook` instala el hook de Claude directamente via `installHook`. No hay step equivalente que llame al `InjectionOrchestrator`.
- Lo que falta: un `stepContextInjection` que llame `orchestrator.installContext()` para el agente target cuando `contextStatus() !== 'injected'`.
- Impacto: sin esto, `awm init --agent opencode` no inyecta nada en `opencode.json`.
- Consideración de diseño: `stepHook` seguirá cubriendo claude-code via la ruta vieja por backward-compat. El nuevo step cubre agentes con `injection.type !== 'cc-settings-merge'` o unifica ambos.

**T1 — Spike manual OpenCode `instructions[]`** (bloqueante para validar el adapter)
- Ver Task 1 de este plan (nunca ejecutada — requiere OpenCode instalado).
- Sin este spike, no se sabe si `ConfigInstructionsStrategy` funciona en la práctica.

#### IMPORTANTE pero no bloqueante

**W3 — `awm sync` no regenera `~/.awm/context/awm-context.md`**
- Si el usuario clona en una máquina nueva y corre `awm sync`, el archivo de contexto no existe.
- OpenCode apunta a un archivo ausente → stale. `awm init` lo corregiría, pero `awm sync` debería hacerlo también.

#### DIFERIDO por diseño (documentado en §7 del diseño)

- `ConventionFileStrategy` (`AGENTS.md` managed block) — pendiente hasta que aparezca un agente convention-only.
- Scope `local` de OpenCode (`./opencode.json`) — shippeable global-first, local es follow-up.
- Antigravity context injection — sin mecanismo definido aún.
- Unificar content-source del hook de Claude sobre `ContextProvider` — el hook actual computa el contenido por su cuenta; riesgo de divergencia baja, follow-up de bajo riesgo.

### Plan de ataque para mañana

1. **Ejecutar T1** (spike manual OpenCode) — sin esto, todo lo demás es especulativo.
2. **W1** — Wiring `gatherMachine()` para poblar `contextInjection` con el estado real.
3. **W2** — Nuevo step `stepContextInjection` en `init/steps.ts` que use el `InjectionOrchestrator`.
4. Correr `awm init --agent opencode` en real y verificar que `opencode.json` tenga la entrada correcta.
5. Correr `awm doctor` y verificar que aparezca `machine.context.opencode: ok`.

### Archivos clave a tocar en Fase 3.1

| Archivo | Cambio |
|---|---|
| `cli/src/core/diagnostics/context.ts` | `gatherMachine()` → iterar agentes con injection, llamar `contextStatus()` |
| `cli/src/core/init/steps.ts` | Agregar `stepContextInjection(d)` |
| `cli/src/core/init/orchestrator.ts` | Incluir `stepContextInjection` en la secuencia de steps |
| `cli/tests/core/init/steps.test.ts` | Test para `stepContextInjection` |
| `docs/plans/2026-06-04-multi-agent-decoupling-design.md` | Sección `## 11. Resultado del spike (Task 1)` |
