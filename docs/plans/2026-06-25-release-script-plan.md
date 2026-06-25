# Release Script Implementation Plan
<!-- awm-qa-complete: 2026-06-25 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un comando `npm run release` que detecta el bump de versión desde Conventional Commits, actualiza `package.json` + `CHANGELOG.md`, crea commit + tag `vX.Y.Z` y publica `agentic-workflow-manager` a npm, ejecutable desde un contenedor cloud.

**Architecture:** Pure/IO split en TypeScript bajo `cli/src/release/`. `core.ts` concentra toda la lógica pura (parseo de commits, decisión de bump, cálculo de versión, render de changelog, validadores) y es 100% unit-testeable. `orchestrator.ts` expone `release(opts, io)` con un objeto `io` inyectable (git/npm/fs) — los tests inyectan un fake que graba comandos, así que **nunca** publican de verdad. `index.ts` es el bin: parsea argv, arma el `io` real (basado en `execSync`) y setea el exit code.

**Tech Stack:** TypeScript, Node built-ins (`child_process`, `fs`), `jest`/`ts-jest` (config existente), reuso de `compareSemver` de `src/core/versioning.ts`.

---

## File Structure

| Archivo | Responsabilidad |
|---------|-----------------|
| `cli/src/release/core.ts` (crear) | Tipos + lógica pura: `parseCommits`, `determineBump`, `nextVersion`, `renderChangelog`, `selectFloor`, constantes |
| `cli/src/release/orchestrator.ts` (crear) | `release(opts, io)` — gates, secuencia de efectos, limpieza de `.npmrc`; `ReleaseIO`/`ReleaseOpts`/`ReleaseResult` |
| `cli/src/release/index.ts` (crear) | Bin: parseo de argv, `io` real (execSync + fs), exit code |
| `cli/tests/release/core.test.ts` (crear) | Unit tests de las funciones puras |
| `cli/tests/release/orchestrator.test.ts` (crear) | Tests de gates + argv con `io` fake |
| `cli/package.json` (modificar) | Script `release` |
| `.gitignore` (modificar) | Ignorar `cli/.npmrc` |
| `.github/workflows/release.yml` (crear) | Workflow CI de ejemplo |

**Constantes compartidas** (en `core.ts`):
```ts
export const PKG_NAME = 'agentic-workflow-manager';
export const RS = '\x1e'; // record separator entre commits
export const US = '\x1f'; // unit separator subject/body
export const GIT_LOG_FORMAT = `%s${US}%b${RS}`;
```

---

## Task 1: Tipos + `parseCommits`

**Files:**
- Create: `cli/src/release/core.ts`
- Test: `cli/tests/release/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cli/tests/release/core.test.ts
import { parseCommits, RS, US } from '../../src/release/core';

const rec = (header: string, body = '') => `${header}${US}${body}${RS}`;

describe('parseCommits', () => {
  it('parsea type, scope, subject', () => {
    const [c] = parseCommits(rec('feat(add): nueva flag'));
    expect(c).toEqual({ type: 'feat', scope: 'add', breaking: false, subject: 'nueva flag' });
  });

  it('scope null cuando no hay paréntesis', () => {
    expect(parseCommits(rec('fix: corrige bug'))[0].scope).toBeNull();
  });

  it('breaking por bang en el header', () => {
    expect(parseCommits(rec('feat!: rompe API'))[0].breaking).toBe(true);
  });

  it('breaking por footer BREAKING CHANGE en el body', () => {
    expect(parseCommits(rec('feat(x): y', 'cuerpo\nBREAKING CHANGE: cambia todo'))[0].breaking).toBe(true);
  });

  it('descarta commits no convencionales sin romper', () => {
    expect(parseCommits(rec('merge branch foo') + rec('feat: ok'))).toEqual([
      { type: 'feat', scope: null, breaking: false, subject: 'ok' },
    ]);
  });

  it('entrada vacía → arreglo vacío', () => {
    expect(parseCommits('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/core.test.ts -t parseCommits`
Expected: FAIL — `Cannot find module '../../src/release/core'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// cli/src/release/core.ts
export const PKG_NAME = 'agentic-workflow-manager';
export const RS = '\x1e';
export const US = '\x1f';
export const GIT_LOG_FORMAT = `%s${US}%b${RS}`;

export type Bump = 'major' | 'minor' | 'patch';

export interface Commit {
  type: string;
  scope: string | null;
  breaking: boolean;
  subject: string;
}

const HEADER_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

function parseOne(record: string): Commit | null {
  const [header, ...rest] = record.split(US);
  const body = rest.join(US);
  const m = HEADER_RE.exec(header.trim());
  if (!m) return null;
  return {
    type: m[1],
    scope: m[2] ?? null,
    breaking: Boolean(m[3]) || /^BREAKING CHANGE:/m.test(body),
    subject: m[4].trim(),
  };
}

export function parseCommits(raw: string): Commit[] {
  return raw
    .split(RS)
    .map((r) => r.trim())
    .filter(Boolean)
    .map(parseOne)
    .filter((c): c is Commit => c !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/core.test.ts -t parseCommits`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/core.ts cli/tests/release/core.test.ts
git commit -m "feat(release): parseCommits + tipos del core"
```

---

## Task 2: `determineBump`

**Files:**
- Modify: `cli/src/release/core.ts`
- Test: `cli/tests/release/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// añadir a cli/tests/release/core.test.ts
import { determineBump } from '../../src/release/core';
import type { Commit } from '../../src/release/core';

const mk = (type: string, breaking = false): Commit => ({ type, scope: null, breaking, subject: 's' });

describe('determineBump', () => {
  it('breaking → major (gana sobre feat/fix)', () => {
    expect(determineBump([mk('fix'), mk('feat', true)])).toBe('major');
  });
  it('feat sin breaking → minor', () => {
    expect(determineBump([mk('fix'), mk('feat')])).toBe('minor');
  });
  it('fix o perf → patch', () => {
    expect(determineBump([mk('fix')])).toBe('patch');
    expect(determineBump([mk('perf')])).toBe('patch');
  });
  it('solo docs/chore/refactor → null (nada releasable)', () => {
    expect(determineBump([mk('docs'), mk('chore'), mk('refactor')])).toBeNull();
  });
  it('lista vacía → null', () => {
    expect(determineBump([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/core.test.ts -t determineBump`
Expected: FAIL — `determineBump is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a cli/src/release/core.ts
export function determineBump(commits: Commit[]): Bump | null {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  if (commits.some((c) => c.type === 'fix' || c.type === 'perf')) return 'patch';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/core.test.ts -t determineBump`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/core.ts cli/tests/release/core.test.ts
git commit -m "feat(release): determineBump por Conventional Commits"
```

---

## Task 3: `nextVersion` (con validación fail-loud)

**Files:**
- Modify: `cli/src/release/core.ts`
- Test: `cli/tests/release/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// añadir a cli/tests/release/core.test.ts
import { nextVersion } from '../../src/release/core';

describe('nextVersion', () => {
  it('major resetea minor y patch', () => {
    expect(nextVersion('2.1.1', 'major')).toBe('3.0.0');
  });
  it('minor resetea patch', () => {
    expect(nextVersion('2.1.1', 'minor')).toBe('2.2.0');
  });
  it('patch incrementa patch', () => {
    expect(nextVersion('2.1.1', 'patch')).toBe('2.1.2');
  });
  it('tolera espacios alrededor', () => {
    expect(nextVersion('  2.1.1  ', 'patch')).toBe('2.1.2');
  });
  it.each(['', '.', '..', 'x.y.z', '2.1', '2.1.1.0'])('rechaza base inválida %p', (bad) => {
    expect(() => nextVersion(bad as string, 'patch')).toThrow(/invalid base version/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/core.test.ts -t nextVersion`
Expected: FAIL — `nextVersion is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a cli/src/release/core.ts
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextVersion(base: string, bump: Bump): string {
  const m = SEMVER_RE.exec((base ?? '').trim());
  if (!m) throw new Error(`Invalid base version: "${base}"`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/core.test.ts -t nextVersion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/core.ts cli/tests/release/core.test.ts
git commit -m "feat(release): nextVersion con validación semver fail-loud"
```

---

## Task 4: `selectFloor` (reusa `compareSemver`)

**Files:**
- Modify: `cli/src/release/core.ts`
- Test: `cli/tests/release/core.test.ts`

Calcula la base del bump como `max(currentPkgVersion, lastTagVersion)` para garantizar monotonicidad con el drift tag↔versión.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a cli/tests/release/core.test.ts
import { selectFloor } from '../../src/release/core';

describe('selectFloor', () => {
  it('sin tag → usa la versión del package.json', () => {
    expect(selectFloor('2.1.1', null)).toBe('2.1.1');
  });
  it('package.json mayor que el tag → gana package.json (caso drift real)', () => {
    expect(selectFloor('2.1.1', '1.0.0')).toBe('2.1.1');
  });
  it('tag mayor que package.json → gana el tag', () => {
    expect(selectFloor('2.1.1', '2.5.0')).toBe('2.5.0');
  });
  it('iguales → ese valor', () => {
    expect(selectFloor('2.1.1', '2.1.1')).toBe('2.1.1');
  });
  it('rechaza current inválido', () => {
    expect(() => selectFloor('', null)).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/core.test.ts -t selectFloor`
Expected: FAIL — `selectFloor is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a cli/src/release/core.ts
import { compareSemver } from '../core/versioning';

export function selectFloor(current: string, lastTagVersion: string | null): string {
  if (!SEMVER_RE.test((current ?? '').trim())) {
    throw new Error(`Invalid current version: "${current}"`);
  }
  const cur = current.trim();
  if (!lastTagVersion) return cur;
  return compareSemver(cur, lastTagVersion) >= 0 ? cur : lastTagVersion;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/core.test.ts -t selectFloor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/core.ts cli/tests/release/core.test.ts
git commit -m "feat(release): selectFloor reusa compareSemver para monotonicidad"
```

---

## Task 5: `renderChangelog`

**Files:**
- Modify: `cli/src/release/core.ts`
- Test: `cli/tests/release/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// añadir a cli/tests/release/core.test.ts
import { renderChangelog } from '../../src/release/core';

describe('renderChangelog', () => {
  const commits: Commit[] = [
    { type: 'feat', scope: 'add', breaking: false, subject: 'flag --all' },
    { type: 'fix', scope: null, breaking: false, subject: 'corrige width' },
    { type: 'chore', scope: null, breaking: true, subject: 'sube node' },
  ];

  it('encabeza con versión y fecha', () => {
    expect(renderChangelog('2.2.0', '2026-06-25', commits)).toContain('## v2.2.0 - 2026-06-25');
  });
  it('agrupa Features, Fixes y Breaking Changes', () => {
    const md = renderChangelog('2.2.0', '2026-06-25', commits);
    expect(md).toContain('### Features');
    expect(md).toContain('- **add:** flag --all');
    expect(md).toContain('### Fixes');
    expect(md).toContain('- corrige width');
    expect(md).toContain('### Breaking Changes');
    expect(md).toContain('- sube node');
  });
  it('omite secciones vacías', () => {
    const md = renderChangelog('2.2.1', '2026-06-25', [
      { type: 'fix', scope: null, breaking: false, subject: 'x' },
    ]);
    expect(md).toContain('### Fixes');
    expect(md).not.toContain('### Features');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/core.test.ts -t renderChangelog`
Expected: FAIL — `renderChangelog is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a cli/src/release/core.ts
function line(c: Commit): string {
  return c.scope ? `- **${c.scope}:** ${c.subject}` : `- ${c.subject}`;
}

export function renderChangelog(version: string, dateISO: string, commits: Commit[]): string {
  const sections: string[] = [`## v${version} - ${dateISO}`, ''];
  const groups: Array<[string, (c: Commit) => boolean]> = [
    ['Breaking Changes', (c) => c.breaking],
    ['Features', (c) => !c.breaking && c.type === 'feat'],
    ['Fixes', (c) => !c.breaking && (c.type === 'fix' || c.type === 'perf')],
  ];
  for (const [title, pred] of groups) {
    const items = commits.filter(pred);
    if (items.length === 0) continue;
    sections.push(`### ${title}`, ...items.map(line), '');
  }
  return sections.join('\n').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/core.test.ts -t renderChangelog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/core.ts cli/tests/release/core.test.ts
git commit -m "feat(release): renderChangelog agrupado por tipo"
```

---

## Task 6: Orquestador — happy path + dry-run (IO inyectable)

**Files:**
- Create: `cli/src/release/orchestrator.ts`
- Test: `cli/tests/release/orchestrator.test.ts`

El orquestador es síncrono (usa `execSync` en el `io` real). Toda I/O pasa por `ReleaseIO` para poder grabar comandos en tests sin tocar npm/red.

- [ ] **Step 1: Write the failing test**

```ts
// cli/tests/release/orchestrator.test.ts
import { release, ReleaseIO, ReleaseOpts } from '../../src/release/orchestrator';
import { GIT_LOG_FORMAT, US, RS } from '../../src/release/core';

function makeIO(over: Partial<ReleaseIO> & { commits?: string; tags?: string; npmView?: string } = {}): {
  io: ReleaseIO; calls: string[];
} {
  const calls: string[] = [];
  let pkgVersion = '2.1.1';
  const io: ReleaseIO = {
    run(cmd, args) {
      const full = `${cmd} ${args.join(' ')}`;
      calls.push(full);
      if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'main';
      if (cmd === 'git' && args[0] === 'status') return '';
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list' && args[2] === 'v*') return over.tags ?? '';
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return ''; // gate: tag puntual no existe
      if (cmd === 'git' && args[0] === 'log') return over.commits ?? `feat: nueva${US}${RS}`;
      if (cmd === 'npm' && args[0] === 'view') return over.npmView ?? '';
      return '';
    },
    readPackageVersion: () => pkgVersion,
    writePackageVersion: (v) => { pkgVersion = v; calls.push(`WRITE_PKG ${v}`); },
    readChangelog: () => '',
    writeChangelog: (c) => calls.push(`WRITE_CHANGELOG ${c.split('\n')[0]}`),
    writeNpmrc: () => calls.push('WRITE_NPMRC'),
    removeNpmrc: () => calls.push('REMOVE_NPMRC'),
    today: () => '2026-06-25',
    log: () => {},
    env: { NPM_TOKEN: 'tok' },
    ...over,
  };
  return { io, calls };
}

const opts = (o: Partial<ReleaseOpts> = {}): ReleaseOpts =>
  ({ dryRun: false, force: null, push: true, branch: 'main', cliDir: '/cli', ...o });

describe('release — happy path', () => {
  it('feat → minor: escribe versión, commitea, taggea, publica y pushea en orden', () => {
    const { io, calls } = makeIO({ commits: `feat: x${US}${RS}` });
    const res = release(opts(), io);
    expect(res).toEqual({ released: true, version: '2.2.0' });
    expect(calls).toContain('WRITE_PKG 2.2.0');
    const joined = calls.join('\n');
    expect(joined).toMatch(/git commit .*chore\(release\): v2.2.0/);
    expect(joined).toMatch(/git tag -a v2.2.0/);
    expect(joined).toMatch(/npm publish/);
    expect(joined).toMatch(/git push origin main/);
    expect(joined).toMatch(/git push origin v2.2.0/);
    // npmrc creado y SIEMPRE removido
    expect(calls).toContain('WRITE_NPMRC');
    expect(calls).toContain('REMOVE_NPMRC');
  });

  it('sin commits releasables → no publica (exit 0 lógico)', () => {
    const { io, calls } = makeIO({ commits: `docs: solo docs${US}${RS}` });
    const res = release(opts(), io);
    expect(res.released).toBe(false);
    expect(res.reason).toMatch(/nada que publicar|no releasable/i);
    expect(calls).not.toContain('WRITE_PKG 2.1.2');
    expect(calls.join('\n')).not.toMatch(/npm publish/);
  });

  it('--force patch publica aunque no haya commits releasables', () => {
    const { io } = makeIO({ commits: `docs: x${US}${RS}` });
    expect(release(opts({ force: 'patch' }), io)).toEqual({ released: true, version: '2.1.2' });
  });

  it('--dry-run calcula la versión pero NO escribe ni publica', () => {
    const { io, calls } = makeIO({ commits: `feat: x${US}${RS}` });
    const res = release(opts({ dryRun: true }), io);
    expect(res).toEqual({ released: false, version: '2.2.0', reason: 'dry-run' });
    expect(calls.join('\n')).not.toMatch(/npm publish|WRITE_PKG|git commit/);
  });

  it('--no-push omite los push', () => {
    const { io, calls } = makeIO({ commits: `feat: x${US}${RS}` });
    release(opts({ push: false }), io);
    expect(calls.join('\n')).not.toMatch(/git push/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/orchestrator.test.ts -t "happy path"`
Expected: FAIL — `Cannot find module '../../src/release/orchestrator'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// cli/src/release/orchestrator.ts
import {
  Bump, PKG_NAME, GIT_LOG_FORMAT, determineBump, nextVersion,
  parseCommits, renderChangelog, selectFloor,
} from './core';

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface ReleaseIO {
  run(cmd: string, args: string[], opts?: { cwd?: string }): string;
  readPackageVersion(): string;
  writePackageVersion(v: string): void;
  readChangelog(): string;
  writeChangelog(content: string): void;
  writeNpmrc(token: string): void;
  removeNpmrc(): void;
  today(): string;
  log(msg: string): void;
  env: NodeJS.ProcessEnv;
}

export interface ReleaseOpts {
  dryRun: boolean;
  force: Bump | null;
  push: boolean;
  branch: string;
  cliDir: string;
}

export interface ReleaseResult {
  released: boolean;
  version?: string;
  reason?: string;
}

function highestTag(io: ReleaseIO): string | null {
  const raw = io.run('git', ['tag', '--list', 'v*']).trim();
  const tags = raw.split('\n').map((t) => t.trim()).filter((t) => TAG_RE.test(t));
  if (tags.length === 0) return null;
  tags.sort((a, b) => {
    const [, a1, a2, a3] = TAG_RE.exec(a)!.map(Number);
    const [, b1, b2, b3] = TAG_RE.exec(b)!.map(Number);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });
  return tags[tags.length - 1];
}

export function release(opts: ReleaseOpts, io: ReleaseIO): ReleaseResult {
  // baseline
  const current = io.readPackageVersion();
  const lastTag = highestTag(io);              // "vX.Y.Z" | null
  const lastTagVersion = lastTag ? lastTag.slice(1) : null;
  const floor = selectFloor(current, lastTagVersion);

  // rango de commits (solo cli/)
  const range = lastTag ? [`${lastTag}..HEAD`] : [];
  const logArgs = ['log', ...range, '--no-merges', `--format=${GIT_LOG_FORMAT}`, '--', 'cli/'];
  const commits = parseCommits(io.run('git', logArgs));

  // bump
  const bump = opts.force ?? determineBump(commits);
  if (!bump) return { released: false, reason: 'nada que publicar (no releasable commits)' };

  const version = nextVersion(floor, bump);

  // GATE idempotencia
  if (io.run('git', ['tag', '--list', `v${version}`]).trim()) {
    throw new Error(`El tag v${version} ya existe — abortando`);
  }
  let published = '';
  try { published = io.run('npm', ['view', `${PKG_NAME}@${version}`, 'version']).trim(); } catch { published = ''; }
  if (published) throw new Error(`${PKG_NAME}@${version} ya está publicado en npm — abortando`);

  if (opts.dryRun) {
    io.log(`[dry-run] publicaría v${version} (bump=${bump}, base=${floor})`);
    return { released: false, version, reason: 'dry-run' };
  }

  // aplicar
  io.writePackageVersion(version);
  const section = renderChangelog(version, io.today(), commits);
  io.writeChangelog(section + '\n' + io.readChangelog());
  io.run('git', ['add', 'cli/package.json', 'CHANGELOG.md']);
  io.run('git', ['commit', '-m', `chore(release): v${version} [skip ci]`]);
  io.run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);

  const token = io.env.NPM_TOKEN as string;
  try {
    io.writeNpmrc(token);
    io.run('npm', ['publish'], { cwd: opts.cliDir });
  } finally {
    io.removeNpmrc();
  }

  if (opts.push) {
    io.run('git', ['push', 'origin', opts.branch]);
    io.run('git', ['push', 'origin', `v${version}`]);
  }
  return { released: true, version };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/orchestrator.test.ts -t "happy path"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/orchestrator.ts cli/tests/release/orchestrator.test.ts
git commit -m "feat(release): orquestador release() con IO inyectable (happy path + dry-run)"
```

---

## Task 7: Orquestador — gates de preflight (orden de contrato)

**Files:**
- Modify: `cli/src/release/orchestrator.ts`
- Test: `cli/tests/release/orchestrator.test.ts`

Los gates de contrato (rama, working tree, NPM_TOKEN) van **antes** del early-exit de "nada que publicar" (regla CONSTITUTION). En `--dry-run` se relajan working-tree y token; `--force` relaja la rama.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a cli/tests/release/orchestrator.test.ts
describe('release — gates de preflight', () => {
  it('aborta si la rama no es la esperada', () => {
    const fake = makeIO().io;
    const origRun = fake.run;
    (fake.run as any) = (cmd: string, args: string[], o?: any) =>
      cmd === 'git' && args[0] === 'rev-parse' ? 'feature/x' : origRun(cmd, args, o);
    expect(() => release(opts(), fake)).toThrow(/rama|branch/i);
  });

  it('--force relaja el gate de rama', () => {
    const fake = makeIO({ commits: `feat: x${US}${RS}` }).io;
    const origRun = fake.run;
    (fake.run as any) = (cmd: string, args: string[], o?: any) =>
      cmd === 'git' && args[0] === 'rev-parse' ? 'feature/x' : origRun(cmd, args, o);
    expect(() => release(opts({ force: 'patch' }), fake)).not.toThrow();
  });

  it('aborta si el working tree está sucio', () => {
    const fake = makeIO().io;
    const origRun = fake.run;
    (fake.run as any) = (cmd: string, args: string[], o?: any) =>
      cmd === 'git' && args[0] === 'status' ? ' M cli/src/x.ts' : origRun(cmd, args, o);
    expect(() => release(opts(), fake)).toThrow(/working tree|sin commitear|dirty/i);
  });

  it('aborta si falta NPM_TOKEN', () => {
    const fake = makeIO().io;
    fake.env = {};
    expect(() => release(opts(), fake)).toThrow(/NPM_TOKEN/);
  });

  it('el gate de token corre ANTES del early-exit de "nada que publicar"', () => {
    const fake = makeIO({ commits: `docs: x${US}${RS}` }).io; // sin commits releasables
    fake.env = {};
    expect(() => release(opts(), fake)).toThrow(/NPM_TOKEN/); // no devuelve {released:false}
  });

  it('--dry-run no exige NPM_TOKEN ni working tree limpio', () => {
    const fake = makeIO({ commits: `feat: x${US}${RS}` }).io;
    fake.env = {};
    const origRun = fake.run;
    (fake.run as any) = (cmd: string, args: string[], o?: any) =>
      cmd === 'git' && args[0] === 'status' ? ' M x' : origRun(cmd, args, o);
    expect(release(opts({ dryRun: true }), fake).version).toBe('2.2.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/orchestrator.test.ts -t "gates de preflight"`
Expected: FAIL — actualmente no hay gates; los `expect(...).toThrow` no se cumplen.

- [ ] **Step 3: Write minimal implementation**

Añadir al inicio de `release()`, **antes** de calcular baseline:

```ts
// --- preflight gates (contrato, antes de cualquier early-exit) ---
if (!opts.force) {
  const branch = io.run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== opts.branch) {
    throw new Error(`Rama actual "${branch}" != esperada "${opts.branch}" (usá --force para relajar)`);
  }
}
if (!opts.dryRun) {
  const dirty = io.run('git', ['status', '--porcelain']).trim();
  if (dirty) throw new Error('Working tree con cambios sin commitear — abortando');
  if (!io.env.NPM_TOKEN) throw new Error('Falta NPM_TOKEN en el entorno — requerido para publicar');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/orchestrator.test.ts`
Expected: PASS (todos: happy path + gates).

- [ ] **Step 5: Commit**

```bash
git add cli/src/release/orchestrator.ts cli/tests/release/orchestrator.test.ts
git commit -m "feat(release): gates de preflight con orden de contrato (CONSTITUTION)"
```

---

## Task 8: Bin `index.ts` + script npm + gitignore

**Files:**
- Create: `cli/src/release/index.ts`
- Modify: `cli/package.json`
- Modify: `.gitignore`
- Test: `cli/tests/release/orchestrator.test.ts` (test de `parseArgs`)

`index.ts` exporta `parseArgs` (puro, testeable) y un `main()` que arma el `io` real con `execSync` + `fs`.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a cli/tests/release/orchestrator.test.ts
import { parseArgs } from '../../src/release/index';

describe('parseArgs', () => {
  it('defaults', () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, force: null, push: true, branch: 'main' });
  });
  it('--dry-run, --no-push, --force minor, --branch release', () => {
    expect(parseArgs(['--dry-run', '--no-push', '--force', 'minor', '--branch', 'release']))
      .toMatchObject({ dryRun: true, push: false, force: 'minor', branch: 'release' });
  });
  it('rechaza --force con nivel inválido', () => {
    expect(() => parseArgs(['--force', 'huge'])).toThrow(/force/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/release/orchestrator.test.ts -t parseArgs`
Expected: FAIL — `Cannot find module '../../src/release/index'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// cli/src/release/index.ts
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Bump } from './core';
import { release, ReleaseIO, ReleaseOpts } from './orchestrator';

export function parseArgs(argv: string[]): ReleaseOpts {
  const opts: ReleaseOpts = { dryRun: false, force: null, push: true, branch: 'main', cliDir: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-push') opts.push = false;
    else if (a === '--branch') opts.branch = argv[++i] ?? 'main';
    else if (a === '--force') {
      const lvl = argv[++i];
      if (lvl !== 'major' && lvl !== 'minor' && lvl !== 'patch') {
        throw new Error(`--force requiere major|minor|patch, recibió "${lvl}"`);
      }
      opts.force = lvl as Bump;
    } else {
      throw new Error(`Flag desconocida: ${a}`);
    }
  }
  return opts;
}

function realIO(repoRoot: string, cliDir: string): ReleaseIO {
  const pkgPath = path.join(cliDir, 'package.json');
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  const npmrcPath = path.join(cliDir, '.npmrc');
  return {
    run(cmd, args, o) {
      return execFileSync(cmd, args, { cwd: o?.cwd ?? repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    },
    readPackageVersion: () => JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version,
    writePackageVersion: (v) => {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.version = v;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    },
    readChangelog: () => (fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : ''),
    writeChangelog: (c) => fs.writeFileSync(changelogPath, c),
    writeNpmrc: (token) => fs.writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\n`),
    removeNpmrc: () => { if (fs.existsSync(npmrcPath)) fs.rmSync(npmrcPath); },
    today: () => new Date().toISOString().slice(0, 10),
    log: (m) => console.log(m),
    env: process.env,
  };
}

export function main(argv: string[]): number {
  let opts: ReleaseOpts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const repoRoot = path.resolve(__dirname, '..', '..', '..'); // dist/src/release → repo root
  const cliDir = path.resolve(repoRoot, 'cli');
  opts.cliDir = cliDir;
  try {
    const res = release(opts, realIO(repoRoot, cliDir));
    if (res.released) console.log(`✓ Publicado v${res.version}`);
    else console.log(`· Sin release: ${res.reason}${res.version ? ` (v${res.version})` : ''}`);
    return 0;
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/release/orchestrator.test.ts -t parseArgs`
Expected: PASS.

- [ ] **Step 5: Add npm script + gitignore**

En `cli/package.json`, dentro de `"scripts"`, añadir:
```json
    "release": "node dist/src/release/index.js"
```

En `.gitignore` (raíz), añadir una línea:
```
cli/.npmrc
```

- [ ] **Step 6: Build + verificación end-to-end en dry-run**

Run:
```bash
cd cli && npm run build && node dist/src/release/index.js --dry-run
```
Expected: imprime `[dry-run] publicaría vX.Y.Z (...)` sin errores y sin modificar archivos (verificar `git status` limpio salvo los artefactos de build ya ignorados).

- [ ] **Step 7: Commit**

```bash
git add cli/src/release/index.ts cli/package.json .gitignore
git commit -m "feat(release): bin index.ts, npm script release y gitignore de .npmrc"
```

---

## Task 9: Workflow CI de ejemplo

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Crear el workflow**

```yaml
# .github/workflows/release.yml
name: release

on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry run (no publica)'
        type: boolean
        default: false

permissions:
  contents: write   # push de commit + tag

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # historia completa + tags para el bump
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - name: Configurar identidad git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Instalar y build
        working-directory: cli
        run: |
          npm ci
          npm run build

      - name: Release
        working-directory: cli
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          node dist/src/release/index.js ${{ inputs.dry_run && '--dry-run' || '' }}
```

- [ ] **Step 2: Validar sintaxis YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): workflow de ejemplo con dry-run opcional"
```

---

## Verificación final

- [ ] `cd cli && npm test` → toda la suite (incluida `tests/release/`) en verde.
- [ ] `cd cli && npm run build` → compila sin errores de TS.
- [ ] `node dist/src/release/index.js --dry-run` → plan impreso, sin efectos.
- [ ] `git status` limpio salvo artefactos ignorados.

---

## Notas de diseño aplicadas

- **Reuso (DRY):** `compareSemver` de `src/core/versioning.ts` en lugar de reimplementar comparación semver.
- **Pure/IO split:** `core.ts` sin I/O; `orchestrator.ts` con `ReleaseIO` inyectable → tests nunca publican ni tocan la red ni `~/.awm`.
- **Fail loud (invariante AWM):** `nextVersion`/`selectFloor` validan y lanzan; nunca devuelven `NaN`/`undefined`.
- **Orden de gates (CONSTITUTION):** gates de contrato (rama/working-tree/token) antes del early-exit de "nada que publicar".
- **Limpieza garantizada:** `.npmrc` temporal removido en `finally`, incluso si `npm publish` falla.
