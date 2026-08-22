# Dashboard and project evidence

The AWM dashboard answers two different questions without changing your project:

- **Is it ready and configured correctly?** It uses the current machine and project state.
- **What happened during development cycles?** It shows local, accumulated, sanitized planning, execution, QA, and retrospective evidence.

It is not a productivity score or a comparison between people or repositories. It shows the observations that are available, their state, and—when action is needed—the exact command to run.

## Choose the right view

Run these commands from the repository root:

```bash
# Brief provider and configuration diagnosis
awm doctor

# Complete machine, project, and cycle view in the terminal
awm doctor --full

# One HTML report to open or share within the team
awm doctor --html awm-dashboard.html
```

`awm doctor` and `awm doctor --full` are read-only. The `--html` variant writes only the file you name; use `--force` to replace an existing report:

```bash
awm doctor --html awm-dashboard.html --force
```

The HTML file is self-contained: it needs neither a server nor network access when opened. It is designed to share technical state, not private work content: it excludes plan paths, repository identity, ledger prose, environment values, secrets, and command output.

## Read the complete dashboard

In a detected project, the complete view keeps this order:

| Section | What it answers |
| --- | --- |
| Machine | State of installed AWM providers and content. |
| Project | Declared profile, context, bundles, and sensors. |
| Planning | State of the current cycle or most recently captured cycle. |
| Execution | Whether work completed a cycle or became blocked. |
| QA | Aggregated findings and fixes for a cycle, without exposing their text. |
| Retro | Whether the cycle reached retrospective and harness learning. |
| History | Eligible local cycles and the confidence of the observation. |

States are deliberately explicit:

- **OK** means the observation is available and needs no action.
- **Attention**, **missing**, or **unavailable** include a safe remedy, such as `awm sync`, `awm update`, `awm sensors status`, or `awm preflight`.
- **Not applicable** and an empty history section do not mean failure. In particular, a new project has no trend or historical evidence yet.

Follow the remedy shown beside an observation. To learn whether a project can execute its gates, also run `awm preflight`; to execute the real quality checks, run `awm sensors run`.

## When impact evidence appears

Evidence is stored locally when a development cycle finishes and is included in the next `awm doctor --full` or `--html` view. Capture retains only structural data: cycle state, task and retry counts, QA counts and opaque signatures, first gate evaluations, and plan state.

You normally do not capture it manually: the retrospective workflow does so before archiving the ledger. If you are operating an already completed or blocked cycle and need an explicit capture, use a repository-relative plan path:

```bash
awm evidence capture --plan docs/plans/my-plan.md
```

The command prints an opaque cycle identifier and stores the observation under `.awm/evidence/cycles/`. It requires an available journal and a `COMPLETE` or `BLOCKED` cycle; if either is missing, it fails explicitly instead of inventing a metric.

Confidence increases only when enough local cycles exist. AWM shows every eligible cycle it can read: it does not hide rows, calculate rankings, or claim improvement from a single observation.

## Share and retain a report

Generate HTML where it is useful for review—for example, a CI artifact directory or a PR attachment—and regenerate it whenever you need current state. You do not need to commit the report unless your team has deliberately decided to retain it as review evidence.

For complete syntax and option constraints, see the [CLI reference](../cli-reference.md#awm-doctor).
