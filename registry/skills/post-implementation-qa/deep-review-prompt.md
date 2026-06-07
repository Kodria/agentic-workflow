# Deep Review Prompt Template

Use this template when dispatching the deep-review subagent in `post-implementation-qa`.

**Purpose:** Find Type B (fidelity) and Type C (quality) issues by comparing the plan against what was actually built.

```
Agent tool (general-purpose):
  description: "Deep QA review: plan vs implementation"
  prompt: |
    You are performing a post-implementation QA review. Your job is to find gaps and bugs — be thorough and adversarial, not diplomatic. The team needs real issues, not reassurance.

    ## The Plan

    [PASTE FULL PLAN TEXT HERE]

    ## What Was Implemented (git diff from base branch)

    [PASTE FULL GIT DIFF HERE]

    ## Sensor Results (awm sensors run)

    [PASTE FULL SENSOR OUTPUT HERE]

    ## Your Job

    Find and classify ALL issues into two types:

    **Type B — Fidelity gaps** (plan says X, code does Y):
    - Missing features or requirements from the plan
    - Features implemented that were NOT in the plan
    - Requirements misunderstood (right intent, wrong execution)
    - Plan sections skipped or partially implemented
    - Acceptance criteria not met

    **Type C — Quality bugs** (code is defective regardless of plan):
    - Logic errors (wrong result for valid input)
    - Unhandled edge cases (null, empty, boundary values, concurrent calls)
    - Unexpected behavior under normal use
    - Error paths that crash or behave silently instead of handling gracefully
    - Data that could get into an inconsistent state
    - Missing validations at system boundaries (user input, external APIs)
    - Safety/robustness invariants violated even if the design declared them out of scope — a public function returning Infinity/NaN/undefined silently, or crashing on boundary/invalid input, is Type C regardless of stated scope

    **Do NOT report** things already flagged in sensor results unless they point to a specific logic problem not visible from the sensor output alone.

    ## How to Review

    1. Read each section of the plan, locate where it appears in the diff
    2. For each plan requirement: is it fully implemented? If not → Type B finding
    3. For each changed file in the diff: does the logic hold for edge cases? → Type C findings
    4. Check error paths: what happens when inputs are invalid, services are down, or data is missing?

    ## Output Format (return ONLY this JSON, no preamble)

    {
      "findings": [
        {
          "id": "B1",
          "type": "B",
          "severity": "blocker|important|minor",
          "title": "Short description (one line)",
          "detail": "Specific what and where — include file:line if applicable",
          "plan_reference": "Quote or reference the plan section this relates to"
        }
      ],
      "summary": "N Type-B and M Type-C issues found. K blockers."
    }

    If no issues found:
    {
      "findings": [],
      "summary": "No issues found — implementation matches plan and code appears correct."
    }

    Severity guide:
    - blocker: prevents correct function or violates a core requirement
    - important: degraded behavior, missing requirement, could cause real problems
    - minor: cosmetic, inconsistency, or improvement opportunity

    Be thorough. A finding list that is too short is more dangerous than one that is too long.
```

## Record to the ledger (AWM)

After classifying findings, emit one `awm ledger add` command per finding and per win:

For each Type B finding (plan-vs-implementation gap):
```
awm ledger add --phase post-qa --source-skill post-implementation-qa --polarity finding --class proceso --signature <short-slug> --severity <blocker|important|minor> --desc "<one line>"
```

For each Type C finding (logic bug / behavioral issue):
```
awm ledger add --phase post-qa --source-skill post-implementation-qa --polarity finding --class <logica|seguridad> --signature <short-slug> --severity <blocker|important|minor> --desc "<one line>" --ref <file:line>
```

For each invariant the implementation got **right** (a win worth reinforcing):
```
awm ledger add --phase post-qa --source-skill post-implementation-qa --polarity win --class <appropriate-class> --signature <short-slug> --severity info --desc "<one line>"
```

Use a stable, lowercase `--signature` slug so recurring issues group across sessions. If `awm` is not on PATH, skip silently — the ledger is best-effort.
