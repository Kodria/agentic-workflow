# AWM CLI Core

This directory contains the source code for the `agentic-workflow-manager` Command Line Interface.

Built with Node.js and TypeScript, the CLI uses `@clack/prompts` to deliver a zero-friction, interactive Text User Interface (TUI) for adding artifacts from the `../registry/` directory into the local OS environment.

## 📁 Directory Structure

The CLI is cleanly layered to decouple configuration mapping from core engine logic:
- `src/index.ts`: The main entrypoint, orchestrating Commander args and Clack prompts.
- `src/core/`: The core engine modules:
  - `registry.ts`: Reads paths pointing to `.awm/cli-source/registry/` and parses YAML/JSON manifests.
  - `discovery.ts`: Provides searching, mapping, and categorization inside the registry format.
  - `executor.ts`: The installation logic handling target validations, filesystem hooks, Copy execution, and Symlink deployment.
- `src/providers/`: Encapsulates logic for routing. e.g. mapping `antigravity` to `~/.gemini/antigravity/` vs mapped `opencode` to standard OS `.agents/` targets.
- `src/utils/`: Common helpers like git wrappers or string formatting flags.
- `tests/`: Extensive Jest test suites mirroring each module in `src/`.

---

## 🛠 Developer Guide

If you are contributing bug fixes to the CLI or implementing support for a new AI Agent ecosystem (e.g. extending `src/providers/`), follow these steps to work on the CLI locally:

### 1. Requirements
Ensure you have Node.js and `npm` installed.

### 2. Install Dependencies
Navigate to this directory (`/cli/`) and install dev packages:
```bash
npm install
```

### 3. Build the CLI
Because the CLI uses TypeScript, the source must be transpiled to CommonJS/ESM before Node can natively execute the Javascript output via Commander.
```bash
npm run build
```
This generates the runnable output under `dist/index.js`.

### 4. Running the Tests
Before submitting a PR, ensure that the core discovery/executor functionality passes the existing test suite:
```bash
npm test
```
The goal is to maintain 100% passing tests for any new CLI parameter flags.

### 5. Local Execution (Testing changes locally)

**Method A: Typescript Native execution (Slower)**
Useful for quick testing without building.
```bash
npm run start -- add "specific-name" --agent antigravity --scope global
```

**Method B: Global NPM Linking (Recommended for interactive QA)**
Links your compiled `dist/` directory directly to your global `awm` path, ensuring you are testing the exact binary output the end-user will see.
```bash
npm run build
npm link
```
Now simply type `awm` from any path on your machine.
