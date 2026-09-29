import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

describe('installHook / computeHookStatus / uninstallHook — Cursor adapter', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let hooksJson: string;
    let cursorScriptsDir: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cursor-hooks-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cursor-registry-'));
        hooksJson = path.join(tmpHome, '.cursor/hooks.json');
        cursorScriptsDir = path.join(tmpHome, '.awm/hooks/cursor');

        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRegistry, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function writeRegistry(content = '#!/usr/bin/env node\nconsole.log("{}")') {
        const regHooks = path.join(tmpRegistry, 'hooks');
        const regSkill = path.join(tmpRegistry, 'skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        for (const name of ['cursor-session-start', 'cursor-pre-compact', 'cursor-post-tool-use']) {
            fs.writeFileSync(path.join(regHooks, name), content, { mode: 0o755 });
        }
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.\n');
    }

    function installOpts(over: Record<string, unknown> = {}) {
        return {
            agent: 'cursor' as const,
            registryRoot: tmpRegistry,
            installMethod: 'copy' as const,
            baselineRegistryVersion: '4.9.0',
            ...over,
        };
    }

    function awmEntries() {
        return {
            sessionStart: [{ command: path.join(cursorScriptsDir, 'session-start') }],
            preCompact: [{ command: path.join(cursorScriptsDir, 'pre-compact') }],
            postToolUse: [{ command: path.join(cursorScriptsDir, 'post-tool-use') }],
        };
    }

    it('merges three AWM events and preserves non-AWM entries', () => {
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({
            version: 1,
            hooks: {
                sessionStart: [{ command: '/user/custom-start' }],
                stop: [{ command: 'echo stop' }],
            },
        }));
        writeRegistry();

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook(installOpts());

        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.version).toBe(1);
        expect(cfg.hooks.stop).toEqual([{ command: 'echo stop' }]);
        expect(cfg.hooks.sessionStart).toEqual([
            { command: '/user/custom-start' },
            { command: path.join(cursorScriptsDir, 'session-start') },
        ]);
        expect(cfg.hooks.preCompact).toEqual([{ command: path.join(cursorScriptsDir, 'pre-compact') }]);
        expect(cfg.hooks.postToolUse).toEqual([{ command: path.join(cursorScriptsDir, 'post-tool-use') }]);
        expect(fs.existsSync(path.join(cursorScriptsDir, 'session-start'))).toBe(true);
        expect(fs.readFileSync(path.join(cursorScriptsDir, 'using-awm.md'), 'utf8')).toContain('MUST invoke skills.');
    });

    it('installs cleanly with no pre-existing hooks.json and backs up on replace', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');
        const first = installHook(installOpts({ installMethod: 'symlink' }));
        expect(first.status).toBe('installed');
        expect(first.backupPath).toBeNull();

        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg).toEqual({ version: 1, hooks: awmEntries() });
        expect(fs.lstatSync(path.join(cursorScriptsDir, 'session-start')).isSymbolicLink()).toBe(true);

        fs.writeFileSync(hooksJson, JSON.stringify({ version: 1, hooks: { sessionStart: [] } }, null, 2));
        const second = installHook(installOpts());
        expect(second.status).toBe('installed');
        expect(second.backupPath).toMatch(/hooks\.json\..*\.bak$/);
    });

    it('fails when registry lacks cursor-session-start', () => {
        const regHooks = path.join(tmpRegistry, 'hooks');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'cursor-pre-compact'), 'x', { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'cursor-post-tool-use'), 'x', { mode: 0o755 });
        fs.mkdirSync(path.join(tmpRegistry, 'skills/using-awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpRegistry, 'skills/using-awm/SKILL.md'), '---\nname: using-awm\n---\n');

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook(installOpts())).toThrow(/Cursor hook source missing/);
        expect(fs.existsSync(hooksJson)).toBe(false);
    });

    it('refuses invalid JSON, unknown version, and duplicate AWM entries without writing', () => {
        writeRegistry();
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });

        fs.writeFileSync(hooksJson, '{not json');
        const beforeBad = fs.readFileSync(hooksJson, 'utf8');
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook(installOpts())).toThrow(/not valid JSON/);
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(beforeBad);

        fs.writeFileSync(hooksJson, JSON.stringify({ version: 2, hooks: {} }));
        const beforeVer = fs.readFileSync(hooksJson, 'utf8');
        expect(() => installHook(installOpts())).toThrow(/unsupported hooks\.json version/);
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(beforeVer);

        const dup = {
            version: 1,
            hooks: {
                sessionStart: [
                    { command: path.join(cursorScriptsDir, 'session-start') },
                    { command: path.join(cursorScriptsDir, 'session-start') },
                ],
            },
        };
        fs.writeFileSync(hooksJson, JSON.stringify(dup, null, 2));
        const beforeDup = fs.readFileSync(hooksJson, 'utf8');
        expect(() => installHook(installOpts())).toThrow(/multiple AWM sessionStart/);
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(beforeDup);
        expect(fs.existsSync(path.join(tmpHome, '.awm/backups'))).toBe(false);
    });

    it('aborts when an event key is present but not an array', () => {
        writeRegistry();
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({ version: 1, hooks: { sessionStart: { command: 'x' } } }));
        const before = fs.readFileSync(hooksJson, 'utf8');
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook(installOpts())).toThrow(/must be an array/);
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(before);
    });

    it('prunes dead AWM entries from another AWM_HOME and preserves live parallels', () => {
        writeRegistry();
        const dead = '/tmp/awm-gone-never/hooks/cursor/session-start';
        const liveOther = path.join(tmpHome, '.awm-other/hooks/cursor/session-start');
        fs.mkdirSync(path.dirname(liveOther), { recursive: true });
        fs.writeFileSync(liveOther, '#!/usr/bin/env node\n', { mode: 0o755 });

        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({
            version: 1,
            hooks: {
                sessionStart: [
                    { command: dead },
                    { command: liveOther },
                ],
            },
        }, null, 2));

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook(installOpts());

        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.hooks.sessionStart.map((e: { command: string }) => e.command)).toEqual([
            liveOther,
            path.join(cursorScriptsDir, 'session-start'),
        ]);
    });

    it('is idempotent when nothing changed', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');
        const first = installHook(installOpts());
        expect(first.status).toBe('installed');
        const contentBefore = fs.readFileSync(hooksJson, 'utf8');
        const mtimeBefore = fs.statSync(hooksJson).mtimeMs;
        const second = installHook(installOpts());
        expect(second.status).toBe('already-up-to-date');
        expect(second.backupPath).toBeNull();
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(contentBefore);
        expect(fs.statSync(hooksJson).mtimeMs).toBe(mtimeBefore);
    });

    it.each([
        [false, 'pending-first-run'],
        [true, 'healthy'],
    ])('derives trust from heartbeat (present=%s → %s)', (heartbeat, expected) => {
        fs.mkdirSync(cursorScriptsDir, { recursive: true });
        const scriptPath = path.join(cursorScriptsDir, 'session-start');
        fs.writeFileSync(scriptPath, '#!/usr/bin/env node\n', { mode: 0o755 });
        fs.writeFileSync(path.join(cursorScriptsDir, 'using-awm.md'), '# using-awm\n');
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({ version: 1, hooks: awmEntries() }, null, 2));
        if (heartbeat) {
            fs.writeFileSync(
                path.join(cursorScriptsDir, 'heartbeat.json'),
                JSON.stringify({ hash: crypto.createHash('sha256').update(fs.readFileSync(scriptPath)).digest('hex') }),
            );
        }
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        expect(computeHookStatus('cursor').trust).toBe(expected);
    });

    it('reports stale trust when heartbeat hash mismatches', () => {
        fs.mkdirSync(cursorScriptsDir, { recursive: true });
        const scriptPath = path.join(cursorScriptsDir, 'session-start');
        fs.writeFileSync(scriptPath, '#!/usr/bin/env node\n', { mode: 0o755 });
        fs.writeFileSync(path.join(cursorScriptsDir, 'using-awm.md'), '# using-awm\n');
        fs.writeFileSync(path.join(cursorScriptsDir, 'heartbeat.json'), JSON.stringify({ hash: 'deadbeef' }));
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({ version: 1, hooks: awmEntries() }, null, 2));
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const status = computeHookStatus('cursor');
        expect(status.trust).toBe('stale');
        expect(status.overall).toBe('DEGRADED');
    });

    it('refuses install when baseline registry is below 4.9.0 and accepts 4.9.0', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook(installOpts({ baselineRegistryVersion: '4.8.1' })))
            .toThrow("Cursor hooks require baseline registry >= 4.9.0; installed is 4.8.1. Run 'awm update -y'.");
        expect(fs.existsSync(hooksJson)).toBe(false);
        expect(installHook(installOpts({ baselineRegistryVersion: '4.9.0' })).status).toBe('installed');
    });

    it('shouldDisableDeferredReanchor follows R16.2 thresholds', () => {
        const { shouldDisableDeferredReanchor } = require('../../../src/commands/hooks/cursor');
        expect(shouldDisableDeferredReanchor({ deliveryVerified: false, p95Ms: 10 })).toBe(true);
        expect(shouldDisableDeferredReanchor({ deliveryVerified: true, p95Ms: 51 })).toBe(true);
        expect(shouldDisableDeferredReanchor({ deliveryVerified: true, p95Ms: 50 })).toBe(false);
    });

    it('omits deferred events when disableDeferredReanchor is set', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook(installOpts({ disableDeferredReanchor: true }));
        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.hooks.sessionStart).toEqual([{ command: path.join(cursorScriptsDir, 'session-start') }]);
        expect(cfg.hooks.preCompact).toBeUndefined();
        expect(cfg.hooks.postToolUse).toBeUndefined();
        expect(fs.existsSync(path.join(cursorScriptsDir, 'session-start'))).toBe(true);
        expect(fs.existsSync(path.join(cursorScriptsDir, 'pre-compact'))).toBe(false);
    });

    it('uninstall removes only AWM Cursor entries', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');
        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        installHook(installOpts());
        const current = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        current.hooks.sessionStart.unshift({ command: '/user/keep' });
        fs.writeFileSync(hooksJson, JSON.stringify(current, null, 2));

        const result = uninstallHook({ agent: 'cursor' });
        expect(result.status).toBe('uninstalled');
        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.hooks.sessionStart).toEqual([{ command: '/user/keep' }]);
        expect(cfg.hooks.preCompact).toBeUndefined();
        expect(cfg.hooks.postToolUse).toBeUndefined();
    });
});
