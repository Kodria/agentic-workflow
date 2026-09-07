import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Command } from 'commander';

jest.mock('@clack/prompts', () => ({
    intro: jest.fn(),
    outro: jest.fn(),
    spinner: () => ({ start: jest.fn(), stop: jest.fn() }),
    select: jest.fn(),
    multiselect: jest.fn(),
    confirm: jest.fn(),
    isCancel: jest.fn(() => false),
}));

type Route = 'add' | 'list' | 'remove';

function writeManifest(root: string, legacy: boolean): void {
    fs.mkdirSync(path.join(root, 'bundles', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'demo', source: './bundles/demo', version: '1.0.0', scope: 'project' }],
    }));
    fs.writeFileSync(path.join(root, 'bundles', 'demo', 'bundle.json'), JSON.stringify({
        name: 'demo', description: 'Diagnostic fixture', version: '1.0.0', scope: 'project', dependsOn: [],
        skills: legacy ? [{ name: 'demo-skill', onSignal: true }] : ['demo-skill'], workflows: [], agents: [],
    }));
    fs.writeFileSync(path.join(root, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: fixture\n---\n');
}

describe('S2 bundle compatibility diagnostic command routes', () => {
    let home: string;
    let priorHome: string | undefined;
    let priorAwmHome: string | undefined;
    let stderr: jest.SpyInstance;
    let stdout: jest.SpyInstance;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundle-command-'));
        priorHome = process.env.HOME;
        priorAwmHome = process.env.AWM_HOME;
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`unexpected process.exit(${code ?? 0})`);
        }) as never);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
        fs.rmSync(home, { recursive: true, force: true });
        if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
        if (priorAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = priorAwmHome;
    });

    async function run(route: Route, legacy: boolean): Promise<{ warnings: string[]; stdout: string }> {
        const root = path.join(process.env.AWM_HOME as string, 'registries', 'fixture');
        fs.rmSync(root, { recursive: true, force: true });
        writeManifest(root, legacy);
        fs.mkdirSync(process.env.AWM_HOME as string, { recursive: true });
        fs.writeFileSync(path.join(process.env.AWM_HOME as string, 'registries.json'), JSON.stringify([
            { name: 'fixture', remote: root },
        ]));

        jest.resetModules();
        const bundles = require('../../src/core/bundles');
        const registries = require('../../src/core/registries');
        const warnings: string[] = [];
        jest.spyOn(bundles, 'createBundleDiagnosticReporter').mockReturnValue((message: string) => warnings.push(message));
        jest.spyOn(registries, 'syncRegistries').mockResolvedValue([]);

        const { program } = require('../../src/index') as { program: Command };
        const addArgv = ['node', 'awm', 'add', 'demo', '--agent', 'claude-code', '--scope', 'global'];
        if (route === 'remove') {
            await program.parseAsync(addArgv);
            warnings.length = 0;
        }
        const argv = route === 'add'
            ? addArgv
            : route === 'list'
                ? ['node', 'awm', 'list', '--all']
                : ['node', 'awm', 'remove', 'demo', '--agent', 'claude-code', '--scope', 'global', '--yes'];
        await program.parseAsync(argv);
        return { warnings, stdout: stdout.mock.calls.map((call) => String(call[0])).join('') };
    }

    it.each<Route>(['add', 'list', 'remove'])('%s emits one legacy warning, none for canonical input, and leaves stdout untouched', async (route) => {
        const legacy = await run(route, true);
        expect(legacy.warnings).toHaveLength(1);
        expect(legacy.stdout).toBe('');

        const canonical = await run(route, false);
        expect(canonical.warnings).toEqual([]);
        expect(canonical.stdout).toBe('');
        expect(stderr).not.toHaveBeenCalled();
    });
});
