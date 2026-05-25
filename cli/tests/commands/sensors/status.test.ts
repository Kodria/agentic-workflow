import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { computeSensorStatus } from '../../../src/commands/sensors/status';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('computeSensorStatus', () => {
    let tmpDir: string;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
        mockExecSync.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('returns NOT_CONFIGURED when .awm/sensors.json missing', () => {
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('NOT_CONFIGURED');
        expect(result.pack).toBeNull();
    });

    it('returns HEALTHY when all sensor binaries are found', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { typecheck: { cmd: 'npx tsc --noEmit', fast: true } }
        }));
        mockExecSync.mockReturnValue('' as any);
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('HEALTHY');
        expect(result.pack).toBe('js-ts');
        expect(result.checks.typecheck.ok).toBe(true);
    });

    it('returns DEGRADED when a binary is missing', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { security: { cmd: 'semgrep --json .', fast: false } }
        }));
        mockExecSync.mockImplementation(() => { throw new Error('not found'); });
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.security.ok).toBe(false);
    });

    it('marks disabled sensors as ok', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { mutation: { enabled: false } }
        }));
        const result = computeSensorStatus(tmpDir);
        expect(result.checks.mutation.ok).toBe(true);
        expect(result.checks.mutation.detail).toBe('disabled');
    });
});
