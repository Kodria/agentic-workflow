const fs = require('fs');
const path = require('path');

const sourceRoot = process.argv[2];
if (!sourceRoot || !path.isAbsolute(sourceRoot)) throw new Error('native artifact source must be an absolute directory');
const packageRoot = path.resolve(__dirname, '..');
const targets = [
  'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64',
];

for (const target of targets) {
  const source = path.join(sourceRoot, `secure-fs-${target}`, 'secure_fs.node');
  if (!fs.existsSync(source)) throw new Error(`release native build artifact is missing: ${target} (${source})`);
  const destination = path.join(packageRoot, 'prebuilds', target, 'secure_fs.node');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
