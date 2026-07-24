# Codex End-to-End and Controlled Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Probar la integración Codex de AWM de extremo a extremo en entornos aislado, local real, cloud y GitHub, y activarla en el home del operador sin degradar Claude Code.

**Architecture:** Los smoke tests automáticos construirán un paquete local y homes temporales; el bootstrap cloud sólo consumirá releases y registries públicos. La activación real se envolverá con inventario read-only, aprobación explícita, backups transaccionales, comparación post-install y rollback verificable.

**Tech Stack:** Node.js 20+, npm, AWM CLI compilado, Codex estable, Git/GitHub, scripts POSIX para setup cloud, JSON de evidencia sin secretos.

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

## Orden y límites

Este es el plan 3 de 3. Requiere:

1. plan CLI completo, revisado y publicado por el workflow automático de `agentic-workflow`;
2. plan de portabilidad completo en una rama de `awm-baseline-registry`;
3. `minCliVersion` del registry aún sin elevar hasta observar la versión estable real del CLI.

Los Tasks 1–3 usan sólo homes/workspaces temporales. Task 4 usa un `CODEX_HOME` temporal y autenticación ingresada por el usuario. Task 5 es el primer acceso mutante al home real y contiene una pausa obligatoria para aprobación explícita. El registry personal queda fuera de todos los setup/E2E Codex.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `cli/scripts/e2e/codex-isolated.mjs` | Empaquetar e instalar CLI/registry en homes temporales y probar coexistencia |
| `cli/tests/scripts/codex-isolated.test.ts` | Probar que el runner rechaza rutas reales y produce evidencia |
| `docs/codex-cloud-setup.sh` | Reconstruir Codex desde npm y registries públicos en cloud |
| `cli/tests/scripts/codex-cloud-setup.test.ts` | Verificar comandos, exclusión del registry personal e inmutabilidad versionada |
| `cli/scripts/e2e/live-preflight.mjs` | Capturar baseline read-only sin copiar secretos |
| `cli/scripts/e2e/compare-live-baseline.mjs` | Comparar Claude Code antes/después y devolver exit no-cero en regresión |
| `cli/tests/scripts/live-preflight.test.ts` | Validar redacción, hashes y comparación |
| `docs/evidence/codex-e2e/schema.json` | Contrato de evidencia local/cloud/GitHub |
| `cli/scripts/e2e/record-evidence.mjs` | Validar y persistir observaciones estructuradas |
| `docs/runbook.md` | Documentar bootstrap, trust, verificación y rollback |

### Task 1: Runner E2E automatizado completamente aislado

_Requirements: R1, R7, R8, R11, R15, R19, R19.1, R23_

**Files:**
- Create: `cli/scripts/e2e/codex-isolated.mjs`
- Create: `cli/tests/scripts/codex-isolated.test.ts`
- Create: `docs/evidence/codex-e2e/isolated.json`
- Modify: `cli/package.json`

- [ ] **Step 1: Escribir tests rojos de aislamiento**

Crear `cli/tests/scripts/codex-isolated.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertIsolatedPaths, summarizeEvidence } from '../../scripts/e2e/codex-isolated';

it('rejects the operator HOME and AWM_HOME', () => {
    expect(() => assertIsolatedPaths({
        home: os.homedir(),
        awmHome: path.join(os.homedir(), '.awm'),
        work: fs.mkdtempSync(path.join(os.tmpdir(), 'awm-work-')),
    })).toThrow('refusing to use the operator home'); // verifies R23
});

it('requires three distinct temporary roots', () => {
    const same = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-same-'));
    expect(() => assertIsolatedPaths({
        home: same,
        awmHome: path.join(same, '.awm'),
        work: same,
    })).toThrow('home and work roots must be distinct');
});

it('records shared skill owners without duplicate physical targets', () => {
    const evidence = summarizeEvidence(fixtureResult());
    expect(evidence.sharedSkills.owners).toEqual(['opencode', 'codex']);
    expect(evidence.sharedSkills.physicalTargets).toHaveLength(1); // verifies R15
    expect(evidence.claudeUnchanged).toBe(true); // verifies R19
});
```

- [ ] **Step 2: Ejecutar tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/scripts/codex-isolated.test.ts`

Expected: FAIL porque el runner no existe.

- [ ] **Step 3: Implementar helpers y runner**

Crear `cli/scripts/e2e/codex-isolated.mjs`. La implementación debe exportar helpers al cargarse en Jest y ejecutar `main()` sólo cuando es entrypoint:

```js
#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function hashTree(root) {
  if (!fs.existsSync(root)) return null;
  const hash = crypto.createHash('sha256');
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      hash.update(path.relative(root, file));
      if (stat.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(file)}`);
      else if (stat.isDirectory()) visit(file);
      else hash.update(fs.readFileSync(file));
    }
  };
  visit(root);
  return hash.digest('hex');
}

export function assertIsolatedPaths({ home, awmHome, work }) {
  const realHome = fs.realpathSync(os.homedir());
  const resolvedHome = path.resolve(home);
  const resolvedAwm = path.resolve(awmHome);
  const resolvedWork = path.resolve(work);
  if (resolvedHome === realHome || resolvedAwm.startsWith(`${realHome}${path.sep}`)) {
    throw new Error('refusing to use the operator home');
  }
  if (resolvedHome === resolvedWork || resolvedAwm === resolvedWork) {
    throw new Error('home and work roots must be distinct');
  }
}

export function summarizeEvidence(result) {
  return {
    generatedAt: new Date().toISOString(),
    cliVersion: result.cliVersion,
    enabledAgents: result.enabledAgents,
    sharedSkills: {
      owners: result.sharedSkillOwners,
      physicalTargets: Array.from(new Set(result.sharedSkillTargets)),
    },
    codexAgentPresent: result.codexAgentPresent,
    codexGuidancePresent: result.codexGuidancePresent,
    claudeUnchanged: result.claudeBefore === result.claudeAfter,
    opencodeInstructionsPreserved: result.opencodeInstructionsPreserved,
  };
}

function run(command, args, options) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

export function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const baseline = process.env.AWM_BASELINE_SOURCE;
  if (!baseline) throw new Error('AWM_BASELINE_SOURCE must point to the completed baseline-registry worktree');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-home-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-work-'));
  const awmHome = path.join(home, '.awm');
  const prefix = path.join(home, 'npm');
  const fakeBin = path.join(home, 'fake-bin');
  assertIsolatedPaths({ home, awmHome, work });
  fs.mkdirSync(fakeBin, { recursive: true });
  const codex = path.join(fakeBin, 'codex');
  fs.writeFileSync(codex, '#!/usr/bin/env sh\nprintf "codex-cli 0.145.0\\n"\n', { mode: 0o755 });

  const remote = path.join(home, 'baseline.git');
  run('git', ['clone', '--bare', baseline, remote]);
  run('git', ['-C', remote, 'tag', '-f', 'v999.0.0', 'HEAD']);
  run('npm', ['run', 'build'], { cwd: path.join(repo, 'cli') });
  run('npm', ['pack', '--pack-destination', home], { cwd: path.join(repo, 'cli') });
  const tarball = path.join(home, fs.readdirSync(home).find((name) => name.endsWith('.tgz')));
  run('npm', ['install', '--prefix', prefix, '--global', tarball]);
  const awm = path.join(prefix, 'bin/awm');
  const env = {
    ...process.env,
    HOME: home,
    AWM_HOME: awmHome,
    AWM_BASE_REMOTE: pathToFileURL(remote).href,
    PATH: `${fakeBin}:${path.join(prefix, 'bin')}:${process.env.PATH}`,
  };

  run('git', ['init'], { cwd: work });
  fs.writeFileSync(path.join(work, 'package.json'), '{"name":"fixture","private":true}\n');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), '{"userSetting":"keep"}\n');
  fs.mkdirSync(path.join(home, '.config/opencode'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.config/opencode/opencode.json'),
    '{"instructions":["user-owned.md"],"theme":"keep"}\n',
  );
  fs.mkdirSync(awmHome, { recursive: true });
  fs.writeFileSync(path.join(awmHome, 'preferences.json'), JSON.stringify({
    defaultAgent: 'claude-code',
    enabledAgents: ['claude-code', 'opencode'],
    installMethod: 'symlink',
    defaultScope: 'local',
  }));
  const claudeBefore = hashTree(path.join(home, '.claude'));

  run(awm, ['init', '--agent', 'codex', '--yes', '--json'], { cwd: work, env });
  const doctor = JSON.parse(run(awm, ['doctor', '--json'], { cwd: work, env }));
  const prefs = JSON.parse(fs.readFileSync(path.join(awmHome, 'preferences.json'), 'utf8'));
  const shared = path.join(home, '.agents/skills/development-process');
  const result = {
    cliVersion: run(awm, ['--version'], { env }),
    enabledAgents: prefs.enabledAgents,
    sharedSkillOwners: ['opencode', 'codex'],
    sharedSkillTargets: [shared, shared],
    codexAgentPresent: fs.existsSync(path.join(home, '.codex/agents/development-process.toml')),
    codexGuidancePresent: fs.readFileSync(path.join(home, '.codex/AGENTS.md'), 'utf8').includes('<!-- AWM:START -->'),
    claudeBefore,
    claudeAfter: hashTree(path.join(home, '.claude')),
    opencodeInstructionsPreserved: JSON.parse(
      fs.readFileSync(path.join(home, '.config/opencode/opencode.json'), 'utf8'),
    ).instructions.includes('user-owned.md'),
    doctor,
  };
  const evidence = summarizeEvidence(result);
  if (!evidence.claudeUnchanged || !evidence.codexAgentPresent || !evidence.codexGuidancePresent) {
    throw new Error(`isolated E2E failed: ${JSON.stringify(evidence)}`);
  }
  const evidenceDir = path.join(repo, 'docs/evidence/codex-e2e');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'isolated.json'), JSON.stringify({
    surface: 'isolated',
    executedAt: evidence.generatedAt,
    result: 'passed',
    checks: {
      temporaryRoots: true,
      sharedSkillDeduplicated: evidence.sharedSkills.physicalTargets.length === 1,
      codexAgentRendered: evidence.codexAgentPresent,
      codexGuidancePresent: evidence.codexGuidancePresent,
      claudeUnchanged: evidence.claudeUnchanged,
      opencodePreserved: evidence.opencodeInstructionsPreserved,
    },
  }, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Registrar script y ejecutar tests**

Añadir a `cli/package.json`:

```json
"e2e:codex:isolated": "node scripts/e2e/codex-isolated.mjs"
```

Run: `cd cli && npm test -- --runTestsByPath tests/scripts/codex-isolated.test.ts`

Expected: PASS.

- [ ] **Step 5: Ejecutar E2E con los dos worktrees completados**

Run:

```bash
cd /Users/cencosud/Developments/personal/awm-baseline-registry
baseline_worktree="$(pwd -P)"
cd /Users/cencosud/Developments/personal/agentic-workflow/cli
AWM_BASELINE_SOURCE="$baseline_worktree" npm run e2e:codex:isolated
```

Expected: JSON con `enabledAgents` igual a `["claude-code","opencode","codex"]`, `physicalTargets` de skills con longitud 1, `codexAgentPresent: true`, `codexGuidancePresent: true`, `claudeUnchanged: true` y `opencodeInstructionsPreserved: true`.

- [ ] **Step 6: Commit**

```bash
git add cli/scripts/e2e/codex-isolated.mjs cli/tests/scripts/codex-isolated.test.ts cli/package.json docs/evidence/codex-e2e/isolated.json
git commit -m "test: add isolated Codex coexistence E2E"
```

### Task 2: Bootstrap cloud público e idempotente

_Requirements: R21, R21.1, R21.2, R23_

**Files:**
- Create: `docs/codex-cloud-setup.sh`
- Create: `cli/tests/scripts/codex-cloud-setup.test.ts`
- Modify: `docs/runbook.md`

- [ ] **Step 1: Escribir tests rojos del script cloud**

Crear `cli/tests/scripts/codex-cloud-setup.test.ts`:

```ts
const script = fs.readFileSync(path.join(repoRoot, 'docs/codex-cloud-setup.sh'), 'utf8');

it('uses only the stable public distribution path', () => {
    expect(script).toContain('npm i -g agentic-workflow-manager@latest');
    expect(script).toContain('awm init --agent codex --yes --machine-only');
    expect(script).toContain('BUNDLES=(product frontend authoring)');
    expect(script).not.toMatch(/AWM_GIT_TOKEN|personal-registry|awm-personal-registry/); // verifies R21
});

it('reconstructs generated project artifacts without rewriting versioned guidance', () => {
    expect(script).toContain('awm sync --agent codex');
    expect(script).toContain('git diff --exit-code -- AGENTS.md CONSTITUTION.md .awm/profile.json');
    expect(script).not.toContain('awm init --agent codex --yes\n'); // verifies R21.1, R21.2
});

it('is valid POSIX-compatible bash', () => {
    expect(execFileSync('bash', ['-n', cloudScript])).toBeDefined();
});
```

- [ ] **Step 2: Ejecutar tests para comprobar RED**

Run: `cd cli && npm test -- --runTestsByPath tests/scripts/codex-cloud-setup.test.ts`

Expected: FAIL porque el script no existe.

- [ ] **Step 3: Crear el setup cloud**

Crear `docs/codex-cloud-setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
export GIT_TERMINAL_PROMPT=0

npm i -g agentic-workflow-manager@latest
awm init --agent codex --yes --machine-only
awm update --agent codex

BUNDLES=(product frontend authoring)
for bundle in "${BUNDLES[@]}"; do
  awm add "$bundle" -t skill -s global --agent codex --yes --all
done

if [ -f .awm/profile.json ]; then
  awm sync --agent codex
fi

git diff --exit-code -- AGENTS.md CONSTITUTION.md .awm/profile.json
awm doctor --agent codex --json
```

Hacerlo ejecutable. No añadir credential helper, token ni registry personal. `awm init --machine-only` reconstruye estado global; `awm sync` reconstruye symlinks/copies generados desde el profile ya versionado y no modifica el bloque versionado de `AGENTS.md`.

- [ ] **Step 4: Añadir test conductual con binarios fake**

En `cli/tests/scripts/codex-cloud-setup.test.ts`, crear un repo temporal limpio y un `PATH` con fakes `npm`/`awm` que escriban sus argumentos a un log. Ejecutar el script y comprobar este orden:

```ts
expect(calls).toEqual([
    'npm i -g agentic-workflow-manager@latest',
    'awm init --agent codex --yes --machine-only',
    'awm update --agent codex',
    'awm add product -t skill -s global --agent codex --yes --all',
    'awm add frontend -t skill -s global --agent codex --yes --all',
    'awm add authoring -t skill -s global --agent codex --yes --all',
    'awm sync --agent codex',
    'awm doctor --agent codex --json',
]); // verifies R21, R21.2
expect(execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' }))
    .toBe(''); // verifies R21.1
```

- [ ] **Step 5: Documentar instalación, trust e idempotencia**

En `docs/runbook.md`, añadir una sección “Codex local and cloud” que:

- enlace `docs/codex-cloud-setup.sh`;
- declare Codex mínimo `0.145.0`;
- explique que `/hooks` revisa/trustea el hook y que `pending-trust` no equivale a healthy;
- indique que un segundo setup debe ser no-op físico salvo un nuevo release público;
- excluya expresamente el registry personal del entorno cloud;
- explique que el setup no modifica `AGENTS.md`, `CONSTITUTION.md` ni `.awm/profile.json` versionados.

- [ ] **Step 6: Ejecutar tests**

Run: `cd cli && npm test -- --runTestsByPath tests/scripts/codex-cloud-setup.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/codex-cloud-setup.sh docs/runbook.md cli/tests/scripts/codex-cloud-setup.test.ts
git commit -m "docs: add public Codex cloud bootstrap"
```

### Task 3: Baseline live read-only, comparación y evidencia redactada

_Requirements: R24, R24.1, R25, R26_

**Files:**
- Create: `cli/scripts/e2e/live-preflight.mjs`
- Create: `cli/scripts/e2e/compare-live-baseline.mjs`
- Create: `cli/tests/scripts/live-preflight.test.ts`
- Create: `docs/evidence/codex-e2e/schema.json`
- Create: `cli/scripts/e2e/record-evidence.mjs`
- Modify: `cli/package.json`

- [ ] **Step 1: Escribir tests rojos de redacción y comparación**

Crear `cli/tests/scripts/live-preflight.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectPreflight } from '../../scripts/e2e/live-preflight.mjs';
import { compareBaselines } from '../../scripts/e2e/compare-live-baseline.mjs';

let tmpHome: string;
let tmpAwm: string;
let tmpWork: string;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-live-home-'));
    tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-live-work-'));
    tmpAwm = path.join(tmpHome, '.awm');
});

afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpWork, { recursive: true, force: true });
});

function writeFixtureHome(input: { claudeSettings: string; preferences: string }): void {
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    fs.mkdirSync(tmpAwm, { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), input.claudeSettings);
    fs.writeFileSync(path.join(tmpAwm, 'preferences.json'), input.preferences);
}

function baselineFixture(input: {
    claudeSettingsHash: string;
    doctorOverall: 'healthy' | 'degraded';
}) {
    return {
        files: [{
            path: path.join(tmpHome, '.claude/settings.json'),
            state: 'file',
            mode: 0o600,
            sha256: input.claudeSettingsHash,
        }],
        claudeDoctor: {
            overall: input.doctorOverall,
            providers: [{
                id: 'claude-code',
                checks: [{ id: 'hook.trust', state: input.doctorOverall === 'healthy' ? 'healthy' : 'stale' }],
            }],
        },
    };
}

it('stores hashes and metadata but never raw config or credentials', () => {
    writeFixtureHome({
        claudeSettings: '{"apiKey":"secret","hooks":{}}',
        preferences: '{"defaultAgent":"claude-code"}',
    });
    const snapshot = collectPreflight({ home: tmpHome, awmHome: tmpAwm, cwd: tmpWork });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('secret'); // verifies R24
    expect(snapshot.files).toEqual(expect.arrayContaining([
        expect.objectContaining({
            path: path.join(tmpHome, '.claude/settings.json'),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
    ]));
});

it('fails comparison when any Claude-owned file or diagnostic regresses', () => {
    const before = baselineFixture({ claudeSettingsHash: 'a', doctorOverall: 'healthy' });
    const after = baselineFixture({ claudeSettingsHash: 'b', doctorOverall: 'degraded' });
    expect(compareBaselines(before, after)).toEqual({
        ok: false,
        regressions: expect.arrayContaining([
            expect.stringContaining('Claude file changed:'),
            'Claude doctor changed healthy → degraded',
        ]),
    }); // verifies R25
});
```

- [ ] **Step 2: Implementar snapshot read-only**

Crear `cli/scripts/e2e/live-preflight.mjs`:

```js
#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function fileFact(file) {
  if (!fs.existsSync(file)) return { path: file, state: 'absent' };
  const stat = fs.lstatSync(file);
  const bytes = stat.isSymbolicLink()
    ? Buffer.from(`link:${fs.readlinkSync(file)}`)
    : fs.readFileSync(file);
  return {
    path: file,
    state: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
    mode: stat.mode & 0o777,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function treeFacts(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(file);
      else files.push(fileFact(file));
    }
  };
  visit(root);
  return files;
}

function commandJson(command, args, cwd) {
  try {
    return JSON.parse(execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }));
  } catch (error) {
    return { error: (error).message, exitCode: (error).status ?? null };
  }
}

export function collectPreflight({
  home = os.homedir(),
  awmHome = process.env.AWM_HOME || path.join(home, '.awm'),
  cwd = process.cwd(),
} = {}) {
  const candidates = [
    path.join(awmHome, 'preferences.json'),
    path.join(awmHome, 'registries.json'),
    path.join(awmHome, 'state/artifacts.json'),
    path.join(home, '.codex/AGENTS.md'),
    path.join(home, '.codex/hooks.json'),
    path.join(home, '.config/opencode/opencode.json'),
  ];
  let registryNames = [];
  try {
    const registries = JSON.parse(fs.readFileSync(path.join(awmHome, 'registries.json'), 'utf8'));
    registryNames = Array.isArray(registries)
      ? registries.map((entry) => entry?.name).filter((name) => typeof name === 'string')
      : [];
  } catch {
    registryNames = [];
  }
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    home,
    awmHome,
    files: [...candidates.map(fileFact), ...treeFacts(path.join(home, '.claude'))],
    registryNames,
    claudeDoctor: commandJson('awm', ['doctor', '--agent', 'claude-code', '--json'], cwd),
    agentList: commandJson('awm', ['agent', 'list', '--json'], cwd),
  };
}

export function main() {
  const output = process.argv[2];
  if (!output || !path.isAbsolute(output)) throw new Error('usage: live-preflight.mjs /absolute/output.json');
  fs.writeFileSync(output, JSON.stringify(collectPreflight(), null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

El script sólo lee el home; el único write es el JSON de evidencia elegido explícitamente.

- [ ] **Step 3: Implementar comparación**

Crear `cli/scripts/e2e/compare-live-baseline.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function fact(snapshot, suffix) {
  return snapshot.files.find((entry) => entry.path.endsWith(suffix));
}

export function compareBaselines(before, after) {
  const regressions = [];
  const claudeFacts = (snapshot) => new Map(
    snapshot.files
      .filter((entry) => entry.path.includes(`${path.sep}.claude${path.sep}`))
      .map((entry) => [entry.path, `${entry.state}:${entry.sha256 || ''}:${entry.mode || ''}`]),
  );
  const beforeClaude = claudeFacts(before);
  const afterClaude = claudeFacts(after);
  for (const file of new Set([...beforeClaude.keys(), ...afterClaude.keys()])) {
    if (beforeClaude.get(file) !== afterClaude.get(file)) {
      regressions.push(`Claude file changed: ${file}`);
    }
  }
  const beforeOverall = before.claudeDoctor?.overall;
  const afterOverall = after.claudeDoctor?.overall;
  if (beforeOverall !== afterOverall) {
    regressions.push(`Claude doctor changed ${beforeOverall} → ${afterOverall}`);
  }
  const providerChecks = (snapshot) => {
    const provider = snapshot.claudeDoctor?.providers?.find((entry) => entry.id === 'claude-code');
    return new Map((provider?.checks || []).map((check) => [check.id, check.state]));
  };
  const beforeChecks = providerChecks(before);
  const afterChecks = providerChecks(after);
  for (const [id, state] of beforeChecks) {
    if (state === 'healthy' || state === 'supported' || state === 'delivered') {
      const next = afterChecks.get(id);
      if (next !== state) regressions.push(`Claude check ${id} changed ${state} → ${next}`);
    }
  }
  return { ok: regressions.length === 0, regressions };
}

export function main() {
  const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const result = compareBaselines(before, after);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Definir y validar evidencia**

Crear `docs/evidence/codex-e2e/schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["surface", "executedAt", "result", "checks"],
  "properties": {
    "surface": { "enum": ["isolated", "local-real", "live-coexistence", "cloud", "github-review"] },
    "executedAt": { "type": "string", "format": "date-time" },
    "result": { "enum": ["passed", "failed", "blocked"] },
    "checks": {
      "type": "object",
      "additionalProperties": { "type": ["boolean", "string", "number", "null"] }
    },
    "artifactRefs": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "additionalProperties": false
}
```

Crear `cli/scripts/e2e/record-evidence.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const surfaces = new Set(['isolated', 'local-real', 'live-coexistence', 'cloud', 'github-review']);
const results = new Set(['passed', 'failed', 'blocked']);
const values = new Map();
const artifactRefs = [];
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`missing value for ${key}`);
  if (key === '--artifact-ref') artifactRefs.push(value);
  else values.set(key, value);
}
const surface = values.get('--surface');
const result = values.get('--result');
if (!surfaces.has(surface)) throw new Error(`invalid evidence surface: ${surface}`);
if (!results.has(result)) throw new Error(`invalid evidence result: ${result}`);
let checks;
try {
  checks = JSON.parse(values.get('--checks') || '');
} catch {
  throw new Error('--checks must be a JSON object');
}
if (!checks || Array.isArray(checks) || typeof checks !== 'object') {
  throw new Error('--checks must be a JSON object');
}
const forbiddenKey = /token|secret|password|credential/i;
const forbiddenValue = /(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]+/;
function assertRedacted(value, key = '') {
  if (forbiddenKey.test(key)) throw new Error(`forbidden evidence key: ${key}`);
  if (typeof value === 'string' && forbiddenValue.test(value)) {
    throw new Error(`credential-like value rejected at ${key}`);
  }
  if (Array.isArray(value)) value.forEach((entry, index) => assertRedacted(entry, `${key}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) assertRedacted(child, childKey);
  }
}
assertRedacted(checks);
artifactRefs.forEach((value) => assertRedacted(value, 'artifactRef'));

const executedAt = new Date().toISOString();
const evidence = {
  surface,
  executedAt,
  result,
  checks,
  ...(artifactRefs.length ? { artifactRefs } : {}),
};
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(repo, 'docs/evidence/codex-e2e');
const file = path.join(dir, `${surface}.json`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(`${file}\n`);
```

El script recibe `--surface`, `--result` y `--checks` con un objeto JSON serializado y escribe uno de los cinco nombres de superficie permitidos bajo `docs/evidence/codex-e2e/`; `executedAt` conserva la fecha/hora real. Rechaza keys `token`, `secret`, `password`, `credential` y strings con patrón `ghp_`, `github_pat_` o `sk-`.

- [ ] **Step 5: Registrar scripts y ejecutar tests**

Añadir a `cli/package.json`:

```json
"e2e:codex:preflight": "node scripts/e2e/live-preflight.mjs",
"e2e:codex:compare": "node scripts/e2e/compare-live-baseline.mjs",
"e2e:codex:evidence": "node scripts/e2e/record-evidence.mjs"
```

Run: `cd cli && npm test -- --runTestsByPath tests/scripts/live-preflight.test.ts`

Expected: PASS.

- [ ] **Step 6: Validar evidencia aislada contra el schema y commit**

Run:

```bash
node -e "const fs=require('fs'); const e=JSON.parse(fs.readFileSync('docs/evidence/codex-e2e/isolated.json','utf8')); if(e.surface!=='isolated'||e.result!=='passed'||!e.executedAt||!e.checks||Array.isArray(e.checks)) throw new Error('invalid isolated evidence'); console.log('isolated evidence: ok')"
```

Expected: `isolated evidence: ok`. No reescribir el timestamp observado en Task 1.

```bash
git add cli/scripts/e2e/live-preflight.mjs cli/scripts/e2e/compare-live-baseline.mjs cli/scripts/e2e/record-evidence.mjs cli/tests/scripts/live-preflight.test.ts cli/package.json docs/evidence/codex-e2e/schema.json
git commit -m "test: add safe Codex rollout evidence"
```

### Task 4: Coordinar releases estables sin publicación manual

_Requirements: R2, R21, R22, R23_

**Files:**
- Modify: `/Users/cencosud/Developments/personal/awm-baseline-registry/awm-registry.json`
- Create: `/Users/cencosud/Developments/personal/awm-baseline-registry/scripts/set-min-cli-version.mjs`
- Modify: `/Users/cencosud/Developments/personal/awm-baseline-registry/scripts/validate-portability.mjs`

- [ ] **Step 1: Completar QA del CLI y abrir su PR**

En `agentic-workflow`, ejecutar la suite completa, `post-implementation-qa`, `harness-retro` y `finishing-a-development-branch`. El PR debe usar conventional commit `feat:` para que `.github/workflows/release.yml` determine el bump.

Antes del merge, publicar en ese PR:

```text
@codex review

Además del review general, aplica explícitamente las reglas de AGENTS.md y señala en el resumen qué regla de repositorio gobernó tu revisión.
```

Expected: Codex produce review y demuestra en el resumen que recibió las reglas aplicables del repo, con checks verdes y review humano aprobado. Guardar la URL del PR para la evidencia de Task 7. No ejecutar `npm publish`.

- [ ] **Step 2: Mergear el CLI y observar el release automático**

Después de aprobación humana del merge, verificar el workflow `release.yml`. Consultar npm hasta que el stable cambie:

Run: `npm view agentic-workflow-manager version`

Expected: una versión estable mayor a `3.1.0`. Guardar el valor exacto como `releasedCliVersion` en la evidencia; no aceptar prerelease.

- [ ] **Step 3: Verificar el paquete público en un prefix temporal**

Run:

```bash
release_prefix="$(mktemp -d)"
npm install --prefix "$release_prefix" --global "agentic-workflow-manager@$(npm view agentic-workflow-manager version)"
"$release_prefix/bin/awm" --version
```

Expected: la salida coincide exactamente con `npm view agentic-workflow-manager version`. Borrar el prefix temporal después del smoke.

- [ ] **Step 4: Elevar `minCliVersion` al release observado**

Crear `scripts/set-min-cli-version.mjs` en el worktree completado de `awm-baseline-registry`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('usage: set-min-cli-version.mjs X.Y.Z');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'awm-registry.json');
fs.writeFileSync(file, `${JSON.stringify({ minCliVersion: version })}\n`);
```

Run:

```bash
released_cli_version="$(npm view agentic-workflow-manager version)"
node scripts/set-min-cli-version.mjs "$released_cli_version"
```

Añadir al validador:

```js
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'awm-registry.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.minCliVersion)) {
  failures.push('awm-registry.json minCliVersion must be an exact stable semver');
}
```

Run: `node scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`.

- [ ] **Step 5: Completar QA y PR del baseline**

Commit del gate observado:

```bash
git add awm-registry.json scripts/set-min-cli-version.mjs scripts/validate-portability.mjs
git commit -m "feat: require Codex-capable CLI"
```

Ejecutar QA/retro/finishing en el registry. El merge commit debe comenzar con `feat:`; `.github/workflows/auto-tag.yml` cortará el siguiente tag del registry automáticamente. No crear el tag a mano.

- [ ] **Step 6: Verificar el release público del registry**

Run:

```bash
git ls-remote --tags https://github.com/Kodria/awm-baseline-registry.git
```

Expected: un nuevo tag semver que contiene el merge de portabilidad. En un home temporal, `awm update` debe resolver ese tag y aceptar el `minCliVersion` publicado.

- [ ] **Step 7: Crear rama de evidencia desde los releases publicados**

Desde `agentic-workflow`:

```bash
git fetch origin
evidence_worktree="$(mktemp -d)"
git worktree add "$evidence_worktree" -b codex/codex-e2e-evidence origin/main
```

Ejecutar Tasks 5–7 desde `"$evidence_worktree"`. Esta rama sólo agrega evidencia observada y ajustes finales del runbook; no reimplementa el provider ya publicado.

### Task 5: Sesión Codex real aislada y recuperación post-compact

_Requirements: R3, R3.1, R6, R8, R18, R23, R26_

**Files:**
- Create: `docs/evidence/codex-e2e/local-real.json`

- [ ] **Step 1: Crear home y proyecto temporales**

Run:

```bash
codex_e2e_root="$(mktemp -d)"
mkdir -p "$codex_e2e_root/home" "$codex_e2e_root/work"
```

No copiar `~/.codex/auth.json`, credenciales ni configuraciones del home real. Iniciar sesión de Codex en el `CODEX_HOME` temporal mediante el flujo interactivo oficial o usar una credencial efímera ingresada por el usuario que no se escriba en evidencia.

- [ ] **Step 2: Instalar releases públicos y preparar estado recuperable**

Run:

```bash
HOME="$codex_e2e_root/home" AWM_HOME="$codex_e2e_root/home/.awm" \
  npm install --prefix "$codex_e2e_root/npm" --global agentic-workflow-manager@latest
PATH="$codex_e2e_root/npm/bin:$PATH" HOME="$codex_e2e_root/home" \
  AWM_HOME="$codex_e2e_root/home/.awm" awm init --agent codex --yes
```

Crear en el proyecto temporal un `AGENTS.md` con una regla observable, `CONSTITUTION.md`, `.awm/profile.json` y un plan con un checkbox abierto usando `apply_patch`. Ejecutar `awm sync --agent codex`.

- [ ] **Step 3: Abrir Codex estable y confiar el hook**

Run:

```bash
HOME="$codex_e2e_root/home" CODEX_HOME="$codex_e2e_root/home/.codex" \
  PATH="$codex_e2e_root/npm/bin:$PATH" codex
```

En la sesión:

1. abrir `/hooks`;
2. verificar la definición AWM exacta;
3. confiarla;
4. reiniciar la sesión si Codex lo solicita.

Run fuera de la sesión: `awm doctor --agent codex --json`.

Expected: hook `healthy`, no `pending-trust`, y heartbeat con hash actual. Esto prueba R18.

- [ ] **Step 4: Verificar activación, agente y constitución**

Prompt exacto:

```text
Sin modificar archivos, inspecciona tu contexto y responde sólo con JSON:
{"awm_active":boolean,"next_skill":string,"constitution_rule":string,"native_agent_available":boolean}
```

Expected: `awm_active: true`, `next_skill: "development-process"`, `constitution_rule` reproduce semánticamente la regla fixture y `native_agent_available: true`.

- [ ] **Step 5: Verificar re-anchor tras compactación**

Ejecutar `/compact`, luego prompt:

```text
Sin modificar archivos, responde sólo con JSON:
{"active_plan":string,"open_plan_item":string,"ledger_recovered":boolean}
```

Expected: nombre del plan fixture, checkbox abierto correcto y `ledger_recovered: true`. Comprobar que el heartbeat registra evento `compact`.

- [ ] **Step 6: Registrar evidencia sin transcript**

Run:

```bash
cd cli
npm run e2e:codex:evidence -- \
  --surface local-real \
  --result passed \
  --checks '{"awmActive":true,"nextSkill":"development-process","constitutionLoaded":true,"nativeAgentAvailable":true,"hookHealthy":true,"compactRecovered":true}'
```

Expected: JSON válido bajo `docs/evidence/codex-e2e/`; no guardar conversación, auth ni token.

- [ ] **Step 7: Remover el entorno temporal**

Borrar únicamente el path exacto impreso por `mktemp -d` después de comprobar que empieza por el directorio temporal del sistema. Informar que la autenticación temporal se eliminó con ese directorio.

- [ ] **Step 8: Commit de evidencia local**

```bash
git add docs/evidence/codex-e2e/local-real.json
git commit -m "test: record real local Codex verification"
```

### Task 6: Activación controlada en el home real con rollback

_Requirements: R11, R19, R19.1, R24, R24.1, R25, R26_

**Files:**
- Create: `docs/evidence/codex-e2e/live-coexistence.json`

- [ ] **Step 1: Capturar baseline read-only**

Run:

```bash
preflight_dir="$(mktemp -d)"
cd cli
npm run e2e:codex:preflight -- "$preflight_dir/before.json"
awm doctor --agent claude-code --json
awm agent list --json
```

Expected: el snapshot contiene hashes/metadata y diagnóstico, no contenidos ni secretos. No ejecutar aún `awm init --agent codex`.

- [ ] **Step 2: Presentar preflight y pausar por aprobación explícita**

Mostrar al usuario:

- versión CLI/Codex;
- agentes habilitados/default;
- estado Claude Code;
- lista exacta de archivos que la activación podría modificar;
- ruta del directorio de backup que se creará;
- comando exacto `awm init --agent codex --yes`;
- procedimiento `awm backup restore` usando el ID capturado de la transacción.

Detener la ejecución y esperar un “aprobado” explícito. La aprobación dada para escribir estos planes no cuenta como aprobación de la mutación live.

- [ ] **Step 3: Activar sólo Codex y capturar transaction ID**

Tras aprobación:

Run:

```bash
awm init --agent codex --yes --json > "$preflight_dir/init.json"
node -e "const fs=require('fs'); const value=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!value.transactionId) process.exit(1); process.stdout.write(value.transactionId + '\n')" "$preflight_dir/init.json"
```

Expected:

- Codex queda en `enabledAgents`;
- `defaultAgent` y agentes existentes se conservan;
- la salida incluye `transactionId`;
- ningún path bajo `~/.claude` figura en `modifiedFiles`;
- existe un manifest de backup para cada archivo preexistente modificado.

- [ ] **Step 4: Comparar baseline inmediatamente**

Run:

```bash
cd cli
npm run e2e:codex:preflight -- "$preflight_dir/after.json"
npm run e2e:codex:compare -- "$preflight_dir/before.json" "$preflight_dir/after.json"
```

Expected: `{ "ok": true, "regressions": [] }`.

- [ ] **Step 5: Ejecutar rollback ante cualquier regresión**

Si Step 4 retorna no-cero:

Run:

```bash
transaction_id="$(node -e "const fs=require('fs'); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).transactionId)" "$preflight_dir/init.json")"
awm backup restore "$transaction_id"
npm run e2e:codex:preflight -- "$preflight_dir/restored.json"
npm run e2e:codex:compare -- "$preflight_dir/before.json" "$preflight_dir/restored.json"
```

Expected: comparación restaurada `ok: true`; registrar evidencia `failed`, detener y no declarar Codex completo.

- [ ] **Step 6: Verificar coexistencia si no hubo regresión**

Run:

```bash
awm doctor --agent claude-code,opencode,codex --json
awm update
awm sync
```

Expected: todos los habilitados se reportan; OpenCode/Codex comparten un target físico de skills; Claude mantiene su hook/config y rutas independientes.

- [ ] **Step 7: Registrar evidencia**

Run:

```bash
cd cli
npm run e2e:codex:evidence -- \
  --surface live-coexistence \
  --result passed \
  --checks '{"preflightCaptured":true,"backupsComplete":true,"claudeUnchanged":true,"opencodePreserved":true,"codexHealthy":true}'
```

Expected: evidencia válida sin secretos.

- [ ] **Step 8: Commit de evidencia de coexistencia**

```bash
git add docs/evidence/codex-e2e/live-coexistence.json
git commit -m "test: record live Codex coexistence"
```

### Task 7: Codex cloud y `@codex review`

_Requirements: R3, R6, R21, R21.1, R21.2, R22, R26_

**Files:**
- Create: `docs/evidence/codex-e2e/cloud.json`
- Create: `docs/evidence/codex-e2e/github-review.json`
- Modify: `docs/runbook.md`

- [ ] **Step 1: Configurar un environment Codex cloud con el script público**

Usar `docs/codex-cloud-setup.sh` como setup. No añadir secretos de GitHub para registries ni el registry personal. Ejecutar el setup contra el mismo commit de la rama de implementación.

Expected: npm y registries públicos accesibles en setup; el agent phase puede operar sin network adicional para cargar skills.

- [ ] **Step 2: Ejecutar una tarea cloud representativa**

Prompt exacto:

```text
Usa el proceso AWM de desarrollo. No implementes. Identifica la fase actual de este repositorio, el plan activo, una regla de CONSTITUTION.md y el siguiente skill que propondrías. Responde con esos cuatro campos y no modifiques archivos.
```

Expected:

- reconoce `development-process`;
- identifica el plan activo;
- recupera una regla de constitución mediante `AGENTS.md`;
- propone el siguiente skill correcto;
- `git diff --exit-code -- AGENTS.md CONSTITUTION.md .awm/profile.json` sigue limpio.

- [ ] **Step 3: Registrar evidencia cloud**

Run:

```bash
cd cli
npm run e2e:codex:evidence -- \
  --surface cloud \
  --result passed \
  --checks '{"publicRegistriesOnly":true,"versionedGuidanceUnchanged":true,"generatedArtifactsReconstructed":true,"developmentProcessActive":true}'
```

Expected: evidencia válida.

- [ ] **Step 4: Verificar la evidencia del review ejecutado antes del release**

Confirmar que el `AGENTS.md` aplicable contenía `## Code Review Rules` o una regla inequívoca comprobable cuando Task 4 ejecutó `@codex review`. Expected: URL del PR, review completado y resumen que demuestra la regla recibida. Si Task 4 no lo demostró, R22 queda fallido y no se sustituye con una afirmación manual.

- [ ] **Step 5: Registrar evidencia GitHub**

Guardar sólo URL/ID del PR y estados, no tokens ni transcript completo:

```bash
cd cli
pr_url="$(gh pr view --json url --jq .url)"
npm run e2e:codex:evidence -- \
  --surface github-review \
  --result passed \
  --checks '{"agentsRulesReceived":true,"reviewCompleted":true}' \
  --artifact-ref "$pr_url"
```

- [ ] **Step 6: Actualizar runbook con resultados y troubleshooting**

Documentar:

- fecha y versiones exactas verificadas;
- diferencia `pending-trust` vs `healthy`;
- reconstrucción cloud sin registry personal;
- comando de preflight/compare/restore;
- criterio de aceptación de `@codex review`;
- enlaces relativos a los cinco archivos de evidencia.

- [ ] **Step 7: Verificación final**

Run: `cd cli && npm test -- --runInBand && npm run build`

Expected: PASS.

Run: `node /Users/cencosud/Developments/personal/awm-baseline-registry/scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`.

Run: `git diff --check`

Expected: sin output en ambos repos.

Run: `awm sensors run`

Expected: `overall: "passed"`. Si seguridad queda `skipped` por trust anchors vacíos, el cierre permanece bloqueado hasta resolver el entorno o registrar el gate como no ejecutable con aprobación explícita; no se reporta como pass.

- [ ] **Step 8: Commit y PR de evidencia**

```bash
git add docs/evidence/codex-e2e/cloud.json docs/evidence/codex-e2e/github-review.json docs/runbook.md
git commit -m "docs: record Codex end-to-end verification"
git push -u origin codex/codex-e2e-evidence
```

Abrir un PR listo para review con links a los cinco artefactos y el veredicto de cada superficie. No incluir el directorio temporal de preflight ni credenciales.

## Traceability matrix

| Req | Task(s) | Test(s) / evidencia |
|---|---|---|
| R1 | T1 | runner aislado comprueba init, skill y agente Codex |
| R2 | T4 | smoke del paquete estable y versión npm |
| R3 | T5, T7 | respuestas local-real/cloud prueban activación |
| R3.1 | T5 | `/compact`, plan/ledger y heartbeat |
| R6 | T5, T7 | regla de constitución observada local/cloud |
| R7 | T1 | shared skill path evidence |
| R8 | T1, T5 | TOML presente y agente nativo disponible |
| R11 | T1, T6 | enabled-agent evidence y live coexistence |
| R15 | T1, T6 | un target físico con dos owners |
| R18 | T5 | doctor pending→healthy y heartbeat hash |
| R19 | T1, T6 | hash/tree Claude aislado y comparación live |
| R19.1 | T1, T6 | OpenCode instructions preservadas y doctor live |
| R21 | T2, T4, T7 | tests estáticos/conductuales y evidencia cloud pública |
| R21.1 | T2, T7 | `git diff --exit-code` del setup y cloud |
| R21.2 | T2, T7 | call log `awm sync` y artifacts reconstruidos |
| R22 | T4, T7 | `@codex review` antes del merge; URL y resumen gobernado por AGENTS |
| R23 | T1–T3, T5 | asserts de rutas temporales, runner y CODEX_HOME aislado |
| R24 | T3, T6 | snapshot read-only y evidencia before |
| R24.1 | T6 | manifest de backup completo antes de mutación |
| R25 | T3, T6 | compare test y ruta restore+recompare |
| R26 | T1, T5–T7 | evidencia isolated, local-real, live, cloud y GitHub |

## Analyze gate

- Forward coverage: todos R1–R26 que requieren evidencia de rollout tienen task y prueba/artefacto específico.
- Backward coverage: runners, scripts, evidencia, release coordination y pasos externos trazan a requisitos de E2E, seguridad o cloud.
- Secret hygiene: schema/recorder bloquean credenciales; no se copia auth al home temporal.
- Live safety: ninguna mutación real ocurre antes de la pausa explícita de Task 6 Step 2.
- Release safety: npm y tags son automáticos; el plan sólo observa releases y actualiza el gate del registry con el semver estable real.
