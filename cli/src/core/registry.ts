// src/core/registry.ts
import fs from "fs";
import path from "path";
import os from "os";
import simpleGit from "simple-git";

export const REGISTRY_DIR = path.join(os.homedir(), ".awm", "registry");
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
    await repoGit.pull();
  }
}
