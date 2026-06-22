// cli/src/core/paths.ts
//
// Single source of truth for home / AWM_HOME resolution and platform detection.
// Functions are evaluated at CALL TIME (not require time) so env overrides are
// always honored and tests need no jest.resetModules().
import os from 'os';
import path from 'path';

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

/** Human-friendly platform label for diagnostics. */
export function platformLabel(): string {
  switch (platform()) {
    case 'win32':
      return 'Windows (native — not supported yet, use WSL)';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return platform();
  }
}

export const WINDOWS_NATIVE_WARNING =
  'AWM detected native Windows. Native support is deferred; the recommended path today is WSL.\n' +
  '  Install WSL (https://learn.microsoft.com/windows/wsl/install) and run AWM inside your Linux distro.\n' +
  '  Continuing in best-effort mode, but some steps (symlinks, hooks) may not work.';

/** Emit the unsupported-platform warning via the provided logger, only on native Windows. */
export function warnIfUnsupportedPlatform(log: (msg: string) => void): void {
  if (isWindowsNative()) log(WINDOWS_NATIVE_WARNING);
}
