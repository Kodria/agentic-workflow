const { setTimeout: sleep } = require('node:timers/promises');

// Publishing succeeds before every public npm edge can serve the new artifact.
// Wait read-only, with a hard deadline; never retry the publication itself.
async function waitForPublication(version, options = {}) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('npm visibility requires an exact version');
  const { fetch = globalThis.fetch, sleep: pause = sleep, now = Date.now, log = console.log,
    deadlineMs = 300_000, intervalMs = 10_000, requestTimeoutMs = 10_000 } = options;
  for (const value of [deadlineMs, intervalMs, requestTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 300_000) throw new Error('visibility timing must be a positive bounded integer');
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
      if (archive?.ok) { log(`npm artifact ${version} is visible with integrity ${metadata.dist.integrity}`); return metadata; }
      transient(archive);
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
