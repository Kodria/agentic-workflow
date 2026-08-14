# Initialize a project

Complete [machine preparation](installation.md) before this phase. Project
initialization runs inside a repository and creates the shared AWM contract that
other developers can reproduce.

## What belongs to the project

The project owns `.awm/profile.json`, the sensor manifest and its checked-in
configuration, `CONSTITUTION.md`, and provider-specific project context or
instructions where applicable. The selected provider, its global files, and
personal preferences remain machine state.

## New repository

From the repository root, initialize the provider you already prepared:

```bash
cd <repository>
awm init --agent <provider>
awm doctor --agent <provider>
awm preflight
```

`awm init` is idempotent and uses a filesystem transaction. It creates or
reconciles the project profile, detects applicable extensions, initializes
sensors, and reports any agent-owned steps that require a session.

Sensor selection is **version-aware**. The selected stack pack uses local
project metadata and local tool resolution to choose a certified variant when
one matches. Review the resulting `.awm/sensors.json`; a version outside a
certified range is a compatibility result to investigate, not a reason to
silently use a global binary.

## Existing repository adopting AWM

Use the same commands, then inspect the detected sensor pack and current
findings before treating the first green result as a baseline:

```bash
cd <existing-repository>
awm init --agent <provider>
awm sensors run
awm preflight
```

For a legacy codebase with known findings, use `awm sensors baseline` only after
reviewing the full run. That records accepted debt and makes future gates fail
on new findings rather than hiding the original state.

Legacy adoption starts from the same baseline manifest, but hardening remains an
explicit **hardening opt-in**: first establish runnable controls and review
existing debt; then add stricter security, mutation, or project-specific
controls deliberately. A baseline records reviewed history; it does not certify
an incompatible or missing tool.

## Clone a repository that already uses AWM

The committed profile describes shared content independently of each developer's
provider. Clone it, prepare your own provider, then reconcile the project:

```bash
git clone <repository>
cd <repository>
awm init --agent <provider>
awm registry add <team-registry-url> --no-install  # only when the profile needs it
awm sync
awm doctor --agent <provider>
awm preflight
```

Do not add a registry unless the profile or team documentation requires it.
`awm sync` reconciles declared content after all required registries are
available.

## Frontend detection and optional activation

AWM can detect frontend signals and propose the `frontend` extension during
initialization. Confirm it when the repository actually has a supported
frontend surface. Detection is a convenience, not an irreversible decision.

Activate it explicitly when needed:

```bash
awm add frontend --agent <provider> --scope local
```

`frontend` is project-scoped; it is not part of machine-only initialization.

## Activate an extension manually

Use `awm add <bundle>` for a project bundle that is already available in a
registered registry. Keep its scope local unless the bundle's documented scope
and the provider capability say otherwise.

```bash
awm list
awm add <bundle> --agent <provider> --scope local
```

## Use a custom team registry

Prepare the registry at machine scope, then synchronize inside the project:

```bash
awm registry add <team-registry-url> --no-install
awm update
awm sync
```

For private registries, fix Git or SSH authentication first. A profile can
declare bundles but cannot safely contain credentials or invent an unavailable
registry URL.

## Complete pending agent-owned steps

Some steps, such as creating or updating the constitution and project context,
belong to an agent session because they require repository understanding. When
`awm init` or `awm doctor` reports a pending step, start the configured provider
inside the repository and follow the named skill. Do not replace it with a
generic template merely to silence the status.

## Verify readiness

```bash
awm doctor --agent <provider>
awm sensors run
awm preflight
```

`preflight` verifies the harness configuration; sensors verify the codebase.
Both are needed before treating a development cycle as gateable.

## Commit the shared contract

Commit the generated or maintained project contract after review:

- `.awm/profile.json`
- `.awm/sensors.json`, its baseline where the team accepts one, and sensor config files
- `CONSTITUTION.md`
- provider-specific project context or instructions where the provider uses them

Generated symlinks remain ignored according to the installer contract. Commit
the declarative files that let another developer reconstruct them.

## Project setup troubleshooting

| Condition | Action |
|---|---|
| `bundle not found in registry` | Add the documented team registry, run `awm update`, then `awm sync`. |
| Sensors not configured | Run `awm sensors init`, review the selected pack, then `awm preflight`. |
| Pending constitution or context | Start the configured agent in the repository and follow the named pending skill. |
| Native Windows symlink denial | Enable Developer Mode or install affected artifacts with copy mode. |
| Copilot machine setup has no skills | Expected; run normal project initialization inside the repository. |
