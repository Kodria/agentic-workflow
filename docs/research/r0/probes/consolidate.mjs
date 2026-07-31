#!/usr/bin/env node
// evidence/*.json → capability-matrix.md (design doc R5).
// La matriz SIEMPRE se regenera desde evidencia; nunca se edita a mano.
// Uso: node consolidate.mjs [--evidence-dir <dir>] [--out <archivo>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES = ['soportado', 'no-soportado', 'degradado', 'no-verificable-aquí', 'no-certificado'];

// Qué campo de qué clase de evidencia alimenta cada capability de la matriz.
const CELLS = [
  ['detached-survival', 'mech', (j) => j.probes?.detachedSurvival],
  ['rename-replace', 'mech', (j) => j.probes?.renameReplace],
  ['subagent-dispatch', 'agent', (j) => j.exercises?.p1Dispatch],
  ['subagent-parallel', 'agent', (j) => j.exercises?.p1Parallel],
  ['model-override', 'agent', (j) => j.exercises?.p2ModelOverride],
  ['turn-end-live-process', 'agent', (j) => j.exercises?.p3TurnEnd],
  ['worktree-isolation', 'agent', (j) => j.exercises?.p4Worktree],
  ['session-recovery', 'agent', (j) => j.exercises?.p5Recovery],
  ['wait-polling', 'agent', (j) => j.exercises?.p6WaitPolling],
];

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`${flag} requiere un valor`);
  return v;
}

const argv = process.argv.slice(2);
const evidenceDirArg = argValue(argv, '--evidence-dir');
const dir = evidenceDirArg
  ? path.resolve(evidenceDirArg)
  : fileURLToPath(new URL('../evidence/', import.meta.url));
const outArg = argValue(argv, '--out');
const out = outArg
  ? path.resolve(outArg)
  : fileURLToPath(new URL('../capability-matrix.md', import.meta.url));

if (!fs.existsSync(dir)) {
  process.stderr.write(`No existe el directorio de evidencia: ${dir}\n`);
  process.exit(1);
}

const runs = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort() // determinism (Issue 2): filesystem order is not guaranteed
  .flatMap((f) => {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    } catch (e) {
      process.stderr.write(`consolidate: omitiendo ${f}, JSON inválido: ${e.message}\n`);
      return [];
    }
    // JSON.parse solo garantiza sintaxis válida — null/number/string/array son
    // JSON válido pero no tienen shape de evidencia (CONSTITUTION: validar shape,
    // no solo sintaxis).
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const shape = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
      process.stderr.write(`consolidate: omitiendo ${f}, JSON no es un objeto de evidencia (${shape})\n`);
      return [];
    }
    if (parsed.schema !== 1 || !['mech', 'agent'].includes(parsed.kind)) {
      return [];
    }
    if (typeof parsed.provider !== 'string' || parsed.provider.trim() === ''
      || typeof parsed.environment !== 'string' || parsed.environment.trim() === '') {
      process.stderr.write(`consolidate: omitiendo ${f}, falta provider/environment válido\n`);
      return [];
    }
    return [{ file: f, json: parsed }];
  });

// (capability, provider, environment) → [{state, file, detail}]
const grouped = new Map();
for (const { file, json } of runs) {
  for (const [cap, kind, pick] of CELLS) {
    if (json.kind !== kind) continue;
    const cell = pick(json);
    if (!cell || !cell.state) continue;
    const state = STATES.includes(cell.state) ? cell.state : 'no-certificado';
    const key = `${cap}|${json.provider}|${json.environment}`;
    const arr = grouped.get(key) ?? [];
    arr.push({ state, file, detail: cell.detail ?? '' });
    grouped.set(key, arr);
  }
}

const cols = [...new Set(runs.map((r) => `${r.json.provider}@${r.json.environment}`))].sort();
const lines = [
  '<!-- GENERADO por probes/consolidate.mjs — NO editar a mano (design doc R5) -->',
  '',
  '# Matriz de capacidades — R0',
  '',
  `Regenerada: corrida de consolidación sobre ${runs.length} archivo(s) de evidencia.`,
  '',
  `| Capability | ${cols.join(' | ')} |`,
  `|---|${cols.map(() => '---').join('|')}|`,
];
for (const [cap] of CELLS) {
  const row = [cap];
  for (const col of cols) {
    const [provider, environment] = col.split('@');
    const entries = grouped.get(`${cap}|${provider}|${environment}`) ?? [];
    if (entries.length === 0) { row.push('—'); continue; }
    const states = [...new Set(entries.map((e) => e.state))];
    if (states.length > 1) {
      // R5.2: el conflicto se muestra, jamás gana en silencio la más reciente.
      row.push(`⚠ CONFLICTO: ${entries.map((e) => `${e.state} (${e.file})`).join(' vs ')}`);
    } else {
      row.push(`${states[0]} ([${entries[0].file}](evidence/${entries[0].file}))`);
    }
  }
  lines.push(`| ${row.join(' | ')} |`);
}
lines.push('', '## CLIs inspeccionados por máquina', '');
for (const { file, json } of runs.filter((r) => r.json.kind === 'mech')) {
  const ci = json.probes?.cliInspection;
  if (!ci) continue;
  for (const bin of ['claude', 'codex', 'opencode']) {
    const hints = (ci[bin]?.modelFlagHints ?? []).join(' · ') || '—';
    lines.push(`- \`${bin}\` @ ${json.provider}@${json.environment}: ${ci[bin]?.state} · flags de modelo: ${hints} · ([${file}](evidence/${file}))`);
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n');
process.stdout.write(`${out}\n`);
