# AWM Doctor Dashboard and Impact Evidence Implementation Plan

<!-- awm-qa-complete: 2026-08-22 (Release A / #86; visual-fidelity exception authorized by user) -->
<!-- awm-retro-complete: 2026-08-22 (Release A / #86) -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `awm doctor` with complete terminal and static HTML dashboards, then add durable local cycle evidence and honest impact history for issues #86 and #87 without changing the existing JSON contract.

**Architecture:** Keep `awm doctor --json` on its current provider-report path and build the new views from a versioned `DashboardSnapshotV1`. Read-only adapters feed a sanitizer and validator; pure terminal/HTML renderers consume the same snapshot; a separate atomic writer owns the requested HTML target. Release B adds validated `CycleEvidenceV1` files, plan-state classification, and local impact calculations before the baseline registry invokes capture from `harness-retro`.

**Tech Stack:** TypeScript 5.9, Node.js 22 filesystem APIs, Commander 14, Jest 30, picocolors, static self-contained HTML/CSS, GitHub Actions.

**Modo de ejecución:** desatendido

> **Excepción de fidelidad visual (2026-08-22):** El usuario autorizó cerrar
> Release A aunque la revisión de fidelidad visual 3/3 conservó divergencias
> documentadas de densidad, composición y controles frente a los dos artefactos
> Stitch aprobados. Esta excepción solo libera el cierre de Release A; no
> declara los diseños idénticos ni relaja las demás pruebas de contrato, datos,
> seguridad, accesibilidad o publicación inmutable.

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

## Delivery order

This plan is serial because Release B consumes contracts shipped by Release A and the registry change must not call an unpublished CLI command.

1. **Release A / #86:** freeze current JSON, introduce `DashboardSnapshotV1`, collectors, sanitization, `--full`, `--html`, `--force`, and both renderers.
2. **Release B / #87:** introduce `CycleEvidenceV1`, capture/storage, plan history, impact calculations, and evidence rendering.
3. **Registry follow-up:** publish the compatible CLI, then update `harness-retro` with a minimum-version guard and capture step.
4. **Published acceptance:** test immutable CLI and registry artifacts on Linux, macOS, and Windows.

## File map

### Agentic workflow CLI

- Create `cli/src/core/dashboard/types.ts`: `DashboardSnapshotV1` and section/item enums.
- Create `cli/src/core/dashboard/validate.ts`: fail-loud snapshot validation and deterministic ordering.
- Create `cli/src/core/dashboard/sanitize.ts`: share-safe scalar and source-boundary sanitization.
- Create `cli/src/core/dashboard/collect.ts`: read-only machine/project adapters and snapshot assembly.
- Create `cli/src/core/dashboard/plan-state.ts`: plan marker/journal classification.
- Create `cli/src/core/dashboard/render-terminal.ts`: complete `--full` renderer.
- Create `cli/src/core/dashboard/render-html.ts`: semantic self-contained HTML renderer.
- Create `cli/src/core/dashboard/styles.ts`: inline responsive/print/focus CSS tokens derived from the approved Stitch artifacts.
- Create `cli/src/core/dashboard/write-html.ts`: target validation and atomic mode-safe writes.
- Create `cli/src/core/evidence/types.ts`: `CycleEvidenceV1` contract and validation.
- Create `cli/src/core/evidence/store.ts`: deterministic evidence paths and atomic persistence.
- Create `cli/src/core/evidence/capture.ts`: journal/plan/gate/ledger aggregation.
- Create `cli/src/core/evidence/history.ts`: confidence, retry, recurrence, and plan-history calculations.
- Create `cli/src/commands/evidence/index.ts`: internal/public `awm evidence capture` command boundary.
- Modify `cli/src/commands/doctor.ts`: option validation and routing without changing the legacy JSON path.
- Modify `cli/src/index.ts`: register the evidence command.

### Tests and fixtures

- Create `cli/tests/fixtures/doctor-json/bare-home.json` and `cli/tests/fixtures/doctor-json/project.json`: frozen legacy JSON results.
- Create `cli/tests/helpers/dashboard-fixtures.ts`: deterministic snapshot/source builders and legacy command capture.
- Create `cli/tests/helpers/evidence-fixtures.ts`: valid evidence records with safe override support.
- Create `cli/tests/core/dashboard/contracts.test.ts`.
- Create `cli/tests/core/dashboard/collect.test.ts`.
- Create `cli/tests/core/dashboard/plan-state.test.ts`.
- Create `cli/tests/core/dashboard/render-terminal.test.ts`.
- Create `cli/tests/core/dashboard/render-html.test.ts`.
- Create `cli/tests/core/dashboard/write-html.test.ts`.
- Create `cli/tests/core/evidence/types.test.ts`.
- Create `cli/tests/core/evidence/store.test.ts`.
- Create `cli/tests/core/evidence/capture.test.ts`.
- Create `cli/tests/core/evidence/history.test.ts`.
- Create `cli/tests/integration/doctor-dashboard.e2e.test.ts`.
- Create `cli/tests/integration/published-doctor-evidence.e2e.test.ts`.
- Modify `cli/tests/commands/doctor.test.ts` and `cli/tests/commands/doctor-is-read-only.test.ts`.
- Modify `.github/workflows/ci.yml` and `.github/workflows/release.yml` for the published-artifact matrix.

### Baseline registry follow-up

- Modify `/srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry/skills/harness-retro/SKILL.md` after the compatible CLI is published.
- Create `/srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry/tests/cycle-evidence-capture-contract.test.mjs`.
- Modify `/srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry/awm-registry.json` with the minimum CLI compatibility declaration.

## Task 1: Freeze legacy JSON and define dashboard contracts

_Requirements: R1.1, R2.1, R2.6, R8.2_

**Files:**
- Create: `cli/src/core/dashboard/types.ts`
- Create: `cli/src/core/dashboard/validate.ts`
- Create: `cli/tests/core/dashboard/contracts.test.ts`
- Create: `cli/tests/helpers/dashboard-fixtures.ts`
- Create: `cli/tests/fixtures/doctor-json/bare-home.json`
- Create: `cli/tests/fixtures/doctor-json/project.json`
- Modify: `cli/tests/commands/doctor.test.ts`

- [x] **Step 1: Add failing legacy JSON fixture tests**

```ts
function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

function runDoctorFixture(input: { fixture: 'bare-home' | 'project'; json: boolean }): {
  code: number; stdout: string;
} {
  const env = installDoctorFixture(input.fixture);
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const code = runDoctor({ cwd: env.cwd, json: input.json });
    return { code, stdout: write.mock.calls.map((call) => String(call[0])).join('') };
  } finally {
    write.mockRestore();
    env.restore();
  }
}

it('keeps the bare-home provider JSON contract byte-for-byte stable', () => {
  const { code, stdout } = runDoctorFixture({ fixture: 'bare-home', json: true });
  expect(code).toBe(1);
  expect(stdout).toBe(readFixture('doctor-json/bare-home.json')); // verifies R1.1, R8.2
});

it('keeps the project provider JSON contract byte-for-byte stable', () => {
  const { stdout } = runDoctorFixture({ fixture: 'project', json: true });
  expect(stdout).toBe(readFixture('doctor-json/project.json')); // verifies R1.1, R8.2
});
```

- [x] **Step 2: Run the compatibility tests and record the expected failure**

Run: `cd cli && npm test -- --runTestsByPath tests/commands/doctor.test.ts`

Expected: FAIL because the two fixture files and deterministic fixture helper do not exist.

- [x] **Step 3: Capture current JSON as immutable fixtures and add the versioned types**

```ts
export type DashboardItemState =
  | 'ok' | 'attention' | 'missing' | 'unavailable' | 'not_applicable';

export interface DashboardItemV1 {
  id: string;
  label: string;
  state: DashboardItemState;
  detail?: string;
  remediation?: string;
}

export interface DashboardSectionV1 {
  id: 'machine' | 'project' | 'planning' | 'execution' | 'qa' | 'retro' | 'history';
  availability: 'available' | 'unavailable' | 'not_applicable';
  items: DashboardItemV1[];
}

export interface DashboardSnapshotV1 {
  schema: 1;
  generatedAt: string;
  overall: 'healthy' | 'degraded';
  project: { detected: boolean; label: string };
  confidence: 'none' | 'provisional' | 'observing' | 'supported';
  sections: DashboardSectionV1[];
}

export function dashboardSnapshot(
  overrides: Partial<DashboardSnapshotV1> = {},
): DashboardSnapshotV1 {
  return {
    schema: 1,
    generatedAt: '2026-08-22T00:00:00.000Z',
    overall: 'healthy',
    project: { detected: false, label: 'No project detected' },
    confidence: 'none',
    sections: [{ id: 'machine', availability: 'available', items: [] }],
    ...overrides,
  };
}
```

`validateDashboardSnapshotV1(value: unknown): DashboardSnapshotV1` must throw `DashboardValidationError` for invalid schema versions, enums, duplicate IDs, non-deterministic section order, or actionable non-ok items without a remediation command. `not_applicable` must reject remediation text.

- [x] **Step 4: Add validator tests and make them pass**

```ts
it.each(['attention', 'missing', 'unavailable'] as const)(
  'rejects actionable state %s without a command',
  (state) => expect(() => validateDashboardSnapshotV1(dashboardSnapshot({
    sections: [{
      id: 'machine', availability: 'available',
      items: [{ id: 'machine.test', label: 'Test', state }],
    }],
  })))
    .toThrow(/remediation command/i), // verifies R2.6
);

it('rejects duplicate item IDs and unstable section order', () => {
  const invalid = dashboardSnapshot({
    sections: [
      { id: 'project', availability: 'available', items: [] },
      { id: 'machine', availability: 'available', items: [] },
    ],
  });
  expect(() => validateDashboardSnapshotV1(invalid))
    .toThrow(DashboardValidationError); // verifies R2.1
});
```

Run: `cd cli && npm test -- --runTestsByPath tests/core/dashboard/contracts.test.ts tests/commands/doctor.test.ts`

Expected: PASS.

- [x] **Step 5: Demonstrate the regression boundary**

Temporarily rename `providers` to `providerRows` in the JSON serialization seam, rerun the two fixture tests and observe FAIL, then restore `providers` and rerun to PASS. Do not commit the temporary mutation. This records the fail/pass/revert-fail/restore-pass cycle required by R8.5 for the legacy contract.

- [x] **Step 6: Commit**

```bash
git add cli/src/core/dashboard/types.ts cli/src/core/dashboard/validate.ts \
  cli/tests/helpers/dashboard-fixtures.ts \
  cli/tests/core/dashboard/contracts.test.ts cli/tests/commands/doctor.test.ts \
  cli/tests/fixtures/doctor-json
git commit -m "test(doctor): freeze JSON and define dashboard contract"
```

## Task 2: Build read-only collectors, sanitization, and plan classification

_Requirements: R2.2, R2.3, R2.4, R2.5, R2.7, R2.8, R2.9, R2.10, R3.3, R3.4, R4.6, R4.7, R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8, R5.9, R7.6, R7.7, R7.8, R7.9, R7.10, R8.3, R8.4_

**Files:**
- Create: `cli/src/core/dashboard/sanitize.ts`
- Create: `cli/src/core/dashboard/collect.ts`
- Create: `cli/src/core/dashboard/plan-state.ts`
- Create: `cli/tests/core/dashboard/collect.test.ts`
- Create: `cli/tests/core/dashboard/plan-state.test.ts`
- Modify: `cli/tests/commands/doctor-is-read-only.test.ts`

- [x] **Step 1: Write failing sanitizer and machine-only tests**

```ts
it('omits project, plan, journal, ledger, and evidence reads outside a project', () => {
  const snapshot = collectDashboardSnapshot({ cwd: bareHome, now: fixedNow });
  expect(snapshot.project.detected).toBe(false);
  expect(snapshot.sections.map((section) => section.id)).toEqual(['machine']);
  expect(snapshot.overall).toBe('healthy'); // verifies R2.4, R2.5
});

it('removes hostile and secret-bearing dynamic values before rendering', () => {
  const safe = sanitizeDashboardSource({
    path: '/home/alice/project', token: 'ghp_secret', output: '<script>alert(1)</script>',
  });
  expect(JSON.stringify(safe)).not.toMatch(/alice|ghp_|script|\/home\//i); // verifies R3.3, R3.4
});
```

- [x] **Step 2: Run and observe failure**

Run: `cd cli && npm test -- --runTestsByPath tests/core/dashboard/collect.test.ts tests/core/dashboard/plan-state.test.ts`

Expected: FAIL with missing `collect`, `sanitize`, and `plan-state` modules.

- [x] **Step 3: Implement explicit source adapters and canonical findings**

```ts
export interface DashboardSourceAdapters {
  machine(input: { cwd: string }): MachineDashboardSource;
  project(input: { root: string }): ProjectDashboardSource;
  plans(input: { root: string }): PlanDashboardSource[];
  execution(input: { root: string }): ExecutionDashboardSource | undefined;
}

export const REMEDIATION_BY_FINDING_ID: Readonly<Record<string, string>> = {
  'machine.preferences.missing': 'awm init',
  'machine.registries.stale': 'awm update',
  'project.profile.missing': 'awm init',
  'project.sensors.unavailable': 'awm sensors status',
  'project.preflight.degraded': 'awm preflight',
};
```

`collectDashboardSnapshot` must use injected adapters, isolate optional-source errors to their owning section, omit findings without a verified command, and validate the sanitized result before returning it. It must never call preference writers, ledger writers, journal writers, Git mutators, or configuration mutators.

- [x] **Step 4: Implement and test deterministic plan-state precedence**

```ts
export type PlanState =
  | 'active' | 'blocked' | 'qa_pending' | 'retro_pending'
  | 'executed' | 'legacy_unverifiable';

export function classifyPlanState(input: PlanStateInput): PlanState {
  validatePlanStateInput(input);
  if (input.journal?.state === 'blocked') return 'blocked';
  if (input.journal?.state === 'active') return 'active';
  if (input.markers.retroComplete) return 'executed';
  if (input.markers.qaComplete) return 'retro_pending';
  if (input.tasks.total > 0 && input.tasks.completed === input.tasks.total) return 'qa_pending';
  return 'legacy_unverifiable';
}
```

Tests must name each precedence rule and assert journal authority, QA pending, retro pending, executed, and legacy fallback (R7.6–R7.10).

- [x] **Step 5: Add lifecycle and stress fixtures**

Add table-driven fixtures for healthy project, degraded project, missing optional source, corrupt optional source, hostile text, 500 history rows, and 2,000 plan tasks. Assert the section order `machine → project → planning → execution → qa → retro → history`, stable IDs, exact non-ok commands, no score/ranking fields, and no hidden observations (R2.2–R2.10, R5.1–R5.9, R8.3).

- [x] **Step 6: Prove collection is byte-for-byte read-only**

Snapshot the project tree, preferences, journal, ledger, and Git status before and after collection. Assert equality. For HTML mode in Task 3, the same helper will allow only the requested target and adjacent temporary name during the write (R4.6, R4.7, R8.4).

- [x] **Step 7: Run tests and commit**

Run: `cd cli && npm test -- --runTestsByPath tests/core/dashboard/collect.test.ts tests/core/dashboard/plan-state.test.ts tests/commands/doctor-is-read-only.test.ts`

Expected: PASS.

```bash
git add cli/src/core/dashboard/sanitize.ts cli/src/core/dashboard/collect.ts \
  cli/src/core/dashboard/plan-state.ts cli/tests/core/dashboard \
  cli/tests/commands/doctor-is-read-only.test.ts
git commit -m "feat(doctor): collect a safe read-only dashboard snapshot"
```

## Task 3: Add strict CLI modes and atomic HTML writing

_Requirements: R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R4.1, R4.2, R4.3, R4.4, R4.5, R4.8, R4.9, R4.10, R4.11, R4.12_

**Files:**
- Create: `cli/src/core/dashboard/write-html.ts`
- Create: `cli/tests/core/dashboard/write-html.test.ts`
- Modify: `cli/src/commands/doctor.ts`
- Modify: `cli/tests/commands/doctor.test.ts`

- [x] **Step 1: Write failing option-matrix tests**

```ts
it.each([
  [{ json: true, full: true }, '--json cannot be combined with --full'],
  [{ json: true, html: 'report.html' }, '--json cannot be combined with --html'],
  [{ full: true, html: 'report.html' }, '--full cannot be combined with --html'],
  [{ force: true }, '--force requires --html'],
] as const)('rejects invalid doctor modes before collection', (options, message) => {
  expect(runDoctor({ ...options, collectSnapshot: failIfCalled })).toBe(2);
  expect(stderr()).toContain(message); // verifies R1.5, R1.6, R1.7
});
```

- [x] **Step 2: Run and observe failure**

Run: `cd cli && npm test -- --runTestsByPath tests/commands/doctor.test.ts tests/core/dashboard/write-html.test.ts`

Expected: FAIL because `full`, `html`, `force`, and the writer are absent.

- [x] **Step 3: Add validated options without touching the JSON branch**

```ts
export interface RunDoctorOptions {
  json?: boolean;
  full?: boolean;
  html?: string;
  force?: boolean;
  cwd?: string;
  agent?: string;
}
```

`runDoctor` must validate combinations first, return through the existing provider JSON path when `json === true`, build one validated snapshot for `full` or `html`, print the final HTML path only after success, and preserve the existing default text path (R1.1–R1.7).

- [x] **Step 4: Implement fail-loud target validation**

```ts
export interface HtmlWriteInput {
  cwd: string;
  target: string;
  html: string;
  force: boolean;
  platform: NodeJS.Platform;
}

export function resolveHtmlTarget(input: Pick<HtmlWriteInput, 'cwd' | 'target'>): string;
export function writeHtmlAtomically(input: HtmlWriteInput): void;
```

Reject absent/empty/flag-token targets, directories, symlinks, non-regular files, existing targets without force, missing/unwritable parents, and unsupported values. Resolve relative targets against `cwd`; preserve absolute targets. On POSIX open the adjacent temp file with `0o600`, write, fsync, close, and rename. On Windows create a regular file using the parent ACL and do not emulate POSIX modes. Any failure removes only its known adjacent temp file and preserves the previous target.

- [x] **Step 5: Add filesystem matrix tests**

Name and assert each R4.1–R4.12 case, including injected failures after open, after write, after fsync, and before rename. Assert exit 0/1/2 mapping for healthy, degraded, and invalid/failing snapshots (R4.8).

- [x] **Step 6: Demonstrate writer regression boundary, run, and commit**

Temporarily replace atomic rename with a direct target write, observe the preservation test fail, restore atomic rename, and observe PASS. Do not commit the temporary mutation (R8.5).

Run: `cd cli && npm test -- --runTestsByPath tests/commands/doctor.test.ts tests/core/dashboard/write-html.test.ts`

Expected: PASS.

```bash
git add cli/src/commands/doctor.ts cli/src/core/dashboard/write-html.ts \
  cli/tests/commands/doctor.test.ts cli/tests/core/dashboard/write-html.test.ts
git commit -m "feat(doctor): add full and atomic HTML modes"
```

## Task 4: Implement the approved terminal and HTML dashboard surfaces

_Requirements: R3.1, R3.2, R3.3, R3.5, R3.6, R3.7, R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8, R5.9, R8.1, R8.3_

**Files:**
- Create: `cli/src/core/dashboard/render-terminal.ts`
- Create: `cli/src/core/dashboard/render-html.ts`
- Create: `cli/src/core/dashboard/styles.ts`
- Create: `cli/tests/core/dashboard/render-terminal.test.ts`
- Create: `cli/tests/core/dashboard/render-html.test.ts`

**Skills:** frontend-craft
**Design artifacts:** .stitch/designs/machine-only-configuration-dashboard.html, .stitch/designs/machine-only-configuration-dashboard.png, .stitch/designs/project-lifecycle-impact-evidence.html, .stitch/designs/project-lifecycle-impact-evidence.png

- [x] **Step 1: Write failing renderer contract tests**

```ts
it('renders both formats from the same validated snapshot instance', () => {
  const snapshot = validateDashboardSnapshotV1(dashboardSnapshot({
    project: { detected: true, label: 'agentic-workflow' },
  }));
  expect(renderFullTerminal(snapshot)).toContain('Machine / install');
  expect(renderDashboardHtml(snapshot)).toContain('Project lifecycle');
});

it('emits a self-contained scriptless document with restrictive CSP', () => {
  const html = renderDashboardHtml(validateDashboardSnapshotV1(dashboardSnapshot({
    sections: [{
      id: 'machine', availability: 'available',
      items: [{ id: 'machine.hostile', label: '<img src=x>', state: 'ok' }],
    }],
  })));
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("script-src 'none'");
  expect(html).not.toMatch(/<script|https?:\/\//i); // verifies R3.1, R3.2, R3.3
});
```

- [x] **Step 2: Run and observe failure**

Run: `cd cli && npm test -- --runTestsByPath tests/core/dashboard/render-terminal.test.ts tests/core/dashboard/render-html.test.ts`

Expected: FAIL because both renderer modules are absent.

- [x] **Step 3: Implement terminal rendering in canonical section order**

`renderFullTerminal(snapshot: DashboardSnapshotV1): string` validates its public input, renders every observation, uses text plus glyphs for state, emits exact remediation commands, and never reads files or invokes commands. Snapshot tests cover machine-only, healthy project, degraded project, partial source, long history, and large task count.

- [x] **Step 4: Implement semantic static HTML from the approved designs**

Use `<header>`, `<nav aria-label="Dashboard sections">`, `<main>`, ordered `<section>` elements, semantic tables/lists, `<code>` for commands, and a `<footer>`. Inline `styles.ts` must provide the approved graphite/ivory/indigo/cyan/amber tokens, visible `:focus-visible`, 1600px desktop composition, narrow stacking without horizontal data loss, and `@media print`. Every dynamic value passes through `escapeHtml` after sanitization.

- [x] **Step 5: Add deterministic and accessibility assertions**

Render the same snapshot twice and assert byte equality after pinning `generatedAt`. Assert heading order, landmark names, table headers, state text adjacent to icons, print rules, focus rules, absence of score/ranking labels, and visibility of every long-history row (R3.5–R3.7, R5.1–R5.9).

- [x] **Step 6: Run tests and commit**

Run: `cd cli && npm test -- --runTestsByPath tests/core/dashboard/render-terminal.test.ts tests/core/dashboard/render-html.test.ts`

Expected: PASS.

```bash
git add cli/src/core/dashboard/render-terminal.ts cli/src/core/dashboard/render-html.ts \
  cli/src/core/dashboard/styles.ts cli/tests/core/dashboard/render-terminal.test.ts \
  cli/tests/core/dashboard/render-html.test.ts
git commit -m "feat(doctor): render approved terminal and HTML dashboards"
```

- [x] **Step 7: Close and publish Release A before starting Task 5**

Release A closed through QA, retro, PR #108, and immutable package publication. The published CLI is `v8.4.0` with npm integrity `sha512-n0cCnDBkJqiHre670+uUw6D1E+y4aKGZrQUq0dpM0leuWmAVMeL/hXchJUh3PYDn2m2QbSZg3zk9qIwQXHlOXQ==`; this branch starts from tag `v8.4.0`. This is the enforced #86-before-#87 boundary (R8.1).

## Task 5: Persist validated `CycleEvidenceV1` observations

_Requirements: R6.1, R6.3, R6.4, R6.5, R6.6, R6.7, R6.11, R7.1, R7.2, R7.3, R7.4, R7.5_

**Files:**
- Create: `cli/src/core/evidence/types.ts`
- Create: `cli/src/core/evidence/store.ts`
- Create: `cli/src/core/evidence/capture.ts`
- Create: `cli/src/commands/evidence/index.ts`
- Create: `cli/tests/core/evidence/types.test.ts`
- Create: `cli/tests/core/evidence/store.test.ts`
- Create: `cli/tests/core/evidence/capture.test.ts`
- Create: `cli/tests/helpers/evidence-fixtures.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Write failing contract and privacy tests**

```ts
it('derives an opaque stable cycle ID from repo identity, relative plan, and start time', () => {
  const identity = {
    repositoryIdentity: 'file:///opaque/repository-key',
    planPath: 'docs/plans/cycle-plan.md',
    startedAt: '2026-08-22T00:00:00.000Z',
  };
  expect(deriveCycleEvidenceId(identity)).toMatch(/^[a-f0-9]{64}$/); // verifies R7.2
  expect(deriveCycleEvidenceId(identity)).toBe(deriveCycleEvidenceId(identity));
});

it('rejects host or person identity and raw prose', () => {
  expect(() => validateCycleEvidenceV1({ ...validCycleEvidence(), username: 'alice' }))
    .toThrow(/unknown field|unsafe/i); // verifies R7.5, R6.11
});
```

- [ ] **Step 2: Run and observe failure**

Run: `cd cli && npm test -- --runTestsByPath tests/core/evidence/types.test.ts tests/core/evidence/store.test.ts tests/core/evidence/capture.test.ts`

Expected: FAIL because evidence modules do not exist.

- [ ] **Step 3: Define the minimal durable record**

```ts
export interface CycleEvidenceV1 {
  schema: 1;
  cycleId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  cycleState: 'completed' | 'blocked';
  plan: { ref: string; state: PlanState };
  tasks: Array<{ id: string; attempts: number; retries: number }>;
  qa: { findings: number; fixes: number; signatures: string[] };
  gates: { required: number; firstEvaluationsPassed: boolean[]; firstPass: boolean };
  cures: Array<{ signature: string; curedAt: string }>;
  pr?: { provider: 'github' | 'gitlab' | 'other'; number: number };
}

export function validCycleEvidence(
  overrides: Partial<CycleEvidenceV1> = {},
): CycleEvidenceV1 {
  return {
    schema: 1,
    cycleId: 'a'.repeat(64),
    startedAt: '2026-08-22T00:00:00.000Z',
    endedAt: '2026-08-22T00:05:00.000Z',
    durationMs: 300_000,
    cycleState: 'completed',
    plan: { ref: 'plan-9f3a', state: 'executed' },
    tasks: [{ id: 'task-1', attempts: 1, retries: 0 }],
    qa: { findings: 0, fixes: 0, signatures: [] },
    gates: { required: 1, firstEvaluationsPassed: [true], firstPass: true },
    cures: [],
    ...overrides,
  };
}
```

Validation must reject negative counts, non-finite durations, invalid timestamps, retries not equal to `max(attempts - 1, 0)`, raw descriptions, absolute plan paths, usernames, repository names, prompts, logs, and secret-like fields.

- [ ] **Step 4: Implement deterministic atomic storage**

`writeCycleEvidence(root, evidence)` writes `.awm/evidence/cycles/{cycleId}.json` through an adjacent temp file, fsync/close/rename, and deterministically replaces the same cycle file. Repeated capture must not append or create a second observation (R7.3, R7.4).

- [ ] **Step 5: Implement capture aggregation and the command boundary**

`captureCycleEvidence({ root, planPath, journal, gates, ledger, pr })` validates every public input and derives only counts, opaque signatures, states, timestamps, and optional host-agnostic PR reference. Register `awm evidence capture --plan docs/plans/2026-08-22-doctor-dashboard-impact-evidence-plan.md`; it must return 2 for invalid/missing central inputs and print the written cycle ID on success.

- [ ] **Step 6: Add exact metric tests**

Assert one cycle per observation, optional PR metadata, findings per cycle/PR, per-task retries and total, first gate evaluation, cure signatures, and allowed plan states (R6.1, R6.3–R6.7).

- [ ] **Step 7: Run tests and commit**

Run: `cd cli && npm test -- --runTestsByPath tests/core/evidence/types.test.ts tests/core/evidence/store.test.ts tests/core/evidence/capture.test.ts`

Expected: PASS.

```bash
git add cli/src/core/evidence cli/src/commands/evidence cli/src/index.ts \
  cli/tests/core/evidence cli/tests/helpers/evidence-fixtures.ts
git commit -m "feat(evidence): capture durable local cycle observations"
```

## Task 6: Add evidence history, confidence, and impact rendering

_Requirements: R6.2, R6.8, R6.9, R6.10, R6.11, R7.6, R7.7, R7.8, R7.9, R7.10_

**Files:**
- Create: `cli/src/core/evidence/history.ts`
- Create: `cli/tests/core/evidence/history.test.ts`
- Modify: `cli/src/core/dashboard/collect.ts`
- Modify: `cli/src/core/dashboard/render-terminal.ts`
- Modify: `cli/src/core/dashboard/render-html.ts`
- Modify: `cli/tests/core/dashboard/render-terminal.test.ts`
- Modify: `cli/tests/core/dashboard/render-html.test.ts`

**Skills:** frontend-craft
**Design artifacts:** .stitch/designs/project-lifecycle-impact-evidence.html, .stitch/designs/project-lifecycle-impact-evidence.png

- [ ] **Step 1: Write failing threshold and recurrence tests**

```ts
it.each([[0, 'none'], [1, 'provisional'], [2, 'observing'], [4, 'observing'], [5, 'supported']] as const)(
  'classifies %i eligible cycles as %s',
  (count, expected) => expect(confidenceForCycles(count)).toBe(expected), // verifies R6.8, R6.9
);

it.each([
  [0, false, 'awaiting_observation'], [1, false, 'observing'], [2, false, 'observing'],
  [3, false, 'supported'], [1, true, 'recurred'],
] as const)('classifies cure observation honestly', (later, recurred, expected) => {
  expect(classifyCure({ laterEligibleCycles: later, recurred })).toBe(expected); // verifies R6.10
});
```

- [ ] **Step 2: Run and observe failure**

Run: `cd cli && npm test -- --runTestsByPath tests/core/evidence/history.test.ts`

Expected: FAIL because history calculations do not exist.

- [ ] **Step 3: Implement complete local history without filtering rows**

`buildEvidenceHistory(records)` validates all records, sorts by stable timestamp/cycle ID, returns every eligible sanitized row, computes aggregate confidence only as a label, and never hides rows below thresholds. Zero cycles returns an explicit empty state without trend, percentage, or improvement claims (R6.2, R6.8, R6.11).

- [ ] **Step 4: Overlay plan history and render the evidence panel**

Load evidence only inside the detected repository. Overlay active journal states before marker-derived states. Render plans, retries, QA counts, first-pass gates, cure efficacy, and confidence labels in terminal and HTML while preserving the existing section order and approved dense project screen.

- [ ] **Step 5: Run UI/history tests and commit**

Run: `cd cli && npm test -- --runTestsByPath tests/core/evidence/history.test.ts tests/core/dashboard/render-terminal.test.ts tests/core/dashboard/render-html.test.ts tests/core/dashboard/plan-state.test.ts`

Expected: PASS.

```bash
git add cli/src/core/evidence/history.ts cli/src/core/dashboard \
  cli/tests/core/evidence/history.test.ts cli/tests/core/dashboard
git commit -m "feat(doctor): render honest project impact evidence"
```

## Task 7: Gate the registry capture step on a published compatible CLI

_Requirements: R7.1, R8.1, R8.6_

**Files:**
- Modify: `/srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry/skills/harness-retro/SKILL.md`
- Modify: `/srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry/awm-registry.json`
- Create: `/srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry/tests/cycle-evidence-capture-contract.test.mjs`

- [ ] **Step 1: Publish and verify Release A before beginning this registry task**

Run from the CLI repository: `npm view agentic-workflow-manager version`

Expected: the published immutable version is at least the Release A version recorded in `awm-registry.json`. If it is not published, stop this task; do not add the registry invocation.

- [ ] **Step 2: Write a failing registry contract test**

```js
test('retro captures cycle evidence before archive and only with a compatible CLI', () => {
  const retro = readSkill('harness-retro');
  assert.match(retro, /awm evidence capture/); // verifies R7.1
  assert.match(retro, /minimum published CLI/i); // verifies R8.6
  assert.ok(retro.indexOf('awm evidence capture') < retro.indexOf('awm ledger archive'));
});
```

- [ ] **Step 3: Run and observe failure**

Run: `cd /srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry && node --test tests/cycle-evidence-capture-contract.test.mjs`

Expected: FAIL because `harness-retro` has no capture step or compatibility guard.

- [ ] **Step 4: Add the guarded capture step before ledger archive**

The skill must read the minimum CLI version declared in `awm-registry.json`, verify `awm --version` satisfies it, resolve the tracked active plan into an `active_plan` shell variable, run `awm evidence capture --plan "$active_plan"`, require exit 0, then archive the ledger. An older CLI must fail loudly with the exact upgrade command and must not archive the ledger. This enforces Release A before Release B and prevents a registry from calling an unavailable contract.

- [ ] **Step 5: Run registry tests and commit in the registry repository**

Run: `cd /srv/agentmobile/workspaces/repos/agentic-project/awm-baseline-registry && npm test`

Expected: PASS.

```bash
git add skills/harness-retro/SKILL.md awm-registry.json tests/cycle-evidence-capture-contract.test.mjs
git commit -m "feat(retro): capture compatible cycle evidence"
```

## Task 8: Verify end-to-end behavior using published immutable artifacts

_Requirements: R4.8, R8.3, R8.4, R8.5, R8.7_

**Files:**
- Create: `cli/tests/integration/doctor-dashboard.e2e.test.ts`
- Create: `cli/tests/integration/published-doctor-evidence.e2e.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add failing local end-to-end fixtures**

Test machine-only, healthy project, degraded project, partial source, corrupt source, hostile text, long history, and large task counts through the built `dist/src/index.js`. Assert exit 0/1/2, JSON compatibility, complete `--full`, CSP/static HTML, target-only mutation, and evidence rows (R4.8, R8.3, R8.4).

- [ ] **Step 2: Run and observe failure before wiring build artifacts**

Run: `cd cli && npm run build && npm test -- --runTestsByPath tests/integration/doctor-dashboard.e2e.test.ts`

Expected: FAIL until the integration fixture invokes the newly built command and normalizes only environmental timestamps.

- [ ] **Step 3: Add published-artifact acceptance**

The published test must install the exact CLI package version and exact registry tag into a fresh temporary environment, run `awm doctor`, `awm doctor --json`, `awm doctor --full`, `awm doctor --html`, one evidence capture, and one retro capture contract. It must reject local workspace paths, `file:` dependencies, mutable branches, and unpinned registry refs.

- [ ] **Step 4: Add Linux/macOS/Windows matrix jobs**

In `.github/workflows/release.yml`, add `os: [ubuntu-latest, macos-latest, windows-latest]` after publish verification. Each matrix cell installs immutable artifacts and runs only `published-doctor-evidence.e2e.test.ts`. The release job must fail if any platform does not complete the same contract (R8.7).

- [ ] **Step 5: Demonstrate the end-to-end regression boundary**

Temporarily remove the HTML CSP meta tag, observe the E2E test fail, restore it, and observe PASS. Repeat by allowing an extra project mutation and confirming the read-only assertion fails. Do not commit either temporary mutation (R8.5).

- [ ] **Step 6: Run all CLI gates and commit**

Run:

```bash
cd cli
npm run typecheck
npm run lint
npm run depcheck
npm run build
npm test
```

Expected: all commands exit 0; Jest reports no failing suites.

```bash
git add cli/tests/integration/doctor-dashboard.e2e.test.ts \
  cli/tests/integration/published-doctor-evidence.e2e.test.ts \
  .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "test(doctor): verify published dashboard and evidence flow"
```

## Traceability matrix

| Requirement IDs | Task(s) | Specific verification |
|---|---|---|
| R1.1 | T1, T3 | `keeps_*_provider_JSON_contract_byte_for_byte_stable`; legacy default/JSON branch tests |
| R1.2, R1.3, R1.4 | T3 | `routes_full_to_terminal`; `writes_html_and_prints_final_path`; `force_replaces_regular_file` |
| R1.5, R1.6, R1.7 | T3 | `rejects_invalid_doctor_modes_before_collection` table cases |
| R2.1, R2.6 | T1 | snapshot validator tests for schema/order/enums/remediation invariants |
| R2.2, R2.3 | T2 | machine and healthy-project collector fixtures |
| R2.4, R2.5 | T2 | `omits_project_sources_outside_project`; machine health exit assertion |
| R2.7, R2.8, R2.9 | T2 | canonical-remediation, unverified-command omission, optional-source isolation tests |
| R2.10 | T2, T3 | central validation/sanitization failure returns 2 and writes no target |
| R3.1, R3.2 | T4 | self-contained resource scan and exact restrictive CSP assertions |
| R3.3, R3.4 | T2, T4 | hostile-text escaping and sensitive-field exclusion tests |
| R3.5, R3.6 | T4 | semantic landmarks/a11y/print/focus and desktop/narrow layout assertions |
| R3.7 | T1, T4 | stable section validation and byte-equal repeated render test |
| R4.1, R4.2, R4.3 | T3 | invalid-path, special-file/symlink, and preserve-existing tests |
| R4.4, R4.5 | T3 | injected atomic-write stage failures and previous-target preservation |
| R4.6, R4.7 | T2, T8 | byte-for-byte tree snapshot and explicit target-only mutation test |
| R4.8 | T3, T8 | healthy/degraded/invalid 0/1/2 E2E matrix |
| R4.9, R4.10 | T3 | relative/absolute resolution and missing/unwritable parent tests |
| R4.11, R4.12 | T3 | POSIX `0600` replacement and Windows ACL/no-chmod tests |
| R5.1, R5.2, R5.3 | T2, T4 | canonical lifecycle order and machine/project content assertions |
| R5.4, R5.5, R5.6, R5.7, R5.8 | T2, T4, T6 | planning/execution/QA/retro/history fixture assertions |
| R5.9 | T2, T4 | forbidden score/person/repository aggregate field and label scan |
| R6.1, R6.3, R6.4, R6.5, R6.6, R6.7 | T5 | cycle/PR, retry, first-pass, cure, and plan-state metric tests |
| R6.2 | T6 | `returns_every_eligible_sanitized_observation` |
| R6.8, R6.9 | T6 | zero/one/two/four/five cycle confidence table |
| R6.10 | T6 | cure later-cycle/recurred classification table |
| R6.11 | T5, T6 | privacy validator and repository-local loader boundary tests |
| R7.1 | T5, T7 | capture command test and retro-before-archive registry contract |
| R7.2, R7.3, R7.4 | T5 | opaque ID, idempotent replacement, and atomic store tests |
| R7.5 | T5 | stored-record allowlist and unsafe-field rejection tests |
| R7.6, R7.7, R7.8, R7.9, R7.10 | T2, T6 | named plan-state precedence tests and history overlay assertions |
| R8.1 | T4, T7 | explicit Release A publication checkpoint and published-version gate before registry capture |
| R8.2 | T1 | two frozen JSON fixtures |
| R8.3 | T2, T4, T8 | eight required fixture classes through unit and E2E paths |
| R8.4 | T2, T8 | byte-for-byte read-only tree assertion |
| R8.5 | T1, T3, T8 | documented fail/pass/revert-fail/restore-pass demonstrations |
| R8.6 | T7 | minimum published CLI contract test and guarded retro invocation |
| R8.7 | T8 | immutable-artifact Linux/macOS/Windows release matrix |

## Analyze gate

- Every requirement from R1.1 through R8.7 appears in at least one task and one named verification above.
- Every task and test is anchored to requirement IDs; there is no orphan implementation scope.
- UI tasks T4 and T6 declare `frontend-craft` and exact approved Stitch HTML/PNG paths.
- Public functions in the plan validate inputs and throw explicit errors; no invalid input silently returns `undefined`, `NaN`, or a partial record.
- Release B and registry capture remain serially gated on the compatible published Release A CLI.

## Final verification before execution handoff

Run from the agentic-workflow repository root:

```bash
awm preflight
awm context-budget
```

`awm preflight` must report `ready` before execution is offered. `awm context-budget` is advisory; if it reports an overage, choose pruning, a reviewed `maxBytes` increase, or proceed with the decision recorded in this plan.
