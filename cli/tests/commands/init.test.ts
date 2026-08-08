import { renderInitOutcome, makeConfirmExtensions } from '../../src/commands/init';
import type { InitOutcome } from '../../src/core/init/types';
import type { CheckReport } from '../../src/core/diagnostics/types';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('makeConfirmExtensions (#1 empty-multiselect guard)', () => {
    it('returns [] for empty proposed without invoking clack (non-yes path)', async () => {
        const fn = makeConfirmExtensions(false);
        await expect(fn([], [])).resolves.toEqual([]);
    });

    it('auto-confirms all proposed in --yes mode', async () => {
        const fn = makeConfirmExtensions(true);
        await expect(fn(['frontend'], ['package.json: next'])).resolves.toEqual(['frontend']);
    });
});

function report(over: Partial<CheckReport> = {}): CheckReport {
    return {
        results: [{ id: 'machine.cli', level: 'machine', label: 'CLI v1.0.0', status: 'ok', remedy: { kind: 'none' } }],
        overall: 'degraded', hasProject: false, ...over,
    };
}

describe('renderInitOutcome', () => {
    it('renders before, actions and after blocks, reusing the doctor dashboard', () => {
        const outcome: InitOutcome = {
            steps: [
                { id: 'machine.cache', level: 'machine', action: 'applied', detail: 'cache clonado' },
                { id: 'project.constitution', level: 'project', action: 'pending', detail: 'skill: project-constitution' },
            ],
            applied: 1, pending: 1, failed: 0,
            before: report(), after: report({ overall: 'degraded' }),
        };
        const out = renderInitOutcome(outcome);
        expect(out).toContain('AWM · init');
        expect(out).toContain('Initial state');
        expect(out).toContain('Actions');
        expect(out).toContain('machine.cache');
        expect(out).toContain('skill: project-constitution');
        expect(out).toContain('Final state');
        expect(out).toContain('AWM · harness status'); // viene de renderReport
        expect(out).toContain('1 steps require an agent');
    });
});

describe('runInit', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-run-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
        writeSpy.mockRestore();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('returns exit 1 on a bare HOME and never prompts with --yes (cache stubbed)', async () => {
        const { runInit } = require('../../src/commands/init');
        const code = await runInit({
            cwd: tmpHome,
            yes: true,
            actions: { syncCache: async () => {}, installHook: () => ({ status: 'installed' }) },
        });
        expect(code).toBe(1); // cache/hook/devCore siguen ausentes (syncCache no-op) → degradado
    });

    it('--json emits a parseable InitOutcome', async () => {
        const { runInit } = require('../../src/commands/init');
        const code = await runInit({
            cwd: tmpHome,
            yes: true,
            json: true,
            actions: { syncCache: async () => {}, installHook: () => ({ status: 'installed' }) },
        });
        const written = writeSpy.mock.calls.map((c) => c[0]).join('');
        const parsed = JSON.parse(written);
        expect(Array.isArray(parsed.steps)).toBe(true);
        expect(parsed.after.overall).toBe('degraded');
        expect(parsed.result).toBe('degraded'); // success envelope is self-describing too
        expect(code).toBe(1);
    });

    const prefsFile = () => path.join(process.env.AWM_HOME as string, 'preferences.json');
    const readPreferences = () => JSON.parse(fs.readFileSync(prefsFile(), 'utf-8'));
    const readAgent = () => readPreferences().defaultAgent;
    const readPrefs = () => readPreferences();

    function writePrefs(prefs: Record<string, unknown>) {
        const { savePreferences } = require('../../src/utils/config');
        savePreferences(prefs);
    }

    /**
     * Full no-op InitActions stub set — every member records its own token
     * onto `calls` (in invocation order) and returns a benign, type-shaped
     * value so a whole `runInitSteps` pass can complete without touching real
     * registry content. Used both to keep the "does the pipeline actually
     * succeed" tests independent of real registry content, and to observe
     * call order (install-hook / install-bundle) relative to the gate/backup/
     * save-preferences sequence.
     */
    function fakeActions(calls: string[]) {
        return {
            syncCache: async () => { calls.push('syncCache'); },
            installHook: () => { calls.push('install-hook'); return { status: 'installed' }; },
            installBundle: () => { calls.push('install-bundle'); return { installed: [], skipped: [] }; },
            syncProfile: () => { calls.push('syncProfile'); return { installed: [], skipped: [], extensions: [] }; },
            initSensors: () => { calls.push('initSensors'); return { detection: { pack: 'generic' } }; },
            addExtension: () => { calls.push('addExtension'); },
            ensureProfile: () => { calls.push('ensureProfile'); },
            gatherProject: () => { calls.push('gatherProject'); return null; },
            contextStatus: () => { calls.push('contextStatus'); return 'absent' as const; },
            installContext: () => { calls.push('installContext'); },
            repairGlobalSkills: () => { calls.push('repairGlobalSkills'); return { relinked: [], pruned: [], failed: [] }; },
            injectProjectConstitution: () => { calls.push('injectProjectConstitution'); return 'injected' as const; },
        };
    }

    function codexInitOptions(calls: string[] = []) {
        return {
            cwd: tmpHome,
            yes: true,
            agent: 'codex',
            assertProviderSupported: () => ({ provider: 'codex' as const, version: '0.150.0' }),
            actions: fakeActions(calls),
        };
    }

    /** Cheap recursive content snapshot for "did this subtree change at all" assertions. */
    function snapshotTree(dir: string): unknown {
        if (!fs.existsSync(dir)) return null;
        const walk = (p: string): unknown => {
            const st = fs.lstatSync(p);
            if (st.isSymbolicLink()) return { type: 'symlink', target: fs.readlinkSync(p) };
            if (st.isDirectory()) {
                const entries = fs.readdirSync(p).sort();
                return { type: 'dir', entries: Object.fromEntries(entries.map((e) => [e, walk(path.join(p, e))])) };
            }
            return { type: 'file', content: fs.readFileSync(p, 'utf8') };
        };
        return walk(dir);
    }

    it('#7: first init (no -a) persists claude-code as the default agent', async () => {
        const { runInit } = require('../../src/commands/init');
        expect(fs.existsSync(prefsFile())).toBe(false);
        await runInit({ cwd: tmpHome, yes: true, actions: { syncCache: async () => {}, installHook: () => ({ status: 'installed' }) } });
        expect(readAgent()).toBe('claude-code');
    });

    it('#7: init -a opencode persists the explicit agent', async () => {
        const { runInit } = require('../../src/commands/init');
        const code = await runInit({
            cwd: tmpHome,
            yes: true,
            agent: 'opencode',
            actions: fakeActions([]),
        });
        expect(code).toBeLessThanOrEqual(1);
        expect(readAgent()).toBe('opencode');
        expect(readPreferences().enabledAgents).toContain('opencode');
    });

    it('#7: re-init without -a does NOT clobber an existing explicit preference', async () => {
        writePrefs({
            defaultAgent: 'opencode',
            enabledAgents: ['opencode'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });
        const { runInit } = require('../../src/commands/init');
        await runInit({ cwd: tmpHome, yes: true, actions: { syncCache: async () => {}, installHook: () => ({ status: 'installed' }) } });
        expect(readAgent()).toBe('opencode');
    });

    it('enabling a new default preserves every previously enabled agent', async () => {
        writePrefs({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code', 'codex'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });
        const { runInit } = require('../../src/commands/init');

        const code = await runInit({
            cwd: tmpHome,
            yes: true,
            agent: 'opencode',
            actions: fakeActions([]),
        });

        expect(code).toBeLessThanOrEqual(1);
        expect(readPreferences().enabledAgents)
            .toEqual(['claude-code', 'codex', 'opencode']);
    });

    // -----------------------------------------------------------------------
    // Step 1 — gate ordering, backup/rollback atomicity, Codex/Claude coexistence
    // -----------------------------------------------------------------------

    it('gates Codex before preferences or provider writes', async () => {
        const calls: string[] = [];
        const { runInit } = require('../../src/commands/init');
        const code = await runInit({
            cwd: tmpHome,
            agent: 'codex',
            yes: true,
            actions: fakeActions(calls),
            assertProviderSupported: () => {
                calls.push('version-gate');
                throw new Error('requires Codex >= 0.145.0');
            },
        });
        expect(code).toBe(2);
        expect(calls).toEqual(['version-gate']); // verifies R2
        expect(fs.existsSync(prefsFile())).toBe(false);
    });

    it('enables Codex without changing the existing default or Claude files', async () => {
        writePrefs({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code', 'opencode'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });
        const claudeBefore = snapshotTree(path.join(tmpHome, '.claude'));
        const { runInit } = require('../../src/commands/init');
        const code = await runInit(codexInitOptions());
        expect(code).toBeLessThanOrEqual(1);
        expect(readPrefs().defaultAgent).toBe('claude-code');
        expect(readPrefs().enabledAgents).toEqual(['claude-code', 'opencode', 'codex']); // verifies R11
        expect(snapshotTree(path.join(tmpHome, '.claude'))).toEqual(claudeBefore); // verifies R19
    });

    it('runs one session in order: version-gate < begin-backup < save-preferences < install-hook < install-bundle', async () => {
        const calls: string[] = [];

        const installTransaction = require('../../src/core/install-transaction');
        const realBeginBackupSession = installTransaction.beginBackupSession;
        jest.spyOn(installTransaction, 'beginBackupSession').mockImplementation((...args: unknown[]) => {
            calls.push('begin-backup');
            return realBeginBackupSession(...(args as [string[]]));
        });

        const config = require('../../src/utils/config');
        const realSavePreferences = config.savePreferences;
        jest.spyOn(config, 'savePreferences').mockImplementation((...args: unknown[]) => {
            calls.push('save-preferences');
            return realSavePreferences(...(args as [unknown]));
        });

        const { runInit } = require('../../src/commands/init');
        const code = await runInit({
            cwd: tmpHome,
            yes: true,
            actions: fakeActions(calls),
            assertProviderSupported: () => {
                calls.push('version-gate');
                return { provider: 'claude-code' as const, version: null };
            },
        });

        expect(code).toBeLessThanOrEqual(1);
        const relevant = calls.filter((c) =>
            ['version-gate', 'begin-backup', 'save-preferences', 'install-hook', 'install-bundle'].includes(c));
        expect(relevant).toEqual(['version-gate', 'begin-backup', 'save-preferences', 'install-hook', 'install-bundle']);
    });

    it('rolls back a genuinely-modified target (real hook install) when a later step fails', async () => {
        // Seed just enough real registry content for the REAL installHook to
        // succeed and actually merge an AWM entry into settings.json.
        const contentRoot = path.join(process.env.AWM_HOME as string, 'registries', 'baseline');
        fs.mkdirSync(path.join(contentRoot, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(contentRoot, 'hooks', 'session-start'), '#!/bin/sh\n', { mode: 0o755 });
        fs.writeFileSync(path.join(contentRoot, 'hooks', 'run-hook.cmd'), '#!/bin/sh\n', { mode: 0o755 });
        fs.mkdirSync(path.join(contentRoot, 'skills', 'using-awm'), { recursive: true });
        fs.writeFileSync(path.join(contentRoot, 'skills', 'using-awm', 'SKILL.md'), '# using-awm');
        fs.writeFileSync(
            path.join(process.env.AWM_HOME as string, 'registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.com/baseline.git' }], null, 2),
        );

        const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ pristine: true, unrelated: 'keep' }, null, 2));

        const calls: string[] = [];
        const actions = fakeActions(calls);
        delete (actions as Record<string, unknown>).installHook; // let the REAL installHook run and genuinely modify settings.json
        actions.installBundle = () => { throw new Error('boom'); }; // devCore step fails AFTER hook succeeded

        const { runInit } = require('../../src/commands/init');
        const code = await runInit({
            cwd: tmpHome,
            yes: true,
            actions,
        });

        expect(code).toBe(2);
        // preferences.json didn't exist before this run — rollback removes it again
        expect(fs.existsSync(prefsFile())).toBe(false);
        // settings.json WAS genuinely modified mid-run (real installHook ran) —
        // rollback must restore its exact pre-run content, not just leave it be.
        expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual({ pristine: true, unrelated: 'keep' });
    });

    // -----------------------------------------------------------------------
    // Gap A (QA panel) — GLOBAL-scope render pipeline for Cursor/Copilot was
    // only ever exercised via LOCAL-scope `awm add`/bundle-install tests
    // (tests/core/bundle-install.test.ts). This drives a real `awm init
    // --agent cursor` through the REAL installBundle/applyInstallPlan path
    // (no installBundle override — only syncCache is stubbed, to avoid a
    // real network clone) and asserts a real rendered .mdc file lands in the
    // GLOBAL ~/.cursor/rules directory with the expected frontmatter shape.
    // -----------------------------------------------------------------------

    it('Gap A — real global-scope render: awm init --agent cursor renders a real .mdc into ~/.cursor/rules', async () => {
        const contentRoot = path.join(process.env.AWM_HOME as string, 'registries', 'baseline');
        // A 'hooks' dir (even empty) is what makes capabilityRoot('hooks') resolve to
        // this content root — that's the registryRoot stepContextInjection uses to
        // find skills/using-awm/SKILL.md for the (unrelated) context-injection step.
        fs.mkdirSync(path.join(contentRoot, 'hooks'), { recursive: true });
        fs.mkdirSync(path.join(contentRoot, 'skills', 'using-awm'), { recursive: true });
        fs.writeFileSync(
            path.join(contentRoot, 'skills', 'using-awm', 'SKILL.md'),
            '---\nname: using-awm\ndescription: Use when starting any development conversation\n---\n\nMUST invoke skills per the tiered policy.\n',
        );
        fs.mkdirSync(path.join(contentRoot, 'bundles', 'dev-core'), { recursive: true });
        fs.writeFileSync(path.join(contentRoot, 'catalog.json'), JSON.stringify({
            version: 1,
            bundles: [{ name: 'dev-core', source: './bundles/dev-core', version: '1.0.0', scope: 'baseline' }],
        }));
        fs.writeFileSync(path.join(contentRoot, 'bundles', 'dev-core', 'bundle.json'), JSON.stringify({
            name: 'dev-core', version: '1.0.0', description: 'Baseline', scope: 'baseline',
            dependsOn: [], skills: ['using-awm'], workflows: [], agents: [],
        }));

        const projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-cursor-cwd-'));
        try {
            const { runInit } = require('../../src/commands/init');
            const code = await runInit({
                cwd: projectCwd,
                agent: 'cursor',
                yes: true,
                machineOnly: true,
                // seedBaselineRegistry() writes registries.json pointing at 'baseline'
                // (our manually-seeded content root above) since none exists yet — no
                // real network clone happens because that content root already exists
                // on disk. Only syncCache is stubbed, so stepCache's own sync (the
                // content root above has no `.git`, so it reads as "not yet cloned")
                // doesn't try to shell out to git either.
                actions: { syncCache: async () => {} },
            });

            expect(code).toBeLessThanOrEqual(1);

            const mdcPath = path.join(tmpHome, '.cursor', 'rules', 'using-awm.mdc');
            expect(fs.existsSync(path.join(tmpHome, '.cursor', 'rules', 'using-awm'))).toBe(false);
            expect(fs.existsSync(mdcPath)).toBe(true);
            const rendered = fs.readFileSync(mdcPath, 'utf8');
            expect(rendered).toContain('description: Use when starting any development conversation');
            expect(rendered).toContain('globs:');
            expect(rendered).toContain('alwaysApply: false');
            expect(rendered).toContain('MUST invoke skills per the tiered policy.');
        } finally {
            fs.rmSync(projectCwd, { recursive: true, force: true });
        }
    });

    // -----------------------------------------------------------------------
    // Failure evidence — `--json` must honour its contract on the ERROR path
    // -----------------------------------------------------------------------

    describe('failure evidence', () => {
        let errSpy: jest.SpyInstance;

        beforeEach(() => {
            errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });
        afterEach(() => errSpy.mockRestore());

        const stdout = () => writeSpy.mock.calls.map((c) => c[0]).join('');
        const stderr = () => errSpy.mock.calls.map((c) => c[0]).join('');

        /** InitActions whose `machine.hook` step blows up inside the step pipeline. */
        function actionsWithFailingHook() {
            const actions = fakeActions([]);
            actions.installHook = () => { throw new Error('hook boom'); };
            return actions;
        }

        it('--json emits parseable JSON carrying the failed step id and error', async () => {
            const { runInit } = require('../../src/commands/init');
            const code = await runInit({
                cwd: tmpHome,
                yes: true,
                json: true,
                actions: actionsWithFailingHook(),
            });

            expect(code).not.toBe(0);
            expect(code).toBe(2);

            const parsed = JSON.parse(stdout());
            expect(parsed.result).toBe('failed');

            const failedStep = parsed.steps.find((s: { action: string }) => s.action === 'failed');
            expect(failedStep.id).toBe('machine.hook');
            expect(failedStep.error).toBe('hook boom');
            expect(parsed.failedSteps).toEqual([failedStep]);
            expect(parsed.failed).toBe(1);

            // The top-level message names the step too — no generic "internal error".
            expect(parsed.error).toContain('machine.hook');
            expect(parsed.error).toContain('hook boom');

            // `before` is the pre-run snapshot the issue asks for.
            expect(parsed.before.results.length).toBeGreaterThan(0);
        });

        it('--json reports the transaction as not committed and rolled back', async () => {
            const { runInit } = require('../../src/commands/init');
            await runInit({ cwd: tmpHome, yes: true, json: true, actions: actionsWithFailingHook() });

            const { transaction } = JSON.parse(stdout());
            expect(transaction.committed).toBe(false);
            expect(transaction.rolledBack).toBe(true);
            expect(typeof transaction.transactionId).toBe('string');
            expect(Array.isArray(transaction.restoredFiles)).toBe(true);
            expect(transaction.note).toBeTruthy();

            // The backup manifest on disk agrees: nothing was committed.
            const { listBackups } = require('../../src/core/install-transaction');
            const backups = listBackups();
            expect(backups.length).toBeGreaterThan(0);
            expect(backups.every((b: { committed: boolean }) => b.committed)).toBe(false);
            // …and the run really did not persist anything.
            expect(fs.existsSync(prefsFile())).toBe(false);
        });

        it('--json still emits a failure envelope when init fails before the step pipeline', async () => {
            const actions = fakeActions([]);
            actions.syncCache = async () => { throw new Error('registry unreachable'); };

            const { runInit } = require('../../src/commands/init');
            const code = await runInit({ cwd: tmpHome, yes: true, json: true, actions });

            expect(code).toBe(2);
            const parsed = JSON.parse(stdout());
            expect(parsed.result).toBe('failed');
            expect(parsed.error).toContain('registry unreachable');
            expect(parsed.steps).toEqual([]);
            expect(parsed.before).toBeNull();
            expect(parsed.transaction.committed).toBe(false);
        });

        it('human mode renders the failed outcome instead of swallowing it', async () => {
            const { runInit } = require('../../src/commands/init');
            const code = await runInit({ cwd: tmpHome, yes: true, actions: actionsWithFailingHook() });

            expect(code).toBe(2);
            expect(stdout()).toContain('AWM · init');
            expect(stdout()).toContain('machine.hook');
            expect(stdout()).toContain('hook boom');
            expect(stderr()).toContain('machine.hook');
            expect(stderr()).toContain('hook boom');
        });
    });
});
