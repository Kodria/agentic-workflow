# Agentic Workflow Manager (AWM)

[![Version](https://img.shields.io/npm/v/agentic-workflow-manager)](https://www.npmjs.com/package/agentic-workflow-manager)
[![CI](https://github.com/Kodria/agentic-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/Kodria/agentic-workflow/actions/workflows/ci.yml)

AWM is an engineering framework for agentic software development. It turns an
incomplete need into a reviewable pull request through explicit human decisions,
bounded agent execution, deterministic quality gates, and durable evidence.

It is not a library of prompts or an autonomous code generator. AWM combines
versioned skills and workflows with a CLI, provider adapters, project contracts,
and executable sensors so that a team can make agent-assisted development
repeatable and reviewable.

## Choose your path

### Understand the framework

Start with [How AWM works](docs/framework.md) to learn the lifecycle, its
components, which phases are optional, and which quality gates are mandatory.

### Start using AWM

1. [Install AWM and prepare your machine](docs/installation.md)
2. [Configure providers and registries](docs/configuration.md)
3. [Initialize a project](docs/project-setup.md)
4. [Operate AWM day to day](docs/runbook.md)

The [documentation hub](docs/README.md) maps the complete set of active guides
by intent.

## Five-minute machine setup

Requires **Node.js 22+** and **git**.

```bash
npm i -g agentic-workflow-manager
awm init --agent claude-code --machine-only
awm agent list
awm doctor --agent claude-code
```

This prepares the machine only. Run [project initialization](docs/project-setup.md)
separately inside the repository you want AWM to manage.

## Framework at a glance

AWM provides a complete engineering loop:

1. Turn a raw need into a brief when product discovery is needed.
2. Confirm readiness, design when it adds value, and create a traceable plan.
3. Execute bounded work through a controller and focused agents.
4. Run deterministic type, lint, test, security, and dependency checks.
5. Review evidence, prepare the pull request, and record learning for the next cycle.

Humans retain intent, priority, and consequential decisions. Agents work within
the declared scope. The harness makes the process observable; it does not claim
that an LLM is always correct.

## Daily commands

```bash
awm add                  # install a project bundle or artifact
awm list                 # inspect available content
awm sensors run          # run the project's quality gates
awm preflight            # verify that the harness can gate work
awm update               # refresh registered content
awm doctor               # inspect machine and project state
awm track status         # inspect parallel execution tracks
```

The main workflows are [Product process](docs/guides/product-process.md), from
a raw idea to a ready brief, and [Development process](docs/guides/development-process.md),
from a concrete requirement to verified code.

## Support and scope

AWM supports Claude Code, Codex, OpenCode, Cursor, Copilot, and Antigravity
through capability tiers that state the real integration level instead of
pretending every provider is identical. Linux, macOS, native Windows, and WSL
have distinct setup guidance.

The generated [support matrix](docs/support-matrix.md) is the authoritative
source for provider capabilities, operating-system evidence, paths, and known
limitations. It is derived from the CLI source and checked in tests.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for how to submit changes and how
contributions are licensed. Then use the
[architecture guide](docs/architecture.md) to understand the CLI and registry
design, the [CLI developer guide](cli/README.md) to work on the CLI, and the
[constitution](CONSTITUTION.md) for non-negotiable project rules.

To report a security vulnerability, follow [SECURITY.md](SECURITY.md) rather
than opening a public issue.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.

The name "AWM" and the Kodria name and marks are not covered by that grant —
Apache-2.0 §6 conveys no trademark rights. You may use, modify, and
redistribute the software; naming a derivative "AWM" requires permission.
