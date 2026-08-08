// `awm sync` over a profile with N extensions ran N independent transactions —
// one `planInstall` + `applyInstallPlan` per extension, in a loop. Each is atomic on
// its own, none is atomic with the others, so a failure on extension 3 left 1 and 2
// installed and the tree in a state that matched neither before nor after:
//
//     extensions: [a, b, c]
//     a → tx-1  committed
//     b → tx-2  committed
//     c → throws           ← a and b stay installed, sync exits non-zero
//
// And the transaction IDs — the only handle `awm backup restore` accepts — were
// collected into `transactionIds` and then never printed by any caller, so even the
// committed halves could not be named to undo them by hand.
//
// One plan for the whole sync. `planInstall` already dedups by physical target across
// artifacts, so combining the extensions loses nothing; and `applyInstallPlan` already
// rolls its own plan back on any failure, so combining is what makes the sync atomic.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { syncProfile } from '../../src/core/bundle-install';
import type { InstallPlan } from '../../src/core/install-planner';
import type { InstallSummary } from '../../src/core/install-transaction';
import type { BundleDefinition } from '../../src/core/bundles';

function bundle(name: string, skills: string[], contentRoot: string): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope: 'project', visibility: 'public',
        dependsOn: [], skills: skills.map(n => ({ name: n })), workflows: [], agents: [],
        source: `bundles/${name}`, contentRoot,
    } as unknown as BundleDefinition;
}

describe('awm sync is one transaction, not one per extension', () => {
    let projectRoot: string;
    let contentDir: string;
    let home: string;
    let saved: { HOME?: string; AWM_HOME?: string };
    let bundles: BundleDefinition[];

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-atomic-home-'));
        saved = { HOME: process.env.HOME, AWM_HOME: process.env.AWM_HOME };
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        fs.mkdirSync(path.join(home, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(home, '.awm', 'preferences.json'), JSON.stringify({
            enabledAgents: ['claude-code'], defaultAgent: 'claude-code',
            installMethod: 'symlink', defaultScope: 'global',
        }));

        contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-atomic-content-'));
        for (const s of ['skill-a', 'skill-b', 'skill-c']) {
            fs.mkdirSync(path.join(contentDir, 'skills', s), { recursive: true });
            fs.writeFileSync(path.join(contentDir, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: d\n---\n`);
        }
        bundles = [
            bundle('ext-a', ['skill-a'], contentDir),
            bundle('ext-b', ['skill-b'], contentDir),
            bundle('ext-c', ['skill-c'], contentDir),
        ];

        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-atomic-proj-'));
        fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(projectRoot, '.awm', 'profile.json'),
            JSON.stringify({ extensions: ['ext-a', 'ext-b', 'ext-c'] }),
        );
    });

    afterEach(() => {
        if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
        if (saved.AWM_HOME === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = saved.AWM_HOME;
        for (const d of [home, contentDir, projectRoot]) fs.rmSync(d, { recursive: true, force: true });
    });

    const run = (applyPlan: (p: InstallPlan) => InstallSummary) =>
        syncProfile({ projectRoot, bundles, agents: ['claude-code'], method: 'symlink', contentDir, applyPlan });

    it('applies a single plan covering every extension', () => {
        const plans: InstallPlan[] = [];
        const result = run((plan) => {
            plans.push(plan);
            return { installed: plan.operations.map(o => o.targetPath), skipped: [], transactionId: 'tx-1', modifiedFiles: [] };
        });

        expect(plans).toHaveLength(1);
        const names = plans[0].operations.map(o => path.basename(o.targetPath)).sort();
        expect(names).toEqual(['skill-a', 'skill-b', 'skill-c']);
        expect(result.transactionIds).toEqual(['tx-1']);
    });

    it('installs nothing at all when the apply fails — no half-synced tree', () => {
        // The failure is on the LAST extension on purpose: with one transaction per
        // extension, ext-a and ext-b were already committed by the time ext-c blew up.
        const committed: string[] = [];
        expect(() => run((plan) => {
            const names = plan.operations.map(o => path.basename(o.targetPath));
            if (names.includes('skill-c')) throw new Error('verification failed');
            committed.push(...names);
            return { installed: names, skipped: [], transactionId: `tx-${committed.length}`, modifiedFiles: [] };
        })).toThrow(/verification failed/);

        expect(committed).toEqual([]);
    });

    it('skips unknown extensions without splitting the transaction', () => {
        fs.writeFileSync(
            path.join(projectRoot, '.awm', 'profile.json'),
            JSON.stringify({ extensions: ['ext-a', 'ghost', 'ext-c'] }),
        );
        const plans: InstallPlan[] = [];
        const result = run((plan) => {
            plans.push(plan);
            return { installed: [], skipped: [], transactionId: 'tx-1', modifiedFiles: [] };
        });

        expect(plans).toHaveLength(1);
        expect(plans[0].operations.map(o => path.basename(o.targetPath)).sort()).toEqual(['skill-a', 'skill-c']);
        expect(result.skipped.some(s => s.includes('ghost'))).toBe(true);
    });

    it('does not apply anything when every extension is unknown', () => {
        fs.writeFileSync(
            path.join(projectRoot, '.awm', 'profile.json'),
            JSON.stringify({ extensions: ['ghost'] }),
        );
        let applyCalls = 0;
        const result = run(() => {
            applyCalls++;
            return { installed: [], skipped: [], transactionId: 'tx-1', modifiedFiles: [] };
        });

        expect(applyCalls).toBe(0);
        expect(result.transactionIds).toEqual([]);
    });
});
