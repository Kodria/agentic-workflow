# Project-Declared Sensors Design

**Issue:** [#209](https://github.com/Kodria/agentic-workflow/issues/209)

**Scope:** coordinated changes in `agentic-workflow` (CLI) and `awm-baseline-registry` (`setup-sensors`)

**Approach:** extend schemaVersion 3 `project-sensors` with optional pack and a discriminated sensor entry `source: "project"` (brainstorming 2026-10-08).

## Requirements

### Manifest contract

- **RF-1.1 — Explicit project marker:** WHEN a schemaVersion 3 `project-sensors` manifest entry includes `"source": "project"`, THE CLI SHALL treat that entry as a project-declared sensor and SHALL NOT require `variantId` or pack `initializedCompatibility`.
- **RF-1.2 — Reject unmarked custom commands:** IF a schemaVersion 3 sensor entry supplies a command that does not resolve to a pack variant and omits `"source": "project"`, THEN THE CLI SHALL mark that entry invalid with a reason naming the sensor and the missing `source` field, and SHALL NOT treat the whole file as non-JSON.
- **RF-1.3 — Pack-bound unchanged:** WHEN a schemaVersion 3 sensor entry lacks `"source": "project"`, THE CLI SHALL continue to require the existing pack-bound fields (`variantId`, `initializedCompatibility`, structured `command`) with current validation rules.
- **RF-1.4 — Forbidden pack fields on project entries:** IF a `"source": "project"` entry declares `variantId` or `initializedCompatibility`, THEN THE CLI SHALL mark that entry invalid with a reason naming the forbidden field.
- **RF-1.5 — Optional pack:** WHEN a schemaVersion 3 `project-sensors` manifest omits `pack` or sets `pack` to `null`, THE CLI SHALL accept the manifest when every sensor entry is `"source": "project"` and SHALL NOT invent a pack id (including `generic`).
- **RF-1.6 — Pack plus project:** WHEN a schemaVersion 3 `project-sensors` manifest declares a pack and one or more `"source": "project"` entries with names that do not collide with pack sensor ids, THE CLI SHALL accept both kinds in the same `sensors` map.
- **RF-1.7 — Name collision is add-only:** IF a `"source": "project"` entry uses the same sensor id as a sensor defined by the selected pack, THEN THE CLI SHALL mark only that project entry invalid with reason `project-sensor-name-collision: <name>` and SHALL keep the pack sensor.
- **RF-1.8 — v3 only:** IF a legacy or schemaVersion 2 manifest contains `"source": "project"`, THEN THE CLI SHALL reject that construct with a reason that requires migration to schemaVersion 3 `project-sensors`.
- **RF-1.9 — Formatter default and registry:** WHEN a `"source": "project"` entry omits `formatter`, THE CLI SHALL use `exit-code`. WHEN it declares `formatter`, THE CLI SHALL accept only formatter ids registered by the CLI and SHALL mark the entry invalid if the id is unknown.
- **RF-1.10 — Command shape:** WHEN validating a `"source": "project"` command, THE CLI SHALL apply the same structured-command rules as pack variants (shell-free tokenized argv, same resolution kinds, same write-unsafe rejections already enforced for packs).
- **RF-1.11 — Applicability:** WHERE a `"source": "project"` entry omits `applicability`, THE CLI SHALL treat the sensor as always applicable. WHERE it declares `applicability`, THE CLI SHALL validate and evaluate it with the same shapes and semantics as pack applicability.
- **RF-1.12 — Soft entry isolation:** IF one sensor entry fails schema validation, THEN THE CLI SHALL mark that entry invalid with `sensors.<name>.<field>` in the reason, SHALL continue validating remaining entries, and SHALL NOT classify a successfully parsed JSON document as “not valid JSON”.

### Runtime parity

- **RF-2.1 — Same execution pipeline:** WHEN preparing and running selected sensors, THE CLI SHALL send project-declared and pack-bound sensors through the same prepare → execute → interpret → baseline → overall-reduction pipeline.
- **RF-2.2 — Provenance label:** WHEN reporting a project-declared sensor in `sensors status`, `sensors run` JSON, `doctor`, or sensor-related preflight output, THE CLI SHALL label its provenance `project-declared` and SHALL NOT label it `certified`.
- **RF-2.3 — Provenance never gates:** IF the only distinction of a project-declared sensor is that it is not pack-certified, THEN THE CLI and unattended workflows SHALL NOT fail, degrade, or block admission solely for that reason. Gate outcomes SHALL follow empirical sensor results (pass/fail/invalid/missing-tool/etc.) under the same rules as pack sensors.
- **RF-2.4 — exit-code formatter:** WHEN a sensor uses formatter `exit-code`, THE CLI SHALL map process exit `0` to `pass` and any other completed exit code to `fail` with truncated stdout/stderr as evidence, without inventing per-file findings.
- **RF-2.5 — Empirical fail:** WHEN a selected project-declared sensor completes with a failing formatter verdict (including `exit-code` non-zero), THE CLI SHALL include that failure in the global overall reduction exactly as for a pack sensor.
- **RF-2.6 — Invalid entry does not abort siblings:** WHEN a project-declared entry is schema-invalid, THE CLI SHALL skip executing that entry, SHALL still execute other valid selected sensors, and SHALL expose the invalid entry in machine-readable output.
- **RF-2.7 — Baseline parity:** WHEN baseline capture or suppression runs, THE CLI SHALL allow a project-declared sensor to participate with the same unit semantics as a pack sensor (sensor-level pass/fail for `exit-code` debt).
- **RF-2.8 — Status with no pack:** WHEN a valid only-project manifest is configured, THE CLI SHALL report sensor detail lines for each project-declared sensor and SHALL NOT render an empty `Pack: none` / `DEGRADED` status with zero detail solely because `pack` is absent.
- **RF-2.9 — Coverage without pack:** WHEN coverage is evaluated for an only-project manifest, THE CLI SHALL report an informative inconclusive / no pack-reference outcome and SHALL NOT claim pack certification coverage.

### Init and bootstrap

- **RF-3.1 — Preserve project entries:** WHEN `awm sensors init` or bootstrap regenerates pack-bound sensors from a pack, THE CLI SHALL preserve every existing `"source": "project"` entry byte-stable in meaning (same names and fields) unless the operator explicitly removes them.
- **RF-3.2 — Init without pack:** WHEN the operator configures an only-project `project-sensors` manifest, THE CLI SHALL allow writing and updating that manifest without forcing `pack: "generic"` or another invented pack.
- **RF-3.3 — Remedy honesty:** IF a failure is caused by schema invalidity of a `"source": "project"` entry, THEN THE CLI SHALL NOT recommend `awm sensors init` as the first remedy.

### Diagnostics

- **RF-4.1 — JSON vs schema:** IF `.awm/sensors.json` fails `JSON.parse`, THEN preflight and sensor commands MAY say the file is not valid JSON. IF `JSON.parse` succeeds and schema validation fails, THEN those commands SHALL NOT say the file is not valid JSON.
- **RF-4.2 — Named field errors:** WHEN schema validation fails for an entry, THE CLI SHALL include the sensor id and field (or explicit collision/formatter reason) in human and machine output.
- **RF-4.3 — Run machine output:** WHEN `awm sensors run` encounters schema-invalid entries, THE JSON result SHALL identify those entries by name and reason rather than only emitting a bare global `manifest-malformed` with an empty `sensors` array while valid siblings exist.

### Documentation

- **RF-5.1 — setup-sensors:** THE `setup-sensors` skill in `awm-baseline-registry` SHALL document when to declare a project sensor versus when to use or extend a pack, include a minimal `source: "project"` example, and state that `project-declared` provenance does not block unattended gates.
- **RF-5.2 — CLI reference:** THE CLI reference SHALL document project-declared sensors, optional pack, formatter default `exit-code`, and the diagnostic distinction between JSON and schema errors.

## Non-goals (v1)

- Overriding or replacing a pack sensor by reusing its name.
- Publishing new registry packs as a substitute for project-declared sensors.
- schemaVersion 4 migration.
- UI surfaces.
- Inferring project sensors without `"source": "project"`.

## Context and problem

`.awm/sensors.json` only accepts sensors that bind to a registry pack variant. Adding a project-owned check (for example Terraform `fmt -check` beside a Python pack) makes the entire manifest invalid: `sensors status` shows `Pack: none` with no detail, `sensors run` returns `manifest-malformed`, and `preflight` incorrectly claims the file is not valid JSON. Removing the custom entry restores pack sensors. Packs cannot scale to every stack; projects need first-class, same-pipeline sensors they author themselves, including manifests with no pack at all.

## Architecture

### Discriminated entries in one map

Keep a single `sensors` object on schemaVersion 3 `project-sensors` manifests.

```text
SensorEntry =
  | PackBoundSensor    // existing: variantId + initializedCompatibility + command + …
  | ProjectSensor     // source: "project" + command + optional formatter/applicability/…
```

`pack` becomes optional. When present, pack-bound entries resolve against that pack as today. Project entries never consult pack variants for command authority.

### Shared pipeline with provenance tag

Reuse `PreparedSensorExecution` / run / baseline / overall reduction. Add a provenance field (or equivalent certification slot) set to `project-declared` for project sensors. Unattended admission and overall reduction ignore provenance and use empirical outcomes only.

### Soft validation

Split “document parse” from “per-entry validate”. Collect invalid entries; keep valid ones executable. Map current false “not valid JSON” paths in preflight to schema errors when parse succeeded.

### Formatter `exit-code`

Register `exit-code` beside existing formatters. Default for project sensors when `formatter` is omitted. Unknown formatter ids fail that entry only.

### Init merge

Extend manifest rewrite paths so pack materialization overlays pack-bound keys and leaves `source: "project"` keys untouched.

## Component touch list

| Area | Change |
|---|---|
| `cli/src/commands/sensors/compatibility/manifest.ts` | Optional pack; project entry parser; soft isolation |
| prepare / run / status / preflight sensor checks | Provenance, detail lines, JSON vs schema |
| `result.ts` / formatters | `exit-code` |
| init / bootstrap / materialize | Preserve project entries; only-project write path |
| tests | Parser, isolation, init preserve, gate parity, diagnostics |
| `docs/cli-reference.md` | Operator docs |
| `awm-baseline-registry` `skills/setup-sensors` | Guidance + version bump |

## Error taxonomy (stable reasons)

| Reason | When |
|---|---|
| (JSON parse error) | `JSON.parse` fails |
| `manifest-schema-invalid` / `sensors.<name>.<field>: …` | Schema field errors |
| `project-sensor-name-collision: <name>` | Project id equals pack sensor id |
| `project-sensor-invalid: <name>: unknown formatter` | Formatter not registered |
| `project-declared` | Provenance label (not an error) |

## Acceptance mapping

| Criterion | Requirements |
|---|---|
| Pack + valid project → READY; run all; not certified | RF-1.6, RF-2.1, RF-2.2, RF-2.3 |
| Project exit 1 → overall fail; 0 → pass | RF-2.4, RF-2.5 |
| Invalid project field → only that sensor invalid; pack runs | RF-1.12, RF-2.6, RF-4.2, RF-4.3 |
| init preserves project sensors | RF-3.1 |
| Valid JSON + bad schema ≠ “not valid JSON” | RF-4.1, RF-4.2 |
| setup-sensors docs | RF-5.1 |
| Only-project manifests | RF-1.5, RF-2.8, RF-2.9, RF-3.2 |
| Provenance does not block unattended | RF-2.3 |

## Self-review

1. **Placeholder scan:** no TBD/TODO left in this document.
2. **Consistency:** approach A, add-only names, optional pack, shared pipeline, provenance non-gating match sections approved in brainstorming.
3. **Scope:** one feature slice across CLI + setup-sensors docs; non-goals exclude pack authoring and v4.
4. **Ambiguity:** pack null/omit, collision, formatter default, soft isolation, unattended invariant made explicit.
5. **EARS/IDs:** RF-1.* … RF-5.* are testable 1:1.

## UI Screens

Omitting — no direct-interaction visual UI in this work.
