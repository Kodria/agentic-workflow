// cli/src/release/orchestrator.ts
import {
  Bump, PKG_NAME, GIT_LOG_FORMAT, determineBump, nextVersion,
  parseCommits, renderChangelog, selectFloor,
} from './core';

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface ReleaseIO {
  run(cmd: string, args: string[], opts?: { cwd?: string }): string;
  readPackageVersion(): string;
  writePackageVersion(v: string): void;
  readChangelog(): string;
  writeChangelog(content: string): void;
  writeNpmrc(token: string): void;
  removeNpmrc(): void;
  today(): string;
  log(msg: string): void;
  env: NodeJS.ProcessEnv;
}

export interface ReleaseOpts {
  dryRun: boolean;
  force: Bump | null;
  push: boolean;
  branch: string;
  cliDir: string;
}

export interface ReleaseResult {
  released: boolean;
  version?: string;
  reason?: string;
}

function highestTag(io: ReleaseIO): string | null {
  const raw = io.run('git', ['tag', '--list', 'v*']).trim();
  const tags = raw.split('\n').map((t) => t.trim()).filter((t) => TAG_RE.test(t));
  if (tags.length === 0) return null;
  tags.sort((a, b) => {
    const [, a1, a2, a3] = TAG_RE.exec(a)!.map(Number);
    const [, b1, b2, b3] = TAG_RE.exec(b)!.map(Number);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });
  return tags[tags.length - 1];
}

export function release(opts: ReleaseOpts, io: ReleaseIO): ReleaseResult {
  // baseline
  const current = io.readPackageVersion();
  const lastTag = highestTag(io);              // "vX.Y.Z" | null
  const lastTagVersion = lastTag ? lastTag.slice(1) : null;
  const floor = selectFloor(current, lastTagVersion);

  // rango de commits (solo cli/)
  const range = lastTag ? [`${lastTag}..HEAD`] : [];
  const logArgs = ['log', ...range, '--no-merges', `--format=${GIT_LOG_FORMAT}`, '--', 'cli/'];
  const commits = parseCommits(io.run('git', logArgs));

  // bump
  const bump = opts.force ?? determineBump(commits);
  if (!bump) return { released: false, reason: 'nada que publicar (no releasable commits)' };

  const version = nextVersion(floor, bump);

  // GATE idempotencia
  if (io.run('git', ['tag', '--list', `v${version}`]).trim()) {
    throw new Error(`El tag v${version} ya existe — abortando`);
  }
  let published = '';
  try { published = io.run('npm', ['view', `${PKG_NAME}@${version}`, 'version']).trim(); } catch { published = ''; }
  if (published) throw new Error(`${PKG_NAME}@${version} ya está publicado en npm — abortando`);

  if (opts.dryRun) {
    io.log(`[dry-run] publicaría v${version} (bump=${bump}, base=${floor})`);
    return { released: false, version, reason: 'dry-run' };
  }

  // aplicar
  io.writePackageVersion(version);
  const section = renderChangelog(version, io.today(), commits);
  io.writeChangelog(section + '\n' + io.readChangelog());
  io.run('git', ['add', 'cli/package.json', 'CHANGELOG.md']);
  io.run('git', ['commit', '-m', `chore(release): v${version} [skip ci]`]);
  io.run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`]);

  const token = io.env.NPM_TOKEN as string;
  try {
    io.writeNpmrc(token);
    io.run('npm', ['publish'], { cwd: opts.cliDir });
  } finally {
    io.removeNpmrc();
  }

  if (opts.push) {
    io.run('git', ['push', 'origin', opts.branch]);
    io.run('git', ['push', 'origin', `v${version}`]);
  }
  return { released: true, version };
}
