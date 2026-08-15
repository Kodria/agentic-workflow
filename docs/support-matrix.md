# Support matrix

**What AWM supports, the evidence behind it, and what it does not support yet.**

This document is an explicit contract. A combination not listed here is not supported. A row marked `⚠ unverified` may be described as *implemented and awaiting verification*, never as working.

---

## Evidence levels

The same vocabulary applies to every table. The distinction between the first two levels is especially important:

| Level | Exact meaning | Public claim |
|---|---|---|
| **✅ Verified** | Implemented **and** exercised by an automated CI check or a recorded playbook run. | “Works.” |
| **⚠ Unverified** | Implemented from provider documentation, but **not executed against the real binary**. | “Implemented; verification remains.” Never “works.” |
| **⛔ Unsupported** | A deliberate decision with a stated reason, not a bug or deferred task. | “Unsupported, for this reason.” |
| **🔜 Planned** | A known gap with the required work identified. | “Not yet.” |
| **❌ Verified not working** | Implemented and **executed against the real binary**, but did not deliver its promise. | “Tested and does not work.” Do not degrade negative evidence to ⚠. |

> **Hard rule:** a `BLOCKED` playbook run is never recorded as verified. It remains unverified.

---

## Provider capabilities

This section is **generated from `cli/src/providers/index.ts`**. Do not edit it by hand.

The generated source is the provider configuration, so installation paths and declared capabilities cannot drift from the code.

<!-- BEGIN GENERATED: provider-capabilities -->

### Where each artifact is installed

| Agent | Tier | Skills (global) | Skills (project) | Renderer |
|---|---|---|---|---|
| `antigravity` | context-only | `~/.gemini/antigravity/skills` | `.agent/skills` | `link` |
| `opencode` | config-managed | `~/.agents/skills` | `.agents/skills` | `link` |
| `claude-code` | hooks-native | `~/.claude/skills` | `.claude/skills` | `link` |
| `codex` | hooks-native | `~/.agents/skills` | `.agents/skills` | `link` |
| `cursor` | agents-md-managed | `~/.cursor/rules` | `.cursor/rules` | `cursor-mdc` |
| `copilot` | agents-md-managed | **unsupported** | `.github/instructions` | `copilot-instructions` |

### Agent profiles, workflows, hooks, and context

| Agent | Agent profiles | Workflows | Hooks | Context delivery | Minimum version |
|---|---|---|---|---|---|
| `antigravity` | — (not applicable) | `~/.gemini/antigravity/global_workflows` | — (none) | — (none) | — (no gate) |
| `opencode` | `~/.config/opencode/agents` · `link` | — (not applicable) | — (none) | `~/.config/opencode/opencode.json` → `instructions` field | — (no gate) |
| `claude-code` | `~/.claude/agents` · `link` | — (not applicable) | `cc-settings-merge` | hook `SessionStart` | — (no gate) |
| `codex` | `~/.codex/agents` · `codex-agent-toml` | — (not applicable) | `codex-hooks-json` | `AGENTS.md` + `~/.codex/AGENTS.md` | 0.145.0 |
| `cursor` | — (not applicable) | — (not applicable) | — (none) | project `AGENTS.md` (no global equivalent) | — (no gate) |
| `copilot` | — (not applicable) | — (not applicable) | — (none) | project `AGENTS.md` (no global equivalent) | — (no gate) |

> Generated from `cli/src/providers/index.ts`. **Do not edit by hand** — `npm run docs:matrix` regenerates it and
> `tests/structural/support-matrix-is-current.test.ts` fails when the document and code diverge.

<!-- END GENERATED: provider-capabilities -->

### What each tier means

| Tier | Loads skills | Runs hooks | Process role |
|---|---|---|---|
| `hooks-native` | yes | yes | Re-anchors process guidance at session boundaries; it does not enforce agent behavior |
| `config-managed` | yes | no | Context is delivered; discipline is read |
| `agents-md-managed` | yes (rendered) | no | Context is delivered; discipline is read |
| `context-only` | yes | no | No automatic context-delivery mechanism |

The deterministic layer—`awm sensors run`, its exit status, and its quality gate—is **independent of the provider** and identical for all six providers. It is a real command with a real exit status; it does not depend on agent cooperation. Only `awm sensors run` is an enforceable deterministic gate; tiers change context delivery, not code verification.

---

## Provider support status

| Provider | Artifact installation | Context delivery | Hooks | Evidence |
|---|---|---|---|---|
| **Claude Code** | ✅ Verified | ✅ Verified | ✅ Verified | CI suite and isolated E2E coverage, plus the real-binary [`agent-matrix`](testing/agent-matrix.md) playbook. |
| **Codex** | ✅ Verified | ✅ Verified | ✅ Verified | Real-binary playbook verified configuration under `CODEX_HOME`, trusted `SessionStart`, and the resulting heartbeat. The minimum supported version is `0.145.0`, from `providers/index.ts`. |
| **OpenCode** | ✅ Verified | ✅ Verified | ⛔ Unsupported by provider | Isolated real-binary playbook verifies the `instructions` configuration path; OpenCode has no hook mechanism. |
| **Cursor** | ✅ Verified | ⚠ Unverified | ⛔ Unsupported by provider | AWM renders and integrity-checks the `.mdc` rule; loading it in a real Cursor session is not recorded. |
| **Copilot** | ✅ Verified (project only) | ✅ Verified | ⛔ Unsupported by provider | Project-scoped rendered instructions and context were verified with the provider. Global skill delivery is deliberately unsupported. |
| **Antigravity** | ✅ Verified | ⛔ Unsupported by provider | ⛔ Unsupported by provider | Artifact delivery is verified. It has no managed context or hook mechanism. |

### Unsupported scope vs. absent configuration

An unsupported capability is an explicit provider limit; an absent configuration path means AWM has no confirmed file-based path and does not invent one. Neither is a pending defect.

- **Claude Code:** workflows are not a provider capability; hooks and managed context are configured.
- **Codex:** workflows are not a provider capability; `CODEX_HOME` is the configuration root when set, while shared skills remain under `~/.agents/skills`.
- **OpenCode:** workflows and hooks are not provider capabilities; its `opencode.json` instructions path is configured.
- **Cursor:** profiles, workflows, and hooks are not provider capabilities. Its global context path is absent (`null`), not an unsupported filesystem scope, because its user rules are app settings rather than a confirmed file.
- **Copilot:** global skills are explicitly **unsupported**: it has no user-level skill discovery. `awm add -a copilot --scope global` must fail with that reason. Profiles, workflows, hooks, and a global context file are not provider capabilities.
- **Antigravity:** profiles, hooks, and managed context delivery are not provider capabilities; its skill and workflow paths are configured.

---

## Operating-system support status

| System | Level | Evidence |
|---|---|---|
| **Linux** | ✅ Verified | Full suite in CI on every pull request and push to `main` (`ubuntu-latest`). |
| **Windows (native)** | ✅ Verified | Full suite in CI on every pull request and push to `main` (`windows-latest`). |
| **macOS** | ✅ Verified | Full suite in CI on every pull request and push to `main` (`macos-latest`). |
| **WSL** | ⚠ Unverified | WSL is Linux (`process.platform === 'linux'`), but requires the Linux filesystem and has no separate recorded run. See [os-matrix](testing/os-matrix.md). |

**Node.js:** 22 or newer, as declared in `engines`. Older versions are unsupported.

### Where support differs by command

Most CLI commands behave consistently across supported systems. The exceptions are explicit:

| Capability | Linux / macOS / WSL | Native Windows |
|---|---|---|
| `init` · `update` · `sync` · `add` · `remove` · `sensors` · `preflight` · `doctor` · `export` · `backup` · hooks | ✅ Verified | ✅ Verified in CI |
| **Symlink** installation (updates propagate automatically) | ✅ Verified | Directory artifacts use **junctions**. File symlinks require Developer Mode; otherwise AWM falls back to a **copy**. Copy mode works, but `awm update` cannot propagate registry changes—reinstall the copied artifact. |
| `awm watch` supervision and gate | ✅ Verified | ✅ Verified |
| `awm watch`: wrapper survives supervisor death | ✅ Verified | ⚠ **Unverified.** POSIX uses `detached: true` so the wrapper survives parent termination. The crash-recovery E2E is POSIX-only; native Windows does not claim that guarantee. See `cli/src/core/journal/process.ts`. |

The final row is the only product capability with different OS evidence. It is a documented native-Windows limitation, not an assertion of crash recovery that has not been verified.

### Windows symlink caveat

Windows directory symlinks need `SeCreateSymbolicLinkPrivilege`, which ordinary accounts usually lack. AWM therefore uses **junctions** for directories and falls back to a **copy** when a file symlink fails. Copy-mode artifacts are supported but must be reinstalled after their registry source changes.

---

## Content registries

| Registry | Level | Role |
|---|---|---|
| `awm-baseline-registry` | ✅ Verified | Seeded by default by `awm init`. |
| `awm-documentation-registry` | ⚠ Unverified | Opt in with `awm registry add`. |
| Team-owned registries | ✅ Verified | Any Git repository with the supported content layout. See the [runbook](runbook.md). |
| Git hosts | ✅ Verified | Host-agnostic (GitHub, GitLab, and self-hosted); resolved from the Git URL without provider APIs. |

## Sensor packs

This generated section reports what the pack contract declares. It does not turn
a manifest range into a claim that a real binary has been certified: the
registry release evidence is the source for that separate claim.

<!-- BEGIN GENERATED: sensor-pack-support -->

### Sensor-pack compatibility contract (published registry evidence)

| Pack | Contract | Version-aware variants and certified ranges | Evidence status |
|---|---|---|---|
| `generic` | pack schema v2 | `security/semgrep-generic`: semgrep >=1.0.0; python >=3.9.0; certified =1.173.0 | Published compatibility contract; certification evidence is reproduced below from the registry |
| `js-ts` | pack schema v2 | `lint/eslint-8-eslintrc`: eslint >=8.0.0 <9.0.0; node >=16.0.0; certified =8.57.1<br>`lint/eslint-8-flat`: eslint >=8.0.0 <9.0.0; node >=16.0.0; certified =8.57.1<br>`lint/eslint-9-flat`: eslint >=9.0.0 <10.0.0; node >=18.18.0; certified =9.39.5<br>`lint/eslint-10-flat`: eslint >=10.0.0 <11.0.0; node >=20.19.0; certified =10.8.1<br>`typecheck/typescript-native`: typescript >=5.0.0; node >=16.0.0; certified =5.9.3<br>`security/semgrep-js-ts`: semgrep >=1.0.0; python >=3.9.0; certified =1.173.0<br>`depcheck/dependency-cruiser`: dependency-cruiser >=16.0.0; node >=18.0.0; certified =16.10.4<br>`format/prettier`: prettier >=3.0.0; node >=16.0.0; certified =3.9.6<br>`test/npm-script`: npm >=8.0.0; node >=16.0.0; certified >=8.0.0<br>`test/pnpm-script`: pnpm >=8.0.0; node >=16.0.0; certified >=8.0.0<br>`test/yarn-script`: yarn >=1.22.0; node >=16.0.0; certified >=1.22.0<br>`test/bun-script`: bun >=1.0.0; bun >=1.0.0; certified >=1.0.0<br>`mutation/stryker`: stryker >=8.0.0; node >=18.0.0; certified >=8.0.0 | Published compatibility contract; certification evidence is reproduced below from the registry |
| `python` | pack schema v2 | `typecheck/mypy-native`: mypy >=1.18.0 <2.0.0; python >=3.9.0; certified =1.18.2<br>`lint/ruff-native`: ruff >=0.1.0; python >=3.9.0; certified =0.16.3<br>`security/semgrep-python`: semgrep >=1.0.0; python >=3.9.0; certified =1.173.0<br>`test/pytest-native`: pytest >=8.0.0 <9.0.0; python >=3.9.0; certified =8.4.2<br>`mutation/mutmut-opt-in`: mutmut >=2.0.0; python >=3.9.0; certified >=2.0.0 | Published compatibility contract; certification evidence is reproduced below from the registry |
| `shell` | pack schema v2 | `lint/shellcheck-files`: shellcheck >=0.9.0; shellcheck >=0.9.0; certified =0.11.0<br>`security/semgrep-shell`: semgrep >=1.0.0; python >=3.9.0; certified =1.173.0 | Published compatibility contract; certification evidence is reproduced below from the registry |


#### Published certification evidence

Generated from pack manifests and certification pins resolved at `2026-08-14T22:14:34.365Z`.

Status: `certified` has a matching frozen tool pin; `compatible-unverified` has no matching frozen pin; `not-applicable` is reserved for variants without a tool contract.

| Pack | Sensor | Variant | Tool | Certified range | Supported OS | OS certification evidence | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `generic` | `security` | `semgrep-generic` | `semgrep` | `=1.173.0` | Ubuntu, macOS, Windows | Ubuntu: real tool; macOS/Windows: contract | certified | pin: `semgrep@1.173.0` |
| `js-ts` | `depcheck` | `dependency-cruiser` | `dependency-cruiser` | `=16.10.4` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `dependency-cruiser@16.10.4` |
| `js-ts` | `format` | `prettier` | `prettier` | `=3.9.6` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `prettier@3.9.6` |
| `js-ts` | `lint` | `eslint-10-flat` | `eslint` | `=10.8.1` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `eslint@10.8.1` |
| `js-ts` | `lint` | `eslint-8-eslintrc` | `eslint` | `=8.57.1` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `eslint@8.57.1` |
| `js-ts` | `lint` | `eslint-8-flat` | `eslint` | `=8.57.1` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `eslint@8.57.1` |
| `js-ts` | `lint` | `eslint-9-flat` | `eslint` | `=9.39.5` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `eslint@9.39.5` |
| `js-ts` | `mutation` | `stryker` | `stryker` | `>=8.0.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |
| `js-ts` | `security` | `semgrep-js-ts` | `semgrep` | `=1.173.0` | Ubuntu, macOS, Windows | Ubuntu: real tool; macOS/Windows: contract | certified | pin: `semgrep@1.173.0` |
| `js-ts` | `test` | `bun-script` | `bun` | `>=1.0.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |
| `js-ts` | `test` | `npm-script` | `npm` | `>=8.0.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |
| `js-ts` | `test` | `pnpm-script` | `pnpm` | `>=8.0.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |
| `js-ts` | `test` | `yarn-script` | `yarn` | `>=1.22.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |
| `js-ts` | `typecheck` | `typescript-native` | `typescript` | `=5.9.3` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `typescript@5.9.3` |
| `python` | `lint` | `ruff-native` | `ruff` | `=0.16.3` | Ubuntu, macOS, Windows | Ubuntu: 3.9 + 3.12 real; macOS/Windows: 3.12 smoke | certified | pin: `ruff@0.16.3` |
| `python` | `mutation` | `mutmut-opt-in` | `mutmut` | `>=2.0.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |
| `python` | `security` | `semgrep-python` | `semgrep` | `=1.173.0` | Ubuntu, macOS, Windows | Ubuntu: real tool; macOS/Windows: contract | certified | pin: `semgrep@1.173.0` |
| `python` | `test` | `pytest-native` | `pytest` | `=8.4.2` | Ubuntu, macOS, Windows | Ubuntu: 3.9 + 3.12 real; macOS/Windows: 3.12 smoke | certified | pin: `pytest@8.4.2` |
| `python` | `typecheck` | `mypy-native` | `mypy` | `=1.18.2` | Ubuntu, macOS, Windows | Ubuntu: 3.9 + 3.12 real; macOS/Windows: 3.12 smoke | certified | pin: `mypy@1.18.2` |
| `shell` | `lint` | `shellcheck-files` | `shellcheck` | `=0.11.0` | Ubuntu, macOS, Windows | Ubuntu: real tool; macOS/Windows: contract | certified | pin: `shellcheck@0.11.0` |
| `shell` | `security` | `semgrep-shell` | `semgrep` | `=1.173.0` | Ubuntu, macOS, Windows | Ubuntu: real tool; macOS/Windows: contract | certified | pin: `semgrep@1.173.0` |

| Certification status | Derived variant count | Meaning |
| --- | --- | --- |
| certified | 15 | Matching frozen tool pin |
| compatible-unverified | 6 | No matching frozen tool pin |
| not-applicable | 0 | Variant has no tool contract |

> Generated from the supplied published `awm-baseline-registry` root. Certification states, frozen pins, and OS evidence are registry-owned metadata reproduced verbatim; **do not edit by hand**.

<!-- END GENERATED: sensor-pack-support -->

An absent pack is **not invented**: `awm sensors init` selects an available pack and reports the missing one; `awm preflight` fails while the gate is empty.

---

## 🔜 Planned work

These are identified improvements, not current product defects:

| # | Work | Why it matters | Result |
|---|---|---|---|
| 1 | **CI with real provider binaries** | Unit tests cannot replace real-provider execution. | More provider rows can become verified. |
| 3 | **Project-scope reconciliation in `awm update`** | `update` reconciles machine artifacts; `awm sync` owns project artifacts. | Removes a manual synchronization step. |
| 4 | **Run `python` and `shell` packs against real projects** | Their tool integration is implemented but lacks recorded real-project evidence. | Can verify two sensor packs. |
| 5 | **A seventh provider** | The capability model supports a localized provider entry and renderer mapping. | Broadens coverage. |

---

## Verify these claims

Each claim has a direct check:

| Claim | Verification |
|---|---|
| Provider capabilities | `npm run docs:matrix`—a change means the checked-in generated block was stale. |
| The generated table cannot drift | `npx jest tests/structural/support-matrix-is-current` |
| Linux, native Windows, and macOS | The CI matrix on every pull request and push to `main`. |
| Provider and OS acceptance | [core-acceptance](testing/core-acceptance.md), [os-matrix](testing/os-matrix.md), and [agent-matrix](testing/agent-matrix.md). |

The playbooks use `--json`, parsed fields, and exit statuses rather than human-readable output. For Codex configuration-root evidence, see [`decisions.md`](decisions.md) D-011.
