# Cloud Admission: Rewritten Origin and Read-Only Snapshot Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `awm plan admit --require-current --verify-sensors` work in Cloud environments: the registry origin check survives a global `url.*.insteadOf` rewrite, and the read-only sensor snapshot skips git-ignored, untracked generated directories (AWM defaults plus an optional `.awm/admission.json`).

**Architecture:** (A) `registryComponent` reads the literal `remote.origin.url` config value instead of the rewritten `git remote get-url`. (B) The snapshot moves out of `run.ts` into a focused module `read-only-observation.ts` that owns the admission config parser, the exclusion policy (rules + cached git verdicts + evidence), the git verifier, the bounded tree hash and the remedy texts; `runSensors` wires it for `readOnly` runs and admission surfaces the sensor reason/remedy in `ADMISSION_SENSORS_BLOCKED`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, Node `child_process.spawnSync` / `execFile`, git.

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Design:** `docs/plans/2026-10-16-cloud-admission-origin-snapshot-design.md` (approved 2026-10-16). Dispatch: the owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-215-cloud-admission-origin-snapshot",
  "requirements": [
    "A-R1", "A-R2", "A-R3", "A-R4", "A-R5",
    "B-R1", "B-R2", "B-R3", "B-R4", "B-R5", "B-R6", "B-R7", "B-R8", "B-R9", "B-R10",
    "B-R11", "B-R12", "B-R13", "B-R14", "B-R15", "B-R16", "B-R17",
    "V-R1", "V-R2", "V-R3", "V-R4"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-16-cloud-admission-origin-snapshot-design.md",
      "locator": "## Requirements",
      "fact": "Approved A-R1–A-R5, B-R1–B-R17, V-R1–V-R4: literal origin config, git-ignored untracked exclusions with implicit defaults, optional .awm/admission.json, evidence, actionable remedies, light tests, docs."
    },
    {
      "id": "SRC-CHECK",
      "path": "cli/src/core/currentness/check.ts",
      "locator": "async function registryComponent",
      "fact": "Reads origin with git(['remote','get-url','origin']) and fails unverifiable when originResult.value.trim() !== registry.remote; ls-remote queries registry.remote; diagnostics use sanitizeSource/sshUserInfoLabel."
    },
    {
      "id": "SRC-CHECK-TEST",
      "path": "cli/tests/core/currentness/check.test.ts",
      "locator": "function deps",
      "fact": "Mocked git transports dispatch on args[0]: 'remote' returns the origin, 'ls-remote' tags, 'describe' the exact tag, anything else (rev-parse) a SHA."
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "function filesystemSnapshot",
      "fact": "READ_ONLY_MAX_ENTRIES/BYTES constants and filesystemSnapshot(root): string | null (skips root .git, hashes every entry with mode and size) live here; runSensors takes the before snapshot after manifest resolution and compares an after snapshot just before returning output."
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/commands/sensors/types.ts",
      "locator": "export type RunOutput",
      "fact": "RunOutput carries sensors, overall, invalidEntries, packDrift, changedScope and Partial<SensorAuthority> (mode, reason, projectRoot, manifestPath, remedy)."
    },
    {
      "id": "SRC-RUN-TEST",
      "path": "cli/tests/commands/sensors/run-changed.test.ts",
      "locator": "does not certify read-only admission when a sensor changes an ignored .awm file",
      "fact": "Harness pattern: jest.mock of ../../../src/commands/sensors/exec runCommand, legacy manifest {pack:'js-ts', sensors:{lint:{fast,cmd}}}, AWM_HOME on a tmpdir, require('../../../src/commands/sensors/run') after jest.resetModules."
    },
    {
      "id": "SRC-ADMISSION",
      "path": "cli/src/core/admission/index.ts",
      "locator": "function sensorVerdict",
      "fact": "The sensor gate blocks with diagnostic('ADMISSION_SENSORS_BLOCKED', `Sensor verdict is ${sensors}.`); watch/admission-recovery.ts classifies a blocked reason only when it contains exactly one ADMISSION_* token."
    },
    {
      "id": "SRC-PLAN-CMD",
      "path": "cli/src/commands/plan/index.ts",
      "locator": ".option('--verify-sensors'",
      "fact": "Help text today is 'require an empirical sensor pass'; no test asserts it."
    },
    {
      "id": "SRC-DOCS",
      "path": "docs/configuration.md",
      "locator": "## What machine initialization installs",
      "fact": "New admission section goes immediately before this heading; cli-reference.md '### `awm plan admit PLAN_PATH`' ends its --verify-sensors text with the R8 paragraph; operations/cloud-and-platforms.md '## 2. Validated cloud flow' documents the D-7 insteadOf recipe."
    }
  ],
  "commands": [
    {
      "id": "CMD-CURRENTNESS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/currentness/check.test.ts", "tests/core/currentness/check-insteadof.test.ts"],
      "covers": ["A-R1", "A-R2", "A-R3", "A-R4", "A-R5", "V-R1", "V-R3"]
    },
    {
      "id": "CMD-OBSERVATION",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/read-only-observation.test.ts"],
      "covers": ["B-R1", "B-R2", "B-R4", "B-R5", "B-R6", "B-R7", "B-R9", "B-R10", "B-R11", "B-R13", "B-R14", "V-R1", "V-R2", "V-R3"]
    },
    {
      "id": "CMD-RUN-READONLY",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-read-only.test.ts", "tests/commands/sensors/run.test.ts", "tests/commands/sensors/run-changed.test.ts", "tests/core/admission/index.test.ts"],
      "covers": ["B-R3", "B-R8", "B-R12", "B-R15", "B-R16", "B-R17", "V-R1"]
    },
    {
      "id": "CMD-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/cloud-admission-docs-contract.test.ts"],
      "covers": ["V-R4"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["A-R1", "B-R15", "B-R17"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["A-R1", "B-R9", "B-R15"]
    },
    {
      "id": "CMD-DEPCHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "depcheck"],
      "covers": ["B-R15"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Registry origin read from literal config",
      "requirements": ["A-R1", "A-R2", "A-R3", "A-R4", "A-R5", "V-R1"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-CHECK", "SRC-CHECK-TEST"],
      "redCommands": ["CMD-CURRENTNESS"],
      "greenCommands": ["CMD-CURRENTNESS", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S2",
      "title": "Read-only observation module",
      "requirements": ["B-R1", "B-R2", "B-R4", "B-R5", "B-R6", "B-R7", "B-R9", "B-R10", "B-R11", "B-R13", "B-R14", "V-R2", "V-R3"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RUN", "SRC-TYPES"],
      "redCommands": ["CMD-OBSERVATION"],
      "greenCommands": ["CMD-OBSERVATION", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "runSensors wiring, evidence and admission diagnostic",
      "requirements": ["B-R3", "B-R8", "B-R12", "B-R15", "B-R16", "B-R17"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-DESIGN", "SRC-RUN", "SRC-TYPES", "SRC-RUN-TEST", "SRC-ADMISSION"],
      "redCommands": ["CMD-RUN-READONLY"],
      "greenCommands": ["CMD-RUN-READONLY", "CMD-OBSERVATION", "CMD-TYPECHECK", "CMD-LINT", "CMD-DEPCHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S4",
      "title": "Documentation and help text",
      "requirements": ["V-R4"],
      "dependsOn": ["S3"],
      "sectionAnchor": "slice-s4",
      "sources": ["SRC-DESIGN", "SRC-DOCS", "SRC-PLAN-CMD"],
      "redCommands": ["CMD-DOCS"],
      "greenCommands": ["CMD-DOCS", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "bounded",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-CURRENTNESS", "CMD-OBSERVATION", "CMD-RUN-READONLY", "CMD-DOCS", "CMD-TYPECHECK", "CMD-LINT", "CMD-DEPCHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

**Shared constraints (every slice):**

- Work only in `cli/` and `docs/`. Never read or write the real `~/.awm` (CLAUDE.md). Every new test overrides `HOME`, `AWM_HOME` and, when it runs git, `GIT_CONFIG_GLOBAL` (a tmp file with a `[user]` identity), `GIT_CONFIG_NOSYSTEM=1` and `GIT_CEILING_DIRECTORIES` (the tmp root) — and restores the previous values in `afterEach` (V-R1).
- No large fixtures: limit overflow is provoked with injected limits of a few entries/bytes (V-R2).
- Commit after each slice's GREEN with a conventional message ending in the session attribution lines; the PR/squash title is `feat(admission): Cloud insteadOf origin + read-only snapshot exclusions (#215)` (design delivery note).
- Run commands from the repository root exactly as declared (`npm --prefix cli …`).

<a id="slice-s1"></a>
### Slice S1: Registry origin read from literal config

#### Surfaces

Owns A-R1, A-R2, A-R3, A-R4, A-R5 and V-R1 (test isolation pattern established here and reused by S2/S3). One cohesive boundary: the origin read inside `registryComponent`.

- Modify `cli/src/core/currentness/check.ts` (one argv change + comment).
- Modify `cli/tests/core/currentness/check.test.ts` (mock dispatch key `'remote'` → `'config'`; new unit tests).
- Create `cli/tests/core/currentness/check-insteadof.test.ts` (real git, offline).

Interface unchanged: `checkCurrentness(cwd, deps)`, `GitTransport(cwd, args, options)`.

#### Implementation

- [ ] **Step 1 — RED unit tests.** In `cli/tests/core/currentness/check.test.ts`, replace every `args[0] === 'remote'` with `args[0] === 'config'` (14 occurrences, including the inline ternary in the `branch provenance` `it.each` row). Then add these tests at the end of the `describe('checkCurrentness')` block:

```ts
    it('reads the literal origin config value, never the insteadOf-rewritten URL', async () => {
        const configured = 'https://github.example/team/repo.git';
        const git = jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
            if (args[0] === 'config') return `${configured}\n`;
            if (args[0] === 'remote') return 'https://x-access-token:ghs_SECRET@github.example/team/repo.git\n';
            if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/v1.2.3\n`;
            if (args[0] === 'describe') return 'v1.2.3\n';
            return `${'a'.repeat(40)}\n`;
        });
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            listRegistries: () => [{ name: 'baseline', remote: configured, contentRoot: '/registry' }],
            git,
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({ status: 'current', latest: 'v1.2.3' }));
        expect(git).toHaveBeenCalledWith('/registry', ['config', '--get', 'remote.origin.url'], expect.any(Object));
        expect(git).not.toHaveBeenCalledWith('/registry', ['remote', 'get-url', 'origin'], expect.any(Object));
        expect(git).toHaveBeenCalledWith('/registry', ['ls-remote', '--tags', configured], expect.any(Object));
        expect(JSON.stringify(result)).not.toContain('x-access-token');
        expect(JSON.stringify(result)).not.toContain('SECRET');
    });

    it('reports a missing origin config value as an unreadable origin', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'config') throw Object.assign(new Error('exit 1'), { code: 1 });
                if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/v1.2.3\n`;
                if (args[0] === 'describe') return 'v1.2.3\n';
                return `${'a'.repeat(40)}\n`;
            }),
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({
            status: 'unverifiable',
            detail: 'Could not read local registry origin.',
        }));
    });
```

- [ ] **Step 2 — RED integration test.** Create `cli/tests/core/currentness/check-insteadof.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

/**
 * A-R1 / A-R2 / V-R3(a), real git. AWM's own cloud recipe (D-7) installs a global
 * `url.<base>.insteadOf` rewrite; `git remote get-url` then reports the rewritten
 * transport URL while `.git/config` keeps the configured one. The rewrite here points
 * at a local bare repository so the test stays offline.
 */
describe('checkCurrentness under a global insteadOf rewrite (real git)', () => {
    const CONFIGURED = 'https://example.test/team/repo.git';
    const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-insteadof-'));
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        const home = path.join(root, 'home');
        fs.mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        const globalConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(globalConfig, [
            '[user]',
            '\temail = test@example.test',
            '\tname = test',
            `[url "${pathToFileURL(path.join(root, 'remote')).href}/"]`,
            '\tinsteadOf = https://example.test/',
            '',
        ].join('\n'));
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        process.env.GIT_CEILING_DIRECTORIES = root;
        jest.resetModules();
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

    function cloneTaggedRegistry(): string {
        const seed = path.join(root, 'seed');
        fs.mkdirSync(seed);
        git(seed, ['init', '-q', '-b', 'main']);
        fs.writeFileSync(path.join(seed, 'README.md'), 'registry\n');
        git(seed, ['add', '.']);
        git(seed, ['commit', '-qm', 'initial']);
        git(seed, ['tag', 'v1.0.0']);
        const bare = path.join(root, 'remote', 'team', 'repo.git');
        fs.mkdirSync(path.dirname(bare), { recursive: true });
        git(root, ['clone', '-q', '--bare', seed, bare]);
        const checkout = path.join(root, 'checkout');
        git(root, ['clone', '-q', CONFIGURED, checkout]);
        git(checkout, ['checkout', '-q', 'v1.0.0']);
        return checkout;
    }

    async function check(checkout: string) {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        return checkCurrentness(root, {
            cliVersion: () => '1.2.3',
            now: () => 1_700_000_000_000,
            fetch: jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ version: '1.2.3' }) }),
            readPreferences: () => ({ pins: {} }),
            listRegistries: () => [{ name: 'baseline', remote: CONFIGURED, contentRoot: checkout }],
        });
    }

    it('reports the registry current when only the transport URL is rewritten', async () => {
        const checkout = cloneTaggedRegistry();
        expect(git(checkout, ['remote', 'get-url', 'origin']).trim()).not.toBe(CONFIGURED);
        expect(git(checkout, ['config', '--get', 'remote.origin.url']).trim()).toBe(CONFIGURED);

        const report = await check(checkout);

        expect(report.components[1]).toEqual(expect.objectContaining({
            component: 'registry:baseline', status: 'current', installed: 'v1.0.0', latest: 'v1.0.0',
        }));
    });

    it('still reports an origin stored with a different path as unverifiable', async () => {
        const checkout = cloneTaggedRegistry();
        git(checkout, ['remote', 'set-url', 'origin', 'https://example.test/team/other.git']);

        const report = await check(checkout);

        expect(report.components[1]).toEqual(expect.objectContaining({
            status: 'unverifiable', detail: expect.stringMatching(/origin does not match configured remote/i),
        }));
    });
});
```

- [ ] **Step 3 — observe RED.** Run CMD-CURRENTNESS. Expected: every unit test whose mock now answers `config` fails (the code still asks `remote`, which falls to the SHA branch → origin mismatch), the new unit test fails on `toHaveBeenCalledWith(... ['config', ...])`, and `reports the registry current…` fails with `status: 'unverifiable'`.

- [ ] **Step 4 — GREEN implementation.** In `cli/src/core/currentness/check.ts`, inside `registryComponent`, replace the first element of the `Promise.allSettled([...])` array:

```ts
        // The literal stored value: `git remote get-url` applies url.*.insteadOf, and
        // cloud environments (AWM's own D-7 recipe) rewrite to a token-bearing URL.
        deadline(git(registry.contentRoot, ['config', '--get', 'remote.origin.url'], { timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES })),
```

Leave the exact-equality comparison, `sanitizeSource`, `sshUserInfoLabel` and the `ls-remote --tags registry.remote` call untouched (A-R2, A-R4, A-R5).

- [ ] **Step 5 — GREEN.** Run CMD-CURRENTNESS and CMD-TYPECHECK; both pass.
- [ ] **Step 6 — Commit** `fix(currentness): read registry origin from literal config, not the insteadOf rewrite (#215)`.

#### Edge cases

- Credential persisted in `.git/config` (`https://user:secret@…`): exact equality fails → `unverifiable`; the existing test `identifies origin mismatch while keeping credential-bearing remotes out of diagnostics` (now mocking `config`) must still pass and keep `secret`/`user:` out of the JSON (A-R2, A-R4).
- SSH-userinfo-only difference (`ssh://git@host/…` vs `ssh://host/…`) stays a visible mismatch (existing test, A-R2).
- `git config --get` exits 1 when the key is absent → rejected promise → existing "Could not read local registry origin." (A-R3).
- Do not normalize or trim userinfo anywhere: normalization was rejected (design DD-1).

#### Evidence

Sources SRC-DESIGN (A-R1–A-R5), SRC-CHECK (origin read + comparison), SRC-CHECK-TEST (mock dispatch). RED: CMD-CURRENTNESS fails as described in Step 3. GREEN: CMD-CURRENTNESS, CMD-TYPECHECK. Obtain distinct clean specification and code-quality verdicts against the current plan identity before marking S1 complete.

#### Fallback

If real git on a CI platform cannot clone through a `file://` `insteadOf` target (e.g. a Windows path quirk), keep the unit tests as the A-R1 proof, record the platform deviation in the plan as an amendment, and replace the integration clone with `git init` + `git remote add origin <CONFIGURED>` + `git config --global url.<file-url>.insteadOf` while preserving the same two assertions. Never weaken the exact-equality check to make a test pass.

<a id="slice-s2"></a>
### Slice S2: Read-only observation module

#### Surfaces

Owns B-R1, B-R2, B-R4, B-R5, B-R6, B-R7, B-R9, B-R10, B-R11, B-R13, B-R14, V-R2, V-R3. Grouping rationale: config parsing, rule matching, git verification and the bounded hash form one unit with one purpose (decide what the read-only snapshot observes); they are tested together without running sensors.

- Create `cli/src/commands/sensors/read-only-observation.ts`.
- Modify `cli/src/commands/sensors/types.ts` (add `ReadOnlyCandidateRejection`, `ReadOnlyObservation`, `RunOutput.readOnlyObservation?`).
- Create `cli/tests/commands/sensors/read-only-observation.test.ts`.
- `run.ts` is NOT changed in this slice (S3 switches it over), so the old snapshot keeps working meanwhile.

Exported interface (consumed by S3):

```ts
export const READ_ONLY_MAX_ENTRIES: number;            // 250_000
export const READ_ONLY_MAX_BYTES: number;              // 1 GiB
export const DEFAULT_EXCLUSION_NAMES: readonly string[];
export type ExclusionRule = { kind: 'name'; name: string } | { kind: 'path'; path: string };
export type AdmissionConfig = { defaults: boolean; rules: ExclusionRule[] };
export type AdmissionConfigResult = { ok: true; config: AdmissionConfig } | { ok: false; field: string; message: string };
export type CandidateVerdict = 'excluded' | ReadOnlyCandidateRejection['reason'];
export type CandidateVerifier = (relativePath: string) => CandidateVerdict;
export type ExclusionPolicy = { isExcluded(relativePath: string, name: string): boolean; evidence(): ReadOnlyObservation };
export type SnapshotFailure = 'limit-entries' | 'limit-bytes' | 'unreadable';
export type SnapshotResult = { ok: true; digest: string } | { ok: false; failure: SnapshotFailure };
export type SnapshotLimits = { maxEntries: number; maxBytes: number };
export function loadAdmissionConfig(projectRoot: string): AdmissionConfigResult;
export function createExclusionPolicy(config: AdmissionConfig, verifier: CandidateVerifier): ExclusionPolicy;
export function gitVerifier(projectRoot: string): CandidateVerifier;
export function filesystemSnapshot(root: string, policy?: ExclusionPolicy, limits?: SnapshotLimits): SnapshotResult;
export function snapshotUnavailableRemedy(failure: SnapshotFailure): string;
export function admissionConfigRemedy(problem: { field: string; message: string }): string;
```

#### Implementation

- [ ] **Step 1 — types.** In `cli/src/commands/sensors/types.ts`, add above `export type RunOutput`:

```ts
/** A directory that matched an exclusion rule but stayed observed, and why. */
export type ReadOnlyCandidateRejection = { path: string; reason: 'not-ignored' | 'contains-tracked' | 'git-unavailable' };

/** What a read-only (admission) snapshot skipped and what it observed anyway. */
export type ReadOnlyObservation = { defaults: boolean; excluded: string[]; rejected: ReadOnlyCandidateRejection[] };
```

and inside `RunOutput`, after the `changedScope?:` member:

```ts
    /**
     * Present on read-only (admission) runs: the directories the tree snapshot
     * skipped (git-ignored, no tracked file) and the matching ones it observed anyway.
     */
    readOnlyObservation?: ReadOnlyObservation;
```

- [ ] **Step 2 — RED tests.** Create `cli/tests/commands/sensors/read-only-observation.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
    DEFAULT_EXCLUSION_NAMES,
    admissionConfigRemedy,
    createExclusionPolicy,
    filesystemSnapshot,
    gitVerifier,
    loadAdmissionConfig,
    snapshotUnavailableRemedy,
    type AdmissionConfig,
    type CandidateVerdict,
} from '../../../src/commands/sensors/read-only-observation';

describe('read-only observation', () => {
    const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
    let root: string;
    let project: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-readonly-'));
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        const home = path.join(root, 'home');
        fs.mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        const globalConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(globalConfig, '[user]\n\temail = test@example.test\n\tname = test\n');
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        process.env.GIT_CEILING_DIRECTORIES = root;
        project = path.join(root, 'project');
        fs.mkdirSync(project);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    const write = (relative: string, content = 'x'): void => {
        const file = path.join(project, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    };
    const writeConfig = (value: unknown): void => write('.awm/admission.json', typeof value === 'string' ? value : JSON.stringify(value));
    const git = (args: string[]): string => execFileSync('git', args, { cwd: project, stdio: 'pipe', encoding: 'utf8' });
    const tiny = { maxEntries: 50, maxBytes: 1024 };
    const nodeModulesOnly = (verdict: CandidateVerdict) =>
        createExclusionPolicy({ defaults: false, rules: [{ kind: 'name', name: 'node_modules' }] }, () => verdict);

    describe('loadAdmissionConfig', () => {
        it('applies the AWM defaults when the file is absent', () => {
            expect(loadAdmissionConfig(project)).toEqual({
                ok: true,
                config: { defaults: true, rules: DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name', name })) },
            });
            expect(DEFAULT_EXCLUSION_NAMES).toEqual(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']);
        });

        it('adds declared name and path rules and can drop the defaults', () => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { defaults: false, exclude: ['storybook-static', 'apps/web/.cache'] } });
            expect(loadAdmissionConfig(project)).toEqual({
                ok: true,
                config: { defaults: false, rules: [{ kind: 'name', name: 'storybook-static' }, { kind: 'path', path: 'apps/web/.cache' }] },
            });
        });

        it('keeps the defaults when only exclude is declared', () => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { exclude: ['out'] } });
            const result = loadAdmissionConfig(project);
            expect(result.ok && result.config.rules).toEqual([...DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name', name })), { kind: 'name', name: 'out' }]);
        });

        it.each([
            ['not json', '(file)'],
            [[], '(root)'],
            [{ schemaVersion: 2 }, 'schemaVersion'],
            [{ readOnlyObservation: {} }, 'schemaVersion'],
            [{ schemaVersion: 1, extra: true }, 'extra'],
            [{ schemaVersion: 1, readOnlyObservation: null }, 'readOnlyObservation'],
            [{ schemaVersion: 1, readOnlyObservation: { other: 1 } }, 'readOnlyObservation.other'],
            [{ schemaVersion: 1, readOnlyObservation: { defaults: 'yes' } }, 'readOnlyObservation.defaults'],
            [{ schemaVersion: 1, readOnlyObservation: { exclude: 'node_modules' } }, 'readOnlyObservation.exclude'],
        ])('rejects %j at field %s', (value, field) => {
            writeConfig(value);
            expect(loadAdmissionConfig(project)).toEqual({ ok: false, field, message: expect.any(String) });
        });

        it.each([
            '', '/abs', 'C:/abs', 'a/../b', './a', 'a//b', 'a\\b', '*.log', 'a?', '[a]', 'a\nb', 'a\u0000b', 'dist/',
            '.git', '.awm', '.awm/cache', '.git/hooks', '.AWM', 42,
        ])('rejects the exclude entry %j', entry => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { exclude: [entry] } });
            expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: 'readOnlyObservation.exclude[0]', message: expect.any(String) });
        });

        it('bounds and neutralizes an unknown field name in the diagnostic', () => {
            writeConfig(`{"schemaVersion":1,"${'k'.repeat(100)}\\n":true}`);
            const result = loadAdmissionConfig(project);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.field.length).toBeLessThanOrEqual(64);
                expect(result.field).not.toMatch(/[\u0000-\u001f]/);
            }
        });

        it('fails loudly on an empty project root', () => {
            expect(() => loadAdmissionConfig('')).toThrow(/non-empty string/);
        });
    });

    describe('createExclusionPolicy', () => {
        const config = (rules: AdmissionConfig['rules']): AdmissionConfig => ({ defaults: false, rules });

        it('matches a name rule at any depth and a path rule only at its exact path', () => {
            const seen: string[] = [];
            const policy = createExclusionPolicy(config([{ kind: 'name', name: 'node_modules' }, { kind: 'path', path: 'apps/web/.cache' }]), relative => {
                seen.push(relative);
                return 'excluded';
            });
            expect(policy.isExcluded('node_modules', 'node_modules')).toBe(true);
            expect(policy.isExcluded('packages/a/node_modules', 'node_modules')).toBe(true);
            expect(policy.isExcluded('apps/web/.cache', '.cache')).toBe(true);
            expect(policy.isExcluded('apps/api/.cache', '.cache')).toBe(false);
            expect(policy.isExcluded('src', 'src')).toBe(false);
            expect(seen).toEqual(['node_modules', 'packages/a/node_modules', 'apps/web/.cache']);
        });

        it('verifies each candidate once and reports sorted evidence', () => {
            const verdicts: Record<string, CandidateVerdict> = {
                'b/node_modules': 'excluded', 'a/node_modules': 'not-ignored', dist: 'contains-tracked', node_modules: 'git-unavailable',
            };
            const verifier = jest.fn((relative: string) => verdicts[relative]);
            const policy = createExclusionPolicy({ defaults: true, rules: [{ kind: 'name', name: 'node_modules' }, { kind: 'name', name: 'dist' }] }, verifier);
            for (const relative of ['b/node_modules', 'a/node_modules', 'dist', 'node_modules', 'b/node_modules']) {
                policy.isExcluded(relative, relative.split('/').pop()!);
            }
            expect(verifier).toHaveBeenCalledTimes(4);
            expect(policy.evidence()).toEqual({
                defaults: true,
                excluded: ['b/node_modules'],
                rejected: [
                    { path: 'a/node_modules', reason: 'not-ignored' },
                    { path: 'dist', reason: 'contains-tracked' },
                    { path: 'node_modules', reason: 'git-unavailable' },
                ],
            });
        });

        it('fails loudly without a validated config or verifier', () => {
            expect(() => createExclusionPolicy(undefined as never, () => 'excluded')).toThrow(/validated admission config/);
            expect(() => createExclusionPolicy(config([]), undefined as never)).toThrow(/candidate verifier/);
        });
    });

    describe('filesystemSnapshot', () => {
        it('skips an excluded directory so an ignored heavy tree stays within the limits', () => {
            write('src/a.ts', 'export {};\n');
            write('node_modules/pkg/big.js', 'x'.repeat(2048));
            expect(filesystemSnapshot(project, nodeModulesOnly('excluded'), tiny)).toEqual({ ok: true, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
            expect(filesystemSnapshot(project, nodeModulesOnly('not-ignored'), tiny)).toEqual({ ok: false, failure: 'limit-bytes' });
        });

        it('reports the entry limit distinctly', () => {
            write('a.txt');
            write('b.txt');
            write('c.txt');
            expect(filesystemSnapshot(project, undefined, { maxEntries: 2, maxBytes: 1024 })).toEqual({ ok: false, failure: 'limit-entries' });
        });

        it('ignores creating, changing or deleting an excluded directory but not changes elsewhere', () => {
            write('src/a.ts', 'a');
            const policy = nodeModulesOnly('excluded');
            const before = filesystemSnapshot(project, policy, tiny);
            write('node_modules/pkg/index.js', 'created by a sensor');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            write('node_modules/pkg/index.js', 'changed by a sensor');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            fs.rmSync(path.join(project, 'node_modules'), { recursive: true });
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            write('src/a.ts', 'changed');
            expect(filesystemSnapshot(project, policy, tiny)).not.toEqual(before);
        });

        it('never descends into the root .git and never asks about a linked directory', () => {
            write('.git/HEAD', 'ref');
            write('real/file.txt');
            fs.symlinkSync(path.join(project, 'real'), path.join(project, 'node_modules'), 'junction');
            const verifier = jest.fn((): CandidateVerdict => 'excluded');
            const policy = createExclusionPolicy({ defaults: false, rules: [{ kind: 'name', name: 'node_modules' }] }, verifier);
            const before = filesystemSnapshot(project, policy, tiny);
            write('.git/HEAD', 'changed');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            expect(verifier).not.toHaveBeenCalled();
        });

        it('returns unreadable for a missing root and rejects invalid arguments', () => {
            expect(filesystemSnapshot(path.join(root, 'missing'))).toEqual({ ok: false, failure: 'unreadable' });
            expect(() => filesystemSnapshot('')).toThrow(/non-empty string/);
            expect(() => filesystemSnapshot(project, undefined, { maxEntries: 0, maxBytes: 1 })).toThrow(/positive integers/);
        });
    });

    describe('remedies', () => {
        it('names the exceeded limit and the admission file', () => {
            expect(snapshotUnavailableRemedy('limit-bytes')).toMatch(/1 GiB/);
            expect(snapshotUnavailableRemedy('limit-bytes')).toContain('.awm/admission.json');
            expect(snapshotUnavailableRemedy('limit-entries')).toMatch(/250000 observed entries/);
            expect(snapshotUnavailableRemedy('limit-entries')).toContain('.awm/admission.json');
            expect(snapshotUnavailableRemedy('unreadable')).toBe('run admission from a readable git worktree');
        });

        it('names the offending admission field', () => {
            expect(admissionConfigRemedy({ field: 'schemaVersion', message: 'must be 1' })).toBe('repair .awm/admission.json: schemaVersion must be 1');
        });
    });

    describe('gitVerifier (real git)', () => {
        it('excludes only ignored directories that hold no tracked file', () => {
            git(['init', '-q', '-b', 'main']);
            write('.gitignore', 'node_modules/\ndist\n');
            write('node_modules/pkg/index.js');
            write('vendor/lib.js');
            write('dist/keep.txt');
            write('src/a.ts');
            git(['add', '.gitignore', 'src', 'vendor']);
            git(['add', '-f', 'dist/keep.txt']);
            git(['commit', '-qm', 'initial']);
            write('scratch/tmp.txt');

            const verify = gitVerifier(project);

            expect(verify('node_modules')).toBe('excluded');
            expect(verify('dist')).toBe('contains-tracked');
            expect(verify('vendor')).toBe('contains-tracked');
            expect(verify('scratch')).toBe('not-ignored');
        });

        it('reports git-unavailable outside a worktree', () => {
            write('node_modules/pkg/index.js');
            expect(gitVerifier(project)('node_modules')).toBe('git-unavailable');
        });

        it('fails loudly on an empty project root', () => {
            expect(() => gitVerifier('')).toThrow(/non-empty string/);
        });
    });
});
```

- [ ] **Step 3 — observe RED.** Run CMD-OBSERVATION. Expected: the suite fails to compile/resolve because `src/commands/sensors/read-only-observation` does not exist.

- [ ] **Step 4 — GREEN implementation.** Create `cli/src/commands/sensors/read-only-observation.ts`:

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { ReadOnlyCandidateRejection, ReadOnlyObservation } from './types';

/**
 * Admission's read-only observation (issue #215). `runSensors({ readOnly })` hashes
 * the project tree before and after the sensors run; any difference means the
 * evidence is not read-only. Generated output (node_modules, .next, …) can push that
 * walk past its limits, so a directory that git ignores and that holds no tracked
 * file may be skipped. Source files, `.gitignore`, and `.awm/` stay observed.
 */

export const READ_ONLY_MAX_ENTRIES = 250_000;
export const READ_ONLY_MAX_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_EXCLUSION_NAMES: readonly string[] = Object.freeze(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']);

const ADMISSION_CONFIG_LABEL = '.awm/admission.json';
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_FIELD_LABEL = 64;
const RESERVED_ROOTS = new Set(['.git', '.awm']);

export type ExclusionRule = { kind: 'name'; name: string } | { kind: 'path'; path: string };
export type AdmissionConfig = { defaults: boolean; rules: ExclusionRule[] };
export type AdmissionConfigResult = { ok: true; config: AdmissionConfig } | { ok: false; field: string; message: string };
export type CandidateVerdict = 'excluded' | ReadOnlyCandidateRejection['reason'];
export type CandidateVerifier = (relativePath: string) => CandidateVerdict;
export type ExclusionPolicy = { isExcluded(relativePath: string, name: string): boolean; evidence(): ReadOnlyObservation };
export type SnapshotFailure = 'limit-entries' | 'limit-bytes' | 'unreadable';
export type SnapshotResult = { ok: true; digest: string } | { ok: false; failure: SnapshotFailure };
export type SnapshotLimits = { maxEntries: number; maxBytes: number };

const DEFAULT_LIMITS: SnapshotLimits = { maxEntries: READ_ONLY_MAX_ENTRIES, maxBytes: READ_ONLY_MAX_BYTES };

function requireRoot(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Unknown keys come from the project file: bound them and strip control characters. */
function fieldLabel(key: string): string {
    const clean = key.replace(/[\u0000-\u001f\u007f]/g, '?');
    return clean.length <= MAX_FIELD_LABEL ? clean : `${clean.slice(0, MAX_FIELD_LABEL - 1)}…`;
}

function defaultRules(): ExclusionRule[] {
    return DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name' as const, name }));
}

function entryProblem(entry: string): string | null {
    if (entry === '') return 'must not be empty';
    if (/[\0\r\n\\*?[]/.test(entry)) return 'must not contain a backslash, wildcard, NUL or line break';
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return 'must be relative to the project root';
    if (entry.endsWith('/')) return 'must not end with "/"';
    const segments = entry.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return 'must not contain an empty, "." or ".." segment';
    if (RESERVED_ROOTS.has(segments[0].toLowerCase())) return 'must not exclude .git or .awm';
    return null;
}

/** Strict parser for the optional `.awm/admission.json`; absent means AWM defaults. */
export function loadAdmissionConfig(projectRoot: string): AdmissionConfigResult {
    const root = requireRoot(projectRoot, 'admission config projectRoot');
    const invalid = (field: string, message: string): AdmissionConfigResult => ({ ok: false, field, message });
    let raw: string;
    try {
        raw = fs.readFileSync(path.join(root, '.awm', 'admission.json'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, config: { defaults: true, rules: defaultRules() } };
        return invalid('(file)', 'could not be read');
    }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return invalid('(file)', 'is not valid JSON'); }
    if (!isRecord(value)) return invalid('(root)', 'must be a JSON object');
    const unknownRoot = Object.keys(value).find(key => key !== 'schemaVersion' && key !== 'readOnlyObservation');
    if (unknownRoot !== undefined) return invalid(fieldLabel(unknownRoot), 'is not a known field');
    if (value.schemaVersion !== 1) return invalid('schemaVersion', 'must be 1');
    const observation = 'readOnlyObservation' in value ? value.readOnlyObservation : {};
    if (!isRecord(observation)) return invalid('readOnlyObservation', 'must be an object');
    const unknownObservation = Object.keys(observation).find(key => key !== 'defaults' && key !== 'exclude');
    if (unknownObservation !== undefined) return invalid(`readOnlyObservation.${fieldLabel(unknownObservation)}`, 'is not a known field');
    const defaults = 'defaults' in observation ? observation.defaults : true;
    if (typeof defaults !== 'boolean') return invalid('readOnlyObservation.defaults', 'must be a boolean');
    const exclude = 'exclude' in observation ? observation.exclude : [];
    if (!Array.isArray(exclude)) return invalid('readOnlyObservation.exclude', 'must be an array of strings');
    const rules = defaults ? defaultRules() : [];
    for (const [index, entry] of exclude.entries()) {
        const field = `readOnlyObservation.exclude[${index}]`;
        if (typeof entry !== 'string') return invalid(field, 'must be a string');
        const problem = entryProblem(entry);
        if (problem) return invalid(field, problem);
        rules.push(entry.includes('/') ? { kind: 'path', path: entry } : { kind: 'name', name: entry });
    }
    return { ok: true, config: { defaults, rules } };
}

/**
 * Rule matching plus cached verdicts. The same policy instance serves the before and
 * after snapshots, so a candidate is verified once and both passes agree.
 */
export function createExclusionPolicy(config: AdmissionConfig, verifier: CandidateVerifier): ExclusionPolicy {
    if (!config || !Array.isArray(config.rules) || typeof config.defaults !== 'boolean') throw new Error('exclusion policy requires a validated admission config');
    if (typeof verifier !== 'function') throw new Error('exclusion policy requires a candidate verifier');
    const names = new Set(config.rules.flatMap(rule => (rule.kind === 'name' ? [rule.name] : [])));
    const paths = new Set(config.rules.flatMap(rule => (rule.kind === 'path' ? [rule.path] : [])));
    const verdicts = new Map<string, CandidateVerdict>();
    return {
        isExcluded(relativePath, name) {
            if (!names.has(name) && !paths.has(relativePath)) return false;
            let verdict = verdicts.get(relativePath);
            if (verdict === undefined) {
                verdict = verifier(relativePath);
                verdicts.set(relativePath, verdict);
            }
            return verdict === 'excluded';
        },
        evidence() {
            const excluded: string[] = [];
            const rejected: ReadOnlyCandidateRejection[] = [];
            const sorted = [...verdicts.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
            for (const [candidate, verdict] of sorted) {
                if (verdict === 'excluded') excluded.push(candidate);
                else rejected.push({ path: candidate, reason: verdict });
            }
            return { defaults: config.defaults, excluded, rejected };
        },
    };
}

/** Git decides: no tracked file inside (checked first) and ignored. Any doubt observes. */
export function gitVerifier(projectRoot: string): CandidateVerifier {
    const cwd = requireRoot(projectRoot, 'git verifier projectRoot');
    const git = (args: string[]) => spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    return relativePath => {
        // Tracked first: git already reports a directory holding a force-added file
        // as not ignored, which would hide the more precise reason.
        const tracked = git(['ls-files', '-z', '--', relativePath]);
        if ((tracked.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS') return 'contains-tracked';
        if (tracked.error || tracked.status !== 0) return 'git-unavailable';
        if (tracked.stdout !== '') return 'contains-tracked';
        const ignored = git(['check-ignore', '-q', '--', relativePath]);
        if (ignored.error) return 'git-unavailable';
        if (ignored.status === 0) return 'excluded';
        return ignored.status === 1 ? 'not-ignored' : 'git-unavailable';
    };
}

class SnapshotLimitError extends Error {
    constructor(readonly failure: 'limit-entries' | 'limit-bytes') {
        super(failure);
    }
}

/**
 * A git status only sees tracked and non-ignored paths, while a sensor can mutate
 * ignored runtime files (notably `.awm/`) just as easily, so the actual tree is
 * hashed. The walk is bounded: inability to observe the whole declared project means
 * no admission certificate. Excluded directories contribute nothing; observed
 * directories are hashed without their size, which changes as entries come and go
 * and is already covered by their children.
 */
export function filesystemSnapshot(root: string, policy?: ExclusionPolicy, limits: SnapshotLimits = DEFAULT_LIMITS): SnapshotResult {
    requireRoot(root, 'snapshot root');
    if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1 || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
        throw new Error('snapshot limits must be positive integers');
    }
    try {
        const digest = crypto.createHash('sha256');
        let entriesSeen = 0;
        let bytesSeen = 0;
        const visit = (directory: string, relative: string): void => {
            const entries = fs.readdirSync(directory, { withFileTypes: true })
                .sort((left, right) => left.name.localeCompare(right.name));
            for (const entry of entries) {
                // Git's internal bookkeeping changes as a consequence of normal
                // observation, not project sensor execution.
                if (relative === '' && entry.name === '.git') continue;
                const child = path.join(directory, entry.name);
                const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
                const stat = fs.lstatSync(child);
                if (stat.isDirectory() && policy?.isExcluded(childRelative, entry.name)) continue;
                if (++entriesSeen > limits.maxEntries) throw new SnapshotLimitError('limit-entries');
                if (stat.isDirectory()) {
                    digest.update(`${childRelative}\0${stat.mode}\0directory\0`);
                    visit(child, childRelative);
                    continue;
                }
                digest.update(`${childRelative}\0${stat.mode}\0${stat.size}\0`);
                if (stat.isFile()) {
                    if ((bytesSeen += stat.size) > limits.maxBytes) throw new SnapshotLimitError('limit-bytes');
                    digest.update('file\0');
                    digest.update(fs.readFileSync(child));
                } else if (stat.isSymbolicLink()) {
                    digest.update(`symlink\0${fs.readlinkSync(child)}\0`);
                } else {
                    digest.update(`special\0${stat.rdev}\0`);
                }
            }
        };
        visit(root, '');
        return { ok: true, digest: digest.digest('hex') };
    } catch (error) {
        return { ok: false, failure: error instanceof SnapshotLimitError ? error.failure : 'unreadable' };
    }
}

export function snapshotUnavailableRemedy(failure: SnapshotFailure): string {
    if (failure === 'unreadable') return 'run admission from a readable git worktree';
    const limit = failure === 'limit-bytes' ? '1 GiB of observed file content' : `${READ_ONLY_MAX_ENTRIES} observed entries`;
    return `the project tree exceeds the read-only observation limit of ${limit}; git-ignore heavy generated directories `
        + `(ignored ${DEFAULT_EXCLUSION_NAMES.join(', ')} are skipped by default) or declare them in ${ADMISSION_CONFIG_LABEL} readOnlyObservation.exclude`;
}

export function admissionConfigRemedy(problem: { field: string; message: string }): string {
    return `repair ${ADMISSION_CONFIG_LABEL}: ${problem.field} ${problem.message}`;
}
```

- [ ] **Step 5 — GREEN.** Run CMD-OBSERVATION and CMD-TYPECHECK; both pass.
- [ ] **Step 6 — Commit** `feat(sensors): read-only observation module with git-verified exclusions (#215)`.

#### Edge cases

- `{"readOnlyObservation": null}` is invalid (not silently defaulted): presence is checked with `in`, never `??` (B-R2/B-R3 test row).
- Reserved roots are matched case-insensitively (`.AWM` rejected) so a case-insensitive filesystem cannot smuggle `.awm` out (B-R5).
- A directory symlink/junction is never a candidate: `lstat` reports a link, not a directory (B-R9 test).
- `ls-files` overflowing 64 KiB means tracked content exists → `contains-tracked` (ENOBUFS branch); any other git failure or timeout → `git-unavailable`, which observes the directory (B-R10, B-R11, B-R13).
- Paths are passed after `--` to an argv (no shell), relative to `projectRoot`, `/`-separated on every platform (B-R6, B-R13).
- Only observed entries and bytes count toward the limits (B-R14).
- Every public function fails loudly on invalid input (empty root, non-positive limits, missing config/verifier).

#### Evidence

Sources SRC-DESIGN (B-R1–B-R14, V-R2, V-R3), SRC-RUN (current snapshot semantics to preserve), SRC-TYPES. RED: CMD-OBSERVATION fails on the missing module. GREEN: CMD-OBSERVATION, CMD-TYPECHECK. V-R3(b) is the `gitVerifier (real git)` describe; V-R3(a) is S1's `check-insteadof.test.ts`. Obtain distinct clean specification and code-quality verdicts against the current plan identity.

#### Fallback

If `fs.symlinkSync(..., 'junction')` is refused on a CI platform, replace that single setup line with a skip-free alternative that still proves the claim (assert `verifier` is never called for a directory-symlink by stubbing `fs.lstatSync` for that path), record the amendment, and revalidate. If `git check-ignore` semantics differ on an older git in CI, keep the tracked-first order and amend the expected reason only after reproducing the platform output; never mark a candidate excluded on uncertain git output.

<a id="slice-s3"></a>
### Slice S3: runSensors wiring, evidence and admission diagnostic

#### Surfaces

Owns B-R3, B-R8, B-R12, B-R15, B-R16, B-R17. Grouping rationale: these are the runtime contract of a read-only run as seen by its two consumers (`runSensors` output and the admission diagnostic); they change together and are verified end-to-end with mocked sensor execution.

- Modify `cli/src/commands/sensors/run.ts` (drop the local snapshot; wire config → policy → before/after snapshots → evidence).
- Modify `cli/src/core/admission/index.ts` (diagnostic message only; report schema unchanged).
- Create `cli/tests/commands/sensors/run-read-only.test.ts`.
- Modify `cli/tests/core/admission/index.test.ts` (new describe).

#### Implementation

- [ ] **Step 1 — RED runSensors tests.** Create `cli/tests/commands/sensors/run-read-only.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: any[]) => mockRunCommand(...args),
}));

const { ok } = require('./exec-fixtures');

describe('runSensors read-only observation (admission)', () => {
    const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
    let root: string;
    let project: string;

    beforeEach(() => {
        jest.resetModules();
        mockRunCommand.mockReset();
        mockRunCommand.mockResolvedValue(ok(''));
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-readonly-'));
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        const home = path.join(root, 'home');
        fs.mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        const globalConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(globalConfig, '[user]\n\temail = test@example.test\n\tname = test\n');
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        process.env.GIT_CEILING_DIRECTORIES = root;
        project = path.join(root, 'project');
        write('.awm/sensors.json', JSON.stringify({ pack: 'js-ts', sensors: { lint: { fast: true, cmd: 'eslint --format json .' } } }));
    });

    afterEach(() => {
        jest.dontMock('../../../src/commands/sensors/read-only-observation');
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    function write(relative: string, content = 'x'): void {
        const file = path.join(project, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    const git = (args: string[]): string => execFileSync('git', args, { cwd: project, stdio: 'pipe', encoding: 'utf8' });
    function commitProject(gitignore: string): void {
        write('.gitignore', gitignore);
        git(['init', '-q', '-b', 'main']);
        git(['add', '.']);
        git(['commit', '-qm', 'initial']);
    }
    const load = () => require('../../../src/commands/sensors/run');

    it('skips ignored default directories, including one a sensor creates, and reports them', async () => {
        commitProject('node_modules/\ncoverage/\n');
        write('node_modules/pkg/index.js', 'installed');
        mockRunCommand.mockImplementation(async () => {
            write('coverage/lcov.info', 'sensor output');
            write('node_modules/pkg/index.js', 'rebuilt');
            return ok('');
        });

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out.reason).not.toBe('read-only-mutation-detected');
        expect(out.reason).not.toBe('read-only-observation-unavailable');
        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: ['coverage', 'node_modules'], rejected: [] });
    });

    it('still detects a mutation inside a matching directory that is not ignored', async () => {
        commitProject('');
        write('node_modules/pkg/index.js', 'installed');
        mockRunCommand.mockImplementation(async () => {
            write('node_modules/pkg/index.js', 'rebuilt');
            return ok('');
        });

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out).toMatchObject({ overall: 'not_certified', reason: 'read-only-mutation-detected' });
        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: [], rejected: [{ path: 'node_modules', reason: 'not-ignored' }] });
    });

    it('observes everything and says so when the project is not a git worktree', async () => {
        write('node_modules/pkg/index.js', 'installed');

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: [], rejected: [{ path: 'node_modules', reason: 'git-unavailable' }] });
    });

    it('blocks a read-only run on an invalid admission file before running sensors', async () => {
        write('.awm/admission.json', JSON.stringify({ schemaVersion: 2 }));

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out).toMatchObject({
            overall: 'not_certified', mode: 'invalid', reason: 'admission-config-invalid',
            remedy: 'repair .awm/admission.json: schemaVersion must be 1',
        });
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('never reads the admission file outside read-only runs', async () => {
        write('.awm/admission.json', JSON.stringify({ schemaVersion: 2 }));

        const out = await load().runSensors({ cwd: project });

        expect(out.reason).not.toBe('admission-config-invalid');
        expect(out.readOnlyObservation).toBeUndefined();
        expect(mockRunCommand).toHaveBeenCalled();
    });

    it('returns an actionable remedy with evidence when the snapshot exceeds a limit', async () => {
        jest.doMock('../../../src/commands/sensors/read-only-observation', () => {
            const actual = jest.requireActual('../../../src/commands/sensors/read-only-observation');
            return { ...actual, filesystemSnapshot: () => ({ ok: false, failure: 'limit-bytes' }) };
        });

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out).toMatchObject({ overall: 'not_certified', reason: 'read-only-observation-unavailable' });
        expect(out.remedy).toMatch(/1 GiB/);
        expect(out.remedy).toContain('.awm/admission.json');
        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: [], rejected: [] });
        expect(mockRunCommand).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2 — RED admission test.** In `cli/tests/core/admission/index.test.ts`, add inside `describe('admitPlan', () => { … })`, right after the `describe('the R8 registry opt-out closure exception', …)` block:

```ts
    describe('the sensor-blocked diagnostic', () => {
        const base = () => ({ plan: valid as PlanValidationReport, provider: 'codex' as const, cwd: process.cwd(), enabledAgents: ['codex'] as const, verifySensors: true });

        it('carries the sensor reason and remedy when the verdict is not-certified', async () => {
            const report = await admitPlan({ ...base(), sensors: {
                overall: 'not_certified', sensors: [], mode: 'invalid', reason: 'read-only-observation-unavailable',
                remedy: 'declare heavy directories in .awm/admission.json.', projectRoot: '/r', manifestPath: '/r/.awm/sensors.json',
            } as any });

            expect(report.diagnostics[0]).toEqual({
                code: 'ADMISSION_SENSORS_BLOCKED',
                message: 'Sensor verdict is not-certified (read-only-observation-unavailable): declare heavy directories in .awm/admission.json.',
            });
            expect(report.diagnostics[0].message.match(/ADMISSION_[A-Z_]+/g)).toBeNull();
        });

        it('keeps the reason alone when the run has no remedy', async () => {
            const report = await admitPlan({ ...base(), sensors: {
                overall: 'not_certified', sensors: [], mode: 'native-gate', reason: 'native-gate-declared', projectRoot: '/r', manifestPath: '/r/.awm/sensors.json',
            } as any });

            expect(report.diagnostics[0].message).toBe('Sensor verdict is not-certified (native-gate-declared).');
        });

        it('keeps the bare verdict for a failing run', async () => {
            const report = await admitPlan({ ...base(), sensors: {
                overall: 'fail', sensors: [], mode: 'project-sensors', reason: 'configured-v3', projectRoot: '/r', manifestPath: '/r/.awm/sensors.json',
            } as any });

            expect(report.diagnostics[0]).toEqual({ code: 'ADMISSION_SENSORS_BLOCKED', message: 'Sensor verdict is fail.' });
        });
    });
```

- [ ] **Step 3 — observe RED.** Run CMD-RUN-READONLY. Expected failures: `readOnlyObservation` undefined in the three evidence tests; `admission-config-invalid` not produced; the mocked `filesystemSnapshot` is never imported by `run.ts`; the admission message is still `Sensor verdict is not-certified.`. Existing `run.test.ts` / `run-changed.test.ts` read-only tests still pass.

- [ ] **Step 4 — GREEN `run.ts`.** In `cli/src/commands/sensors/run.ts`:
  1. Delete `import fs from 'fs';` and `import crypto from 'crypto';` (only the snapshot used them; `os` and `path` stay).
  2. Add after the `import { resolveSensorProject, softRecoverInvalidProject } from './project';` line:

```ts
import {
    admissionConfigRemedy,
    createExclusionPolicy,
    filesystemSnapshot,
    gitVerifier,
    loadAdmissionConfig,
    snapshotUnavailableRemedy,
    type ExclusionPolicy,
} from './read-only-observation';
```

  3. Delete the block from `const READ_ONLY_MAX_ENTRIES = 250_000;` through the closing `}` of `function filesystemSnapshot(root: string): string | null { … }` (constants, doc comment and function — now in the module).
  4. Replace

```ts
    const manifestDir = configured.projectRoot;
    const beforeReadOnly = opts.readOnly ? filesystemSnapshot(manifestDir) : undefined;
    if (opts.readOnly && beforeReadOnly === null) {
        return { sensors: [], overall: 'not_certified', projectRoot: configured.projectRoot, manifestPath: configured.manifestPath, mode: 'invalid', reason: 'read-only-observation-unavailable', remedy: 'run admission from a readable git worktree' };
    }
```

  with

```ts
    const manifestDir = configured.projectRoot;
    // Admission-only: `.awm/admission.json` is never read for ordinary runs.
    let readOnlyPolicy: ExclusionPolicy | undefined;
    let beforeReadOnly: string | undefined;
    if (opts.readOnly) {
        const admissionConfig = loadAdmissionConfig(manifestDir);
        if (!admissionConfig.ok) {
            return { sensors: [], overall: 'not_certified', projectRoot: configured.projectRoot, manifestPath: configured.manifestPath, mode: 'invalid', reason: 'admission-config-invalid', remedy: admissionConfigRemedy(admissionConfig) };
        }
        readOnlyPolicy = createExclusionPolicy(admissionConfig.config, gitVerifier(manifestDir));
        const before = filesystemSnapshot(manifestDir, readOnlyPolicy);
        if (!before.ok) {
            return { sensors: [], overall: 'not_certified', projectRoot: configured.projectRoot, manifestPath: configured.manifestPath, mode: 'invalid', reason: 'read-only-observation-unavailable', remedy: snapshotUnavailableRemedy(before.failure), readOnlyObservation: readOnlyPolicy.evidence() };
        }
        beforeReadOnly = before.digest;
    }
```

  5. Replace the tail

```ts
    if (opts.readOnly && filesystemSnapshot(manifestDir) !== beforeReadOnly) {
        return { ...output, overall: 'not_certified', reason: 'read-only-mutation-detected', remedy: 'sensor execution changed the worktree; repair it before using this evidence for admission' };
    }
    return output;
```

  with

```ts
    if (readOnlyPolicy) {
        // Same policy instance: cached verdicts keep both passes consistent.
        const after = filesystemSnapshot(manifestDir, readOnlyPolicy);
        const readOnlyObservation = readOnlyPolicy.evidence();
        if (!after.ok || after.digest !== beforeReadOnly) {
            return { ...output, overall: 'not_certified', reason: 'read-only-mutation-detected', remedy: 'sensor execution changed the worktree; repair it before using this evidence for admission', readOnlyObservation };
        }
        return { ...output, readOnlyObservation };
    }
    return output;
```

- [ ] **Step 5 — GREEN admission.** In `cli/src/core/admission/index.ts`, add directly below `function sensorVerdict(…)`:

```ts
/** A not-certified verdict alone does not say what to fix; carry the run's own cause. */
function sensorBlockedMessage(report: RunOutput, verdict: AdmissionReport['sensors']): string {
    const reason = verdict === 'not-certified' && typeof report.reason === 'string' ? report.reason.trim() : '';
    if (!reason) return `Sensor verdict is ${verdict}.`;
    const remedy = typeof report.remedy === 'string' ? report.remedy.trim().replace(/\.+$/, '') : '';
    return remedy ? `Sensor verdict is ${verdict} (${reason}): ${remedy}.` : `Sensor verdict is ${verdict} (${reason}).`;
}
```

  and in the sensor gate replace `diagnostic('ADMISSION_SENSORS_BLOCKED', \`Sensor verdict is ${sensors}.\`)` with `diagnostic('ADMISSION_SENSORS_BLOCKED', sensorBlockedMessage(input.sensors, sensors))`. `RunOutput` is already imported there (used by `sensorVerdict`); keep the report shape unchanged.

- [ ] **Step 6 — GREEN.** Run CMD-RUN-READONLY, CMD-OBSERVATION, CMD-TYPECHECK, CMD-LINT, CMD-DEPCHECK; all pass.
- [ ] **Step 7 — Commit** `feat(admission): skip git-ignored output in read-only snapshot and explain sensor blocks (#215)`.

#### Edge cases

- Invalid `.awm/admission.json` blocks only `readOnly` runs, before any sensor executes (B-R3, B-R8 tests).
- A sensor-created ignored directory (`coverage/`) is excluded in the after pass because excluded directories add nothing to the digest and observed directories are hashed without size (B-R12 test).
- An after-snapshot failure (`!after.ok`) is still a mutation verdict, as before (old `null !== digest`).
- Early returns between the snapshots (native-gate, opt-out, source errors) keep their current shape; evidence is attached on the final output, the mutation verdict, and the before-snapshot failure (design B-R15 wording).
- The admission message never introduces an extra `ADMISSION_*` token, so `admission-recovery.ts` classification (exactly one token) is unaffected (B-R17 test).
- Diagnostic text is still passed through `diagnostic()` → `safe()` (control characters escaped, length bounded).

#### Evidence

Sources SRC-DESIGN (B-R3, B-R8, B-R12, B-R15–B-R17), SRC-RUN, SRC-TYPES, SRC-RUN-TEST (harness pattern), SRC-ADMISSION (message + recovery constraint). RED: CMD-RUN-READONLY as in Step 3. GREEN: CMD-RUN-READONLY, CMD-OBSERVATION, CMD-TYPECHECK, CMD-LINT, CMD-DEPCHECK. Obtain distinct clean specification and code-quality verdicts against the current plan identity.

#### Fallback

If the legacy manifest used by the harness stops reaching sensor execution in a future change, switch the test manifest to the minimal form used by `run-changed.test.ts` at that time and record the amendment. If `jest.doMock` of the observation module conflicts with module caching, move the limit-failure wiring test into its own file with the mock declared at top level. Never relax the mutation check or attach exclusions to non-read-only runs to make a test pass.

<a id="slice-s4"></a>
### Slice S4: Documentation and help text

#### Surfaces

Owns V-R4. One cohesive boundary: user-facing descriptions of the behavior delivered in S1–S3.

- Modify `docs/configuration.md` (new section before `## What machine initialization installs`).
- Modify `docs/cli-reference.md` (paragraph after the R8 paragraph in `### \`awm plan admit PLAN_PATH\``).
- Modify `docs/operations/cloud-and-platforms.md` (paragraph after the "Verify the token did not leak to disk" code block in `## 2. Validated cloud flow`).
- Modify `cli/src/commands/plan/index.ts` (`--verify-sensors` help string).
- Create `cli/tests/structural/cloud-admission-docs-contract.test.ts`.

#### Implementation

- [ ] **Step 1 — RED.** Create `cli/tests/structural/cloud-admission-docs-contract.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

/** CMD-DOCS — V-R4 (issue #215 documentation). */
const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative: string): string => fs.readFileSync(path.join(repoRoot, ...relative.split('/')), 'utf8');

describe('issue #215 documentation contract (V-R4)', () => {
    it('documents .awm/admission.json with defaults, the git rule and the accepted risk', () => {
        const doc = read('docs/configuration.md');
        expect(doc).toContain('## Read-only admission observation (`.awm/admission.json`)');
        for (const name of ['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']) expect(doc).toContain(`\`${name}\``);
        expect(doc).toContain('git-ignored and contains no tracked file');
        expect(doc).toContain('**Accepted risk:**');
        expect(doc).toContain('`admission-config-invalid`');
        expect(doc).toContain('`readOnlyObservation`');
    });

    it('points --verify-sensors in the CLI reference at the observation rules', () => {
        const doc = read('docs/cli-reference.md');
        expect(doc).toContain('configuration.md#read-only-admission-observation-awmadmissionjson');
        expect(doc).toContain('`readOnlyObservation`');
    });

    it('states that the D-7 insteadOf recipe passes strict currentness', () => {
        const doc = read('docs/operations/cloud-and-platforms.md');
        expect(doc).toContain('`awm preflight --require-current`');
        expect(doc).toContain('`remote.origin.url`');
    });

    it('describes the snapshot exclusions in the plan admit help', () => {
        expect(read('cli/src/commands/plan/index.ts')).toContain(
            "'require an empirical sensor pass; read-only observation skips git-ignored build output (see .awm/admission.json)'",
        );
    });
});
```

- [ ] **Step 2 — observe RED.** Run CMD-DOCS: all four tests fail.

- [ ] **Step 3 — GREEN docs.** Insert into `docs/configuration.md`, immediately before `## What machine initialization installs`:

~~~markdown
## Read-only admission observation (`.awm/admission.json`)

`awm plan admit --verify-sensors` runs the project sensors in read-only mode: it hashes
the project tree before and after the run, and any difference makes the sensor evidence
`not_certified` with reason `read-only-mutation-detected`. The walk is bounded to 250000
observed entries and 1 GiB of observed file content; past either limit the reason is
`read-only-observation-unavailable` and the remedy names the limit.

Generated output such as `node_modules` would exhaust those limits, so the snapshot
skips a directory when it matches an exclusion rule **and** git confirms that it is
git-ignored and contains no tracked file (force-added files count as tracked). A matching
directory that fails either check is hashed as usual. Without git, nothing is skipped.

By default, directories with these names are candidates at any depth: `node_modules`,
`.next`, `.turbo`, `dist`, `build`, `coverage`, `.venv`, `target`. A project can extend
or replace that list with an optional, committed `.awm/admission.json`:

```json
{
  "schemaVersion": 1,
  "readOnlyObservation": {
    "defaults": true,
    "exclude": ["storybook-static", "apps/web/.cache"]
  }
}
```

- `defaults` (default `true`) keeps the built-in names; `false` drops them.
- `exclude` adds rules. An entry without `/` matches a directory name at any depth; an
  entry with `/` matches that exact path relative to the project root.
- Entries cannot be empty or absolute, contain empty, `.` or `..` segments, backslashes,
  wildcards or line breaks, end with `/`, or name `.git` or `.awm`.
- An invalid file blocks read-only runs with reason `admission-config-invalid` and a
  remedy naming the field. Ordinary `awm sensors run` never reads the file.

Every read-only run reports what it skipped in `readOnlyObservation`: `defaults`,
`excluded`, and `rejected` entries with reason `not-ignored`, `contains-tracked`, or
`git-unavailable`.

**Accepted risk:** a sensor that changes content inside a skipped directory is not
detected. Changes to tracked files, `.gitignore`, and `.awm/` still are. CLIs older than
this feature ignore `.awm/admission.json` and observe the whole tree.
~~~

  In `docs/cli-reference.md`, after the paragraph ending `The release proof of such a registry lives in its CI (\`validate\` and \`auto-tag\`).`, add:

~~~markdown

The sensor run behind `--verify-sensors` is read-only: a tree snapshot taken before and
after the run must match. Git-ignored generated directories that hold no tracked file (by
default `node_modules`, `.next`, `dist`, `coverage`, and similar) are skipped and listed
in the run's `readOnlyObservation`; see
[Read-only admission observation](configuration.md#read-only-admission-observation-awmadmissionjson).
When admission blocks on a `not-certified` sensor verdict, `ADMISSION_SENSORS_BLOCKED`
carries the sensor run's reason and remedy.
~~~

  In `docs/operations/cloud-and-platforms.md`, after the closing fence of the code block that follows "Verify the token did not leak to disk:", add:

~~~markdown

Strict currentness works with this recipe. `awm preflight --require-current` and
`awm plan admit --require-current` compare the registry checkout's stored
`remote.origin.url` (the clean URL) with the configured remote, not the token-bearing URL
that `git remote get-url` reports after the `insteadOf` rewrite. No temporary
`GIT_CONFIG_GLOBAL` workaround is needed.
~~~

- [ ] **Step 4 — GREEN help.** In `cli/src/commands/plan/index.ts` replace `.option('--verify-sensors', 'require an empirical sensor pass')` with `.option('--verify-sensors', 'require an empirical sensor pass; read-only observation skips git-ignored build output (see .awm/admission.json)')`.
- [ ] **Step 5 — GREEN.** Run CMD-DOCS and CMD-TYPECHECK; both pass.
- [ ] **Step 6 — Commit** `docs(admission): document read-only observation and insteadOf currentness (#215)`.

#### Edge cases

- The anchor `#read-only-admission-observation-awmadmissionjson` is GitHub's slug for the exact heading (backticks, dots, slash and parentheses dropped); the structural test pins both heading and link.
- Docs claim only shipped behavior: limits, default names, entry grammar, reason codes and evidence field names must match S2/S3 code exactly.

#### Evidence

Sources SRC-DESIGN (V-R4), SRC-DOCS (insertion points), SRC-PLAN-CMD (help text). RED/GREEN: CMD-DOCS; CMD-TYPECHECK. Obtain distinct clean specification and code-quality verdicts against the current plan identity; `post-implementation-docs` later re-verifies these claims against the built binary.

#### Fallback

If a docs heading used as an insertion point has moved, insert at the nearest equivalent section and amend SRC-DOCS with the new locator before continuing. Never document behavior the code does not implement.

## Traceability matrix

| Req | Slice | Test(s) |
|-----|-------|---------|
| A-R1 | S1 | `check.test.ts` "reads the literal origin config value…"; `check-insteadof.test.ts` "reports the registry current when only the transport URL is rewritten" |
| A-R2 | S1 | `check-insteadof.test.ts` "still reports an origin stored with a different path as unverifiable"; existing `check.test.ts` origin-mismatch and SSH-userinfo tests (now mocking `config`) |
| A-R3 | S1 | `check.test.ts` "reports a missing origin config value as an unreadable origin" |
| A-R4 | S1 | `check.test.ts` "reads the literal origin config value…" (`x-access-token`/`SECRET` absent); existing credential-bearing mismatch test |
| A-R5 | S1 | `check.test.ts` "reads the literal origin config value…" (`ls-remote --tags <configured>` call) |
| B-R1 | S2 | `read-only-observation.test.ts` "applies the AWM defaults when the file is absent" |
| B-R2 | S2 | "adds declared name and path rules…", "keeps the defaults when only exclude is declared", `rejects %j at field %s` rows |
| B-R3 | S3 | `run-read-only.test.ts` "blocks a read-only run on an invalid admission file before running sensors" (module-level rows in S2 prove the parser side) |
| B-R4 | S2 | `rejects the exclude entry %j` rows (empty, absolute, segments, backslash, wildcards, NUL, line break, trailing slash) |
| B-R5 | S2 | `rejects the exclude entry %j` rows `.git`, `.awm`, `.awm/cache`, `.git/hooks`, `.AWM` |
| B-R6 | S2 | "matches a name rule at any depth and a path rule only at its exact path" |
| B-R7 | S2 | "applies the AWM defaults when the file is absent" (exact list assertion) |
| B-R8 | S3 | `run-read-only.test.ts` "never reads the admission file outside read-only runs" |
| B-R9 | S2 | "skips an excluded directory so an ignored heavy tree stays within the limits"; "ignores creating, changing or deleting an excluded directory…"; "never descends into the root .git and never asks about a linked directory"; `gitVerifier` "excludes only ignored directories…" (`node_modules` → excluded) |
| B-R10 | S2 | `gitVerifier` "excludes only ignored directories…" (`dist`/`vendor` → contains-tracked, `scratch` → not-ignored); "verifies each candidate once and reports sorted evidence" |
| B-R11 | S2 | `gitVerifier` "reports git-unavailable outside a worktree"; S3 "observes everything and says so when the project is not a git worktree" |
| B-R12 | S3 | `run-read-only.test.ts` "skips ignored default directories, including one a sensor creates…"; S2 "verifies each candidate once…" (cache) |
| B-R13 | S2 | `gitVerifier` real-git tests (argv with `--`, cwd = project); ENOBUFS/timeout branches by code review against the Edge cases list (no automated timeout test — relies on review) |
| B-R14 | S2 | "skips an excluded directory so an ignored heavy tree stays within the limits" (excluded bytes not counted); "reports the entry limit distinctly" |
| B-R15 | S3 | `run-read-only.test.ts` evidence assertions in the first three tests and the limit test |
| B-R16 | S3 | `run-read-only.test.ts` "returns an actionable remedy with evidence when the snapshot exceeds a limit"; S2 `remedies` tests |
| B-R17 | S3 | `admission/index.test.ts` "the sensor-blocked diagnostic" (three tests) |
| V-R1 | S1 | every new test file's `beforeEach`/`afterEach` env override and restore (review evidence; reused in S2/S3) |
| V-R2 | S2 | `tiny` limits (50 entries / 1 KiB) and `maxEntries: 2` fixtures; S3 mocks the limit failure instead of building volume |
| V-R3 | S2 | (a) `check-insteadof.test.ts` (delivered in S1); (b) `gitVerifier (real git)` describe |
| V-R4 | S4 | `cloud-admission-docs-contract.test.ts` (four tests) |

Backward check: every new test and every code change above maps to at least one requirement; no orphan scope. Coverage gate: every requirement has ≥1 slice and ≥1 test (B-R13's timeout branch is verified by review, stated explicitly).
