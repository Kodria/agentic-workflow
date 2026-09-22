const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { waitForPublication } = require('./wait-npm-publication.cjs');

const metadata = { version: '9.8.0', dist: { integrity: 'sha512-YWJjZA==', tarball: 'https://registry.npmjs.org/agentic-workflow-manager/-/agentic-workflow-manager-9.8.0.tgz' } };
function fixture(responses) {
  let time = 0;
  const calls = [];
  return {
    calls,
    options: {
      now: () => time, sleep: async ms => { time += ms; }, log: () => {},
      deadlineMs: 30, intervalMs: 10, requestTimeoutMs: 10,
      install: async () => ({ ok: true, detail: '' }),
      fetch: async (url, options) => {
        calls.push([url, options.method]);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        assert.ok(response, 'unexpected extra network attempt');
        return { ok: response.status === 200, status: response.status, json: async () => response.body };
      },
    },
  };
}
test('waits for both exact metadata and tarball, never republishes', async () => {
  const f = fixture([{ status: 404 }, { status: 200, body: metadata }, { status: 404 }, { status: 200, body: metadata }, { status: 200 }]);
  await waitForPublication('9.8.0', f.options);
  assert.deepEqual(f.calls.map(call => call[1]), ['GET', 'GET', 'HEAD', 'GET', 'HEAD']);
});
test('does not declare the artifact ready until an exact npm install succeeds', async () => {
  const f = fixture([
    { status: 200, body: metadata }, { status: 200 },
    { status: 200, body: metadata }, { status: 200 },
  ]);
  const installs = [];
  f.options.install = async (version, timeoutMs) => {
    installs.push([version, timeoutMs]);
    return installs.length === 1
      ? { ok: false, detail: 'npm ERR! 404 tarball not found' }
      : { ok: true, detail: '' };
  };

  await waitForPublication('9.8.0', f.options);

  assert.deepEqual(installs, [['9.8.0', 30], ['9.8.0', 20]]);
  assert.equal(f.calls.length, 4);
});
test('visibility retries end at a fixed deadline with the real diagnostic', async () => {
  const f = fixture([{ status: 404 }, { status: 404 }, { status: 404 }]);
  await assert.rejects(waitForPublication('9.8.0', f.options), /timed out.*HTTP 404/);
  assert.equal(f.calls.length, 3);
});
test('accepts the ten-minute publication window without widening request timeouts', async () => {
  const f = fixture([{ status: 200, body: metadata }, { status: 200 }]);
  f.options.deadlineMs = 600_000;
  await waitForPublication('9.8.0', f.options);

  const invalid = fixture([]);
  invalid.options.requestTimeoutMs = 300_001;
  await assert.rejects(waitForPublication('9.8.0', invalid.options), /timing/);
  assert.equal(invalid.calls.length, 0);
});
test('authentication failure is not concealed by retries', async () => {
  const f = fixture([{ status: 403 }]);
  await assert.rejects(waitForPublication('9.8.0', f.options), /HTTP 403/);
  assert.equal(f.calls.length, 1);
});
test('rejects mutable versions, wrong metadata and a foreign tarball', async () => {
  for (const version of ['latest', '9.8.0;echo bad', undefined]) {
    const f = fixture([]);
    await assert.rejects(waitForPublication(version, f.options), /exact version/);
    assert.equal(f.calls.length, 0);
  }
  for (const body of [{ ...metadata, version: '9.7.1' }, { ...metadata, dist: { ...metadata.dist, tarball: 'https://example.invalid/package.tgz' } }]) {
    const f = fixture([{ status: 200, body }]);
    await assert.rejects(waitForPublication('9.8.0', f.options), /metadata/);
    assert.equal(f.calls.length, 1);
  }
});
test('release checks visibility before acceptance without rerunning or weakening publication', () => {
  const workflow = readFileSync(path.join(__dirname, '..', 'workflows', 'release.yml'), 'utf8');
  const consumer = workflow.slice(workflow.indexOf('  published-doctor-evidence:'));
  assert.ok(consumer.indexOf('Wait for exact npm artifact installability') >= 0);
  assert.ok(consumer.indexOf('Wait for exact npm artifact installability') < consumer.indexOf('Accept published dashboard'));
  assert.match(consumer, /node \.github\/scripts\/wait-npm-publication\.cjs/);
  assert.match(workflow, /release:\s*\n\s*needs: test/);
  assert.match(workflow, /cancel-in-progress: false/);
});
