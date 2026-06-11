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

    // Helper: simulate a tool installed locally (node_modules/.bin/<tool>)
    function installLocalBin(tool: string) {
        const binDir = path.join(tmpDir, 'node_modules', '.bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, tool), '');
    }

    it('returns HEALTHY when an npx tool is installed locally', () => {
        installLocalBin('tsc');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { typecheck: { cmd: 'npx tsc --noEmit', fast: true } }
        }));
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('HEALTHY');
        expect(result.pack).toBe('js-ts');
        expect(result.checks.typecheck.ok).toBe(true);
    });

    it('marks an npx sensor DEGRADED when the tool is NOT installed locally (npx would fetch a remote package)', () => {
        // No node_modules/.bin/depcruise → status must NOT report ✔ just because npx exists.
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { depcheck: { cmd: 'npx depcruise --config .dep-cruiser.awm.js app', fast: false } }
        }));
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.depcheck.ok).toBe(false);
        expect(result.checks.depcheck.detail).toMatch(/not installed locally/i);
    });

    it('marks a sensor DEGRADED when its --config file is missing', () => {
        installLocalBin('eslint');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { lint: { cmd: 'npx eslint . --config eslint.config.awm.mjs --format json', fast: true } }
        }));
        const result = computeSensorStatus(tmpDir);
        expect(result.checks.lint.ok).toBe(false);
        expect(result.checks.lint.detail).toMatch(/missing config/i);
    });

    it('is HEALTHY when the npx tool is installed and the --config file exists', () => {
        installLocalBin('eslint');
        fs.writeFileSync(path.join(tmpDir, 'eslint.config.awm.mjs'), 'export default []');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { lint: { cmd: 'npx eslint . --config eslint.config.awm.mjs --format json', fast: true } }
        }));
        const result = computeSensorStatus(tmpDir);
        expect(result.checks.lint.ok).toBe(true);
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
