const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const prebuilds = process.env.AWM_NATIVE_PREBUILDS || path.join(__dirname, '..', 'prebuilds');
const targets = [
  ['linux', 'x64'], ['linux', 'arm64'],
  ['darwin', 'x64'], ['darwin', 'arm64'],
  ['win32', 'x64'], ['win32', 'arm64'],
];
if (!packageJson.files.includes('prebuilds')) throw new Error('npm package must include prebuilds');
for (const [platform, arch] of targets) {
  const artifact = path.join(prebuilds, `${platform}-${arch}`, 'secure_fs.node');
  if (!fs.existsSync(artifact)) throw new Error(`release native package artifact is missing: ${platform}-${arch} (${artifact})`);
}
