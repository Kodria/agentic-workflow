import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { computeSensorStatus } from '../../../src/commands/sensors/status';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('computeSensorStatus — Windows PATH resolution', () => {
    let tmpDir: string;
    const originalPlatform = process.platform;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-win-'));
        mockExecSync.mockReset();
        Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true });
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('resolves an installed binary on win32 using `where`, not `which`', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { security: { cmd: 'semgrep --json .', fast: false } }
        }));

        mockExecSync.mockImplementation(((cmd: string) => {
            if (cmd.startsWith('where ')) return Buffer.from('C:\\tools\\semgrep.exe');
            throw new Error(`not found: ${cmd}`);
        }) as typeof execSync);

        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('HEALTHY');
        expect(result.checks.security.ok).toBe(true);
    });

    it('reports ok:false on win32 when `where` cannot find the binary', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { security: { cmd: 'semgrep --json .', fast: false } }
        }));

        mockExecSync.mockImplementation(((cmd: string) => {
            if (cmd.startsWith('where ')) throw new Error(`not found: ${cmd}`);
            throw new Error(`not found: ${cmd}`);
        }) as typeof execSync);

        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.security.ok).toBe(false);
    });
});
