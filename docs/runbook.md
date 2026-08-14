# AWM runbook

This is the operating guide for an AWM-enabled project: daily work, team
content, recovery, and rollout. It does not repeat installation or project
bootstrap instructions.

## Before using this runbook

Prepare the developer machine with [installation](installation.md), choose and
manage providers in [configuration](configuration.md), then create or adopt
the repository contract with [project setup](project-setup.md). Those guides
define the ownership boundary between machine state and committed project state.

Use this runbook once that boundary exists. For command syntax and every flag,
use the [CLI reference](cli-reference.md).

<a id="chapter-3--day-to-day-in-a-project"></a>

## Daily development loop

Start work from a current branch and a known harness state:

```bash
awm doctor
awm preflight
```

Follow the lifecycle in [How AWM works](framework.md): discover and make
decisions when the need is still open; plan a concrete change; implement within
the plan; then run the project's verification evidence. A normal implementation
loop is:

1. Read the project's `CONSTITUTION.md` and context before editing.
2. Make the bounded change and run the focused checks while iterating.
3. Run `awm sensors run` with no speed flag before declaring completion.
4. Run the review and verification steps required by the plan.
5. Record recurring findings through the ledger/retrospective flow when the
   process calls for it.

`awm sensors run` is the full completion gate. `--fast` and `--slow` are useful
iteration slices, not substitutes for the full run.

Before the retrospective archives a branch ledger, it automatically evaluates
coverage feedback. Use the same evidence manually when investigating a control
gap:

```bash
awm sensors coverage --min 2
```

`--min` changes recurrence emphasis only; coverage remains read-only. Treat a
reported **compatibility drift** as a configuration review: inspect the selected
variant and local tool evidence, upgrade the registry or project dependency as
needed, then re-run `awm sensors init` explicitly. Do not hand-edit a command
to bypass the resolver.

## Diagnose machine and project state

Use the least invasive command that answers the question:

| Question | Command | What to do with the result |
|---|---|---|
| Which providers are enabled and which is default? | `awm agent list` | Enable a missing provider with `awm init --agent <provider>`; manage defaults through `awm agent disable`. |
| Is provider delivery or project wiring degraded? | `awm doctor` | Follow its named remedy; it distinguishes advisory rows from missing requirements. |
| Can this project actually gate work? | `awm preflight` | Resolve its actionable check before handing work to an unattended quality phase. |
| Are project links missing or stale? | `awm sync` | It repairs supported dangling links and reconciles declared extensions. |
| Is sensor configuration or a tool unhealthy? | `awm sensors status` | Repair configuration/tooling, then re-run the actual sensors. |

`awm doctor` is read-only. `awm preflight` validates that the configured gate is
runnable; it does not run the code checks. Use both `awm preflight` and
`awm sensors run` when you need evidence about project readiness.

If a provider has project-only delivery, a machine-only init intentionally
defers its content. Run normal project initialization in the repository instead
of creating provider files by hand; see [configuration](configuration.md).

## Update CLI versus update content

These are separate release streams:

```bash
# Upgrade the AWM executable
npm i -g agentic-workflow-manager@latest

# Refresh registered registry content
awm update
```

`awm update` fetches registry content and honors pins. With symlink installs,
the refreshed content is visible to existing installs immediately; copied
artifacts need deliberate reinstallation. The command may offer a CLI upgrade
in an interactive terminal, but npm remains the explicit way to update the
binary.

After a substantial content update, inspect state with `awm doctor`. Re-run
`awm init` only when its idempotent reconciliation is needed; do not use it as
a substitute for updating the CLI.

## Synchronize project extensions

The committed `.awm/profile.json` declares project extensions independently of
each developer's provider. After pulling a profile change or joining a project:

```bash
awm sync
awm doctor
```

Run `awm sync --agent <provider>` to limit reconciliation to an enabled
provider. It first repairs only dangling AWM skill links that are safe to
reconcile, then applies the profile in one transaction. It does not overwrite
your unrelated files.

If the profile references a team registry that this machine does not have,
add it first, update it, then sync:

```bash
awm registry add <team-registry-url> --no-install
awm update
awm sync
```

## Sensors, preflight, and baselines

Sensors are deterministic project checks; `preflight` confirms their harness
configuration is credible. Keep the manifest, its config files, and any
accepted baseline under review and committed as part of the shared project
contract.

```bash
awm sensors run        # all configured sensors: completion gate
awm preflight          # configuration/readiness gate
```

For an existing project, review a full initial run before accepting existing
debt:

```bash
awm sensors run
awm sensors baseline
```

The baseline is a ratchet: it accepts reviewed existing findings while new
findings fail the gate. It is not a way to turn an unknown or broken check into
a pass. If the stack changes or the manifest reports pack drift, run
`awm sensors init`, review the generated change, and commit it before relying
on the new configuration.

If the command reports an **orphaned asset**, remove or restore only the
contained asset named by the selected variant, then re-initialize and review
the diff. An orphan is not evidence that any arbitrary local file should be
copied from a registry.

## Backups and recovery

Mutating AWM operations use transactions for the filesystem paths they manage.
Successful `awm init` and `awm sync` output a transaction id and the exact
undo command. Inspect records before restoring:

```bash
awm backup list
awm backup restore <transaction-id>
```

If an init fails, its JSON or human report says whether rollback completed. If
rollback could not restore every target, use the reported transaction id with
`awm backup restore`; do not manually delete provider configuration or project
links first. Backups restore AWM-managed targets, not arbitrary registry
content or unrelated working-tree changes.

## Team registries

A team registry is a Git repository that distributes skills, bundles, sensor
packs, and related content. A registry needs at least one content directory:
`skills/`, `bundles/`, `workflows/`, or `agents/`. The following is a
bundle-oriented example; `catalog.json` is required only when the registry
publishes bundles:

```text
<registry>/
├── skills/<skill-name>/SKILL.md
├── bundles/<bundle-name>/bundle.json
└── catalog.json
```

Create the repository, add the relevant content (and catalog entries when it
publishes bundles), commit it, and give teammates its Git remote. Register it
locally without silently installing every available bundle:

```bash
awm registry add <git-url> --no-install
awm registry list
```

`--install-all` is available when the deliberate goal is to install every
bundle for the current default provider. Otherwise, select an intended bundle
with `awm add <bundle>` or declare it in a project profile.

### Private registries over SSH

Use the same SSH remote that works for Git:

```bash
git clone git@github.com:your-org/your-registry.git
awm registry add git@github.com:your-org/your-registry.git --no-install
```

AWM invokes Git, so the shell's `ssh-agent` and `~/.ssh/config` apply normally.
For headless automation, set `GIT_TERMINAL_PROMPT=0` so a bad credential fails
instead of waiting for interactive input. A failed registry add is atomic: it
does not leave a configured registry or partial clone behind.

## Version pins and rollout

By default `awm update` follows the newest semver tag of each registry. Pin a
version locally when you need to hold one machine at a known release:

```bash
awm pin baseline 1.2.0
awm update
awm unpin baseline
```

A machine pin lives in preferences and is not a team contract. For a rollout
that every developer must reproduce, commit the desired registry versions in
the project's `.awm/profile.json`:

```json
{
  "extensions": ["frontend"],
  "registries": { "baseline": "1.2.0" }
}
```

Roll out a registry release by merging reviewed content, tagging a semver
release, then asking consumers to pull the project contract and run `awm
update` followed by `awm sync`. Untagged commits remain staging content rather
than part of the stable channel. For registry tags on machines that default to
GPG signing, use:

```bash
git -c tag.gpgSign=false tag v1.2.0
git push --tags
```

## Onboard another developer

Have each developer follow [installation](installation.md), choose their
provider in [configuration](configuration.md), and use the cloned-project path
in [project setup](project-setup.md#clone-a-repository-that-already-uses-awm).
Do not copy another developer's provider directories.

Document non-baseline registry URLs in the repository README or team operating
notes. The profile can declare extension names and pins but does not contain
credentials or invent a missing remote; add the documented registry before
running the project-setup synchronization step.

## Author and release custom content

Skills are Markdown instructions with a small frontmatter contract. Start a
new skill with a clear trigger and keep references or scripts beside it:

```md
---
name: your-skill-name
description: Use when the agent needs to perform the named task.
---

# Your skill title
```

Group compatible skills into a bundle in `bundles/<bundle-name>/bundle.json`,
declare that bundle in `catalog.json`, and test it in a target project before
release.
Use the `authoring` extension when available: it provides the content-authoring
workflow rather than requiring authors to infer registry conventions.

Release custom content deliberately:

1. Make and review the registry change.
2. Commit and push it to the registry repository.
3. Tag a semver version and push the tag.
4. Update and sync a representative consumer project.
5. Pin that version in the project profile when the rollout needs a fixed
   contract.

For critical code paths, mutation testing can be enabled in the project's
sensor manifest and then runs as part of the full sensor command. Keep it
opt-in and scoped so normal development remains practical.

## Troubleshooting

| Symptom | Action |
|---|---|
| `awm` is not found | Return to [installation](installation.md#install-or-upgrade-the-cli) and fix npm's global bin path. |
| Registry add/update cannot authenticate | Verify `git clone <url>` in the same shell; use an SSH remote and a working agent for private content. |
| A project extension is missing | Add its documented registry, run `awm update`, then `awm sync`. |
| A provider's machine-only run deferred content | This is expected for project-only delivery; run `awm init --agent <provider>` inside the repository. |
| `awm preflight` is degraded | Follow the named remedy, then run `awm sensors run` to collect actual check evidence. |
| A legacy project always has findings | Review a full run and use `awm sensors baseline` only to record accepted pre-existing debt. |
| A session lacks new context | Start a new provider session after normal initialization; see [agent-specific setup](agents-setup.md). |
| An operation needs undoing | Find its transaction with `awm backup list`, then run `awm backup restore <transaction-id>`. |

## See also

- [Installation](installation.md) — CLI and machine preparation.
- [Configuration](configuration.md) — providers, defaults, and multiple-provider setup.
- [Project setup](project-setup.md) — initialize or adopt a repository.
- [CLI reference](cli-reference.md) — commands and flags.
