import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../../src/commands/sensors/bootstrap', () => ({
    planSensorBootstrap: jest.fn(),
    applySensorBootstrap: jest.fn(),
}));

import { initSensors } from '../../../src/commands/sensors/init';
import { applySensorBootstrap, planSensorBootstrap } from '../../../src/commands/sensors/bootstrap';

describe('initSensors when a pack is unavailable', () => {
    let project: string;

    beforeEach(() => {
        jest.clearAllMocks();
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-unavailable-'));
        fs.writeFileSync(path.join(project, 'pyproject.toml'), '[project]\nname = "fixture"\n');
    });
    afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

    it('fails closed with the portable bootstrap remedy rather than writing an empty or fallback v2 manifest', async () => {
        (planSensorBootstrap as jest.Mock).mockResolvedValue({
            kind: 'blocked', projectRoot: project, manifestPath: path.join(project, '.awm', 'sensors.json'), changes: [], dryRun: false,
            reason: 'source-unavailable', remedy: 'install-registry-or-run-awm-update',
        });

        await expect(initSensors({ cwd: project, registryRoot: '/stale/registry' }))
            .rejects.toThrow('source-unavailable: install-registry-or-run-awm-update');
        expect(applySensorBootstrap).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(project, '.awm', 'sensors.json'))).toBe(false);
    });
});
