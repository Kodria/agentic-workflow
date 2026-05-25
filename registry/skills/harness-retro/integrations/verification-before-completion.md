# Patch record: verification-before-completion ← harness-retro

**Target:** `registry/skills/verification-before-completion/SKILL.md`

**Marker:** `<!-- AWM-INTEGRATION: verification-sensors -->`

**Anchor:** The section header `## The Bottom Line` (near end of file).

**Position:** Inserted IMMEDIATELY BEFORE the `## The Bottom Line` line.

**Inserted text:**

```markdown
## Sensor-based verification (AWM)

<!-- AWM-INTEGRATION: verification-sensors -->

If the repo has `.awm/sensors.json`, "done" requires sensor evidence in addition to test/build evidence.

**Before claiming done:**

```bash
awm sensors run --slow
```

- Exit 0 with `overall: pass` → sensors clean; proceed.
- Exit 1 with sensor failures → autocorrect using the LLM-formatted errors, re-run sensors, then claim done.

**Recurrence trigger:**

If the SAME sensor (same `name` + same `rule`) has failed in a prior session for this repo, do not just fix it — invoke the `harness-retro` skill. Recurring sensor failures mean the harness has a gap; `harness-retro` turns the recurrence into a structural rule.
```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: verification-sensors' registry/skills/verification-before-completion/SKILL.md | wc -l
```
Expected: `1`
