import fs from 'fs';
import os from 'os';
import path from 'path';
import { planSensorBootstrap } from '../../../src/commands/sensors/bootstrap';

describe('planSensorBootstrap observational boundary', () => {
    it('does not create project files while reporting a missing explicit mode', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bootstrap-observe-'));
        try {
            fs.writeFileSync(path.join(project, 'package.json'), '{"name":"fixture"}\n');
            const before = fs.readdirSync(project).sort();
            await expect(planSensorBootstrap(project)).resolves.toMatchObject({ kind: 'blocked', reason: 'mode-required', changes: [] });
            expect(fs.readdirSync(project).sort()).toEqual(before);
            expect(fs.existsSync(path.join(project, '.awm'))).toBe(false);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    });
});
