# Patch record: SDD code-quality-reviewer prompt ← harness-retro

**Target:** `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`

**Marker:** `<!-- AWM-INTEGRATION: reviewer-retro -->`

**Anchor:** The line ending with `focus on what this change contributed.)`.

**Position:** Added as a new bullet at the END of the bullet list directly under the "In addition to standard code quality concerns" header.

**Inserted text (single bullet appended after anchor line):**

```markdown
- **Systemic patterns:** Does the same flaw appear across ≥2 files in this change? If yes, name the pattern and recommend the orchestrator invoke the `harness-retro` skill after this review. Do NOT list every occurrence as a separate finding — name the pattern once and point to one example. <!-- AWM-INTEGRATION: reviewer-retro -->
```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: reviewer-retro' registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md | wc -l
```
Expected: `1`
