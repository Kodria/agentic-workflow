# Operator Environments & Registry Lifecycle Design

**Issue:** [#148](https://github.com/Kodria/agentic-workflow/issues/148)

**Evidence:** private registry `awm-cenco-infra-registry` (zip in session) — shared operational knowledge mixed with machine/operator-local paths and AWS profile names; blocking handoff to a second operator (TL) without editing content.

**Scope:** `agentic-workflow` (CLI + docs). Optional follow-on slice in `awm-baseline-registry` (`writing-skills` / `process-lifecycle`) as accelerator only. **Out of scope this delivery:** modifying `awm-cenco-infra-registry` (later session migrates it onto this contract).

**Approach:** B — registry lifecycle product surface (scaffold + extensible handbook + registry doctor) with facts/environments as capability chapter 1 (brainstorming 2026-10-12).

**Decisions locked in brainstorming**

| # | Decision |
|---|---|
| 1 | Unit = **environment** as bag of **facts** (MVP: one active environment per machine) |
| 2 | Facts declared in a **registry-level catalog**; skills only **reference** ids (`needs`) |
| 3 | Resolve via **prompt + editable store** (B+C); registry-declared commands **not** in v1 |
| 4 | Authoring = **C ampliado escalable**: AWM teaches create → registry handbook for maintain → doctor audits any tree; `writing-skills` is accelerator, not gate |
| 5 | Deliver values **hybrid**: default **reference**; `inject: context` opt-in with budget |
| 6 | Durability **default durable** (no time-based stale); `volatile`+`ttl` opt-in only |

---

## Goal

AWM provides a native, scalable path so a registry can declare machine/operator data (**facts**), materialize them in a local **environment**, and teach operators to **create / maintain / audit** registries — without committing personal values into registry git.

**Acceptance (from #148):** A skill from a foreign registry, installed without editing a line, works on two machines with different operators, profiles, and paths; when a local value is missing or stale, the agent/CLI know it instead of operating on a false value.

## Non-goals (v1)

- Edit or migrate `awm-cenco-infra-registry` in this delivery.
- Execute commands declared by a registry to resolve facts.
- Multiple concurrently active environments.
- Hard-fail prose heuristics (“looks personal”).
- Mass interpolation of fact values into `AGENTS.md`.
- Typing secrets as facts (handbook: secrets stay in vault/OS).

---

## Architecture

```
Registry (git, shareable)
├── awm-registry.json          minCliVersion (valid semver)
├── catalog.json / bundles / skills
├── facts.json                 fact catalog (contract)
├── REGISTRY.md                extensible maintainer handbook
│                              Capabilities index + per-capability chapters
└── skills/*/SKILL.md          optional needs: [factId, …]

Machine (never registry git)
└── ~/.awm/environments/<name>/
    ├── meta.json              active flag, timestamps
    └── values.json            factId → { value, status, updatedAt, expiresAt? }

CLI
├── awm registry scaffold|doctor
├── awm env status|set|edit|refresh|use
└── resolve / inject (default reference)
```

**Extension rule:** every future registry product capability adds (1) a handbook chapter + Capabilities row, (2) doctor checks for that capability id, (3) schema/runtime if needed — same channel, no parallel mechanism.

**Principle (D-011):** do not invent discoverability; never serve a false value as resolved.

---

## Data model

### `facts.json` (registry root)

```json
{
  "schemaVersion": 1,
  "facts": {
    "repos.root": {
      "description": "Local root for team clones",
      "valueType": "path",
      "resolution": "prompt",
      "durability": "durable",
      "inject": "reference"
    }
  }
}
```

| Field | v1 |
|---|---|
| `valueType` | `string` \| `path` \| `enum` (enum requires `values[]`) |
| `resolution` | `prompt` only; `command` rejected or ignored with explicit message |
| `durability` | `durable` (default) \| `volatile` + optional `ttl` |
| `inject` | `reference` (default) \| `context` |

### Skill `needs`

```yaml
needs:
  - repos.root
  - aws.profile.dev
```

- Each id MUST exist in **that** registry’s `facts.json`.
- Omitting `needs` is valid (fully shareable skill).
- Process entry skills use the same rule when they declare `needs`.

### Environment store

`AWM_HOME/environments/<name>/values.json`:

```json
{
  "repos.root": {
    "value": "/path/on/this/machine",
    "status": "fresh",
    "updatedAt": "2026-10-12T00:00:00Z"
  }
}
```

- Status: `fresh` \| `stale` \| `missing`.
- Durable values never become `stale` due to elapsed time.
- Volatile+ttl elapsed → `stale`; value MUST NOT be served as fresh.
- One **active** environment per machine; default name `default` on first `set` if none exists.

---

## CLI surface

### Environment

| Command | Behavior |
|---|---|
| `awm env status` | Active env; catalog facts vs store statuses |
| `awm env set <factId>` | Prompt or `--value`; validate `valueType`; write store |
| `awm env edit` | Point operator at editable store path |
| `awm env refresh [factId\|--all]` | Re-prompt only; no registry commands |
| `awm env use <name>` | Switch active environment |

### Registry lifecycle

| Command | Behavior |
|---|---|
| `awm registry scaffold <dir>` | Minimal layout + valid versions + `REGISTRY.md` + facts chapter + optional empty `facts.json` |
| `awm registry doctor [name\|path]` | Audit installed registry or local path |

`add` / `list` / `remove` / `update` keep current contracts; scaffold creates, doctor reads.

### Version contract (scaffold + doctor)

Scaffold MUST leave a tree that structural doctor passes and `awm registry add` can consume — not a “almost valid” registry.

| Piece | Rule |
|---|---|
| `awm-registry.json` `minCliVersion` | Valid `X.Y.Z`; scaffold sets CLI version that understands this capability (or current CLI); never empty/malformed |
| `catalog.json` ↔ `bundle.json` | Versions equal per bundle; empty catalog (zero bundles) allowed |
| Git tags | Handbook documents first release tag; doctor **advisory** if no tags on a local path |
| Atomicity | IF scaffold fails mid-way, THEN do not present success; clean up or stop before finalize (same spirit as `registry add`) |

Doctor structural ALSO fails when facts/`needs` are used but `minCliVersion` is below the CLI constant that implements facts.

---

## Handbook (`REGISTRY.md`)

Canonical maintainer contract inside every registry — **not** facts-only; scalable for all future registry capabilities.

```markdown
# <registry-name>

## Capabilities
| id | status | notes |
|----|--------|-------|
| facts | active | see ## Capability: facts |

## Capability: facts
…
```

- Capabilities index table is **required** and doctor-parseable.
- `status`: `active` \| `planned` \| `n/a`.
- Unknown capability ids → **advisory** (forward-compatible).
- Known ids (starting with `facts`) → apply that capability’s doctor checks.
- Handbook is for maintainers; runtime reads catalog/store, not the markdown prose.

**Authoring path**

1. `awm registry scaffold` is the canonical create path (runbook/docs point here).
2. Registry ships its own `REGISTRY.md` for ongoing maintenance.
3. Baseline `writing-skills` / `process-lifecycle` may teach “machine-dependent → fact”; they are **not** the compliance gate.
4. Existing / external / checklist-authored content (e.g. `nuevo-proyecto.md`) is covered by **`awm registry doctor`**.

---

## Security, errors, injection

- v1 MUST NOT execute registry-declared resolution commands.
- CLI MUST NOT write environment stores into the registry tree; doctor structural-fails if such files are present.
- `missing` / `stale` → explicit status; NEVER substitute defaults or empty “useful” strings.
- `awm env set` invalid `valueType` → non-zero exit, store unchanged.
- Unknown fact id on `set` → error naming catalogs consulted.
- `inject: context` only when `fresh` and within a fixed character/count budget; overflow → degrade to reference + warning (no truncated lying values).
- Structural doctor failures → exit ≠ 0; advisories alone → exit 0 with visible/JSON advisories.
- Registry without `facts.json` / `needs` remains valid.
- `needs` without catalog → structural fail.

---

## Requirements (EARS)

### RF-1 Catalog and needs

- **RF-1.1** WHEN a registry root contains `facts.json`, THE CLI SHALL parse it as `schemaVersion` 1 and reject an invalid shape with a named error.
- **RF-1.2** WHEN a skill frontmatter lists `needs`, THE CLI SHALL resolve each id against that registry’s facts catalog.
- **RF-1.3** IF a `needs` id is absent from that catalog, THEN THE doctor/runtime SHALL fail closed and SHALL NOT invent a fact.
- **RF-1.4** WHEN a skill omits `needs`, THE CLI SHALL treat it as valid shareable content.

### RF-2 Environment (machine-local)

- **RF-2.1** THE CLI SHALL persist fact values only under `AWM_HOME/environments/<name>/`.
- **RF-2.2** THE CLI SHALL maintain exactly one active environment per machine.
- **RF-2.3** WHEN durability is `durable` (default), THE CLI SHALL NOT mark the value `stale` due to elapsed time.
- **RF-2.4** WHEN durability is `volatile` and `ttl` has elapsed, THE CLI SHALL mark `stale` and SHALL NOT serve the value as fresh.
- **RF-2.5** IF status is `missing` or `stale`, THEN THE CLI SHALL expose that status and SHALL NOT substitute a default value.

### RF-3 Resolution and injection

- **RF-3.1** WHEN `inject` is `reference` (default), THE CLI SHALL expose a store path and fact ids, not values.
- **RF-3.2** WHEN `inject` is `context` and status is `fresh`, THE CLI SHALL include the value only within a fixed budget; IF over budget, THEN THE CLI SHALL degrade to reference with a warning.
- **RF-3.3** THE CLI SHALL resolve values via prompt, `--value`, or editable store only; IF a catalog entry declares `resolution: command`, THEN THE CLI SHALL reject or ignore it with an explicit message.

### RF-4 Registry lifecycle

- **RF-4.1** WHEN `awm registry scaffold <dir>` succeeds, THE directory SHALL pass structural `awm registry doctor` and SHALL be addable via `awm registry add`.
- **RF-4.2** THE scaffold SHALL write a valid `minCliVersion`, coherent catalog/bundle versions when stubs exist, `REGISTRY.md` with a Capabilities index, and a facts chapter.
- **RF-4.3** IF scaffold fails mid-way, THEN THE CLI SHALL NOT report success with a partially configured registry.
- **RF-4.4** WHEN `awm registry doctor` runs, THE CLI SHALL exit non-zero only for structural failures; advisories alone SHALL exit 0.
- **RF-4.5** THE doctor SHALL treat environment/store files inside the registry tree as a structural failure.
- **RF-4.6** THE doctor SHALL treat unknown handbook capability ids as advisory.
- **RF-4.7** IF a catalog bundle `version` differs from its `bundle.json` version, THEN THE doctor SHALL fail structurally.
- **RF-4.8** IF the registry uses facts/`needs` and `minCliVersion` is below the CLI constant that implements facts, THEN THE doctor SHALL fail structurally.

### RF-5 Authoring and delivery scope

- **RF-5.1** Compliance SHALL NOT require invoking `writing-skills`; doctor and schema are the gates.
- **RF-5.2** THIS delivery SHALL NOT modify `awm-cenco-infra-registry`.

### RNF

- **RNF-1** Fact values and environment stores SHALL NOT be written into registry git paths by CLI commands.
- **RNF-2** Context injection SHALL prefer reference to protect token budget; THE CLI SHALL NOT invent values or silent false resolutions (aligned with D-011).

---

## Verification

- Unit: catalog parse, needs resolution, store statuses (durable vs volatile), inject budget.
- Commands: `env set/status/refresh`, `registry scaffold` (atomic + versions), `registry doctor` structural vs advisory (store-in-tree, version skew, orphan needs, prose heuristics advisory).
- Isolation: override `HOME` / `AWM_HOME` to tmpdirs; never touch the real operator home in tests.
- Fixtures: minimal registry + skill with `needs`; optional prose paths for advisory only (no Cenco migration).

## UI Screens

None — CLI-only surface.

## Suggested plan slices (non-binding)

1. Schema + doctor structural (+ version coherence).
2. Environment store + `awm env` + resolve/inject.
3. `registry scaffold` + handbook template + docs/runbook.
4. Optional baseline authoring accelerator + advisory heuristics.

---

## Self-review

- Placeholder scan: none.
- Consistency: architecture matches RF-*; handbook extensible beyond facts; doctor is gate for existing registries.
- Scope: CLI-first; Cenco migration explicit non-goal; baseline authoring optional later slice.
- Ambiguity: file names (`facts.json`, `REGISTRY.md`), default env name (`default`), command vs prompt, durable default — closed.
- EARS/IDs: RF-1.* … RF-5.*, RNF-1..2 present and testable.
