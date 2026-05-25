# Patch record: systematic-debugging ← harness-retro

**Target:** `registry/skills/systematic-debugging/SKILL.md`

**Marker:** `<!-- AWM-INTEGRATION: debugging-retro -->`

**Anchor:** The `## When Process Reveals "No Root Cause"` heading.

**Position:** Inserted IMMEDIATELY BEFORE this heading (i.e. after the Quick Reference table).

**Inserted text:**

```markdown
## Phase 5: Pattern Recognition (AWM harness-retro)

<!-- AWM-INTEGRATION: debugging-retro -->

After the fix is verified, ask one question:

> "Have I debugged this same root cause before in this repo?"

Check `docs/harness-retros.md` (if it exists) and recent commit messages matching `harness-retro:` for prior instances. If you find one:

- **Yes, second occurrence** → invoke the `harness-retro` skill. The fix you just shipped is one sample; the rule from harness-retro turns it into a class.
- **No, first occurrence** → ship the regression test (Phase 4 Step 1 already covers this) and move on. Don't structuralize on a single sample.

This is what closes the loop between debugging and the harness. Without it, every recurrence costs a full debug cycle.
```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: debugging-retro' registry/skills/systematic-debugging/SKILL.md | wc -l
```
Expected: `1`
