// tests/commands/multi-agent-targeting.test.ts
//
// R12/R13/R14: `add`, `remove`, `sync`, `update` and `doctor` must all resolve
// agent targets the same way — every enabled agent when `--agent` is absent,
// an explicit comma-separated subset when present — and `add` must refuse a
// selection that would strand a shared artifact target (R14).
//
// Each command exposes (or is wired to) a UI-free core that this file drives
// directly, injecting spies where the command has a real side effect
// (installBundle / syncProfile / planReconciliation) so the test observes
// exactly which agent targets that side effect received, without touching
// real registry content or the network.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentTarget } from '../../src/providers';
import type { AwmPreferences } from '../../src/utils/config';
import type { BundleDefinition } from '../../src/core/bundles';

describe('multi-agent targeting (add/remove/sync/update/doctor)', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-targeting-'));
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

    function writePrefs(enabledAgents: AgentTarget[], defaultAgent: AgentTarget = enabledAgents[0]): AwmPreferences {
        const { savePreferences } = require('../../src/utils/config');
        const prefs: AwmPreferences = {
            defaultAgent,
            enabledAgents,
            installMethod: 'symlink',
            defaultScope: 'local',
        };
        savePreferences(prefs);
        return prefs;
    }

    function bundle(over: Partial<BundleDefinition> = {}): BundleDefinition {
        return {
            name: 'demo', description: '', version: '1.0.0', scope: 'baseline', visibility: 'public',
            dependsOn: [], skills: [{ name: 'demo-skill', onSignal: false }], workflows: [], agents: [],
            ...over,
        };
    }

    async function invokeCommandWithPlannerSpy(
        command: 'add' | 'remove' | 'sync' | 'update' | 'doctor',
        explicit: string | undefined,
    ): Promise<{ selectedAgents: AgentTarget[]; code?: number }> {
        const prefs = writePrefs(['claude-code', 'opencode', 'codex'], 'claude-code');

        switch (command) {
            case 'add': {
                const { runAddBundleCore } = require('../../src/commands/add');
                let captured: AgentTarget[] = [];
                const outcome = runAddBundleCore(
                    { name: 'demo', agent: explicit, cwd: tmpHome },
                    prefs,
                    [bundle()],
                    { addBundle: (o: any) => { captured = o.agents; return { installed: [], skipped: [], recordedExtension: null, transactionId: 'tx', modifiedFiles: [] }; } },
                );
                return { selectedAgents: captured, code: outcome.code };
            }
            case 'remove': {
                // remove has no bundle-name concept — it resolves targets the same
                // way as the other 4 commands (index.ts calls resolveAgentTargets
                // directly), so this exercises that exact function.
                const { resolveAgentTargets } = require('../../src/core/agent-targets');
                const selectedAgents = resolveAgentTargets({ prefs, explicit });
                return { selectedAgents };
            }
            case 'sync': {
                const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sync-project-'));
                fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
                fs.writeFileSync(path.join(projectRoot, '.awm', 'profile.json'), JSON.stringify({ extensions: ['demo'] }));
                const { runSyncCore } = require('../../src/commands/sync');
                let captured: AgentTarget[] = [];
                const outcome = await runSyncCore(
                    { cwd: projectRoot, agent: explicit },
                    {
                        syncRegistries: async () => [],
                        verifyMinCliVersions: () => [],
                        verifyProjectPins: async () => [],
                        syncProfile: (o: any) => { captured = o.agents; return { installed: [], skipped: [], extensions: ['demo'], transactionIds: [], modifiedFiles: [] }; },
                    },
                );
                fs.rmSync(projectRoot, { recursive: true, force: true });
                return { selectedAgents: captured, code: outcome.code };
            }
            case 'update': {
                const { runUpdateCore } = require('../../src/commands/update');
                let captured: AgentTarget[] = [];
                const outcome = await runUpdateCore(
                    { agent: explicit },
                    {
                        syncRegistries: async () => [],
                        verifyMinCliVersions: () => [],
                        regenerateGlobalContext: () => [],
                        planReconciliation: (o: any) => { captured = o.targets; return { operations: [], records: [], reports: [] }; },
                        applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }),
                        resyncInstalledHooks: () => [],
                        offerSelfUpdate: async () => {},
                    },
                );
                return { selectedAgents: captured, code: outcome.code };
            }
            case 'doctor': {
                const { runDoctor } = require('../../src/commands/doctor');
                let captured: AgentTarget[] = [];
                const { resolveAgentTargets } = require('../../src/core/agent-targets');
                const code = runDoctor({
                    cwd: tmpHome,
                    agent: explicit,
                    resolveTargets: (input: any) => {
                        const resolved = resolveAgentTargets(input);
                        captured = resolved;
                        return resolved;
                    },
                });
                return { selectedAgents: captured, code };
            }
        }
    }

    it.each(['add', 'remove', 'sync', 'update', 'doctor'] as const)(
        '%s targets all enabled providers when --agent is absent',
        async (command) => {
            const observed = await invokeCommandWithPlannerSpy(command, undefined);
            expect(observed.selectedAgents).toEqual(['claude-code', 'opencode', 'codex']); // verifies R12
        },
    );

    it.each(['add', 'remove', 'sync', 'update', 'doctor'] as const)(
        '%s honors an independently addressable explicit subset',
        async (command) => {
            const observed = await invokeCommandWithPlannerSpy(command, 'codex,claude-code');
            expect(observed.selectedAgents).toEqual(['codex', 'claude-code']); // verifies R13
        },
    );

    // -----------------------------------------------------------------------
    // R14 — shared-target completeness
    // -----------------------------------------------------------------------

    it('add refuses a codex-only skill install when OpenCode (sharing the same skill dir) is also enabled', () => {
        writePrefs(['opencode', 'codex'], 'opencode');
        const { runAddBundleCore } = require('../../src/commands/add');
        const { getPreferences } = require('../../src/utils/config');
        const outcome = runAddBundleCore(
            { name: 'demo', agent: 'codex', cwd: tmpHome },
            getPreferences(),
            [bundle()],
        );
        expect(outcome.code).toBe(1); // verifies R14 — planInstall's assertCompleteSharedGroup rejects the partial selection
    });

    // remove does NOT reproduce add's shared-target refusal by design: R16
    // says a shared target is *retained* (not deleted, not errored) as long
    // as another enabled owner remains. Selecting only 'codex' to remove a
    // skill OpenCode still owns must succeed and leave the shared symlink in
    // place — documented here since the plan text's "add/remove both fail"
    // phrasing doesn't hold for remove once R16 is taken into account (see
    // install-planner.ts's planRemoval, which has no assertCompleteSharedGroup
    // equivalent, unlike planInstall).
    it('remove retains (does not error on) a shared skill target still owned by another enabled agent', () => {
        const { planRemoval } = require('../../src/core/install-planner');
        const shared = {
            name: 'demo-skill', type: 'skill' as const, scope: 'global' as const,
            targetPath: '/home/x/.agents/skills/demo-skill', sourcePath: '/registry/skills/demo-skill',
            renderer: 'link' as const, owners: ['opencode', 'codex'] as AgentTarget[],
        };
        const plan = planRemoval({
            records: [shared],
            selectedAgents: ['codex'],
            enabledAgents: ['opencode', 'codex'],
            artifactNames: ['demo-skill'],
        });
        expect(plan.operations).toEqual([]); // no unlink — still owned by opencode
        expect(plan.records).toEqual([{ ...shared, owners: ['opencode'] }]);
    });

    // -----------------------------------------------------------------------
    // update: syncs each registry once, then reconciles the full target set once
    // -----------------------------------------------------------------------

    it('update syncs registries once and reconciles the resolved targets in a single plan/apply pass', async () => {
        writePrefs(['claude-code', 'opencode', 'codex'], 'claude-code');
        // Seed a hooks/ dir so capabilityRoot('hooks') resolves and the hook-resync stage actually runs.
        const contentRoot = path.join(process.env.AWM_HOME as string, 'registries', 'baseline');
        fs.mkdirSync(path.join(contentRoot, 'hooks'), { recursive: true });
        fs.writeFileSync(
            path.join(process.env.AWM_HOME as string, 'registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.com/baseline.git' }], null, 2),
        );
        const { runUpdateCore } = require('../../src/commands/update');

        const syncRegistries = jest.fn(async () => []);
        const planReconciliation = jest.fn((o: any) => ({ operations: [], records: [], reports: [] }));
        const applyInstallPlan = jest.fn(() => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }));
        const resyncInstalledHooks = jest.fn(() => []);

        const outcome = await runUpdateCore({}, {
            syncRegistries,
            verifyMinCliVersions: () => [],
            regenerateGlobalContext: () => [],
            planReconciliation,
            applyInstallPlan,
            resyncInstalledHooks,
            offerSelfUpdate: async () => {},
        });

        expect(outcome.code).toBe(0);
        expect(syncRegistries).toHaveBeenCalledTimes(1);
        expect(planReconciliation).toHaveBeenCalledTimes(1);
        expect(applyInstallPlan).toHaveBeenCalledTimes(1);
        expect(planReconciliation.mock.calls[0][0].targets).toEqual(['claude-code', 'opencode', 'codex']);
        expect(resyncInstalledHooks).toHaveBeenCalledTimes(1); // once per update run, not once per provider
    });

    it('update reports the failing stage and returns a non-zero exit code instead of swallowing the error', async () => {
        writePrefs(['claude-code'], 'claude-code');
        const { runUpdateCore } = require('../../src/commands/update');
        const outcome = await runUpdateCore({}, {
            syncRegistries: async () => [],
            verifyMinCliVersions: () => [],
            regenerateGlobalContext: () => [],
            planReconciliation: () => { throw new Error('reconciliation exploded'); },
            applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }),
            resyncInstalledHooks: () => [],
            offerSelfUpdate: async () => {},
        });
        expect(outcome.code).toBe(1); // no silent catch{} — verifies Step 6's "no aborta" removal
    });

    // Finding #3 (R7 QA): `noteWindowsCaveat` used to be called only from the
    // raw Commander `.action()` closures in `index.ts` (update.ts:441,
    // sync.ts:453 pre-fix) — call sites no test exercised, since `update`/
    // `sync` are always driven here via `runUpdateCore`/`runSyncCore`
    // directly. It now lives at the top of those core functions themselves,
    // firing at most once per run, native Windows only.
    describe('Windows caveat (noteWindowsCaveat) — update & sync', () => {
        const realPlatform = process.platform;
        let logSpy: jest.SpyInstance;

        beforeEach(() => {
            logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        });
        afterEach(() => {
            logSpy.mockRestore();
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        });

        function caveatCalls(): unknown[][] {
            return logSpy.mock.calls.filter((c) => /awm watch/i.test(String(c[0])));
        }

        it('update logs the caveat exactly once on native Windows, never on Linux', async () => {
            writePrefs(['claude-code']);
            const { runUpdateCore } = require('../../src/commands/update');
            const deps = {
                syncRegistries: async () => [],
                verifyMinCliVersions: () => [],
                regenerateGlobalContext: () => [],
                planReconciliation: () => ({ operations: [], records: [], reports: [] }),
                applyInstallPlan: () => ({ installed: [], skipped: [], transactionId: 'tx', modifiedFiles: [] }),
                resyncInstalledHooks: () => [],
                offerSelfUpdate: async () => {},
            };

            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            await runUpdateCore({}, deps);
            expect(caveatCalls()).toHaveLength(1);

            logSpy.mockClear();
            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
            await runUpdateCore({}, deps);
            expect(caveatCalls()).toHaveLength(0);
        });

        it('sync logs the caveat exactly once on native Windows, never on Linux', async () => {
            writePrefs(['claude-code']);
            const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sync-project-'));
            fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(projectRoot, '.awm', 'profile.json'), JSON.stringify({ extensions: [] }));
            const { runSyncCore } = require('../../src/commands/sync');
            const deps = {
                syncRegistries: async () => [],
                verifyMinCliVersions: () => [],
                verifyProjectPins: async () => [],
                syncProfile: () => ({ installed: [], skipped: [], extensions: [], transactionIds: [], modifiedFiles: [] }),
            };

            try {
                Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
                await runSyncCore({ cwd: projectRoot }, deps);
                expect(caveatCalls()).toHaveLength(1);

                logSpy.mockClear();
                Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
                await runSyncCore({ cwd: projectRoot }, deps);
                expect(caveatCalls()).toHaveLength(0);
            } finally {
                fs.rmSync(projectRoot, { recursive: true, force: true });
            }
        });
    });

    it('sync reports a syncProfile failure and returns a non-zero exit code instead of crashing uncaught', async () => {
        writePrefs(['claude-code'], 'claude-code');
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sync-project-'));
        fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, '.awm', 'profile.json'), JSON.stringify({ extensions: ['demo'] }));
        const { runSyncCore } = require('../../src/commands/sync');

        let outcome;
        try {
            outcome = await runSyncCore(
                { cwd: projectRoot },
                {
                    syncRegistries: async () => [],
                    verifyMinCliVersions: () => [],
                    verifyProjectPins: async () => [],
                    syncProfile: () => { throw new Error('physical target already claimed by a different source'); },
                },
            );
        } finally {
            fs.rmSync(projectRoot, { recursive: true, force: true });
        }

        expect(outcome.code).toBe(1); // no silent catch{} — syncProfile's throw must not propagate uncaught
    });
});
