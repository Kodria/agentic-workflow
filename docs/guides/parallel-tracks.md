# Parallel tracks (`awm track`)

How to run a plan's tasks **in parallel**, each in its own worktree, and how to read the
system when it decides not to do so.

> **First, because it saves time:** parallelism is an **optional optimisation**. A plan
> without a `## Tracks` section runs serially exactly as it always has — there is nothing to
> migrate and nothing breaks if you do not adopt it.

## Verification status

There is no ambiguity about what is verified and what is not:

| Capability | Status | How it was verified |
|---|---|---|
| Cohort bootstrap (tracks to `ARMED`, cohort `ACTIVE`) | ✅ Verified | Real-git suite plus certification with a supervisor and real processes |
| Serial fallback for any unverified condition | ✅ Verified | Real-git suite, including serial-versus-parallel tree parity |
| Crash recovery without duplicated resources | ✅ Verified | Real `SIGKILL` to the supervisor group, followed by takeover |
| Worktree isolation and declared/actual ownership | ✅ Verified | Real-git suite, including both ends of renames |
| `join → COMPLETE` with a live supervisor and controller takeover | ✅ Verified | Certification with a supervisor and real processes (`provider-run.mjs --certify-scripted`): `COMPLETE`, two `JOINED` tracks, and **one** final integration job. Evidence: [`docs/research/r5/evidence/scripted-local.json`](../research/r5/evidence/scripted-local.json) |
| A real LLM agent as controller | ⚠ Not verified | Optional; certified only with a deterministic controller |
| `awm track remove` (controller-requested teardown) | ❌ **Not implemented** | The supervisor has no handler for `track-teardown-request`: the command emits the request and the supervisor visibly **rejects** it. The supported teardown is the automatic one used by serial fallback. |

## Mental model

There are **two roles**, and confusing them is the most common mistake:

- The **plan supervisor** (`awm watch`) is the only component that integrates: it freezes the
  cohort, merges, runs global QA, and executes the canonical integration command. It is a
  long-lived process.
- The **controller** (your agent) **only emits requests**. `awm track add` and `awm track join`
  do not create or merge anything; they leave a request for the supervisor to consume on its
  next tick.

That is why every mutating command carries `--generation <token>`: the supervisor emits the
token when it starts the controller and includes it in the prompt. It is a **fencing token** —
if the supervisor has replaced a controller, the prior controller's requests are rejected
(`request-rejected-stale`). That is not an error to retry: another controller has taken over
the work.

## Declaring a parallel plan

Three things are all mandatory:

1. **Task membership** — every `### Task N:` includes `**Track:** <id>`.
2. A **`## Tracks` table** — one row per track with `Depends on` and `Shared resources`.
3. An **integration command** — argv as a **JSON array**, never a shell line.

```markdown
## Tracks

**Integration argv:** ["npm","test","--","--runInBand"]
**Integration paths:** ["src/**"]

| Track | Depends on | Shared resources |
|---|---|---|
| api | none | [] |
| ui  | none | [] |
```

Each track's ownership comes from the `**Files:**` entries in its tasks. It is not declared
separately, so it cannot drift from the files the tasks say they will change.

Before starting, `awm track verify-independence` exits `!= 0` for any violation.

## Daily workflow

```bash
awm watch                # plan supervisor: starts or resumes and launches the controller
awm track status         # read-only aggregate: each track's and the cohort's phase
awm track list           # declared TrackRefs with their worktreePath
```

The controller, with its token:

```bash
awm track add <id>  --generation "$GEN"    # emits the preparation request
awm track join <id> --generation "$GEN"    # requests integration of its track
awm track finalize  --generation "$GEN"    # self-reports global QA for the merged HEAD
```

Each track works in a sibling worktree (`<repo>.track-<id>`) and commits **only its assigned
files**. No merge begins until the **entire** cohort is frozen, and the canonical command runs
**once against the final HEAD** — not once per track.

### Joins do not close the cohort

With every track merged, the cohort is **not** complete: the combined result still needs
verification, and the plan controller owns that step.

1. The supervisor requests **global QA** against the HEAD that already contains every track.
2. The controller runs that QA, **commits any resulting corrections**, and self-reports it with
   `awm track finalize`. The HEAD comes from the repository, not a flag: it is *your* HEAD that
   you report. With a dirty tree, the command fails and names what is missing instead of
   emitting a self-report the supervisor would silently discard.
3. The supervisor **verifies independently** (real HEAD plus a clean tree) before accepting it:
   a self-report declares; it never proves.
4. Only then does it run canonical integration and the final interlock, and the cohort reaches
   `COMPLETE`.

If the cohort is still with every track in `MERGED_UNVERIFIED`, it is waiting for step 2:
`awm track status` shows it, and the journal's `next_action` says `run-global-qa`.

## When it falls back to serial (and why that is correct)

The system **prefers being slow to being wrong**. Any of these conditions disables parallelism
for the **entire cohort**, not only the affected track:

| Condition | Reason |
|---|---|
| A declaration is missing (membership, row, `Shared resources`, argv) | An incomplete contract cannot prove independence |
| Two tracks overlap in paths or resources | They would work on the same thing |
| A track declares a **lockfile, manifest, or migration** | It is a global class: two tracks rewriting it in parallel overlap even if nothing else does |
| A glob the system cannot expand | An unexpandable pattern cannot *assert* that two tracks do not overlap |
| `Depends on` is not `none` | There is ordering, so there is no parallel execution |
| The worktree cannot be created, or `.awm` is not gitignored | Without verified isolation, there is no track |

The fallback is recorded with its reason (`cohortFallbackReason`, named by the `enter-serial`
event). **Serial produces the same tree as parallel execution** — that is a verified acceptance
criterion, not an aspiration.

## `BLOCKED` — what it means and what NOT to do

`BLOCKED` means exactly one thing: **the system could not prove a resource's property or
identity**. It does not mean "failed"; it means "not established".

A `BLOCKED` track **never** enables serial fallback. Falling back while other worktrees might
still be live would mean running over something unverified — exactly what the design prevents.

**Do not delete a worktree, branch, lock, or process to make the system move forward.** That
does not unblock it: it destroys the evidence of why it was blocked and can kill someone
else's work. `BLOCKED` is a deliberate dead end that asks an operator to provide evidence:

```bash
awm track status                    # which track, and its blockedReason
git -C <repo> worktree list         # what is actually registered
git -C <worktree> status            # is there uncommitted work that would be lost?
```

Only then do you decide. Teardown always uses `git branch -d` (never `-D`) and refuses to
remove a dirty worktree while naming the paths, rather than discarding real work without a
trace.

## Diagnosis

All durable state lives in `<repo>/.awm/journal/<branch>/`:

- `state.json` — `cohortPhase`, the `TrackRef` values with their phase, and
  `cohortFallbackReason`
- `events.jsonl` — the trace: worktree creation, spawns, freezes, merges, and rejections

When something does not progress, ask three questions in order:

1. **Did the cohort fall back?** `cohortPhase: SERIAL` plus `cohortFallbackReason` says why.
2. **Is there a `BLOCKED` track?** Its `blockedReason` names what could not be proven.
3. **Are requests being rejected?** `request-rejected-stale` in the events means the controller
   that emitted them has been replaced — the new one resumes; do not retry manually.

A controller that works silently is declared stalled and replaced. If you write your own, it
must emit `awm job controller-heartbeat --generation <token>` while it works.

## References

- [CLI reference](../cli-reference.md) — every flag
- [Architecture](../architecture.md) — components and on-disk state
- [`docs/research/r5/README.md`](../research/r5/README.md) — what is certified, how, and what remains open
