import fs from 'fs';
import path from 'path';
import os from 'os';

describe('hooks/install — skill symlink fallback to copy', () => {
  let tmpHome: string;
  let origHome: string | undefined;
  let origAwmHome: string | undefined;
  let symlinkSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-symlink-fb-'));
    origHome = process.env.HOME;
    origAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
    jest.resetModules();
  });

  afterEach(() => {
    symlinkSpy?.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = origAwmHome;
  });

  function seedRegistry(root: string) {
    const hooksDir = path.join(root, 'hooks');
    const skillDir = path.join(root, 'skills', 'using-awm');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'session-start'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(hooksDir, 'run-hook.cmd'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# using-awm\n');
  }

  it('copies the skill when symlink throws (EPERM), preserving content', () => {
    const registryRoot = path.join(tmpHome, 'registry');
    seedRegistry(registryRoot);

    // Force symlinkSync to fail like a platform without symlink permission.
    symlinkSpy = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      const err: any = new Error('EPERM: operation not permitted, symlink');
      err.code = 'EPERM';
      throw err;
    });

    const { installHook } = require('../../../src/commands/hooks/install');
    const result = installHook({ agent: 'claude-code', registryRoot, installMethod: 'copy' });

    const skillDest = path.join(result.scriptsDir, 'using-awm.md');
    expect(fs.existsSync(skillDest)).toBe(true);
    expect(fs.lstatSync(skillDest).isSymbolicLink()).toBe(false); // it was copied, not linked
    expect(fs.readFileSync(skillDest, 'utf-8')).toContain('using-awm');
  });
});
