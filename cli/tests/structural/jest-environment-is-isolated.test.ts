import os from 'os';
import fs from 'fs';
import path from 'path';

describe('Jest environment isolation', () => {
    it('does not inherit the operator Codex home', () => {
        expect(process.env.CODEX_HOME).toBeUndefined();
    });

    it('uses a suite-owned temporary directory', () => {
        expect(os.tmpdir()).toContain('awm-jest-');
    });

    it('routes every unscoped AWM write into the suite-owned temporary directory', () => {
        expect(process.env.AWM_HOME).toBe(path.join(process.env.AWM_JEST_TMPDIR!, 'awm-home'));
    });

    it('keeps the suite root and both homes outside the operator home', () => {
        const suiteRoot = process.env.AWM_JEST_TMPDIR!;
        const operatorHome = fs.realpathSync(os.userInfo().homedir);

        expect(path.relative(operatorHome, suiteRoot).startsWith('..')).toBe(true);
        expect(process.env.HOME).toBe(path.join(suiteRoot, 'home'));
        expect(process.env.AWM_HOME).toBe(path.join(suiteRoot, 'awm-home'));
    });

    it('creates its physical root below the system temp directory, not the operator home', async () => {
        const originalEnv = { ...process.env };
        const systemTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-jest-system-'));
        const operatorHome = path.join(systemTemp, 'operator-home');

        try {
            fs.mkdirSync(operatorHome);
            jest.resetModules();
            jest.doMock('os', () => ({
                ...jest.requireActual('os'),
                homedir: () => operatorHome,
                tmpdir: () => systemTemp,
            }));

            const setup = require('../../jest.global-setup.js') as () => Promise<void>;
            await expect(setup()).resolves.toBeUndefined();
            const suiteRoot = process.env.AWM_JEST_TMPDIR!;
            expect(suiteRoot.startsWith(path.join(fs.realpathSync(systemTemp), 'awm-jest-'))).toBe(true);
            expect(path.relative(operatorHome, suiteRoot).startsWith('..')).toBe(true);
            expect(process.env.HOME).toBe(path.join(suiteRoot, 'home'));
            expect(process.env.AWM_HOME).toBe(path.join(suiteRoot, 'awm-home'));
        } finally {
            jest.dontMock('fs');
            jest.dontMock('os');
            jest.resetModules();
            for (const key of Object.keys(process.env)) delete process.env[key];
            Object.assign(process.env, originalEnv);
            fs.rmSync(systemTemp, { recursive: true, force: true });
        }
    });
});
