import fs from 'fs';
import os from 'os';
import path from 'path';
import { AWM_GITIGNORE_BEGIN } from '../../../src/core/awm-gitignore';

jest.mock('../../../src/commands/sensors/bootstrap', () => ({
    planSensorBootstrap: jest.fn(),
    applySensorBootstrap: jest.fn(),
}));

jest.mock('../../../src/commands/sensors/detection', () => ({
    detectStack: jest.fn(() => ({ pack: 'js-ts', evidence: [] })),
}));

const { planSensorBootstrap, applySensorBootstrap } = require('../../../src/commands/sensors/bootstrap');
const { initSensors } = require('../../../src/commands/sensors/init');

describe('initSensors managed awm gitignore (GI-1)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensors-gi-'));
        jest.clearAllMocks();
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('upserts the managed block after a successful create', async () => {
        planSensorBootstrap.mockResolvedValue({
            kind: 'create',
            projectRoot: tmp,
            manifestPath: path.join(tmp, '.awm', 'sensors.json'),
            dryRun: false,
            changes: [],
            manifest: { schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', source: { registry: 'baseline' }, sensors: {} },
        });
        applySensorBootstrap.mockImplementation(() => {
            fs.mkdirSync(path.join(tmp, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(tmp, '.awm', 'sensors.json'), '{}');
            return 'created';
        });
        await initSensors({ cwd: tmp });
        expect(applySensorBootstrap).toHaveBeenCalled();
        const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
        expect(gi).toContain(AWM_GITIGNORE_BEGIN);
        expect(gi).toContain('!.awm/profile.json');
    });

    it('repairs the managed block on noop when .awm/ already exists', async () => {
        fs.mkdirSync(path.join(tmp, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmp, '.awm', 'sensors.json'), '{}');
        fs.writeFileSync(path.join(tmp, '.gitignore'), '.awm/\n');
        planSensorBootstrap.mockResolvedValue({ kind: 'noop' });
        await initSensors({ cwd: tmp });
        expect(applySensorBootstrap).not.toHaveBeenCalled();
        const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
        expect(gi).toContain(AWM_GITIGNORE_BEGIN);
        expect(gi.split('\n').map((l: string) => l.trim()).filter((l: string) => l === '.awm/')).toEqual([]);
    });
});
