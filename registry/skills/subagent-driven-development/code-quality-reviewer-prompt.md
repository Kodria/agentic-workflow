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
- Does each file have one clear responsibility with a well-defined interface?
- Are units decomposed so they can be understood and tested independently?
- Is the implementation following the file structure from the plan?
- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)
- **Systemic patterns:** Does the same flaw appear across ≥2 files in this change? If yes, name the pattern and recommend the orchestrator invoke the `harness-retro` skill after this review. Do NOT list every occurrence as a separate finding — name the pattern once and point to one example. <!-- AWM-INTEGRATION: reviewer-retro -->

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment
