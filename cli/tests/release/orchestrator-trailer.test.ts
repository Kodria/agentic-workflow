// cli/tests/release/orchestrator-trailer.test.ts
//
// R6.1 (#217): the bump commit must be read as a Change Record opt-out by the code that reads it
// (`hasOptOut`), not just contain the right text in a mocked argv. The orchestrator runs against a
// real tmp git repo: `git add` and `git commit` execute for real with the argv the orchestrator
// passes (never retyped here); every other command is faked.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { release, ReleaseIO } from '../../src/release/orchestrator';
import { US, RS } from '../../src/release/core';
import { hasOptOut } from '../../src/core/changes/trailers';
import { makeRepo, TestRepo } from '../core/changes/helpers';

describe('release — the bump commit opts out of the Change Record (R6.1)', () => {
  let repo: TestRepo;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => repo.cleanup());

  it('the commit the orchestrator creates is read as an opt-out and keeps its subject byte-identical', () => {
    // Explicit environment for the child git: identity and config isolation never come from process.env alone.
    const gitEnv = {
      ...process.env, HOME: repo.home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    };
    repo.commit({
      'cli/package.json': '{"version":"2.1.1"}\n',
      'cli/package-lock.json': '{"version":"2.1.1"}\n',
      'CHANGELOG.md': '# Changelog\n',
    }, 'chore: seed release files');
    repo.git('config', 'commit.gpgsign', 'false');
    expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(false);

    let pkgVersion = '2.1.1';
    let changelog = '# Changelog\n';
    const write = (rel: string, content: string) => fs.writeFileSync(path.join(repo.root, rel), content);
    const commitArgv: string[][] = [];
    const io: ReleaseIO = {
      run(cmd, args) {
        if (cmd === 'git' && (args[0] === 'add' || args[0] === 'commit')) {
          if (args[0] === 'commit') commitArgv.push(args);
          return execFileSync('git', args, { cwd: repo.root, encoding: 'utf8', env: gitEnv });
        }
        if (cmd === 'git' && args[0] === 'rev-parse') return 'main';
        if (cmd === 'git' && args[0] === 'log') return `feat: nueva${US}${RS}`;
        return ''; // status, tag, npm view/publish: nothing there, nothing dirty
      },
      readPackageVersion: () => pkgVersion,
      writePackageVersion: (v) => { pkgVersion = v; write('cli/package.json', `{"version":"${v}"}\n`); },
      writeLockVersion: (v) => write('cli/package-lock.json', `{"version":"${v}"}\n`),
      readChangelog: () => changelog,
      writeChangelog: (c) => { changelog = c; write('CHANGELOG.md', c); },
      writeNpmrc: () => {},
      removeNpmrc: () => {},
      today: () => '2026-06-25',
      log: () => {},
      env: { NPM_TOKEN: 'tok' },
    };

    const res = release({ dryRun: false, force: null, push: false, branch: 'main', cliDir: '/cli' }, io);

    expect(res).toEqual({ released: true, version: '2.2.0' });
    expect(commitArgv).toHaveLength(1); // the argv under test was really executed, once
    expect(repo.git('log', '-1', '--format=%s')).toBe('chore(release): v2.2.0 [skip ci]');
    expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
    // The opt-out is a trailer paragraph of its own: the full message is subject, blank line, trailer.
    expect(repo.git('log', '-1', '--format=%B')).toBe('chore(release): v2.2.0 [skip ci]\n\nChange-Record: none');
  });
});
