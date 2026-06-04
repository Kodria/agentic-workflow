import fs from 'fs';
import os from 'os';
import path from 'path';

// Siembra un cache mínimo en <cliSource> con un baseline bundle de 1 skill + hooks.
function seedCache(cliSource: string) {
    const content = path.join(cliSource, 'registry');
    fs.mkdirSync(path.join(content, 'skills', 'brainstorming'), { recursive: true });
    fs.writeFileSync(path.join(content, 'skills', 'brainstorming', 'SKILL.md'), '# brainstorming');
    fs.mkdirSync(path.join(content, 'skills', 'using-awm'), { recursive: true });
    fs.writeFileSync(path.join(content, 'skills', 'using-awm', 'SKILL.md'), '# using-awm');
    fs.mkdirSync(path.join(content, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(content, 'hooks', 'session-start'), '#!/bin/sh\n');
    fs.chmodSync(path.join(content, 'hooks', 'session-start'), 0o755);
    fs.writeFileSync(path.join(content, 'hooks', 'run-hook.cmd'), '#!/bin/sh\n');
    fs.chmodSync(path.join(content, 'hooks', 'run-hook.cmd'), 0o755);
    fs.mkdirSync(path.join(content, 'sensor-packs', 'js-ts'), { recursive: true });
    fs.writeFileSync(path.join(content, 'sensor-packs', 'js-ts', 'pack.json'),
        JSON.stringify({ sensors: { lint: { defaultCmd: 'eslint {{SOURCE_DIRS}}', fast: true } } }));
    // .git para que machine.cli.present sea true tras "sync"
    fs.mkdirSync(path.join(cliSource, '.git'), { recursive: true });
    fs.mkdirSync(path.join(cliSource, 'cli'), { recursive: true });
    fs.writeFileSync(path.join(cliSource, 'cli', 'package.json'), JSON.stringify({ version: '1.0.0' }));
    // catalog + bundle dev (baseline)
    fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
        version: 1, bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.mkdirSync(path.join(content, 'bundles', 'dev'), { recursive: true });
    fs.writeFileSync(path.join(content, 'bundles', 'dev', 'bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: [{ name: 'brainstorming' }, { name: 'using-awm' }], workflows: [], agents: [],
    }));
}

describe('runInitSteps — orchestrator', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-orch-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });
    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    function buildDeps(cwd: string) {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const { discoverBundles, REGISTRY_CONTENT_DIR } = require('../../../src/core/bundles');
        const { REGISTRY_DIR } = require('../../../src/core/registry');
        const { defaultActions } = require('../../../src/core/init/steps');
        const cliSource = path.join(tmpHome, '.awm', 'cli-source');
        seedCache(cliSource);
        const bundles = discoverBundles();
        const ctx = gatherContext({ cwd, bundles });
        return {
            cwd, ctx, bundles, agent: 'claude-code', installMethod: 'symlink',
            registryRoot: REGISTRY_DIR, contentDir: REGISTRY_CONTENT_DIR,
            confirmExtensions: async (p: string[]) => p,
            // syncCache es no-op: el cache ya está sembrado en disco
            actions: { ...defaultActions, syncCache: async () => {} },
        };
    }

    it('machine-only on a bare cwd installs baseline + hook, reaches healthy machine', async () => {
        const { runInitSteps } = require('../../../src/core/init/orchestrator');
        const bareCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bare-'));
        try {
            const deps = buildDeps(bareCwd); // bareCwd no es repo → project null
            deps.ctx.project = null;
            const out = await runInitSteps(deps);
            expect(out.applied).toBeGreaterThan(0);
            expect(out.steps.some((s: any) => s.id === 'machine.devCore' && s.action === 'applied')).toBe(true);
            expect(out.after.results.find((r: any) => r.id === 'machine.devCore').status).toBe('ok');
        } finally {
            fs.rmSync(bareCwd, { recursive: true, force: true });
        }
    });

    it('project repo: applies activation/sensors, flags constitution+context as pending', async () => {
        const root = path.join(tmpHome, 'repo');
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
        const deps = buildDeps(root);
        const { runInitSteps } = require('../../../src/core/init/orchestrator');
        const out = await runInitSteps(deps);
        expect(out.steps.some((s: any) => s.id === 'project.sensors' && s.action === 'applied')).toBe(true);
        expect(out.steps.find((s: any) => s.id === 'project.constitution').action).toBe('pending');
        expect(out.steps.find((s: any) => s.id === 'project.context').action).toBe('pending');
    });

    it('is idempotent: a second run applies nothing and yields an identical after-report', async () => {
        const root = path.join(tmpHome, 'repo2');
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));

        const { runInitSteps } = require('../../../src/core/init/orchestrator');
        const out1 = await runInitSteps(buildDeps(root));
        expect(out1.applied).toBeGreaterThan(0);

        // segundo run: re-gather refleja el estado ya materializado
        const out2 = await runInitSteps(buildDeps(root));
        expect(out2.applied).toBe(0);
        expect(out2.after).toEqual(out1.after);
    });
});
