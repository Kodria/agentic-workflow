// #238 S2 / SG-7 — soft (add/list) vs hard (sync/update/init/registry add) sync failure UX.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RegistrySyncResult } from '../../src/core/registries';
import {
    formatClassifiedRegistryFailure,
    formatRegistrySyncSoftFailure,
    hardFailOnAnyRegistrySyncError,
} from '../../src/core/registry-sync-report';

describe('registry-sync-report pure helpers (#238 S2)', () => {
    it('formatClassifiedRegistryFailure includes name, remote, class, fatal, remedy — never env values', () => {
        const text = formatClassifiedRegistryFailure({
            name: 'baseline',
            remote: 'https://example.test/baseline.git',
            err: new Error('fatal: could not read Username: terminal prompts disabled'),
        });
        expect(text).toContain('baseline');
        expect(text).toContain('https://example.test/baseline.git');
        expect(text).toMatch(/authentication/i);
        expect(text).toMatch(/terminal prompts disabled/i);
        expect(text).toMatch(/credential\.helper/);
        expect(text).not.toContain('/secret/');
        expect(text).not.toMatch(/GIT_ASKPASS\s*=/);
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
                reconcileProjectSkillLinks: () => [],
            },
        );
        expect(result.code).not.toBe(0);
    });

    it('runUpdateCore returns code !== 0 when a registry fails even with usable on-disk content', async () => {
        writePrefs();
        seedUsableDocsRegistry();

        const { runUpdateCore } = require('../../src/commands/update');
        const result = await runUpdateCore(
            {},
            {
                syncRegistries: async () => [
                    { name: 'docs', action: 'error', error: 'network unreachable' },
                ],
                verifyMinCliVersions: () => [],
                regenerateGlobalContext: () => [],
                planReconciliation: () => ({ operations: [], records: [], reports: [] }),
                applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }),
                resyncInstalledHooks: () => [],
                offerSelfUpdate: async () => {},
            },
        );
        expect(result.code).not.toBe(0);
        expect(result.registries.failed).toEqual(['docs']);
    });
});
