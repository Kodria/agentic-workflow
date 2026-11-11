# CI: drop push-to-main trigger (#244) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop double-running the full CI matrix on every merge to `main` by leaving `ci.yml` as PR-only with cancel-in-progress concurrency, while `release.yml` remains the sole post-merge test gate (#244).

**Architecture:** YAML trigger surgery only. `ci.yml` loses `push: branches: [main]` and gains a PR concurrency group that cancels superseded runs. `release.yml` stays unchanged (`push` to `main`, `cancel-in-progress: false`). A structural Jest pin kills regressions of either contract.

**Tech Stack:** GitHub Actions YAML, Jest structural test under `cli/tests/structural/`.

**Change Record:** `ci-drop-main-push`

**Criterios de aceptación:**
- Mergear un PR a `main` → Actions muestra la corrida de `release` y **no** una corrida nueva de `ci` por el push a `main`
- Abrir/actualizar un PR → `ci` corre completo; un segundo push al mismo PR cancela la corrida anterior (`concurrency` cancel-in-progress)
- Abrir la corrida de `release` tras el merge → sigue en cola si hay otra en vuelo (`cancel-in-progress: false`)

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** #244. Dispatch: owner did not select AWM routing → `compact-slices/v1`. Design shortcut: owner approved skip of full brainstorming; scope locked to drop main push + optional concurrency yes.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "ci-drop-main-push",
  "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4"],
  "sources": [
    {
      "id": "SRC-CI",
      "path": ".github/workflows/ci.yml",
      "locator": "on:",
      "fact": "Today `on:` declares bare `pull_request:` plus `push: branches: [main]`; there is no top-level `concurrency:` block. After the change the `on:` block must be only `pull_request:`, and a top-level concurrency block must be exactly `group: ci-${{ github.ref }}` with `cancel-in-progress: true`, placed after `permissions:` (or immediately after `on:`) without touching any job."
    },
    {
      "id": "SRC-RELEASE",
      "path": ".github/workflows/release.yml",
      "locator": "concurrency:",
      "fact": "`on:` keeps `push: branches: [main]` plus `workflow_dispatch`; concurrency is `group: release-${{ github.ref }}` with `cancel-in-progress: false`. This plan must not edit release.yml."
    },
    {
      "id": "SRC-STRUCT-PATTERN",
      "path": "cli/tests/structural/release-flags-are-reachable-from-ci.test.ts",
      "locator": "const CI_WORKFLOW",
      "fact": "Structural tests resolve REPO_ROOT from `cli/tests/structural` via `path.resolve(CLI_ROOT, '..')` and read `.github/workflows/*.yml` as UTF-8; comments can be stripped by filtering lines matching `/^\\s*#/` when asserting executable YAML shape."
    }
  ],
  "commands": [
    {
      "id": "CMD-PIN",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/ci-pr-only-triggers.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "PR-only ci.yml + structural pin",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-CI", "SRC-RELEASE", "SRC-STRUCT-PATTERN"],
      "redCommands": ["CMD-PIN"],
      "greenCommands": ["CMD-PIN"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-PIN"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Requirements

- **RF-1.1:** `.github/workflows/ci.yml` `on:` triggers **only** `pull_request` (no `push` / `branches: [main]`).
- **RF-1.2:** `ci.yml` declares top-level `concurrency.group: ci-${{ github.ref }}` and `concurrency.cancel-in-progress: true`.
- **RF-1.3:** `.github/workflows/release.yml` keeps `push: branches: [main]` and `cancel-in-progress: false` (file unchanged by this plan).
- **RF-1.4:** `cli/tests/structural/ci-pr-only-triggers.test.ts` fails if RF-1.1–RF-1.3 are violated (dedicated assertions, not suite-title-only coverage).

<a id="slice-s1"></a>
### Slice S1: PR-only ci.yml + structural pin

#### Surfaces
Owns RF-1.1–RF-1.4 as one cohesive CI-trigger boundary: the PR workflow stops re-running on merge, cancels superseded PR runs, and a Jest pin freezes that contract while release stays the post-merge gate. Files: `.github/workflows/ci.yml` (edit), `cli/tests/structural/ci-pr-only-triggers.test.ts` (create). Do not edit `release.yml`.

#### Implementation
Grouping rationale: trigger shape, concurrency, and the kill-test that proves both must land together or the acceptance criteria are unmet.

1. **RED** — Create `cli/tests/structural/ci-pr-only-triggers.test.ts` with this body (adjust only if path helpers already differ in sibling structural tests — they do not):

```typescript
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');

function loadWorkflow(file: string): { raw: string; doc: Record<string, unknown> } {
    const raw = fs.readFileSync(file, 'utf8');
    const doc = yaml.load(raw) as Record<string, unknown>;
    if (!doc || typeof doc !== 'object') throw new Error(`${file}: failed to parse YAML`);
    return { raw, doc };
}

describe('ci.yml is PR-only; release.yml remains the main push gate (#244)', () => {
    const ci = loadWorkflow(CI_WORKFLOW);
    const release = loadWorkflow(RELEASE_WORKFLOW);

    it('RF-1.1: ci on: has pull_request and no push', () => {
        const on = ci.doc.on as Record<string, unknown>;
        expect(on).toBeTruthy();
        expect(Object.prototype.hasOwnProperty.call(on, 'pull_request')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(on, 'push')).toBe(false);
        expect(ci.raw).not.toMatch(/^\s*push:\s*$/m);
        expect(ci.raw).not.toMatch(/branches:\s*\[\s*main\s*\]/);
    });

    it('RF-1.2: ci concurrency cancels in-progress runs for the same ref', () => {
        const concurrency = ci.doc.concurrency as { group?: string; 'cancel-in-progress'?: boolean };
        expect(concurrency).toEqual({
            group: 'ci-${{ github.ref }}',
            'cancel-in-progress': true,
        });
    });

    it('RF-1.3: release still pushes on main and never cancels in-flight releases', () => {
        const on = release.doc.on as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(on, 'push')).toBe(true);
        const push = on.push as { branches?: string[] };
        expect(push.branches).toEqual(['main']);
        const concurrency = release.doc.concurrency as { group?: string; 'cancel-in-progress'?: boolean };
        expect(concurrency.group).toBe('release-${{ github.ref }}');
        expect(concurrency['cancel-in-progress']).toBe(false);
    });
});
```

2. Run CMD-PIN → expect **RED** (RF-1.1 / RF-1.2 fail on current `ci.yml`).

3. **GREEN** — Edit `.github/workflows/ci.yml` so the header becomes:

```yaml
name: ci

on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
```

Keep every job body byte-identical. Delete the `push:` / `branches: [main]` lines only.

4. Run CMD-PIN → expect **GREEN**.

5. Commit on branch `cursor/ci-drop-main-push-aac5` with message:
   `fix(ci): run ci.yml only on pull_request (#244)`.

#### Edge cases
- Restoring `push: branches: [main]` must fail RF-1.1 (including a commented-out push is allowed only if YAML `on.push` is absent — the raw regex also forbids an active `branches: [main]` line in `ci.yml`).
- Setting `cancel-in-progress: false` on `ci` must fail RF-1.2.
- Editing `release.yml` concurrency to `true` must fail RF-1.3 — implementers must not “fix” release while touching CI.
- Do not add `paths-ignore` to `release.yml`; every merge including workflow-only still re-tests via release.

#### Evidence
CMD-PIN covers RF-1.1–RF-1.4 with four dedicated `it()` bodies. Obtain distinct current clean specification and quality reviews for S1. Sensors: `awm sensors run` on the feature branch after the commit. Plan identity: re-admit after any amendment.

#### Fallback
If Actions YAML parsing surprises (js-yaml quirk on `${{ }}`), keep asserting via parsed `doc` for structure and tighten raw regexes only through a durable plan amendment + `awm plan validate` — never weaken RF-1.3.

## Traceability

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| RF-1.1 | S1 step 3 | `RF-1.1: ci on: has pull_request and no push` |
| RF-1.2 | S1 step 3 | `RF-1.2: ci concurrency cancels in-progress...` |
| RF-1.3 | S1 (no release edit) | `RF-1.3: release still pushes on main...` |
| RF-1.4 | S1 step 1 | entire `ci-pr-only-triggers.test.ts` file |
