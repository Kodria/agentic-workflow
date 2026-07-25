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
});
