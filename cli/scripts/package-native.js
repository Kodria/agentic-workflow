const fs = require('fs');
const path = require('path');

const artifact = path.join(__dirname, '..', 'native', 'build', 'Release', 'secure_fs.node');
if (!fs.existsSync(artifact)) throw new Error(`native build artifact is missing: ${artifact}`);
const destination = path.join(__dirname, '..', 'prebuilds', `${process.platform}-${process.arch}`, 'secure_fs.node');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(artifact, destination);
