# Design: Accept Codex prerelease version strings (#254)

**Status:** approved 2026-11-27 (owner)  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/254  
**Branch:** `cursor/issue-254-codex-prerelease-6441`  
**Change Record:** `codex-prerelease-version-parse`  
**Approach:** Widen Codex `versionPattern` only; keep core `X.Y.Z` compare via existing `compareSemver`

## Goal

`awm init -a codex` must accept `codex --version` lines such as `codex-cli 0.172.0-alpha.2` (and optional `+build` metadata) when the numeric core meets `minimumVersion: '0.145.0'`, instead of failing with `could not parse Codex version`. Unrecognized formats stay fail-closed; stable cores below the floor still reject with `requires Codex >= …`.

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Prereleases | **Accept** when core `X.Y.Z` ≥ minimum |
| Build metadata (`+…`) | **Accept** (whatever is needed so real Codex lines do not fail) |
| Compare policy | Core triple only (existing `compareSemver`); not strict semver where prerelease &lt; stable |
| Scope of providers | Codex only; Cursor date-hash pattern unchanged |
| Message redesign | Out — keep `could not parse` for non-matching lines |
| Core-only floor (P1) | **Accepted risk** — `0.145.0-beta.1` passes `>= 0.145.0` even though strict semver treats prerelease as older; owner chose permissive onboarding over strict ordering |
| Display string (P2) | Out of this PR — doctor may show the bare core (`0.172.0`) for an alpha install; optional follow-up to surface the full line |
| Docs (P3) | Plan implementation updates `docs/agents-setup.md` to note prerelease/build cores that meet the floor |

## Specialist verdicts (at approach selection)

- **architecture-advisor:** not applicable — single regex + existing gate.
- **technology-evaluator:** not applicable — no new dependency.
- **nfr-checklist-generator:** trivial — fail-closed on unrecognized output; do not loosen Cursor or other providers.

## Scope

**In**

- `cli/src/providers/index.ts` — Codex `versionCommand.versionPattern`
- `cli/tests/core/provider-version.test.ts` — accept alpha/beta/`+build`; keep reject matrix for garbage
- `cli/tests/providers/index.test.ts` — expected pattern string
- Change Record + draft PR closing #254

**Out**

- Changing `assertProviderSupported` control flow or returned version shape beyond capturing group 1 (still the core)
- Strict semver prerelease ordering
- New “prerelease not supported” messaging
- Cursor / other agent version patterns
- Raising or lowering `minimumVersion`

## Requirements (EARS)

- **RF-1.1** — WHEN Codex `--version` stdout matches `codex-cli X.Y.Z` optionally followed by a semver prerelease (`-[0-9A-Za-z.-]+`) and/or build (`+[0-9A-Za-z.-]+`) and nothing else on the trimmed line, and the captured core compares ≥ `0.145.0` via `compareSemver`, THEN THE CLI SHALL accept and return `{ provider: 'codex', version: '<core>' }`.
- **RF-1.2** — IF the captured core compares &lt; `0.145.0` (stable or with optional suffix), THEN THE CLI SHALL reject with the existing `requires Codex >= 0.145.0` message class (found core in the message path unchanged).
- **RF-1.3** — IF the trimmed stdout does not match the widened pattern (including `v` prefix, incomplete triples, leading noise, trailing tokens, wrong tool name), THEN THE CLI SHALL reject with `could not parse Codex version from: …`.
- **RF-1.4** — THE change SHALL NOT alter Cursor’s `YYYY.MM.DD-hash` pattern or providers without a version gate.

## Architecture

Single-line config change in `providers/index.ts`:

```ts
versionPattern: /^codex-cli (\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
```

`assertProviderSupported` already uses `match[1]` + `compareSemver(match[1], minimumVersion)`. No logic change required there. `compareSemver` already parses only the leading `X.Y.Z` triple.

## Error handling

| Input (trimmed) | Result |
|---|---|
| `codex-cli 0.172.0` | Accept → `0.172.0` |
| `codex-cli 0.172.0-alpha.2` | Accept → `0.172.0` |
| `codex-cli 0.145.0-beta.1` | Accept → `0.145.0` |
| `codex-cli 0.172.0-alpha.2+exp.sha.5114f85` | Accept → `0.172.0` |
| `codex-cli 0.144.9` / `codex-cli 0.144.9-alpha.1` | Reject `requires Codex >= 0.145.0` |
| `codex-cli v0.145.0`, trailing tokens, wrong prefix, incomplete version | Reject `could not parse` |

## Testing

- Flip existing reject case `codex-cli 0.145.0-beta.1` → accept returning `0.145.0`.
- Add accept cases: `0.172.0-alpha.2`, one with `+build`.
- Keep reject cases: under-floor stable, garbage formats.
- Update `providers/index.test.ts` Codex metadata expect for the new regex.

## UI Screens

None — no direct interaction / layout surface.

## Accepted risks

- **P1 (core-only floor):** A prerelease whose core equals the minimum (e.g. `0.145.0-beta.1`) is accepted. If that build lacks hooks-native behavior assumed by `0.145.0` stable, init may configure an unsupported runtime. Mitigate later only if real Codex alphas at the floor misbehave — not by inventing strict semver in this change.
- **P2 (display):** Operator-facing version strings may omit the prerelease suffix until a separate display change.

## Self-review

- No TBD/TODO placeholders.
- Scope matches locked owner decisions (accept + build; Codex-only; P1 accepted).
- Each RF is 1:1 testable against `provider-version.test.ts` / `providers/index.test.ts`.
- No contradiction with `compareSemver` core-only parsing.
