import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Command } from 'commander';

jest.mock('@clack/prompts', () => ({
    intro: jest.fn(), outro: jest.fn(), spinner: () => ({ start: jest.fn(), stop: jest.fn() }),
    select: jest.fn(), multiselect: jest.fn(), confirm: jest.fn(), isCancel: jest.fn(() => false),
}));

type Route = 'init' | 'sync' | 'update' | 'doctor' | 'export' | 'registry-add' | 'registry-status';

function writeManifest(root: string, legacy: boolean): void {
    fs.mkdirSync(path.join(root, 'bundles', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({ version: 1, bundles: [{ name: 'demo', source: './bundles/demo', version: '1.0.0', scope: 'baseline' }] }));
    fs.writeFileSync(path.join(root, 'bundles', 'demo', 'bundle.json'), JSON.stringify({
        name: 'demo', description: 'Diagnostic fixture', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: legacy ? [{ name: 'demo-skill', onSignal: true }] : ['demo-skill'], workflows: [], agents: [],
    }));
    fs.writeFileSync(path.join(root, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: fixture\n---\n');
}

function git(cwd: string, args: string[]): void {
    execFileSync('git', ['-c', 'user.email=test@example.test', '-c', 'user.name=Test', ...args], { cwd, stdio: 'pipe' });
}

describe('S2 bundle compatibility diagnostic command routes', () => {
    let home: string;
    let work: string;
    let priorHome: string | undefined;
    let priorAwmHome: string | undefined;
    let stdout: jest.SpyInstance;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundle-command-home-'));
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundle-command-work-'));
        priorHome = process.env.HOME;
        priorAwmHome = process.env.AWM_HOME;
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
        if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
        if (priorAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = priorAwmHome;
    });

    function configureRegistry(legacy: boolean): string {
        fs.rmSync(path.join(process.env.AWM_HOME as string, 'registries'), { recursive: true, force: true });
        const root = path.join(process.env.AWM_HOME as string, 'registries', 'baseline');
        writeManifest(root, legacy);
        fs.mkdirSync(process.env.AWM_HOME as string, { recursive: true });
        fs.writeFileSync(path.join(process.env.AWM_HOME as string, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: root }]));
        fs.writeFileSync(path.join(process.env.AWM_HOME as string, 'preferences.json'), JSON.stringify({
            defaultAgent: 'claude-code', enabledAgents: ['claude-code'], installMethod: 'symlink', defaultScope: 'local',
        }));
        return root;
    }

    function stdoutText(): string {
        return stdout.mock.calls.map((call) => String(call[0])).join('');
    }

    async function run(route: Route, legacy: boolean): Promise<{ warnings: string[] }> {
        fs.rmSync(work, { recursive: true, force: true });
        fs.mkdirSync(work, { recursive: true });
        const root = configureRegistry(legacy);
        const warnings: string[] = [];
        const reporter = (warning: string) => warnings.push(warning);

        if (route === 'init') {
            const { runInit } = require('../../src/commands/init');
            await runInit({ cwd: work, yes: true, json: true, reporter, assertProviderSupported: () => {}, actions: { syncCache: async () => [], installHook: () => ({ status: 'installed' }) } });
            expect(JSON.parse(stdoutText())).toHaveProperty('result');
        } else if (route === 'sync') {
            fs.mkdirSync(path.join(work, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(work, 'package.json'), '{}');
            fs.writeFileSync(path.join(work, '.awm', 'profile.json'), JSON.stringify({ extensions: ['demo'] }));
            const { runSyncCore } = require('../../src/commands/sync');
            await runSyncCore({ cwd: work, reporter }, {
                syncRegistries: async () => [], verifyMinCliVersions: () => [], verifyProjectPins: async () => [],
                syncProfile: () => ({ extensions: ['demo'], installed: [], skipped: [], transactionIds: [] }), reconcileProjectSkillLinks: () => [],
            });
        } else if (route === 'update') {
            const { runUpdateCore } = require('../../src/commands/update');
            const { planReconciliation } = require('../../src/core/reconciliation');
            await runUpdateCore({ yes: true, reporter }, {
                syncRegistries: async () => [{ name: 'baseline', action: 'pulled', version: 'v1.0.0' }], verifyMinCliVersions: () => [],
                regenerateGlobalContext: () => [], planReconciliation, applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'test', modifiedFiles: [] }),
                resyncInstalledHooks: () => [], offerSelfUpdate: async () => {},
            });
        } else if (route === 'doctor') {
            const { runDoctor } = require('../../src/commands/doctor');
            runDoctor({ cwd: work, json: true, reporter });
            expect(JSON.parse(stdoutText())).toHaveProperty('providers');
        } else if (route === 'export') {
            const { runExportCommand } = require('../../src/commands/export');
            runExportCommand('demo', { target: 'claude-ai', out: path.join(work, 'export') }, { roots: [root], reporter, log: () => {}, zip: () => ({ ok: false, missing: true }) });
        } else {
            jest.resetModules();
            const bundles = require('../../src/core/bundles');
            jest.spyOn(bundles, 'createBundleDiagnosticReporter').mockReturnValue(reporter);
            const { registerRegistryCommand } = require('../../src/commands/registry');
            const program = new (require('commander').Command)() as Command;
            registerRegistryCommand(program);
            if (route === 'registry-add') {
                const source = path.join(work, 'source');
                writeManifest(source, legacy);
                git(source, ['init', '-q']); git(source, ['add', '-A']); git(source, ['commit', '-qm', 'fixture']);
                await program.parseAsync(['node', 'awm', 'registry', 'add', source, '--name', 'fixture', '--no-install']);
            } else {
                await program.parseAsync(['node', 'awm', 'registry', 'list']);
            }
        }
        return { warnings };
    }

    it.each<Route>(['init', 'sync', 'update', 'doctor', 'export', 'registry-add', 'registry-status'])('%s emits one legacy warning and none for canonical manifests', async (route) => {
        expect((await run(route, true)).warnings).toHaveLength(1);
        stdout.mockClear();
        expect((await run(route, false)).warnings).toEqual([]);
    });
});
