---
name: verification-before-completion
version: "1.0.0"
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Why This Matters

From 24 failure memories:
- your human partner said "I don't believe you" - trust broken
- Undefined functions shipped - would crash
- Missing requirements shipped - incomplete features
- Time wasted on false completion → redirect → rework
- Violates: "Honesty is a core value. If you lie, you'll be replaced."

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness

## Sensor-based verification (AWM)

<!-- AWM-INTEGRATION: verification-sensors -->

If the repo has `.awm/sensors.json`, "done" requires sensor evidence in addition to test/build evidence.

**Before claiming done:**

```bash
awm sensors run
```

Run with **no flag** — that runs *all* sensors (fast: `tsc`, `lint`; slow: `semgrep`, `mutation`). Do **not** use `--slow`: it runs only the slow sensors and skips `lint` and `typecheck`, which is where most new findings surface. (`--fast` / `--slow` exist only for splitting a run when iterating; the completion gate is the full run.)

**Lee el veredicto, no el exit code.** `awm sensors run` emite JSON con un campo `overall`:
- `overall: "pass"` → sensores corrieron, sin hallazgos nuevos. Verde.
- `overall: "fail"` → hay hallazgos nuevos o un tool faltante. Bloquea hasta resolver.
- `overall: "not_certified"` → no hay `.awm/sensors.json` en el árbol. **NO es un pass.** Decláralo explícito como "sin sensores configurados — gate no certificado". Nunca lo reportes como "sensores OK".

`exit 0` NO significa "limpio" por sí solo: `not_certified` también sale 0. La señal autoritativa es `overall`.

- Exit 0 with `overall: pass` → sensors clean; proceed.
- Exit 1 with sensor failures → autocorrect using the LLM-formatted errors, re-run sensors, then claim done. The ratchet reports only **new** findings (`newCount`); fix those, not the pre-existing baseline.

**Recurrence trigger:**

If the SAME sensor (same `name` + same `rule`) has failed in a prior session for this repo, do not just fix it — invoke the `harness-retro` skill. Recurring sensor failures mean the harness has a gap; `harness-retro` turns the recurrence into a structural rule.

When a sensor failure recurs (same `name` + `rule` as a prior fix in this session), log it before fixing so the recurrence is counted:

```
awm ledger add --phase sensors --source-skill verification-before-completion --polarity finding --class structural --signature <sensor>:<rule> --severity important --desc "<sensor> recurred on <rule>"
```

(Best-effort — skip if `awm` is unavailable.)

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.
