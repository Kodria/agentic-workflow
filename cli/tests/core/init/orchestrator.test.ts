import fs from 'fs';
import os from 'os';
import path from 'path';

// Siembra un registry baseline mínimo en <contentRoot> (= ~/.awm/registries/baseline).
// El content root ES la raíz del registry — no hay subdir "registry/" en la nueva arquitectura.
function seedRegistry(contentRoot: string) {
    fs.mkdirSync(path.join(contentRoot, 'skills', 'brainstorming'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, 'skills', 'brainstorming', 'SKILL.md'), '# brainstorming');
    fs.mkdirSync(path.join(contentRoot, 'skills', 'using-awm'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, 'skills', 'using-awm', 'SKILL.md'), '# using-awm');
    fs.mkdirSync(path.join(contentRoot, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, 'hooks', 'session-start'), '#!/bin/sh\n');
    fs.chmodSync(path.join(contentRoot, 'hooks', 'session-start'), 0o755);
    fs.writeFileSync(path.join(contentRoot, 'hooks', 'run-hook.cmd'), '#!/bin/sh\n');
    fs.chmodSync(path.join(contentRoot, 'hooks', 'run-hook.cmd'), 0o755);
    fs.mkdirSync(path.join(contentRoot, 'sensor-packs', 'js-ts'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, 'sensor-packs', 'js-ts', 'pack.json'),
        JSON.stringify({ sensors: { lint: { defaultCmd: 'eslint {{SOURCE_DIRS}}', fast: true } } }));
    // catalog + bundle dev (baseline)
    fs.writeFileSync(path.join(contentRoot, 'catalog.json'), JSON.stringify({
        version: 1, bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.mkdirSync(path.join(contentRoot, 'bundles', 'dev'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, 'bundles', 'dev', 'bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: [{ name: 'brainstorming' }, { name: 'using-awm' }], workflows: [], agents: [],
    }));

    // Seed .git in the content root so gatherMachine.registryCache.present is true.
    fs.mkdirSync(path.join(contentRoot, '.git'), { recursive: true });
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
        const { discoverAllBundles } = require('../../../src/core/bundles');
        const { REGISTRY_DIR } = require('../../../src/core/registry');
        const { contentRoots, REGISTRIES_DIR } = require('../../../src/core/registries');
        const { defaultActions } = require('../../../src/core/init/steps');

        // Seed content at ~/.awm/registries/baseline (content root IS the registry root).
        const contentRoot = path.join(process.env.AWM_HOME!, 'registries', 'baseline');
        fs.mkdirSync(contentRoot, { recursive: true });
        seedRegistry(contentRoot);

        // Register the baseline registry in registries.json so contentRoots() picks it up.
        const registriesJson = path.join(process.env.AWM_HOME!, 'registries.json');
        fs.writeFileSync(registriesJson, JSON.stringify([
            { name: 'baseline', remote: 'https://example.com/baseline.git' },
        ], null, 2));

        const roots = contentRoots();
        const bundles = discoverAllBundles(roots);
        const contentDir = roots[0] ?? '';
        const ctx = gatherContext({ cwd, bundles });
        return {
            cwd, ctx, bundles, agent: 'claude-code', installMethod: 'symlink',
            registryRoot: REGISTRY_DIR, contentDir,
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
