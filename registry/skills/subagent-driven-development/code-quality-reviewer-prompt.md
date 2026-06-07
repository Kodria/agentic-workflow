# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Only dispatch after spec compliance review passes.**

```
Task tool (general-purpose):
  Use template at requesting-code-review/code-reviewer.md

  DESCRIPTION: [task summary, from implementer's report]
  PLAN_OR_REQUIREMENTS: Task N from [plan-file]
  BASE_SHA: [commit before task]
  HEAD_SHA: [current commit]
```

**In addition to standard code quality concerns, the reviewer should check:**
- **Sensor evidence (if `.awm/sensors.json` exists):** run `awm sensors run` (no flag) and confirm `overall: pass`. New findings the implementer missed are review-blocking — report them. Do not accept a task whose new code adds sensor findings. <!-- AWM-INTEGRATION: subagent-sensor-gate -->
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)
- **Systemic patterns:** Does the same flaw appear across ≥2 files in this change? If yes, name the pattern and recommend the orchestrator invoke the `harness-retro` skill after this review. Do NOT list every occurrence as a separate finding — name the pattern once and point to one example. <!-- AWM-INTEGRATION: reviewer-retro -->

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment

## Record to the ledger (AWM)

After forming your verdict, persist each result to the branch ledger so harness-retro can learn from this session:

For each quality issue found:
```
awm ledger add --phase code-quality-review --source-skill subagent-driven-development --polarity finding --class <structural|logica|seguridad> --signature <short-slug> --severity <blocker|important|minor> --desc "<one line>" --ref <file:line>
```
Use `--class structural` for type/shape issues, `--class logica` for behavioral bugs, `--class seguridad` for vulnerabilities.

For each thing the implementation did **well** (a win worth reinforcing):
```
awm ledger add --phase code-quality-review --source-skill subagent-driven-development --polarity win --class <appropriate-class> --signature <short-slug> --severity info --desc "<one line>"
```

Use a stable, lowercase `--signature` slug so recurring issues group across sessions. If `awm` is not on PATH, skip silently — the ledger is best-effort.
