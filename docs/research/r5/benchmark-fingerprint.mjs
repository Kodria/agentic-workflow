#!/usr/bin/env node
// R10.2/R10.3: mide el costo real de `computeFingerprint` bajo carga
// concurrente simulada (N "supervisors" corriendo en paralelo, N=1..min(8,cpus))
// y deriva el tope de paralelismo por defecto de AWM a partir de la medición —
// nunca de un número escrito a mano. Corre standalone (ESM), fuera del proyecto
// TS de cli/: reusa el build de dist/ para no reimplementar ni el fingerprint
// ni la fórmula de derivación (misma fuente de verdad que en runtime).
//
// Uso: node docs/research/r5/benchmark-fingerprint.mjs
// Salida: docs/research/r5/fingerprint-budget.json
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CLI_DIR = path.join(REPO_ROOT, 'cli');
const FINGERPRINT_MODULE = path.join(CLI_DIR, 'dist', 'src', 'core', 'journal', 'fingerprint.js');
const CONCURRENCY_MODULE = path.join(CLI_DIR, 'dist', 'src', 'core', 'tracks', 'concurrency.js');
const OUTPUT_PATH = path.join(HERE, 'fingerprint-budget.json');

const TICK_MS = 5000;         // R10.3: mismo tickMs que DEFAULT_SUPERVISOR_CONFIG (supervisor.ts)
const REPS_PER_N = 30;
const WARMUP_DISCARD = 5;

function log(msg) {
    process.stdout.write(`[benchmark-fingerprint] ${msg}\n`);
}

// Paso 1: build local — la medición corre sobre el build real, no sobre TS.
log('ejecutando `npm run build` en cli/ ...');
execFileSync('npm', ['run', 'build'], { cwd: CLI_DIR, stdio: 'inherit' });

// Worker: cada uno hace una única medición de computeFingerprint y postea el
// tiempo de pared que le tomó (require() dentro del worker, no import — el
// build es CommonJS).
const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { computeFingerprint } = require(workerData.fingerprintModule);
const t0 = Date.now();
computeFingerprint(workerData.repoRoot, workerData.argv, workerData.pathGlobs, workerData.cwdRel);
parentPort.postMessage(Date.now() - t0);
`;
const workerFile = path.join(os.tmpdir(), `awm-fingerprint-bench-worker-${process.pid}.cjs`);
fs.writeFileSync(workerFile, WORKER_SOURCE);

function runOneSupervisor() {
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerFile, {
            workerData: {
                fingerprintModule: FINGERPRINT_MODULE,
                repoRoot: REPO_ROOT,
                argv: ['awm', 'watch'],
                pathGlobs: [],
                cwdRel: '.',
            },
        });
        worker.once('message', (elapsedMs) => { resolve(elapsedMs); void worker.terminate(); });
        worker.once('error', reject);
    });
}

/** Una repetición con N supervisores concurrentes: el costo que importa para
 *  R10.3 es el wall-clock de la ronda completa (contención real entre N ticks
 *  simultáneos), no el promedio individual. */
async function runRound(n) {
    const t0 = Date.now();
    await Promise.all(Array.from({ length: n }, () => runOneSupervisor()));
    return Date.now() - t0;
}

function percentile(sortedAsc, p) {
    const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
    return sortedAsc[idx];
}

async function measure(n) {
    const wallTimesMs = [];
    for (let i = 0; i < REPS_PER_N; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- reps deben correr secuencialmente para medir cada ronda de forma aislada
        wallTimesMs.push(await runRound(n));
    }
    const kept = wallTimesMs.slice(WARMUP_DISCARD).sort((a, b) => a - b);
    const p50Ms = percentile(kept, 0.5);
    const p95Ms = percentile(kept, 0.95);
    log(`N=${n}: ${REPS_PER_N} reps, descartadas ${WARMUP_DISCARD} de warm-up -> p50=${p50Ms}ms p95=${p95Ms}ms`);
    return { supervisors: n, p50Ms, p95Ms };
}

const cpuCount = os.cpus().length;
const maxN = Math.min(8, cpuCount);
log(`cpuCount=${cpuCount}, midiendo N=1..${maxN}, ${REPS_PER_N} reps por N`);

const samples = [];
for (let n = 1; n <= maxN; n += 1) {
    // eslint-disable-next-line no-await-in-loop -- N crece secuencialmente a propósito (aislar contención por nivel)
    samples.push(await measure(n));
}

fs.rmSync(workerFile, { force: true });

const { deriveDefaultParallelism } = await import(`file://${CONCURRENCY_MODULE}`);
const budget = {
    cpuCount,
    tickMs: TICK_MS,
    samples: samples.map(({ supervisors, p95Ms }) => ({ supervisors, p95Ms })),
};
const derivedDefault = deriveDefaultParallelism(budget);

const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

// Deliberadamente sin hostname/usuario/paths absolutos/env vars: este artefacto
// se versiona y se empaqueta en el npm package (ver cli/package.json `files`).
const result = {
    sourceHead,
    node: process.version,
    platform: process.platform,
    cpuCount,
    tickMs: TICK_MS,
    samples,
    derivedDefault,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
log(`escrito ${path.relative(REPO_ROOT, OUTPUT_PATH)} — derivedDefault=${derivedDefault}`);
