const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
  const preferredParent = path.join(os.homedir(), '.cache');
  let testTmp;
  try {
    fs.mkdirSync(preferredParent, { recursive: true });
    testTmp = fs.mkdtempSync(path.join(preferredParent, 'awm-jest-'));
  } catch {
    // Sandboxes and read-only home mounts cannot host per-suite fixtures. The
    // system temporary directory remains isolated by the mkdtemp call below.
    const fallbackParent = path.join(os.tmpdir(), 'awm-cache');
    fs.mkdirSync(fallbackParent, { recursive: true });
    testTmp = fs.mkdtempSync(path.join(fallbackParent, 'awm-jest-'));
  }

  process.env.AWM_JEST_TMPDIR = testTmp;
  process.env.TMPDIR = testTmp;
  process.env.TMP = testTmp;
  process.env.TEMP = testTmp;
  delete process.env.CODEX_HOME;
};
