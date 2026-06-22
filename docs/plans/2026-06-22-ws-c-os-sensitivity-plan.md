# WS-C: OS Sensitivity Phase 1 — Implementation Plan

<!-- awm-qa-complete: 2026-06-22 -->
<!-- awm-retro-complete: 2026-06-22 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the macOS-masked OS fragility in the AWM CLI by centralizing home/path/platform resolution into one module, close the unsafe `process.env.HOME!` gap, make symlink install degrade gracefully, warn native-Windows users toward WSL, and document the validated cloud + WSL flows.

**Architecture:** A new pure module `cli/src/core/paths.ts` exposes call-time functions (`homeDir`, `awmHome`, `platform`, `isWindowsNative`, `platformLabel`, `warnIfUnsupportedPlatform`). All duplicated `process.env.HOME || os.homedir()` / `AWM_HOME` expressions across the codebase are migrated to consume it. Two entry commands (`init`, `sync`) emit a WSL warning on native Windows but continue best-effort; `doctor` shows the detected platform. The skill symlink falls back to copy on failure. Windows-native support beyond the warning is explicitly deferred to WS-D.

**Tech Stack:** TypeScript, Node.js (`os`, `path`, `fs`), Jest (`jest --runInBand`), commander, picocolors.

**Reference:** Design doc `docs/plans/2026-06-22-ws-c-os-sensitivity-design.md`. Branch: `feat/ws-c-os-sensitivity`.

**Project rule (CLAUDE.md):** No test may touch the real `~/.awm`. All tests use isolated tmpdirs with `process.env.HOME` / `process.env.AWM_HOME` overridden. Run tests from `cli/` with `npm test`.

---

## Scope note on require-time constants

`cli/src/core/registries.ts` and `cli/src/providers/index.ts` build **module-level constants** (`AWM_HOME`/`REGISTRIES_DIR`, `PROVIDERS`) at require-time. These are imported as values across many files. This plan migrates the **duplicated expression** behind those consts to call `paths.awmHome()` / `paths.homeDir()` (eliminating duplication, finding H-2), but does **not** convert the consts themselves into functions — that would be a large ripple with no functional gain for this era. The new `paths.ts` functions are genuinely call-time, and its own tests need no `jest.resetModules()`. Existing `registries` tests keep their `resetModules()` setup unchanged (not a regression).

---

## Task 1: Create `core/paths.ts` (single source of truth)

**Files:**
- Create: `cli/src/core/paths.ts`
- Test: `cli/tests/core/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/core/paths.test.ts`:

```typescript
import os from 'os';
import path from 'path';
import {
  homeDir,
  awmHome,
  platform,
  isWindowsNative,
  platformLabel,
  warnIfUnsupportedPlatform,
  WINDOWS_NATIVE_WARNING,
} from '../../src/core/paths';

describe('core/paths', () => {
  let origHome: string | undefined;
  let origAwmHome: string | undefined;
  const realPlatform = process.platform;

  beforeEach(() => {
    origHome = process.env.HOME;
    origAwmHome = process.env.AWM_HOME;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = origAwmHome;
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  it('homeDir uses process.env.HOME when set', () => {
    process.env.HOME = '/tmp/fake-home';
    expect(homeDir()).toBe('/tmp/fake-home');
  });

  it('homeDir falls back to os.homedir() when HOME is unset', () => {
    delete process.env.HOME;
    expect(homeDir()).toBe(os.homedir());
  });

  it('awmHome honors AWM_HOME override', () => {
    process.env.AWM_HOME = '/tmp/custom-awm';
    expect(awmHome()).toBe('/tmp/custom-awm');
  });

  it('awmHome defaults to <home>/.awm when AWM_HOME is unset', () => {
    delete process.env.AWM_HOME;
    process.env.HOME = '/tmp/fake-home';
    expect(awmHome()).toBe(path.join('/tmp/fake-home', '.awm'));
  });

  it('platform reflects process.platform', () => {
    setPlatform('linux');
    expect(platform()).toBe('linux');
  });

  it('isWindowsNative is true only on win32', () => {
    setPlatform('win32');
    expect(isWindowsNative()).toBe(true);
    setPlatform('linux');
    expect(isWindowsNative()).toBe(false);
    setPlatform('darwin');
    expect(isWindowsNative()).toBe(false);
  });

  it('platformLabel describes each known platform', () => {
    setPlatform('linux');
    expect(platformLabel()).toBe('Linux');
    setPlatform('darwin');
    expect(platformLabel()).toBe('macOS');
    setPlatform('win32');
    expect(platformLabel()).toContain('WSL');
  });

  it('warnIfUnsupportedPlatform calls the logger only on win32', () => {
    const calls: string[] = [];
    const log = (m: string) => calls.push(m);

    setPlatform('linux');
    warnIfUnsupportedPlatform(log);
    expect(calls).toHaveLength(0);

    setPlatform('win32');
    warnIfUnsupportedPlatform(log);
    expect(calls).toEqual([WINDOWS_NATIVE_WARNING]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/paths.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/paths'`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/core/paths.ts`:

```typescript
// cli/src/core/paths.ts
//
// Single source of truth for home / AWM_HOME resolution and platform detection.
// Functions are evaluated at CALL TIME (not require time) so env overrides are
// always honored and tests need no jest.resetModules().
import os from 'os';
import path from 'path';

/** User home directory with a robust fallback. Never returns a raw, possibly-empty process.env.HOME. */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/** AWM home directory (~/.awm), honoring the AWM_HOME override. */
export function awmHome(): string {
  return process.env.AWM_HOME || path.join(homeDir(), '.awm');
}

/** Raw platform string (wrapper over process.platform for testability). */
export function platform(): NodeJS.Platform {
  return process.platform;
}

/** True only on native Windows. WSL reports 'linux', so this returns false there. */
export function isWindowsNative(): boolean {
  return platform() === 'win32';
}

/** Human-friendly platform label for diagnostics. */
export function platformLabel(): string {
  switch (platform()) {
    case 'win32':
      return 'Windows (native — not supported yet, use WSL)';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform();
  }
}

export const WINDOWS_NATIVE_WARNING =
  'AWM detected native Windows. Native support is deferred; the recommended path today is WSL.\n' +
  '  Install WSL (https://learn.microsoft.com/windows/wsl/install) and run AWM inside your Linux distro.\n' +
  '  Continuing in best-effort mode, but some steps (symlinks, hooks) may not work.';

/** Emit the unsupported-platform warning via the provided logger, only on native Windows. */
export function warnIfUnsupportedPlatform(log: (msg: string) => void): void {
  if (isWindowsNative()) log(WINDOWS_NATIVE_WARNING);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/paths.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/paths.ts cli/tests/core/paths.test.ts
git commit -m "feat(paths): add core/paths.ts single source of truth for home/platform"
```

---

## Task 2: Migrate call-sites to `paths.ts` (closes H-1, H-2)

**Files:**
- Modify: `cli/src/core/registries.ts:11`
- Modify: `cli/src/providers/index.ts:2,35-36`
- Modify: `cli/src/core/update-check.ts:21`
- Modify: `cli/src/core/context/materializer.ts:9-11`
- Modify: `cli/src/utils/config.ts:25-27`
- Modify: `cli/src/core/diagnostics/context.ts:16-17`
- Modify: `cli/src/commands/sensors/install.ts:12-14,26-29`
- Modify: `cli/src/commands/hooks/install.ts:30-33`
- Modify: `cli/src/commands/hooks/uninstall.ts:14-17`
- Test: existing suite (regression guard) + `cli/tests/commands/hooks/install.test.ts`

This task has no new test of its own — it is a behavior-preserving migration guarded by the **existing** suite. The H-1 fix (removing the unsafe `process.env.HOME!`) is the one behavior change; it is covered because the hooks install test already exercises `backupSettings` via `installHook`.

- [ ] **Step 1: Run the full suite first to capture the green baseline**

Run: `cd cli && npm test`
Expected: PASS (record the passing count; it must not drop after this task).

- [ ] **Step 2: Migrate `core/registries.ts`**

Replace lines 1-11 region. Change the import block and the `AWM_HOME` const:

```typescript
// src/core/registries.ts
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { resolveBaseRemote } from './registry';
import { resolveTargetRef, machineVersionOpts, compareSemver } from './versioning';
import { cliVersion } from './cli-version';
import { awmHome } from './paths';

// Computed at require-time by calling the shared resolver (single source of truth: core/paths.ts).
const AWM_HOME = awmHome();
```

(Remove the now-unused `import os from 'os';` only if `os` is not referenced elsewhere in the file — check with `grep -n "os\." cli/src/core/registries.ts`; if other uses exist, keep the import.)

- [ ] **Step 3: Migrate `providers/index.ts`**

Replace lines 1-2 and 35-36:

```typescript
// src/providers/index.ts
import path from 'path';
import { homeDir, awmHome } from '../core/paths';
```

```typescript
const homedir = homeDir();
const awmHomeDir = awmHome();
```

Then update line 64 (`scriptsDir`) to use the renamed local: `scriptsDir: path.join(awmHomeDir, 'hooks'),`.
(Remove `import os from 'os';` if `os` is otherwise unused — verify with `grep -n "os\." cli/src/providers/index.ts`.)

- [ ] **Step 4: Migrate `core/update-check.ts`**

Replace the `cacheFile()` body (lines 20-23):

```typescript
function cacheFile(): string {
    return path.join(awmHome(), 'update-check.json');
}
```

Add to imports: `import { awmHome } from './paths';`. Remove `import os from 'os';` if `os` is otherwise unused (`grep -n "os\." cli/src/core/update-check.ts`).

- [ ] **Step 5: Migrate `core/context/materializer.ts`**

Delete the local `function awmHome()` (lines 9-11) and import the shared one instead. Add to imports:

```typescript
import { awmHome } from '../paths';
```

All existing `awmHome()` call-sites in the file (e.g. line 14 `globalContextPath`) keep working unchanged — they now resolve to the imported function, which has identical behavior. First run `grep -n "awmHome()" cli/src/core/context/materializer.ts` to confirm every call-site is covered. Remove `import os from 'os';` if `os` is otherwise unused (`grep -n "os\." cli/src/core/context/materializer.ts`).

- [ ] **Step 6: Migrate `utils/config.ts`**

Replace the `prefsDir()` body (lines 25-27):

```typescript
function prefsDir(): string {
    return awmHome();
}
```

Add to imports: `import { awmHome } from '../core/paths';`. Remove `import os from 'os';` if unused (`grep -n "os\." cli/src/utils/config.ts`).

- [ ] **Step 7: Migrate `core/diagnostics/context.ts`**

Replace lines 16-17:

```typescript
function home(): string { return homeDir(); }
function awmHome(): string { return awmHomePath(); }
```

Add to imports: `import { homeDir, awmHome as awmHomePath } from '../paths';`. Remove `import os from 'os';` if unused (`grep -n "os\." cli/src/core/diagnostics/context.ts`).

- [ ] **Step 8: Migrate `commands/sensors/install.ts`**

Replace `defaultSettingsPath()` (lines 12-14):

```typescript
function defaultSettingsPath(): string {
    return path.join(homeDir(), '.claude', 'settings.json');
}
```

Replace the `awmHome` line inside `backupSettings` (line 28):

```typescript
    const backupDir = path.join(awmHome(), 'backups');
```

Add to imports: `import { homeDir, awmHome } from '../../core/paths';`. Remove `import os from 'os';` if unused (`grep -n "os\." cli/src/commands/sensors/install.ts`).

- [ ] **Step 9: Migrate `commands/hooks/install.ts` (closes H-1)**

Replace `backupSettings()` lines 30-33 — remove the unsafe `process.env.HOME!`:

```typescript
function backupSettings(settingsPath: string): string | null {
    if (!fs.existsSync(settingsPath)) return null;
    const backupDir = path.join(awmHome(), 'backups');
```

Add to imports: `import { awmHome } from '../../core/paths';`.

- [ ] **Step 10: Migrate `commands/hooks/uninstall.ts` (closes H-1)**

Replace `backupSettings()` lines 14-17 — remove the unsafe `process.env.HOME!`:

```typescript
function backupSettings(settingsPath: string): string | null {
    if (!fs.existsSync(settingsPath)) return null;
    const backupDir = path.join(awmHome(), 'backups');
```

Add to imports: `import { awmHome } from '../../core/paths';`.

- [ ] **Step 11: Build + run the full suite to verify no regression**

Run: `cd cli && npm run build && npm test`
Expected: PASS — same count as Step 1 baseline (no drop). Build emits no TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add cli/src
git commit -m "refactor(paths): migrate home/AWM_HOME call-sites to core/paths; close HOME! gap"
```

---

## Task 3: Symlink-with-fallback for the skill (closes H-3)

**Files:**
- Modify: `cli/src/commands/hooks/install.ts:70-73`
- Test: `cli/tests/commands/hooks/install-symlink-fallback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/commands/hooks/install-symlink-fallback.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('hooks/install — skill symlink fallback to copy', () => {
  let tmpHome: string;
  let origHome: string | undefined;
  let origAwmHome: string | undefined;
  let symlinkSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-symlink-fb-'));
    origHome = process.env.HOME;
    origAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
    jest.resetModules();
  });

  afterEach(() => {
    symlinkSpy?.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = origAwmHome;
  });

  function seedRegistry(root: string) {
    const hooksDir = path.join(root, 'hooks');
    const skillDir = path.join(root, 'skills', 'using-awm');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'session-start'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(hooksDir, 'run-hook.cmd'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# using-awm\n');
  }

  it('copies the skill when symlink throws (EPERM), preserving content', () => {
    const registryRoot = path.join(tmpHome, 'registry');
    seedRegistry(registryRoot);

    // Force symlinkSync to fail like a platform without symlink permission.
    symlinkSpy = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      const err: any = new Error('EPERM: operation not permitted, symlink');
      err.code = 'EPERM';
      throw err;
    });

    const { installHook } = require('../../../src/commands/hooks/install');
    const result = installHook({ agent: 'claude-code', registryRoot, installMethod: 'copy' });

    const skillDest = path.join(result.scriptsDir, 'using-awm.md');
    expect(fs.existsSync(skillDest)).toBe(true);
    expect(fs.lstatSync(skillDest).isSymbolicLink()).toBe(false); // it was copied, not linked
    expect(fs.readFileSync(skillDest, 'utf-8')).toContain('using-awm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/commands/hooks/install-symlink-fallback.test.ts`
Expected: FAIL — `installHook` throws EPERM (no fallback yet), so the assertion is never reached.

- [ ] **Step 3: Write minimal implementation**

In `cli/src/commands/hooks/install.ts`, replace lines 70-73:

```typescript
    // 3. Link the skill (default: symlink so 'awm update' propagates; fall back to copy if symlink is unavailable, e.g. Windows without Developer Mode)
    const skillDest = path.join(config.scriptsDir, 'using-awm.md');
    try { fs.unlinkSync(skillDest); } catch { /* not exists */ }
    try {
        fs.symlinkSync(sourceSkill, skillDest);
    } catch {
        // best-effort: copy the single skill file; 'awm update' will not auto-propagate
        fs.copyFileSync(sourceSkill, skillDest);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/commands/hooks/install-symlink-fallback.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the hooks suite to confirm the happy path (real symlink) still works**

Run: `cd cli && npx jest tests/commands/hooks`
Expected: PASS — existing install tests still create a symlink on this OS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/hooks/install.ts cli/tests/commands/hooks/install-symlink-fallback.test.ts
git commit -m "feat(hooks): fall back to copy when skill symlink fails (best-effort cross-platform)"
```

---

## Task 4: Wire the native-Windows warning into `init` and `sync` (closes H-5)

**Files:**
- Modify: `cli/src/index.ts` (the `init` action near line 72; the `sync` action near line 385)

The warning logic is unit-tested in Task 1 (`warnIfUnsupportedPlatform`). This task is trivial glue (call the tested helper); it is verified manually because `index.ts` action handlers are not unit-tested in this codebase.

- [ ] **Step 1: Add the import to `cli/src/index.ts`**

Near the existing imports, add:

```typescript
import { warnIfUnsupportedPlatform } from './core/paths';
```

- [ ] **Step 2: Call it at the start of the `init` action**

In the `init` command's `.action(async (...) => {` body (near line 72), as the first statement inside the handler:

```typescript
      warnIfUnsupportedPlatform((m) => console.warn(pc.yellow(`⚠ ${m}`)));
```

- [ ] **Step 3: Call it at the start of the `sync` action**

In the `sync` command's `.action(async (options) => {` body (near line 385), immediately after the `intro(...)` line:

```typescript
      warnIfUnsupportedPlatform((m) => console.warn(pc.yellow(`⚠ ${m}`)));
```

- [ ] **Step 4: Build and verify no warning fires on this (non-Windows) OS**

Run: `cd cli && npm run build && node dist/src/index.js doctor`
Expected: build succeeds; running a command on macOS/Linux prints **no** Windows warning (because `isWindowsNative()` is false here).

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): warn native-Windows users toward WSL on init/sync (best-effort)"
```

---

## Task 5: Show detected platform in `awm doctor`

**Files:**
- Modify: `cli/src/commands/doctor.ts:26-31`
- Test: `cli/tests/commands/doctor-platform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/commands/doctor-platform.test.ts`:

```typescript
import { renderReport } from '../../src/commands/doctor';
import { CheckReport } from '../../src/core/diagnostics/types';

describe('doctor renderReport — platform line', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  function emptyReport(): CheckReport {
    return { overall: 'healthy', hasProject: false, projectName: undefined, results: [] } as CheckReport;
  }

  it('renders the platform label under the Machine header', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const out = renderReport(emptyReport());
    expect(out).toContain('platform: Linux');
  });

  it('flags native Windows with a WSL hint', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const out = renderReport(emptyReport());
    expect(out).toContain('WSL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/commands/doctor-platform.test.ts`
Expected: FAIL — output has no `platform:` line.

- [ ] **Step 3: Write minimal implementation**

In `cli/src/commands/doctor.ts`, add the import near the top:

```typescript
import { platformLabel } from '../core/paths';
```

Then in `renderReport`, insert the platform line right after the `'Machine (global)'` push (currently line 30):

```typescript
    lines.push('Machine (global)');
    lines.push(pc.dim(`  platform: ${platformLabel()}`));
    for (const r of report.results.filter((x) => x.level === 'machine')) lines.push(line(r));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/commands/doctor-platform.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the doctor suite for no regression**

Run: `cd cli && npx jest tests/commands/doctor`
Expected: PASS (if a snapshot test exists and fails on the new line, update the snapshot intentionally).

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/doctor.ts cli/tests/commands/doctor-platform.test.ts
git commit -m "feat(doctor): show detected platform with WSL hint on native Windows"
```

---

## Task 6: Fix the one real hardcoded `/` separator (closes H-4)

**Files:**
- Modify: `cli/src/commands/sensors/formatters/eslint.ts:10-14`
- Test: `cli/tests/commands/sensors/eslint-formatter.test.ts`

> Note: `cli/src/core/profile.ts:132` (`config.local.endsWith('/')`) is **intentionally left** — it builds `.gitignore` entries, and `.gitignore` patterns use `/` universally regardless of OS. `cli/src/core/versioning.ts:35` (`ref.split('/')`) is **left** — git refs always use `/`. `cli/src/core/registries.ts` path-traversal guards that reject `/` are **left** — they are security guards (see CONSTITUTION). The eslint formatter below is the only spot doing a real filesystem-path operation with a hardcoded `/`.

- [ ] **Step 1: Write the failing test**

Create `cli/tests/commands/sensors/eslint-formatter.test.ts`:

```typescript
import path from 'path';
import { parseEslintOutput } from '../../../src/commands/sensors/formatters/eslint';

describe('parseEslintOutput — relative path normalization', () => {
  it('produces a cwd-relative path using the OS separator', () => {
    const cwd = process.cwd();
    const abs = path.join(cwd, 'src', 'foo.ts');
    const raw = JSON.stringify([
      { filePath: abs, messages: [{ ruleId: 'no-eval', severity: 2, message: 'no eval', line: 3, column: 1 }] },
    ]);
    const errors = parseEslintOutput(raw);
    expect(errors).toHaveLength(1);
    // path.join('src','foo.ts') uses the OS separator; on POSIX this is 'src/foo.ts'
    expect(errors[0].file).toBe(path.join('src', 'foo.ts'));
    expect(errors[0].file.startsWith(path.sep)).toBe(false); // genuinely relative
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes only by POSIX coincidence)**

Run: `cd cli && npx jest tests/commands/sensors/eslint-formatter.test.ts`
Expected: PASS on POSIX by coincidence of the old code, but the implementation is still wrong on Windows. Proceed to make it correct regardless (the test locks the intended behavior).

- [ ] **Step 3: Write minimal implementation**

In `cli/src/commands/sensors/formatters/eslint.ts`, replace the import line and line 14. At the top add:

```typescript
import path from 'path';
import { SensorError } from '../types';
```

Replace line 14 (the `rel` computation):

```typescript
            const rel = path.relative(cwd, file.filePath);
```

`path.relative` returns the path with the OS-native separator and no leading separator — correct on all platforms, and a no-op change in behavior on POSIX for paths under cwd.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/commands/sensors/eslint-formatter.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the sensors suite for no regression**

Run: `cd cli && npx jest tests/commands/sensors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/sensors/formatters/eslint.ts cli/tests/commands/sensors/eslint-formatter.test.ts
git commit -m "fix(sensors): use path.relative for cwd-relative eslint paths (cross-platform)"
```

---

## Task 7: Operational documentation (`docs/operations/cloud-and-platforms.md`)

**Files:**
- Create: `docs/operations/cloud-and-platforms.md`
- Modify: `README.md` (add a pointer in the platform-support area)

This task has no automated test — it is documentation. The "test" is that the runbook commands match the validated brief §0 spike.

- [ ] **Step 1: Create the operational doc**

Create `docs/operations/cloud-and-platforms.md` with three sections. Use the exact, validated commands from the brief `docs/plans/2026-06-21-portability-and-cloud-bootstrap-design.md` §0:

```markdown
# AWM — Cloud & Platform Operations

Operational runbooks for running AWM on ephemeral cloud VMs (Claude Code web)
and across operating systems. Companion to WS-C
(`docs/plans/2026-06-22-ws-c-os-sensitivity-design.md`).

## 1. Clean-distro verification (runbook)

Use this to verify AWM works on a fresh Linux (Ubuntu) environment — the path
that runs in Claude Code web. Run in a clean Ubuntu container or a new web session:

```bash
npm i -g agentic-workflow-manager
awm init --yes
awm doctor
```

Expected: `awm doctor` reports Machine (global) healthy — CLI present, hook
SessionStart present, baseline registry present, global skills present — and a
`platform: Linux` line. First recorded run: brief §0 spike (2026-06-22, Ubuntu 24.04).

## 2. Validated cloud flow — private registry via token (D-7)

For private registries from an ephemeral VM, inject a fine-grained, read-only
(`Contents: Read`) GitHub token as the environment variable `AWM_GIT_TOKEN`, and
use this setup script. The token is injected at the git transport layer and is
NEVER persisted to `registries.json` or `.git/config`:

```bash
#!/bin/bash
git config --global url."https://x-access-token:${AWM_GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
npm i -g agentic-workflow-manager
awm init --yes || true
awm registry add "https://github.com/<owner>/<your-registry>.git" --name <name> --no-install || true
```

Verify the token did not leak to disk:

```bash
cat ~/.awm/registries.json          # remote must be the clean https URL, no token
cat ~/.awm/registries/<name>/.git/config   # also clean
```

## 3. Windows — use WSL

Native Windows support is deferred (brief decision D-1, tracked as WS-D). Today,
the supported path on Windows is WSL:

1. Install WSL: https://learn.microsoft.com/windows/wsl/install
2. Open your Linux distro and run AWM there (follow section 1).

If you run AWM on native Windows, the CLI prints a best-effort warning on
`awm init` / `awm sync` orienting you here, and `awm doctor` shows
`platform: Windows (native — not supported yet, use WSL)`. Commands continue
best-effort, but symlink-based steps may fall back to copies or fail.
```

- [ ] **Step 2: Add a pointer from README**

In `README.md`, find the platform-support / installation area (search for "Platform" or "Windows"; if absent, add under the installation section) and add:

```markdown
> **Cloud & platforms:** For Claude Code web bootstrap, private-registry tokens, and Windows/WSL, see [docs/operations/cloud-and-platforms.md](docs/operations/cloud-and-platforms.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/operations/cloud-and-platforms.md README.md
git commit -m "docs(ops): cloud bootstrap + private-registry token + WSL runbook"
```

---

## Final verification

- [ ] **Step 1: Full build + test suite green**

Run: `cd cli && npm run build && npm test`
Expected: build clean; all tests pass (baseline count from Task 2 Step 1, plus the new `paths`, symlink-fallback, doctor-platform, and eslint-formatter tests).

- [ ] **Step 2: Manual smoke of the migrated paths**

Run: `cd cli && node dist/src/index.js doctor`
Expected: shows `platform: <your OS>` line; Machine section unchanged otherwise; no native-Windows warning on macOS/Linux.

- [ ] **Step 3: Confirm scope boundary**

Verify nothing in this branch touches `USERPROFILE`/`APPDATA` remapping, `run-hook.cmd` cmd/PowerShell validation, or a global copy-over-symlink policy — those are WS-D (deferred). `grep -rn "USERPROFILE\|APPDATA" cli/src` should return nothing new.

---

## Self-review summary (spec coverage)

| Design section | Task |
|----------------|------|
| §2.1 `core/paths.ts` (call-time functions) | Task 1 |
| §2.2 migrate call-sites + close `HOME!` (H-1, H-2) | Task 2 |
| §2.3 symlink → copy fallback (H-3) | Task 3 |
| §2.4 native-Windows warning, init/sync (H-5) | Task 4 |
| §2.4 doctor platform line | Task 5 |
| §2.5 separator normalization (H-4) | Task 6 |
| §6 operational doc (runbook + cloud recipe + WSL) | Task 7 |
| §7 scope boundary (WS-D deferred) | Final verification Step 3 |
