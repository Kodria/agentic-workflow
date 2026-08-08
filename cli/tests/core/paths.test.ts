import os from 'os';
import path from 'path';
import {
  homeDir,
  awmHome,
  platform,
  isWindowsNative,
  platformLabel,
  noteWindowsCaveat,
  WINDOWS_KNOWN_GAP,
  resolveOnPath,
} from '../../src/core/paths';


describe('core/paths', () => {
  let origHome: string | undefined;
  let origAwmHome: string | undefined;
  const realPlatform = process.platform;

  beforeEach(() => {
    origHome = process.env.HOME;
    origAwmHome = process.env.AWM_HOME;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = origAwmHome;
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  it('homeDir uses process.env.HOME when set', () => {
    process.env.HOME = '/tmp/fake-home';
    expect(homeDir()).toBe('/tmp/fake-home');
  });

  it('homeDir falls back to os.homedir() when HOME is unset', () => {
    delete process.env.HOME;
    expect(homeDir()).toBe(os.homedir());
  });

  it('awmHome honors AWM_HOME override', () => {
    process.env.AWM_HOME = '/tmp/custom-awm';
    expect(awmHome()).toBe('/tmp/custom-awm');
  });

  it('awmHome defaults to <home>/.awm when AWM_HOME is unset', () => {
    delete process.env.AWM_HOME;
    process.env.HOME = '/tmp/fake-home';
    expect(awmHome()).toBe(path.join('/tmp/fake-home', '.awm'));
  });

  it('platform reflects process.platform', () => {
    setPlatform('linux');
    expect(platform()).toBe('linux');
  });

  it('isWindowsNative is true only on win32', () => {
    setPlatform('win32');
    expect(isWindowsNative()).toBe(true);
    setPlatform('linux');
    expect(isWindowsNative()).toBe(false);
    setPlatform('darwin');
    expect(isWindowsNative()).toBe(false);
  });

  it('platformLabel describes each known platform', () => {
    setPlatform('linux');
    expect(platformLabel()).toBe('Linux');
    setPlatform('darwin');
    expect(platformLabel()).toBe('macOS');
    setPlatform('win32');
    // Windows is a first-class, CI-verified platform since R6 — the label no
    // longer hedges toward WSL, and must not silently regress back to it.
    expect(platformLabel()).toBe('Windows (native, CI-verified)');
    expect(platformLabel()).not.toContain('WSL');
  });

  it('noteWindowsCaveat calls the logger only on win32, with the narrow watch-supervisor gap', () => {
    const calls: string[] = [];
    const log = (m: string) => calls.push(m);

    setPlatform('linux');
    noteWindowsCaveat(log);
    expect(calls).toHaveLength(0);

    setPlatform('win32');
    noteWindowsCaveat(log);
    expect(calls).toEqual([WINDOWS_KNOWN_GAP]);
    // The message must assert Windows support, not disclaim it, and must name
    // the one specific gap rather than a blanket "some things may not work"
    // hedge — pinning both halves so neither regresses independently.
    expect(WINDOWS_KNOWN_GAP).toMatch(/supported and continuously verified/i);
    expect(WINDOWS_KNOWN_GAP).toMatch(/awm watch/i);
    expect(WINDOWS_KNOWN_GAP).not.toMatch(/WSL/i);
    expect(WINDOWS_KNOWN_GAP).not.toMatch(/not supported/i);
  });

  it('noteWindowsCaveat propagates a throwing logger instead of swallowing it', () => {
    // `noteWindowsCaveat` has no try/catch around the logger call — callers
    // (init.ts/update.ts/sync.ts/doctor.ts) all pass simple `console.log`
    // wrappers that are not expected to throw, and every caller controls its
    // own logger, so there is no shared reason for this helper to be
    // defensive on their behalf. Pin that behavior explicitly: a throwing
    // logger's error propagates out of `noteWindowsCaveat`, it is not
    // swallowed.
    setPlatform('win32');
    const boom = new Error('logger exploded');
    const throwingLog = () => { throw boom; };
    expect(() => noteWindowsCaveat(throwingLog)).toThrow(boom);

    // And on non-Windows the logger is never even invoked, so a throwing
    // logger is harmless there.
    setPlatform('linux');
    expect(() => noteWindowsCaveat(throwingLog)).not.toThrow();
  });

  // `resolveOnPath` ya no invoca un shell (ni ningun subproceso): resuelve PATH
  // en proceso. Los tests que vivian aca mockeaban `execSync` y verificaban las
  // strings `command -v X` / `where X`, o sea la implementacion removida — y dos
  // de ellos ademas pasaban por accidente en cualquier maquina que tuviera el
  // binario del fixture instalado de verdad. Su reemplazo, con PATH controlado y
  // el exploit de inyeccion como ancla, esta en
  // tests/core/path-resolution-no-shell.test.ts.
});
