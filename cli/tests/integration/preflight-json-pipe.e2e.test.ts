import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cliRoot = path.resolve(__dirname, '../..');
const bin = path.join(cliRoot, 'dist', 'src', 'index.js');

test('preserves degraded preflight JSON when stdout is piped', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-pipe-'));
    try {
        const result = spawnSync(process.execPath, [bin, 'preflight', '--json'], {
            cwd: project,
            encoding: 'utf8',
            env: { ...process.env, AWM_HOME: path.join(project, 'awm-home'), AWM_NO_UPDATE_CHECK: '1' },
        });
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({ status: 'not_configured' });
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});
