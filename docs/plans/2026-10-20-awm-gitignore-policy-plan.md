# AWM gitignore policy (#218) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the canonical `.awm/` versioned-vs-local policy as a managed `.gitignore` block written by sensors/watch init, with blocking doctor and preflight checks that propose remedies.

**Architecture:** One leaf helper module owns block text, upsert/migration, and policy evaluation against git. Watch and sensors init call upsert; doctor and preflight call evaluate. Decision D-* documents the lists. Contract: `docs/plans/2026-10-20-awm-gitignore-policy-design.md`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, git via existing `execGit` / `child_process` patterns.

**Change Record:** `awm-gitignore-policy`

**Criterios de aceptación:**
- Tras `awm sensors init` o `awm watch init` en un repo git, `.gitignore` contiene el bloque marcado con allowlist (sensors, baseline, profile, context-budget, context/index) y runtime ignorado
- `awm preflight` y `awm doctor` fallan (blocking) si journal/ledger/… están trackeados o si `sensors.json`/`profile.json` on-disk están ignorados / falta el bloque cuando hay `.awm/`, y el remedio propone regenerar el bloque y/o `git rm --cached`
- La política está en `docs/decisions.md`

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

**Origen:** owner-approved design 2026-10-20 (#218). Diagnosis artifact. Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "awm-gitignore-policy",
  "requirements": ["GI-1", "GI-2", "GI-3", "GI-4", "GI-5", "GI-6", "GI-7", "GI-8", "GI-9", "GI-10"],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-20-awm-gitignore-policy-design.md",
      "locator": "## Requirements (EARS)",
      "fact": "GI-1..GI-10, canonical versioned list including profile.json and context-budget.json, managed markers AWM:GITIGNORE:BEGIN/END, writers sensors init + watch init, blocking doctor+preflight with remedies."
    },
    {
      "id": "SRC-WATCH",
      "path": "cli/src/commands/watch/init.ts",
      "locator": "export function ensureJournalGitignored",
      "fact": "ensureJournalGitignored appends bare .awm/ if no line equals .awm or .awm/; refuses symlink; called from initWatch."
    },
    {
      "id": "SRC-SENSORS-INIT",
      "path": "cli/src/commands/sensors/init.ts",
      "locator": "export async function initSensors",
      "fact": "initSensors applies bootstrap on create; noop/already-configured returns without writing. No gitignore write today. Upsert must run after successful applySensorBootstrap (status created), not on noop."
    },
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "export type PreflightCheck",
      "fact": "PreflightCheck.id is a closed string union; blockingFailure treats advisory!==true as blocking. New check id must extend the union. runPreflight builds checks array then derives ready vs degraded."
    },
    {
      "id": "SRC-DOCTOR",
      "path": "cli/src/core/diagnostics/checks.ts",
      "locator": "function projectChecks",
      "fact": "projectChecks returns CheckResult[] with status ok|missing|warn. missing degrades project health. Add project.awm-gitignore (or similar) with missing when policy violated and remedy text."
    },
    {
      "id": "SRC-TRACKS",
      "path": "cli/src/core/tracks/git.ts",
      "locator": "export function isAwmGitignored",
      "fact": "isAwmGitignored uses git check-ignore -q .awm/probe; fail-closed. Managed block .awm/* must keep probe ignored (GI-10)."
    },
    {
      "id": "SRC-RUNTIME",
      "path": "cli/src/core/changes/worktree.ts",
      "locator": "export const RUNTIME_STATE_EXCLUDES",
      "fact": "RUNTIME_STATE_EXCLUDES lists .awm/sensors/runs, journal, ledger, evidence, track.json — local set aligned with design."
    },
    {
      "id": "SRC-DECISIONS",
      "path": "docs/decisions.md",
      "locator": "# Decisiones",
      "fact": "Table of D-NNN decisions; next free id after D-023 (and any later). Add D-0xx for .awm versioning policy."
    }
  ],
  "commands": [
    {
      "id": "CMD-CORE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/awm-gitignore.test.ts"],
      "covers": ["GI-3", "GI-4", "GI-5", "GI-9"]
    },
    {
      "id": "CMD-WIRE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/watch/init-gitignore.test.ts", "tests/commands/sensors/init-gitignore.test.ts"],
      "covers": ["GI-1", "GI-2", "GI-10"]
    },
    {
      "id": "CMD-CHECKS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/preflight/awm-gitignore.test.ts", "tests/core/diagnostics/awm-gitignore.test.ts"],
      "covers": ["GI-6", "GI-7", "GI-8"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["GI-1", "GI-2", "GI-3", "GI-4", "GI-5", "GI-6", "GI-7", "GI-8", "GI-9", "GI-10"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["GI-1", "GI-2", "GI-3", "GI-4", "GI-5", "GI-6", "GI-7", "GI-8", "GI-10"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Core managed block helper + decision",
      "requirements": ["GI-3", "GI-4", "GI-5", "GI-9"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-WATCH", "SRC-RUNTIME", "SRC-DECISIONS"],
      "redCommands": ["CMD-CORE"],
      "greenCommands": ["CMD-CORE", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Wire sensors init and watch init",
      "requirements": ["GI-1", "GI-2", "GI-10"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-SENSORS-INIT", "SRC-WATCH", "SRC-TRACKS", "SRC-DESIGN"],
      "redCommands": ["CMD-WIRE"],
      "greenCommands": ["CMD-WIRE", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S3",
      "title": "Blocking doctor and preflight checks",
      "requirements": ["GI-6", "GI-7", "GI-8"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-PREFLIGHT", "SRC-DOCTOR", "SRC-DESIGN"],
      "redCommands": ["CMD-CHECKS"],
      "greenCommands": ["CMD-CHECKS", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-CORE", "CMD-WIRE", "CMD-CHECKS", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Core managed block helper + decision

#### Surfaces

Owns GI-3, GI-4, GI-5, GI-9 in new `cli/src/core/awm-gitignore.ts` (+ `cli/tests/core/awm-gitignore.test.ts`) and one decision entry in `docs/decisions.md`. Grouping: pure policy + file upsert before any command wiring.

#### Implementation

1. **RED** — `cli/tests/core/awm-gitignore.test.ts` in tmpdirs:
   - `renderManagedBlock()` equals design marker text (profile + context-budget included).
   - `upsertAwmGitignore(root)` creates `.gitignore` with block; second call no-op (same bytes).
   - Starting with bare `.awm/` or `.awm` line: after upsert those blanket lines are gone, block present, unrelated lines (e.g. `node_modules`) preserved.
   - Symlink `.gitignore` → throws / Error mentioning symlink.
2. Run CMD-CORE → RED.
3. **GREEN** — implement module exporting constants for versioned/local paths, `renderManagedBlock`, `upsertAwmGitignore(repoRoot)`, marker constants. Use fs sync like watch init; refuse symlink via `lstatSync`.
4. Add `D-024` (or next free id) to `docs/decisions.md` table + section with both lists.
5. CMD-CORE, typecheck, lint → GREEN. Commit: `feat(core): managed .awm gitignore block helper`.

#### Edge cases

- Empty missing `.gitignore` → create with block only.
- Existing managed block with stale contents → replace inner section only.
- CRLF files: normalize to `\n` on write or accept either on detect; tests use `\n`.

#### Evidence

SRC-DESIGN, SRC-WATCH, SRC-RUNTIME, SRC-DECISIONS. Independent spec + quality reviews before S2.

#### Fallback

If marker collision with user comment containing same string, amend design to rarer markers; revalidate plan.

<a id="slice-s2"></a>
### Slice S2: Wire sensors init and watch init

#### Surfaces

Owns GI-1, GI-2, GI-10. Replace `ensureJournalGitignored` body to call `upsertAwmGitignore`. Call upsert from `initSensors` after successful `applySensorBootstrap` (created path only). Tests: `tests/commands/watch/init-gitignore.test.ts`, `tests/commands/sensors/init-gitignore.test.ts`.

#### Implementation

1. **RED** — watch: `initWatch` on tmp git repo writes managed block, not bare `.awm/` alone; `isAwmGitignored` true. Sensors: after real or stubbed successful init that creates `.awm/sensors.json`, block present; noop path does not require block if never created (or document: only on create). Prefer testing upsert call via integration with minimal bootstrap fixture if heavy — otherwise unit-test that created path invokes upsert by exporting thin wrapper.
2. CMD-WIRE → RED.
3. **GREEN** — wire both call sites. Keep export name `ensureJournalGitignored` as thin alias to upsert for minimal churn, or replace call sites.
4. GREEN + commit: `feat(sensors,watch): upsert managed awm gitignore on init`.

#### Edge cases

- `already-configured` / noop: do not fail if block missing (preflight will catch when `.awm` exists); optional best-effort upsert on noop when `.awm/sensors.json` exists — **do** upsert on noop when project already has `.awm/` so repair is one command (align with remedy text). Pin in test: noop with existing sensors.json still upserts.
- Non-git directory: upsert may still write `.gitignore`; checks skip when not a git repo.

#### Evidence

SRC-SENSORS-INIT, SRC-WATCH, SRC-TRACKS. Spec + quality reviews.

#### Fallback

If sensors bootstrap fixtures are too heavy, test via direct `ensureJournalGitignored` + a sensors index CLI harness; amend plan if needed.

<a id="slice-s3"></a>
### Slice S3: Blocking doctor and preflight checks

#### Surfaces

Owns GI-6, GI-7, GI-8. Extend `evaluateAwmGitignorePolicy(repoRoot)` in the helper (git `ls-files` / `check-ignore`). Wire into `projectChecks` and `runPreflight` (new id `awm-gitignore` on PreflightCheck union, `advisory` omitted/false).

#### Implementation

1. **RED** — fixtures: tracked `.awm/journal/x` → check fails with remedy containing `git rm --cached`; on-disk `sensors.json` with bare `.awm/` ignore → fails with remedy mentioning `awm sensors init` or `awm watch init`; clean managed block → ok.
2. CMD-CHECKS → RED.
3. **GREEN** — implement evaluate + wire. Preflight: run when git repo and (`.awm` exists or tracked awm paths); skip cleanly when not a git repo (`ok: true` detail skipped) so non-git sandboxes do not degrade.
4. GREEN + commit: `feat(doctor,preflight): blocking awm gitignore policy check`.

#### Edge cases

- Versioned path not on disk: do not fail “ignored” for missing profile; only fail ignore when the path exists as a file/dir or when block missing while any `.awm` config file exists.
- Local path tracked → always fail.
- This repo: after upsert, migrate `.gitignore` to managed block in a follow-up commit on the same branch (include migrating the repo’s own `.gitignore` as part of S3 or a small chore commit) so preflight stays ready.

#### Evidence

SRC-PREFLIGHT, SRC-DOCTOR, SRC-DESIGN. Closure all commands.

#### Fallback

If doctor CheckResult vocabulary cannot express “error”, use `missing` with clear label (existing degrade path). Amend if dashboard ids need registration.

## Traceability

| Req | Slice | Tests |
|-----|-------|-------|
| GI-3..5, GI-9 | S1 | awm-gitignore.test.ts + decisions.md |
| GI-1,2,10 | S2 | init-gitignore watch/sensors |
| GI-6..8 | S3 | preflight + diagnostics tests |

## Self-review

- Forward/backward coverage complete.
- No TBD.
- Desatendido + proveedor-nativo.
- Design path is repo-relative (valid source).
