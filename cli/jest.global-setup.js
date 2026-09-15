const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async () => {
  const testTmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-jest-')));

  process.env.AWM_JEST_TMPDIR = testTmp;
  process.env.TMPDIR = testTmp;
  process.env.TMP = testTmp;
  process.env.TEMP = testTmp;
  // Fail-safe for every test, including a future test that forgets its own
  // HOME/AWM_HOME fixture. No Jest worker may ever resolve AWM state from the
  // operator's real ~/.awm directory.
  process.env.HOME = path.join(testTmp, 'home');
  process.env.AWM_HOME = path.join(testTmp, 'awm-home');
  delete process.env.CODEX_HOME;
};
