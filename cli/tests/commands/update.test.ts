// `awm update` no debe anunciar trabajo que no hizo, ni colgarse esperando a un humano
// que no está.
//
// Los dos defectos que estos tests dejan cerrados se reprodujeron en un HOME aislado
// contra el binario publicado (v6.3.0):
//
//   1. Sobre un AWM_HOME recién creado, SIN NINGÚN registry configurado, el comando
//      imprimía "✅ Registries, skills and hooks updated." y salía 0. No había registries,
//      no había skills y no había hooks: cada etapa "pasaba" porque no tenía nada que
//      hacer, y `runUpdateCore` devolvía `{ code: 0 }` incondicionalmente al final. El
//      literal del outro en `index.ts` solo podía decir "actualizado".
//   2. Con un TTY en stdin, el comando quedaba colgado para siempre en el confirm de
//      self-update ("Update awm v6.2.1 → v6.3.0 now?"). Con `< /dev/null` terminaba bien
//      — es decir, el cuelgue aparecía exactamente cuando había un humano, y desaparecía
//      cuando no lo había, que es al revés de lo que hace falta: en CI, cron o una sesión
//      agéntica no hay nadie para contestar.
//
// Ambos se testean por el VALOR DE RETORNO y por el texto derivado, no scrapeando consola:
// el defecto vivía justamente en que el retorno no llevaba la información que el mensaje
// necesitaba.
import fs from 'fs';
import os from 'os';
import path from 'path';

// `@clack/prompts` es ESM-only y el transform CommonJS de ts-jest no puede cargarlo; se
// mockea para poder `require` `core/update-check` desde acá (mismo patrón que
// `tests/core/update-check.test.ts`). Los tests inyectan su propio `confirmImpl`, así que
// este doble nunca llega a usarse: solo evita que el import de nivel de módulo explote.
jest.mock('@clack/prompts', () => ({
    confirm: jest.fn(),
    isCancel: jest.fn(),
}));

/** Preferencias mínimas válidas en el AWM_HOME activo (`normalizePreferences` exige los
 *  cuatro campos). Se llama despues de fijar HOME/AWM_HOME, nunca antes. */
function writePrefs(): void {
    const { savePreferences } = require('../../src/utils/config');
    savePreferences({
        defaultAgent: 'claude-code',
        enabledAgents: ['claude-code'],
        installMethod: 'symlink',
        defaultScope: 'local',
    });
}

describe('awm update — honest outcome', () => {
    const realHome = process.env.HOME;
    const realAwmHome = process.env.AWM_HOME;
    let tmpHome: string;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errSpy: jest.SpyInstance;

    beforeEach(() => {
        // Ningún test toca el `~/.awm` real (CLAUDE.md): HOME y AWM_HOME apuntan al tmpdir.
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-update-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
        writePrefs();
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.resetModules();
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errSpy.mockRestore();
        if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
        if (realAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = realAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    function deps(overrides: Record<string, unknown> = {}) {
        return {
            syncRegistries: async () => [{ name: 'baseline', action: 'pulled', version: 'v1.15.1' }],
            verifyMinCliVersions: () => [],
            regenerateGlobalContext: () => [],
            planReconciliation: () => ({ operations: [], records: [], reports: [] }),
            applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }),
            resyncInstalledHooks: () => [],
            offerSelfUpdate: async () => {},
            ...overrides,
        };
    }

    it('sin registries configurados NO declara éxito: sale != 0 y manda a `awm init`', async () => {
        const { runUpdateCore, updateOutro } = require('../../src/commands/update');
        const result = await runUpdateCore({}, deps({ syncRegistries: async () => [] }));

        expect(result.code).not.toBe(0);
        expect(result.registries).toEqual({ configured: 0, synced: 0, failed: [] });
        // El cierre nunca puede afirmar que se actualizó algo.
        expect(updateOutro(result)).toBe('Nothing updated — no registries configured on this machine.');
        expect(updateOutro(result)).not.toMatch(/updated\./i);
        expect(errSpy.mock.calls.flat().join('\n')).toMatch(/awm init/);
    });

    it('sin registries no sigue con las etapas posteriores (que "pasarían" por vacías)', async () => {
        const { runUpdateCore } = require('../../src/commands/update');
        const planReconciliation = jest.fn(() => ({ operations: [], records: [], reports: [] }));
        const resyncInstalledHooks = jest.fn(() => []);
        const offerSelfUpdate = jest.fn(async () => {});

        await runUpdateCore({}, deps({
            syncRegistries: async () => [],
            planReconciliation, resyncInstalledHooks, offerSelfUpdate,
        }));

        expect(planReconciliation).not.toHaveBeenCalled();
        expect(resyncInstalledHooks).not.toHaveBeenCalled();
        expect(offerSelfUpdate).not.toHaveBeenCalled();
    });

    it('con registries sincronizados sí declara éxito, y dice cuántos', async () => {
        const { runUpdateCore, updateOutro } = require('../../src/commands/update');
        const result = await runUpdateCore({}, deps({
            syncRegistries: async () => [
                { name: 'baseline', action: 'pulled', version: 'v1.15.1' },
                { name: 'docs', action: 'recloned', version: 'v2.0.0' },
            ],
        }));

        expect(result.code).toBe(0);
        expect(result.registries).toEqual({ configured: 2, synced: 2, failed: [] });
        expect(updateOutro(result)).toBe('✅ 2 registries, skills and hooks updated.');
    });

    it('un registry que falló y NO dejó contenido en disco falla cerrado', async () => {
        const { runUpdateCore } = require('../../src/commands/update');
        const result = await runUpdateCore({}, deps({
            syncRegistries: async () => [{ name: 'baseline', action: 'error', error: 'network unreachable' }],
        }));

        expect(result.code).toBe(1);
        expect(result.registries.failed).toEqual(['baseline']);
    });

    it('un registry que falló pero conserva contenido sigue, y el cierre lo nombra en vez de anunciar éxito parejo', async () => {
        // `unusableSyncedRegistries` mira contenido EN DISCO: se siembra el content root
        // y el registries.json para que `docs` cuente como stale, no como roto.
        const registriesDir = path.join(process.env.AWM_HOME as string, 'registries');
        fs.mkdirSync(path.join(registriesDir, 'docs', 'skills'), { recursive: true });
        fs.writeFileSync(
            path.join(process.env.AWM_HOME as string, 'registries.json'),
            JSON.stringify([{ name: 'docs', remote: 'https://example.test/docs.git' }]),
        );

        const { runUpdateCore, updateOutro } = require('../../src/commands/update');
        const result = await runUpdateCore({}, deps({
            syncRegistries: async () => [
                { name: 'baseline', action: 'pulled', version: 'v1.15.1' },
                { name: 'docs', action: 'error', error: 'network unreachable' },
            ],
        }));

        expect(result.code).toBe(0);
        expect(result.registries).toEqual({ configured: 2, synced: 1, failed: ['docs'] });
        const outro = updateOutro(result);
        expect(outro).toMatch(/stale/i);
        expect(outro).toMatch(/docs/);
        expect(outro).not.toMatch(/^✅/);
    });
});

describe('awm update — nunca se cuelga esperando a un humano que no está', () => {
    const realHome = process.env.HOME;
    const realAwmHome = process.env.AWM_HOME;
    let tmpHome: string;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-update-tty-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
        writePrefs();
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.resetModules();
    });

    afterEach(() => {
        logSpy.mockRestore();
        if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
        if (realAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = realAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    function updateDeps(offerSelfUpdate: unknown) {
        return {
            syncRegistries: async () => [{ name: 'baseline', action: 'pulled', version: 'v1.15.1' }],
            verifyMinCliVersions: () => [],
            regenerateGlobalContext: () => [],
            planReconciliation: () => ({ operations: [], records: [], reports: [] }),
            applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }),
            resyncInstalledHooks: () => [],
            offerSelfUpdate,
        };
    }

    it('`--yes` pide assume-yes; sin flag delega la decisión al modo por defecto', async () => {
        const { runUpdateCore } = require('../../src/commands/update');

        const withFlag = jest.fn(async () => {});
        await runUpdateCore({ yes: true }, updateDeps(withFlag));
        expect(withFlag).toHaveBeenCalledWith('assume-yes');

        const withoutFlag = jest.fn(async () => {});
        await runUpdateCore({}, updateDeps(withoutFlag));
        // `undefined`, no `'prompt'`: quién decide es `defaultSelfUpdateMode()`, según
        // haya o no alguien en stdin. Fijar 'prompt' acá reintroduciría el cuelgue.
        expect(withoutFlag).toHaveBeenCalledWith(undefined);
    });

    describe('defaultSelfUpdateMode / offerSelfUpdate', () => {
        const realIsTTY = process.stdin.isTTY;
        const realNoCheck = process.env.AWM_NO_UPDATE_CHECK;

        beforeEach(() => { delete process.env.AWM_NO_UPDATE_CHECK; });
        afterEach(() => {
            Object.defineProperty(process.stdin, 'isTTY', { value: realIsTTY, configurable: true });
            if (realNoCheck === undefined) delete process.env.AWM_NO_UPDATE_CHECK;
            else process.env.AWM_NO_UPDATE_CHECK = realNoCheck;
        });

        it('sin TTY el modo por defecto es skip; con TTY es prompt', () => {
            const { defaultSelfUpdateMode } = require('../../src/core/update-check');
            Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
            expect(defaultSelfUpdateMode()).toBe('skip');
            Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
            expect(defaultSelfUpdateMode()).toBe('prompt');
        });

        it('sin TTY no pregunta ni actualiza: avisa y sigue', async () => {
            const { offerSelfUpdate } = require('../../src/core/update-check');
            Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
            const confirmImpl = jest.fn(async () => true);
            const runner = jest.fn(() => ({ status: 0 }));

            await offerSelfUpdate({ current: '6.2.1', latest: '6.3.0', confirmImpl, runner });

            expect(confirmImpl).not.toHaveBeenCalled();
            // El silencio no autoriza reemplazar el binario global de la máquina.
            expect(runner).not.toHaveBeenCalled();
            expect(logSpy.mock.calls.flat().join('\n')).toMatch(/npm i -g/);
        });

        it("modo 'assume-yes' actualiza sin preguntar", async () => {
            const { offerSelfUpdate } = require('../../src/core/update-check');
            const confirmImpl = jest.fn(async () => true);
            const runner = jest.fn(() => ({ status: 0 }));

            await offerSelfUpdate({ current: '6.2.1', latest: '6.3.0', mode: 'assume-yes', confirmImpl, runner });

            expect(confirmImpl).not.toHaveBeenCalled();
            expect(runner).toHaveBeenCalledWith('npm', ['i', '-g', expect.stringContaining('@latest')]);
        });
    });
});
