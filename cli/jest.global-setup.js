const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
  const parent = path.join(os.homedir(), '.cache');
  fs.mkdirSync(parent, { recursive: true });
  const testTmp = fs.mkdtempSync(path.join(parent, 'awm-jest-'));

  process.env.AWM_JEST_TMPDIR = testTmp;
  process.env.TMPDIR = testTmp;
  process.env.TMP = testTmp;
  process.env.TEMP = testTmp;
  delete process.env.CODEX_HOME;
};
