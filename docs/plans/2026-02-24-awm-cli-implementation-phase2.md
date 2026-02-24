# AWM CLI Implementation Plan - Phase 2

**Goal:** Implement the real-world integrations for the `awm` CLI based on the `awm-cli-design.md`. This phase focuses on connecting to the remote GitHub registry, downloading artifacts, extracting available processes and skills, and finalizing the interactive commands.

---

### Task 6: GitHub Registry Manager

**Files:**
- Create: `cli/src/core/registry.ts`
- Create: `cli/tests/core/registry.test.ts`

**Steps:**
1. Write tests for a class/module that uses `simple-git` to clone a repository into `~/.awm/registry` if it doesn't exist, or runs `git pull` if it does.
2. The remote URL should optionally default to the user's personal `agentic-workflow` repository.
3. Write the implementation in `cli/src/core/registry.ts`.
4. Validate with `cd cli && npx jest tests/core/registry.test.ts`.
5. Commit: `feat: add github registry syncing module`

---

### Task 7: Artifact Discovery and Parsing

**Files:**
- Create: `cli/src/core/discovery.ts`
- Create: `cli/tests/core/discovery.test.ts`

**Steps:**
1. Write tests to scan `~/.awm/registry/registry/skills` and `~/.awm/registry/registry/workflows` to return a list of valid artifacts.
2. Write tests to parse a `~/.awm/registry/registry/processes.json` file to return a list of available processes (bundles of skills/workflows).
3. Implement `cli/src/core/discovery.ts`.
4. Validate with Jest (`cd cli && npx jest tests/core/discovery.test.ts`).
5. Commit: `feat: add artifact and process discovery`

---

### Task 8: Wiring `awm add` to the Real Registry

**Files:**
- Modify: `cli/src/index.ts`

**Steps:**
1. Update the `awm add` command.
2. Before prompting, ensure the registry is synced (call the `registry` sync function with a loading spinner).
3. Use `discovery.ts` to get a list of all processes and skills.
4. Add a `@clack/prompts` select menu asking the user "What do you want to install?" and list the discovered processes and skills.
5. Iterate over the required artifacts for the selected process/skill and use the existing `installArtifact` function to symlink/copy them from the local registry to the destination IDE folder.
6. Test manually by running `cd cli && npm run start -- add`.
7. Commit: `feat: connect awm add to real github registry`

---

### Task 9: Implementing `awm update`

**Files:**
- Modify: `src/index.ts`

**Steps:**
1. Add a new `program.command('update')`.
2. Use `@clack/prompts` to show a spinner.
3. Call the `registry.ts` update method to `git pull` the latest changes.
4. Print a success message confirming that all symlinked skills and workflows are now up-to-date.
5. Test manually.
6. Commit: `feat: add awm update command`

---

### Task 10: Implementing `awm remove` (Optional / Stretch)

**Files:**
- Modify: `cli/src/index.ts`
- Modify: `cli/src/core/executor.ts` (if needed for cleanup)

**Steps:**
1. Implement logic to remove symlinks or copied folders from the destination agents.
2. Add `program.command('remove [name]')`.
3. Commit: `feat: add awm remove command`
