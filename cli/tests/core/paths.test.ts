import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
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

jest.mock('child_process', () => ({ execSync: jest.fn() }));
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('core/paths', () => {
  let origHome: string | undefined;
  let origAwmHome: string | undefined;
  const realPlatform = process.platform;

  beforeEach(() => {
    origHome = process.env.HOME;
    origAwmHome = process.env.AWM_HOME;
    mockExecSync.mockReset();
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

  describe('resolveOnPath', () => {
    it('uses `command -v` on POSIX and returns true when the binary resolves', () => {
      setPlatform('linux');
      mockExecSync.mockImplementation(((cmd: string) => {
        if (cmd === 'command -v semgrep') return Buffer.from('/usr/bin/semgrep');
        throw new Error(`not found: ${cmd}`);
      }) as typeof execSync);

      expect(resolveOnPath('semgrep')).toBe(true);
    });

    it('returns false on POSIX when `command -v` fails to resolve the binary', () => {
      setPlatform('linux');
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      expect(resolveOnPath('semgrep')).toBe(false);
    });

    it('uses `where` on win32, not `command -v`', () => {
      setPlatform('win32');
      mockExecSync.mockImplementation(((cmd: string) => {
        if (cmd === 'where semgrep') return Buffer.from('C:\\tools\\semgrep.exe');
        throw new Error(`not found: ${cmd}`);
      }) as typeof execSync);

      expect(resolveOnPath('semgrep')).toBe(true);
    });

    it('returns false on win32 when `where` cannot find the binary', () => {
      setPlatform('win32');
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      expect(resolveOnPath('semgrep')).toBe(false);
    });
  });
});
