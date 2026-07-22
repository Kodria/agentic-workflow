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
        const code = await runInit({ cwd: tmpHome, yes: true, actions: { syncCache: async () => {} } });
        expect(code).toBe(1); // cache/hook/devCore siguen ausentes (syncCache no-op) → degradado
    });

    it('--json emits a parseable InitOutcome', async () => {
        const { runInit } = require('../../src/commands/init');
        const code = await runInit({ cwd: tmpHome, yes: true, json: true, actions: { syncCache: async () => {} } });
        const written = writeSpy.mock.calls.map((c) => c[0]).join('');
        const parsed = JSON.parse(written);
        expect(Array.isArray(parsed.steps)).toBe(true);
        expect(parsed.after.overall).toBe('degraded');
        expect(code).toBe(1);
    });

    const prefsFile = () => path.join(process.env.AWM_HOME as string, 'preferences.json');
    const readAgent = () => JSON.parse(fs.readFileSync(prefsFile(), 'utf-8')).defaultAgent;

    it('#7: first init (no -a) persists claude-code as the default agent', async () => {
        const { runInit } = require('../../src/commands/init');
        expect(fs.existsSync(prefsFile())).toBe(false);
        await runInit({ cwd: tmpHome, yes: true, actions: { syncCache: async () => {} } });
        expect(readAgent()).toBe('claude-code');
    });

    it('#7: init -a opencode persists the explicit agent', async () => {
        const { runInit } = require('../../src/commands/init');
        await runInit({ cwd: tmpHome, yes: true, agent: 'opencode', actions: { syncCache: async () => {} } });
        expect(readAgent()).toBe('opencode');
    });

    it('#7: re-init without -a does NOT clobber an existing explicit preference', async () => {
        const { savePreferences } = require('../../src/utils/config');
        savePreferences({ defaultAgent: 'opencode', installMethod: 'symlink', defaultScope: 'local' });
        const { runInit } = require('../../src/commands/init');
        await runInit({ cwd: tmpHome, yes: true, actions: { syncCache: async () => {} } });
        expect(readAgent()).toBe('opencode');
    });
});
