# awm-cli-implementation-phase3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finalize the remaining commands, UX mapping, and global install script for AWM CLI to be distributable and fully bootstrapped with the user's local components.

**Architecture:** Mueve las configuraciones y herramientas alojadas en `~/.agents/` hacia la estructura persistente `registry/` del repositorio actual. Expande el script `cli/src/index.ts` con opciones non-interactive (flags), añade el comando `awm list` para visibilidad usando `@clack/prompts` o console bounds, y genera un `install.sh` y configuración npm para distribución remota.

**Tech Stack:** Node.js, commander, @clack/prompts, bash script, npm.

---

### Task 1: Migration - Populate Registry with Existing Global Skills

**Files:**
- Create: `registry/processes.json`

**Step 1: Write the failing test**

*(No test needed for a pure file-moving step, but we define the CLI validation)*

```bash
ls registry/skills/brainstorming/SKILL.md
```

**Step 2: Run test to verify it fails**

Run: `ls registry/skills/brainstorming/SKILL.md`
Expected: FAIL with "No such file or directory"

**Step 3: Write minimal implementation**

```bash
mkdir -p registry/skills
mkdir -p registry/workflows
cp -r ~/.agents/skills/* registry/skills/
cp -r ~/.gemini/antigravity/global_workflows/* registry/workflows/

cat << 'EOF' > registry/processes.json
[
  {
    "name": "core-dev",
    "description": "Las habilidades fundamentales para el desarrollo guiado por agentes.",
    "skills": ["brainstorming", "writing-plans", "executing-plans", "subagent-driven-development", "test-driven-development"],
    "workflows": ["brainstorming", "writing-plans", "executing-plans"]
  },
  {
    "name": "cscti-docs",
    "description": "Herramientas de documentación con estándar CSCTI",
    "skills": ["cscti-docs-assistant", "cscti-template-manager", "cscti-template-wizard"],
    "workflows": ["cscti-docs-assistant", "cscti-template-manager", "cscti-template-wizard"]
  },
  {
    "name": "module-docs",
    "description": "Utilidades para documentar módulos a nivel técnico y de negocio",
    "skills": ["documenting-modules", "business-documenting-modules"],
    "workflows": ["documenting-modules", "business-documenting-modules"]
  },
  {
    "name": "utils",
    "description": "Flujos sueltos y utilidades menores",
    "skills": ["project-context-init", "requesting-code-review", "find-skills", "skill-creator"],
    "workflows": ["project-context-init", "commit-name", "docs-system-orchestrator", "issues-as-notion-task"]
  }
]
EOF
```

**Step 4: Run test to verify it passes**

Run: `ls registry/skills/brainstorming/SKILL.md`
Expected: PASS (file exists)

**Step 5: Commit**

```bash
git add registry/
git commit -m "chore: migrate existing global skills and workflows to local registry"
```

---

### Task 2: CLI Polish - Implement `awm list` Command

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Write the failing test**

```typescript
// En terminal, probar comando que no existe
```

**Step 2: Run test to verify it fails**

Run: `npm run start -- list`
Expected: FAIL with "error: unknown command 'list'"

**Step 3: Write minimal implementation**

(Modificar `cli/src/index.ts`, agregar import de `picocolors` y el comando `list`)
```typescript
program.command('list')
    .description('List all available artifacts in the local cache registry')
    .action(async () => {
        try {
            await syncRegistry();
            const cachePath = path.join(os.homedir(), '.awm', 'registry', 'registry');
            const skills = getAvailableSkills(cachePath);
            const workflows = getAvailableWorkflows(cachePath);
            const processesList = getAvailableProcesses(cachePath);

            p.intro(`${color.bgCyan(color.black(' AWM Registry Listing '))}`);
            p.log.step(`${color.cyan('Skills:')} ${skills.length} available`);
            if (skills.length > 0) p.log.message(skills.join(', '));
            
            p.log.step(`${color.cyan('Workflows:')} ${workflows.length} available`);
            if (workflows.length > 0) p.log.message(workflows.join(', '));

            p.log.step(`${color.cyan('Processes:')} ${processesList.length} available`);
            processesList.forEach(proc => {
                p.log.message(`- ${color.bold(proc.name)}: ${proc.description}`);
            });
            p.outro(`Run ${color.green('awm add')} to install any of these artifacts.`);
        } catch (error: any) {
            p.log.error(color.red(`Failed to list artifacts: ${error.message}`));
            process.exit(1);
        }
    });
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node dist/index.js list`
Expected: PASS and correctly lists all skills, workflows, and processes in `registry/`.

**Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat: add awm list command"
```

---

### Task 3: CLI Polish - Non-Interactive Support (Flags for `add`)

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Write the failing test**

```bash
node dist/index.js add project-context-init --yes
```

**Step 2: Run test to verify it fails**

Run: `npm run build && node dist/index.js add project-context-init --yes`
Expected: FAIL or ignoring the flags and pausing to prompt interactive select.

**Step 3: Write minimal implementation**

(Update `cli/src/index.ts`, modifying `program.command('add [name]')` with option flags)
```typescript
program.command('add [name]')
    .description('Add a skill, workflow, or process interactively')
    .option('-y, --yes', 'Skip confirmation and use defaults or provided flags')
    .option('-t, --type <type>', 'Type of artifact (skill, workflow, process)')
    .option('-a, --agent <agent>', 'Target agent (antigravity, o1, etc)')
    .option('-s, --scope <scope>', 'Target scope (local or global)')
    .option('-m, --method <method>', 'Installation method (symlink or copy)')
    .action(async (name, options) => {
        // Enforce validations and inject logic to skip @clack/prompts when options.yes is true.
        // If not all required flags are provided and --yes is used, throw an error.
        // Otherwise, inject the values directly into the execution flow.
        // Implementación detallada requerida en el código...
    });
```

*(Note: The executing agent should implement the complete logic overriding `p.select` variables with `options.xyz` and exiting early on `--yes` if missing mandatory options)*

**Step 4: Run test to verify it passes**

Run: `npm run build && node dist/index.js add cscti-docs --yes --type process --agent antigravity --scope global --method symlink`
Expected: PASS, skips promos and installs artifacts successfully without user interaction.

**Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat: add non-interactive flags support to awm add command"
```

---

### Task 4: Distribution - NPM Publishing Config & bin wrapper

**Files:**
- Modify: `cli/package.json`
- Modify: `cli/src/index.ts`

**Step 1: Write the failing test**

Try to run the script via environment shell lookup:
```bash
awm --help
```

**Step 2: Run test to verify it fails**

Run: `awm --help`
Expected: FAIL "command not found: awm"

**Step 3: Write minimal implementation**

Modify `cli/src/index.ts` to include shebang at line 1:
```typescript
#!/usr/bin/env node
```

Modify `cli/package.json`:
```json
{
  "name": "agentic-workflow-manager",
  "version": "1.0.0",
  "description": "CLI to manage Agentic Workflows",
  "bin": {
    "awm": "./dist/index.js"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && npm run build && npm link && awm --help`
Expected: PASS (Displays AWM CLI help menu system-wide via symlink)

**Step 5: Commit**

```bash
git add cli/package.json cli/src/index.ts
git commit -m "chore: add bin configuration for npm global install"
```

---

### Task 5: Distribution - Install Script (`install.sh`)

**Files:**
- Create: `install.sh`

**Step 1: Write the failing test**

```bash
./install.sh
```

**Step 2: Run test to verify it fails**

Run: `bash install.sh`
Expected: FAIL "No such file or directory"

**Step 3: Write minimal implementation**

```bash
cat << 'EOF' > install.sh
#!/usr/bin/env bash

set -e

echo "🚀 Installing Agentic Workflow Manager (AWM)..."

# Requirements check
if ! command -v git &> /dev/null; then
    echo "❌ Error: git is not installed."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed."
    exit 1
fi

# Install CLI globally from GitHub directly
echo "📦 Installing awm package globally via npm..."
npm install -g git+https://github.com/crisecheverria/agentic-workflow.git

# Trigger an invisible update to fetch registry
echo "🔄 Bootstrapping local registry..."
awm update > /dev/null 2>&1

echo "✅ AWM installed successfully!"
echo "Run 'awm --help' to get started."
EOF
chmod +x install.sh
```

**Step 4: Run test to verify it passes**

Run: `./install.sh`
Expected: PASS - installs `awm` and bootstraps `~/.awm/registry`.

**Step 5: Commit**

```bash
git add install.sh
git commit -m "feat: add global curl bash installer script"
```
