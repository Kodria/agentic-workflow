// cli/src/core/paths.ts
//
// Single source of truth for home / AWM_HOME resolution and platform detection.
// Functions are evaluated at CALL TIME (not require time) so env overrides are
// always honored and tests need no jest.resetModules().
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

/** User home directory with a robust fallback. Never returns a raw, possibly-empty process.env.HOME. */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/** AWM home directory (~/.awm), honoring the AWM_HOME override. */
export function awmHome(): string {
  return process.env.AWM_HOME || path.join(homeDir(), '.awm');
}

/** Raw platform string (wrapper over process.platform for testability). */
export function platform(): NodeJS.Platform {
  return process.platform;
}

/** True only on native Windows. WSL reports 'linux', so this returns false there. */
export function isWindowsNative(): boolean {
  return platform() === 'win32';
}

/** Human-friendly platform label for diagnostics. Windows is a first-class,
 *  CI-verified platform since R6 (`.github/workflows/ci.yml` runs the full
 *  suite on `ubuntu-latest` + `windows-latest` on every PR) — this no longer
 *  hedges toward WSL. */
export function platformLabel(): string {
  switch (platform()) {
    case 'win32':
      return 'Windows (native, CI-verified)';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform();
  }
}

/**
 * The one honest, narrow gap left on native Windows: `awm watch`'s supervisor
 * crash-recovery E2E tests (spawn -> identity capture -> adoption after the
 * supervisor is killed) never converged on real `windows-latest` CI despite 4
 * evidence-based fix attempts in R6 (WMI-based `refIsAlive`, `activitySnapshot`
 * degraded off `ps`/`pgrep`, `spawnStructured`'s `detached` flag tried both
 * ways) — scoped POSIX-only (`itPosix`) in `cli/tests/commands/watch/
 * supervisor-loop.test.ts` (2 tests) and `cli/tests/commands/watch/
 * e2e-crash.test.ts` (2 tests); see the `refIsAlive` comment in
 * `cli/src/core/journal/process.ts` for the full investigation. This is
 * deliberately narrow, not a blanket "some things may not work" hedge:
 * `awm init`/`update`/`sync`/`sensors`/`preflight`/`doctor`/hooks are all
 * exercised green by the same CI matrix and are unaffected by this gap.
 */
export const WINDOWS_KNOWN_GAP =
  'AWM on native Windows: supported and continuously verified in CI (ubuntu-latest + windows-latest, every PR).\n' +
  '  One known, narrow gap: `awm watch`\'s supervisor crash-recovery (spawn -> identity capture -> adoption\n' +
  '  after the supervisor is killed) has not yet converged on real windows-latest CI — see\n' +
  '  cli/src/core/journal/process.ts (refIsAlive) for detail. Everything else is CI-verified on Windows.';

/** Emit `WINDOWS_KNOWN_GAP` via the provided logger, only on native Windows. */
export function noteWindowsCaveat(log: (msg: string) => void): void {
  if (isWindowsNative()) log(WINDOWS_KNOWN_GAP);
}

/** Resolve a binary on PATH portably: `where` on win32, POSIX `command -v` elsewhere. */
export function resolveOnPath(bin: string): boolean {
  const cmd = isWindowsNative() ? `where ${bin}` : `command -v ${bin}`;
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
