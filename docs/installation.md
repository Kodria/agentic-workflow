# Install AWM and prepare the machine

This guide prepares a developer machine. It deliberately stops before project
initialization: run that separate phase only inside the repository AWM will
manage.

Prepare the machine first, then initialize a project; the two phases have
different owners and write different artifacts.

## What this phase changes

Machine preparation can install the CLI, AWM preferences and registry cache,
provider hooks, global skills, and global provider context where a provider
supports them. It must not create a project profile, sensors, a constitution,
or local provider instructions in the current directory.

Copilot has no global skill scope. Its machine setup records the provider and
defers project-only content until normal project initialization; see
[Configure AWM](configuration.md#choose-a-provider).

## Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Node.js 22 or newer | Required by the published CLI. | `node --version` |
| Git | Registries are Git repositories. | `git --version` |
| One supported provider | AWM configures one provider per init run. | [Agent-specific setup](agents-setup.md) |

`gh` or `glab` are optional: they are useful when a workflow prepares pull
requests, but they are not required to initialize AWM. Project sensors may need
additional tools for the selected stack; their manifest reports a missing tool
as a failure or inconclusive result rather than a clean pass.

## Install or upgrade the CLI

```bash
npm i -g agentic-workflow-manager
awm --version
```

Upgrade the CLI through npm:

```bash
npm i -g agentic-workflow-manager@latest
```

`awm update` always refreshes registry content. When it detects a newer published
CLI, it can also offer the npm self-update; pass `--yes` to accept that update in a
non-interactive run. The explicit alternative remains:

```bash
npm i -g agentic-workflow-manager@latest
```

## Freshness gate for cacheable environments

Before an unattended run that must prove the installed CLI and every configured
registry are current, bootstrap the published CLI and run strict preflight in
one command:

```bash
npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight --require-current
```

This strict check is read-only. It reports separate compatibility
(`minCliVersion`) and currentness verdicts. Update a stale registry with
`awm update --yes`; first remove a pin with `awm unpin REGISTRY_NAME` when the
report says `pinned-behind`. The gate can protect only an environment that
executes a fresh CLI/bootstrap; it cannot update a host or cached container that
never runs new code.

## Operating-system setup

### Linux

Use a supported Node.js installation and ensure npm's global bin directory is
on `PATH`. If npm's prefix is root-owned, configure a user-owned prefix instead
of relying on `sudo` for normal use.

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"
```

Add the export to the shell profile used to run your provider.

### macOS

Use Node.js 22+ and Git as on Linux. Homebrew installations normally provide a
user-owned npm prefix. macOS is included in the repository CI matrix together
with Linux and Windows; use the [OS acceptance playbook](testing/os-matrix.md)
for a local provider-and-OS check.

### Windows (native)

Native Windows is supported. AWM uses symlinks by default so registry updates
can propagate to installed content. Enable **Developer Mode** to permit
unprivileged symlink creation:

> Settings → System → For developers → Developer Mode

If that is not possible, use copy mode when installing an affected artifact:

```powershell
awm add <bundle> --method copy
```

Copy mode is functional but no longer tracks a registry update automatically;
reinstall the copied artifact when the source changes.

### Windows through WSL

WSL follows the Linux path. Keep repositories on the Linux filesystem (for
example, under `~/projects`) rather than `/mnt/c/...`: mounted Windows paths do
not provide the same symlink and permission semantics.

## Prepare one provider

Choose one provider and run its machine-only initialization:

```bash
awm init --agent claude-code --machine-only
```

This seeds or synchronizes the official registry and installs machine-scope
baseline or ambient bundles where that provider has a machine scope. The
official baseline currently includes `dev` and `product`; project bundles such
as `frontend` and `authoring` wait for [project setup](project-setup.md).

To prepare additional providers, repeat the command once per provider. The
[configuration guide](configuration.md) has the exact variants and explains
how multiple providers coexist.

## Verify machine state

```bash
awm agent list
awm doctor --agent claude-code
```

`awm doctor` reports provider state and actionable degraded or deferred steps.
Do not initialize a project yet just to make this command green: a
machine-only run and a project run have different ownership boundaries.

## Next: initialize a project

Once the machine is ready, enter the repository and follow
[Initialize a project](project-setup.md). That phase creates the shared
repository contract.

## Installation troubleshooting

**`awm: command not found`**

The npm global bin directory is not on `PATH`. Check npm's configured prefix
and add its bin directory to the shell profile.

**Registry clone or update fails**

Check network, proxy, and Git authentication. For a private registry, first
confirm that `git clone <url>` succeeds in the same shell.

**Provider binary is missing or too old**

Install or upgrade the provider, then repeat `awm init --agent <provider>
--machine-only`. Codex has a minimum version gate documented in
[Agent-specific setup](agents-setup.md#codex).

**A machine-only run says content is deferred**

That is expected for project-only provider capabilities such as Copilot. Move
to [project setup](project-setup.md); do not work around it by creating local
files during machine preparation.
