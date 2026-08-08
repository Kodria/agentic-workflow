// tests/core/reconciliation.test.ts
//
// Exercises the REAL planReconciliation (no mocks) end-to-end: seeds a real
// registry content root with a baseline bundle, an ambient bundle, and a
// project-scope bundle, then verifies the computed plan only reconciles the
// machine-scope (baseline + ambient) artifacts — and, applied via the real
// applyInstallPlan, actually fixes both a MISSING target and a STALE target.
import fs from 'fs';
import os from 'os';
import path from 'path';

function writeBundle(
    contentRoot: string,
    name: string,
    scope: 'baseline' | 'ambient' | 'project',
    skills: string[],
    dependsOn: unknown = [],
): void {
    fs.mkdirSync(path.join(contentRoot, 'bundles', name), { recursive: true });
    fs.writeFileSync(
        path.join(contentRoot, 'bundles', name, 'bundle.json'),
        JSON.stringify({
            name, version: '1.0.0', scope, dependsOn,
            skills: skills.map((s) => ({ name: s })), workflows: [], agents: [],
        }),
    );
    for (const skill of skills) {
        fs.mkdirSync(path.join(contentRoot, 'skills', skill), { recursive: true });
        fs.writeFileSync(path.join(contentRoot, 'skills', skill, 'SKILL.md'), `# ${skill}`);
    }
}

function addToCatalog(
    contentRoot: string,
    name: string,
    scope: 'baseline' | 'ambient' | 'project',
): void {
    const catalogFile = path.join(contentRoot, 'catalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf-8'));
    catalog.bundles.push({ name, source: `./bundles/${name}`, version: '1.0.0', scope });
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
}

describe('planReconciliation (real, unmocked)', () => {
    let tmpHome: string;
    let contentRoot: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reconcile-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();

        contentRoot = path.join(tmpHome, 'registry');
        fs.mkdirSync(contentRoot, { recursive: true });
        fs.writeFileSync(path.join(contentRoot, 'catalog.json'), JSON.stringify({
            version: 1,
            bundles: [
                { name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' },
                { name: 'ambient-x', source: './bundles/ambient-x', version: '1.0.0', scope: 'ambient' },
                { name: 'proj-y', source: './bundles/proj-y', version: '1.0.0', scope: 'project' },
            ],
        }));
        writeBundle(contentRoot, 'dev', 'baseline', ['brainstorming']);
        writeBundle(contentRoot, 'ambient-x', 'ambient', ['ambient-skill']);
        writeBundle(contentRoot, 'proj-y', 'project', ['proj-skill']);
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('plans only the machine-scope (baseline + ambient) artifacts, excluding project-scope bundles', () => {
        const { planReconciliation } = require('../../src/core/reconciliation');
        const plan = planReconciliation({ targets: ['claude-code'], roots: [contentRoot] });

        const names = plan.operations.map((op: any) => op.name).sort();
        expect(names).toEqual(['ambient-skill', 'brainstorming']); // proj-skill excluded (R — project bundles are `awm sync`'s job, not `awm update`'s)

        const claudeSkillsDir = path.join(tmpHome, '.claude', 'skills');
        const targets = plan.operations.map((op: any) => op.targetPath).sort();
        expect(targets).toEqual([
            path.join(claudeSkillsDir, 'ambient-skill'),
            path.join(claudeSkillsDir, 'brainstorming'),
        ]);
    });

    it('reconciles drift end-to-end when applied: installs a MISSING target and replaces a STALE one', () => {
        const claudeSkillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(claudeSkillsDir, { recursive: true });

        // Drift scenario 1 — stale: 'brainstorming' exists but as a plain file
        // with the wrong content (as if it were copied once and the registry
        // has since diverged), not a symlink to the registry source.
        fs.writeFileSync(path.join(claudeSkillsDir, 'brainstorming'), 'stale, wrong content');

        // Drift scenario 2 — missing: 'ambient-skill' was never installed at all.
        expect(fs.existsSync(path.join(claudeSkillsDir, 'ambient-skill'))).toBe(false);

        const { planReconciliation } = require('../../src/core/reconciliation');
        const { applyInstallPlan } = require('../../src/core/install-transaction');

        const plan = planReconciliation({ targets: ['claude-code'], roots: [contentRoot] });
        const summary = applyInstallPlan(plan);

        expect(summary.installed.sort()).toEqual([
            'ambient-skill → claude-code',
            'brainstorming → claude-code',
        ]);

        // Stale target is now a real symlink to the registry source, not the old file.
        const brainstormingStat = fs.lstatSync(path.join(claudeSkillsDir, 'brainstorming'));
        expect(brainstormingStat.isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(path.join(claudeSkillsDir, 'brainstorming')))
            .toBe(fs.realpathSync(path.join(contentRoot, 'skills', 'brainstorming')));

        // Missing target now exists as a symlink too.
        const ambientStat = fs.lstatSync(path.join(claudeSkillsDir, 'ambient-skill'));
        expect(ambientStat.isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(path.join(claudeSkillsDir, 'ambient-skill')))
            .toBe(fs.realpathSync(path.join(contentRoot, 'skills', 'ambient-skill')));
    });

    it('scopes to the selected agent target only', () => {
        const { planReconciliation } = require('../../src/core/reconciliation');
        const plan = planReconciliation({ targets: ['opencode'], roots: [contentRoot] });
        const owners = new Set(plan.operations.flatMap((op: any) => op.owners));
        expect(owners).toEqual(new Set(['opencode']));
    });

    // NOTE on the two tests below: `resolveBundleClosure` (bundles.ts) already
    // treats a `dependsOn` entry naming a bundle that isn't in the catalog as
    // silently absent from the closure — it does NOT throw (verified directly:
    // a baseline bundle with `dependsOn: ['does-not-exist']` resolves its own
    // artifacts fine; the ghost name is just dropped). So a plain dangling
    // `dependsOn` string never reaches `planReconciliation`'s
    // `try { expandBundleArtifacts(...) } catch { continue; }` guard at all —
    // the first test below confirms that directly. To actually force the catch
    // branch (and check it skips only the one broken bundle, not the whole
    // batch, and doesn't silently eat some other bug), the second test injects
    // a bundle whose `dependsOn` field is malformed in a way that genuinely
    // breaks closure resolution (`dependsOn` is not an array, so
    // `resolveBundleClosure`'s `for (const dep of b.dependsOn)` throws) —
    // mirroring the kind of real, unresolvable-closure error the catch is
    // meant to guard against.

    it('tolerates a plain dangling dependsOn reference without needing the catch — the bundle installs normally', () => {
        writeBundle(contentRoot, 'dangling-dep', 'baseline', ['dangling-skill'], ['does-not-exist']);
        addToCatalog(contentRoot, 'dangling-dep', 'baseline');

        const { planReconciliation } = require('../../src/core/reconciliation');
        const plan = planReconciliation({ targets: ['claude-code'], roots: [contentRoot] });

        const names = plan.operations.map((op: any) => op.name).sort();
        // 'dangling-skill' installs fine even though its bundle's dependsOn
        // points nowhere — resolveBundleClosure just drops the missing dep.
        expect(names).toEqual(['ambient-skill', 'brainstorming', 'dangling-skill']);
    });

    it('un dependsOn malformado ya no rompe nada: el campo invalido se ignora y el bundle instala', () => {
        // Este test asertaba que un `dependsOn` no-array hacia TIRAR a
        // `resolveBundleClosure` y que reconciliation lo salteaba. Desde que
        // `discoverBundles` valida forma sobre el contenido del registry (que es
        // input no confiable), ese campo se normaliza a `[]` en vez de
        // propagarse hasta un `for...of` sobre un numero. O sea: la entrada ya
        // no falla, y el bundle instala normalmente ignorando el campo roto.
        //
        // Es una mejora, no una regresion — antes UN archivo malformado en
        // cualquier registry tumbaba `awm list`/`awm add` con un stack trace
        // crudo. El `catch` de reconciliation sigue en su lugar como defensa en
        // profundidad, pero esta entrada ya no lo ejercita.
        writeBundle(contentRoot, 'broken', 'baseline', ['broken-skill'], 5);
        addToCatalog(contentRoot, 'broken', 'baseline');

        const { planReconciliation } = require('../../src/core/reconciliation');

        let plan: any;
        expect(() => {
            plan = planReconciliation({ targets: ['claude-code'], roots: [contentRoot] });
        }).not.toThrow();

        const names = plan.operations.map((op: any) => op.name).sort();
        // Los bundles sanos siguen reconciliando, y el que tenia el campo roto
        // tambien — sin su dependencia invalida.
        expect(names).toEqual(['ambient-skill', 'brainstorming', 'broken-skill']);
    });

});
