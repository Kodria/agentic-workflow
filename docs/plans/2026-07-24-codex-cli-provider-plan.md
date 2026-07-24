# Codex CLI Provider and Coexistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extender el CLI de AWM con un provider Codex nativo, transaccional y compatible con Claude Code y OpenCode, incluyendo targeting multiagente, rutas compartidas, hooks, contexto, agentes TOML y diagnóstico.

**Architecture:** El CLI calculará primero estado deseado multi-provider y después aplicará operaciones físicas deduplicadas mediante una transacción con backup y rollback. Las rutas y capacidades se resolverán en call-time; Codex tendrá adaptadores para TOML, bloques administrados y hooks, mientras Claude Code y OpenCode conservarán sus estrategias actuales.

**Tech Stack:** TypeScript 5.9, Node.js 20+, Commander, Jest/ts-jest, JSON, TOML generado determinísticamente, filesystem y `child_process.execFileSync`.

**Modo de ejecución:** interactivo

---

## Orden y dependencias

Este es el plan 1 de 3. Debe ejecutarse antes de:

1. `docs/plans/2026-07-24-codex-baseline-portability-plan.md`
2. `docs/plans/2026-07-24-codex-e2e-rollout-plan.md`

La rama de diseño nació antes del release CLI `v3.1.0`. Antes de crear el
worktree de implementación, ejecutar `git fetch origin --tags --prune`, integrar
`origin/main` y verificar que `cli/package.json` parte de `3.1.0` o superior.
`cli/src/index.ts` y `cli/src/core/discovery.ts` cambiaron en ese release; resolver
la integración preservando el comando `export` y sus tests antes de iniciar TDD
de Codex.

Durante este plan todos los tests deben usar `tmpHome` y `tmpWork` separados. Ningún paso autoriza escribir en `~/.awm`, `~/.claude`, `~/.agents` o `~/.codex` reales.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `cli/src/utils/config.ts` | Parsear, migrar, validar y persistir preferencias atómicamente |
| `cli/src/core/agent-targets.ts` | Resolver filtros explícitos o todos los agentes habilitados |
| `cli/src/providers/index.ts` | Declarar providers, capacidades, renderers y rutas evaluadas en call-time |
| `cli/src/core/provider-version.ts` | Probar binarios y aplicar la versión mínima antes de mutaciones |
| `cli/src/core/atomic-file.ts` | Escritura atómica reutilizable de archivos |
| `cli/src/core/context/managed-block.ts` | Merge estricto de un único bloque AWM en Markdown |
| `cli/src/core/context/strategies/codex-agents.ts` | Inyección global y local en `AGENTS.md` |
| `cli/src/core/renderers/canonical-agent.ts` | Validar el agente Markdown canónico |
| `cli/src/core/renderers/codex-agent.ts` | Renderizar TOML determinista de agente Codex |
| `cli/src/core/artifact-state.ts` | Persistir propietarios lógicos de artefactos administrados |
| `cli/src/core/install-planner.ts` | Construir operaciones lógicas y físicas sin escribir |
| `cli/src/core/install-transaction.ts` | Backup, staging, apply, verificación y rollback |
| `cli/src/commands/hooks/claude.ts` | Encapsular el comportamiento Claude existente |
| `cli/src/commands/hooks/codex.ts` | Merge y diagnóstico del hook Codex |
| `cli/src/core/init/*` | Mantener orden de gates y activar un provider sin desactivar otros |
| `cli/src/core/diagnostics/*` | Emitir matriz estable por provider |
| `cli/src/index.ts` | Registrar las opciones y delegar al resolver/planner compartidos |

### Task 1: Preferencias habilitadas y resolución común de targets

_Requirements: R10, R11, R12, R13, R20_

**Files:**
- Modify: `cli/src/utils/config.ts`
- Create: `cli/src/core/agent-targets.ts`
- Modify: `cli/tests/utils/config.test.ts`
- Create: `cli/tests/core/agent-targets.test.ts`

- [ ] **Step 1: Escribir los tests rojos de migración y validación**

Agregar a `cli/tests/utils/config.test.ts` casos con imports tardíos que usen `tmpHome` y `tmpWork` distintos:

```ts
it('migrates defaultAgent without losing unknown optional preferences', () => {
    fs.writeFileSync(path.join(tmpHome, 'preferences.json'), JSON.stringify({
        defaultAgent: 'claude-code',
        installMethod: 'symlink',
        defaultScope: 'local',
        baseRemote: 'https://example.test/baseline.git',
        pins: { baseline: '1.4.0' },
    }));

    const { getPreferences } = require('../../src/utils/config');
    const prefs = getPreferences();

    expect(prefs.enabledAgents).toEqual(['claude-code']);
    expect(prefs.baseRemote).toBe('https://example.test/baseline.git');
    expect(prefs.pins).toEqual({ baseline: '1.4.0' });
    expect(JSON.parse(fs.readFileSync(path.join(tmpHome, 'preferences.json'), 'utf8')))
        .toEqual(prefs);
});

it('does not overwrite malformed preferences', () => {
    const file = path.join(tmpHome, 'preferences.json');
    fs.writeFileSync(file, '{"defaultAgent":');
    const before = fs.readFileSync(file, 'utf8');

    const { getPreferences } = require('../../src/utils/config');
    expect(() => getPreferences()).toThrow('preferences.json is not valid JSON');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
});

it('deduplicates enabled agents and requires the default to remain enabled', () => {
    fs.writeFileSync(path.join(tmpHome, 'preferences.json'), JSON.stringify({
        defaultAgent: 'claude-code',
        enabledAgents: ['claude-code', 'codex', 'codex'],
        installMethod: 'symlink',
        defaultScope: 'local',
    }));
    const { getPreferences } = require('../../src/utils/config');
    expect(getPreferences().enabledAgents).toEqual(['claude-code', 'codex']);
});
```

- [ ] **Step 2: Ejecutar los tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/utils/config.test.ts`

Expected: FAIL porque `enabledAgents` no existe y las preferencias inválidas no producen el mensaje requerido.

- [ ] **Step 3: Implementar parsing, migración y escritura atómica**

En `cli/src/utils/config.ts`, conservar los campos opcionales existentes y sustituir el flujo de lectura/escritura por esta API:

```ts
export interface AwmPreferences {
    defaultAgent: AgentTarget;
    enabledAgents: AgentTarget[];
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
    baseRemote?: string;
    channel?: 'stable' | 'dev';
    pins?: Record<string, string>;
}

const DEFAULT_PREFS: AwmPreferences = {
    defaultAgent: 'claude-code',
    enabledAgents: ['claude-code'],
    installMethod: 'symlink',
    defaultScope: 'local',
};

function normalizePreferences(value: unknown): { prefs: AwmPreferences; changed: boolean } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('preferences.json must contain a JSON object');
    }
    const raw = value as Record<string, unknown>;
    if (!isAgentTarget(raw.defaultAgent)) {
        throw new Error('preferences.json has an invalid defaultAgent');
    }
    if (raw.installMethod !== 'symlink' && raw.installMethod !== 'copy') {
        throw new Error('preferences.json has an invalid installMethod');
    }
    if (raw.defaultScope !== 'global' && raw.defaultScope !== 'local') {
        throw new Error('preferences.json has an invalid defaultScope');
    }
    const source = raw.enabledAgents === undefined ? [raw.defaultAgent] : raw.enabledAgents;
    if (!Array.isArray(source) || !source.every(isAgentTarget)) {
        throw new Error('preferences.json has an invalid enabledAgents');
    }
    const enabledAgents = Array.from(new Set(source));
    if (!enabledAgents.includes(raw.defaultAgent)) {
        throw new Error('preferences.json defaultAgent must be included in enabledAgents');
    }
    const prefs = { ...raw, enabledAgents } as unknown as AwmPreferences;
    return {
        prefs,
        changed: raw.enabledAgents === undefined ||
            JSON.stringify(source) !== JSON.stringify(enabledAgents),
    };
}

export function getPreferences(): AwmPreferences {
    const loaded = loadPreferences();
    if (!loaded.exists) {
        savePreferences(DEFAULT_PREFS);
        return { ...DEFAULT_PREFS, enabledAgents: [...DEFAULT_PREFS.enabledAgents] };
    }
    if (loaded.migrationRequired) savePreferences(loaded.prefs);
    return loaded.prefs;
}

export function loadPreferences(initialAgent: AgentTarget = 'claude-code'): {
    prefs: AwmPreferences;
    exists: boolean;
    migrationRequired: boolean;
} {
    const file = prefsFile();
    if (!fs.existsSync(file)) {
        const prefs = { ...DEFAULT_PREFS, defaultAgent: initialAgent, enabledAgents: [initialAgent] };
        return { prefs, exists: false, migrationRequired: true };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(`${file} is not valid JSON. Fix it manually, then re-run.`);
    }
    const result = normalizePreferences(parsed);
    return { prefs: result.prefs, exists: true, migrationRequired: result.changed };
}

export function savePreferences(prefs: AwmPreferences): void {
    const normalized = normalizePreferences(prefs).prefs;
    const file = prefsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(normalized, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });
    fs.renameSync(temp, file);
}

export function enableAgent(prefs: AwmPreferences, agent: AgentTarget): AwmPreferences {
    return prefs.enabledAgents.includes(agent)
        ? prefs
        : { ...prefs, enabledAgents: [...prefs.enabledAgents, agent] };
}
```

Importar `isAgentTarget` desde el provider creado en Task 2; mientras ese task no exista, declarar y exportar temporalmente el type guard junto a `AgentTarget` en `cli/src/providers/index.ts`.

- [ ] **Step 4: Escribir los tests rojos del resolver**

Crear `cli/tests/core/agent-targets.test.ts`:

```ts
import { resolveAgentTargets } from '../../src/core/agent-targets';

const prefs = {
    defaultAgent: 'claude-code' as const,
    enabledAgents: ['claude-code', 'opencode', 'codex'] as const,
    installMethod: 'symlink' as const,
    defaultScope: 'local' as const,
};

it('targets every enabled agent when --agent is absent', () => {
    expect(resolveAgentTargets({ prefs, explicit: undefined }))
        .toEqual(['claude-code', 'opencode', 'codex']); // verifies R12, R20
});

it('preserves an exact explicit enabled subset', () => {
    expect(resolveAgentTargets({ prefs, explicit: 'codex,claude-code' }))
        .toEqual(['codex', 'claude-code']); // verifies R13
});

it('rejects an explicit disabled provider', () => {
    expect(() => resolveAgentTargets({
        prefs: { ...prefs, enabledAgents: ['claude-code'] },
        explicit: 'codex',
    })).toThrow('codex is not enabled; run awm init --agent codex');
});
```

- [ ] **Step 5: Implementar el resolver puro**

Crear `cli/src/core/agent-targets.ts`:

```ts
import type { AwmPreferences } from '../utils/config';
import { AgentTarget, isAgentTarget } from '../providers';

export function resolveAgentTargets(input: {
    prefs: Pick<AwmPreferences, 'enabledAgents'>;
    explicit?: string;
}): AgentTarget[] {
    if (input.explicit === undefined) return [...input.prefs.enabledAgents];
    const raw = input.explicit.split(',').map((value) => value.trim()).filter(Boolean);
    if (raw.length === 0) throw new Error('--agent requires at least one provider');
    const agents = Array.from(new Set(raw));
    for (const agent of agents) {
        if (!isAgentTarget(agent)) throw new Error(`Invalid agent "${agent}".`);
        if (!input.prefs.enabledAgents.includes(agent)) {
            throw new Error(`${agent} is not enabled; run awm init --agent ${agent}`);
        }
    }
    return agents as AgentTarget[];
}
```

- [ ] **Step 6: Ejecutar los tests del task**

Run: `cd cli && npm test -- --runTestsByPath tests/utils/config.test.ts tests/core/agent-targets.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/utils/config.ts cli/src/core/agent-targets.ts cli/src/providers/index.ts cli/tests/utils/config.test.ts cli/tests/core/agent-targets.test.ts
git commit -m "feat: track enabled agent targets"
```

### Task 2: Provider Codex con rutas call-time y gate de versión

_Requirements: R1, R2, R7, R19, R19.1_

**Files:**
- Modify: `cli/src/providers/index.ts`
- Create: `cli/src/core/provider-version.ts`
- Modify: `cli/tests/providers/index.test.ts`
- Create: `cli/tests/core/provider-version.test.ts`
- Modify: `cli/src/commands/hooks/resync.ts`
- Modify: `cli/src/commands/registry/index.ts`
- Modify: `cli/src/core/bundle-install.ts`
- Modify: `cli/src/core/context/orchestrator.ts`
- Modify: `cli/src/core/context/project-constitution-inject.ts`
- Modify: `cli/src/core/context/regenerate.ts`
- Modify: `cli/src/core/diagnostics/context.ts`
- Modify: `cli/src/core/init/steps.ts`
- Modify: `cli/src/core/profile.ts`
- Modify: `cli/src/core/skill-integrity.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Escribir los tests rojos del provider**

Agregar a `cli/tests/providers/index.test.ts`:

```ts
it('resolves Codex paths from the current HOME at call time', () => {
    const first = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-a-'));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-b-'));
    process.env.HOME = first;
    expect(getTargetPath('skill', 'codex', 'global'))
        .toBe(path.join(first, '.agents/skills')); // verifies R7
    process.env.HOME = second;
    expect(getTargetPath('agent', 'codex', 'global'))
        .toBe(path.join(second, '.codex/agents')); // verifies R8 path contract
});

it('keeps Claude Code and OpenCode destinations unchanged', () => {
    expect(getTargetPath('skill', 'claude-code', 'global'))
        .toBe(path.join(process.env.HOME!, '.claude/skills')); // verifies R19
    expect(getTargetPath('skill', 'opencode', 'global'))
        .toBe(path.join(process.env.HOME!, '.agents/skills')); // verifies R19.1
});
```

- [ ] **Step 2: Implementar el catálogo de providers como factory**

En `cli/src/providers/index.ts`, reemplazar la constante evaluada al importar por:

```ts
export const AGENT_TARGETS = ['antigravity', 'opencode', 'claude-code', 'codex'] as const;
export type AgentTarget = typeof AGENT_TARGETS[number];
export type RendererId = 'link' | 'codex-agent-toml';

export function isAgentTarget(value: unknown): value is AgentTarget {
    return typeof value === 'string' &&
        (AGENT_TARGETS as readonly string[]).includes(value);
}

export function providers(): Record<AgentTarget, ProviderConfig> {
    const home = homeDir();
    const awm = awmHome();
    return {
        antigravity: {
            label: 'Antigravity',
            skill: { global: path.join(home, '.gemini/antigravity/skills'), local: '.agent/skills', renderer: 'link' },
            workflow: { global: path.join(home, '.gemini/antigravity/global_workflows'), local: '.agent/workflows', renderer: 'link' },
            agent: null,
        },
        opencode: {
            label: 'OpenCode',
            skill: { global: path.join(home, '.agents/skills'), local: '.agents/skills', renderer: 'link' },
            workflow: null,
            agent: { global: path.join(home, '.config/opencode/agents'), local: '.agents/profiles', renderer: 'link' },
            injection: {
                type: 'config-instructions',
                configPath: path.join(home, '.config/opencode/opencode.json'),
                field: 'instructions',
            },
        },
        'claude-code': {
            label: 'Claude Code',
            skill: { global: path.join(home, '.claude/skills'), local: '.claude/skills', renderer: 'link' },
            workflow: null,
            agent: { global: path.join(home, '.claude/agents'), local: '.claude/agents', renderer: 'link' },
            hooks: {
                type: 'cc-settings-merge',
                settingsPath: path.join(home, '.claude/settings.json'),
                scriptsDir: path.join(awm, 'hooks/claude-code'),
                matcher: 'startup|clear|compact',
                eventName: 'SessionStart',
            },
            injection: { type: 'cc-settings-merge' },
        },
        codex: {
            label: 'Codex',
            minimumVersion: '0.145.0',
            versionCommand: { command: 'codex', args: ['--version'] },
            skill: { global: path.join(home, '.agents/skills'), local: '.agents/skills', renderer: 'link' },
            workflow: null,
            agent: { global: path.join(home, '.codex/agents'), local: '.codex/agents', renderer: 'codex-agent-toml' },
            hooks: {
                type: 'codex-hooks-json',
                settingsPath: path.join(home, '.codex/hooks.json'),
                scriptsDir: path.join(awm, 'hooks/codex'),
                matcher: 'startup|resume|clear|compact',
                eventName: 'SessionStart',
            },
            injection: {
                type: 'managed-agents-md',
                globalPath: path.join(home, '.codex/AGENTS.md'),
                localFile: 'AGENTS.md',
            },
        },
    };
}

export function providerFor(agent: AgentTarget): ProviderConfig {
    return providers()[agent];
}
```

Añadir `renderer: RendererId` a `ArtifactConfig`, las variantes `codex-hooks-json` y `managed-agents-md` a sus uniones y los campos opcionales `minimumVersion`/`versionCommand` a `ProviderConfig`. Cambiar todos los consumidores listados en **Files** de `PROVIDERS[agent]` a `providerFor(agent)` y los recorridos de `Object.keys(PROVIDERS)` a `AGENT_TARGETS`.

- [ ] **Step 3: Ejecutar los tests del provider**

Run: `cd cli && npm test -- --runTestsByPath tests/providers/index.test.ts tests/providers/hooks-config.test.ts tests/providers/injection-config.test.ts`

Expected: PASS; los tests de Claude Code y OpenCode siguen verdes.

- [ ] **Step 4: Escribir los tests rojos del gate de versión**

Crear `cli/tests/core/provider-version.test.ts`:

```ts
import { assertProviderSupported } from '../../src/core/provider-version';

it('accepts the current stable Codex line', () => {
    const exec = jest.fn(() => Buffer.from('codex-cli 0.145.0\n'));
    expect(assertProviderSupported('codex', exec)).toEqual({
        provider: 'codex',
        version: '0.145.0',
    }); // verifies R2
    expect(exec).toHaveBeenCalledWith('codex', ['--version'], expect.any(Object));
});

it.each([
    [Buffer.from('codex-cli 0.144.9\n'), 'requires Codex >= 0.145.0'],
    [Buffer.from('unknown\n'), 'could not parse Codex version'],
])('rejects unsupported output without mutation', (output, message) => {
    expect(() => assertProviderSupported('codex', () => output)).toThrow(message);
});

it('reports a missing Codex binary distinctly', () => {
    const missing = Object.assign(new Error('spawnSync codex ENOENT'), { code: 'ENOENT' });
    expect(() => assertProviderSupported('codex', () => { throw missing; }))
        .toThrow('Codex is not installed or not available on PATH');
});
```

- [ ] **Step 5: Implementar el gate con `execFileSync` inyectable**

Crear `cli/src/core/provider-version.ts`:

```ts
import { execFileSync } from 'child_process';
import { AgentTarget, providerFor } from '../providers';
import { compareSemver } from './versioning';

type Exec = typeof execFileSync;

export function assertProviderSupported(
    agent: AgentTarget,
    exec: Exec = execFileSync,
): { provider: AgentTarget; version: string | null } {
    const provider = providerFor(agent);
    if (!provider.versionCommand || !provider.minimumVersion) {
        return { provider: agent, version: null };
    }
    let output: string;
    try {
        output = exec(provider.versionCommand.command, provider.versionCommand.args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
        }).toString();
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            throw new Error('Codex is not installed or not available on PATH. Install the current stable @openai/codex release, then re-run.');
        }
        throw new Error(`Codex version probe failed: ${(error as Error).message}`);
    }
    const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
    if (!match) throw new Error(`could not parse Codex version from: ${output.trim()}`);
    if (compareSemver(match[1], provider.minimumVersion) < 0) {
        throw new Error(`requires Codex >= ${provider.minimumVersion}; found ${match[1]}`);
    }
    return { provider: agent, version: match[1] };
}
```

- [ ] **Step 6: Ejecutar el task completo y build**

Run: `cd cli && npm test -- --runTestsByPath tests/providers/index.test.ts tests/core/provider-version.test.ts && npm run build`

Expected: PASS y TypeScript sin errores.

- [ ] **Step 7: Commit**

```bash
git add cli/src/providers cli/src/core/provider-version.ts cli/src/commands/hooks/resync.ts cli/src/commands/registry/index.ts cli/src/core/bundle-install.ts cli/src/core/context cli/src/core/diagnostics/context.ts cli/src/core/init/steps.ts cli/src/core/profile.ts cli/src/core/skill-integrity.ts cli/src/index.ts cli/tests/providers cli/tests/core/provider-version.test.ts
git commit -m "feat: add call-time Codex provider"
```

### Task 3: Bloques administrados y entrega de contexto Codex

_Requirements: R3, R4, R5, R6, R17_

**Files:**
- Create: `cli/src/core/atomic-file.ts`
- Create: `cli/src/core/context/managed-block.ts`
- Create: `cli/src/core/context/strategies/codex-agents.ts`
- Modify: `cli/src/core/context/strategies/strategy.ts`
- Modify: `cli/src/core/context/orchestrator.ts`
- Modify: `cli/src/core/init/steps.ts`
- Create: `cli/tests/core/context/managed-block.test.ts`
- Create: `cli/tests/core/context/strategies/codex-agents.test.ts`

- [ ] **Step 1: Escribir los tests rojos del merge estricto**

Crear `cli/tests/core/context/managed-block.test.ts`:

```ts
import { mergeManagedBlock } from '../../../src/core/context/managed-block';

const body = 'Use AWM through the development-process skill.';

it('appends exactly one block and preserves user content byte-for-byte', () => {
    const original = '# My rules\n\nKeep this.\n';
    const merged = mergeManagedBlock(original, body);
    expect(merged).toContain(original);
    expect(merged.match(/<!-- AWM:START -->/g)).toHaveLength(1); // verifies R4
    expect(mergeManagedBlock(merged, body)).toBe(merged);
});

it.each([
    ['<!-- AWM:START -->\nbody\n', 'unmatched'],
    ['<!-- AWM:END -->\n', 'unmatched'],
    ['<!-- AWM:START -->\na\n<!-- AWM:END -->\n<!-- AWM:START -->\nb\n<!-- AWM:END -->', 'duplicate'],
    ['<!-- AWM:START -->\n<!-- AWM:START -->\n<!-- AWM:END -->\n<!-- AWM:END -->', 'nested'],
])('rejects ambiguous markers', (input, message) => {
    expect(() => mergeManagedBlock(input, body)).toThrow(message); // verifies R17
});
```

- [ ] **Step 2: Implementar escritura atómica y merge**

Crear `cli/src/core/atomic-file.ts`:

```ts
import fs from 'fs';
import path from 'path';

export function writeFileAtomic(file: string, content: string, mode = 0o644): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(temp, content, { encoding: 'utf8', mode });
    fs.renameSync(temp, file);
}
```

Crear `cli/src/core/context/managed-block.ts`:

```ts
export const AWM_START = '<!-- AWM:START -->';
export const AWM_END = '<!-- AWM:END -->';

export function mergeManagedBlock(original: string, body: string): string {
    const starts = original.split(AWM_START).length - 1;
    const ends = original.split(AWM_END).length - 1;
    if (starts !== ends) throw new Error('AWM managed block has unmatched markers');
    if (starts > 1) throw new Error('AWM managed block has duplicate markers');
    const start = original.indexOf(AWM_START);
    const end = original.indexOf(AWM_END);
    if (start >= 0 && original.indexOf(AWM_START, start + AWM_START.length) >= 0) {
        throw new Error('AWM managed block has nested markers');
    }
    const block = `${AWM_START}\n${body.trimEnd()}\n${AWM_END}`;
    if (start < 0) {
        const separator = original.length === 0 || original.endsWith('\n\n') ? '' :
            original.endsWith('\n') ? '\n' : '\n\n';
        return `${original}${separator}${block}\n`;
    }
    const after = end + AWM_END.length;
    return `${original.slice(0, start)}${block}${original.slice(after)}`;
}
```

- [ ] **Step 3: Escribir los tests rojos de la estrategia Codex**

Crear `cli/tests/core/context/strategies/codex-agents.test.ts`:

```ts
it('injects global AWM bootstrap without changing user rules', () => {
    fs.mkdirSync(path.join(tmpHome, '.codex'), { recursive: true });
    const file = path.join(tmpHome, '.codex/AGENTS.md');
    fs.writeFileSync(file, '# Personal\n\nDo not delete.\n');
    const strategy = new CodexAgentsStrategy();
    strategy.injectGlobal({ markdown: '# AWM\n\nUse `development-process`.' });
    const result = fs.readFileSync(file, 'utf8');
    expect(result).toContain('# Personal\n\nDo not delete.\n'); // verifies R4
    expect(result).toContain('Use `development-process`.'); // verifies R3
});

it('injects project constitution guidance without owning the whole AGENTS.md', () => {
    const project = path.join(tmpWork, 'repo');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'CONSTITUTION.md'), '# Rules\n');
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Repo-owned rules\n');
    new CodexAgentsStrategy().injectProject(project);
    const result = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
    expect(result).toContain('# Repo-owned rules'); // verifies R5
    expect(result).toContain('Read and obey `CONSTITUTION.md` before work.'); // verifies R6
});
```

- [ ] **Step 4: Implementar la estrategia Codex**

Crear `cli/src/core/context/strategies/codex-agents.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { providerFor } from '../../../providers';
import { writeFileAtomic } from '../../atomic-file';
import { mergeManagedBlock } from '../managed-block';

const PROJECT_BODY = [
    '## AWM project guidance',
    '',
    'This repository is managed by AWM.',
    'Read and obey `CONSTITUTION.md` before work when that file exists.',
    'Use `.awm/profile.json` as the durable extension declaration and run `awm sync` to reconstruct generated artifacts.',
    'Run the repository verification commands declared in `AGENTS.md`, `CONSTITUTION.md`, or `.awm/sensors.json` before completion.',
].join('\n');

export class CodexAgentsStrategy {
    injectGlobal(context: { markdown: string }): 'injected' | 'unchanged' {
        const injection = providerFor('codex').injection;
        if (!injection || injection.type !== 'managed-agents-md') {
            throw new Error('Codex managed AGENTS.md injection is not configured');
        }
        return this.mergeFile(injection.globalPath, context.markdown);
    }

    injectProject(projectRoot: string): 'injected' | 'unchanged' {
        return this.mergeFile(path.join(projectRoot, 'AGENTS.md'), PROJECT_BODY);
    }

    private mergeFile(file: string, body: string): 'injected' | 'unchanged' {
        const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const merged = mergeManagedBlock(original, body);
        if (merged === original) return 'unchanged';
        writeFileAtomic(file, merged);
        return 'injected';
    }
}
```

Conectar esta estrategia en `cli/src/core/context/orchestrator.ts` para `managed-agents-md`, y hacer que `stepContextInjection` instale el bloque global mientras `stepConstitutionInjection` instale/actualice el bloque del proyecto para Codex aunque `CONSTITUTION.md` aún no exista.

- [ ] **Step 5: Ejecutar tests y verificar que OpenCode siga usando `instructions[]`**

Run: `cd cli && npm test -- --runTestsByPath tests/core/context/managed-block.test.ts tests/core/context/strategies/codex-agents.test.ts tests/core/context/strategies/config-instructions.test.ts tests/core/context/project-constitution-inject.test.ts`

Expected: PASS; el test OpenCode confirma que `opencode.json` sigue preservando campos ajenos.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/atomic-file.ts cli/src/core/context cli/src/core/init/steps.ts cli/tests/core/context
git commit -m "feat: inject managed Codex guidance"
```

### Task 4: Render de agente canónico a TOML Codex

_Requirements: R8, R9, R17_

**Files:**
- Create: `cli/src/core/renderers/canonical-agent.ts`
- Create: `cli/src/core/renderers/codex-agent.ts`
- Create: `cli/tests/core/renderers/canonical-agent.test.ts`
- Create: `cli/tests/core/renderers/codex-agent.test.ts`

- [ ] **Step 1: Escribir tests rojos de validación y render determinista**

Crear `cli/tests/core/renderers/codex-agent.test.ts`:

```ts
import { renderCodexAgent } from '../../../src/core/renderers/codex-agent';

const canonical = `---
name: development-process
description: Orchestrates the development lifecycle
mode: primary
---

# Development Process

Invoke the \`development-process\` skill before implementation.
`;

it('renders deterministic native Codex TOML', () => {
    expect(renderCodexAgent(canonical)).toBe(
`name = "development-process"
description = "Orchestrates the development lifecycle"
developer_instructions = """
# Development Process

Invoke the \`development-process\` skill before implementation.
"""
`); // verifies R8, R9
});

it.each([
    ['---\nname: Bad Name\ndescription: x\n---\nbody', 'invalid agent name'],
    ['---\nname: ok\ndescription:\n---\nbody', 'non-empty description'],
    ['---\nname: ok\ndescription: x\n---\n', 'non-empty instruction body'],
    ['name: ok', 'frontmatter'],
])('rejects invalid canonical agents before rendering', (source, message) => {
    expect(() => renderCodexAgent(source)).toThrow(message); // verifies R17
});
```

- [ ] **Step 2: Ejecutar el test para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/core/renderers/codex-agent.test.ts`

Expected: FAIL porque el renderer no existe.

- [ ] **Step 3: Implementar parser estricto y renderer**

Crear `cli/src/core/renderers/canonical-agent.ts`:

```ts
export type CanonicalAgent = {
    name: string;
    description: string;
    instructions: string;
};

export function parseCanonicalAgent(source: string): CanonicalAgent {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error('canonical agent requires YAML frontmatter');
    const fields = new Map<string, string>();
    for (const line of match[1].split(/\r?\n/)) {
        const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
        if (!field) throw new Error(`invalid canonical agent frontmatter line: ${line}`);
        fields.set(field[1], field[2].replace(/^(['"])(.*)\1$/, '$2').trim());
    }
    const name = fields.get('name') ?? '';
    const description = fields.get('description') ?? '';
    const instructions = match[2].trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('invalid agent name');
    if (!description) throw new Error('canonical agent requires a non-empty description');
    if (!instructions) throw new Error('canonical agent requires a non-empty instruction body');
    return { name, description, instructions };
}
```

Crear `cli/src/core/renderers/codex-agent.ts`:

```ts
import { parseCanonicalAgent } from './canonical-agent';

function tomlString(value: string): string {
    return JSON.stringify(value);
}

function tomlMultiline(value: string): string {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
    return `"""\n${escaped}\n"""`;
}

export function renderCodexAgent(source: string): string {
    const agent = parseCanonicalAgent(source);
    return [
        `name = ${tomlString(agent.name)}`,
        `description = ${tomlString(agent.description)}`,
        `developer_instructions = ${tomlMultiline(agent.instructions)}`,
        '',
    ].join('\n');
}
```

- [ ] **Step 4: Añadir round-trip básico con el agente real fixture**

En `cli/tests/core/renderers/canonical-agent.test.ts`, copiar el contenido canónico mínimo del agente `development-process` en un fixture temporal y verificar:

```ts
it('ignores provider-only mode while retaining canonical instructions', () => {
    const parsed = parseCanonicalAgent(canonicalWithModePrimary);
    expect(parsed).toEqual({
        name: 'development-process',
        description: 'Use as agent profile to orchestrate the development lifecycle',
        instructions: expect.stringContaining('You do NOT write code directly.'),
    }); // verifies R8, R9
});
```

- [ ] **Step 5: Ejecutar tests y build**

Run: `cd cli && npm test -- --runTestsByPath tests/core/renderers/canonical-agent.test.ts tests/core/renderers/codex-agent.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/renderers cli/tests/core/renderers
git commit -m "feat: render canonical agents for Codex"
```

### Task 5: Planner multi-provider, dominio compartido y ownership persistente

_Requirements: R12, R13, R14, R15, R15.1, R16_

**Files:**
- Create: `cli/src/core/artifact-state.ts`
- Create: `cli/src/core/install-planner.ts`
- Modify: `cli/src/core/bundle-install.ts`
- Create: `cli/tests/core/artifact-state.test.ts`
- Create: `cli/tests/core/install-planner.test.ts`
- Modify: `cli/tests/core/bundle-install.test.ts`

- [ ] **Step 1: Escribir los tests rojos del planner**

Crear `cli/tests/core/install-planner.test.ts`:

```ts
it('deduplicates the OpenCode/Codex physical skill write and reports both owners', () => {
    const plan = planInstall({
        artifacts: [skillArtifact('development-process')],
        selectedAgents: ['opencode', 'codex'],
        enabledAgents: ['claude-code', 'opencode', 'codex'],
        scope: 'global',
        projectRoot: tmpWork,
        method: 'symlink',
    });
    expect(plan.operations).toHaveLength(1); // verifies R15
    expect(plan.operations[0].owners).toEqual(['opencode', 'codex']); // verifies R15.1
});

it('aborts a skill change for an incomplete shared target group before writes', () => {
    expect(() => planInstall({
        artifacts: [skillArtifact('development-process')],
        selectedAgents: ['codex'],
        enabledAgents: ['opencode', 'codex'],
        scope: 'global',
        projectRoot: tmpWork,
        method: 'symlink',
    })).toThrow('select the complete shared target group: opencode,codex'); // verifies R14
});

it('does not apply the shared-domain restriction to independently addressed agents', () => {
    const plan = planInstall({
        artifacts: [agentArtifact('development-process')],
        selectedAgents: ['codex'],
        enabledAgents: ['opencode', 'codex'],
        scope: 'global',
        projectRoot: tmpWork,
        method: 'symlink',
    });
    expect(plan.operations[0].owners).toEqual(['codex']); // verifies R13
});

it('retains a target while a non-selected enabled owner remains', () => {
    const result = planRemoval({
        records: [recordOwnedBy('development-process', ['opencode', 'codex'])],
        selectedAgents: ['codex'],
        enabledAgents: ['opencode', 'codex'],
        artifactNames: ['development-process'],
    });
    expect(result.operations).toEqual([]);
    expect(result.records[0].owners).toEqual(['opencode']); // verifies R16
});
```

- [ ] **Step 2: Definir estado administrado atómico**

Crear `cli/src/core/artifact-state.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { AgentTarget, ArtifactType, RendererId, Scope } from '../providers';
import { awmHome } from './paths';
import { writeFileAtomic } from './atomic-file';

export type ManagedArtifactRecord = {
    name: string;
    type: ArtifactType;
    scope: Scope;
    targetPath: string;
    sourcePath: string;
    renderer: RendererId;
    owners: AgentTarget[];
};

export function artifactStateFile(): string {
    return path.join(awmHome(), 'state', 'artifacts.json');
}

export function readArtifactState(file = artifactStateFile()): ManagedArtifactRecord[] {
    if (!fs.existsSync(file)) return [];
    let value: unknown;
    try {
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(`${file} is not valid JSON. Fix it manually, then re-run.`);
    }
    if (!Array.isArray(value)) throw new Error(`${file} must contain an array`);
    return value as ManagedArtifactRecord[];
}

export function writeArtifactState(records: ManagedArtifactRecord[], file = artifactStateFile()): void {
    const ordered = [...records].sort((a, b) => a.targetPath.localeCompare(b.targetPath));
    writeFileAtomic(file, JSON.stringify(ordered, null, 2) + '\n', 0o600);
}
```

- [ ] **Step 3: Implementar las estructuras y reglas puras del planner**

Crear `cli/src/core/install-planner.ts` con estas interfaces y funciones:

```ts
export type ArtifactIntent = {
    name: string;
    installName: string;
    type: ArtifactType;
    sourcePath: string;
};

export type PlannedOperation = ManagedArtifactRecord & {
    method: 'symlink' | 'copy';
    output: 'link' | 'codex-agent-toml';
};

export type InstallPlan = {
    operations: PlannedOperation[];
    records: ManagedArtifactRecord[];
    reports: { owner: AgentTarget; targetPath: string; action: 'install' | 'retain' }[];
};

function physicalTarget(intent: ArtifactIntent, agent: AgentTarget, scope: Scope, projectRoot: string): {
    targetPath: string;
    renderer: RendererId;
} {
    const config = providerFor(agent)[intent.type];
    if (!config) throw new Error(`${intent.type}s are not supported by ${providerFor(agent).label}`);
    const dir = scope === 'local' ? path.join(projectRoot, config.local) : config.global;
    const filename = config.renderer === 'codex-agent-toml'
        ? `${path.parse(intent.installName).name}.toml`
        : intent.installName;
    return { targetPath: path.join(dir, filename), renderer: config.renderer };
}

function assertCompleteSharedGroup(
    intent: ArtifactIntent,
    selected: AgentTarget[],
    enabled: AgentTarget[],
    scope: Scope,
    projectRoot: string,
): void {
    if (intent.type !== 'skill') return;
    for (const agent of selected) {
        const target = physicalTarget(intent, agent, scope, projectRoot).targetPath;
        const group = enabled.filter((candidate) =>
            physicalTarget(intent, candidate, scope, projectRoot).targetPath === target);
        if (group.some((candidate) => !selected.includes(candidate))) {
            throw new Error(`Shared skill target cannot diverge; select the complete shared target group: ${group.join(',')}`);
        }
    }
}
```

`planInstall` debe ejecutar `assertCompleteSharedGroup` para todos los intents antes de producir operaciones, agrupar por `targetPath + renderer + sourcePath`, unir owners sin duplicados y emitir un report por owner. `planRemoval` debe calcular owners restantes antes de producir un unlink; sólo crea una operación de borrado cuando no queda ningún owner habilitado.

- [ ] **Step 4: Integrar expansión de bundles sin escribir**

Exportar `bundleArtifacts` desde `cli/src/core/bundle-install.ts` como `expandBundleArtifacts`, hacer que reciba el closure ya resuelto y retorne `ArtifactIntent[]`. Mantener `installBundle` temporalmente como façade:

```ts
export function installBundle(opts: InstallBundleOptions): InstallSummary {
    const intents = expandBundleArtifacts(opts);
    const enabledAgents = getPreferences().enabledAgents;
    const plan = planInstall({
        artifacts: intents,
        selectedAgents: opts.agents,
        enabledAgents,
        scope: opts.scopeOverride ?? defaultScopeForBundle(
            opts.bundles.find((bundle) => bundle.name === opts.bundleName)?.scope ?? 'baseline',
        ),
        projectRoot: opts.projectRoot,
        method: opts.method,
    });
    return applyInstallPlan(plan);
}
```

El `applyInstallPlan` de este façade se implementa en Task 6. Hasta entonces, usar un stub inyectable en tests del planner y conservar los tests legacy en rojo únicamente dentro de la rama de trabajo de ese task.

- [ ] **Step 5: Ejecutar tests del planner y estado**

Run: `cd cli && npm test -- --runTestsByPath tests/core/artifact-state.test.ts tests/core/install-planner.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/artifact-state.ts cli/src/core/install-planner.ts cli/src/core/bundle-install.ts cli/tests/core/artifact-state.test.ts cli/tests/core/install-planner.test.ts cli/tests/core/bundle-install.test.ts
git commit -m "feat: plan shared multi-agent artifacts"
```

### Task 6: Aplicación transaccional, backups y rollback

_Requirements: R15, R17, R24.1, R25_

**Files:**
- Create: `cli/src/core/install-transaction.ts`
- Create: `cli/src/commands/backup.ts`
- Modify: `cli/src/core/executor.ts`
- Modify: `cli/src/core/bundle-install.ts`
- Modify: `cli/src/index.ts`
- Create: `cli/tests/core/install-transaction.test.ts`
- Create: `cli/tests/commands/backup.test.ts`
- Modify: `cli/tests/core/executor.test.ts`
- Modify: `cli/tests/core/bundle-install.test.ts`

- [ ] **Step 1: Escribir tests rojos de orden, backup y rollback**

Crear `cli/tests/core/install-transaction.test.ts`:

```ts
it('validates and backs up every target before the first replacement', () => {
    const calls: string[] = [];
    applyInstallPlan(planWithTwoTargets(), {
        validate: (op) => calls.push(`validate:${op.name}`),
        backup: (op) => calls.push(`backup:${op.name}`),
        stage: (op) => calls.push(`stage:${op.name}`),
        replace: (op) => calls.push(`replace:${op.name}`),
        verify: (op) => calls.push(`verify:${op.name}`),
        rollback: (op) => calls.push(`rollback:${op.name}`),
    });
    expect(calls.indexOf('validate:a')).toBeLessThan(calls.indexOf('backup:a'));
    expect(calls.indexOf('backup:b')).toBeLessThan(calls.indexOf('replace:a')); // verifies R24.1
});

it('restores already replaced targets when verification fails', () => {
    const original = path.join(tmpWork, 'target');
    fs.mkdirSync(original, { recursive: true });
    fs.writeFileSync(path.join(original, 'sentinel'), 'before');
    const plan = planThatFailsSecondVerification(original);

    expect(() => applyInstallPlan(plan)).toThrow('verification failed');
    expect(fs.readFileSync(path.join(original, 'sentinel'), 'utf8')).toBe('before'); // verifies R25
});

it('never removes the live target before staging succeeds', () => {
    const target = path.join(tmpWork, 'target');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'sentinel'), 'before');
    expect(() => installArtifact(missingSource, target, 'copy')).toThrow('Source path does not exist');
    expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('before'); // verifies R17
});
```

- [ ] **Step 2: Implementar staging seguro en el executor**

Cambiar `cli/src/core/executor.ts` para no borrar el destino antes del staging:

```ts
export function stageArtifact(
    sourcePath: string,
    targetPath: string,
    method: 'symlink' | 'copy',
): string {
    if (!fs.existsSync(sourcePath)) throw new Error(`Source path does not exist: ${sourcePath}`);
    const parent = path.dirname(targetPath);
    fs.mkdirSync(parent, { recursive: true });
    const staged = path.join(parent, `.${path.basename(targetPath)}.${process.pid}.staged`);
    fs.rmSync(staged, { recursive: true, force: true });
    if (method === 'symlink') fs.symlinkSync(sourcePath, staged, 'dir');
    else fs.cpSync(sourcePath, staged, { recursive: true });
    return staged;
}

export function replaceArtifact(staged: string, targetPath: string): void {
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.renameSync(staged, targetPath);
}
```

Mantener `installArtifact` como wrapper `stageArtifact` + `replaceArtifact` para compatibilidad de callers no migrados, pero el planner debe usar la transacción.

- [ ] **Step 3: Implementar la transacción**

Crear `cli/src/core/install-transaction.ts`:

```ts
export type TransactionDeps = {
    validate(op: PlannedOperation): void;
    backup(op: PlannedOperation, backupDir: string): string | null;
    stage(op: PlannedOperation): string;
    replace(op: PlannedOperation, staged: string): void;
    verify(op: PlannedOperation): void;
    rollback(op: PlannedOperation, backup: string | null): void;
};

export function applyInstallPlan(
    plan: InstallPlan,
    deps: TransactionDeps = defaultTransactionDeps(),
): InstallSummary {
    for (const op of plan.operations) deps.validate(op);
    const backupDir = path.join(
        awmHome(),
        'backups',
        new Date().toISOString().replace(/[:.]/g, '-'),
    );
    const backups = new Map<PlannedOperation, string | null>();
    for (const op of plan.operations) backups.set(op, deps.backup(op, backupDir));
    const staged = new Map<PlannedOperation, string>();
    for (const op of plan.operations) staged.set(op, deps.stage(op));
    const replaced: PlannedOperation[] = [];
    try {
        for (const op of plan.operations) {
            deps.replace(op, staged.get(op)!);
            replaced.push(op);
        }
        for (const op of plan.operations) deps.verify(op);
        writeArtifactState(plan.records);
    } catch (error) {
        for (const op of [...replaced].reverse()) {
            try {
                deps.rollback(op, backups.get(op) ?? null);
            } catch {
                // best-effort: retain the original failure; the backup path remains available for manual recovery
            }
        }
        throw error;
    }
    return {
        installed: plan.reports
            .filter((report) => report.action === 'install')
            .map((report) => `${path.basename(report.targetPath)} → ${report.owner}`),
        skipped: [],
    };
}
```

`defaultTransactionDeps` debe:

- validar source y renderer sin tocar destino;
- copiar targets existentes a `backupDir` antes de cualquier replace;
- renderizar `codex-agent-toml` a un archivo staged y usar staging de directorio para links/copies;
- verificar symlink/copy o contenido TOML después de reemplazar;
- restaurar desde backup o remover el target nuevo si no existía;
- no incluir contenidos ni variables de entorno en logs.

La transacción debe escribir `manifest.json` dentro de `backupDir` con un ID, el path exacto de cada target, si existía y el backup relativo. `InstallSummary` debe incluir `transactionId` y `modifiedFiles`.

Además, exportar una sesión de backup general para mutations que hoy se aplican por adapters:

```ts
export type BackupSession = {
    transactionId: string;
    targetPaths: string[];
    commit(): void;
    rollback(): void;
};

export function beginBackupSession(targetPaths: string[]): BackupSession {
    const unique = Array.from(new Set(targetPaths.map((target) => path.resolve(target)));
    if (unique.some((target) => target === path.parse(target).root)) {
        throw new Error('refusing to back up a filesystem root');
    }
    const transactionId = new Date().toISOString().replace(/[:]/g, '-');
    const backupDir = path.join(awmHome(), 'backups', transactionId);
    const manifest = createBackupManifest(unique, backupDir);
    writeBackupManifest(backupDir, manifest);
    return {
        transactionId,
        targetPaths: unique,
        commit: () => markBackupCommitted(backupDir),
        rollback: () => restoreBackup(transactionId),
    };
}
```

`createBackupManifest` debe copiar todos los targets existentes antes de retornar. Esta sesión envuelve preferencias, provider configs y artefactos durante `init`; `applyInstallPlan` puede reutilizar una sesión existente para no crear backups parciales anidados.
Crear `backupDir` con mode `0700` y `manifest.json` con mode `0600`; el manifest contiene paths/hashes, nunca contenido ni variables de entorno.

- [ ] **Step 4: Implementar restore explícito y acotado**

En `cli/src/core/install-transaction.ts`, exportar:

```ts
export function restoreBackup(transactionId: string): { restored: string[] } {
    if (!/^\d{4}-\d{2}-\d{2}T[0-9A-Za-z.-]+$/.test(transactionId)) {
        throw new Error('invalid backup transaction id');
    }
    const root = path.join(awmHome(), 'backups');
    const dir = path.join(root, transactionId);
    if (!dir.startsWith(`${root}${path.sep}`)) throw new Error('backup path escapes AWM backup root');
    const manifest = readBackupManifest(path.join(dir, 'manifest.json'));
    const restored: string[] = [];
    for (const entry of manifest.entries) {
        restoreManifestEntry(dir, entry);
        restored.push(entry.targetPath);
    }
    return { restored };
}
```

Crear `cli/src/commands/backup.ts` como adapter Commander que delega a `restoreBackup`, y registrar `awm backup list --json` y `awm backup restore TRANSACTION_ID`. `restoreManifestEntry` sólo puede operar targets enumerados en el manifest validado; restaura el backup si existía y remueve sólo el target exacto si fue creado por la transacción.

En `cli/tests/commands/backup.test.ts`, verificar:

```ts
it('restores only manifest targets and rejects path traversal ids', () => {
    expect(() => restoreBackup('../outside')).toThrow('invalid backup transaction id');
    const result = restoreBackup(validTransactionId);
    expect(result.restored).toEqual([codexAgentsFile, preferencesFile]);
    expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe('keep'); // verifies R25
});
```

- [ ] **Step 5: Conectar bundle install y conservar reportes por owner**

Reemplazar el stub de Task 5 en `cli/src/core/bundle-install.ts` por el `applyInstallPlan` real. En tests, comprobar que un bundle `dev` para OpenCode+Codex sólo llama una vez a `replaceArtifact` por skill pero el summary contiene ambos providers.

- [ ] **Step 6: Ejecutar tests de executor, transacción, restore y bundles**

Run: `cd cli && npm test -- --runTestsByPath tests/core/executor.test.ts tests/core/install-transaction.test.ts tests/commands/backup.test.ts tests/core/bundle-install.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/executor.ts cli/src/core/install-transaction.ts cli/src/core/bundle-install.ts cli/src/commands/backup.ts cli/src/index.ts cli/tests/core/executor.test.ts cli/tests/core/install-transaction.test.ts cli/tests/commands/backup.test.ts cli/tests/core/bundle-install.test.ts
git commit -m "feat: apply artifact plans transactionally"
```

### Task 7: Hook Codex y preservación del hook Claude Code

_Requirements: R3, R3.1, R17, R18, R19_

**Files:**
- Create: `cli/src/commands/hooks/claude.ts`
- Create: `cli/src/commands/hooks/codex.ts`
- Modify: `cli/src/commands/hooks/install.ts`
- Modify: `cli/src/commands/hooks/status.ts`
- Modify: `cli/src/commands/hooks/resync.ts`
- Modify: `cli/src/commands/hooks/uninstall.ts`
- Modify: `cli/src/commands/hooks/index.ts`
- Create: `cli/tests/commands/hooks/codex.test.ts`
- Modify: `cli/tests/commands/hooks/install.test.ts`
- Modify: `cli/tests/commands/hooks/status.test.ts`
- Modify: `cli/tests/commands/hooks/resync.test.ts`

- [ ] **Step 1: Congelar el comportamiento Claude con characterization tests**

En `cli/tests/commands/hooks/install.test.ts`, agregar asserts de orden y preservación:

```ts
it('keeps the Claude SessionStart matcher and unrelated settings unchanged', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
        permissions: { allow: ['Read'] },
        hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] },
    }));
    installHook({ agent: 'claude-code', registryRoot, installMethod: 'copy' });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.permissions).toEqual({ allow: ['Read'] });
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].matcher).toBe('startup|clear|compact'); // verifies R19
});
```

- [ ] **Step 2: Extraer el adapter Claude sin cambiar su salida**

Mover el merge actual de `install.ts` a `cli/src/commands/hooks/claude.ts` y exportar:

```ts
export function installClaudeHook(options: InstallOptions): InstallResult;
export function computeClaudeHookStatus(agent: 'claude-code'): HookStatus;
export function uninstallClaudeHook(agent: 'claude-code'): UninstallResult;
```

`install.ts`, `status.ts` y `uninstall.ts` deben despachar por `getHookConfig(agent).type`; los tests existentes deben pasar sin actualizar sus snapshots salvo rutas deliberadamente movidas a `~/.awm/hooks/claude-code`.

- [ ] **Step 3: Escribir tests rojos del merge y trust de Codex**

Crear `cli/tests/commands/hooks/codex.test.ts`:

```ts
it('merges one AWM SessionStart group and preserves user hooks', () => {
    fs.writeFileSync(hooksJson, JSON.stringify({
        description: 'user hooks',
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] },
    }));
    installHook({ agent: 'codex', registryRoot, installMethod: 'copy' });
    const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    expect(cfg.description).toBe('user hooks');
    expect(cfg.hooks.Stop).toHaveLength(1);
    expect(cfg.hooks.SessionStart).toEqual([{
        matcher: 'startup|resume|clear|compact',
        hooks: [{
            type: 'command',
            command: path.join(tmpHome, '.awm/hooks/codex/session-start'),
            statusMessage: 'Loading AWM session state',
        }],
    }]); // verifies R3, R3.1
});

it('refuses duplicate AWM entries without rewriting hooks.json', () => {
    fs.writeFileSync(hooksJson, duplicateAwmHookConfig);
    const before = fs.readFileSync(hooksJson, 'utf8');
    expect(() => installHook({ agent: 'codex', registryRoot, installMethod: 'copy' }))
        .toThrow('multiple AWM SessionStart entries');
    expect(fs.readFileSync(hooksJson, 'utf8')).toBe(before); // verifies R17
});

it.each([
    [false, 'pending-trust'],
    [true, 'healthy'],
])('derives trust from a current heartbeat', (heartbeat, expected) => {
    installCodexFixture({ heartbeat });
    expect(computeHookStatus('codex').trust).toBe(expected); // verifies R18
});
```

- [ ] **Step 4: Implementar el adapter Codex**

Crear `cli/src/commands/hooks/codex.ts` con:

```ts
type CodexHooksFile = {
    description?: string;
    hooks?: Record<string, unknown>;
    [key: string]: unknown;
};

export function awmCodexEntry(scriptsDir: string): object {
    return {
        matcher: 'startup|resume|clear|compact',
        hooks: [{
            type: 'command',
            command: path.join(scriptsDir, 'session-start'),
            statusMessage: 'Loading AWM session state',
        }],
    };
}

export function installCodexHook(options: InstallOptions): InstallResult {
    const config = getHookConfig('codex');
    if (!config || config.type !== 'codex-hooks-json') {
        throw new Error('Codex hook configuration is unavailable');
    }
    const source = path.join(options.registryRoot, 'hooks/codex-session-start');
    if (!fs.existsSync(source)) {
        throw new Error(`Codex hook source missing: ${source}. Run 'awm update' first.`);
    }
    const current = readStrictJson(config.settingsPath);
    const hooks = current.hooks && typeof current.hooks === 'object'
        ? current.hooks as Record<string, unknown>
        : {};
    const entries = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
    const matches = entries.filter((entry) => isAwmCodexEntry(entry, config.scriptsDir));
    if (matches.length > 1) throw new Error('multiple AWM SessionStart entries in Codex hooks.json');
    const nextEntries = matches.length === 1
        ? entries.map((entry) => isAwmCodexEntry(entry, config.scriptsDir) ? awmCodexEntry(config.scriptsDir) : entry)
        : [...entries, awmCodexEntry(config.scriptsDir)];
    const merged = { ...current, hooks: { ...hooks, SessionStart: nextEntries } };
    const backupPath = backupManagedFile(config.settingsPath);
    syncExecutable(source, path.join(config.scriptsDir, 'session-start'), options.installMethod);
    writeFileAtomic(config.settingsPath, JSON.stringify(merged, null, 2) + '\n');
    return { status: 'installed', scriptsDir: config.scriptsDir, settingsPath: config.settingsPath, backupPath };
}
```

El status Codex debe comparar hash del script con el hash registrado en `~/.awm/hooks/codex/heartbeat.json` y retornar `pending-trust` si el hook/config existen pero no hay heartbeat, `stale` si el hash no coincide y `healthy` sólo si coincide.

- [ ] **Step 5: Actualizar resync/uninstall por estrategia**

`resyncInstalledHooks` debe recorrer `AGENT_TARGETS`, refrescar sólo hooks instalados y delegar según `config.type`. `uninstall` debe remover sólo la entrada AWM del JSON correspondiente, preservar hooks ajenos y no borrar un directorio con archivos no administrados.

- [ ] **Step 6: Ejecutar toda la suite de hooks**

Run: `cd cli && npm test -- --runTestsByPath tests/commands/hooks/install.test.ts tests/commands/hooks/status.test.ts tests/commands/hooks/resync.test.ts tests/commands/hooks/codex.test.ts`

Expected: PASS; la suite Claude original y la nueva suite Codex quedan verdes.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/hooks cli/tests/commands/hooks
git commit -m "feat: install and diagnose Codex hooks"
```

### Task 8: Integrar init, agent management y comandos multi-provider

_Requirements: R1, R2, R11, R12, R13, R14, R15, R15.1, R16, R19, R19.1, R20_

**Files:**
- Create: `cli/src/commands/agent.ts`
- Modify: `cli/src/commands/init.ts`
- Modify: `cli/src/core/init/types.ts`
- Modify: `cli/src/core/init/steps.ts`
- Modify: `cli/src/core/init/orchestrator.ts`
- Modify: `cli/src/index.ts`
- Modify: `cli/tests/commands/init.test.ts`
- Create: `cli/tests/commands/agent.test.ts`
- Create: `cli/tests/commands/multi-agent-targeting.test.ts`
- Modify: `cli/tests/core/init/steps.test.ts`
- Modify: `cli/tests/core/init/orchestrator.test.ts`

- [ ] **Step 1: Escribir el test de orden del gate y coexistencia**

En `cli/tests/commands/init.test.ts`:

```ts
it('gates Codex before preferences or provider writes', async () => {
    const calls: string[] = [];
    const code = await runInit({
        agent: 'codex',
        yes: true,
        actions: fakeActions(calls),
        assertProviderSupported: () => {
            calls.push('version-gate');
            throw new Error('requires Codex >= 0.145.0');
        },
    });
    expect(code).toBe(2);
    expect(calls).toEqual(['version-gate']); // verifies R2
    expect(fs.existsSync(path.join(tmpHome, 'preferences.json'))).toBe(false);
});

it('enables Codex without changing the existing default or Claude files', async () => {
    writePrefs({
        defaultAgent: 'claude-code',
        enabledAgents: ['claude-code', 'opencode'],
        installMethod: 'symlink',
        defaultScope: 'local',
    });
    const claudeBefore = snapshotTree(path.join(tmpHome, '.claude'));
    expect(await runInit(codexInitOptions())).toBeLessThanOrEqual(1);
    expect(readPrefs().defaultAgent).toBe('claude-code');
    expect(readPrefs().enabledAgents).toEqual(['claude-code', 'opencode', 'codex']); // verifies R11
    expect(snapshotTree(path.join(tmpHome, '.claude'))).toEqual(claudeBefore); // verifies R19
});
```

- [ ] **Step 2: Cambiar `runInit` para gatear y habilitar**

Extender `RunInitOptions` con una dependencia inyectable:

```ts
assertProviderSupported?: typeof assertProviderSupported;
```

Al comienzo de `runInit`, validar `opts.agent` con `isAgentTarget`, ejecutar el gate y después cargar preferencias:

```ts
const agent: AgentTarget = opts.agent === undefined ? 'claude-code' : requireAgentTarget(opts.agent);
const gate = opts.assertProviderSupported ?? assertProviderSupported;
try {
    gate(agent);
} catch (error) {
    process.stderr.write(`awm init: ${(error as Error).message}\n`);
    return 2;
}

const loaded = loadPreferences(agent);
const nextPreferences = opts.agent === undefined
    ? loaded.prefs
    : enableAgent(loaded.prefs, agent);
```

No guardar todavía. La llamada explícita inicial en una máquina sin preferencias usa `loadPreferences(agent)` para proponer `{ defaultAgent: agent, enabledAgents: [agent], ... }`; un archivo existente nunca cambia de default.

Antes del primer write, construir y abrir la sesión completa:

```ts
const mutationTargets = planInitMutationTargets({
    cwd,
    agent,
    preferences: nextPreferences,
    bundles: discoverAllBundles(),
});
const backup = beginBackupSession(mutationTargets);
try {
    savePreferences(nextPreferences);
    outcome = await runInitSteps(initDeps);
    if (outcome.failed > 0) throw new Error('one or more init steps failed');
    assertClaudeBaselinePreserved(beforeClaudeFacts, gatherProviderFacts('claude-code'));
    backup.commit();
    outcome.transactionId = backup.transactionId;
    outcome.modifiedFiles = backup.targetPaths;
} catch (error) {
    backup.rollback();
    throw error;
}
```

`planInitMutationTargets` debe enumerar antes de escribir:

- `preferences.json` y `state/artifacts.json`;
- todos los targets del bundle `dev` para el provider seleccionado;
- agent TOML/Markdown renderizado;
- global/project `AGENTS.md` o config de inyección del provider;
- hook JSON/settings y scripts administrados;
- `.awm/profile.json`, `.awm/sensors.json` y archivos de activación que los steps puedan crear.

El test de orden debe comprobar `version-gate < begin-backup < save-preferences < install-hook < install-bundle`. El baseline Claude es read-only y se compara aunque el agent solicitado sea Codex.

- [ ] **Step 3: Escribir tests del comando `agent`**

Crear `cli/tests/commands/agent.test.ts`:

```ts
it('lists supported, enabled and default state', () => {
    writePrefs(prefsWith(['claude-code', 'codex'], 'claude-code'));
    expect(listAgents()).toEqual(expect.arrayContaining([
        { id: 'claude-code', enabled: true, default: true },
        { id: 'codex', enabled: true, default: false },
        { id: 'opencode', enabled: false, default: false },
    ]));
});

it('refuses to disable the default without a replacement', () => {
    writePrefs(prefsWith(['claude-code', 'codex'], 'claude-code'));
    expect(() => disableAgent('claude-code')).toThrow('--default <agent>');
});

it('disables management state without deleting provider files', () => {
    const marker = path.join(tmpHome, '.codex/AGENTS.md');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, 'keep');
    disableAgent('codex');
    expect(readPrefs().enabledAgents).toEqual(['claude-code']);
    expect(fs.readFileSync(marker, 'utf8')).toBe('keep');
});
```

- [ ] **Step 4: Implementar `awm agent list|disable`**

Crear `cli/src/commands/agent.ts` con funciones puras exportadas y registro Commander:

```ts
export function listAgents(): AgentRow[] {
    const prefs = getPreferences();
    return AGENT_TARGETS.map((id) => ({
        id,
        label: providerFor(id).label,
        enabled: prefs.enabledAgents.includes(id),
        default: prefs.defaultAgent === id,
    }));
}

export function disableAgent(agent: AgentTarget, replacement?: AgentTarget): void {
    const prefs = getPreferences();
    if (!prefs.enabledAgents.includes(agent)) throw new Error(`${agent} is not enabled`);
    if (prefs.defaultAgent === agent && replacement === undefined) {
        throw new Error(`Cannot disable the default agent; pass --default <agent>`);
    }
    const enabledAgents = prefs.enabledAgents.filter((candidate) => candidate !== agent);
    const defaultAgent = replacement ?? prefs.defaultAgent;
    if (!enabledAgents.includes(defaultAgent)) {
        throw new Error(`Replacement default ${defaultAgent} must remain enabled`);
    }
    savePreferences({ ...prefs, enabledAgents, defaultAgent });
}
```

- [ ] **Step 5: Escribir tests de targeting de los cinco comandos**

Crear `cli/tests/commands/multi-agent-targeting.test.ts` con una tabla:

```ts
it.each(['add', 'remove', 'sync', 'update', 'doctor'] as const)(
    '%s targets all enabled providers when --agent is absent',
    async (command) => {
        const observed = await invokeCommandWithPlannerSpy(command, undefined);
        expect(observed.selectedAgents).toEqual(['claude-code', 'opencode', 'codex']); // verifies R12
    },
);

it.each(['add', 'remove', 'sync', 'update', 'doctor'] as const)(
    '%s honors an independently addressable explicit subset',
    async (command) => {
        const observed = await invokeCommandWithPlannerSpy(command, 'codex,claude-code');
        expect(observed.selectedAgents).toEqual(['codex', 'claude-code']); // verifies R13
    },
);
```

Añadir casos específicos que comprueben que `add/remove` con sólo `codex` fallan para skills cuando OpenCode también está habilitado, y que `update` actualiza cada registry una vez antes de reconciliar cada target físico una vez.

- [ ] **Step 6: Cablear resolver y planner en los comandos**

En `cli/src/index.ts`:

- añadir `--agent <agent>` a `update` y `remove`;
- sustituir cada bloque manual de parsing por `resolveAgentTargets({ prefs, explicit: options.agent })`;
- usar `enabledAgents` en las selecciones interactivas iniciales;
- construir el plan completo antes del spinner de escritura;
- conservar todas las propiedades de prefs al guardar:

```ts
savePreferences({
    ...prefs,
    defaultScope: scopeVal,
    installMethod: methodVal,
});
```

`update` debe ejecutar, en orden verificable:

```ts
const targets = resolveAgentTargets({ prefs, explicit: options.agent });
const registryResults = await syncRegistries();
assertRegistryGates(verifyMinCliVersions());
const context = regenerateGlobalContext(targets);
const artifactPlan = planReconciliation({ targets, roots: contentRoots() });
const artifactResult = applyInstallPlan(artifactPlan);
const hookResult = resyncInstalledHooks(capabilityRoot('hooks') ?? '', targets);
```

No envolver context, reconciliación o hooks en `catch {}` silenciosos: reportar el provider fallido y retornar exit code no-cero.

- [ ] **Step 7: Ejecutar integración de init y comandos**

Run: `cd cli && npm test -- --runTestsByPath tests/commands/init.test.ts tests/commands/agent.test.ts tests/commands/multi-agent-targeting.test.ts tests/core/init/steps.test.ts tests/core/init/orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add cli/src/commands/agent.ts cli/src/commands/init.ts cli/src/core/init cli/src/index.ts cli/tests/commands cli/tests/core/init
git commit -m "feat: converge all enabled agents"
```

### Task 9: Diagnóstico por provider y regresión CLI completa

_Requirements: R2, R7, R8, R18, R19, R19.1, R20, R23_

**Files:**
- Modify: `cli/src/core/diagnostics/types.ts`
- Modify: `cli/src/core/diagnostics/context.ts`
- Modify: `cli/src/core/diagnostics/checks.ts`
- Modify: `cli/src/commands/doctor.ts`
- Modify: `cli/tests/core/diagnostics/context.test.ts`
- Modify: `cli/tests/core/diagnostics/checks.test.ts`
- Modify: `cli/tests/commands/doctor.test.ts`
- Create: `cli/tests/integration/codex-provider-isolated.test.ts`

- [ ] **Step 1: Escribir tests rojos de la matriz estable**

En `cli/tests/commands/doctor.test.ts`:

```ts
it('reports every enabled provider and stable remediation codes in JSON', () => {
    writePrefs(prefsWith(['claude-code', 'opencode', 'codex']));
    const code = runDoctor({ cwd: tmpWork, json: true });
    const report = JSON.parse(stdout());
    expect(report.providers.map((provider: { id: string }) => provider.id))
        .toEqual(['claude-code', 'opencode', 'codex']); // verifies R12
    expect(report.providers.find((provider: { id: string }) => provider.id === 'codex'))
        .toMatchObject({
            checks: expect.arrayContaining([
                expect.objectContaining({ id: 'binary.version' }),
                expect.objectContaining({ id: 'skills.global' }),
                expect.objectContaining({ id: 'agents.native' }),
                expect.objectContaining({ id: 'hook.trust' }),
            ]),
        }); // verifies R2, R7, R8, R18
});

it('reports shared skills for both owners without scanning twice', () => {
    const scan = jest.fn(() => healthySharedSkills());
    const report = gatherContext({ cwd: tmpWork, agents: ['opencode', 'codex'], scanSkills: scan });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(report.providers.every((provider) =>
        provider.checks.some((check) => check.state === 'shared'))).toBe(true);
});
```

- [ ] **Step 2: Cambiar tipos a matriz por provider**

En `cli/src/core/diagnostics/types.ts` definir:

```ts
export type ProviderCheckState =
    | 'supported' | 'unsupported' | 'missing'
    | 'healthy' | 'broken' | 'shared' | 'stale'
    | 'absent' | 'conflict' | 'pending-trust'
    | 'delivered' | 'pending';

export type ProviderCheck = {
    id: 'binary.version' | 'skills.global' | 'agents.native' |
        'context.global' | 'hook.trust' | 'guidance.project' | 'constitution.delivery';
    state: ProviderCheckState;
    target?: string;
    owners?: AgentTarget[];
    remediationCode?: string;
    detail?: string;
};

export type ProviderFacts = {
    id: AgentTarget;
    label: string;
    checks: ProviderCheck[];
};

export type HarnessContext = {
    registryCache: { present: boolean; gitState?: GitState };
    providers: ProviderFacts[];
    project: ProjectFacts | null;
};
```

- [ ] **Step 3: Implementar gathering deduplicado y comandos externos seguros**

En `cli/src/core/diagnostics/context.ts`:

- reemplazar `execSync('git ...')` por `execFileSync('git', ['status', '--porcelain'], ...)` y `execFileSync('git', ['rev-list', '--count', 'HEAD..@{u}'], ...)`;
- aceptar `agents` en `GatherOptions`;
- agrupar los directorios físicos de skills antes de escanear;
- calcular versión con la misma función de Task 2, capturando `missing`/`unsupported` como estado y no como reparación;
- obtener status de hook por provider;
- comprobar `.toml` de agentes Codex y el bloque gestionado de `AGENTS.md`;
- no modificar ningún archivo.

- [ ] **Step 4: Actualizar checks y render**

`runChecks` debe mantener `overall: 'healthy' | 'degraded'`, pero agrupar resultados bajo `providers`. `renderReport` debe producir:

```text
Provider: Claude Code
  ✔ binary/version
  ✔ global skills
  ✔ hook SessionStart

Provider: Codex
  ✔ binary/version (0.145.0)
  ◷ hook SessionStart (pending trust)   → open /hooks
```

Registrar `--agent <agent>` en doctor y resolverlo con `resolveAgentTargets`. JSON debe incluir IDs, paths, states, owners y `remediationCode`, no strings coloreados.

- [ ] **Step 5: Escribir el E2E automatizado de home aislado**

Crear `cli/tests/integration/codex-provider-isolated.test.ts`:

```ts
it('initializes Codex beside Claude and OpenCode without touching live homes', async () => {
    expect(process.env.HOME).toBe(tmpHome);
    expect(process.env.AWM_HOME).toBe(path.join(tmpHome, '.awm'));
    seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));
    installFakeCodex('codex-cli 0.145.0');
    writeHealthyClaudeFixture(tmpHome);
    writePrefs(prefsWith(['claude-code', 'opencode']));
    const claudeBefore = snapshotTree(path.join(tmpHome, '.claude'));

    expect(await runInit({ cwd: tmpWork, agent: 'codex', yes: true })).toBeLessThanOrEqual(1);

    expect(readPrefs().enabledAgents).toEqual(['claude-code', 'opencode', 'codex']);
    expect(fs.realpathSync(path.join(tmpHome, '.agents/skills/development-process')))
        .toContain('.awm/registries/baseline/skills/development-process'); // verifies R1, R7
    expect(fs.readFileSync(path.join(tmpHome, '.codex/agents/development-process.toml'), 'utf8'))
        .toContain('developer_instructions = """'); // verifies R8
    expect(snapshotTree(path.join(tmpHome, '.claude'))).toEqual(claudeBefore); // verifies R19, R23
});
```

- [ ] **Step 6: Ejecutar suite completa, build, diff check y sensores**

Run: `cd cli && npm test -- --runInBand`

Expected: PASS, sin usar el home real.

Run: `cd cli && npm run build`

Expected: PASS.

Run: `git diff --check`

Expected: sin output.

Run: `awm sensors run`

Expected: `overall: "passed"`. Si el sensor de seguridad vuelve a quedar `skipped` por trust anchors vacíos, registrar el bloqueo exacto y no representar el gate como aprobado.

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/diagnostics cli/src/commands/doctor.ts cli/tests/core/diagnostics cli/tests/commands/doctor.test.ts cli/tests/integration/codex-provider-isolated.test.ts
git commit -m "feat: diagnose Codex coexistence"
```

## Traceability matrix

| Req | Task(s) | Test(s) |
|---|---|---|
| R1 | T2, T8, T9 | `initializes Codex beside Claude and OpenCode without touching live homes` |
| R2 | T2, T8, T9 | `rejects unsupported output without mutation`; `gates Codex before preferences or provider writes`; doctor `binary.version` |
| R3 | T3, T7 | `injects global AWM bootstrap without changing user rules`; `merges one AWM SessionStart group and preserves user hooks` |
| R3.1 | T7 | Codex hook merge matcher and session-state hook command test |
| R4 | T3 | `appends exactly one block and preserves user content byte-for-byte`; global strategy test |
| R5 | T3 | project strategy preservation test |
| R6 | T3 | project `CONSTITUTION.md` guidance test |
| R7 | T2, T9 | Codex path test; isolated provider E2E |
| R8 | T4, T9 | deterministic TOML renderer; isolated provider E2E |
| R9 | T4 | canonical parser/renderer tests; full registry portability is covered by plan 2 |
| R10 | T1 | legacy migration and malformed-file tests |
| R11 | T1, T8 | coexistence init test |
| R12 | T1, T5, T8, T9 | resolver default test; five-command parameterized test; doctor provider matrix |
| R13 | T1, T5, T8 | explicit subset resolver, planner and five-command tests |
| R14 | T5, T8 | incomplete shared-group planner and command tests |
| R15 | T5, T6, T8 | deduplicated operation and bundle replace-call tests |
| R15.1 | T5, T6, T8 | multi-owner report tests |
| R16 | T5, T8 | owner-aware removal test |
| R17 | T3, T4, T6, T7 | marker conflicts, canonical validation, staging preservation, duplicate hook tests |
| R18 | T7, T9 | heartbeat trust table; doctor hook check |
| R19 | T2, T7, T8, T9 | Claude path, hook characterization, tree snapshot and isolated E2E |
| R19.1 | T2, T3, T8, T9 | OpenCode path and `instructions[]` characterization tests |
| R20 | T1, T8, T9 | single-enabled resolver case and unqualified command table |
| R23 | T9 | isolated integration test asserts `HOME` and `AWM_HOME` |
| R24.1 | T6 | transaction order test proves all backups precede replacements |
| R25 | T6 | rollback restoration test |

Requirements R21, R21.1, R21.2, R22, R24 and R26 belong to plan 3 and are not implemented by this plan.

## Analyze gate

- Forward coverage: every requirement assigned to this plan has at least one implementation task and one behavior-specific test.
- Backward coverage: every task and named test maps to one or more requirement IDs.
- UI propagation: no task touches a UI screen; no design artifacts are required.
- Execution boundary: the real operator home is excluded; Task 9 only verifies isolated homes.
