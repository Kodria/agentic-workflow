# Change Record per PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `awm.change-record/v1`: a sensor-run receipt, `awm change new|validate`, `awm changes list` (text/json/voice) and the release opt-out trailer, as specified in `docs/plans/2026-10-17-change-record-design.md` (issue #217).

**Architecture:** Pure units under `cli/src/core/changes/` (types, parse, shape validation, git wrappers, derivation, trailers, receipt, list, render) consumed by two thin commands (`cli/src/commands/change/`, `cli/src/commands/changes/`) that return `CommandResult` and are registered in `cli/src/index.ts`. The receipt is written as a side effect of the existing `awm sensors run` action. `runSensors()` itself is untouched.

**Tech Stack:** TypeScript, commander, js-yaml 4 (already a dependency), jest (`npm test` = `jest --runInBand`), git via `execFileSync`, with no shell.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

**Modo de despacho:** proveedor-nativo

Dispatch note: the owner did not choose AWM routing, so this plan uses native-provider dispatch (`compact-slices/v1`).

**Scope note:** This plan owns R1–R6 of the design. **R7 (skills `writing-plans` and `finishing-a-development-branch`) is out of this plan.** It lives in the `awm-baseline-registry` repo and must declare the minimum CLI version that ships these commands (R7.4). That version exists only after this plan merges and `release.yml` publishes. R7 therefore gets its own plan in the registry repo once that version is published.

**Clarification of R3.3, applied by S3:** IF the range has non-merge commits but none parses as a conventional commit, THEN derivation fails with diagnostic `no-conventional-commits` instead of inventing a type. This follows the robustness invariant: fail loudly, never fabricate.

**Clarification of R3.3/R3.4, applied by S3:** derivation ignores commits and files that touch only `docs/changes/`, so that committing the record itself never changes the derived fields between `change new` and `change validate`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"change-record-217","requirements":["R1.1","R1.2","R1.3","R1.4","R1.5","R1.6","R1.7","R1.8","R2.1","R2.2","R2.3","R2.4","R2.5","R3.1","R3.2","R3.3","R3.4","R3.5","R3.6","R3.7","R3.8","R3.9","R3.10","R3.11","R3.12","R4.1","R4.2","R4.3","R4.4","R4.5","R4.6","R5.1","R5.2","R5.3","R5.4","R5.5","R5.6","R5.7","R6.1"],"sources":[{"id":"SRC-DESIGN","path":"docs/plans/2026-10-17-change-record-design.md","locator":"## Requirements","fact":"EARS requirements R1-R7 and decisions DD-1..DD-11 for the Change Record."},{"id":"SRC-RELEASE-CORE","path":"cli/src/release/core.ts","locator":"export function parseCommits","fact":"Exports GIT_LOG_FORMAT ('%s\\x1f%b\\x1e'), parseCommits(raw): Commit[] {type,scope,breaking,subject} and determineBump(commits): 'major'|'minor'|'patch'|null."},{"id":"SRC-CMD-RESULT","path":"cli/src/core/command-result.ts","locator":"export function emit","fact":"CommandResult {code: 0|2; stdout; stderr}; emit(result) writes streams and sets process.exitCode."},{"id":"SRC-ATOMIC","path":"cli/src/core/atomic-file.ts","locator":"writeFileAtomic","fact":"writeFileAtomic(file, content, mode=0o644) writes atomically and refuses a symlink target."},{"id":"SRC-TEXT","path":"cli/src/core/text.ts","locator":"sanitizeDiagnosticText","fact":"sanitizeDiagnosticText(text) collapses line breaks and strips C0/C1 controls for single-line terminal output."},{"id":"SRC-CLI-VERSION","path":"cli/src/core/cli-version.ts","locator":"cliVersion","fact":"cliVersion(): string returns the running CLI version."},{"id":"SRC-JOURNAL","path":"cli/src/core/journal/store.ts","locator":"readJournal","fact":"readJournal(repoRoot, branch) returns {state: JournalState|null, corrupt, absent}; state.admissionContext?.provider is 'codex'|'claude-code'; state.cycle has startedAt and optional completedAt."},{"id":"SRC-BRANCH","path":"cli/src/core/ledger/store.ts","locator":"detectBranch","fact":"detectBranch(cwd) returns the current branch name or '_no-branch'."},{"id":"SRC-SENSORS-CMD","path":"cli/src/commands/sensors/index.ts","locator":".command('run')","fact":"The run action calls runSensors({fast, slow, all, changed, base}), writes JSON to stdout and sets process.exitCode via exitCodeForVerdict(output.overall)."},{"id":"SRC-SENSOR-TYPES","path":"cli/src/commands/sensors/types.ts","locator":"export type RunOutput","fact":"RunOutput {sensors: SensorResult[]; overall: 'pass'|'fail'|'skipped'|'not_certified'; ...}; SensorResult {name; status: 'pass'|'fail'|'inconclusive'|'skipped'; ...}."},{"id":"SRC-INDEX","path":"cli/src/index.ts","locator":"registerEvidenceCommand(program);","fact":"Commands are registered by register<X>Command(program) calls in one block; the import block near the top imports each register function."},{"id":"SRC-ORCH","path":"cli/src/release/orchestrator.ts","locator":"io.run('git', ['commit', '-m', `chore(release): v${version} [skip ci]`])","fact":"The release bump commit is created with a single -m message."},{"id":"SRC-ORCH-TEST","path":"cli/tests/release/orchestrator.test.ts","locator":"expect(joined).toMatch(/git commit .*chore\\(release\\): v2.2.0/)","fact":"Orchestrator tests assert git invocations through a joined command log."},{"id":"SRC-TEST-ISOLATION","path":"cli/tests/commands/hooks/install.test.ts","locator":"process.env.AWM_HOME = path.join(tmpHome, '.awm');","fact":"Tests save, override and restore process.env.HOME and AWM_HOME with tmpdirs; no test touches the real ~/.awm."}],"commands":[{"id":"CMD-T-RECORD","program":"npm","args":["--prefix","cli","test","--","tests/core/changes/record.test.ts"],"covers":["R1.1","R1.2","R1.3","R1.4","R1.5","R1.6","R1.7","R1.8"]},{"id":"CMD-T-RECEIPT","program":"npm","args":["--prefix","cli","test","--","tests/core/changes/receipt.test.ts"],"covers":["R2.1","R2.2","R2.3","R2.4","R2.5"]},{"id":"CMD-T-DERIVE","program":"npm","args":["--prefix","cli","test","--","tests/core/changes/derive.test.ts"],"covers":["R3.1","R3.2","R3.3","R3.4","R3.5"]},{"id":"CMD-T-NEW","program":"npm","args":["--prefix","cli","test","--","tests/commands/change/new.test.ts"],"covers":["R3.6","R3.7","R3.8","R3.9","R3.10","R3.11","R3.12"]},{"id":"CMD-T-VALIDATE","program":"npm","args":["--prefix","cli","test","--","tests/commands/change/validate.test.ts"],"covers":["R4.1","R4.2","R4.3","R4.4","R4.5","R4.6"]},{"id":"CMD-T-LIST","program":"npm","args":["--prefix","cli","test","--","tests/commands/changes/list.test.ts"],"covers":["R5.1","R5.2","R5.3","R5.4","R5.5","R5.6","R5.7"]},{"id":"CMD-T-RELEASE","program":"npm","args":["--prefix","cli","test","--","tests/release/orchestrator.test.ts"],"covers":["R6.1"]},{"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["R1.1","R2.1","R3.1","R4.1","R5.1","R6.1"]},{"id":"CMD-LINT","program":"npm","args":["--prefix","cli","run","lint"],"covers":["R1.1","R2.1","R3.1","R4.1","R5.1","R6.1"]},{"id":"CMD-TEST-ALL","program":"npm","args":["--prefix","cli","test"],"covers":["R1.1","R2.1","R3.1","R4.1","R5.1","R6.1"]}],"slices":[{"id":"S1","title":"Record types, parsing and shape validation","requirements":["R1.1","R1.2","R1.3","R1.4","R1.5","R1.6","R1.7","R1.8"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-DESIGN"],"redCommands":["CMD-T-RECORD"],"greenCommands":["CMD-T-RECORD","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract","security-robustness"]},{"id":"S2","title":"Sensor-run receipt","requirements":["R2.1","R2.2","R2.3","R2.4","R2.5"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-DESIGN","SRC-ATOMIC","SRC-CLI-VERSION","SRC-SENSORS-CMD","SRC-SENSOR-TYPES","SRC-TEST-ISOLATION"],"redCommands":["CMD-T-RECEIPT"],"greenCommands":["CMD-T-RECEIPT","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract","security-robustness"]},{"id":"S3","title":"Git wrappers, derivation and opt-out trailers","requirements":["R3.1","R3.2","R3.3","R3.4","R3.5"],"dependsOn":["S1"],"sectionAnchor":"slice-s3","sources":["SRC-DESIGN","SRC-RELEASE-CORE","SRC-TEST-ISOLATION"],"redCommands":["CMD-T-DERIVE"],"greenCommands":["CMD-T-DERIVE","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["security-robustness"]},{"id":"S4","title":"awm change new","requirements":["R3.6","R3.7","R3.8","R3.9","R3.10","R3.11","R3.12"],"dependsOn":["S1","S2","S3"],"sectionAnchor":"slice-s4","sources":["SRC-DESIGN","SRC-CMD-RESULT","SRC-ATOMIC","SRC-JOURNAL","SRC-BRANCH","SRC-INDEX","SRC-TEST-ISOLATION"],"redCommands":["CMD-T-NEW"],"greenCommands":["CMD-T-NEW","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract","security-robustness"]},{"id":"S5","title":"awm change validate","requirements":["R4.1","R4.2","R4.3","R4.4","R4.5","R4.6"],"dependsOn":["S4"],"sectionAnchor":"slice-s5","sources":["SRC-DESIGN","SRC-CMD-RESULT","SRC-TEXT","SRC-TEST-ISOLATION"],"redCommands":["CMD-T-VALIDATE"],"greenCommands":["CMD-T-VALIDATE","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract","security-robustness"]},{"id":"S6","title":"awm changes list","requirements":["R5.1","R5.2","R5.3","R5.4","R5.5","R5.6","R5.7"],"dependsOn":["S5"],"sectionAnchor":"slice-s6","sources":["SRC-DESIGN","SRC-CMD-RESULT","SRC-TEXT","SRC-INDEX","SRC-TEST-ISOLATION"],"redCommands":["CMD-T-LIST"],"greenCommands":["CMD-T-LIST","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract","security-robustness"]},{"id":"S7","title":"Release commit opt-out trailer","requirements":["R6.1"],"dependsOn":["S6"],"sectionAnchor":"slice-s7","sources":["SRC-DESIGN","SRC-ORCH","SRC-ORCH-TEST"],"redCommands":["CMD-T-RELEASE"],"greenCommands":["CMD-T-RELEASE","CMD-TYPECHECK","CMD-LINT","CMD-TEST-ALL"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["root-configuration"]}],"closureCommands":["CMD-TYPECHECK","CMD-LINT","CMD-TEST-ALL"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Shared facts (apply to every slice)

- **Working directory and paths.** All paths are relative to the repo root `agentic-workflow/`. CLI code lives in `cli/`. Tests run with `npm --prefix cli test -- <path relative to cli/>`.
- **Git invocation.** Git is always invoked through `execFileSync('git', args, …)`, never with a shell. A `--` goes before any user-supplied pathspec.
- **Test isolation.** Every test file that creates repos uses the helper from S3 (`cli/tests/core/changes/helpers.ts`). The helper creates a tmp git repo with `HOME` and `AWM_HOME` overridden to tmpdirs and restored in `afterEach`, following SRC-TEST-ISOLATION. No test touches the real `~/.awm`.
- **Commit messages.** Use conventional commits. End every commit with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01E3bMVia26CjuPhe57xPoQx
  ```

<a id="slice-s1"></a>
### Slice S1: Record types, parsing and shape validation

#### Surfaces
**Owns R1.1–R1.8.** These are grouped because they form one pure, I/O-free contract: the record format and its validator. Every later slice consumes it.

**Files:**
- Create `cli/src/core/changes/types.ts`
- Create `cli/src/core/changes/parse.ts`
- Create `cli/src/core/changes/validate-shape.ts`
- Create `cli/tests/core/changes/record.test.ts`

**Interfaces:**
- `splitRecord(raw)`
- `loadFrontmatter(text)`
- `validateRecordShape(fileName, raw, opts?)` returns `{ record?: ChangeRecord; diagnostics: Diagnostic[] }`
- `RECORD_FILE_RE`
- `isValidSlug(slug)`

#### Implementation
**Dependencies:** none. **Input:** a file basename and raw text. **Output:** a typed record or diagnostics.

- [ ] **Step 1: Write the failing test** `cli/tests/core/changes/record.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateRecordShape } from '../../../src/core/changes/validate-shape';
import { PENDING_MARKER, MAX_RECORD_BYTES } from '../../../src/core/changes/types';

const SHA = 'a'.repeat(40);
const DIGEST = 'sha256:' + 'b'.repeat(64);
const NAME = '2026-10-17-change-record.md';

function fm(overrides: Record<string, string> = {}): string {
    const fields: Record<string, string> = {
        schema: 'schema: awm.change-record/v1',
        id: 'id: 2026-10-17-change-record',
        title: 'title: "Change Record por PR"',
        summary_short: 'summary_short: "Agrega el Change Record."',
        type: 'type: feat',
        scope: 'scope: changes',
        semver: 'semver: minor',
        breaking: 'breaking: false',
        modules: 'modules:\n  - cli/src/core\n  - cli/tests/core',
        verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n    lint: pass\n    typecheck: pass\n  receipt_digest: ${DIGEST}`,
        manual_validation: 'manual_validation:\n  - step: "Run awm changes list"\n    expected: "Shows the record"',
        risks: 'risks: []',
        rollback: 'rollback: "Revert the PR"',
        ...overrides,
    };
    return Object.values(fields).filter((v) => v !== '').join('\n');
}
const BODY = '## Qué se hizo\nA\n\n## Qué se probó\nB\n\n## Qué falta validar\nC\n\n## Riesgos y rollback\nD\n';
const doc = (front: string, body = BODY) => `---\n${front}\n---\n${body}`;
const codes = (r: ReturnType<typeof validateRecordShape>) => r.diagnostics.map((d) => d.code);

describe('validateRecordShape', () => {
    test('accepts a complete valid record', () => {
        const r = validateRecordShape(NAME, doc(fm()));
        expect(r.diagnostics).toEqual([]);
        expect(r.record?.semver).toBe('minor');
    });
    test('R1.1 rejects bad file names and slugs', () => {
        expect(codes(validateRecordShape('2026-10-17-Bad_Slug.md', doc(fm())))).toContain('name-invalid');
        expect(codes(validateRecordShape('2026-13-40-x.md', doc(fm({ id: 'id: 2026-13-40-x' }))))).toContain('name-invalid');
        expect(codes(validateRecordShape(`2026-10-17-${'a'.repeat(65)}.md`, doc(fm())))).toContain('name-invalid');
    });
    test('R1.2 requires frontmatter and rejects aliases and custom tags', () => {
        expect(codes(validateRecordShape(NAME, BODY))).toContain('frontmatter-missing');
        expect(codes(validateRecordShape(NAME, doc(fm({ risks: 'risks: &r ["x"]', rollback: 'rollback: *r' }))))).toContain('yaml-alias');
        expect(codes(validateRecordShape(NAME, doc(fm({ rollback: 'rollback: !!js/function "f"' }))))).toContain('yaml-invalid');
    });
    test('R1.3 rejects unknown fields at every level', () => {
        const r = validateRecordShape(NAME, doc(fm({ extra: 'status: merged' })));
        expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-field', field: 'status' }));
        const nested = validateRecordShape(NAME, doc(fm({ links: 'links:\n  pr: "https://x"' })));
        expect(nested.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-field', field: 'links.pr' }));
    });
    test('R1.4 enforces field rules', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ id: 'id: other' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ summary_short: `summary_short: "${'x'.repeat(281)}"` }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ semver: 'semver: huge' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ modules: 'modules:\n  - b\n  - a' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ links: 'links:\n  issue: "http://insecure"' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ manual_validation: 'manual_validation: []' }))))).toContain('field-invalid');
        expect(validateRecordShape(NAME, doc(fm({ manual_validation: 'manual_validation:\n  none: "docs only"' }))).diagnostics).toEqual([]);
        expect(codes(validateRecordShape(NAME, doc(fm({ provenance: 'provenance:\n  started_at: "2026-10-17 10:00"' }))))).toContain('field-invalid');
    });
    test('R1.4 checks links.plan existence when a root is given', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
        try {
            const r = validateRecordShape(NAME, doc(fm({ links: 'links:\n  plan: docs/plans/missing.md' })), { root });
            expect(codes(r)).toContain('field-invalid');
            const escape = validateRecordShape(NAME, doc(fm({ links: 'links:\n  plan: ../outside.md' })), { root });
            expect(codes(escape)).toContain('field-invalid');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    test('R1.5 enforces the verification block', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ verification: 'verification:\n  commit: abc\n  overall: pass\n  sensors: {}\n  receipt_digest: x' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n    lint: green\n  receipt_digest: ${DIGEST}` }))))).toContain('field-invalid');
    });
    test('R1.6 requires the four body sections in order with content', () => {
        expect(codes(validateRecordShape(NAME, doc(fm(), '## Qué se hizo\nA\n')))).toContain('body-section-missing');
        const swapped = '## Qué se probó\nB\n## Qué se hizo\nA\n## Qué falta validar\nC\n## Riesgos y rollback\nD\n';
        expect(codes(validateRecordShape(NAME, doc(fm(), swapped)))).toContain('body-section-missing');
        const empty = BODY.replace('B\n', '\n');
        expect(codes(validateRecordShape(NAME, doc(fm(), empty)))).toContain('body-section-missing');
    });
    test('R1.7 rejects pending markers', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ rollback: `rollback: "${PENDING_MARKER}"` }))))).toContain('pending-content');
        expect(codes(validateRecordShape(NAME, doc(fm(), BODY.replace('A', PENDING_MARKER))))).toContain('pending-content');
    });
    test('R1.8 rejects oversize files before parsing', () => {
        const big = doc(fm()) + 'x'.repeat(MAX_RECORD_BYTES);
        expect(codes(validateRecordShape(NAME, big))).toEqual(['record-too-large']);
    });
    test('accepts CRLF line endings', () => {
        expect(validateRecordShape(NAME, doc(fm()).replace(/\n/g, '\r\n')).diagnostics).toEqual([]);
    });
});
```

- [ ] **Step 2: Run CMD-T-RECORD.** Expected: it fails with "Cannot find module '…/validate-shape'".

- [ ] **Step 3: Create `cli/src/core/changes/types.ts`:**

```ts
export const RECORD_SCHEMA = 'awm.change-record/v1';
export const PENDING_MARKER = '<!-- awm:pending -->';
export const RECORD_DIR = 'docs/changes';
export const MAX_RECORD_BYTES = 64 * 1024;
export const BODY_HEADINGS = ['## Qué se hizo', '## Qué se probó', '## Qué falta validar', '## Riesgos y rollback'] as const;
export const DERIVED_KEYS = ['type', 'scope', 'semver', 'breaking', 'modules'] as const;

export type SensorStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';
export type Overall = 'pass' | 'fail' | 'skipped' | 'not_certified';
export type Semver = 'major' | 'minor' | 'patch' | 'none';

export interface Verification {
    commit: string;
    overall: Overall;
    sensors: Record<string, SensorStatus>;
    receipt_digest: string;
}

export interface DerivedFields {
    type: string;
    scope: string | null;
    semver: Semver;
    breaking: boolean;
    modules: string[];
}

export type ManualValidation = Array<{ step: string; expected: string }> | { none: string };

export interface ChangeRecord extends DerivedFields {
    schema: typeof RECORD_SCHEMA;
    id: string;
    title: string;
    summary_short: string;
    links?: { plan?: string; issue?: string };
    verification: Verification;
    manual_validation: ManualValidation;
    risks: string[];
    rollback: string;
    provenance?: { agent?: string; model?: string; session?: string; started_at?: string; finished_at?: string };
}

export interface Diagnostic { code: string; message: string; field?: string }
```

- [ ] **Step 4: Create `cli/src/core/changes/parse.ts`:**

```ts
import yaml from 'js-yaml';
import type { Diagnostic } from './types';

export const RECORD_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: unknown): slug is string {
    return typeof slug === 'string' && slug.length > 0 && slug.length <= 64 && SLUG_RE.test(slug);
}

export function isValidRecordFileName(name: string): boolean {
    const m = RECORD_FILE_RE.exec(name);
    if (!m || !isValidSlug(m[4])) return false;
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export type Split = { ok: true; frontmatterText: string; body: string } | { ok: false; diagnostic: Diagnostic };

/** Normalizes CRLF and splits a leading `---` frontmatter block from the body. */
export function splitRecord(raw: string): Split {
    const text = raw.replace(/\r\n/g, '\n');
    if (!text.startsWith('---\n')) return { ok: false, diagnostic: { code: 'frontmatter-missing', message: 'record must start with a --- frontmatter block' } };
    const end = text.indexOf('\n---\n', 3);
    if (end < 0) return { ok: false, diagnostic: { code: 'frontmatter-missing', message: 'frontmatter block is not closed with ---' } };
    return { ok: true, frontmatterText: text.slice(4, end), body: text.slice(end + 5) };
}

function hasSharedReference(value: unknown, seen = new Set<object>()): boolean {
    if (value === null || typeof value !== 'object') return false;
    if (seen.has(value)) return true;
    seen.add(value);
    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    return children.some((child) => hasSharedReference(child, seen));
}

export type Loaded = { ok: true; value: unknown } | { ok: false; diagnostic: Diagnostic };

/** CORE_SCHEMA: no custom tags, no implicit timestamps (dates stay strings). Aliases are rejected. */
export function loadFrontmatter(text: string): Loaded {
    let value: unknown;
    try {
        value = yaml.load(text, { schema: yaml.CORE_SCHEMA, json: false });
    } catch (error) {
        return { ok: false, diagnostic: { code: 'yaml-invalid', message: `frontmatter is not valid YAML: ${(error as Error).message.split('\n')[0]}` } };
    }
    if (hasSharedReference(value)) return { ok: false, diagnostic: { code: 'yaml-alias', message: 'YAML anchors/aliases are not allowed' } };
    return { ok: true, value };
}
```

- [ ] **Step 5: Create `cli/src/core/changes/validate-shape.ts`:**

```ts
import fs from 'fs';
import path from 'path';
import { isValidRecordFileName, loadFrontmatter, splitRecord } from './parse';
import { BODY_HEADINGS, MAX_RECORD_BYTES, PENDING_MARKER, RECORD_SCHEMA, type ChangeRecord, type Diagnostic } from './types';

const TOP_KEYS = ['schema', 'id', 'title', 'summary_short', 'type', 'scope', 'semver', 'breaking', 'modules', 'links', 'verification', 'manual_validation', 'risks', 'rollback', 'provenance'];
const REQUIRED_KEYS = TOP_KEYS.filter((k) => k !== 'links' && k !== 'provenance');
const SENSOR_STATUS = ['pass', 'fail', 'inconclusive', 'skipped'];
const OVERALL = ['pass', 'fail', 'skipped', 'not_certified'];
const SEMVER = ['major', 'minor', 'patch', 'none'];
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MODULE_RE = /^(?:\.|[^/\\\0]+(?:\/[^/\\\0]+)*)$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isCanonicalIso = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

function unknownKeys(obj: Obj, allowed: string[], prefix: string, out: Diagnostic[]): void {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) out.push({ code: 'unknown-field', field: prefix + key, message: `unknown field "${prefix + key}"` });
    }
}

function bad(out: Diagnostic[], field: string, message: string): void {
    out.push({ code: 'field-invalid', field, message });
}

function isSafeRelative(p: string): boolean {
    if (p.length === 0 || path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\\') || p.includes('\0')) return false;
    return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function checkBody(body: string, out: Diagnostic[]): void {
    const lines = body.split('\n');
    const headingIdx = lines.map((l, i) => (l.startsWith('## ') ? i : -1)).filter((i) => i >= 0);
    let cursor = -1;
    for (const heading of BODY_HEADINGS) {
        const at = headingIdx.find((i) => i > cursor && lines[i].trimEnd() === heading);
        if (at === undefined) { out.push({ code: 'body-section-missing', message: `missing or out-of-order section "${heading}"` }); return; }
        const next = headingIdx.find((i) => i > at) ?? lines.length;
        if (lines.slice(at + 1, next).join('\n').trim().length === 0) {
            out.push({ code: 'body-section-missing', message: `section "${heading}" is empty` });
            return;
        }
        cursor = at;
    }
}

export interface ShapeOptions { root?: string }

export function validateRecordShape(fileName: string, raw: string, opts: ShapeOptions = {}): { record?: ChangeRecord; diagnostics: Diagnostic[] } {
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) {
        return { diagnostics: [{ code: 'record-too-large', message: `record exceeds ${MAX_RECORD_BYTES} bytes` }] };
    }
    const out: Diagnostic[] = [];
    if (!isValidRecordFileName(fileName)) out.push({ code: 'name-invalid', message: `file name "${fileName}" must be YYYY-MM-DD-<slug>.md with a valid date and slug of at most 64 chars` });
    const split = splitRecord(raw);
    if (!split.ok) return { diagnostics: [...out, split.diagnostic] };
    if (split.frontmatterText.includes(PENDING_MARKER) || split.body.includes(PENDING_MARKER)) {
        out.push({ code: 'pending-content', message: 'record still contains <!-- awm:pending --> placeholders' });
    }
    checkBody(split.body, out);
    const loaded = loadFrontmatter(split.frontmatterText);
    if (!loaded.ok) return { diagnostics: [...out, loaded.diagnostic] };
    const fm = loaded.value;
    if (!isObj(fm)) return { diagnostics: [...out, { code: 'not-an-object', message: 'frontmatter must be a mapping' }] };

    unknownKeys(fm, TOP_KEYS, '', out);
    for (const key of REQUIRED_KEYS) if (!(key in fm)) bad(out, key, `missing required field "${key}"`);

    if (fm.schema !== RECORD_SCHEMA) bad(out, 'schema', `schema must be ${RECORD_SCHEMA}`);
    if (fm.id !== fileName.replace(/\.md$/, '')) bad(out, 'id', 'id must equal the file name without .md');
    if (!nonEmpty(fm.title) || [...fm.title].length > 120) bad(out, 'title', 'title must be 1-120 characters');
    if (!nonEmpty(fm.summary_short) || [...fm.summary_short].length > 280 || /[\r\n]/.test(fm.summary_short)) bad(out, 'summary_short', 'summary_short must be 1-280 characters on one line');
    if (typeof fm.type !== 'string' || !/^[a-z]+$/.test(fm.type)) bad(out, 'type', 'type must be a lowercase conventional-commit type');
    if (!(fm.scope === null || nonEmpty(fm.scope))) bad(out, 'scope', 'scope must be a string or null');
    if (!SEMVER.includes(fm.semver as string)) bad(out, 'semver', `semver must be one of ${SEMVER.join('|')}`);
    if (typeof fm.breaking !== 'boolean') bad(out, 'breaking', 'breaking must be a boolean');
    const mods = fm.modules;
    if (!Array.isArray(mods) || !mods.every((m) => typeof m === 'string' && MODULE_RE.test(m) && (m === '.' || isSafeRelative(m)))
        || JSON.stringify([...new Set(mods as string[])].sort()) !== JSON.stringify(mods)) {
        bad(out, 'modules', 'modules must be a sorted, unique array of repo-relative directories');
    }

    if (fm.links !== undefined) {
        if (!isObj(fm.links)) bad(out, 'links', 'links must be a mapping');
        else {
            unknownKeys(fm.links, ['plan', 'issue'], 'links.', out);
            const { plan, issue } = fm.links;
            if (plan !== undefined) {
                if (typeof plan !== 'string' || !isSafeRelative(plan)) bad(out, 'links.plan', 'links.plan must be a safe repo-relative path');
                else if (opts.root !== undefined) {
                    const abs = path.join(opts.root, plan);
                    let ok = false;
                    try { ok = fs.lstatSync(abs).isFile(); } catch { ok = false; }
                    if (!ok) bad(out, 'links.plan', `links.plan "${plan}" does not exist as a regular file`);
                }
            }
            if (issue !== undefined) {
                let ok = false;
                try { ok = typeof issue === 'string' && new URL(issue).protocol === 'https:'; } catch { ok = false; }
                if (!ok) bad(out, 'links.issue', 'links.issue must be an https URL');
            }
        }
    }

    const v = fm.verification;
    if (!isObj(v)) bad(out, 'verification', 'verification must be a mapping');
    else {
        unknownKeys(v, ['commit', 'overall', 'sensors', 'receipt_digest'], 'verification.', out);
        if (typeof v.commit !== 'string' || !SHA_RE.test(v.commit)) bad(out, 'verification.commit', 'verification.commit must be 40 lowercase hex characters');
        if (!OVERALL.includes(v.overall as string)) bad(out, 'verification.overall', `overall must be one of ${OVERALL.join('|')}`);
        if (!isObj(v.sensors) || !Object.entries(v.sensors).every(([k, s]) => /^[A-Za-z0-9._-]+$/.test(k) && SENSOR_STATUS.includes(s as string))) {
            bad(out, 'verification.sensors', 'sensors must map sensor names to pass|fail|inconclusive|skipped');
        }
        if (typeof v.receipt_digest !== 'string' || !DIGEST_RE.test(v.receipt_digest)) bad(out, 'verification.receipt_digest', 'receipt_digest must be sha256:<64 hex>');
    }

    const mv = fm.manual_validation;
    if (Array.isArray(mv)) {
        if (mv.length === 0) bad(out, 'manual_validation', 'manual_validation must not be empty; use {none: <reason>}');
        mv.forEach((item, i) => {
            if (!isObj(item)) { bad(out, `manual_validation.${i}`, 'item must be a mapping'); return; }
            unknownKeys(item, ['step', 'expected'], `manual_validation.${i}.`, out);
            if (!nonEmpty(item.step) || !nonEmpty(item.expected)) bad(out, `manual_validation.${i}`, 'step and expected must be non-empty strings');
        });
    } else if (isObj(mv)) {
        unknownKeys(mv, ['none'], 'manual_validation.', out);
        if (!nonEmpty(mv.none)) bad(out, 'manual_validation.none', 'none must state a non-empty reason');
    } else bad(out, 'manual_validation', 'manual_validation must be a list or {none: <reason>}');

    if (!Array.isArray(fm.risks) || !fm.risks.every(nonEmpty)) bad(out, 'risks', 'risks must be an array of non-empty strings');
    if (!nonEmpty(fm.rollback)) bad(out, 'rollback', 'rollback must be a non-empty string');

    if (fm.provenance !== undefined) {
        if (!isObj(fm.provenance)) bad(out, 'provenance', 'provenance must be a mapping');
        else {
            unknownKeys(fm.provenance, ['agent', 'model', 'session', 'started_at', 'finished_at'], 'provenance.', out);
            for (const [k, val] of Object.entries(fm.provenance)) {
                if (!nonEmpty(val)) bad(out, `provenance.${k}`, `provenance.${k} must be a non-empty string`);
                else if ((k === 'started_at' || k === 'finished_at') && !isCanonicalIso(val)) bad(out, `provenance.${k}`, `provenance.${k} must be canonical ISO-8601`);
            }
        }
    }

    return out.length === 0 ? { record: fm as unknown as ChangeRecord, diagnostics: [] } : { diagnostics: out };
}
```

- [ ] **Step 6: Run CMD-T-RECORD.** Expected: PASS (12 tests). Then run CMD-TYPECHECK. Expected: exit 0.

- [ ] **Step 7: Commit.** `git add cli/src/core/changes cli/tests/core/changes/record.test.ts && git commit -m "feat(changes): change record format and shape validator"`

#### Edge cases
- **Unknown keys and placeholders:** Unknown keys at the top level, under `links`, `verification`, `manual_validation[i]` and `provenance` each yield `unknown-field` with the dotted path. Pending markers anywhere yield `pending-content`.
- **Size bound:** Over-size input returns exactly `['record-too-large']` without parsing, which bounds YAML-bomb risk.
- **YAML safety:** `CORE_SCHEMA` rejects `!!js/function` and other unknown tags (`yaml-invalid`). Shared object references from aliases yield `yaml-alias`. Timestamps stay strings, so the ISO check is exact.
- **Path safety:** `links.plan` rejects absolute paths, drive letters, `\`, NUL and `..`/`.` segments before any filesystem access, and uses `lstat` (no symlink following for the final entry).
- **Input forms:** CRLF input is accepted. Dates such as `2026-13-40` fail `name-invalid`.

#### Evidence
- **Sources:** SRC-DESIGN (R1).
- **Commands:** CMD-T-RECORD is RED before Step 3 and GREEN after Step 5. CMD-TYPECHECK passes.
- **Review:** specification reviewer maps each test to R1.1–R1.8. The quality reviewer checks the absence of shell or I/O in the validator, apart from the optional `lstat` for `links.plan`.

#### Fallback
- **Risk:** public record contract and parsing of untrusted input.
- **Trigger:** if js-yaml `CORE_SCHEMA` behaves differently from the facts above (for example, it accepts a custom tag), stop. Record a durable deviation and amend this slice with the verified behavior under full relevant context before continuing. Never weaken a check to make tests pass.

<a id="slice-s2"></a>
### Slice S2: Sensor-run receipt

#### Surfaces
**Owns R2.1–R2.5.** These are grouped because the receipt write, its eligibility rules and its tamper-checked read form one persistence boundary.

**Files:**
- Create `cli/src/core/changes/receipt.ts`
- Modify `cli/src/commands/sensors/index.ts`, the `run` action only
- Create `cli/tests/core/changes/receipt.test.ts`

**Interfaces:**
- `isFullSelection(opts)`
- `captureReceiptPrecondition(cwd)`
- `finalizeReceipt(pre, output, deps?)`
- `buildReceipt(input)`
- `computeReceiptDigest(body)`
- `writeReceipt(root, receipt)`
- `readReceipt(root, commit)`

#### Implementation
**Dependencies:** S1 (`SensorStatus`, `Overall`). It uses the git helpers inline (`execFileSync`) and does **not** depend on S3, to keep this slice self-contained.

- [ ] **Step 1: Write the failing test** `cli/tests/core/changes/receipt.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { buildReceipt, captureReceiptPrecondition, finalizeReceipt, isFullSelection, readReceipt, writeReceipt } from '../../../src/core/changes/receipt';

const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_CONFIG_NOSYSTEM'];
let saved: Record<string, string | undefined> = {};
let root: string; let home: string;
const g = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcpt-')));
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, '.gitignore'), '.awm/\n');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    g('add', '.'); g('commit', '-q', '-m', 'feat: a');
});
afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

const output = { overall: 'pass' as const, sensors: [{ name: 'lint', status: 'pass' as const, errors: [] }, { name: 'a-typecheck', status: 'pass' as const, errors: [] }] };

describe('receipt', () => {
    test('R2.1 full selection on a clean tree writes a 0600 receipt keyed by HEAD', () => {
        const pre = captureReceiptPrecondition(root);
        expect(pre.eligible).toBe(true);
        const note = finalizeReceipt(pre, output as never, { now: () => new Date('2026-10-17T10:00:00.000Z'), version: () => '9.20.0' });
        expect(note).toBe('');
        const head = g('rev-parse', 'HEAD');
        const file = path.join(root, '.awm', 'sensors', 'runs', `${head}.json`);
        expect(fs.existsSync(file)).toBe(true);
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        const read = readReceipt(root, head);
        expect(read.ok && read.receipt.sensors).toEqual({ 'a-typecheck': 'pass', lint: 'pass' });
        expect(read.ok && Object.keys(read.receipt.sensors)).toEqual(['a-typecheck', 'lint']);
    });
    test('R2.1 selection rules', () => {
        expect(isFullSelection({})).toBe(true);
        expect(isFullSelection({ all: true })).toBe(true);
        expect(isFullSelection({ fast: true, slow: true })).toBe(true);
        expect(isFullSelection({ fast: true })).toBe(false);
        expect(isFullSelection({ slow: true })).toBe(false);
        expect(isFullSelection({ all: true, changed: true })).toBe(false);
    });
    test('R2.2 dirty tree yields no receipt and a reason', () => {
        fs.writeFileSync(path.join(root, 'b.txt'), 'b');
        const pre = captureReceiptPrecondition(root);
        expect(pre.eligible).toBe(false);
        const note = finalizeReceipt(pre, output as never);
        expect(note).toMatch(/no sensor receipt written: .*uncommitted/);
        expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
    });
    test('R2.2 HEAD moving during the run yields no receipt', () => {
        const pre = captureReceiptPrecondition(root);
        fs.writeFileSync(path.join(root, 'c.txt'), 'c'); g('add', '.'); g('commit', '-q', '-m', 'fix: c');
        expect(finalizeReceipt(pre, output as never)).toMatch(/HEAD or working tree changed/);
    });
    test('R2.2 outside git yields no receipt', () => {
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plain-'));
        try { expect(captureReceiptPrecondition(plain).eligible).toBe(false); }
        finally { fs.rmSync(plain, { recursive: true, force: true }); }
    });
    test('R2.3/R2.5 digest covers every field and tampering invalidates', () => {
        const head = g('rev-parse', 'HEAD');
        const r = buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '9.20.0', output: output as never });
        expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        writeReceipt(root, r);
        const file = path.join(root, '.awm', 'sensors', 'runs', `${head}.json`);
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        parsed.overall = 'fail';
        fs.writeFileSync(file, JSON.stringify(parsed));
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
        expect(readReceipt(root, 'f'.repeat(40))).toEqual({ ok: false, code: 'receipt-missing' });
        expect(readReceipt(root, '../x')).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('refuses a symlinked runs directory', () => {
        if (process.platform === 'win32') return;
        const head = g('rev-parse', 'HEAD');
        fs.mkdirSync(path.join(root, '.awm', 'sensors'), { recursive: true });
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-else-'));
        fs.symlinkSync(elsewhere, path.join(root, '.awm', 'sensors', 'runs'));
        const r = buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        expect(() => writeReceipt(root, r)).toThrow(/symlink/);
        fs.rmSync(elsewhere, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run CMD-T-RECEIPT.** Expected: it fails with "Cannot find module '…/receipt'".

- [ ] **Step 3: Create `cli/src/core/changes/receipt.ts`:**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { writeFileAtomic } from '../atomic-file';
import { cliVersion } from '../cli-version';
import type { RunOutput } from '../../commands/sensors/types';
import type { Overall, SensorStatus } from './types';

export interface SensorReceipt {
    schema: 1;
    commit: string;
    ranAt: string;
    cliVersion: string;
    overall: Overall;
    sensors: Record<string, SensorStatus>;
    digest: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const OVERALL = ['pass', 'fail', 'skipped', 'not_certified'];
const STATUS = ['pass', 'fail', 'inconclusive', 'skipped'];
const GIT_OPTS = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'], timeout: 15000 };

export interface SelectionOpts { fast?: boolean; slow?: boolean; all?: boolean; changed?: boolean }

export function isFullSelection(opts: SelectionOpts): boolean {
    if (opts.changed) return false;
    if (opts.all) return true;
    return Boolean(opts.fast) === Boolean(opts.slow);
}

function sortedSensors(sensors: Record<string, SensorStatus>): Record<string, SensorStatus> {
    return Object.fromEntries(Object.keys(sensors).sort().map((k) => [k, sensors[k]]));
}

export function computeReceiptDigest(body: Omit<SensorReceipt, 'digest'>): string {
    const canonical = JSON.stringify({
        schema: body.schema, commit: body.commit, ranAt: body.ranAt, cliVersion: body.cliVersion,
        overall: body.overall, sensors: sortedSensors(body.sensors),
    });
    return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

export function buildReceipt(input: { commit: string; ranAt: string; cliVersion: string; output: Pick<RunOutput, 'overall' | 'sensors'> }): SensorReceipt {
    if (!SHA_RE.test(input.commit)) throw new Error('receipt commit must be 40 lowercase hex characters');
    const sensors = sortedSensors(Object.fromEntries(input.output.sensors.map((s) => [s.name, s.status])) as Record<string, SensorStatus>);
    const body = { schema: 1 as const, commit: input.commit, ranAt: input.ranAt, cliVersion: input.cliVersion, overall: input.output.overall as Overall, sensors };
    return { ...body, digest: computeReceiptDigest(body) };
}

function runsDir(root: string): string {
    return path.join(root, '.awm', 'sensors', 'runs');
}

function assertNoSymlinkChain(root: string): void {
    let current = root;
    for (const segment of ['.awm', 'sensors', 'runs']) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing to use symlinked path ${current}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
    }
}

export function writeReceipt(root: string, receipt: SensorReceipt): string {
    assertNoSymlinkChain(root);
    fs.mkdirSync(runsDir(root), { recursive: true, mode: 0o700 });
    assertNoSymlinkChain(root);
    const file = path.join(runsDir(root), `${receipt.commit}.json`);
    writeFileAtomic(file, JSON.stringify(receipt, null, 2) + '\n', 0o600);
    return file;
}

export type ReadReceipt = { ok: true; receipt: SensorReceipt } | { ok: false; code: 'receipt-missing' | 'receipt-invalid' };

export function readReceipt(root: string, commit: string): ReadReceipt {
    if (!SHA_RE.test(commit)) return { ok: false, code: 'receipt-invalid' };
    let raw: string;
    try {
        assertNoSymlinkChain(root);
        const file = path.join(runsDir(root), `${commit}.json`);
        if (fs.lstatSync(file).isSymbolicLink()) return { ok: false, code: 'receipt-invalid' };
        raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: false, code: 'receipt-missing' } : { ok: false, code: 'receipt-invalid' };
    }
    let x: Record<string, unknown>;
    try { x = JSON.parse(raw); } catch { return { ok: false, code: 'receipt-invalid' }; }
    const keys = ['schema', 'commit', 'ranAt', 'cliVersion', 'overall', 'sensors', 'digest'];
    if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length !== keys.length || !keys.every((k) => k in x)) return { ok: false, code: 'receipt-invalid' };
    const sensors = x.sensors as Record<string, unknown>;
    const shapeOk = x.schema === 1 && x.commit === commit && typeof x.ranAt === 'string' && new Date(x.ranAt as string).toISOString() === x.ranAt
        && typeof x.cliVersion === 'string' && OVERALL.includes(x.overall as string)
        && sensors !== null && typeof sensors === 'object' && !Array.isArray(sensors) && Object.values(sensors).every((s) => STATUS.includes(s as string))
        && typeof x.digest === 'string';
    if (!shapeOk) return { ok: false, code: 'receipt-invalid' };
    const receipt = x as unknown as SensorReceipt;
    const { digest, ...body } = receipt;
    if (computeReceiptDigest(body) !== digest) return { ok: false, code: 'receipt-invalid' };
    return { ok: true, receipt };
}

export type Precondition = { eligible: true; root: string; commit: string } | { eligible: false; reason: string };

function gitState(cwd: string): { root: string; commit: string; dirty: boolean } | null {
    try {
        const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { ...GIT_OPTS, cwd }).trim();
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { ...GIT_OPTS, cwd: root }).trim();
        const status = execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude).awm'], { ...GIT_OPTS, cwd: root });
        return { root, commit, dirty: status.trim().length > 0 };
    } catch {
        return null;
    }
}

/** Measured BEFORE the run: a receipt certifies a commit only when the tree equals it. */
export function captureReceiptPrecondition(cwd: string): Precondition {
    const state = gitState(cwd);
    if (!state) return { eligible: false, reason: 'not inside a git repository with a commit' };
    if (state.dirty) return { eligible: false, reason: 'working tree has uncommitted changes (commit them first)' };
    if (!SHA_RE.test(state.commit)) return { eligible: false, reason: 'HEAD is not a 40-hex commit' };
    return { eligible: true, root: state.root, commit: state.commit };
}

/** Returns '' on success, or one stderr line explaining why no receipt was written. */
export function finalizeReceipt(pre: Precondition, output: Pick<RunOutput, 'overall' | 'sensors'>, deps: { now?: () => Date; version?: () => string } = {}): string {
    if (!pre.eligible) return `no sensor receipt written: ${pre.reason}\n`;
    const after = gitState(pre.root);
    if (!after || after.commit !== pre.commit || after.dirty) return 'no sensor receipt written: HEAD or working tree changed during the run\n';
    try {
        writeReceipt(pre.root, buildReceipt({ commit: pre.commit, ranAt: (deps.now ?? (() => new Date()))().toISOString(), cliVersion: (deps.version ?? cliVersion)(), output }));
        return '';
    } catch (error) {
        return `no sensor receipt written: ${(error as Error).message}\n`;
    }
}
```

- [ ] **Step 4: Wire the hook in `cli/src/commands/sensors/index.ts`.**

  Add this import at the top:
  ```ts
  import { captureReceiptPrecondition, finalizeReceipt, isFullSelection } from '../../core/changes/receipt';
  ```

  Replace the `run` action body with:

```ts
        .action(async (opts) => {
            const pre = isFullSelection(opts) ? captureReceiptPrecondition(process.cwd()) : null;
            const output = await runSensors({
                fast: opts.fast, slow: opts.slow, all: opts.all,
                changed: opts.changed, base: opts.base,
            });
            // Emit the verdict ALWAYS — an empty `sensors` with overall:'not_certified'
            // must be visible, never a silent exit-0 that reads as "clean".
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            // R2: the receipt is a side effect; it never changes stdout or the exit code.
            if (pre) {
                const note = finalizeReceipt(pre, output);
                if (note) process.stderr.write(note);
            }
            process.exitCode = exitCodeForVerdict(output.overall);
        });
```

- [ ] **Step 5: Run CMD-T-RECEIPT.** Expected: PASS (7 tests). Then run `npm --prefix cli test -- tests/commands/sensors`. Expected: every existing sensors test still passes, which proves R2.4. Then run CMD-TYPECHECK. Expected: exit 0.

- [ ] **Step 6: Commit.** `git add cli/src/core/changes/receipt.ts cli/src/commands/sensors/index.ts cli/tests/core/changes/receipt.test.ts && git commit -m "feat(sensors): persist a per-commit sensor-run receipt"`

#### Edge cases
- **No receipt (R2.2):** partial selection, a dirty tree (excluding `.awm/`), no git, or HEAD/tree changing during the run (a sensor auto-fixing files) all mean no receipt. The partial-selection case is silent; the others write one stderr line. The exit code is unchanged in every case.
- **Tamper detection (R2.5):** a commit argument not matching 40-hex (for example `../x`) returns `receipt-invalid` before any path join. Wrong shape, extra keys or a digest mismatch also return `receipt-invalid`.
- **Path safety:** symlinked `.awm`, `sensors` or `runs` segments are refused on write and read. The file mode is 0600 and the directory mode is 0700. The 0600 assertion is skipped on win32, where POSIX modes do not apply.

#### Evidence
- **Sources:** SRC-ATOMIC, SRC-CLI-VERSION, SRC-SENSORS-CMD, SRC-SENSOR-TYPES, SRC-TEST-ISOLATION.
- **Commands:** CMD-T-RECEIPT goes RED then GREEN. The existing sensors suite stays green, which proves R2.4.
- **Review:** the quality reviewer confirms that `runSensors` is untouched and that stdout is byte-identical.

#### Fallback
- **Trigger:** if the existing sensors tests assert exact stderr (empty), stop.
- **Durable amendment:** record that the receipt note must be gated (for example, written only when stderr is a TTY) and amend R2.2 with the owner before proceeding. Never suppress the note silently.

<a id="slice-s3"></a>
### Slice S3: Git wrappers, derivation and opt-out trailers

#### Surfaces
**Owns R3.1–R3.5.** These are grouped because base resolution, range derivation and modules all read the same commit range.

**Files:**
- Create `cli/src/core/changes/git.ts`
- Create `cli/src/core/changes/derive.ts`
- Create `cli/src/core/changes/trailers.ts`
- Create `cli/tests/core/changes/helpers.ts`
- Create `cli/tests/core/changes/derive.test.ts`

The trailer helper is consumed by S5 and S6. It lives here because it is a pure git-range reader alongside the others.

#### Implementation
**Dependencies:** S1 types.

- [ ] **Step 1: Create the shared test helper `cli/tests/core/changes/helpers.ts`:**

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE'];

export interface TestRepo {
    root: string;
    git: (...args: string[]) => string;
    commit: (files: Record<string, string>, message: string, date?: string) => string;
    cleanup: () => void;
}

/** Isolated repo: HOME/AWM_HOME point at a tmpdir; never touches the real ~/.awm. */
export function makeRepo(): TestRepo {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' });
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-chg-')));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    const commit = (files: Record<string, string>, message: string, date?: string): string => {
        for (const [rel, content] of Object.entries(files)) {
            const abs = path.join(root, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
        git('add', '-A');
        if (date) { process.env.GIT_AUTHOR_DATE = date; process.env.GIT_COMMITTER_DATE = date; }
        try { git('commit', '-q', '-m', message); } finally { delete process.env.GIT_AUTHOR_DATE; delete process.env.GIT_COMMITTER_DATE; }
        return git('rev-parse', 'HEAD');
    };
    const cleanup = () => {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    };
    commit({ '.gitignore': '.awm/\n', 'README.md': 'x' }, 'chore: init');
    return { root, git, commit, cleanup };
}
```

- [ ] **Step 2: Write the failing test** `cli/tests/core/changes/derive.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { makeRepo, type TestRepo } from './helpers';
import { resolveBase, mergeBase, isAncestor, changedFiles, isDirtyOutside, repoRoot } from '../../../src/core/changes/git';
import { deriveFields, deriveFromCommits, deriveModules } from '../../../src/core/changes/derive';
import { hasOptOut } from '../../../src/core/changes/trailers';

let repo: TestRepo;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

function branch(): string {
    repo.git('checkout', '-q', '-b', 'feat/x');
    return repo.git('rev-parse', 'main');
}

describe('git wrappers', () => {
    test('R3.1 resolves base: explicit, origin/HEAD, main, master', () => {
        branch();
        expect(resolveBase(repo.root)).toBe('main');
        expect(resolveBase(repo.root, 'main')).toBe('main');
        repo.git('update-ref', 'refs/remotes/origin/main', 'main');
        repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
        expect(resolveBase(repo.root)).toBe('refs/remotes/origin/HEAD');
    });
    test('R3.2 unresolvable or unsafe base returns null', () => {
        repo.git('branch', '-m', 'main', 'trunk');
        expect(resolveBase(repo.root)).toBeNull();
        expect(resolveBase(repo.root, '--upload-pack=x')).toBeNull();
        expect(resolveBase(repo.root, 'nope')).toBeNull();
    });
    test('ancestry, changed files and dirtiness', () => {
        const base = branch();
        const c = repo.commit({ 'src/a.ts': '1' }, 'feat: a');
        expect(isAncestor(repo.root, base, c)).toBe(true);
        expect(isAncestor(repo.root, c, base)).toBe(false);
        expect(isAncestor(repo.root, 'f'.repeat(40), c)).toBe(false);
        expect(changedFiles(repo.root, base, 'HEAD')).toEqual(['src/a.ts']);
        expect(isDirtyOutside(repo.root, ['.awm', 'docs/changes'])).toBe(false);
        fs.writeFileSync(path.join(repo.root, 'docs-x.md'), 'y');
        expect(isDirtyOutside(repo.root, ['.awm', 'docs/changes'])).toBe(true);
        expect(repoRoot(repo.root)).toBe(repo.root);
    });
});

describe('derivation', () => {
    test('R3.3 semver/type/breaking/scope rules', () => {
        const c = (type: string, scope: string | null, breaking = false) => ({ type, scope, breaking, subject: 's' });
        expect(deriveFromCommits([c('fix', 'a'), c('feat', 'b'), c('feat', 'b')])).toEqual({ type: 'feat', scope: 'b', semver: 'minor', breaking: false });
        expect(deriveFromCommits([c('feat', 'a'), c('refactor', 'z', true)])).toEqual({ type: 'refactor', scope: 'a', semver: 'major', breaking: true });
        expect(deriveFromCommits([c('docs', null), c('chore', null)])).toEqual({ type: 'docs', scope: null, semver: 'none', breaking: false });
        expect(deriveFromCommits([c('perf', 'b'), c('perf', 'a')])).toEqual({ type: 'perf', scope: 'a', semver: 'patch', breaking: false });
    });
    test('R3.4 modules: parent dirs truncated to 3 segments, root files map to ., docs/changes excluded', () => {
        expect(deriveModules(['cli/src/core/changes/x.ts', 'README.md', 'docs/changes/2026-10-17-a.md', 'cli/src/a.ts', 'cli/src/core/y.ts']))
            .toEqual(['.', 'cli/src', 'cli/src/core']);
    });
    test('R3.3/R3.4 deriveFields over a real range ignores record-only commits', () => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): add a');
        repo.commit({ 'cli/src/b.ts': '1' }, 'fix(changes): b');
        const before = deriveFields(repo.root, mergeBase(repo.root, base));
        repo.commit({ 'docs/changes/2026-10-17-x.md': 'r' }, 'docs(other): add record');
        const after = deriveFields(repo.root, mergeBase(repo.root, base));
        expect(before).toEqual({ ok: true, fields: { type: 'feat', scope: 'changes', semver: 'minor', breaking: false, modules: ['cli/src'] } });
        expect(after).toEqual(before);
    });
    test('R3.5 no commits and no conventional commits fail', () => {
        const base = branch();
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-commits' }) });
        repo.commit({ 'a.ts': '1' }, 'random message');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-conventional-commits' }) });
    });
});

describe('trailers', () => {
    test('detects Change-Record: none in a range', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs: typo');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
        repo.commit({ 'b.ts': '1' }, 'docs: typo2\n\nChange-Record: none');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
    });
});
```

- [ ] **Step 3: Run CMD-T-DERIVE.** Expected: it fails with "Cannot find module '…/git'".

- [ ] **Step 4: Create `cli/src/core/changes/git.ts`:**

```ts
import { execFileSync } from 'child_process';

const OPTS = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 16 * 1024 * 1024 };
const REF_RE = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;

export function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { ...OPTS, cwd });
}

export function tryGit(cwd: string, args: string[]): string | null {
    try { return git(cwd, args); } catch { return null; }
}

export function repoRoot(cwd: string): string {
    const out = tryGit(cwd, ['rev-parse', '--show-toplevel']);
    if (out === null) throw new Error('not inside a git repository');
    return out.trim();
}

export function headSha(root: string): string {
    return git(root, ['rev-parse', 'HEAD']).trim();
}

function isCommitRef(root: string, ref: string): boolean {
    return REF_RE.test(ref) && !ref.includes('..') && tryGit(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]) !== null;
}

/** R3.1: --base, then origin/HEAD, then main, then master. Returns null when none resolves. */
export function resolveBase(root: string, explicit?: string): string | null {
    if (explicit !== undefined) return isCommitRef(root, explicit) ? explicit : null;
    for (const candidate of ['refs/remotes/origin/HEAD', 'main', 'master']) if (isCommitRef(root, candidate)) return candidate;
    return null;
}

export function mergeBase(root: string, base: string): string {
    return git(root, ['merge-base', '--end-of-options', base, 'HEAD']).trim();
}

export function isAncestor(root: string, ancestor: string, descendant: string): boolean {
    return tryGit(root, ['merge-base', '--is-ancestor', '--end-of-options', ancestor, descendant]) !== null;
}

export function changedFiles(root: string, from: string, to = 'HEAD'): string[] {
    return git(root, ['diff', '--no-renames', '--name-only', '-z', '--end-of-options', from, to]).split('\0').filter(Boolean);
}

export function isDirtyOutside(root: string, excludes: string[]): boolean {
    const out = git(root, ['status', '--porcelain', '--', '.', ...excludes.map((e) => `:(exclude)${e}`)]);
    return out.trim().length > 0;
}

/** `host/owner/name` from remote.origin.url with credentials stripped; null when absent or unparseable. */
export function repoIdentity(root: string): string | null {
    const url = tryGit(root, ['config', '--get', 'remote.origin.url'])?.trim();
    if (!url) return null;
    const scp = /^[^@/]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(url);
    if (scp) return `${scp[1]}/${scp[2]}`;
    try {
        const u = new URL(url);
        const p = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
        return u.hostname && p ? `${u.hostname}/${p}` : null;
    } catch {
        return null;
    }
}
```

- [ ] **Step 5: Create `cli/src/core/changes/derive.ts`:**

```ts
import path from 'path';
import { determineBump, GIT_LOG_FORMAT, parseCommits, type Commit } from '../../release/core';
import { changedFiles, git } from './git';
import { RECORD_DIR, type DerivedFields, type Diagnostic, type Semver } from './types';

const EXCLUDE_RECORDS = `:(exclude)${RECORD_DIR}`;

export function deriveFromCommits(commits: Commit[]): Omit<DerivedFields, 'modules'> {
    const breaking = commits.some((c) => c.breaking);
    const pick = commits.find((c) => c.breaking) ?? commits.find((c) => c.type === 'feat') ?? commits.find((c) => c.type === 'fix')
        ?? commits.find((c) => c.type === 'perf') ?? commits[0];
    const counts = new Map<string, number>();
    for (const c of commits) if (c.scope) counts.set(c.scope, (counts.get(c.scope) ?? 0) + 1);
    const scope = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const semver: Semver = determineBump(commits) ?? 'none';
    return { type: pick.type, scope, semver, breaking };
}

export function deriveModules(files: string[]): string[] {
    const dirs = files
        .filter((f) => !f.startsWith(`${RECORD_DIR}/`))
        .map((f) => {
            const dir = path.posix.dirname(f);
            return dir === '.' ? '.' : dir.split('/').slice(0, 3).join('/');
        });
    return [...new Set(dirs)].sort();
}

export type Derived = { ok: true; fields: DerivedFields } | { ok: false; diagnostic: Diagnostic };

/** Derives from non-merge commits in mergeBaseSha..HEAD, ignoring commits/files that only touch docs/changes/. */
export function deriveFields(root: string, mergeBaseSha: string): Derived {
    const range = `${mergeBaseSha}..HEAD`;
    const count = Number(git(root, ['rev-list', '--no-merges', '--count', range, '--', '.', EXCLUDE_RECORDS]).trim());
    if (!Number.isFinite(count) || count === 0) return { ok: false, diagnostic: { code: 'no-commits', message: `no non-merge commits outside ${RECORD_DIR}/ in ${range}` } };
    const raw = git(root, ['log', '--no-merges', '--reverse', `--format=${GIT_LOG_FORMAT}`, range, '--', '.', EXCLUDE_RECORDS]);
    const commits = parseCommits(raw);
    if (commits.length === 0) return { ok: false, diagnostic: { code: 'no-conventional-commits', message: 'no commit in the range uses a conventional-commit subject (type(scope): subject)' } };
    return { ok: true, fields: { ...deriveFromCommits(commits), modules: deriveModules(changedFiles(root, mergeBaseSha, 'HEAD')) } };
}
```

- [ ] **Step 6: Create `cli/src/core/changes/trailers.ts`:**

```ts
import { git } from './git';

export const OPT_OUT_TRAILER = 'Change-Record';

/** True when any commit selected by `revArgs` (e.g. ['a..b'] or ['-1', sha]) carries `Change-Record: none`. */
export function hasOptOut(root: string, revArgs: string[]): boolean {
    const out = git(root, ['log', `--format=%(trailers:key=${OPT_OUT_TRAILER},valueonly,separator=%x1f)%x1e`, ...revArgs]);
    return out.split(/[\x1e\x1f\n]/).some((v) => v.trim().toLowerCase() === 'none');
}
```

- [ ] **Step 7: Run CMD-T-DERIVE.** Expected: PASS (8 tests). Then run CMD-TYPECHECK. Expected: exit 0.

- [ ] **Step 8: Commit.** `git add cli/src/core/changes/{git,derive,trailers}.ts cli/tests/core/changes/{helpers,derive.test}.ts && git commit -m "feat(changes): derive record fields from git and detect opt-out trailers"`

#### Edge cases
- **Base safety:** `--base` values starting with `-`, containing `..`, or with characters outside `[A-Za-z0-9._/-]` resolve to `null`. `--end-of-options` guards every revision argument. A renamed default branch with no `main`, `master` or `origin/HEAD` resolves to `null`, which maps to R3.2.
- **Record commits:** commits that only touch `docs/changes/` are excluded from both the count and the parse, so `new` and `validate` agree after the record is committed.
- **Unparseable commits:** non-conventional commits are ignored by `parseCommits`. If none parse, the result is `no-conventional-commits` (the clarification above).
- **Scope ties:** ties break alphabetically. Breaking takes precedence, even when it comes from a non-feat type.

#### Evidence
- **Sources:** SRC-RELEASE-CORE, SRC-TEST-ISOLATION.
- **Commands:** CMD-T-DERIVE goes RED then GREEN with real tmp git repos. CMD-TYPECHECK passes.
- **Review:** the reviewer confirms that no shell is used and that `--`/`--end-of-options` is present on every user-influenced argument.

#### Fallback
- **Trigger:** if `%(trailers:…valueonly,separator=…)` is unsupported by the git version in CI (git < 2.22), stop.
- **Durable amendment:** amend `hasOptOut` to parse raw `%B` lines matching `/^Change-Record:\s*none\s*$/im` and record the deviation in the plan before continuing.

<a id="slice-s4"></a>
### Slice S4: awm change new

#### Surfaces
**Owns R3.6–R3.12.** These are grouped because they are the single write path for a record: skeleton creation and refresh.

**Files:**
- Create `cli/src/core/changes/render.ts`, the record skeleton and refresh splice
- Create `cli/src/commands/change/index.ts`, `new` only in this slice; S5 adds `validate` to the same file
- Modify `cli/src/index.ts`, import and register
- Create `cli/tests/commands/change/new.test.ts`

**Interfaces:**
- `runChangeNew(cwd, slug, opts, deps?) => CommandResult`
- `registerChangeCommand(program, deps?)`
- `renderSkeleton(input) => string`
- `refreshDerived(raw, fields, verification) => string | null`

#### Implementation
**Dependencies:** S1, S2 (`readReceipt`), S3.

- [ ] **Step 1: Write the failing test** `cli/tests/commands/change/new.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeRepo, type TestRepo } from '../../core/changes/helpers';
import { runChangeNew } from '../../../src/commands/change';
import { buildReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { PENDING_MARKER } from '../../../src/core/changes/types';

let repo: TestRepo;
const now = () => new Date('2026-10-17T12:00:00.000Z');
const pass = { overall: 'pass' as const, sensors: [{ name: 'lint', status: 'pass' as const, errors: [] }] };
function receiptForHead(): void {
    writeReceipt(repo.root, buildReceipt({ commit: repo.git('rev-parse', 'HEAD'), ranAt: '2026-10-17T11:00:00.000Z', cliVersion: '9.20.0', output: pass as never }));
}
beforeEach(() => {
    repo = makeRepo();
    repo.git('checkout', '-q', '-b', 'feat/x');
    repo.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): a');
});
afterEach(() => repo.cleanup());
const file = () => path.join(repo.root, 'docs', 'changes', '2026-10-17-change-record.md');

describe('awm change new', () => {
    test('R3.6 requires a receipt and a clean tree', () => {
        expect(runChangeNew(repo.root, 'change-record', {}, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('receipt-missing') });
        receiptForHead();
        fs.writeFileSync(path.join(repo.root, 'dirty.ts'), 'x');
        expect(runChangeNew(repo.root, 'change-record', {}, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('tree-dirty') });
    });
    test('R3.7/R3.9 writes a skeleton with derived fields and copied verification', () => {
        receiptForHead();
        const r = runChangeNew(repo.root, 'change-record', { issue: 'https://github.com/o/r/issues/217', model: 'm1' }, { now });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('docs/changes/2026-10-17-change-record.md');
        const text = fs.readFileSync(file(), 'utf8');
        expect(text).toContain('type: feat');
        expect(text).toContain('semver: minor');
        expect(text).toContain(`commit: ${repo.git('rev-parse', 'HEAD')}`);
        expect(text).toMatch(/receipt_digest: sha256:[0-9a-f]{64}/);
        expect(text).toContain(PENDING_MARKER);
        expect(text).toContain('model: m1');
        expect(text).toContain('## Riesgos y rollback');
    });
    test('R3.8 provenance omits keys without a source', () => {
        receiptForHead();
        runChangeNew(repo.root, 'change-record', {}, { now });
        expect(fs.readFileSync(file(), 'utf8')).not.toContain('provenance:');
    });
    test('R3.10 refuses to overwrite, including the same slug on another date', () => {
        receiptForHead();
        runChangeNew(repo.root, 'change-record', {}, { now });
        const later = () => new Date('2026-10-20T12:00:00.000Z');
        expect(runChangeNew(repo.root, 'change-record', {}, { now: later })).toMatchObject({ code: 2, stderr: expect.stringContaining('record-exists') });
    });
    test('R3.11 refresh rewrites only derived fields and verification', () => {
        receiptForHead();
        runChangeNew(repo.root, 'change-record', {}, { now });
        const edited = fs.readFileSync(file(), 'utf8').split(PENDING_MARKER).join('written by agent');
        fs.writeFileSync(file(), edited);
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): record');
        repo.commit({ 'cli/src/core/b.ts': '1' }, 'fix(core): b');
        receiptForHead();
        const r = runChangeNew(repo.root, 'change-record', { refresh: true }, { now });
        expect(r.code).toBe(0);
        const after = fs.readFileSync(file(), 'utf8');
        expect(after).toContain(`commit: ${repo.git('rev-parse', 'HEAD')}`);
        expect(after).toContain('  - cli/src/core');
        const strip = (s: string) => s.replace(/^(type|scope|semver|breaking|modules|verification):[\s\S]*?(?=^[a-z_]+:|^---$)/gm, '');
        expect(strip(after)).toBe(strip(edited));
    });
    test('R3.11 refresh of a broken record fails', () => {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), '---\n: : :\n---\n');
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): broken');
        receiptForHead();
        expect(runChangeNew(repo.root, 'change-record', { refresh: true }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('record-invalid') });
    });
    test('R3.12 rejects bad slugs, bad flags and symlinked docs/changes', () => {
        receiptForHead();
        expect(runChangeNew(repo.root, '../evil', {}, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('slug-invalid') });
        expect(runChangeNew(repo.root, 'ok', { issue: 'http://x' }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('flag-invalid') });
        expect(runChangeNew(repo.root, 'ok', { model: 'a\nb' }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('flag-invalid') });
        expect(runChangeNew(repo.root, 'ok', { plan: 'docs/plans/missing.md' }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('flag-invalid') });
        if (process.platform !== 'win32') {
            const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-out-'));
            fs.mkdirSync(path.join(repo.root, 'docs'), { recursive: true });
            fs.symlinkSync(outside, path.join(repo.root, 'docs', 'changes'));
            expect(runChangeNew(repo.root, 'ok', {}, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('unsafe-path') });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
    test('R3.2 surfaces base-unresolved', () => {
        receiptForHead();
        expect(runChangeNew(repo.root, 'ok', { base: 'nope' }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('base-unresolved') });
    });
});
```

- [ ] **Step 2: Run CMD-T-NEW.** Expected: it fails with "Cannot find module '…/commands/change'".

- [ ] **Step 3: Create `cli/src/core/changes/render.ts`:**

```ts
import yaml from 'js-yaml';
import { loadFrontmatter, splitRecord } from './parse';
import { BODY_HEADINGS, PENDING_MARKER, RECORD_SCHEMA, type DerivedFields, type Verification } from './types';

const DUMP = { lineWidth: -1, noRefs: true, sortKeys: false } as const;
const REPLACED = ['type', 'scope', 'semver', 'breaking', 'modules', 'verification'] as const;

export interface SkeletonInput {
    id: string;
    fields: DerivedFields;
    verification: Verification;
    links?: { plan?: string; issue?: string };
    provenance?: Record<string, string>;
}

export function renderSkeleton(input: SkeletonInput): string {
    const front: Record<string, unknown> = {
        schema: RECORD_SCHEMA,
        id: input.id,
        title: PENDING_MARKER,
        summary_short: PENDING_MARKER,
        ...input.fields,
    };
    if (input.links && Object.keys(input.links).length > 0) front.links = input.links;
    front.verification = input.verification;
    front.manual_validation = [{ step: PENDING_MARKER, expected: PENDING_MARKER }];
    front.risks = [PENDING_MARKER];
    front.rollback = PENDING_MARKER;
    if (input.provenance && Object.keys(input.provenance).length > 0) front.provenance = input.provenance;
    const body = BODY_HEADINGS.map((h) => `${h}\n\n${PENDING_MARKER}\n`).join('\n');
    return `---\n${yaml.dump(front, DUMP)}---\n\n${body}`;
}

/** R3.11: replaces only the top-level blocks of derived keys + verification; every other byte is preserved. Null when unparseable or a key is missing. */
export function refreshDerived(raw: string, fields: DerivedFields, verification: Verification): string | null {
    const split = splitRecord(raw);
    if (!split.ok || !loadFrontmatter(split.frontmatterText).ok) return null;
    const lines = split.frontmatterText.split('\n');
    const starts = lines.map((l, i) => (/^[A-Za-z_][A-Za-z0-9_]*:/.test(l) ? i : -1)).filter((i) => i >= 0);
    const fresh: Record<string, unknown> = { ...fields, verification };
    const seen = new Set<string>();
    const out: string[] = [];
    starts.forEach((start, n) => {
        const end = starts[n + 1] ?? lines.length;
        const key = lines[start].slice(0, lines[start].indexOf(':'));
        if ((REPLACED as readonly string[]).includes(key)) {
            seen.add(key);
            out.push(yaml.dump({ [key]: fresh[key] }, DUMP).replace(/\n$/, ''));
        } else {
            out.push(lines.slice(start, end).join('\n'));
        }
    });
    if (starts[0] !== 0 || REPLACED.some((k) => !seen.has(k))) return null;
    const crlf = raw.includes('\r\n');
    const rebuilt = `---\n${out.join('\n')}\n---\n${split.body}`;
    return crlf ? rebuilt.replace(/\n/g, '\r\n') : rebuilt;
}
```

- [ ] **Step 4: Create `cli/src/commands/change/index.ts`.** The `new` part follows. S5 appends `runChangeValidate` and the `validate` subcommand.

```ts
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { emit, type CommandResult } from '../../core/command-result';
import { sanitizeDiagnosticText } from '../../core/text';
import { readJournal } from '../../core/journal/store';
import { detectBranch } from '../../core/ledger/store';
import { isValidSlug, RECORD_FILE_RE } from '../../core/changes/parse';
import { headSha, isDirtyOutside, mergeBase, repoRoot, resolveBase } from '../../core/changes/git';
import { deriveFields } from '../../core/changes/derive';
import { readReceipt } from '../../core/changes/receipt';
import { refreshDerived, renderSkeleton } from '../../core/changes/render';
import { RECORD_DIR, type Verification } from '../../core/changes/types';

export interface ChangeDeps { now?: () => Date }
export interface NewOpts { base?: string; plan?: string; issue?: string; model?: string; session?: string; refresh?: boolean }

const fail = (code: string, message: string, remedy?: string): CommandResult => ({
    code: 2, stdout: '',
    stderr: `${code}: ${sanitizeDiagnosticText(message)}${remedy ? `\n  remedy: ${sanitizeDiagnosticText(remedy)}` : ''}\n`,
});

function flagError(opts: NewOpts, root: string): string | null {
    for (const key of ['model', 'session'] as const) {
        const v = opts[key];
        if (v !== undefined && (v.trim() === '' || v.length > 200 || /[\r\n\0]/.test(v))) return `--${key} must be a single line of at most 200 characters`;
    }
    if (opts.issue !== undefined) {
        let ok = false;
        try { ok = new URL(opts.issue).protocol === 'https:'; } catch { ok = false; }
        if (!ok) return '--issue must be an https URL';
    }
    if (opts.plan !== undefined) {
        const p = opts.plan;
        const safe = p !== '' && !path.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
        let exists = false;
        try { exists = safe && fs.lstatSync(path.join(root, p)).isFile(); } catch { exists = false; }
        if (!exists) return '--plan must be an existing repo-relative file';
    }
    return null;
}

/** Refuses symlinked `docs` or `docs/changes`; creates the directory when absent. */
function ensureRecordDir(root: string): string | null {
    let current = root;
    for (const segment of RECORD_DIR.split('/')) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) return null;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    fs.mkdirSync(path.join(root, RECORD_DIR), { recursive: true });
    return path.join(root, RECORD_DIR);
}

function findBySlug(dir: string, slug: string): string[] {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((n) => RECORD_FILE_RE.exec(n)?.[4] === slug);
}

function provenance(root: string, opts: NewOpts): Record<string, string> {
    const out: Record<string, string> = {};
    const read = readJournal(root, detectBranch(root));
    if (read.state) {
        if (read.state.admissionContext?.provider) out.agent = read.state.admissionContext.provider;
        if (read.state.cycle?.startedAt) out.started_at = read.state.cycle.startedAt;
        if (read.state.cycle?.completedAt) out.finished_at = read.state.cycle.completedAt;
    }
    if (opts.model) out.model = opts.model;
    if (opts.session) out.session = opts.session;
    return out;
}

export function runChangeNew(cwd: string, slug: string, opts: NewOpts, deps: ChangeDeps = {}): CommandResult {
    if (!isValidSlug(slug)) return fail('slug-invalid', `slug "${slug}" must match [a-z0-9]+(-[a-z0-9]+)* and be at most 64 characters`);
    let root: string;
    try { root = repoRoot(cwd); } catch { return fail('not-a-git-repo', 'awm change must run inside a git repository'); }
    const flag = flagError(opts, root);
    if (flag) return fail('flag-invalid', flag);
    const base = resolveBase(root, opts.base);
    if (!base) return fail('base-unresolved', 'could not resolve a base branch', 'pass --base <ref>');
    const derived = deriveFields(root, mergeBase(root, base));
    if (!derived.ok) return fail(derived.diagnostic.code, derived.diagnostic.message);
    if (isDirtyOutside(root, ['.awm', RECORD_DIR])) return fail('tree-dirty', 'working tree has uncommitted changes outside docs/changes/', 'commit your work, then run awm sensors run');
    const head = headSha(root);
    const receipt = readReceipt(root, head);
    if (!receipt.ok) return fail(receipt.code, `no valid sensor receipt for HEAD ${head.slice(0, 12)}`, 'commit your work, then run awm sensors run');
    const verification: Verification = { commit: receipt.receipt.commit, overall: receipt.receipt.overall, sensors: receipt.receipt.sensors, receipt_digest: receipt.receipt.digest };
    const dir = ensureRecordDir(root);
    if (!dir) return fail('unsafe-path', `${RECORD_DIR} or its parent is a symlink; refusing to write`);
    const existing = findBySlug(dir, slug);

    if (opts.refresh) {
        if (existing.length !== 1) return fail('record-missing', `expected exactly one record for slug "${slug}", found ${existing.length}`);
        const target = path.join(dir, existing[0]);
        if (fs.lstatSync(target).isSymbolicLink()) return fail('unsafe-path', `${existing[0]} is a symlink; refusing to write`);
        const next = refreshDerived(fs.readFileSync(target, 'utf8'), derived.fields, verification);
        if (next === null) return fail('record-invalid', `${existing[0]} has unparseable frontmatter or misses a derived key`);
        fs.writeFileSync(target, next);
        return { code: 0, stdout: `Refreshed ${RECORD_DIR}/${existing[0]}\n`, stderr: '' };
    }

    if (existing.length > 0) return fail('record-exists', `a record for slug "${slug}" already exists (${existing[0]})`, 'use --refresh to update derived fields');
    const date = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
    const id = `${date}-${slug}`;
    const links: { plan?: string; issue?: string } = {};
    if (opts.plan) links.plan = opts.plan;
    if (opts.issue) links.issue = opts.issue;
    const content = renderSkeleton({ id, fields: derived.fields, verification, links, provenance: provenance(root, opts) });
    fs.writeFileSync(path.join(dir, `${id}.md`), content, { flag: 'wx' });
    return { code: 0, stdout: `Created ${RECORD_DIR}/${id}.md\n`, stderr: '' };
}

export function registerChangeCommand(program: Command, deps: ChangeDeps = {}): void {
    const change = program.command('change').description('create and validate the Change Record of the current branch');
    change
        .command('new <slug>')
        .description('create docs/changes/YYYY-MM-DD-<slug>.md with derived fields and pending narrative')
        .option('--base <ref>', 'base branch (default: origin/HEAD, main, master)')
        .option('--plan <path>', 'repo-relative plan file to link')
        .option('--issue <url>', 'https issue URL to link')
        .option('--model <model>', 'provenance: model identifier')
        .option('--session <session>', 'provenance: session id or URL (avoid internal URLs in public repos)')
        .option('--refresh', 'recompute only derived fields and verification of the existing record')
        .action((slug: string, opts: NewOpts) => emit(runChangeNew(process.cwd(), slug, opts, deps)));
}
```

- [ ] **Step 5: Register the command in `cli/src/index.ts`.**
  - Next to the other command imports, add `import { registerChangeCommand } from './commands/change';`.
  - Immediately after `registerEvidenceCommand(program);`, add `registerChangeCommand(program);`.

- [ ] **Step 6: Run CMD-T-NEW.** Expected: PASS (8 tests). Then run CMD-TYPECHECK. Expected: exit 0.

- [ ] **Step 7: Commit.** `git add cli/src/core/changes/render.ts cli/src/commands/change cli/src/index.ts cli/tests/commands/change/new.test.ts && git commit -m "feat(changes): awm change new"`

#### Edge cases
- **Write safety:** the slug is validated before any path is built. A symlinked `docs` or `docs/changes` is refused. New records are written with the `wx` flag, so a race never overwrites. A refresh target that is a symlink is refused.
- **Refresh scope (R3.11):** refresh fails with `record-invalid` when the YAML is unparseable or any of the six replaced keys is missing. CRLF files keep CRLF.
- **Flag validation:** `--model` and `--session` reject line breaks, NUL and more than 200 characters. `--issue` must be https. `--plan` must be an existing, contained regular file.
- **Provenance (R3.8):** keys without a source are omitted. A corrupt or absent journal yields no journal-derived keys and is never an error.

#### Evidence
- **Sources:** SRC-CMD-RESULT, SRC-JOURNAL, SRC-BRANCH, SRC-INDEX, SRC-TEST-ISOLATION.
- **Commands:** CMD-T-NEW goes RED then GREEN. CMD-TYPECHECK passes.
- **Review:** the reviewer confirms the byte-preservation assertion in the R3.11 test.

#### Fallback
- **Trigger:** if js-yaml dumps a nested sequence at column 0 (so that `refreshDerived` block detection splits it wrongly), stop.
- **Durable amendment:** amend the block detection to treat lines starting with `- ` or whitespace as continuation (already the case: only `^[A-Za-z_]` starts a block). Add a regression test with a column-0 list.

<a id="slice-s5"></a>
### Slice S5: awm change validate

#### Surfaces
**Owns R4.1–R4.6.** These are grouped because the base checks, the strict checks and the output are one read-only gate.

**Files:**
- Modify `cli/src/commands/change/index.ts`: append the validate code and register the subcommand
- Create `cli/tests/commands/change/validate.test.ts`

**Interface:**
- `runChangeValidate(cwd, target, opts) => CommandResult`

#### Implementation
**Dependencies:** S1–S4.

- [ ] **Step 1: Write the failing test** `cli/tests/commands/change/validate.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { makeRepo, type TestRepo } from '../../core/changes/helpers';
import { runChangeNew, runChangeValidate } from '../../../src/commands/change';
import { buildReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { PENDING_MARKER } from '../../../src/core/changes/types';

let repo: TestRepo;
const now = () => new Date('2026-10-17T12:00:00.000Z');
const rel = 'docs/changes/2026-10-17-rec.md';
function receipt(overall: 'pass' | 'fail' = 'pass'): void {
    writeReceipt(repo.root, buildReceipt({ commit: repo.git('rev-parse', 'HEAD'), ranAt: '2026-10-17T11:00:00.000Z', cliVersion: '9.20.0', output: { overall, sensors: [{ name: 'lint', status: overall, errors: [] }] } as never }));
}
function writeAndCommitRecord(): void {
    expect(runChangeNew(repo.root, 'rec', {}, { now }).code).toBe(0);
    const p = path.join(repo.root, rel);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split(PENDING_MARKER).join('filled'));
    repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): record');
}
const json = (r: { stdout: string }) => JSON.parse(r.stdout);
beforeEach(() => {
    repo = makeRepo();
    repo.git('checkout', '-q', '-b', 'feat/x');
    repo.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): a');
});
afterEach(() => repo.cleanup());

describe('awm change validate', () => {
    test('R4.2 missing record fails; opt-out trailer passes as exempt', () => {
        expect(json(runChangeValidate(repo.root, undefined, { json: true }))).toMatchObject({ state: 'invalid', records: [{ diagnostics: [expect.objectContaining({ code: 'record-missing' })] }] });
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        const r = runChangeValidate(repo.root, undefined, { json: true });
        expect(r.code).toBe(0);
        expect(json(r).state).toBe('exempt');
    });
    test('R4.1/R4.3 a filled record passes base and strict', () => {
        receipt();
        writeAndCommitRecord();
        expect(runChangeValidate(repo.root, undefined, {}).code).toBe(0);
        expect(runChangeValidate(repo.root, undefined, { strict: true }).code).toBe(0);
        expect(runChangeValidate(repo.root, rel, { strict: true }).code).toBe(0);
    });
    test('R4.3 detects code changed after verification and derived drift', () => {
        receipt();
        writeAndCommitRecord();
        repo.commit({ 'cli/src/core/late.ts': '1' }, 'feat(core): late');
        const out = json(runChangeValidate(repo.root, undefined, { json: true }));
        const c = out.records[0].diagnostics.map((d: { code: string }) => d.code);
        expect(c).toContain('code-changed-after-verification');
        expect(c).toContain('derived-mismatch');
    });
    test('R4.3 foreign verification commit', () => {
        receipt();
        writeAndCommitRecord();
        const p = path.join(repo.root, rel);
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/commit: [0-9a-f]{40}/, `commit: ${'e'.repeat(40)}`));
        const c = json(runChangeValidate(repo.root, rel, { json: true })).records[0].diagnostics.map((d: { code: string }) => d.code);
        expect(c).toContain('verification-commit-foreign');
    });
    test('R4.4 strict requires a matching passing receipt', () => {
        receipt('fail');
        writeAndCommitRecord();
        expect(runChangeValidate(repo.root, undefined, {}).code).toBe(0);
        const strict = json(runChangeValidate(repo.root, undefined, { strict: true, json: true }));
        expect(strict.records[0].diagnostics.map((d: { code: string }) => d.code)).toContain('verification-not-passing');
        fs.rmSync(path.join(repo.root, '.awm', 'sensors', 'runs'), { recursive: true, force: true });
        const gone = json(runChangeValidate(repo.root, undefined, { strict: true, json: true }));
        expect(gone.records[0].diagnostics.map((d: { code: string }) => d.code)).toContain('receipt-missing');
    });
    test('R4.4 strict detects a record verification block that does not match the receipt', () => {
        receipt();
        writeAndCommitRecord();
        const p = path.join(repo.root, rel);
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('lint: pass', 'lint: fail'));
        const c = json(runChangeValidate(repo.root, rel, { strict: true, json: true })).records[0].diagnostics.map((d: { code: string }) => d.code);
        expect(c).toContain('verification-mismatch');
    });
    test('R4.5 text output, exit codes and diagnostic cap', () => {
        const r = runChangeValidate(repo.root, undefined, {});
        expect(r.code).toBe(2);
        expect(r.stdout).toMatch(/^Change Record validation: invalid/);
    });
    test('R4.6 validate writes nothing', () => {
        receipt();
        writeAndCommitRecord();
        const before = repo.git('status', '--porcelain', '--ignored');
        runChangeValidate(repo.root, undefined, { strict: true });
        expect(repo.git('status', '--porcelain', '--ignored')).toBe(before);
    });
    test('rejects a path outside docs/changes', () => {
        expect(runChangeValidate(repo.root, '../x.md', {})).toMatchObject({ code: 2, stderr: expect.stringContaining('path-invalid') });
    });
});
```

- [ ] **Step 2: Run CMD-T-VALIDATE.** Expected: it fails with "runChangeValidate is not a function" (TypeScript import error).

- [ ] **Step 3: Append to `cli/src/commands/change/index.ts`.** Add these imports at the top: `import { changedFiles, git, isAncestor } from '../../core/changes/git';` (merge them with the existing git import line), `import { hasOptOut } from '../../core/changes/trailers';` and `import { validateRecordShape } from '../../core/changes/validate-shape';`. Also add `type Diagnostic` and `DERIVED_KEYS` to the types import. Then append:

```ts
export interface ValidateOpts { base?: string; strict?: boolean; json?: boolean }
interface RecordReport { path: string; state: 'valid' | 'invalid'; diagnostics: Diagnostic[] }

const MAX_DIAGNOSTICS = 20;

function validateOne(root: string, rel: string, mb: string, strict: boolean): RecordReport {
    const diagnostics: Diagnostic[] = [];
    const abs = path.join(root, rel);
    let raw: string | null = null;
    try { raw = fs.lstatSync(abs).isFile() ? fs.readFileSync(abs, 'utf8') : null; } catch { raw = null; }
    if (raw === null) return { path: rel, state: 'invalid', diagnostics: [{ code: 'record-missing', message: `${rel} is not a regular file` }] };
    const shape = validateRecordShape(path.basename(rel), raw, { root });
    diagnostics.push(...shape.diagnostics);
    const record = shape.record;
    if (record) {
        const derived = deriveFields(root, mb);
        if (!derived.ok) diagnostics.push(derived.diagnostic);
        else for (const key of DERIVED_KEYS) {
            if (JSON.stringify(derived.fields[key]) !== JSON.stringify(record[key])) {
                diagnostics.push({ code: 'derived-mismatch', field: key, message: `${key} is ${JSON.stringify(record[key])} but git derives ${JSON.stringify(derived.fields[key])}` });
            }
        }
        const commit = record.verification.commit;
        if (!isAncestor(root, commit, 'HEAD')) {
            diagnostics.push({ code: 'verification-commit-foreign', field: 'verification.commit', message: `${commit.slice(0, 12)} is not HEAD or an ancestor of HEAD` });
        } else {
            const late = changedFiles(root, commit, 'HEAD').filter((f) => !f.startsWith('docs/changes/'));
            if (late.length > 0) diagnostics.push({ code: 'code-changed-after-verification', message: `files changed after the verified commit: ${late.slice(0, 20).join(', ')}${late.length > 20 ? ', …' : ''}` });
        }
        if (strict) {
            const receipt = readReceipt(root, commit);
            if (!receipt.ok) diagnostics.push({ code: receipt.code, message: `no valid sensor receipt for ${commit.slice(0, 12)}; run awm sensors run on that commit` });
            else {
                const r = receipt.receipt;
                if (r.digest !== record.verification.receipt_digest || r.overall !== record.verification.overall
                    || JSON.stringify(r.sensors) !== JSON.stringify(Object.fromEntries(Object.entries(record.verification.sensors).sort(([a], [b]) => a.localeCompare(b))))) {
                    diagnostics.push({ code: 'verification-mismatch', field: 'verification', message: 'verification block does not match the sensor receipt' });
                }
                if (r.overall !== 'pass') diagnostics.push({ code: 'verification-not-passing', field: 'verification.overall', message: `sensor verdict is ${r.overall}, not pass` });
            }
        }
    }
    return { path: rel, state: diagnostics.length === 0 ? 'valid' : 'invalid', diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) };
}

function addedRecords(root: string, mb: string): string[] {
    return git(root, ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=A', '--end-of-options', mb, 'HEAD', '--', RECORD_DIR])
        .split('\0').filter((f) => f && RECORD_FILE_RE.test(path.posix.basename(f)) && path.posix.dirname(f) === RECORD_DIR);
}

function formatText(state: string, records: RecordReport[]): string {
    const lines = [`Change Record validation: ${state}`];
    for (const r of records) {
        lines.push(`- ${sanitizeDiagnosticText(r.path)}: ${r.state}`);
        for (const d of r.diagnostics) lines.push(`  - ${sanitizeDiagnosticText(d.code)}${d.field ? ` (${sanitizeDiagnosticText(d.field)})` : ''}: ${sanitizeDiagnosticText(d.message)}`);
    }
    return lines.join('\n') + '\n';
}

export function runChangeValidate(cwd: string, target: string | undefined, opts: ValidateOpts): CommandResult {
    let root: string;
    try { root = repoRoot(cwd); } catch { return fail('not-a-git-repo', 'awm change must run inside a git repository'); }
    const base = resolveBase(root, opts.base);
    if (!base) return fail('base-unresolved', 'could not resolve a base branch', 'pass --base <ref>');
    const mb = mergeBase(root, base);
    let state: 'valid' | 'invalid' | 'exempt';
    let records: RecordReport[];
    if (target !== undefined) {
        const relTarget = target.replace(/\\/g, '/');
        if (path.posix.dirname(relTarget) !== RECORD_DIR || !RECORD_FILE_RE.test(path.posix.basename(relTarget))) {
            return fail('path-invalid', `${target} must be ${RECORD_DIR}/YYYY-MM-DD-<slug>.md`);
        }
        records = [validateOne(root, relTarget, mb, Boolean(opts.strict))];
    } else {
        const added = addedRecords(root, mb);
        if (added.length === 0) {
            if (hasOptOut(root, [`${mb}..HEAD`])) {
                state = 'exempt';
                records = [];
                const payload = { state, records };
                return { code: 0, stdout: opts.json ? JSON.stringify(payload) + '\n' : 'Change Record validation: exempt (Change-Record: none)\n', stderr: '' };
            }
            records = [{ path: RECORD_DIR, state: 'invalid', diagnostics: [{ code: 'record-missing', message: 'this branch adds no Change Record and no commit carries Change-Record: none' }] }];
        } else {
            records = added.map((rel) => validateOne(root, rel, mb, Boolean(opts.strict)));
        }
    }
    state = records.every((r) => r.state === 'valid') ? 'valid' : 'invalid';
    const stdout = opts.json ? JSON.stringify({ state, records }) + '\n' : formatText(state, records);
    return { code: state === 'valid' ? 0 : 2, stdout, stderr: '' };
}
```

  In `registerChangeCommand`, after the `new` subcommand, add:

```ts
    change
        .command('validate [path]')
        .description('validate the Change Record(s) added by this branch (--strict also checks the sensor receipt)')
        .option('--base <ref>', 'base branch (default: origin/HEAD, main, master)')
        .option('--strict', 'require a matching, passing sensor receipt for verification.commit')
        .option('--json', 'emit a single JSON line')
        .action((target: string | undefined, opts: ValidateOpts) => emit(runChangeValidate(process.cwd(), target, opts)));
```

- [ ] **Step 4: Run CMD-T-VALIDATE.** Expected: PASS (9 tests). Re-run CMD-T-NEW. Expected: still PASS. Then run CMD-TYPECHECK. Expected: exit 0.

- [ ] **Step 5: Commit.** `git add cli/src/commands/change/index.ts cli/tests/commands/change/validate.test.ts && git commit -m "feat(changes): awm change validate with strict receipt gate"`

#### Edge cases
- **Target paths:** an explicit target outside `docs/changes/` or with a bad name yields `path-invalid`, and nothing is read. A symlinked or missing record file yields `record-missing`.
- **Diagnostic bounds:** diagnostics are capped at 20 per record, and the late-changed file list at 20. Every printed string passes through `sanitizeDiagnosticText`.
- **Unknown commits:** `isAncestor` with an unknown commit returns false, which yields `verification-commit-foreign` with no throw.
- **Read-only (R4.6):** `validate` never writes. The R4.6 test asserts that `git status --ignored` is unchanged.

#### Evidence
- **Sources:** SRC-CMD-RESULT, SRC-TEXT, SRC-TEST-ISOLATION.
- **Commands:** CMD-T-VALIDATE goes RED then GREEN. CMD-T-NEW stays green.
- **Review:** the reviewer maps each diagnostic code to R4.2–R4.4.

#### Fallback
- **Trigger:** if sensor-name ordering differs between the receipt (sorted) and a hand-edited record, normalization by sorting is already applied, so this is not a failure.
- **Other unexpected git-diff semantics on Windows paths:** stop and amend with a normalized-path fix plus a test under full context.

<a id="slice-s6"></a>
### Slice S6: awm changes list

#### Surfaces
**Owns R5.1–R5.7.** These are grouped because classification, derivation and the three renderings form one read-only query surface.

**Files:**
- Create `cli/src/core/changes/list.ts`
- Create `cli/src/core/changes/render-list.ts`
- Create `cli/src/commands/changes/index.ts`
- Modify `cli/src/index.ts`
- Create `cli/tests/commands/changes/list.test.ts`

**Interfaces:**
- `parseSince(value, now)`
- `listChanges(root, opts)`
- `renderText/renderJson/renderVoice(result)`
- `runChangesList(cwd, opts, deps)`
- `registerChangesCommand(program, deps?)`

#### Implementation
**Dependencies:** S1, S3.

- [ ] **Step 1: Write the failing test** `cli/tests/commands/changes/list.test.ts`:

```ts
import { makeRepo, type TestRepo } from '../../core/changes/helpers';
import { runChangesList } from '../../../src/commands/changes';
import { parseSince } from '../../../src/core/changes/list';

const SHA = 'a'.repeat(40);
const RECORD = (id: string, summary: string) => `---
schema: awm.change-record/v1
id: ${id}
title: "T ${id}"
summary_short: "${summary}"
type: feat
scope: null
semver: minor
breaking: false
modules: [cli]
verification:
  commit: ${SHA}
  overall: pass
  sensors: { lint: pass }
  receipt_digest: sha256:${'b'.repeat(64)}
manual_validation:
  - step: s1
    expected: e1
  - step: s2
    expected: e2
risks: []
rollback: revert
---
## Qué se hizo
a
## Qué se probó
b
## Qué falta validar
c
## Riesgos y rollback
d
`;
let repo: TestRepo;
const now = () => new Date('2026-10-17T12:00:00Z');
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

function history(): void {
    repo.commit({ 'old.ts': '1' }, 'feat: before adoption', '2026-10-16T09:00:00Z');
    repo.commit({ 'docs/changes/2026-10-16-first.md': RECORD('2026-10-16-first', 'Primer cambio.'), 'a.ts': '1' }, 'feat: first (#10)', '2026-10-16T20:00:00Z');
    repo.commit({ 'b.ts': '1' }, 'fix: no record', '2026-10-16T21:00:00Z');
    repo.commit({ 'c.ts': '1' }, 'chore(release): v1.0.0 [skip ci]\n\nChange-Record: none', '2026-10-16T22:00:00Z');
    repo.commit({ 'docs/changes/2026-10-17-bad.md': '---\nschema: nope\n---\n' }, 'feat: bad record', '2026-10-17T01:00:00Z');
    repo.git('tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
}

describe('awm changes list', () => {
    test('R5.2 parses --since', () => {
        expect(parseSince('24h', now())?.toISOString()).toBe('2026-10-16T12:00:00.000Z');
        expect(parseSince('7d', now())?.toISOString()).toBe('2026-10-10T12:00:00.000Z');
        expect(parseSince('2026-10-01', now())?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
        expect(parseSince('0h', now())).toBeNull();
        expect(parseSince('soon', now())).toBeNull();
        expect(runChangesList(repo.root, { since: 'soon' }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('since-invalid') });
    });
    test('R5.4 a repo without records reports non-adoption and exits 0', () => {
        const r = runChangesList(repo.root, {}, { now });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/not adopted Change Records/);
    });
    test('R5.1/R5.3/R5.4/R5.5 classifies and derives', () => {
        history();
        const out = JSON.parse(runChangesList(repo.root, { since: '48h', format: 'json' }, { now }).stdout);
        const byClass = Object.fromEntries(out.changes.map((c: { subject: string; classification: string }) => [c.subject, c.classification]));
        expect(byClass).toEqual({ 'feat: first (#10)': 'recorded', 'fix: no record': 'missing', 'chore(release): v1.0.0 [skip ci]': 'exempt', 'feat: bad record': 'invalid-record' });
        const first = out.changes.find((c: { subject: string }) => c.subject === 'feat: first (#10)');
        expect(first).toMatchObject({ pr: 10, release: 'v1.0.0', merged_at: '2026-10-16T20:00:00.000Z' });
        expect(first.records[0]).toMatchObject({ path: 'docs/changes/2026-10-16-first.md', summary_short: 'Primer cambio.' });
        expect(out.repo).toBeNull();
    });
    test('R5.5 repo identity strips credentials', () => {
        history();
        repo.git('remote', 'add', 'origin', 'https://user:tok@github.com/Kodria/belanz.git');
        const out = JSON.parse(runChangesList(repo.root, { since: '48h', format: 'json' }, { now }).stdout);
        expect(out.repo).toBe('github.com/Kodria/belanz');
        expect(JSON.stringify(out)).not.toContain('tok');
    });
    test('R5.6 voice format', () => {
        history();
        const r = runChangesList(repo.root, { since: '48h', format: 'voice' }, { now });
        expect(r.stdout).toContain('Primer cambio. feat, verificado, 2 validaciones manuales pendientes.');
        expect(r.stdout).toMatch(/1 cambio\(s\) sin record y 1 con record inválido/);
    });
    test('R5.6 text format and invalid format', () => {
        history();
        expect(runChangesList(repo.root, { since: '48h' }, { now }).stdout).toMatch(/recorded/);
        expect(runChangesList(repo.root, { format: 'xml' }, { now })).toMatchObject({ code: 2, stderr: expect.stringContaining('format-invalid') });
    });
    test('R5.7 read-only and bounded', () => {
        history();
        const before = repo.git('status', '--porcelain', '--ignored');
        runChangesList(repo.root, { since: '48h', format: 'json' }, { now, limit: 2 });
        expect(repo.git('status', '--porcelain', '--ignored')).toBe(before);
        const out = JSON.parse(runChangesList(repo.root, { since: '48h', format: 'json' }, { now, limit: 2 }).stdout);
        expect(out.truncated).toBe(true);
        expect(out.changes).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Run CMD-T-LIST.** Expected: it fails with "Cannot find module '…/commands/changes'".

- [ ] **Step 3: Create `cli/src/core/changes/list.ts`:**

```ts
import path from 'path';
import { git, repoIdentity, tryGit } from './git';
import { hasOptOut } from './trailers';
import { RECORD_FILE_RE } from './parse';
import { validateRecordShape } from './validate-shape';
import { RECORD_DIR, type ChangeRecord, type Diagnostic } from './types';

export const DEFAULT_LIMIT = 200;
export type Classification = 'recorded' | 'invalid-record' | 'exempt' | 'missing';

export interface ListedRecord extends Partial<ChangeRecord> { path: string; diagnostics?: Diagnostic[] }
export interface ListedChange {
    sha: string;
    subject: string;
    classification: Classification;
    merged_at: string;
    pr: number | null;
    release: string | null;
    records: ListedRecord[];
}
export interface ListResult { repo: string | null; base: string; since: string; adopted: boolean; truncated: boolean; changes: ListedChange[] }

export function parseSince(value: string, now: Date): Date | null {
    const rel = /^(\d{1,4})([hd])$/.exec(value);
    if (rel) {
        const n = Number(rel[1]);
        if (n <= 0 || (rel[2] === 'd' && n > 3650) || (rel[2] === 'h' && n > 87600)) return null;
        return new Date(now.getTime() - n * (rel[2] === 'h' ? 3600e3 : 86400e3));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null;
    }
    return null;
}

function revArgsFor(root: string, sha: string): { revArgs: string[]; parent: string | null } {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', '--end-of-options', sha]).trim().split(' ').slice(1);
    if (parents.length > 1) return { revArgs: [`${sha}^1..${sha}`], parent: parents[0] };
    return { revArgs: ['-1', sha], parent: parents[0] ?? null };
}

function addedRecordPaths(root: string, sha: string, parent: string | null): string[] {
    const out = parent
        ? git(root, ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=A', '--end-of-options', parent, sha, '--', RECORD_DIR])
        : git(root, ['diff-tree', '--root', '-r', '--no-commit-id', '--name-only', '-z', '--diff-filter=A', '--end-of-options', sha, '--', RECORD_DIR]);
    return out.split('\0').filter((f) => f && path.posix.dirname(f) === RECORD_DIR && RECORD_FILE_RE.test(path.posix.basename(f)));
}

function earliestTag(root: string, sha: string): string | null {
    const out = tryGit(root, ['tag', '--contains', sha, '--sort=creatordate']);
    return out?.split('\n').map((s) => s.trim()).find(Boolean) ?? null;
}

export function listChanges(root: string, opts: { base: string; since: Date; limit?: number }): ListResult {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const result: ListResult = { repo: repoIdentity(root), base: opts.base, since: opts.since.toISOString(), adopted: false, truncated: false, changes: [] };
    const adoption = git(root, ['log', '--diff-filter=A', '--format=%H', '--reverse', '--end-of-options', opts.base, '--', RECORD_DIR]).split('\n').find(Boolean);
    if (!adoption) return result;
    result.adopted = true;
    const raw = git(root, ['log', '--first-parent', `--since=@${Math.floor(opts.since.getTime() / 1000)}`, '-n', String(limit + 1), '--format=%H%x1f%ct%x1f%s%x1e', '--end-of-options', opts.base]);
    const rows = raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => r.split('\x1f'));
    if (rows.length > limit) { result.truncated = true; rows.length = limit; }
    for (const [sha, ct, subject] of rows) {
        if (tryGit(root, ['merge-base', '--is-ancestor', adoption, sha]) === null) continue; // pre-adoption
        const { revArgs, parent } = revArgsFor(root, sha);
        const records: ListedRecord[] = addedRecordPaths(root, sha, parent).map((rel) => {
            const text = git(root, ['show', `${sha}:${rel}`]);
            const shape = validateRecordShape(path.posix.basename(rel), text);
            return shape.record ? { path: rel, ...shape.record } : { path: rel, diagnostics: shape.diagnostics.slice(0, 20) };
        });
        let classification: Classification;
        if (records.length > 0) classification = records.every((r) => !r.diagnostics) ? 'recorded' : 'invalid-record';
        else classification = hasOptOut(root, revArgs) ? 'exempt' : 'missing';
        const pr = /\(#(\d+)\)\s*$/.exec(subject);
        result.changes.push({
            sha, subject, classification,
            merged_at: new Date(Number(ct) * 1000).toISOString(),
            pr: pr ? Number(pr[1]) : null,
            release: earliestTag(root, sha),
            records,
        });
    }
    return result;
}
```

- [ ] **Step 4: Create `cli/src/core/changes/render-list.ts`:**

```ts
import { sanitizeDiagnosticText } from '../text';
import type { ListResult } from './list';

const clean = (s: unknown) => sanitizeDiagnosticText(String(s ?? ''));

export function repoName(result: ListResult, fallback: string): string {
    return clean(result.repo?.split('/').pop() ?? fallback);
}

export function renderJson(result: ListResult): string {
    return JSON.stringify(result) + '\n';
}

export function renderText(result: ListResult, fallback: string): string {
    if (!result.adopted) return `${repoName(result, fallback)} has not adopted Change Records (no file under docs/changes/ on ${clean(result.base)}).\n`;
    if (result.changes.length === 0) return `No changes on ${clean(result.base)} since ${result.since}.\n`;
    const lines = result.changes.map((c) => {
        const title = c.records[0]?.title ?? c.subject;
        return `${c.merged_at.slice(0, 16).replace('T', ' ')}  ${c.classification.padEnd(14)} ${c.sha.slice(0, 8)}  ${clean(title)}${c.release ? `  [${clean(c.release)}]` : ''}`;
    });
    if (result.truncated) lines.push('… truncated: narrow --since to see older changes');
    return lines.join('\n') + '\n';
}

export function renderVoice(result: ListResult, fallback: string): string {
    const name = repoName(result, fallback);
    if (!result.adopted) return `${name}: todavía no usa Change Records.\n`;
    const sentences: string[] = [];
    for (const c of result.changes) {
        if (c.classification !== 'recorded') continue;
        for (const r of c.records) {
            const pending = Array.isArray(r.manual_validation) ? r.manual_validation.length : 0;
            const verified = r.verification?.overall === 'pass' ? 'verificado' : 'sin verificar';
            sentences.push(`${name}: ${clean(r.summary_short)} ${clean(r.type)}, ${verified}, ${pending} validaciones manuales pendientes.`);
        }
    }
    const missing = result.changes.filter((c) => c.classification === 'missing').length;
    const invalid = result.changes.filter((c) => c.classification === 'invalid-record').length;
    if (sentences.length === 0 && missing === 0 && invalid === 0) return `${name}: sin cambios desde ${result.since.slice(0, 10)}.\n`;
    if (missing > 0 || invalid > 0) sentences.push(`Además: ${missing} cambio(s) sin record y ${invalid} con record inválido.`);
    if (result.truncated) sentences.push('Hay más cambios; acota el período.');
    return sentences.join('\n') + '\n';
}
```

- [ ] **Step 5: Create `cli/src/commands/changes/index.ts`:**

```ts
import path from 'path';
import { Command } from 'commander';
import { emit, type CommandResult } from '../../core/command-result';
import { sanitizeDiagnosticText } from '../../core/text';
import { repoRoot, resolveBase } from '../../core/changes/git';
import { listChanges, parseSince } from '../../core/changes/list';
import { renderJson, renderText, renderVoice } from '../../core/changes/render-list';

export interface ChangesDeps { now?: () => Date; limit?: number }
export interface ListOpts { since?: string; base?: string; format?: string }

const fail = (code: string, message: string): CommandResult => ({ code: 2, stdout: '', stderr: `${code}: ${sanitizeDiagnosticText(message)}\n` });

export function runChangesList(cwd: string, opts: ListOpts, deps: ChangesDeps = {}): CommandResult {
    const format = opts.format ?? 'text';
    if (!['text', 'json', 'voice'].includes(format)) return fail('format-invalid', '--format must be text, json or voice');
    const since = parseSince(opts.since ?? '24h', (deps.now ?? (() => new Date()))());
    if (!since) return fail('since-invalid', '--since must be <n>h, <n>d or YYYY-MM-DD');
    let root: string;
    try { root = repoRoot(cwd); } catch { return fail('not-a-git-repo', 'awm changes must run inside a git repository'); }
    const base = resolveBase(root, opts.base);
    if (!base) return fail('base-unresolved', 'could not resolve a base branch; pass --base <ref>');
    const result = listChanges(root, { base, since, limit: deps.limit });
    const fallback = path.basename(root);
    const stdout = format === 'json' ? renderJson(result) : format === 'voice' ? renderVoice(result, fallback) : renderText(result, fallback);
    return { code: 0, stdout, stderr: '' };
}

export function registerChangesCommand(program: Command, deps: ChangesDeps = {}): void {
    const changes = program.command('changes').description('query Change Records merged into the base branch');
    changes
        .command('list')
        .description('list changes on the base branch with derived merge/release state')
        .option('--since <window>', '<n>h, <n>d or YYYY-MM-DD (default 24h)')
        .option('--base <ref>', 'base branch (default: origin/HEAD, main, master)')
        .option('--format <format>', 'text | json | voice (default text)')
        .action((opts: ListOpts) => emit(runChangesList(process.cwd(), opts, deps)));
}
```

- [ ] **Step 6: Register the command in `cli/src/index.ts`.** Add `import { registerChangesCommand } from './commands/changes';`, and add `registerChangesCommand(program);` right after `registerChangeCommand(program);`.

- [ ] **Step 7: Run CMD-T-LIST.** Expected: PASS (7 tests). Then run CMD-TYPECHECK. Expected: exit 0.

- [ ] **Step 8: Commit.** `git add cli/src/core/changes/{list,render-list}.ts cli/src/commands/changes cli/src/index.ts cli/tests/commands/changes/list.test.ts && git commit -m "feat(changes): awm changes list with text, json and voice formats"`

#### Edge cases
- **Read source:** records are read only through `git show <sha>:<path>` from the base history, never from the working tree.
- **Remote identity:** credentials in `remote.origin.url` never appear in output, because `repoIdentity` keeps only the host and path.
- **Window bounds:** `--since` is bounded (at most 3650 days or 87600 hours, `> 0`). Invalid calendar dates are rejected. The window is bounded by `limit` (200) plus a truncation flag.
- **Edge commits:** a root commit is handled through `diff-tree --root`. For merge commits, the commits are `sha^1..sha` for trailer detection.
- **Output safety:** all text and voice output passes through `sanitizeDiagnosticText`.

#### Evidence
- **Sources:** SRC-CMD-RESULT, SRC-TEXT, SRC-INDEX, SRC-TEST-ISOLATION.
- **Commands:** CMD-T-LIST goes RED then GREEN with a real history covering all four classifications plus pre-adoption.
- **Review:** the reviewer confirms that there are no writes and that the number of git calls per entry is bounded.

#### Fallback
- **Trigger:** if `git log --since=@<epoch>` is not honored on a platform, stop.
- **Durable amendment:** replace it with in-process filtering of `%ct` (already fetched), keeping `-n limit+1`. Record the deviation.

<a id="slice-s7"></a>
### Slice S7: Release commit opt-out trailer

#### Surfaces
**Owns R6.1.**

**Files:**
- Modify `cli/src/release/orchestrator.ts`, one call
- Modify `cli/tests/release/orchestrator.test.ts`, one assertion

This slice is isolated because it touches the publish pipeline (root-configuration risk).

#### Implementation
**Dependencies:** none functionally. It is ordered last so that the full suite closes the plan.

- [ ] **Step 1: Add the failing assertion.** In `cli/tests/release/orchestrator.test.ts`, in the test that contains `expect(joined).toMatch(/git commit .*chore\(release\): v2.2.0/);`, add on the next line:

```ts
    expect(joined).toMatch(/git commit .*chore\(release\): v2\.2\.0 \[skip ci\] -m Change-Record: none/);
```

- [ ] **Step 2: Run CMD-T-RELEASE.** Expected: the new assertion FAILS.

- [ ] **Step 3: Change the commit in `cli/src/release/orchestrator.ts`.** Replace

```ts
  io.run('git', ['commit', '-m', `chore(release): v${version} [skip ci]`]);
```

with

```ts
  // R6.1 (#217): the bump commit carries the Change Record opt-out trailer so
  // `awm changes list` reports it as `exempt`, never as `missing`.
  io.run('git', ['commit', '-m', `chore(release): v${version} [skip ci]`, '-m', 'Change-Record: none']);
```

- [ ] **Step 4: Run CMD-T-RELEASE.** Expected: PASS. If the joined log format renders arguments differently from `-m Change-Record: none`, adjust **only the test regex** to the observed join format. The orchestrator change stays as written.

- [ ] **Step 5: Run the closure commands.** CMD-TYPECHECK, CMD-LINT and CMD-TEST-ALL must all exit 0. Fix any lint finding in the files created by this plan.

- [ ] **Step 6: Commit.** `git add cli/src/release/orchestrator.ts cli/tests/release/orchestrator.test.ts && git commit -m "fix(release): mark the bump commit with Change-Record: none"`

#### Edge cases
- **Trailer form:** the second `-m` produces a separate paragraph, which makes it a git trailer. The `[skip ci]` subject is unchanged, so `release.yml` still does not re-trigger.

#### Evidence
- **Sources:** SRC-ORCH, SRC-ORCH-TEST.
- **Commands:** CMD-T-RELEASE goes RED then GREEN. The closure commands (CMD-TYPECHECK, CMD-LINT, CMD-TEST-ALL) all pass.
- **Review:** the reviewer confirms that the subject is byte-identical.

#### Fallback
- **Risk:** root-configuration, because this touches the publish pipeline.
- **Trigger:** if any release test relies on a single `-m`, update only that assertion with the owner's acknowledgement. Never change the subject or the `[skip ci]` marker.

## Traceability

| Req | Slice | Test |
|-----|-------|------|
| R1.1 | S1 | record.test "R1.1 rejects bad file names and slugs" |
| R1.2 | S1 | record.test "R1.2 requires frontmatter and rejects aliases and custom tags" |
| R1.3 | S1 | record.test "R1.3 rejects unknown fields at every level" |
| R1.4 | S1 | record.test "R1.4 enforces field rules", "R1.4 checks links.plan existence" |
| R1.5 | S1 | record.test "R1.5 enforces the verification block" |
| R1.6 | S1 | record.test "R1.6 requires the four body sections" |
| R1.7 | S1 | record.test "R1.7 rejects pending markers" |
| R1.8 | S1 | record.test "R1.8 rejects oversize files before parsing" |
| R2.1 | S2 | receipt.test "R2.1 full selection…", "R2.1 selection rules" |
| R2.2 | S2 | receipt.test "R2.2 dirty tree…", "R2.2 HEAD moving…", "R2.2 outside git…" |
| R2.3 | S2 | receipt.test "R2.3/R2.5 digest covers every field…" |
| R2.4 | S2 | existing `tests/commands/sensors` suite unchanged (Step 5) |
| R2.5 | S2 | receipt.test "R2.3/R2.5 … tampering invalidates" |
| R3.1 | S3 | derive.test "R3.1 resolves base…" |
| R3.2 | S3, S4 | derive.test "R3.2 unresolvable…"; new.test "R3.2 surfaces base-unresolved" |
| R3.3 | S3 | derive.test "R3.3 semver/type/breaking/scope rules", "R3.3/R3.4 deriveFields over a real range" |
| R3.4 | S3 | derive.test "R3.4 modules…" |
| R3.5 | S3 | derive.test "R3.5 no commits and no conventional commits fail" |
| R3.6 | S4 | new.test "R3.6 requires a receipt and a clean tree" |
| R3.7 | S4 | new.test "R3.7/R3.9 writes a skeleton…" |
| R3.8 | S4 | new.test "R3.7/R3.9 …" (model flag), "R3.8 provenance omits keys" |
| R3.9 | S4 | new.test "R3.7/R3.9 writes a skeleton…" |
| R3.10 | S4 | new.test "R3.10 refuses to overwrite…" |
| R3.11 | S4 | new.test "R3.11 refresh rewrites only derived…", "R3.11 refresh of a broken record fails" |
| R3.12 | S4 | new.test "R3.12 rejects bad slugs, bad flags and symlinked docs/changes" |
| R4.1 | S5 | validate.test "R4.1/R4.3 a filled record passes base and strict" |
| R4.2 | S5 | validate.test "R4.2 missing record fails; opt-out…" |
| R4.3 | S5 | validate.test "R4.3 detects code changed…", "R4.3 foreign verification commit" |
| R4.4 | S5 | validate.test "R4.4 strict requires…", "R4.4 strict detects … mismatch" |
| R4.5 | S5 | validate.test "R4.5 text output…" plus JSON assertions throughout |
| R4.6 | S5 | validate.test "R4.6 validate writes nothing" |
| R5.1 | S6 | list.test "R5.1/R5.3/R5.4/R5.5 classifies and derives" |
| R5.2 | S6 | list.test "R5.2 parses --since" |
| R5.3 | S6 | list.test "R5.1/R5.3/R5.4/R5.5 …" |
| R5.4 | S6 | list.test "R5.4 a repo without records…" plus pre-adoption commit excluded in the classification test |
| R5.5 | S6 | list.test "R5.1/…/R5.5 classifies and derives", "R5.5 repo identity strips credentials" |
| R5.6 | S6 | list.test "R5.6 voice format", "R5.6 text format and invalid format" |
| R5.7 | S6 | list.test "R5.7 read-only and bounded" |
| R6.1 | S7 | orchestrator.test new `Change-Record: none` assertion |

**Out of this plan:** R7.1–R7.4 belong to a follow-up plan in `awm-baseline-registry`, as stated in the scope note. They are not owned here, so there is no forward gap inside this plan's requirement set. Every slice and test above maps to an R-ID, so there is no backward gap.

## Amendments

### A1 — S1 specification review (2026-10-17)

The S1 specification review found defects in the S1 code and wording as originally planned. The S1 code blocks above are the *original* plan text; the implemented, authoritative behavior is:

- **Anchors and aliases (R1.2):** every YAML anchor and alias is rejected, including scalar and unused ones. Diagnostic `yaml-alias`. Quoted text containing `&` or `*` is not an anchor or alias.
- **Pending marker (R1.7):** `pending-content` also fires when a parsed string value (after YAML unescaping) contains the marker, not only the raw text.
- **Sensor names (R1.5):** a non-empty single-line string of at most 128 characters without control characters (replaces the planned `[A-Za-z0-9._-]+` regex, which could reject a valid sensor name copied from a receipt).
- **Wording clarifications** (design R1.2, R1.4, R1.5, R1.7; code already matches): `CORE_SCHEMA`, non-empty `scope`/`risks` entries, canonical ISO means the `toISOString()` form, `links.plan` existence is checked whenever a repository root is available.
- The S1 test count is 11, not 12.
- **Second review (R1.4):** `provenance` values are non-empty strings; `summary_short` rejects `\r`, `\n`, U+0085, U+2028 and U+2029.

### A2 — S1 code-quality review (2026-10-17)

The S1 code-quality review found that untrusted-text handling was ad hoc per field. Behavior now required (design R1.4 text-safety bullet and R1.8): single-line fields and multi-line fields have the control-character rules stated in the design; `validateRecordShape` never throws (`input-invalid`); diagnostic `message`/`field` are single-line with escaped attacker text; at most 50 diagnostics (`diagnostics-truncated`). The implementation unifies the character classes in one shared constant, splits `validateRecordShape` into per-section validators, and adds direct unit tests for `splitRecord`, `loadFrontmatter`, `isValidSlug` plus hostile-input tests. Corrections to earlier text: S1 has 11+ tests (the count in the original slice text and in A1 is stale; the suite now has more).

### A3 — Cross-cutting conventions learned in S1 (apply to S2–S7)

S1 needed ten specification rounds and four quality rounds, almost all on untrusted-text handling. S1 is complete and approved at `ddafe4b`. The conventions below bind S2–S7; where slice code above conflicts with them, the conventions win.

1. **Every exported function validates its input types and never throws on untrusted input.** It returns a diagnostic, `false`, a placeholder, or a `CommandResult` with code 2.
2. **Untrusted text never appears raw in a message.** File names, YAML keys and values, git output (branch names, subjects, tag names, paths), remote URLs, sensor names, flag values: all go through `esc()` / `escapeText` from `cli/src/core/changes/text-safety.ts` (single-line, bounded, surrogate-safe) before interpolation. This replaces any raw `${...}` interpolation or sole use of `sanitizeDiagnosticText` in the slice code.
3. **Reuse, do not reimplement.** Text rules come from `text-safety.ts` (`isSingleLine`, `isSafeMultiline`, `sliceNoSplit`, `esc`, `clipMessage`); record shape comes from `validateRecordShape`; parsing from `splitRecord` / `loadFrontmatter`.
4. **Tests are mutation-resistant.** One behavior per test; assert the diagnostic `code` and `field`; every validation branch has a failing-input test and a passing-input test. The implementer verifies at least the main branch checks by temporarily mutating them, seeing a test fail, and restoring them (never committed).
5. **Character limits count code points**, never UTF-16 units.
6. **A diagnostic message is at most 300 UTF-16 units, single-line**, and a list of diagnostics has at most 50 entries.

### A4 — S2 specification review (2026-10-17)

Three S2 findings changed the receipt semantics; the design clauses R2.1, R2.2 and R3.6 now state them:

- **Dirty-tree definition.** The tree is dirty per `git status --porcelain` excluding only the local runtime-state paths `.awm/sensors/runs`, `.awm/journal`, `.awm/ledger`, `.awm/evidence` and `.awm/track.json` (replaces the planned blanket `:(exclude).awm`). A modified tracked `.awm/sensors.json` is dirty. `receipt.ts` exports this list as `RUNTIME_STATE_EXCLUDES`; S4's `change new` uses it plus `docs/changes` instead of the planned `['.awm', RECORD_DIR]`.
- **Post-run recheck.** After the run, only HEAD movement or a changed *tracked* file (`--untracked-files=no`) withholds the receipt. Untracked sensor output does not.
- **Mode on rewrite.** A receipt written over an existing file ends with mode 0600.

### A5 — S2 quality review (2026-10-17): portability and cohesion

- **Windows path convention (binds S3–S6, extends A3).** `git rev-parse --show-toplevel` prints forward slashes (`C:/Users/...`) on Windows. Every function that returns a path obtained from git returns `path.resolve(...)` (native separators), and every test that compares such a path normalizes both sides with `fs.realpathSync.native`. S3's planned test `expect(repoRoot(repo.root)).toBe(repo.root)` is replaced by `expect(fs.realpathSync.native(repoRoot(repo.root))).toBe(fs.realpathSync.native(repo.root))`. Release is gated on ubuntu, windows and macos (D-005).
- **Worktree state module.** `gitState` and `RUNTIME_STATE_EXCLUDES` move from `receipt.ts` into `cli/src/core/changes/worktree.ts`. S3's `git.ts` (`repoRoot`, `isDirtyOutside`, `headSha`) reuses `worktree.ts` instead of duplicating it, and S4 imports `RUNTIME_STATE_EXCLUDES` from there.
- **Selection parity.** `shouldRun` in `cli/src/commands/sensors/run.ts` gains the `export` keyword (no behavior change; this adds `run.ts` to S2's surfaces for that one word), and a test asserts `isFullSelection(opts) === (shouldRun(true, opts) && shouldRun(false, opts))` for every combination of `fast`, `slow`, `all` and `changed` that `shouldRun` models, so the two cannot drift apart.

### A6 — Test harness and reuse corrections for S3–S6 (2026-10-17)

S2 is complete and approved at `703ed46`. Lessons that bind S3–S6:

- **Git identity in tests.** Jest gives each test file a copy of `process.env`; child processes never see changes made to it. The S3 helper (`cli/tests/core/changes/helpers.ts`) therefore must NOT set `GIT_AUTHOR_*` / `GIT_COMMITTER_*` through `process.env`. It builds an explicit environment object for every `execFileSync('git', ...)` call (identity variables, `HOME` set to the throwaway home, `GIT_CONFIG_GLOBAL=os.devNull`, `GIT_CONFIG_NOSYSTEM=1`) and passes `-c commit.gpgsign=false`. It still overrides and restores `HOME` and `AWM_HOME` on `process.env` (CLAUDE.md test-isolation rule) and creates every repo root with `fs.realpathSync.native`. The plan's `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` handling in `commit()` passes the dates through the same explicit environment, not through `process.env`.
- **Reuse `worktree.ts`.** S3's `git.ts` must not re-implement `gitState` or the dirty-tree logic: `repoRoot` returns `path.resolve(...)` of git's toplevel, and `isDirtyOutside` is built on `worktree.ts` (`gitState`, `RUNTIME_STATE_EXCLUDES`). S4's `change new` uses the pre-run semantics of R2.1 (`RUNTIME_STATE_EXCLUDES` plus `docs/changes`).
- **Test count and isolation.** No test may write inside the real checkout. Tests assert the real checkout is untouched when they could leak.
- **Review economy.** Each slice is reviewed against its clauses and A3–A6; reviewers report only concrete clause violations.

### A7 — S3 quality review (2026-10-17): shared predicates and a small S2 extension

- **One relative-path predicate.** `isSafeRelativePath` (git.ts) and `isSafeRelative` (validate-shape.ts) become a single exported predicate in `text-safety.ts` (path-safety belongs with the other untrusted-text rules); both call sites import it. S1's validator keeps its behavior.
- **`worktree.ts` gains an optional `extraExcludes` parameter on `gitState`** (additive; default behavior and every existing S2 test unchanged). `isDirtyOutside` in `git.ts` is built on it instead of re-running `git status` itself. This is the only S2 file touched by S3.
- **Linear-time parsing of untrusted text.** Parsers of commit messages and other untrusted strings never use a backtracking regex that can go quadratic; trimming and line splitting are index scans.
- **Derivation pins one HEAD.** `deriveFields` reads HEAD once and uses that sha for the log and the diff; the redundant `rev-list --count` is dropped (an empty log means `no-commits`, a non-empty log with no parseable subject means `no-conventional-commits`).
- **Repo identity.** `repoIdentity` lowercases the host in both the scp-style and URL branches.
- **Tests.** `derive.test.ts` is split into `git.test.ts`, `derive.test.ts` and `trailers.test.ts`; pure-function tests do not create a repo. `helpers.ts` also sets `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM` on `process.env` (restored after) so code under test never reads the developer's git config, and drops its unused `date` parameter. A test that sets `LC_ALL` at runtime to prove locale independence is removed (ICU is fixed at process start); the code-unit assertions stay.

### A8 — Real S1–S3 API for S4–S6 (2026-10-17)

S1, S2 and S3 are complete and approved (last candidate `6cd253c`). The plan code of S4–S6 was written against an API that threw; the real one does not. Where slice code conflicts with this section, this section wins. All modules are in `cli/src/core/changes/`.

- **Failure model.** Nothing in these modules throws on bad input. `repoRoot(cwd)`, `headSha(root)`, `mergeBase(root, base)`, `resolveBase(root, explicit?)`, `changedFiles(root, from, to?)`, `runGit(cwd, args)` return `null` on failure; `isAncestor` and `isDirtyOutside` return a boolean (`isDirtyOutside` is fail-closed: `true` when the state is unreadable or an exclude is unsafe); `deriveFromCommits` returns `null` for an unusable list; `deriveFields(root, mergeBaseSha | null)` returns `{ ok: true, fields } | { ok: false, diagnostic }` with codes `no-commits`, `no-conventional-commits`, `invalid-input`, `git-failed`. Commands map each `null` to a diagnostic: `not-a-git-repo`, `base-unresolved`, `git-failed`.
- **Revisions.** An explicit `--base` is first checked with `isSafeRevision` / `isSafeRef` (git.ts); a failure yields `invalid-input` (R3.5). Only then `resolveBase`, whose `null` yields `base-unresolved` (R3.2). `mergeBase` returns a full commit id or `null`.
- **Dirty tree for `change new` (R3.6).** `isDirtyOutside(root, ['docs/changes'])`; it already excludes the local runtime state of R2.1 and sees submodule changes.
- **Receipts.** `readReceipt(root, commit)` → `{ ok: true, receipt } | { ok: false, code: 'receipt-missing' | 'receipt-invalid' }`; `SensorReceipt` has `commit, ranAt, cliVersion, overall, sensors, digest`.
- **Opt-out.** `hasOptOut(root, revArgs)` accepts a single `-N` count with a safe ref, or a validated `a..b` range, and returns a boolean.
- **Every git call goes through `runGit`** (or `gitState`). S4–S6 never call `execFileSync('git', …)` directly, and every `git log` spreads `LOG_SAFETY_ARGS`. New git invocations inherit the env scrub (`GIT_*_PATHSPECS`) and the 16 MiB / 15 s bounds.
- **Text.** Any untrusted text in a message goes through `esc()`; any value written into a record or printed passes the `text-safety.ts` predicates. Command output is single-line safe. Commands return `CommandResult` and never throw out of the action.
- **Tests.** Use `makeRepo`, `makeHiddenSubmodule` and `withEnv` from `helpers.ts`; one behavior per test; assert `code` and `field`; bounds for performance tests use `LINEAR_TIME_BOUND_MS`. A command test that spawns the CLI action must override HOME and AWM_HOME and prove the real checkout is untouched.
- **Review economy.** A reviewer reports every concrete violation it can find in its FIRST pass; later rounds only verify the fixes and look at what the fixes changed.

### A9 — S5 specification review (2026-10-17)

The S5 review changed clauses R4.1, R4.3 and R4.5 of the design (read them there); S5 is reworked to match:

- **Record bound (R4.1).** At most 50 records are read per run; beyond that, a synthetic `docs/changes` record carries `too-many-records`.
- **Oversize (R4.3).** An oversize record is reported as `record-too-large` (not `record-invalid`); `validate` maps the size error of `readRecord` to that code.
- **Committed-record verdict (R4.3).** Without a path, a record with uncommitted changes relative to HEAD yields `record-uncommitted` (detected through `runGit` `status --porcelain -z --untracked-files=no -- <path>`; fail closed when git fails). With an explicit path the working-tree file is validated as it is.
- **Shape first (R4.3).** Derived, ancestry, late-files and strict checks run only when the shape is valid.
- **Truncation (R4.5).** The `diagnostics-truncated` count includes diagnostics dropped by `validateRecordShape`.
- **JSON failures (R4.5).** With `--json` an operational failure prints the one-line report shape on stdout (`state: invalid`, record `docs/changes`) and exits 2; without `--json` it keeps the stderr form of `change new`.

### A10 — S6 pre-dispatch decisions (2026-10-17)

The design clauses R5.3, R5.5, R5.6 and R5.7 now settle what the sketch left open (read them there): first-match precedence and the rule for a commit adding several records; committer date for `merged_at` and for the window; the exact JSON entry shape with `truncated`/`omitted`; tag tie-break; size and path checks on everything read from history. The S6 sketch in the slice above uses the throwing `git()`/`tryGit()` API and unbounded `git tag --contains`; the real API of A8 wins (`runGit` returning `null`, `LOG_SAFETY_ARGS` on every `git log`, `repoIdentity`, `hasOptOut`, `resolveBase`/`isSafeRevision`, `range.ts` helpers) and the R5 clauses win over the sketch. The shared prologue helpers in `cli/src/core/changes/range.ts` (`resolveRange` etc.) are reusable where they fit; `list` reads the base ref, not HEAD, so it does not require a clean tree or a pinned HEAD.

### A11 — S6 specification review (2026-10-17)

The S6 review settled nine points in the design (R5.1 shallow clones and base wording, R5.2 range, R5.3/R5.7 record bounds, R5.5 unusable dates and clipping, R5.6 JSON `adopted` and the shape of `invalid-record` entries, R5.7 repository-only write rule). S6 is reworked to match; read the clauses there.

### A12 — S6 specification review, round two (2026-10-17)

R5.5 (`pr` from the true end of a long subject) and R5.7 (first-parent history read in pages of at most 10 000 commits, stop at the adoption point or at the first page with no commit in the window) were amended in the design; S6 is reworked to match.

### A13 — S6 quality review, round two (2026-10-17)

R5.7 now states that the no-lazy-fetch guarantee for partial clones requires git 2.43 or newer (the variable `GIT_NO_LAZY_FETCH` is ignored by older git); the partial-clone test is skipped, with a visible reason, on older git.

### A14 — Final whole-implementation review (2026-10-17)

The final review settled in the design: R2.2b (receipts only when a sensor ran and only for the repository root manifest; a self-ignoring `.awm/sensors/runs/.gitignore`; no pruning in this cycle), the `schema` key of the `changes list` JSON (R5.6) and the squash-merge limit of DD-6. The code-level findings of that review (shared bidi escaping in `escapeText`, scrubbing of inherited `GIT_DIR`/`GIT_INDEX_FILE`/`GIT_WORK_TREE`, one set of receipt predicates, strict blob decoding in `list`, dead exports, a `head-moved` code, `posixOnly` in receipt tests) are corrections inside the existing slices.

