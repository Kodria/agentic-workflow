// cli/tests/release/orchestrator.test.ts
import { release, ReleaseIO, ReleaseOpts } from '../../src/release/orchestrator';
import { GIT_LOG_FORMAT, US, RS } from '../../src/release/core';

function makeIO(over: Partial<ReleaseIO> & { commits?: string; tags?: string; npmView?: string } = {}): {
  io: ReleaseIO; calls: string[];
} {
  const calls: string[] = [];
  let pkgVersion = '2.1.1';
  const io: ReleaseIO = {
    run(cmd, args) {
      const full = `${cmd} ${args.join(' ')}`;
      calls.push(full);
      if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'main';
      if (cmd === 'git' && args[0] === 'status') return '';
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list' && args[2] === 'v*') return over.tags ?? '';
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return ''; // gate: tag puntual no existe
      if (cmd === 'git' && args[0] === 'log') return over.commits ?? `feat: nueva${US}${RS}`;
      if (cmd === 'npm' && args[0] === 'view') return over.npmView ?? '';
      return '';
    },
    readPackageVersion: () => pkgVersion,
    writePackageVersion: (v) => { pkgVersion = v; calls.push(`WRITE_PKG ${v}`); },
    readChangelog: () => '',
    writeChangelog: (c) => calls.push(`WRITE_CHANGELOG ${c.split('\n')[0]}`),
    writeNpmrc: () => calls.push('WRITE_NPMRC'),
    removeNpmrc: () => calls.push('REMOVE_NPMRC'),
    today: () => '2026-06-25',
    log: () => {},
    env: { NPM_TOKEN: 'tok' },
    ...over,
  };
  return { io, calls };
}

const opts = (o: Partial<ReleaseOpts> = {}): ReleaseOpts =>
  ({ dryRun: false, force: null, push: true, branch: 'main', cliDir: '/cli', ...o });

describe('release — happy path', () => {
  it('feat → minor: escribe versión, commitea, taggea, publica y pushea en orden', () => {
    const { io, calls } = makeIO({ commits: `feat: x${US}${RS}` });
    const res = release(opts(), io);
    expect(res).toEqual({ released: true, version: '2.2.0' });
    expect(calls).toContain('WRITE_PKG 2.2.0');
    const joined = calls.join('\n');
    expect(joined).toMatch(/git commit .*chore\(release\): v2.2.0/);
    expect(joined).toMatch(/git tag -a v2.2.0/);
    expect(joined).toMatch(/npm publish/);
    expect(joined).toMatch(/git push origin main/);
    expect(joined).toMatch(/git push origin v2.2.0/);
    // npmrc creado y SIEMPRE removido
    expect(calls).toContain('WRITE_NPMRC');
    expect(calls).toContain('REMOVE_NPMRC');
  });

  it('sin commits releasables → no publica (exit 0 lógico)', () => {
    const { io, calls } = makeIO({ commits: `docs: solo docs${US}${RS}` });
    const res = release(opts(), io);
    expect(res.released).toBe(false);
    expect(res.reason).toMatch(/nada que publicar|no releasable/i);
    expect(calls).not.toContain('WRITE_PKG 2.1.2');
    expect(calls.join('\n')).not.toMatch(/npm publish/);
  });

  it('--force patch publica aunque no haya commits releasables', () => {
    const { io } = makeIO({ commits: `docs: x${US}${RS}` });
    expect(release(opts({ force: 'patch' }), io)).toEqual({ released: true, version: '2.1.2' });
  });

  it('--dry-run calcula la versión pero NO escribe ni publica', () => {
    const { io, calls } = makeIO({ commits: `feat: x${US}${RS}` });
    const res = release(opts({ dryRun: true }), io);
    expect(res).toEqual({ released: false, version: '2.2.0', reason: 'dry-run' });
    expect(calls.join('\n')).not.toMatch(/npm publish|WRITE_PKG|git commit/);
  });

  it('--no-push omite los push', () => {
    const { io, calls } = makeIO({ commits: `feat: x${US}${RS}` });
    release(opts({ push: false }), io);
    expect(calls.join('\n')).not.toMatch(/git push/);
  });
});
