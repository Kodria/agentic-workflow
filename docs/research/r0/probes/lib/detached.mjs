import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Presupuesto del writer (7000ms) y espera antes de chequear (5000ms, ver
// abajo) fueron ampliados: overhead observado del spawn anidado (~1.6s) contra
// un margen previo demasiado ajustado (2500ms de espera / 4000ms de writer)
// podía dar falso-negativo "no-soportado" bajo carga. Duplicar ambos deja un
// margen de observación cómodo (~3s) sin volver la sonda lenta de correr.
const WRITER = `
const fs = require('fs');
const f = process.argv[2];
const end = Date.now() + 7000;
(function tick() {
  fs.appendFileSync(f, Date.now() + '\\n');
  if (Date.now() < end) setTimeout(tick, 200);
})();
`;

const MID = `
const { spawn } = require('child_process');
const fs = require('fs');
const [writerPath, hbFile, exitFile] = process.argv.slice(2);
const c = spawn(process.execPath, [writerPath, hbFile], { detached: true, stdio: 'ignore' });
c.on('error', () => {}); // spawn del writer falló: no debe crashear este proceso intermedio detached.
c.unref();
fs.writeFileSync(exitFile, String(Date.now()));
`;

export async function probeDetachedSurvival(ctx) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-detached-'));
  const writerPath = path.join(tmp, 'writer.cjs');
  const midPath = path.join(tmp, 'mid.cjs');
  const hbFile = path.join(ctx.evidenceDir, `detached-heartbeats-${ctx.stamp}.log`);
  const exitFile = path.join(tmp, 'mid-exit.txt');
  fs.writeFileSync(writerPath, WRITER);
  fs.writeFileSync(midPath, MID);

  const mid = spawn(process.execPath, [midPath, writerPath, hbFile, exitFile], { stdio: 'ignore' });
  let midSpawnError = null;
  await new Promise((res) => {
    mid.on('exit', res);
    mid.on('error', (err) => { midSpawnError = err; res(); });
  });
  if (midSpawnError) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { state: 'no-certificado', detail: `spawn del proceso intermedio falló: ${midSpawnError.message}`, artifacts: [] };
  }
  const midExit = Number(fs.readFileSync(exitFile, 'utf-8'));

  await new Promise((res) => setTimeout(res, 5000));
  fs.rmSync(tmp, { recursive: true, force: true });

  if (!fs.existsSync(hbFile)) {
    return { state: 'no-soportado', detail: 'el writer detached nunca escribió', artifacts: [] };
  }
  const beats = fs.readFileSync(hbFile, 'utf-8').trim().split('\n').map(Number);
  const after = beats.filter((t) => t > midExit + 300).length;
  return {
    state: after >= 3 ? 'soportado' : 'no-soportado',
    detail: `${after} heartbeats posteriores a la muerte del padre (umbral: 3)`,
    artifacts: [path.basename(hbFile)],
  };
}
