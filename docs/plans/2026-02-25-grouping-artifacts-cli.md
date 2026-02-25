# CLI Artifact Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modify `awm list`, `awm add`, and `awm remove` to group skills and workflows intelligently using `processes.json` to reduce long unorganized lists.

**Architecture:** We will introduce grouping logic that correlates artifacts with `processes.json`. For `awm list`, this translates to a tree-like terminal output. For `awm add` and `awm remove`, it translates to a custom `multiselect` list where processes act as "group headers." Selecting a process header automatically selects/removes all its children artifacts behind the scenes.

**Tech Stack:** TypeScript, Commander.js, `@clack/prompts`

---

### Task 1: Create Grouping Utility

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Write grouping utility**

Insert this anywhere before `program.command('list')`:

```typescript
function buildGroupedOptions(
    artifacts: Array<{ name: string; type: ArtifactType; [k: string]: any }>,
    processes: ProcessDefinition[],
    formatLabel: (a: any) => string
) {
    const processMap = new Map<string, ProcessDefinition>();
    processes.forEach(p => processMap.set(p.name, p));

    const grouped = new Map<string, any[]>();
    const standalone: any[] = [];

    for (const a of artifacts) {
        let foundParent = false;
        for (const p of processes) {
            const matchName = a.type === 'workflow' ? a.name.replace('.md', '') : a.name;
            if ((a.type === 'skill' && p.skills.includes(matchName)) ||
                (a.type === 'workflow' && p.workflows.includes(matchName))) {
                
                if (!grouped.has(p.name)) grouped.set(p.name, []);
                grouped.get(p.name)!.push(a);
                foundParent = true;
                break;
            }
        }
        if (!foundParent) {
            standalone.push(a);
        }
    }

    const options: { value: any, label: string }[] = [];

    for (const [procName, children] of grouped.entries()) {
        const procItem = { isProcessHeader: true, name: procName, children };
        options.push({ value: procItem, label: `📦 Process: ${procName} (Selects ${children.length} artifacts)` });
        
        children.forEach((c, idx) => {
            const isLast = idx === children.length - 1;
            const prefix = isLast ? '  └─ ' : '  ├─ ';
            options.push({ value: { isChild: true, artifact: c }, label: `${prefix}${formatLabel(c)}` });
        });
    }

    if (standalone.length > 0) {
        options.push({ value: { isHeader: true }, label: `🔹 Standalone Artifacts` });
        standalone.forEach((c, idx) => {
            const isLast = idx === standalone.length - 1;
            const prefix = isLast ? '  └─ ' : '  ├─ ';
            options.push({ value: { isChild: true, artifact: c }, label: `${prefix}${formatLabel(c)}` });
        });
    }

    return options;
}

function resolveSelectedArtifacts(selections: any[]): any[] {
    const finalArtifacts = new Map<string, any>();
    
    for (const sel of selections) {
        if (sel.isHeader) continue;
        if (sel.isProcessHeader) {
            sel.children.forEach((c: any) => finalArtifacts.set(c.name, c));
        } else if (sel.isChild) {
            finalArtifacts.set(sel.artifact.name, sel.artifact);
        } else {
            // Direct artifact (fallback)
            finalArtifacts.set(sel.name, sel);
        }
    }
    return Array.from(finalArtifacts.values());
}
```

**Step 2: Commit**
```bash
git add cli/src/index.ts
git commit -m "feat(cli): add artifact grouping utility functions"
```

---

### Task 2: Refactor `awm list`

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Apply grouping logic to `awm list` loop**
Instead of flat logging inside `awm list` loop:

```typescript
// Replace the flat `for (const a of installed) { ... }` with:
const opts = buildGroupedOptions(installed, processes, (a) => `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name}`);

for (const opt of opts) {
    if (opt.value.isProcessHeader || opt.value.isHeader) {
        console.log(`\n${pc.bold(pc.cyan(opt.label))}`);
    } else {
        console.log(opt.label);
    }
}
console.log(); // blank line
```

**Step 2: Commit**
```bash
git add cli/src/index.ts
git commit -m "feat(cli): group artifacts in awm list output"
```

---

### Task 3: Refactor `awm add`

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Replace selection logic in `awm add`**
Replace `installType === undefined` logic (Steps 4 & 5 where user picks generic skill/workflow):

```typescript
      let artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] = [];

      // Consolidate all available remote artifacts
      const allAvailable = [
          ...skills.map(s => ({ ...s, type: 'skill' as ArtifactType, sourcePath: path.join(SKILLS_DIR, s.name) })),
          ...(targetAgents.includes('antigravity') ? workflows.map(w => ({ 
              name: `${w}.md`, type: 'workflow' as ArtifactType, sourcePath: path.join(WORKFLOWS_DIR, `${w}.md`) 
          })) : [])
      ];

      const options = buildGroupedOptions(allAvailable, processes, (a) => `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name}`);

      const choice = await multiselect({
          message: 'Select artifact(s) to install',
          options,
          required: true
      });
      handleCancel(choice);

      // Resolve the selections back into flat artifact lists
      artifactsToInstall = resolveSelectedArtifacts(choice as any[]);
```
*Note: Ensure to remove the old intermediate questions ("Process, Skill, or Workflow?"). `awm add` without arguments now immediately shows the entire categorized multiselect tree.*

**Step 2: Check & compile**
Run `npm run build` and `awm add` locally to test it opens the multiselect menu.

**Step 3: Commit**
```bash
git add cli/src/index.ts
git commit -m "feat(cli): group artifacts visually in awm add via multiselect"
```

---

### Task 4: Refactor `awm remove`

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Use `buildGroupedOptions` in `awm remove`**
Change `toRemove` multiselect logic.

```typescript
      // From:
      const toRemove = await multiselect({
          message: 'Select artifact(s) to remove',
          options: installed.map(...)
      });
      
      // To:
      const options = buildGroupedOptions(installed, processes, (a) => `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name} ${pc.dim(`(in: ${a.installedIn.join(', ')})`)}`);

      const choice = await multiselect({
          message: 'Select artifact(s) to remove',
          options,
          required: true
      });
      handleCancel(choice);

      const artifacts = resolveSelectedArtifacts(choice as any[]) as typeof installed;
```

**Step 2: Check & compile**
Run `npm run build` and `awm remove` locally.

**Step 3: Commit**
```bash
git add cli/src/index.ts docs/plans/2026-02-25-grouping-artifacts-cli.md
git commit -m "feat(cli): group artifacts visually in awm remove via multiselect"
```
