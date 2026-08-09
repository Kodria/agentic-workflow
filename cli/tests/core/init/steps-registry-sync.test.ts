// stepCache vs. syncRegistries()'s RESULT-shaped failures.
//
// `syncRegistries()` never throws on a per-registry failure — it returns
// `{ action: 'error', error }` for that registry and keeps going. stepCache
// used to `await` it and report a blanket 'applied', so a registry that never
// landed on disk degraded silently into some later step's failure with its own
// cause already gone.
//
// Isolated in its own file (not steps.test.ts) because these assertions reach
// `listRegistries()`, which resolves AWM_HOME at module require time — the env
// override therefore has to happen before the module is required, which means
// `jest.resetModules()` + `require`, not a static import.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { InitDeps, InitActions, StepResult } from '../../../src/core/init/types';
import type { HarnessContext } from '../../../src/core/diagnostics/types';
import type { RegistrySyncResult } from '../../../src/core/registries';

describe('stepCache — registry sync error results', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stepcache-'));
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

    const awmHome = () => process.env.AWM_HOME as string;

    /** Declares `names` in registries.json; creates a content root only for `withContent`. */
    function configureRegistries(names: string[], withContent: string[]): void {
        fs.mkdirSync(awmHome(), { recursive: true });
        fs.writeFileSync(
            path.join(awmHome(), 'registries.json'),
            JSON.stringify(names.map((name) => ({ name, remote: `https://example.com/${name}.git` })), null, 2),
        );
        for (const name of withContent) {
            const skills = path.join(awmHome(), 'registries', name, 'skills');
            fs.mkdirSync(skills, { recursive: true });
            fs.writeFileSync(path.join(skills, 'placeholder.md'), '# placeholder\n');
        }
    }

    /** InitDeps just complete enough for stepCache: a machine with no registry cache yet. */
    function deps(results: RegistrySyncResult[]): InitDeps {
        const ctx: HarnessContext = {
            machine: {
                registryCache: { present: false },
                hook: { present: true, degraded: false, applicable: true },
                devCore: { present: true, brokenLinks: [] },
                ambient: { wanted: [], installed: [] },
                contextInjection: [],
                globalSkills: { valid: [], repairable: [], dead: [], usurped: [] },
            },
            project: null,
        };
        const actions = { syncCache: async () => results } as unknown as InitActions;
        return {
            cwd: tmpHome, ctx, bundles: [], agent: 'claude-code', enabledAgents: ['claude-code'],
            installMethod: 'symlink', registryRoot: '', contentDir: '', sensorPacksRoot: '',
            confirmExtensions: async (p: string[]) => p, actions,
        };
    }

    async function run(results: RegistrySyncResult[]): Promise<StepResult> {
        const { stepCache } = require('../../../src/core/init/steps');
        return stepCache(deps(results));
    }

    it('fails, naming the registry, when a sync error left no content on disk', async () => {
        configureRegistries(['baseline'], []);
        const r = await run([{ name: 'baseline', action: 'error', error: 'could not clone' }]);
        expect(r.action).toBe('failed');
        expect(r.error).toContain('baseline');
        expect(r.error).toContain('could not clone');
    });

    it('stays applied but records the error when content is already on disk', async () => {
        configureRegistries(['baseline'], ['baseline']);
        const r = await run([{ name: 'baseline', action: 'error', error: 'pull timed out' }]);
        expect(r.action).toBe('applied');
        expect(r.detail).toContain('baseline');
        expect(r.detail).toContain('pull timed out');
    });

    it('fails on a secondary registry that never landed, even when the base one synced', async () => {
        configureRegistries(['baseline', 'documentation'], ['baseline']);
        const r = await run([
            { name: 'baseline', action: 'pulled', version: 'v1.0.0' },
            { name: 'documentation', action: 'error', error: 'host unreachable' },
        ]);
        expect(r.action).toBe('failed');
        expect(r.error).toContain('documentation');
        expect(r.error).not.toContain('baseline');
    });

    it('reports applied with no detail when every registry synced', async () => {
        configureRegistries(['baseline'], ['baseline']);
        const r = await run([{ name: 'baseline', action: 'pulled', version: 'v1.0.0' }]);
        expect(r.action).toBe('applied');
        expect(r.detail).toBeUndefined();
    });
});
