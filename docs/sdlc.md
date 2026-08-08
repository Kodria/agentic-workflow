# Software development lifecycle

How the pieces compose into a lifecycle — and, more importantly, **why** it's built this way. Every mechanism here exists because something failed without it.

## The problem this solves

An AI coding agent is fast and confident. Confidence is the problem: it will report work as done that isn't, write a test that cannot fail, fix a symptom and call it a root cause, and — under a long conversation — quietly forget the constraints it was given an hour ago.

None of that is fixed by better prompting. It's fixed by **structure**:

| Failure mode | Structural answer |
|---|---|
| "Done" that isn't | Deterministic gates — real commands, real exit codes |
| Context lost to a long session or compaction | State on disk, re-anchored by a session hook |
| Business answers invented mid-build | A product/development boundary crossed only by a certified brief |
| The same mistake, every week | A ledger and a retro that convert recurrences into rules |
| A reviewer that agrees with itself | Independent lenses with different criteria, plus a gate no lens can override |

## The three layers

```
┌─ PRODUCT ─────────────────────────────────────────────┐
│  idea → discovery → brief → readiness gate (G1–G9)    │
└───────────────────────────┬───────────────────────────┘
                            │ certified brief (the baton)
┌─ DEVELOPMENT ─────────────▼───────────────────────────┐
│  design → plan → execute → QA → retro → finish        │
└───────────────────────────┬───────────────────────────┘
                            │ every phase boundary
┌─ HARNESS ─────────────────▼───────────────────────────┐
│  sensors · preflight · ledger · hooks · constitution  │
└───────────────────────────────────────────────────────┘
```

- **Product** decides *whether and why* to build. [Guide](guides/product-process.md)
- **Development** decides *how*, and builds it. [Guide](guides/development-process.md)
- **Harness** is what makes both verifiable rather than merely asserted.

The layers are separated so that a business question raised during development can't be silently answered by whoever happens to be typing. It goes back through the door as an open decision (`DA-#`).

---

## The harness

### Sensors — the deterministic floor

Sensors are real commands (typecheck, lint, tests, security scan, mutation) with real exit codes.

```bash
awm sensors init     # generate the manifest for the detected stack
awm sensors run      # the gate
awm sensors baseline # snapshot current findings — the ratchet for legacy repos
```

Their entire value is that **they cannot be talked past**. A model can produce a persuasive argument that the code is fine; it cannot produce a zero exit code from `tsc` that didn't happen.

Two rules that come from real incidents:

- **A missing tool reports `skipped` with a reason — never `pass`.** Silence is not evidence.
- **No review, lens, or claim overrides a red sensor.** Fresh context reduces a model's self-preference bias; it doesn't remove it. The deterministic gate is the only thing that neutralises it.

**Legacy repos** don't have to be green on day one: `awm sensors baseline` snapshots existing findings, and the gate then blocks only *new* ones. The ratchet turns "we can't adopt this, we have 4000 lint errors" into "we can adopt this today".

### Preflight — is the gate real?

```bash
awm preflight
```

A green sensor run on a project with no configured sensors is a lie in the most dangerous direction. Preflight verifies the harness can *actually* gate before development starts. Advisory checks (like git-host detection for PR automation) never flip the overall status on their own — a warning is a warning, not a failure.

### Context injection — surviving the long conversation

The constitution and agent context are delivered into **every** session, and in hooks-native agents re-anchored on `SessionStart` (including after a compaction). This is the answer to "the agent knew the rules an hour ago".

```bash
awm context-budget   # what does that delivery cost?
```

Context is finite, so the delivered documents are treated as a **curated index, not an append-only log**. That's why `AGENTS.md` and `CONSTITUTION.md` are edited by merge-and-prune: a doc that grows forever eventually crowds out the work.

### The ledger — the learning loop

```bash
awm ledger add ...        # reviewers, QA and debugging emit findings here
awm ledger list
awm ledger recurring --min 2
```

Per-branch, on disk. It exists so the retro doesn't depend on anyone *remembering* that this bug happened before — recurrence is a query, not a recollection.

> An empty ledger after a cycle that produced findings is **not** a clean bill. It means the emission pipeline broke, and that is itself the finding.

---

## The quality model

Four independent checks, deliberately not one big "review":

| Check | Asks | Catches |
|---|---|---|
| Sensors | Does it compile, lint, pass, scan clean? | Everything mechanical |
| Track A — fidelity | Was what the plan promised actually built and tested? | Missing requirements; scope creep |
| Track B — quality | Regardless of the plan, is this code sound? | Crashes on edge input, wrong logic, tests that can't fail |
| Retro | Have we seen this before? | The recurring class behind this instance |

Track B runs as a **panel of lenses** — robustness/security, logic, tests — each in isolated context with its own criterion. One critic has one blind spot; three copies of it share that blind spot. Different criteria are what catch different failures.

The **robustness floor is never out of scope.** A design can declare a *feature* out of scope. It cannot declare input validation out of scope. A public function that returns `Infinity`/`NaN`/`undefined` or crashes on edge input is a defect even if nobody asked about it.

---

## Verification discipline

Three rules, each earned:

**1 · Evidence before assertion.** No claim of done/fixed/passing without the command output that proves it.

**2 · Verify a fix by reverting it.** Apply the fix, add the test, then **revert only the fix** and confirm the new test goes red. A green suite proves the suite is green — not that your test discriminates anything. This repo has multiple retros from tests that passed with the fix reverted.

**3 · Root cause before fix.** Symptom fixes are failure. Three failed attempts is not a cue to try a fourth — it's a cue to question the architecture.

---

## Where knowledge lives

| Document | Holds | Edited by |
|---|---|---|
| `CONSTITUTION.md` | Non-negotiable project rules; the support matrix | `harness-retro` (process class) |
| `AGENTS.md` | Agent working-style lessons and wins; agent-agnostic | `harness-retro` (agent class) |
| `CLAUDE.md` | Claude-specific instructions | Humans |
| `.semgrep.awm.yml`, `eslint.config.awm.mjs`, `tests/structural/` | Mechanical rules | `harness-retro` (sensor-catchable) |
| `docs/harness-retros.md` | The auditable log of what was learned and when | `harness-retro` |

The routing rule: **a finding a machine can catch becomes a sensor rule, not a paragraph.** Prose that depends on someone remembering it is the weakest possible enforcement — it's the fallback, not the goal.

There's a boundary here too: AWM's shipped sensor packs carry **generic** rules (never `eval`, no unsanitised SQL). A rule born from one project's specific bug belongs in *that project's* config, versioned with its code. The framework carries conventions, not somebody's bug list.

---

## Adopting this on a real team

1. **One project first.** `awm init`, `awm sensors init`, `awm sensors baseline` if it's legacy.
2. **Commit `.awm/profile.json`.** That's how a teammate reproduces the setup with `awm sync`.
3. **Stand up a team registry** once you have a second project — that's the point at which shared skills start paying off. [Runbook ch. 4](runbook.md#chapter-4--team-setup--customization)
4. **Pin it.** `awm pin <registry> <version>` so a registry change can't surprise everyone mid-sprint.
5. **Let the retro run.** The system gets better only if recurring findings actually become rules.
6. **Verify per environment.** Each developer's OS × agent combination is its own risk surface — that's what the [acceptance playbooks](testing/README.md) are for.

---

## Related

- [Support matrix](support-matrix.md) — what is supported, at what evidence level, and what is missing

- [Architecture](architecture.md) — components and data flow
- [Product process](guides/product-process.md) · [Development process](guides/development-process.md)
- [`CONSTITUTION.md`](../CONSTITUTION.md) — the authoritative rules and support matrix
- [Harness retros](harness-retros.md) — what has been learned, with dates
