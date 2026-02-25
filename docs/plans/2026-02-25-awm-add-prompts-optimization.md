# AWM Add Interactive Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the `awm add` interactive prompts to ask Context (Agent, Scope) before Artifact, and default to the `copy` method for `local` installations to prevent broken symlinks in shared repositories.

**Architecture:** We will modify `cli/src/index.ts` to reorder the prompts. Specifically, Agent and Scope will be gathered first. Then, the Type and Artifact selection will occur. Finally, the Method prompt's default will be dynamically calculated based on the selected Scope (if `local`, default is `copy`; if `global`, default is `symlink`).

**Tech Stack:** TypeScript, Commander.js, Clack Prompts

---

### Task 1: Reorder Prompts in `awm add` to Context First

**Files:**
- Modify: `/Users/cencosud/Developments/personal/agentic-workflow/cli/src/index.ts:70-200`

**Step 1: Reorder the prompt logic in `index.ts`**
Move the Agent and Scope prompt logic *above* the Type and Artifact selection logic.

```typescript
// Move agent selection logic to happen right after parsing options and reading registry
let targetAgent: AgentTarget;
if (options.agent) {
    // ... validation
} else {
    // ... prompt
}

let scopeVal: Scope;
if (options.scope) {
   // ... validation
} else {
   // ... prompt
}

let installType: string;
if (options.type) {
    // ... validation
} else {
    // ... prompt
}

// ... artifact selection logic (skills array, workflows array, etc.)
```

**Step 2: Verify compilation and tests**
Run: `npm run build && npm run test` in the `cli/` directory.
Expected: PASS

**Step 3: Commit**
```bash
git add cli/src/index.ts
git commit -m "feat: reorder awm add prompts to ask agent and scope first"
```

---

### Task 2: Implement Dynamic Default Method based on Scope and detect identical Workflows

**Files:**
- Modify: `/Users/cencosud/Developments/personal/agentic-workflow/cli/src/index.ts`

**Step 1: Calculate default method dynamically and prompt workflow combination**
In the method prompt section, use the `scopeVal` to determine the `initialValue` and suggest optional complementary workflows if a skill with the same name exists for Antigravity.

```typescript
let methodVal: 'symlink' | 'copy';
if (options.method) {
    // ... validation
} else {
    const recommendedMethod = scopeVal === 'local' ? 'copy' : 'symlink';
    const methodChoice = await select({
        message: 'Installation method',
        options: [
            { value: 'symlink', label: `Symlink (Updates instantly)${recommendedMethod === 'symlink' ? ' - Recommended' : ''}` },
            { value: 'copy', label: `Copy to agent${recommendedMethod === 'copy' ? ' - Recommended for Git repos' : ''}` }
        ],
        initialValue: recommendedMethod
    });
    handleCancel(methodChoice);
    methodVal = methodChoice as 'symlink' | 'copy';
}

// Bonus logic (after selecting a skill):
// If agent is antigravity, and user chose a skill, check if a workflow with the same name exists.
// If so, ask: "A complementary workflow exists for Antigravity. Install it too?"
```

**Step 2: Run build to verify types**
Run: `npm run build`
Expected: PASS

**Step 3: Commit**
```bash
git add cli/src/index.ts
git commit -m "feat: set copy as default method for local scope and suggest complementary workflows"
```
