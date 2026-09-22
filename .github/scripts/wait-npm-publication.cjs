const { setTimeout: sleep } = require('node:timers/promises');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function installExact(version, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('npm install timeout must be a positive bounded integer');
  const root = mkdtempSync(join(tmpdir(), 'awm-publication-install-'));
  try {
    const result = spawnSync('npm', [
      'install', '--prefix', join(root, 'consumer'), '--cache', join(root, 'cache'),
      '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online',
      '--registry=https://registry.npmjs.org/', `agentic-workflow-manager@${version}`,
    ], { encoding: 'utf8', shell: process.platform === 'win32', timeout: timeoutMs });
    const detail = [result.error?.message, result.stderr, result.stdout]
      .filter(Boolean).join('\n').trim().slice(-1_000);
    return { ok: result.status === 0, detail };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

// Publishing succeeds before every public npm edge can serve the new artifact.
// Wait read-only, with a hard deadline; never retry the publication itself.
async function waitForPublication(version, options = {}) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('npm visibility requires an exact version');
  const { fetch = globalThis.fetch, sleep: pause = sleep, now = Date.now, log = console.log,
    install = installExact, deadlineMs = 600_000, intervalMs = 10_000, requestTimeoutMs = 10_000 } = options;
  if (typeof fetch !== 'function' || typeof pause !== 'function' || typeof now !== 'function' ||
    typeof log !== 'function' || typeof install !== 'function') throw new Error('npm visibility dependencies must be functions');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 900_000 ||
    !Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > 300_000 ||
    !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 300_000) {
    throw new Error('visibility timing must be a positive bounded integer');
  }
  const endpoint = `https://registry.npmjs.org/agentic-workflow-manager/${version}`;
  const tarball = `https://registry.npmjs.org/agentic-workflow-manager/-/agentic-workflow-manager-${version}.tgz`;
  const deadline = now() + deadlineMs;
  let last = 'no response';
  async function request(url, method) {
    try {
      return await fetch(url, { method, cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - now()))) });
    } catch (error) { last = `network: ${String(error.message).slice(0, 300)}`; return null; }
  }
  function transient(response) {
    if (!response) return true;
    last = `HTTP ${response.status}`;
    if (response.status === 404 || response.status === 429 || response.status >= 500) return true;
    throw new Error(`npm visibility failed: ${last}`);
  }
  while (now() < deadline) {
    const response = await request(endpoint, 'GET');
    if (response?.ok) {
      const metadata = await response.json();
      if (metadata?.version !== version || metadata?.dist?.tarball !== tarball ||
        typeof metadata?.dist?.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist.integrity)) {
        throw new Error('npm visibility metadata does not identify the exact immutable artifact');
      }
      const archive = now() < deadline ? await request(tarball, 'HEAD') : null;
      if (archive?.ok) {
        const installed = await install(version, Math.max(1, Math.min(60_000, deadline - now())));
        if (installed?.ok === true) {
          log(`npm artifact ${version} is installable with integrity ${metadata.dist.integrity}`);
          return metadata;
        }
        last = `npm install: ${String(installed?.detail || 'exit non-zero').slice(-1_000)}`;
      } else transient(archive);
    } else transient(response);
    log(`npm artifact ${version} not yet visible (${last}); bounded read-only retry`);
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(intervalMs, remaining));
  }
  throw new Error(`npm visibility timed out after ${deadlineMs}ms: ${last}`);
}

module.exports = { waitForPublication };
if (require.main === module) {
  waitForPublication(process.env.AWM_PUBLISHED_CLI_VERSION).catch(error => { console.error(error.message); process.exitCode = 1; });
}
