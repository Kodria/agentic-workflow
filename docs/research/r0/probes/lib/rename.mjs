import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';

const OBSERVER = `
const crypto = require('node:crypto');
const fs = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');

let running = true;
const observations = { reads: 0, oldPayload: 0, newPayload: 0, unexpected: 0, readErrors: 0 };

parentPort.on('message', (message) => {
  if (message === 'stop') running = false;
});

function observeBatch() {
  for (let i = 0; i < 4; i += 1) {
    try {
      const data = fs.readFileSync(workerData.destination);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      observations.reads += 1;
      if (hash === workerData.oldHash) observations.oldPayload += 1;
      else if (hash === workerData.newHash) observations.newPayload += 1;
      else observations.unexpected += 1;
    } catch {
      observations.readErrors += 1;
    }
  }

  if (running) setImmediate(observeBatch);
  else parentPort.postMessage({ type: 'done', observations });
}

parentPort.postMessage({ type: 'ready' });
setImmediate(observeBatch);
`;

function sha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export async function probeRenameReplace(ctx, options = {}) {
  if (!ctx || typeof ctx !== 'object'
    || typeof ctx.evidenceDir !== 'string' || ctx.evidenceDir === ''
    || typeof ctx.stamp !== 'string' || ctx.stamp === '') {
    throw new Error('probeRenameReplace requiere evidenceDir y stamp válidos');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('probeRenameReplace requiere options válido');
  }
  const observerSource = options.observerSource ?? OBSERVER;
  const watchdogMs = options.watchdogMs ?? 10_000;
  if (typeof observerSource !== 'string' || observerSource === ''
    || !Number.isFinite(watchdogMs) || watchdogMs <= 0) {
    throw new Error('probeRenameReplace requiere observerSource y watchdogMs válidos');
  }

  const src = path.join(ctx.evidenceDir, `.rename-src-${ctx.stamp}`);
  const dst = path.join(ctx.evidenceDir, `.rename-dst-${ctx.stamp}`);
  let observer;
  try {
    const oldPayload = crypto.randomBytes(1024 * 1024); // 1 MiB
    const newPayload = crypto.randomBytes(1024 * 1024);
    fs.writeFileSync(dst, oldPayload);

    observer = new Worker(observerSource, {
      eval: true,
      workerData: {
        destination: dst,
        oldHash: sha256(oldPayload),
        newHash: sha256(newPayload),
      },
    });

    const observations = await new Promise((resolve, reject) => {
      let ready = false;
      let settled = false;
      const watchdog = setTimeout(() => {
        fail(new Error(`lector concurrente excedió watchdog de ${watchdogMs}ms`));
      }, watchdogMs);

      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        reject(error);
      }

      function succeed(value) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(value);
      }

      observer.on('message', (message) => {
        if (settled) return;
        if (message?.type === 'ready' && !ready) {
          ready = true;
          try {
            const delay = new Int32Array(new SharedArrayBuffer(4));
            // Alternar suficientes veces y ceder reloj al worker evita certificar
            // atomicidad a partir de una sola lectura posterior al rename.
            for (let i = 0; i < 32; i += 1) {
              fs.writeFileSync(src, i % 2 === 0 ? newPayload : oldPayload);
              fs.renameSync(src, dst);
              Atomics.wait(delay, 0, 0, 2);
            }
            observer.postMessage('stop');
          } catch (e) {
            fail(e);
          }
        } else if (message?.type === 'done') {
          succeed(message.observations);
        }
      });
      observer.once('error', fail);
      observer.once('exit', (code) => {
        if (!settled) fail(new Error(`lector concurrente terminó antes de done (código ${code})`));
      });
    });

    const sawBoth = observations.oldPayload > 0 && observations.newPayload > 0;
    const clean = observations.unexpected === 0 && observations.readErrors === 0;
    const enoughReads = observations.reads >= 5;
    const state = clean && sawBoth && enoughReads
      ? 'soportado'
      : clean ? 'no-certificado' : 'degradado';
    return {
      state,
      detail: state === 'soportado'
        ? `${observations.reads} lecturas concurrentes observaron solo payloads completos viejo/nuevo`
        : `lector concurrente: ${JSON.stringify(observations)} — atomicidad no certificada`,
      artifacts: [],
      observations,
    };
  } catch (e) {
    return { state: 'no-certificado', detail: `sonda concurrente de rename falló: ${e.message}`, artifacts: [] };
  } finally {
    if (observer) await observer.terminate().catch(() => {});
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { force: true });
  }
}
