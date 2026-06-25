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
  // --- preflight gates (contrato, antes de cualquier early-exit) ---
  if (!opts.force) {
    const branch = io.run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (branch !== opts.branch) {
      throw new Error(`Rama actual "${branch}" != esperada "${opts.branch}" (usá --force para relajar)`);
    }
  }
  if (!opts.dryRun) {
    const dirty = io.run('git', ['status', '--porcelain']).trim();
    if (dirty) throw new Error('Working tree con cambios sin commitear — abortando');
    if (!io.env.NPM_TOKEN && !io.env.NODE_AUTH_TOKEN && !io.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
      throw new Error('Falta credencial de publicación: configurá NPM_TOKEN, NODE_AUTH_TOKEN, o usa OIDC (id-token: write en GitHub Actions)');
    }
  }

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

  // OIDC mode: GitHub inyecta ACTIONS_ID_TOKEN_REQUEST_URL con id-token:write
  //            o NODE_AUTH_TOKEN sin NPM_TOKEN (setup-node legacy con OIDC)
  // Legacy mode (NPM_TOKEN): write .npmrc temporal, cleanup en finally
  const useOidc = !io.env.NPM_TOKEN &&
    (!!io.env.ACTIONS_ID_TOKEN_REQUEST_URL || !!io.env.NODE_AUTH_TOKEN);
  let publishError: unknown;
  if (useOidc) {
    try {
      io.run('npm', ['publish', '--provenance'], { cwd: opts.cliDir });
    } catch (e) {
      publishError = e;
    }
  } else {
    const token = io.env.NPM_TOKEN as string;
    try {
      io.writeNpmrc(token);
      io.run('npm', ['publish'], { cwd: opts.cliDir });
    } catch (e) {
      publishError = e;
    } finally {
      io.removeNpmrc();
    }
  }

  if (publishError) {
    try { io.run('git', ['tag', '-d', `v${version}`]); } catch { /* best effort */ }
    try { io.run('git', ['reset', '--hard', 'HEAD~1']); } catch { /* best effort */ }
    throw publishError;
  }

  if (opts.push) {
    io.run('git', ['push', 'origin', opts.branch]);
    io.run('git', ['push', 'origin', `v${version}`]);
  }
  return { released: true, version };
}
