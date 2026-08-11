const fs = require('fs');

module.exports = async () => {
  const testTmp = process.env.AWM_JEST_TMPDIR;
  if (testTmp) fs.rmSync(testTmp, { recursive: true, force: true });
};
