// #238 S2 / SG-7 — soft (add/list) vs hard (sync/update/init/registry add) sync failure UX.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RegistrySyncResult } from '../../src/core/registries';
import {
    formatClassifiedRegistryFailure,
    formatRegistrySyncSoftFailure,
    formatSoftRegistrySyncFailures,
    hardFailOnAnyRegistrySyncError,
} from '../../src/core/registry-sync-report';

describe('registry-sync-report pure helpers (#238 S2)', () => {
    it('formatClassifiedRegistryFailure includes name, remote, class, fatal, remedy — never URL userinfo', () => {
        const token = 'ghp_TESTSECRET_DO_NOT_ECHO';
        const text = formatClassifiedRegistryFailure({
            name: 'baseline',
            remote: `https://${token}@example.test/baseline.git`,
            err: new Error(`fatal: could not read Username for 'https://${token}@example.test': terminal prompts disabled`),
        });
        expect(text).toContain('baseline');
        expect(text).toContain('example.test/baseline.git');
        expect(text).toMatch(/authentication/i);
        expect(text).toMatch(/terminal prompts disabled/i);
        expect(text).toMatch(/credential\.helper/);
        expect(text).not.toContain(token);
        expect(text).not.toMatch(/ghp_/);
    });

    it('formatRegistrySyncSoftFailure states cached version plus SG-6 cause/remedy', () => {
        const classified = formatClassifiedRegistryFailure({
            name: 'docs',
            remote: 'https://example.test/docs.git',
            err: new Error('fatal: unable to access: Could not resolve host: example.test'),
        });
        const soft = formatRegistrySyncSoftFailure({
            name: 'docs',
            cachedVersion: '1.4.0',
            classifiedMessage: classified,
        });
        expect(soft).toMatch(/cached version v1\.4\.0/i);
        expect(soft).toContain('docs');
        expect(soft).toMatch(/network/i);
        expect(soft).toMatch(/Could not resolve host/i);
        expect(soft).toMatch(/remedy:/);
        // B3: soft line must not say "sync failed" twice before the classified clause.
        expect(soft.match(/sync failed/gi)?.length ?? 0).toBe(1);
    });

    it('formatRegistrySyncSoftFailure uses unknown when cachedVersion is null', () => {
        const soft = formatRegistrySyncSoftFailure({
            name: 'docs',
            cachedVersion: null,
            classifiedMessage: 'registry docs sync failed (class=network); remedy: check connectivity',
        });
        expect(soft).toMatch(/cached version unknown/i);
    });

    it('hardFailOnAnyRegistrySyncError is true when any result is action:error', () => {
        const ok: RegistrySyncResult[] = [{ name: 'baseline', action: 'pulled', version: 'v1.0.0' }];
        const mixed: RegistrySyncResult[] = [
            { name: 'baseline', action: 'pulled', version: 'v1.0.0' },
            { name: 'docs', action: 'error', error: 'network unreachable' },
        ];
        expect(hardFailOnAnyRegistrySyncError(ok)).toBe(false);
        expect(hardFailOnAnyRegistrySyncError(mixed)).toBe(true);
    });

    it('formatSoftRegistrySyncFailures emits only usable errored registries with cached version', async () => {
        const results: RegistrySyncResult[] = [
            { name: 'ok', action: 'pulled', version: 'v1.0.0' },
            { name: 'stale', action: 'error', error: 'registry stale sync failed (class=network); remedy: check connectivity' },
            { name: 'gone', action: 'error', error: 'registry gone sync failed (class=not-found); remedy: verify the remote URL' },
        ];
        const lines = await formatSoftRegistrySyncFailures(results, {
            isUsable: (name) => name === 'stale',
            cachedVersion: (name) => (name === 'stale' ? '2.0.0' : null),
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/stale/);
        expect(lines[0]).toMatch(/cached version v2\.0\.0/i);
        expect(lines[0]).toMatch(/class=network/);
        expect(lines.join('\n')).not.toMatch(/\bgone\b/);
    });
});

describe('awm sync / update hard-exit on sync error (#238 S2 / SG-7)', () => {
    const realHome = process.env.HOME;
    const realAwmHome = process.env.AWM_HOME;
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sync-honesty-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
        jest.resetModules();
        jest.doMock('@clack/prompts', () => ({
            confirm: jest.fn(),
            isCancel: jest.fn(),
            intro: jest.fn(),
            outro: jest.fn(),
            spinner: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
        }));
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
        if (realAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = realAwmHome;
        jest.resetModules();
        jest.dontMock('@clack/prompts');
    });

    function writePrefs(): void {
        const { savePreferences } = require('../../src/utils/config');
        savePreferences({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });
    }

    function seedUsableDocsRegistry(): void {
        const registriesDir = path.join(process.env.AWM_HOME as string, 'registries');
        fs.mkdirSync(path.join(registriesDir, 'docs', 'skills'), { recursive: true });
        fs.writeFileSync(path.join(registriesDir, 'docs', 'skills', 'x.md'), '# x\n');
        fs.writeFileSync(
            path.join(process.env.AWM_HOME as string, 'registries.json'),
            JSON.stringify([{ name: 'docs', remote: 'https://example.test/docs.git' }]),
        );
    }

    it('runSyncCore returns code !== 0 when any registry result is action:error (even if usable on disk)', async () => {
        writePrefs();
        seedUsableDocsRegistry();
        const project = path.join(tmpHome, 'proj');
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(project, '.awm', 'profile.json'),
            JSON.stringify({ version: 1, extensions: [], agents: ['claude-code'] }),
        );

        const reconcile = jest.fn(() => []);
        const { runSyncCore } = require('../../src/commands/sync');
        const result = await runSyncCore(
            { cwd: project },
            {
                syncRegistries: async () => [
                    { name: 'docs', action: 'error', error: 'network unreachable' },
                ],
                verifyMinCliVersions: () => [],
                verifyProjectPins: async () => [],
                syncProfile: () => ({ extensions: [], installed: [], skipped: [], transactionIds: [] }),
                reconcileProjectSkillLinks: reconcile,
            },
        );
        expect(result.code).not.toBe(0);
        // A1: later stages still run when usable content remains.
        expect(reconcile).toHaveBeenCalled();
    });

    it('runUpdateCore returns code !== 0 when a registry fails even with usable on-disk content', async () => {
        writePrefs();
        seedUsableDocsRegistry();

        const regenerate = jest.fn(() => []);
        const planReconciliation = jest.fn(() => ({ operations: [], records: [], reports: [] }));
        const applyInstallPlan = jest.fn(() => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }));
        const offerSelfUpdate = jest.fn(async () => {});
        const { runUpdateCore, updateOutro } = require('../../src/commands/update');
        const result = await runUpdateCore(
            {},
            {
                syncRegistries: async () => [
                    { name: 'docs', action: 'error', error: 'network unreachable' },
                ],
                verifyMinCliVersions: () => [],
                regenerateGlobalContext: regenerate,
                planReconciliation,
                applyInstallPlan,
                resyncInstalledHooks: () => [],
                offerSelfUpdate,
            },
        );
        expect(result.code).not.toBe(0);
        expect(result.registries.failed).toEqual(['docs']);
        // A1: pipeline continues after sync error when content is usable.
        expect(regenerate).toHaveBeenCalled();
        expect(planReconciliation).toHaveBeenCalled();
        expect(applyInstallPlan).toHaveBeenCalled();
        expect(offerSelfUpdate).toHaveBeenCalled();
        expect(updateOutro(result)).toMatch(/Finished with registry sync errors|Update failed/i);
    });
});
