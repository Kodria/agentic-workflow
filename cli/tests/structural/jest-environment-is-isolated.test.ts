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

    it('falls back to the system temp directory when the home cache is read-only', async () => {
        const originalEnv = { ...process.env };
        const fallback = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-jest-fallback-'));

        try {
            jest.resetModules();
            jest.doMock('os', () => ({
                ...jest.requireActual('os'),
                homedir: () => '/readonly-home',
                tmpdir: () => fallback,
            }));

            const actualFs = jest.requireActual<typeof fs>('fs');
            jest.doMock('fs', () => ({
                ...actualFs,
                mkdirSync: jest.fn((target: fs.PathLike, ...args: unknown[]) => {
                    if (String(target).includes('readonly-home')) {
                        return undefined;
                    }
                    return (actualFs.mkdirSync as (...inner: unknown[]) => string | undefined)(target, ...args);
                }),
                mkdtempSync: jest.fn((prefix: string, ...args: unknown[]) => {
                    if (prefix.includes('readonly-home')) {
                        const error = new Error('read-only') as NodeJS.ErrnoException;
                        error.code = 'EROFS';
                        throw error;
                    }
                    return (actualFs.mkdtempSync as (...inner: unknown[]) => string)(prefix, ...args);
                }),
            }));

            const setup = require('../../jest.global-setup.js') as () => Promise<void>;
            await expect(setup()).resolves.toBeUndefined();
            expect(process.env.AWM_JEST_TMPDIR?.startsWith(path.join(fallback, 'awm-cache', 'awm-jest-'))).toBe(true);
        } finally {
            jest.dontMock('fs');
            jest.dontMock('os');
            jest.resetModules();
            for (const key of Object.keys(process.env)) delete process.env[key];
            Object.assign(process.env, originalEnv);
            fs.rmSync(fallback, { recursive: true, force: true });
        }
    });
});
