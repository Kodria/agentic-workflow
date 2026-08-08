# Architecture

How AWM is put together, what it writes where, and which invariants hold it up.

For *why* the lifecycle is shaped this way, see [sdlc.md](sdlc.md). For the authoritative support matrix, see [`CONSTITUTION.md`](../CONSTITUTION.md#matriz-de-soporte).

---

## 1 · CLI and content are separate repos

```
  agentic-workflow (this repo)        awm-baseline-registry (+ your team's)
  ┌──────────────────────────┐        ┌──────────────────────────────────┐
  │ cli/  → npm              │        │ skills/ bundles/ sensor-packs/   │
  │        the tool          │        │ agents/ workflows/               │
  └──────────────────────────┘        └──────────────────────────────────┘
        released by version                  released by git tag
```

They ship on different clocks, and that's the point: your team's skills change weekly, the CLI doesn't.

- **CLI** — `cli/`, published to npm as `agentic-workflow-manager`. Updated with `npm i -g …@latest`.
- **Content** — separate git repos. Updated with `awm update`.

**Consequence worth internalising:** editing a file under `~/.awm/registries/` does nothing durable — the next `awm update` overwrites it. Content is edited **in its registry repo**, tagged, then pulled. The latency between editing a registry and seeing it installed is expected and correct.

---

## 2 · On-disk state

### Machine (`~/.awm/`, or `$AWM_HOME`)

| Path | Holds |
|---|---|
| `registries/<name>/` | Clone of each configured registry — the content cache |
| `hooks/` | Session-hook scripts installed into agents |
| `config.json` | Machine config: registries, pins |
| `backups/` | Restorable copies of user-owned files AWM rewrote |

**This directory belongs to the installer.** `awm init` and `awm update` own it. Hand-editing it produces states the CLI can't reason about — if something's wrong, fix the source (the registry repo) and re-run, don't patch the cache.

### Project (`<repo>/.awm/`)

| Path | Holds | Commit it? |
|---|---|---|
| `profile.json` | What this project uses — the reproducible declaration | **Yes** |
| `sensors.json` | The project's sensor manifest | **Yes** |
| `sensors.baseline.json` | Snapshot of pre-existing findings (legacy ratchet) | **Yes** |
| `ledger/<branch>.jsonl` | Per-branch findings, for the retro | No (gitignored) |
| `journal/<branch>/` | Durable job state for `awm watch` | No |

`profile.json` is the interesting one: it's **agent-agnostic**. It records *what* the project needs, not *where* it goes. Each developer's `awm init -a <their agent>` resolves that to their own paths — which is how one committed file serves a team using six different agents.

### Agent targets

Written outside the repo, per agent — see [agents-setup.md](agents-setup.md) for the full table.

---

## 3 · Content discovery

`contentRoots()` returns the configured registry paths. Every discovered artifact is stamped with the `contentRoot` it came from, so downstream install logic always resolves an absolute path back to the right registry.

**Name collisions across registries are an error, not a silent last-wins.** If two registries ship a skill with the same name, AWM refuses — unless the later registry *declares* the override in its `awm-registry.json`. Silent shadowing is how a team ends up running content nobody chose.

---

## 4 · Providers: capability, not identity

Six targets: `antigravity`, `opencode`, `claude-code`, `codex`, `cursor`, `copilot`.

Each declares a **capability profile** in `cli/src/providers/index.ts` — not a set of special cases:

```ts
{
  skill:     { global: string | null, local: string, renderer: RendererId,
               globalUnsupportedReason?: string },
  agent:     { … } | null,
  workflow:  { … } | null,
  hooks?:    { type, settingsPath, scriptsDir, matcher, eventName },
  injection?:{ type, … },
  minimumVersion?: string,
}
```

Everything downstream is supposed to branch on **declared capability**, never on a provider id. `global: null` means "this provider has no such scope", and `globalUnsupportedReason` carries the human explanation so an error can say *why* instead of just failing.

> This is the abstraction's real test, and it has failed twice: `awm init -a copilot` crashed because a fact-gathering function treated `skill.global === null` as *missing* rather than *not applicable*, and `awm add -a codex` crashed because one of four frontmatter parsers didn't handle a valid YAML form. Both were "a provider takes a path nobody exercised". **Any new `if (provider === 'x')` is a future bug of the same shape.**

### Renderers

An artifact is either **linked** or **transformed**:

| Renderer | Used by | Produces |
|---|---|---|
| `link` | claude-code, codex, opencode, antigravity | Symlink into the registry clone |
| `cursor-mdc` | cursor | `.mdc` rule with YAML frontmatter |
| `copilot-instructions` | copilot | `.instructions.md` with `applyTo` |
| `codex-agent-toml` | codex (agent profiles) | TOML profile |

Every transforming renderer must **escape for its output format** — YAML for `.mdc`, TOML for codex. This is not theoretical: unescaped `:`/`#`/control bytes in a description have produced malformed output before, which is why the escaping is centralised and tested against a real parser.

---

## 5 · Symlink vs. copy

**Symlink (default).** The installed artifact is a window onto `~/.awm/registries/<name>/skills/<name>/`. An `awm update` propagates instantly — nothing to re-install.

**Copy (`--method copy`).** A hard clone, disconnected from updates. Two legitimate uses: forking a skill to modify locally, and Windows without Developer Mode (where unprivileged symlink creation is blocked).

---

## 6 · Transactional installs

`awm init` and installs that touch user-owned files run as a **transaction**:

1. Back up every file about to be modified
2. Apply the steps
3. On any failure → restore every backed-up path, commit nothing

The JSON output reports `applied` / `pending` / `failed` plus `modifiedFiles`, so a failed run tells you exactly what it touched and restored.

**One transaction per user-facing operation, not per bundle.** `awm sync` over a profile with N extensions builds a single plan and applies it once: a failure on the third extension leaves the first two uninstalled too, rather than a tree matching neither the before nor the after state. The transaction id is printed with the `awm backup restore` invocation that undoes it — an id nobody can name is an id that doesn't exist.

**AWM merges into user-owned files, never clobbers them.** `~/.claude/settings.json`, `AGENTS.md`, `opencode.json` all belong to the user; AWM owns only its managed block within them. `awm backup` keeps the restorable copies.

---

## 7 · Sensors

Per-project, declared in `.awm/sensors.json`, generated from a **sensor pack** for the detected stack (`js-ts`, `python`, `shell`, `generic`).

Detection is a convenience; `awm sensors init --pack <name>` is the contract. If no pack exists for the detected stack, the manifest is **honestly empty** — AWM does not invent defaults (that behaviour, `FALLBACK_DEFAULTS`, was deliberately removed).

`awm sensors run` is **read-only**: it runs the manifest as committed and never rewrites `.awm/sensors.json` or copies pack config files into the tree. When the manifest's pack no longer matches the tree it reports the drift (`packDrift`) and names `awm sensors init`, the verb that adopts a pack. A measuring command that edits what it measures was a real bug, not a hypothetical.

Execution is `execFileSync` with an **argument array — never a shell string**. Filenames reaching a sensor can come from `git diff` on an untrusted checkout, and on Windows a shell round-trip re-opens the batch-argument-injection class (CVE-2024-27980). No shell, no injection surface.

---

## 8 · Invariants

The rules the design rests on. Violating any one of these produces a bug of a class this project has already paid for:

1. **Silence is never evidence.** A tool that failed to run reports "unknown", never "clean". A `ps` that can't see a process does not mean the process is dead.
2. **Never declare death without positive evidence.** Fail toward "alive" — treating a live job as dead can duplicate work or corrupt state.
3. **`~/.awm` belongs to the installer.** Never hand-edited, including by tests (all tests use isolated tmpdirs with `HOME`/`AWM_HOME` overridden).
4. **Merge into user files, never clobber.** Always with a restorable backup.
5. **Branch on capability, not on provider id.**
6. **One implementation per concept.** Duplicated logic drifts, and the drift is the bug — four copies of a frontmatter parser produced four different failures, and a fourth copy of the renderer→extension mapping outlived the collapse of the first three. This applies to **documentation too**: the provider paths in [`support-matrix.md`](support-matrix.md) are generated from `providers/index.ts` and locked by a test, because the hand-written copy had been wrong about Antigravity for several releases.
7. **The deterministic gate outranks every judgement.** No review or lens overrides a red sensor.

---

## 9 · Release

Pushing to `main` triggers `.github/workflows/release.yml`: build → full test suite → version bump from the conventional-commit prefix (`feat` → minor, `fix` → patch, `!`/`BREAKING` → major) → `npm publish` via OIDC trusted publisher.

Never run `npm publish` by hand, and never add a parallel publish workflow. CI gates the release on the tests passing — that gate is the point.

---

## Related

- [SDLC](sdlc.md) · [Installation](installation.md) · [Agent setup](agents-setup.md)
- [CLI reference](cli-reference.md) · [Runbook](runbook.md)
- [Support matrix](support-matrix.md) — what is supported, at what evidence level
- [Acceptance playbooks](testing/README.md)
