#!/usr/bin/env node
// Entrypoint de las sondas mecánicas de R0 (design doc R2).
// Uso: node run.mjs --provider <p> --env <etiqueta> [--evidence-dir <dir>]
// Un JSON estampado por corrida; corridas repetidas acumulan (R2.2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { fingerprint } from './lib/fingerprint.mjs';
import { probeDetachedSurvival } from './lib/detached.mjs';
import { probeRenameReplace } from './lib/rename.mjs';
import { probeCliInspection } from './lib/cli-inspect.mjs';

// CONSTITUTION: todo arg CLI que espera valor valida que el siguiente token
// exista y no empiece con `--` — fallar fuerte, nunca silenciar.
function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`${flag} requiere un valor`);
  }
  return v;
}

function main() {
  const argv = process.argv.slice(2);
  let provider, envLabel, evidenceDir;
  try {
    provider = argValue(argv, '--provider');
    envLabel = argValue(argv, '--env');
    evidenceDir = argValue(argv, '--evidence-dir');
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
  if (!provider || !envLabel) {
    process.stderr.write(
      'Uso: node run.mjs --provider <claude-code|codex|opencode> --env <etiqueta> [--evidence-dir <dir>]\n',
    );
    process.exit(1);
  }
  const dir = evidenceDir
    ? path.resolve(evidenceDir)
    : fileURLToPath(new URL('../evidence/', import.meta.url));
  fs.mkdirSync(dir, { recursive: true });

  // Segundo-nivel de fecha para legibilidad humana + sufijo aleatorio para
  // unicidad real: dos corridas en el mismo segundo (o el mismo ms) no pueden
  // pisarse (R2.2 — "nunca sobrescribirse" es absoluto, no "normalmente").
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    + '-' + crypto.randomBytes(3).toString('hex');
  const ctx = { evidenceDir: dir, stamp };

  Promise.resolve()
    .then(async () => ({
      schema: 1,
      kind: 'mech',
      provider,
      environment: envLabel,
      ...fingerprint(),
      probes: {
        detachedSurvival: await probeDetachedSurvival(ctx),
        renameReplace: probeRenameReplace(ctx),
        cliInspection: probeCliInspection(ctx),
      },
    }))
    .then((result) => {
      // R2.2: nombre estampado — corridas repetidas acumulan, jamás sobrescriben.
      const out = path.join(dir, `mech-${provider}-${envLabel}-${stamp}.json`);
      fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
      process.stdout.write(`${out}\n`);
    })
    .catch((e) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    });
}

main();
