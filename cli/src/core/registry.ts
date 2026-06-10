// src/core/registry.ts
import fs from "fs";
import path from "path";
import os from "os";
import simpleGit from "simple-git";
import { spawnSync } from "child_process";
import { getPreferences } from "../utils/config";
import { resolveTargetRef, type ResolvedRef, type Channel } from "./versioning";

const AWM_HOME = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), ".awm");
export const REGISTRY_DIR = path.join(AWM_HOME, "cli-source");
export const DEFAULT_REMOTE = "https://github.com/Kodria/agentic-workflow.git";

export type BaseRemoteSource = 'env' | 'prefs' | 'default';

/** Remote efectivo del registry base y su origen: env AWM_BASE_REMOTE > preferences.baseRemote > DEFAULT_REMOTE. */
export function resolveBaseRemoteInfo(): { remote: string; source: BaseRemoteSource } {
    if (process.env.AWM_BASE_REMOTE) return { remote: process.env.AWM_BASE_REMOTE, source: 'env' };
    try {
        const prefs = getPreferences();
        if (prefs.baseRemote) return { remote: prefs.baseRemote, source: 'prefs' };
    } catch {
        // preferencias ilegibles no deben bloquear un update — cae al default
    }
    return { remote: DEFAULT_REMOTE, source: 'default' };
}

export function resolveBaseRemote(): string {
    return resolveBaseRemoteInfo().remote;
}

/**
 * Sincroniza el clone local del registry base y lo deja checkouteado en el
 * ref resuelto (pin > último tag semver > HEAD según canal) — WS-3.
 * - Clone fresco si no existe; si existe, reset --hard + fetch + checkout.
 * - Tags dejan el clone en detached HEAD (esperado); head/head-fallback
 *   checkoutean el branch y pullean.
 */
export async function syncRegistry(
  remoteUrl?: string,
  opts?: { pin?: string; channel?: Channel }
): Promise<ResolvedRef> {
  const remote = remoteUrl ?? DEFAULT_REMOTE;
  const { pin, channel = 'stable' } = opts ?? {};

  const freshClone = !fs.existsSync(REGISTRY_DIR);
  if (freshClone) {
    const parentDir = path.dirname(REGISTRY_DIR);
    fs.mkdirSync(parentDir, { recursive: true });
    try {
      await simpleGit().clone(remote, REGISTRY_DIR);
    } catch (e) {
      fs.rmSync(REGISTRY_DIR, { recursive: true, force: true });
      throw e;
    }
  } else {
    await simpleGit(REGISTRY_DIR).reset(['--hard']);
  }

  const repoGit = simpleGit(REGISTRY_DIR);
  try {
    const resolved = await resolveTargetRef(REGISTRY_DIR, { pin, channel });
    await repoGit.checkout(resolved.ref);
    if (resolved.kind !== 'tag') {
      await repoGit.pull('origin', resolved.ref);
    }
    return resolved;
  } catch (e) {
    if (freshClone) {
      fs.rmSync(REGISTRY_DIR, { recursive: true, force: true });
    }
    throw e;
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
