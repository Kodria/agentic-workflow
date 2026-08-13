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
