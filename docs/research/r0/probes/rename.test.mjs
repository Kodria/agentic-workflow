import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { probeRenameReplace } from './lib/rename.mjs';

test('rename probe certifies concurrent readers saw only complete old/new payloads', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-rename-test-'));
  try {
    const result = await probeRenameReplace({ evidenceDir, stamp: 'test' });

    assert.equal(result.state, 'soportado');
    assert.ok(result.observations.reads >= 5);
    assert.ok(result.observations.oldPayload > 0);
    assert.ok(result.observations.newPayload > 0);
    assert.equal(result.observations.unexpected, 0);
    assert.equal(result.observations.readErrors, 0);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('rename probe reports a replacement-loop filesystem error instead of crashing', () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-rename-error-test-'));
  const stamp = 'callback-error';
  fs.mkdirSync(path.join(evidenceDir, `.rename-src-${stamp}`));
  const moduleUrl = pathToFileURL(fileURLToPath(new URL('./lib/rename.mjs', import.meta.url))).href;
  const script = `
    const { probeRenameReplace } = await import(process.argv[1]);
    const result = await probeRenameReplace({ evidenceDir: process.argv[2], stamp: process.argv[3] });
    process.stdout.write(JSON.stringify(result));
  `;

  try {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script, moduleUrl, evidenceDir, stamp],
      { encoding: 'utf8', timeout: 5_000 },
    );

    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.state, 'no-certificado');
    assert.match(result.detail, /filesystem|rename|EISDIR|directorio/i);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('rename probe reports an observer exit before the done message', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-rename-exit-test-'));
  const observerSource = `process.exit(0);`;
  try {
    const result = await probeRenameReplace(
      { evidenceDir, stamp: 'early-exit' },
      { observerSource, watchdogMs: 500 },
    );

    assert.equal(result.state, 'no-certificado');
    assert.match(result.detail, /terminó antes|exit|done/i);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('rename probe watchdog reports an observer that never finishes', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-rename-watchdog-test-'));
  const observerSource = `
    const { parentPort } = require('node:worker_threads');
    parentPort.postMessage({ type: 'ready' });
    setInterval(() => {}, 1_000);
  `;
  try {
    const result = await probeRenameReplace(
      { evidenceDir, stamp: 'watchdog' },
      { observerSource, watchdogMs: 150 },
    );

    assert.equal(result.state, 'no-certificado');
    assert.match(result.detail, /watchdog|excedió/i);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});
