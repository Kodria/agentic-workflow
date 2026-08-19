# Security Policy

## Reporting a vulnerability

Report security issues through GitHub's private vulnerability reporting on this
repository: **Security → Report a vulnerability**. Please do not open a public
issue for a suspected vulnerability.

Include the `awm --version`, the operating system (the CLI ships to Linux,
macOS, and Windows), the agent adapter in use, the commands that reproduce it,
and the observed behaviour.

## What is in scope

AWM is a CLI that reads and writes real paths on a developer's machine, invokes
real toolchains, and installs content fetched from git registries. The threat
model follows from that:

- **Writes outside the intended paths.** `awm init`, `awm sync`, `awm add` and
  `awm update` materialize files and symlinks under the project and under the
  agent's configuration root. Path traversal, symlink following, or a backup or
  restore path that escapes its scope are in scope.
- **Command execution.** `awm sensors run`, `awm preflight`, and the job and
  watch runners spawn subprocesses built from manifests and pack definitions.
  Argument or command injection from registry content, project configuration,
  or file names is in scope.
- **Registry trust.** `awm registry add` accepts arbitrary remotes and
  `awm update` resolves a tag from them. Anything that lets content bypass the
  pin, the tag resolution, or the integrity of what is installed is in scope.
- **Session hooks.** Hooks installed by AWM run automatically at the start of
  every agent session. Anything that lets untrusted content reach that path is
  in scope.
- **Credential and state handling.** Leaking tokens, environment values, or
  ledger contents into logs, exported artifacts, or telemetry is in scope.

## What is out of scope

- Vulnerabilities in the third-party tools sensors invoke (ESLint, TypeScript,
  semgrep, mypy, ruff, shellcheck, and others). Report those upstream.
- Vulnerabilities in agent harnesses (Claude Code, Codex, OpenCode, Cursor, and
  others). Report those to their maintainers.
- The content of the baseline registry — skills, workflows, sensor packs —
  which lives in
  [Kodria/awm-baseline-registry](https://github.com/Kodria/awm-baseline-registry)
  and has its own policy.
- A user deliberately pointing `awm registry add` at a remote they do not
  trust. Registries are executed content; treat adding one as you would treat
  adding a dependency.

## Supported versions

Fixes land on `main` and publish as a new version of
[`agentic-workflow-manager`](https://www.npmjs.com/package/agentic-workflow-manager).
There are no long-term support branches: upgrading is the fix path.
