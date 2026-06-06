// src/core/registry.ts
import fs from "fs";
import path from "path";
import os from "os";
import simpleGit from "simple-git";
import { spawnSync } from "child_process";

const AWM_HOME = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), ".awm");
export const REGISTRY_DIR = path.join(AWM_HOME, "cli-source");
export const DEFAULT_REMOTE = "https://github.com/Kodria/agentic-workflow.git";

/**
 * Syncs the local registry cache with the remote repository.
 * - If the registry doesn't exist locally, it clones the repo.
 * - If it already exists, it runs `git pull` to get the latest.
 */
export async function syncRegistry(remoteUrl?: string): Promise<void> {
  const remote = remoteUrl ?? DEFAULT_REMOTE;
  const git = simpleGit();

  if (!fs.existsSync(REGISTRY_DIR)) {
    const parentDir = path.dirname(REGISTRY_DIR);
    fs.mkdirSync(parentDir, { recursive: true });
    await git.clone(remote, REGISTRY_DIR);
  } else {
    const repoGit = simpleGit(REGISTRY_DIR);
    await repoGit.reset(['--hard']);
    await repoGit.pull();
  }
}

export type BuildResult = { success: true } | { success: false; error: string };

export function buildCli(cliDir: string = path.join(REGISTRY_DIR, "cli")): BuildResult {
  try {
    const result = spawnSync("npm", ["run", "build"], {
      cwd: cliDir,
      stdio: "pipe",
      shell: true,
      timeout: 120_000, // Allow up to 2 minutes for tsc on slow machines / cold builds
    });
    if (result.status !== 0) {
      const msg =
        result.error?.message ||
        result.stderr?.toString().trim() ||
        result.stdout?.toString().trim() ||
        "tsc build failed with no output";
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
