# Configure AWM

Configuration describes machine state: which providers AWM manages, which one
is the default, and which registries supply reusable content. Repository state
is created later during [project setup](project-setup.md).

## Machine state versus project state

Machine state belongs to the individual developer: provider selection,
preferences, registry cache, hooks, and global artifacts. Project state belongs
to the repository: `.awm/profile.json`, sensor configuration, project context,
and the constitution. Commit the shared project contract; do not commit a
developer's personal provider preferences.

## Choose a provider

One `init` run targets one provider. Run the machine-only variant once for each
provider that you use:

```bash
awm init --agent claude-code --machine-only
awm init --agent codex --machine-only
awm init --agent opencode --machine-only
awm init --agent cursor --machine-only
awm init --agent copilot --machine-only
awm init --agent antigravity --machine-only
```

Claude Code is the default when `awm init` runs on a fresh installation without
`--agent`. Every explicit run enables that provider. The first provider remains
the default when later providers are added.

Provider tiers describe the actual delivery mechanism. Claude Code and Codex
support hooks; other providers receive managed or contextual instructions;
Copilot has no global skill scope and therefore defers content during a
machine-only run. Consult the generated [Support matrix](support-matrix.md) for
paths, capability tiers, prerequisites, and limitations.

## `awm init` variants

### Interactive

Run `awm init` in a terminal when you want confirmation prompts for detected
extensions or registry choices. On a fresh machine it targets Claude Code.

### Non-interactive

Use `--yes` to accept available prompts in automation:

```bash
awm init --agent codex --machine-only --yes
```

### Machine-readable output

Use `--json` for tools that need a structured result. It keeps the init outcome
on stdout; status messages and platform caveats use stderr.

```bash
awm init --agent cursor --machine-only --yes --json
```

`--machine-only` is the boundary that skips project steps. Omit it only when
you are inside a repository and are ready to initialize that project.

## Configure more than one provider

Repeat the relevant single-provider command. AWM records all enabled providers
without replacing the first default. It also tracks shared physical targets:
Codex and OpenCode share a skill directory, so their artifacts are installed
and reconciled as co-owned content rather than as independent copies.

## Inspect enabled and default providers

```bash
awm agent list
awm doctor
awm doctor --agent codex,cursor
```

`awm agent list` distinguishes enabled providers from the default. `awm doctor`
shows a specific provider or all enabled providers.

## Disable a provider safely

```bash
awm agent disable cursor
```

Disabling changes AWM bookkeeping; it intentionally leaves provider-owned files
in place. To disable the current default, select a replacement that will remain
enabled:

```bash
awm agent disable claude-code --default codex
```

## Provider capability tiers

Capability is not a marketing label. A tier states whether AWM can install
hooks, managed configuration, project instructions, or context only. A lower
tier still benefits from the same deterministic project sensors, but some
process discipline is delivered as guidance instead of being enforced by the
provider. See [Agent-specific setup](agents-setup.md) for provider mechanics and
the [Support matrix](support-matrix.md) for the authoritative capability table.

## Extend AWM with custom registries

Custom registries extend the framework without forking the CLI or changing the
official baseline.

### Public registry

```bash
awm registry add <git-url> --no-install
awm registry list
awm init --agent <provider> --machine-only
```

`--no-install` makes registration explicit. The next machine initialization
reconciles machine-scope baseline and ambient bundles; project bundles wait for
project setup. Use the interactive prompt or `--install-all` only when you
intend to install available bundles for the current default provider.

### Private registry over SSH

Use an SSH Git URL after verifying normal Git authentication in the same shell:

```bash
git clone <team-registry-url>
awm registry add <team-registry-url> --no-install
```

AWM uses Git's existing credential and SSH configuration; it does not introduce
a second registry-authentication system.

### Bundle scopes

Bundle scope determines where content is reconciled:

- `dev` and `product` are official baseline bundles installed at compatible
  machine scope.
- Ambient bundles are machine-scoped optional content.
- `frontend` and `authoring` are project-scoped bundles that activate inside a
  repository.

### Updates and pins

Use `awm update` to refresh registered content. Pin a registry version when a
team needs a stable release boundary:

```bash
awm pin <registry> <version>
awm unpin <registry>
```

Machine pins are local; project pins belong in the committed project profile.

### Declared overrides

A custom registry can add bundles or declare controlled overrides. Treat an
override as an engineering dependency: document its owner, pin it when needed,
and verify it in the target project rather than relying on an implicit local
change.

## Sensor-pack compatibility contract

The baseline registry is the canonical pack-author reference. Read its
[`sensor-packs/README.md`](https://github.com/Kodria/awm-baseline-registry/blob/main/sensor-packs/README.md)
when authoring or extending a pack; this guide deliberately does not duplicate
that schema.

A **pack schema v2** declares sensor variants, each with a stable ID, tool and
runtime ranges, a certified range, structured command, contained assets, and a
bounded probe. The resolver selects the highest-priority matching variant from
local project evidence. A probe that cannot establish the facts returns an
honest `compatible-unverified` or `unverifiable` result; it never turns a
timeout, missing local tool, or future version into a false green.

A **legacy pack** has no `schemaVersion`. It remains readable for migration but
has no version-aware variant evidence, so its compatibility is
`compatible-unverified`. Migrate custom packs by preserving their existing
intent, adding v2 variants and contained assets, then testing the command with
the real local tool before claiming certification. Custom registries may extend
the baseline with additional packs; pin and review them as dependencies.

This is a representative portable project manifest. Registry provenance is
local, not a path to copy into another repository:

```json
{
  "schemaVersion": 2,
  "pack": "js-ts",
  "sensors": {
    "lint": {
      "enabled": true,
      "fast": true,
      "variantId": "eslint-10",
      "command": { "executable": "eslint", "resolution": "node-modules-bin", "args": ["."] },
      "assets": ["eslint.config.awm.mjs"],
      "initializedCompatibility": {
        "state": "certified",
        "reason": "local eslint and Node satisfy the selected variant",
        "variantId": "eslint-10",
        "toolVersion": "10.0.0",
        "runtimeVersion": "22.0.0",
        "certifiedRange": ">=10 <11",
        "evidence": []
      }
    }
  }
}
```

### Bounded sensor execution overrides

Schema-v2 preserves a project timeout override while re-resolving the live
pack command. The timeout must be a positive safe integer in milliseconds;
there is no unlimited value. Resolution is `project` → `pack` → `fallback`
(10,000 ms for fast sensors and 120,000 ms otherwise). For example, this
intentionally incomplete fragment shows only the project override — it is not
a complete manifest to copy:

```json
{
  "schemaVersion": 2,
  "pack": "js-ts",
  "sensors": {
    "test": { "enabled": true, "fast": false, "timeout": 600000, "variantId": "npm-script" }
  }
}
```

Projects may also override `inputs` (nonempty relative globs naming what the
sensor measures) and `closureOnly` (boolean on the sensor object, not a
variant). Effective `inputs` come only from the pack variant or an explicit
project override — the CLI never invents them. Without effective `inputs`, a
sensor always executes and is never a cache hit; `awm sensors status` and
`awm preflight` warn that it is not cacheable. Schema-2 Change Record late-path
relaxation ([RF-4.6](cli-reference.md#sensor-receipt)) applies only when every
sensor on the receipt had authored `inputs`. `closureOnly: true` sensors are
skipped by `awm sensors run --slice` and must still pass on the full gate.
Command flags, cache, and receipt shape: [CLI reference](cli-reference.md#awm-sensors-run).

```json
{
  "schemaVersion": 3,
  "pack": "js-ts",
  "sensors": {
    "lint": {
      "enabled": true,
      "fast": true,
      "variantId": "eslint-10",
      "inputs": ["src/**/*.ts", "eslint.config.awm.mjs"]
    },
    "mutation": { "enabled": true, "fast": false, "closureOnly": true }
  }
}
```

Run output adds `execution.timeoutMs`, `timeoutSource`, `elapsedMs`,
`requestedScope`, and `effectiveScope`; scoped work can also expose `files` or
`scopeReason`. Packs may declare a shell-free structured `changedCommand`.
AWM expands its sole `{files}` placeholder as literal argv entries; unsupported
scope, no applicable files, and Git errors remain explicit rather than looking
like a full clean run.

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
Loose files at the project root (for example `.eslintcache`) are always observed.

Before spawning a **structured** sensor whose `executable` is exactly `eslint`, a
read-only run also drops ESLint tool-cache argv so the tool does not create an
observed cache file: `--cache` / `--cache=<value>`, and when enablement was present,
`--cache-location` plus its operand or `--cache-location=<path>`. Other executables
and ordinary `awm sensors run` (non-read-only) keep those flags. Legacy string `cmd`
sensors are not rewritten.

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
  wildcards or line breaks, or end with `/`. An entry is also rejected when any of its
  `/`-separated segments is `.git` or `.awm` (case-insensitive, exact segment match, so
  `my.awm` or `.gitignore-dir` are fine). A directory with such a segment at any depth is
  never skipped, even when a name rule matches.
- The file must be a regular file (a symlink, directory or device is rejected) of at most
  65536 bytes.
- An invalid file blocks read-only runs with reason `admission-config-invalid` and a
  remedy naming the field. Ordinary `awm sensors run` never reads the file.

Internally, a read-only run that gets as far as the snapshot records what it skipped in
the sensor-run result under `readOnlyObservation`: `defaults`, `excluded`, and `rejected`
entries with reason `not-ignored`, `contains-tracked`, or `git-unavailable`. Runs that
stop earlier (an invalid `.awm/admission.json`, a `native-gate` or `opt-out`
declaration, an unresolvable sensor source) do not include the field. That result is
consumed by admission and `awm plan admit` does not print it: what you see is the
sensor verdict, and when it is `not-certified`, the reason and remedy carried by
`ADMISSION_SENSORS_BLOCKED`.

**Accepted risk:** a sensor that changes content inside a skipped directory is not
detected. Content inside a skipped directory is not observed, including any `.awm` or
`.git` nested within it; the project-root `.awm/`, tracked files, `.gitignore` and any
directory that is not skipped are still observed. CLIs older than this feature ignore
`.awm/admission.json` and observe the whole tree.

## What machine initialization installs

Machine initialization seeds and synchronizes registries, records enabled
providers, reconciles compatible machine-scoped bundles, and configures provider
hooks or global context where supported. It does not activate project bundles
or create a repository profile, sensor manifest, constitution, or local
instructions.

## Next: initialize a project

Move to [Initialize a project](project-setup.md) once a provider and any needed
registries are prepared. That guide covers greenfield, existing, cloned,
frontend, and custom-registry repositories.
