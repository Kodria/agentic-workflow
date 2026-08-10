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
        // stderr, no stdout: el aviso sale al final de cualquier comando y en stdout
        // rompia la salida de `--json`.
        const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: 1_000_000 + 1000, spawnWorker });
        expect(err.mock.calls.flat().join('\n')).toContain('99.0.0');
        expect(spawnWorker).not.toHaveBeenCalled();
        err.mockRestore();
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

// El aviso de version nueva va por stderr, no por stdout.
//
// Se imprime al final de CUALQUIER comando, asi que en stdout se mezclaba con la salida
// de `--json` y rompia a cualquiera que parsee. Encontrado tropezando con el:
// `awm doctor --json | node -e 'JSON.parse(...)'` fallaba con un SyntaxError que no
// menciona la causa. stdout es la interfaz de maquina.
describe('the update banner never contaminates stdout', () => {
    it('writes to stderr so `--json` output stays parseable', () => {
        const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const { maybeNotifyUpdate } = require('../../src/core/update-check');
            maybeNotifyUpdate({ spawnWorker: () => {} });
            const onStdout = stdout.mock.calls.map((c) => String(c[0])).join('')
                + log.mock.calls.map((c) => String(c[0])).join('');
            expect(onStdout).not.toContain('available');
            // Y si habia aviso, salio por stderr — no se perdio, se movio.
            const emitted = stderr.mock.calls.map((c) => String(c[0])).join('');
            if (emitted.length > 0) expect(emitted).toContain('available');
        } finally {
            stdout.mockRestore(); stderr.mockRestore(); log.mockRestore();
        }
    });
});
