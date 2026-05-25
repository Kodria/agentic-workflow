# Patch record: receiving-code-review ← harness-retro

**Target:** `registry/skills/receiving-code-review/SKILL.md`

**Marker:** `<!-- AWM-INTEGRATION: receiving-retro -->`

**Anchor:** The section header `## The Bottom Line` (near end of file).

**Position:** Inserted IMMEDIATELY BEFORE the `## The Bottom Line` line.

**Inserted text:**

```markdown
## Recurring Feedback (AWM)

<!-- AWM-INTEGRATION: receiving-retro -->

If the SAME feedback item has appeared on a prior PR (check the last 5–10 merged PRs for matching language), do not just apply the fix this time — invoke the `harness-retro` skill.

Recurring review feedback means the human reviewer is acting as the harness for a class of issues the automated harness misses. `harness-retro` promotes the human-loop check into a sensor/test/rule so the reviewer's time goes to genuinely new things next round.
```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: receiving-retro' registry/skills/receiving-code-review/SKILL.md | wc -l
```
Expected: `1`
