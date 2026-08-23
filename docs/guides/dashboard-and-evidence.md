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
| Docs | Whether the cycle's user-facing documentation was updated and verified. |
| Retro | Whether the cycle reached retrospective and harness learning. |
| History | Eligible local cycles and the confidence of the observation. |
| Processes | Reserved for a future process-lifecycle adapter; today it always reports "not applicable." |

States are deliberately explicit:

- **OK** means the observation is available and needs no action.
- **Attention**, **missing**, or **unavailable** include a safe remedy, such as `awm sync`, `awm update`, `awm sensors status`, or `awm preflight`.
- **Not applicable** and an empty history section do not mean failure. In particular, a new project has no trend or historical evidence yet.

The **Processes** section is a deliberate placeholder, not a bug: `awm doctor --full` run from this repository's root currently prints

```
Processes
  ⊘ source not applicable
  No observations reported.
```

for every project, regardless of activity. No adapter feeds it yet — it exists in the section contract so the dashboard's shape doesn't have to change again when a process-lifecycle source lands. Seeing it empty is the correct, current state.

Don't confuse that with QA, Docs, or Retro reporting **unavailable**: that's a different, activity-dependent reason — no development cycle has been captured yet for the current branch. Both look empty; only one of them is permanent. Captured from this repository's own root, with no cycle currently tracked:

```
QA
  ⊘ source unavailable
  No observations reported.

Docs
  ⊘ source unavailable
  No observations reported.

Retro
  ⊘ source unavailable
  No observations reported.
```

Follow the remedy shown beside an observation. To learn whether a project can execute its gates, also run `awm preflight`; to execute the real quality checks, run `awm sensors run`.

## Plan lifecycle states

The Planning row's detail is one of a fixed set of live plan states, driven entirely by task checkboxes and marker comments in the plan file itself, never by prose:

`active` / `blocked` → `qa_pending` → `docs_pending` → `retro_pending` → `executed`

- **`qa_pending`** — every task in the plan is checked, but `<!-- awm-qa-complete -->` is not yet on the plan.
- **`docs_pending`** — `<!-- awm-qa-complete -->` is present, `<!-- awm-docs-complete -->` is not. The `post-implementation-docs` phase (phase 4.2 in [development process](development-process.md)) closes it by adding the marker.
- **`retro_pending`** — `<!-- awm-docs-complete -->` is present, `<!-- awm-retro-complete -->` is not.
- **`executed`** — all three markers are present. Terminal state; a later marker never un-sets an earlier one.

A plan only reaches this classification once a journal or `awm evidence capture --plan <path>` gives the dashboard a cycle to read — an untracked plan file just doesn't produce a Planning row, which is exactly the `No observations reported.` case above.

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
