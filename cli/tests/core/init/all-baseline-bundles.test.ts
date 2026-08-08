// `awm init` and `awm update` disagreed about what "the baseline" is.
//
//   init   (steps.ts)          bundles.find(b => b.scope === 'baseline')     ← the FIRST one
//   update (reconciliation.ts) bundles.filter(b => b.scope === 'baseline' …) ← all of them
//
// A registry shipping two baseline bundles therefore installed one on `awm init` and
// two on the next `awm update` — and the diagnostic that decides whether the baseline
// is satisfied used `find` too, so it agreed with init and disagreed with update. The
// second bundle appeared out of nowhere on an unrelated command, and nothing before
// that had reported it missing.
//
// `filter` is the correct reading: `scope: 'baseline'` is a property a bundle HAS, not
// a slot only one bundle can occupy.
import { stepDevCore } from '../../../src/core/init/steps';
import type { InitDeps } from '../../../src/core/init/types';
import type { BundleDefinition } from '../../../src/core/bundles';

function bundle(name: string, scope: string): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: [], workflows: [], agents: [], source: `bundles/${name}`,
    } as unknown as BundleDefinition;
}

function deps(bundles: BundleDefinition[]): { d: InitDeps; installs: string[] } {
    const installs: string[] = [];
    const d = {
        cwd: '/repo',
        agent: 'claude-code',
        enabledAgents: ['claude-code'],
        bundles,
        installMethod: 'symlink',
        registryRoot: '',
        contentDir: '',
        sensorPacksRoot: '',
        ctx: {
            machine: { devCore: { present: false, brokenLinks: [] } },
            project: null,
        },
        actions: { installBundle: (o: { bundleName: string }) => { installs.push(o.bundleName); } },
    } as unknown as InitDeps;
    return { d, installs };
}

describe('awm init installs every baseline bundle, like awm update reconciles every one', () => {
    it('installs all of them, not just the first', () => {
        const { d, installs } = deps([
            bundle('dev-core', 'baseline'),
            bundle('team-baseline', 'baseline'),
            bundle('frontend', 'project'),
        ]);

        const result = stepDevCore(d);

        expect(installs).toEqual(['dev-core', 'team-baseline']);
        expect(result.action).toBe('applied');
    });

    it('installs nothing from a non-baseline scope', () => {
        const { d, installs } = deps([bundle('dev-core', 'baseline'), bundle('extras', 'ambient')]);

        stepDevCore(d);

        expect(installs).toEqual(['dev-core']);
    });

    it('still skips entirely when the baseline is already satisfied', () => {
        const { d, installs } = deps([bundle('dev-core', 'baseline'), bundle('team-baseline', 'baseline')]);
        (d.ctx.machine as { devCore: { present: boolean } }).devCore.present = true;

        expect(stepDevCore(d).action).toBe('skipped');
        expect(installs).toEqual([]);
    });
});
