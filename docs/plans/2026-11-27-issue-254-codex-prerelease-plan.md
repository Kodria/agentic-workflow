# Accept Codex prerelease version strings (#254) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept `codex-cli X.Y.Z` version lines with optional semver prerelease and/or build suffixes in `awm init` / `assertProviderSupported`, returning the core triple for the existing minimum compare, while keeping unrecognized formats fail-closed (#254).

**Architecture:** Widen only the Codex `versionPattern` in `cli/src/providers/index.ts`. Leave `assertProviderSupported` and `compareSemver` unchanged — they already use capture group 1 as the core. Update unit expects that currently reject `*-beta.1`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest under `cli/tests/`.

**Change Record:** `codex-prerelease-version-parse`

**Criterios de aceptación:**
- `codex-cli 0.172.0-alpha.2` → `assertProviderSupported('codex', …)` returns `{ provider: 'codex', version: '0.172.0' }` (no `could not parse`)
- `codex-cli 0.172.0-alpha.2+exp.sha.5114f85` → same accept with core `0.172.0`
- `codex-cli 0.144.9` y `codex-cli 0.144.9-alpha.1` → `requires Codex >= 0.145.0`
- Salidas no reconocidas (`v0.145.0`, trailing tokens, wrong tool) → `could not parse Codex version`
- Cursor date-hash pattern sin cambios

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** #254. Design: `docs/plans/2026-11-27-issue-254-codex-prerelease-design.md` (owner-approved). Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "codex-prerelease-version-parse",
  "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4"],
  "sources": [
    {
      "id": "SRC-CODEX-PATTERN",
      "path": "cli/src/providers/index.ts",
      "locator": "versionPattern: /^codex-cli (\\d+\\.\\d+\\.\\d+)$/",
      "fact": "Codex versionCommand.versionPattern is /^codex-cli (\\d+\\.\\d+\\.\\d+)$/ so any -prerelease or +build suffix fails match. Change to /^codex-cli (\\d+\\.\\d+\\.\\d+)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$/ with group 1 still the core X.Y.Z. Do not change minimumVersion, command, or args."
    },
    {
      "id": "SRC-ASSERT-PROVIDER",
      "path": "cli/src/core/provider-version.ts",
      "locator": "export function assertProviderSupported",
      "fact": "assertProviderSupported trims stdout, matches versionPattern, uses match[1] with compareSemver against minimumVersion, returns { provider, version: match[1] }. On no match throws could not parse ${label} version from: …. No code change required if pattern group 1 stays the core; behavior change is pattern-driven."
    },
    {
      "id": "SRC-PROVIDER-VERSION-TEST",
      "path": "cli/tests/core/provider-version.test.ts",
      "locator": "rejects unsupported output without mutation",
      "fact": "it.each currently expects Buffer.from('codex-cli 0.145.0-beta.1\\n') to throw 'could not parse Codex version'. After fix that row must become an accept case returning version '0.145.0'. Keep rejects for 0.144.9, unknown, v-prefix, incomplete, wrong tool, leading notice, 'stable' infix, trailing tokens. Add accepts for 0.172.0-alpha.2 and a +build line."
    },
    {
      "id": "SRC-PROVIDERS-INDEX-TEST",
      "path": "cli/tests/providers/index.test.ts",
      "locator": "declares the complete Codex capability metadata",
      "fact": "Expects versionCommand.versionPattern: /^codex-cli (\\d+\\.\\d+\\.\\d+)$/. Update the expected RegExp to the widened pattern so the metadata contract stays green."
    }
  ],
  "commands": [
    {
      "id": "CMD-PROVIDER-VERSION",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--testPathPatterns=provider-version.test", "--no-coverage"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3"]
    },
    {
      "id": "CMD-PROVIDERS-INDEX",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--testPathPatterns=providers/index.test", "--no-coverage"],
      "covers": ["RF-1.1", "RF-1.4"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.1", "RF-1.4"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Widen Codex versionPattern and flip tests",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-CODEX-PATTERN", "SRC-ASSERT-PROVIDER", "SRC-PROVIDER-VERSION-TEST", "SRC-PROVIDERS-INDEX-TEST"],
      "redCommands": ["CMD-PROVIDER-VERSION", "CMD-PROVIDERS-INDEX"],
      "greenCommands": ["CMD-PROVIDER-VERSION", "CMD-PROVIDERS-INDEX", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-PROVIDER-VERSION", "CMD-PROVIDERS-INDEX", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Widen Codex versionPattern and flip tests

#### Surfaces

Owns RF-1.1–RF-1.4 as one cohesive Codex version-gate parse fix: config regex + unit contracts only. Files: `cli/src/providers/index.ts`, `cli/tests/core/provider-version.test.ts`, `cli/tests/providers/index.test.ts`. No change to `assertProviderSupported` control flow. Grouping rationale: single pattern drives all acceptance/rejection behavior for this issue.

#### Implementation

1. **RED — flip and extend tests first**
   - In `provider-version.test.ts`, remove `codex-cli 0.145.0-beta.1` from the reject `it.each`.
   - Add accepts (alongside the stable `it.each` or dedicated `it`s):
     - `codex-cli 0.145.0-beta.1` → `{ provider: 'codex', version: '0.145.0' }`
     - `codex-cli 0.172.0-alpha.2` → `{ provider: 'codex', version: '0.172.0' }`
     - `codex-cli 0.172.0-alpha.2+exp.sha.5114f85` → `{ provider: 'codex', version: '0.172.0' }`
   - Keep rejects: `0.144.9` → `requires Codex >= 0.145.0`; add `codex-cli 0.144.9-alpha.1` → same requires message; keep garbage parse rejects (`unknown`, `v0.145.0`, incomplete, wrong tool, notice prefix, `stable` infix, trailing).
   - In `providers/index.test.ts`, update the Codex `versionPattern` expect to `/^codex-cli (\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/`.
   - Run CMD-PROVIDER-VERSION and CMD-PROVIDERS-INDEX → RED (pattern still old).

2. **GREEN — widen pattern**
   - In `cli/src/providers/index.ts` Codex `versionCommand`, set:
     `versionPattern: /^codex-cli (\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/`
   - Do not edit `provider-version.ts` unless a test proves group-1 / compare behavior broke (it should not).
   - Run CMD-PROVIDER-VERSION, CMD-PROVIDERS-INDEX, CMD-TYPECHECK → GREEN.

3. **Commit** with subject `fix(cli): accept Codex prerelease and build version suffixes (#254)`.

#### Edge cases

- Prerelease alone, build alone (`codex-cli 0.172.0+build.1` if desired as optional assert), or both — all must match; empty `-` / `+` segments must NOT match (`[0-9A-Za-z.-]+` is one-or-more).
- Core below floor with suffix still requires ≥ minimum (RF-1.2).
- Cursor expects unchanged (RF-1.4) — providers index Cursor expect stays; CMD-PROVIDER-VERSION Cursor cases stay green without edits.
- Returned `version` is always the bare core string, never including `-alpha` or `+build`.

#### Evidence

- Sources: SRC-CODEX-PATTERN, SRC-ASSERT-PROVIDER, SRC-PROVIDER-VERSION-TEST, SRC-PROVIDERS-INDEX-TEST.
- RED/GREEN: CMD-PROVIDER-VERSION, CMD-PROVIDERS-INDEX; closure adds CMD-TYPECHECK.
- Distinct specification and code-quality review verdicts required before QA.
- Sensors / Change Record follow finishing after QA/docs/retro markers.

#### Fallback

If Codex emits a version line outside optional prerelease/build (e.g. spaces, multiple tokens), keep fail-closed `could not parse` and amend the design/pattern with a durable RF change + `awm plan validate` — do not silently accept arbitrary trailing text. Full-context risk: public-contract on init onboarding for Codex Cloud hosts.

## File map

| File | Role |
|------|------|
| `cli/src/providers/index.ts` | Codex `versionPattern` |
| `cli/tests/core/provider-version.test.ts` | Accept/reject matrix |
| `cli/tests/providers/index.test.ts` | Metadata expect |
| `docs/plans/2026-11-27-issue-254-codex-prerelease-design.md` | Approved design |
| `docs/changes/` | Change Record at finish |

## Self-review (planning)

- Bidirectional: each RF appears in commands covers and S1 requirements; each command covers only declared RFs.
- Locators match current main sources (verified against `providers/index.ts` and tests).
- Dispatch mode `proveedor-nativo` → compact-slices/v1 only.
