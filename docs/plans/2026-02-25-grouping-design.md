# Artifact Grouping Design Proposal

## 1. `awm list`
Instead of a flat table/list, we will parse `processes.json` and display a tree-like output in the console.

**Mockup:**
```
📦 Process: core-dev
  ├─ 🧠 brainstorming
  ├─ ⚡ brainstorming.md
  ├─ 🧠 writing-plans
  └─ ⚡ writing-plans.md

📦 Process: docs
  ├─ 🧠 docs-system-orchestrator
  ├─ ⚡ docs-system-orchestrator.md
  ├─ ...

🔹 Standalone Artifacts
  ├─ 🧠 my-custom-skill
  └─ ⚡ standalone-workflow.md
```

## 2. `awm add`
Since the CLI prompt library (`@clack/prompts`) does not support auto-toggling children when a parent is checked, we will display a **flat but visually grouped multiselect list**.
If you check a `📦 Process`, the code will silently include all of its children in the background regardless of whether you checked the children individually.

**Prompt Mockup:**
```
What do you want to install?
Instructions: Press Space to select, Enter to confirm

[ ] 📦 Process: core-dev (Selects all items below)
[ ]   ├─ 🧠 brainstorming
[ ]   ├─ ⚡ brainstorming.md
[ ]   └─ 🧠 writing-plans
[ ] 📦 Process: docs (Selects all items below)
[ ]   ├─ 🧠 docs-system-orchestrator
[ ]   └─ ⚡ docs-system-orchestrator.md
[ ] 🔹 Standalone
[ ]   └─ 🧠 my-custom-skill
```

## 3. `awm remove`
Similar to `awm add`, we will query all *installed* artifacts, figure out which process they belong to using `processes.json`, and group them visually in the multiselect prompt.

**Prompt Mockup:**
```
Select artifact(s) to remove:
Instructions: Press Space to select, Enter to confirm

[ ] 📦 Process: core-dev (Removes all installed core-dev items)
[ ]   ├─ 🧠 brainstorming (in: antigravity)
[ ]   └─ ⚡ brainstorming.md (in: antigravity)
[ ] 🔹 Standalone
[ ]   └─ 🧠 old-skill (in: opencode)
```
