import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [provider, projectArg = path.join(repoRoot, 'cli')] = process.argv.slice(2);
if (!['claude-code', 'codex'].includes(provider)) throw new Error('provider must be claude-code or codex');

const project = path.resolve(projectArg);
const cli = path.join(repoRoot, 'cli/dist/src/index.js');
if (!fs.existsSync(cli)) throw new Error('missing compiled CLI: run npm run build from cli first');

const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(sourceHead)) throw new Error(`unexpected sourceHead: ${sourceHead}`);
const stdout = execFileSync(process.execPath, [cli, 'sensors', 'coverage', '--json'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
});
const report = JSON.parse(stdout);
const evidence = {
    schema: 1,
    provider,
    result: 'pass',
    // This is the repository HEAD at invocation time. The evidence file itself may be
    // committed later, so sourceHead identifies the tested binary source, not its commit.
    sourceHead,
    command: 'node cli/dist/src/index.js sensors coverage --json',
    reportSha256: crypto.createHash('sha256').update(stdout).digest('hex'),
    semanticContract: {
        schemaVersion: report.schemaVersion,
        overall: report.overall,
        staticReason: report.static.reason,
        classes: report.static.classes.map(({ id, status }) => ({ id, status })),
    },
};
const output = path.join(repoRoot, 'docs/research/r2/evidence', `${provider}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${path.relative(repoRoot, output)}\n`);
