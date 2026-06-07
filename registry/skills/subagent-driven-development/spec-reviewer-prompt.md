# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent.

**Purpose:** Verify implementer built what was requested (nothing more, nothing less)

```
Task tool (general-purpose):
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    [FULL TEXT of task requirements]

    ## What Implementer Claims They Built

    [From implementer's report]

    ## CRITICAL: Do Not Trust the Report

    The implementer finished suspiciously quickly. Their report may be incomplete,
    inaccurate, or optimistic. You MUST verify everything independently.

    **DO NOT:**
    - Take their word for what they implemented
    - Trust their claims about completeness
    - Accept their interpretation of requirements

    **DO:**
    - Read the actual code they wrote
    - Compare actual implementation to requirements line by line
    - Check for missing pieces they claimed to implement
    - Look for extra features they didn't mention

    ## Your Job

    Read the implementation code and verify:

    **Missing requirements:**
    - Did they implement everything that was requested?
    - Are there requirements they skipped or missed?
    - Did they claim something works but didn't actually implement it?

    **Extra/unneeded work:**
    - Did they build things that weren't requested?
    - Did they over-engineer or add unnecessary features?
    - Did they add "nice to haves" that weren't in spec?

    **Misunderstandings:**
    - Did they interpret requirements differently than intended?
    - Did they solve the wrong problem?
    - Did they implement the right feature but wrong way?

    **Verify by reading code, not by trusting report.**

    Report:
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```

## Record to the ledger (AWM)

After forming your verdict, persist each result to the branch ledger so harness-retro can learn from this session. One command per item:

For each spec gap (missing / extra / misread):
```
awm ledger add --phase spec-review --source-skill subagent-driven-development --polarity finding --class proceso --signature <short-slug> --severity <blocker|important|minor> --desc "<one line>" --ref <file:line>
```

For each thing the implementer did **well** (a win worth reinforcing):
```
awm ledger add --phase spec-review --source-skill subagent-driven-development --polarity win --class proceso --signature <short-slug> --severity info --desc "<one line>"
```

Use a stable, lowercase `--signature` slug (e.g. `missing-progress-reporting`) so recurring issues group across sessions. If `awm` is not on PATH, skip silently — the ledger is best-effort.
