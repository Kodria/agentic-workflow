// cli/tests/core/update-check.test.ts  (dual-tmpdir estándar)
import fs from 'fs';
import path from 'path';
import os from 'os';

// @clack/prompts ships as ESM; mock it so Jest (CommonJS mode) can load update-check
jest.mock('@clack/prompts', () => ({
    confirm: jest.fn(),
    isCancel: jest.fn(),
}));

describe('update-check', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let originalNoUpdate: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-uc-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-uc-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        originalNoUpdate = process.env.AWM_NO_UPDATE_CHECK;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        delete process.env.AWM_NO_UPDATE_CHECK;
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        if (originalNoUpdate === undefined) delete process.env.AWM_NO_UPDATE_CHECK;
        else process.env.AWM_NO_UPDATE_CHECK = originalNoUpdate;
        jest.restoreAllMocks();
    });

    it('fetchLatestVersion devuelve la versión del registry npm', async () => {
        const { fetchLatestVersion } = require('../../src/core/update-check');
        const fakeFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.3.0' }) });
        await expect(fetchLatestVersion(fakeFetch)).resolves.toBe('2.3.0');
    });

    it('fetchLatestVersion sin red → null en silencio', async () => {
        const { fetchLatestVersion } = require('../../src/core/update-check');
        const fakeFetch = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(fetchLatestVersion(fakeFetch)).resolves.toBeNull();
    });

    it('maybeNotifyUpdate avisa si el cache trae versión más nueva y NO refresca cache fresco', () => {
        const m = require('../../src/core/update-check');
        m.writeUpdateCache({ lastCheck: 1_000_000, latest: '99.0.0' });
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: 1_000_000 + 1000, spawnWorker });
        expect(log.mock.calls.flat().join('\n')).toContain('99.0.0');
        expect(spawnWorker).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it('cache viejo (>24h) dispara refresh en background', () => {
        const m = require('../../src/core/update-check');
        m.writeUpdateCache({ lastCheck: 0, latest: null });
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: 25 * 60 * 60 * 1000, spawnWorker });
        expect(spawnWorker).toHaveBeenCalledTimes(1);
    });

    it('AWM_NO_UPDATE_CHECK desactiva todo', () => {
        process.env.AWM_NO_UPDATE_CHECK = '1';
        const m = require('../../src/core/update-check');
        m.writeUpdateCache({ lastCheck: 0, latest: '99.0.0' });
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: Date.now(), spawnWorker });
        expect(log).not.toHaveBeenCalled();
        expect(spawnWorker).not.toHaveBeenCalled();
        log.mockRestore();
        delete process.env.AWM_NO_UPDATE_CHECK;
    });

    it('offerSelfUpdate corre el runner al confirmar y degrada a aviso si falla', async () => {
        const m = require('../../src/core/update-check');
        const runner = jest.fn().mockReturnValue({ status: 1 });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await m.offerSelfUpdate({ current: '2.0.0', latest: '2.1.0', confirmImpl: async () => true, runner });
        expect(runner).toHaveBeenCalled();
        expect(warn.mock.calls.flat().join('\n')).toContain('npm i -g agentic-workflow-manager');
        warn.mockRestore();
    });

    it('offerSelfUpdate escribe cache cuando ya está actualizado (TTL reset)', async () => {
        const m = require('../../src/core/update-check');
        const fakeFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.0.0' }) });
        await m.offerSelfUpdate({ current: '2.0.0', fetchImpl: fakeFetch });
        const cache = m.readUpdateCache();
        expect(cache).not.toBeNull();
        expect(cache.latest).toBe('2.0.0');
        expect(cache.lastCheck).toBeGreaterThan(0);
    });
});
