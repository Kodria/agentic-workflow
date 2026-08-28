const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const artifact = path.join(__dirname, '..', 'prebuilds', `${process.platform}-${process.arch}`, 'secure_fs.node');
if (!packageJson.files.includes('prebuilds')) throw new Error('npm package must include prebuilds');
if (!fs.existsSync(artifact)) throw new Error(`selected native package artifact is missing: ${artifact}`);
