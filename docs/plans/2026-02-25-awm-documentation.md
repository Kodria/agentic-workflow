# AWM Documentation Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a comprehensive, modular documentation strategy for the AWM repository catering to end-users and contributors.

**Architecture:** A primary `README.md` at the root acts as a landing page for quick start and user adoption. Detailed technical documentation is decentralized into a `docs/` folder (architecture, cli reference, registry guide), and specific sub-READMEs are added for developers (`cli/README.md`).

**Tech Stack:** Markdown, Git.

---

### Task 1: Create Root `README.md` (Landing Page)

**Files:**
- Create: `README.md` (root directory)

**Step 1: Write the documentation content**

Create a comprehensive landing page explaining AWM, quick start (`curl | bash`), basic commands (`awm add`, `awm update`), and linking to deeper documentation in `docs/`.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: create main README with quick start and overview"
```

---

### Task 2: Create `docs/architecture.md`

**Files:**
- Create: `docs/architecture.md`

**Step 1: Write the documentation content**

Extract the architectural concepts from the initial design doc (Logical Monorepo, Local Cache, Multi-Target Support/Providers, Symlink vs Copy) into a clean, formal architecture document.

**Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: detail system architecture and providers"
```

---

### Task 3: Create `docs/cli-reference.md`

**Files:**
- Create: `docs/cli-reference.md`

**Step 1: Write the documentation content**

Document the core commands: `awm list`, `awm add [name]` (with all non-interactive flags), `awm update`, `awm remove [name]`, and `awm help`. Include examples for the non-interactive flags.

**Step 2: Commit**

```bash
git add docs/cli-reference.md
git commit -m "docs: add comprehensive CLI command reference"
```

---

### Task 4: Create `docs/registry-guide.md`

**Files:**
- Create: `docs/registry-guide.md`

**Step 1: Write the documentation content**

Create a guide for contributors explaining how to build for the registry: Anatomy of a Skill (`SKILL.md`), Anatomy of a Workflow, and how to bundle them in `processes.json`.

**Step 2: Commit**

```bash
git add docs/registry-guide.md
git commit -m "docs: add contributor guide for registry artifacts"
```

---

### Task 5: Create `cli/README.md` (Developer Guide)

**Files:**
- Create: `cli/README.md`

**Step 1: Write the documentation content**

Create a guide specifically for developers working on the CLI source code. Include instructions for `npm install`, `npm run build`, `npm test`, and `npm link`, plus an overview of the CLI folder structure.

**Step 2: Commit**

```bash
git add cli/README.md
git commit -m "docs: add developer guide for the CLI package"
```
