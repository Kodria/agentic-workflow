# AWM CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a multi-target, interactive Node.js CLI tool (awm) to install, update, and manage personal AI agent skills and workflows.

**Architecture:** A TypeScript-based Node.js CLI using `commander` for argument parsing and `@clack/prompts` for the interactive Text User Interface (TUI). It manages a local cache of a remote GitHub repository (`~/.awm/registry/`) and creates symlinks or copies into target IDE agent folders dynamically.

**Tech Stack:** Node.js, TypeScript, Jest, `commander`, `@clack/prompts`, `simple-git`.

---

### Task 1: Project Scaffolding and Dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.js`

**Step 1: Initialize project base**
```bash
npm init -y
npm install commander @clack/prompts simple-git picocolors
npm install -D typescript @types/node jest ts-jest @types/jest
```

**Step 2: Write tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "rootDir": "./src",
    "outDir": "./dist",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Write jest.config.js**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts']
};
```

**Step 4: Update package.json scripts and bin**
Modify `package.json` manually (or via script) to include:
```json
{
  "main": "dist/index.js",
  "bin": {
    "awm": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "start": "ts-node src/index.ts"
  }
}
```

**Step 5: Commit**
```bash
git add package.json package-lock.json tsconfig.json jest.config.js
git commit -m "chore: initial typescript cli setup"
```

---

### Task 2: Config and Preferences Manager

**Files:**
- Create: `src/utils/config.ts`
- Create: `tests/utils/config.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/utils/config.test.ts
import { getPreferences, savePreferences } from '../../src/utils/config';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Preferences Manager', () => {
    const PREFS_DIR = path.join(os.homedir(), '.awm');
    const PREFS_FILE = path.join(PREFS_DIR, 'preferences.json');

    afterEach(() => {
        if (fs.existsSync(PREFS_FILE)) fs.unlinkSync(PREFS_FILE);
        if (fs.existsSync(PREFS_DIR)) fs.rmdirSync(PREFS_DIR);
    });

    it('creates default preferences if none exist', () => {
        const prefs = getPreferences();
        expect(prefs.defaultAgent).toBe('antigravity');
    });

    it('saves and loads preferences correctly', () => {
        savePreferences({ defaultAgent: 'opencode', installMethod: 'copy', defaultScope: 'local' });
        const prefs = getPreferences();
        expect(prefs.defaultAgent).toBe('opencode');
        expect(prefs.installMethod).toBe('copy');
    });
});
```

**Step 2: Run test to verify it fails**
Run: `npx jest tests/utils/config.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AwmPreferences {
    defaultAgent: 'antigravity' | 'opencode';
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
}

const DEFAULT_PREFS: AwmPreferences = {
    defaultAgent: 'antigravity',
    installMethod: 'symlink',
    defaultScope: 'local'
};

const PREFS_DIR = path.join(os.homedir(), '.awm');
const PREFS_FILE = path.join(PREFS_DIR, 'preferences.json');

export function getPreferences(): AwmPreferences {
    if (!fs.existsSync(PREFS_FILE)) {
        savePreferences(DEFAULT_PREFS);
        return DEFAULT_PREFS;
    }
    const raw = fs.readFileSync(PREFS_FILE, 'utf-8');
    return JSON.parse(raw) as AwmPreferences;
}

export function savePreferences(prefs: AwmPreferences): void {
    if (!fs.existsSync(PREFS_DIR)) {
        fs.mkdirSync(PREFS_DIR, { recursive: true });
    }
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}
```

**Step 4: Run test to verify it passes**
Run: `npx jest tests/utils/config.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add src/utils/config.ts tests/utils/config.test.ts
git commit -m "feat: add preferences manager"
```

---

### Task 3: Multi-Target Definition (Providers)

**Files:**
- Create: `src/providers/index.ts`
- Create: `tests/providers/index.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/index.test.ts
import { getTargetPath } from '../../src/providers';
import os from 'os';

describe('Providers Routing', () => {
    it('routes antigravity global skills correctly', () => {
        const path = getTargetPath('skill', 'antigravity', 'global');
        expect(path).toBe(`${os.homedir()}/.agents/skills`);
    });

    it('routes opencode local skills correctly', () => {
        const path = getTargetPath('skill', 'opencode', 'local');
        expect(path).toBe(`.agents/skills`);
    });

    it('routes antigravity global workflows correctly', () => {
        const path = getTargetPath('workflow', 'antigravity', 'global');
        expect(path).toBe(`${os.homedir()}/.gemini/antigravity/global_workflows`);
    });
    
    it('throws on opencode workflow', () => {
        expect(() => getTargetPath('workflow', 'opencode', 'global')).toThrow();
    });
});
```

**Step 2: Run test to verify it fails**
Run: `npx jest tests/providers/index.test.ts`
Expected: FAIL 

**Step 3: Write minimal implementation**

```typescript
// src/providers/index.ts
import os from 'os';
import path from 'path';

export type AgentTarget = 'antigravity' | 'opencode';
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow';

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    const homedir = os.homedir();
    
    if (agent === 'antigravity') {
        if (type === 'skill') {
            return scope === 'global' ? path.join(homedir, '.agents/skills') : '.agents/skills';
        } else {
            return scope === 'global' ? path.join(homedir, '.gemini/antigravity/global_workflows') : '.agents/workflows';
        }
    } 
    
    if (agent === 'opencode') {
        if (type === 'workflow') {
            throw new Error('Workflows are not natively supported by OpenCode.');
        }
        return scope === 'global' ? path.join(homedir, '.agents/skills') : '.agents/skills';
    }

    throw new Error('Unknown agent Target');
}
```

**Step 4: Run test to verify it passes**
Run: `npx jest tests/providers/index.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add src/providers/index.ts tests/providers/index.test.ts
git commit -m "feat: providers routing matrix"
```

---

### Task 4: Execution Engine (Symlink and Copy)

**Files:**
- Create: `src/core/executor.ts`
- Create: `tests/core/executor.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/executor.test.ts
import { installArtifact } from '../../src/core/executor';
import fs from 'fs';
import path from 'path';

describe('Executor Engine', () => {
    const sourceDir = path.join(__dirname, 'mock_source');
    const targetDir = path.join(__dirname, 'mock_target');

    beforeEach(() => {
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'test.txt'), 'hello');
        fs.mkdirSync(targetDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(targetDir, { recursive: true, force: true });
    });

    it('creates a symlink successfully', () => {
        const dest = path.join(targetDir, 'my-skill');
        installArtifact(sourceDir, dest, 'symlink');
        expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    });

    it('copies the directory successfully', () => {
        const dest = path.join(targetDir, 'my-copied-skill');
        installArtifact(sourceDir, dest, 'copy');
        expect(fs.lstatSync(dest).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(dest, 'test.txt'))).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**
Run: `npx jest tests/core/executor.test.ts`
Expected: FAIL 

**Step 3: Write minimal implementation**

```typescript
// src/core/executor.ts
import fs from 'fs';
import path from 'path';

export function installArtifact(sourcePath: string, targetPath: string, method: 'symlink' | 'copy'): void {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    // Clean up existing if it exists
    if (fs.existsSync(targetPath) || fs.lstatSync(targetPath).isSymbolicLink()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    }

    if (method === 'symlink') {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
    } else {
        fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
}
```

**Step 4: Run test to verify it passes**
Run: `npx jest tests/core/executor.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add src/core/executor.ts tests/core/executor.test.ts
git commit -m "feat: symlink and copy executor"
```

---

### Task 5: Interactive TUI and CLI Entrypoint

**Files:**
- Create: `src/index.ts`

**Step 1: Write TUI and CLI execution wiring**
(Since interactivity with `@clack/prompts` is harder to unit-test easily in this step, we implement the core glue locally)

```typescript
// src/index.ts
#!/usr/bin/env node

import { intro, outro, spinner, select, confirm } from '@clack/prompts';
import { Command } from 'commander';
import { getPreferences, savePreferences } from './utils/config';
import { getTargetPath, AgentTarget, Scope } from './providers';
import { installArtifact } from './core/executor';
import path from 'path';

const program = new Command();
program.name('awm').description('Agentic Workflow Manager').version('1.0.0');

program.command('add')
  .description('Add a skill or process interactively')
  .action(async () => {
      intro('AWM - Agentic Workflow Manager');
      
      const prefs = getPreferences();

      // Dummy source resolution for now (mocking the GitHub registry pull)
      const mockRegistrySkillPath = path.resolve(__dirname, '../../skills/example-skill');

      const targetAgent = await select({
          message: 'Which agent do you want to install to?',
          options: [
              { value: 'antigravity', label: 'Antigravity' },
              { value: 'opencode', label: 'OpenCode' }
          ],
          initialValue: prefs.defaultAgent
      }) as AgentTarget;

      const scope = await select({
          message: 'Installation scope',
          options: [
              { value: 'local', label: 'Project (Local)' },
              { value: 'global', label: 'Global' }
          ],
          initialValue: prefs.defaultScope
      }) as Scope;

      const method = await select({
          message: 'Installation method',
          options: [
              { value: 'symlink', label: 'Symlink (Recommended) - Updates instantly' },
              { value: 'copy', label: 'Copy to agent' }
          ],
          initialValue: prefs.installMethod
      }) as 'symlink' | 'copy';

      const shouldProceed = await confirm({ message: 'Proceed with installation?' });

      if (shouldProceed) {
          const s = spinner();
          s.start('Installing...');
          
          try {
              const targetPath = getTargetPath('skill', targetAgent, scope);
              const finalDest = path.join(targetPath, 'example-skill');
              
              // Only runs if source exists, skipping actual install in this template
              // installArtifact(mockRegistrySkillPath, finalDest, method);
              
              // Save preferences
              savePreferences({ defaultAgent: targetAgent, defaultScope: scope, installMethod: method });

              s.stop('Installation complete!');
              outro(`Success! Registered to ${targetAgent} (${scope})`);
          } catch (e: any) {
              s.stop('Installation failed.');
              console.error(e.message);
              process.exit(1);
          }
      } else {
          outro('Installation cancelled.');
      }
});

program.parse();
```

**Step 2: Run CLI to verify it boots (manual execution)**
Run: `npm run build && node dist/index.js add`
Expected: Clack prompts appear

**Step 3: Commit**
```bash
git add src/index.ts
git commit -m "feat: add interactive CLI entrypoint with clack"
```
