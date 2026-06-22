import os from 'os';
import path from 'path';
import {
  homeDir,
  awmHome,
  platform,
  isWindowsNative,
  platformLabel,
  warnIfUnsupportedPlatform,
  WINDOWS_NATIVE_WARNING,
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
    expect(platformLabel()).toContain('WSL');
  });

  it('warnIfUnsupportedPlatform calls the logger only on win32', () => {
    const calls: string[] = [];
    const log = (m: string) => calls.push(m);

    setPlatform('linux');
    warnIfUnsupportedPlatform(log);
    expect(calls).toHaveLength(0);

    setPlatform('win32');
    warnIfUnsupportedPlatform(log);
    expect(calls).toEqual([WINDOWS_NATIVE_WARNING]);
  });
});
