// cli/src/release/index.ts
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Bump } from './core';
import { release, ReleaseIO, ReleaseOpts } from './orchestrator';

export function parseArgs(argv: string[]): ReleaseOpts {
  const opts: ReleaseOpts = { dryRun: false, force: null, push: true, branch: 'main', cliDir: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-push') opts.push = false;
    else if (a === '--branch') {
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) {
        throw new Error('--branch requiere un valor (ej: --branch main)');
      }
      opts.branch = val;
    }
    else if (a === '--force') {
      const lvl = argv[++i];
      if (lvl !== 'major' && lvl !== 'minor' && lvl !== 'patch') {
        throw new Error(`--force requiere major|minor|patch, recibió "${lvl}"`);
      }
      opts.force = lvl as Bump;
    } else {
      throw new Error(`Flag desconocida: ${a}`);
    }
  }
  return opts;
}

function realIO(repoRoot: string, cliDir: string): ReleaseIO {
  const pkgPath = path.join(cliDir, 'package.json');
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  const npmrcPath = path.join(cliDir, '.npmrc');
  return {
    run(cmd, args, o) {
      return execFileSync(cmd, args, { cwd: o?.cwd ?? repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    },
    readPackageVersion: () => JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version,
    writePackageVersion: (v) => {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.version = v;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    },
    readChangelog: () => (fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : ''),
    writeChangelog: (c) => fs.writeFileSync(changelogPath, c),
    writeNpmrc: (token) => fs.writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\n`),
    removeNpmrc: () => { if (fs.existsSync(npmrcPath)) fs.rmSync(npmrcPath); },
    today: () => new Date().toISOString().slice(0, 10),
    log: (m) => console.log(m),
    env: process.env,
  };
}

export function main(argv: string[]): number {
  let opts: ReleaseOpts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  // __dirname en dist/src/release/ → 4 niveles arriba = repoRoot
  // dist/src/release → dist/src → dist → cli → repoRoot
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const cliDir = path.resolve(repoRoot, 'cli');
  opts.cliDir = cliDir;
  try {
    const res = release(opts, realIO(repoRoot, cliDir));
    if (res.released) console.log(`✓ Publicado v${res.version}`);
    else console.log(`· Sin release: ${res.reason}${res.version ? ` (v${res.version})` : ''}`);
    return 0;
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
