// cli/src/core/paths.ts
//
// Single source of truth for home / AWM_HOME resolution and platform detection.
// Functions are evaluated at CALL TIME (not require time) so env overrides are
// always honored and tests need no jest.resetModules().
import os from 'os';
import fs from 'fs';
import path from 'path';


/** User home directory with a robust fallback. Never returns a raw, possibly-empty process.env.HOME. */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

/** AWM home directory (~/.awm), honoring the AWM_HOME override. */
export function awmHome(): string {
  return process.env.AWM_HOME || path.join(homeDir(), '.awm');
}

/**
 * Raiz de configuracion de un agente, honrando SU propia variable de entorno.
 *
 * AWM honra `AWM_HOME` para si mismo (ver `awmHome` arriba) y durante mucho tiempo le
 * nego esa misma cortesia a todos los agentes que administra: cada ruta de proveedor se
 * armaba desde `homeDir()` y punto. En una maquina con `CODEX_HOME` apuntando a otro
 * lado, AWM escribia el hook en `~/.codex/hooks.json` y Codex lo leia desde
 * `$CODEX_HOME/hooks.json` — instalacion correcta, en el archivo que nadie mira. El hook
 * quedaba instalado y mudo, y `doctor` lo reportaba presente porque miraba el mismo
 * lugar equivocado donde lo habia escrito.
 *
 * `envVar` en `null` significa "este proveedor no declara override conocido": se usa el
 * default y listo. No se inventan variables — una que no exista de verdad seria peor que
 * ninguna, porque prometeria una configurabilidad que no funciona.
 */
export function providerConfigHome(envVar: string | null, defaultDir: string): string {
  const override = envVar ? process.env[envVar]?.trim() : undefined;
  return override || path.join(homeDir(), defaultDir);
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

/**
 * Resolve a binary on PATH, IN PROCESS — no shell, no subprocess.
 *
 * SECURITY (this is the whole reason for the implementation below): this used
 * to build `command -v ${bin}` / `where ${bin}` and hand it to `execSync`,
 * which runs it through a shell. `bin` is the first token of a sensor's `cmd`,
 * and that string comes from `.awm/sensors.json` — a file committed in the
 * repo, and also regenerated from a registry sensor-pack's `defaultCmd`. So a
 * cloned untrusted repo, or a third-party registry, could put shell syntax
 * there. The token can't contain whitespace (it's a split token), but `${IFS}`
 * and `$(...)` make that irrelevant. Confirmed against the real binary: a
 * crafted `cmd` executed an arbitrary command during `awm sensors status` —
 * a read-only inspection command — which then reported the sensor HEALTHY,
 * because the injected command exited 0.
 *
 * Resolving PATH ourselves removes the interpreter entirely, so there is
 * nothing left to inject into on any platform. It's also faster (no process
 * spawn) and more predictable than depending on `where`/`command -v` being
 * present and well-behaved.
 */
export function resolveOnPath(bin: string): boolean {
  if (typeof bin !== 'string' || bin.trim() === '') return false;

  // win32 resolves `eslint` to `eslint.cmd`/`eslint.exe` via PATHEXT. Missing
  // this broke every npm-shim-backed sensor on Windows (real bug, published in
  // v3.9.0). POSIX has no such concept — the name is the name.
  const extensions = isWindowsNative()
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];

  const isExecutable = (candidate: string): boolean => {
    try {
      if (!fs.statSync(candidate).isFile()) return false;
    } catch {
      return false;
    }
    // On win32 the executable bit doesn't exist; being a file with a PATHEXT
    // extension is the whole contract.
    if (isWindowsNative()) return true;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  // PATHEXT is conventionally uppercase (`.COM;.EXE;.BAT;.CMD`) while the files
  // on disk are usually lowercase (`eslint.cmd`). On real Windows that's a
  // non-issue because the filesystem is case-insensitive — but it IS an issue
  // on any case-sensitive volume, so try both spellings rather than depend on
  // filesystem behavior we don't control.
  const matches = (base: string): boolean =>
    isExecutable(base) ||
    extensions.some((ext) => isExecutable(base + ext) || isExecutable(base + ext.toLowerCase()));

  // A name carrying a separator is a path, not a PATH lookup — resolve it
  // directly instead of joining it onto every PATH entry.
  if (bin.includes('/') || (isWindowsNative() && bin.includes('\\'))) {
    return matches(path.resolve(bin));
  }

  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return entries.some((dir) => matches(path.join(dir, bin)));
}

/**
 * ¿Dos rutas nombran el MISMO directorio/archivo existente?
 *
 * Comparar `fs.realpathSync(a) !== fs.realpathSync(b)` como strings parece obvio y es
 * incorrecto en Windows: el mismo directorio tiene más de una grafía legítima —
 * `C:\Users\RUNNER~1\AppData\...` (nombre corto 8.3, lo que devuelve `os.tmpdir()`) y
 * `C:/Users/runneradmin/AppData/...` (lo que devuelve `git worktree list`, con separadores
 * POSIX) — y `realpathSync` NO reconcilia las dos. En CI eso hacía que
 * `ownedWorktreeExists` respondiera "este worktree no es mío" sobre un worktree propio.
 *
 * Falla cerrado, así que no corrompía nada — pero dejaba la adopción tras crash inservible
 * en Windows: el teardown no podía probar propiedad, los tracks quedaban `BLOCKED`, y la
 * cohorte no llegaba nunca ni a `SERIAL` ni a `ACTIVE`. Un solo bug de comparación, quince
 * tests en cascada.
 *
 * La identidad se toma primero de `realpathSync.native`, que resuelve la ruta con la API
 * del SO (incluyendo nombres cortos 8.3) antes de normalizar separadores y capitalización.
 * En POSIX, dos hard links de archivo conservan el mismo `(dev, ino)` aunque el realpath
 * mantenga sus nombres distintos; ese fallback preserva su identidad. En Windows no se usa:
 * dos directorios temporales distintos pueden reportar el mismo par de metadatos.
 *
 * Cualquier fallo de `stat` significa que al menos una no existe: `false`. La identidad
 * nunca se afirma sin prueba.
 */
export function sameExistingPath(a: string, b: string): boolean {
  let sa: fs.Stats;
  let sb: fs.Stats;
  try {
    sa = fs.statSync(a);
    sb = fs.statSync(b);
  } catch {
    return false;
  }
  const canonical = (p: string): string | null => {
    try {
      const real = fs.realpathSync.native(p).replaceAll('\\', '/');
      return isWindowsNative() ? real.toLowerCase() : real;
    } catch {
      return null;
    }
  };
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === null || cb === null) return false;
  if (ca === cb) return true;
  return !isWindowsNative() && sa.ino !== 0 && sb.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino;
}
