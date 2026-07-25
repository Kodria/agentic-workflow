import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

describe('installHook / computeHookStatus / uninstallHook — Codex adapter', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let hooksJson: string;
    let codexScriptsDir: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-registry-'));
        hooksJson = path.join(tmpHome, '.codex/hooks.json');
        codexScriptsDir = path.join(tmpHome, '.awm/hooks/codex');

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

    function writeRegistry(content = '#!/usr/bin/env bash\necho "{}"') {
        const regHooks = path.join(tmpRegistry, 'hooks');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'codex-session-start'), content, { mode: 0o755 });
    }

    function awmSessionStartEntry() {
        return {
            matcher: 'startup|resume|clear|compact',
            hooks: [{
                type: 'command',
                command: path.join(codexScriptsDir, 'session-start'),
                statusMessage: 'Loading AWM session state',
            }],
        };
    }

    it('merges one AWM SessionStart group and preserves user hooks', () => {
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({
            description: 'user hooks',
            hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] },
        }));
        writeRegistry();

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'copy' });

        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.description).toBe('user hooks');
        expect(cfg.hooks.Stop).toHaveLength(1);
        expect(cfg.hooks.SessionStart).toEqual([{
            matcher: 'startup|resume|clear|compact',
            hooks: [{
                type: 'command',
                command: path.join(tmpHome, '.awm/hooks/codex/session-start'),
                statusMessage: 'Loading AWM session state',
            }],
        }]); // verifies R3, R3.1
        expect(fs.existsSync(path.join(codexScriptsDir, 'session-start'))).toBe(true);
    });

    it('installs cleanly with no pre-existing hooks.json', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'symlink' });

        expect(result.status).toBe('installed');
        expect(result.backupPath).toBeNull();
        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.hooks.SessionStart).toEqual([awmSessionStartEntry()]);
        expect(fs.lstatSync(path.join(codexScriptsDir, 'session-start')).isSymbolicLink()).toBe(true);
    });

    it('fails fast when the registry has no codex-session-start source', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'copy' }))
            .toThrow(/Codex hook source missing/);
        expect(fs.existsSync(hooksJson)).toBe(false);
    });

    it('refuses duplicate AWM entries without rewriting hooks.json', () => {
        writeRegistry();
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        const duplicateAwmHookConfig = {
            hooks: {
                SessionStart: [awmSessionStartEntry(), awmSessionStartEntry()],
            },
        };
        fs.writeFileSync(hooksJson, JSON.stringify(duplicateAwmHookConfig, null, 2));
        const before = fs.readFileSync(hooksJson, 'utf8');

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'copy' }))
            .toThrow('multiple AWM SessionStart entries'); // verifies R17
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(tmpHome, '.awm/backups'))).toBe(false);
    });

    it('replaces a stale AWM entry in place when the script path changes', () => {
        writeRegistry();
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|resume|clear|compact',
                    hooks: [{
                        type: 'command',
                        command: path.join(codexScriptsDir, 'session-start'),
                        statusMessage: 'stale message',
                    }],
                }],
            },
        }, null, 2));

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'copy' });

        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.hooks.SessionStart).toHaveLength(1);
        expect(cfg.hooks.SessionStart[0].hooks[0].statusMessage).toBe('Loading AWM session state');
    });

    it('is a no-op on a second install when nothing changed (idempotent, no backup/write churn)', () => {
        writeRegistry();
        const { installHook } = require('../../../src/commands/hooks/install');

        const first = installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'copy' });
        expect(first.status).toBe('installed');

        const scriptPath = path.join(codexScriptsDir, 'session-start');
        const contentBefore = fs.readFileSync(hooksJson, 'utf8');
        const hooksJsonMtimeBefore = fs.statSync(hooksJson).mtimeMs;
        const scriptMtimeBefore = fs.statSync(scriptPath).mtimeMs;

        const second = installHook({ agent: 'codex', registryRoot: tmpRegistry, installMethod: 'copy' });

        expect(second.status).toBe('already-up-to-date');
        expect(second.backupPath).toBeNull();
        expect(fs.existsSync(path.join(tmpHome, '.awm/backups'))).toBe(false); // no backup churn
        expect(fs.readFileSync(hooksJson, 'utf8')).toBe(contentBefore);
        expect(fs.statSync(hooksJson).mtimeMs).toBe(hooksJsonMtimeBefore);
        expect(fs.statSync(scriptPath).mtimeMs).toBe(scriptMtimeBefore);
    });

    function hashOf(file: string): string {
        return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }

    function installCodexFixture({ heartbeat }: { heartbeat: boolean }) {
        fs.mkdirSync(codexScriptsDir, { recursive: true });
        const scriptPath = path.join(codexScriptsDir, 'session-start');
        fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "hi"', { mode: 0o755 });

        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({
            hooks: { SessionStart: [awmSessionStartEntry()] },
        }, null, 2));

        if (heartbeat) {
            fs.writeFileSync(
                path.join(codexScriptsDir, 'heartbeat.json'),
                JSON.stringify({ hash: hashOf(scriptPath), ts: new Date().toISOString() }),
            );
        }
    }

    it.each([
        [false, 'pending-trust'],
        [true, 'healthy'],
    ])('derives trust from a current heartbeat (heartbeat present=%s)', (heartbeat, expected) => {
        installCodexFixture({ heartbeat: heartbeat as boolean });
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        expect(computeHookStatus('codex').trust).toBe(expected); // verifies R18
    });

    it('reports stale trust when the heartbeat hash no longer matches the installed script', () => {
        installCodexFixture({ heartbeat: true });
        fs.writeFileSync(path.join(codexScriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "changed"', { mode: 0o755 });

        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        expect(computeHookStatus('codex').trust).toBe('stale');
    });

    it('degrades to stale (not throwing) when heartbeat.json is malformed JSON', () => {
        installCodexFixture({ heartbeat: false });
        fs.writeFileSync(path.join(codexScriptsDir, 'heartbeat.json'), '{ not valid json');

        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        let result: any;
        expect(() => { result = computeHookStatus('codex'); }).not.toThrow();
        expect(result.trust).toBe('stale');
    });

    it('omits trust entirely when the AWM entry is not present in hooks.json', () => {
        // Script + heartbeat both exist (e.g. left over from a prior install),
        // but hooks.json has no AWM SessionStart entry — nothing to trust.
        fs.mkdirSync(codexScriptsDir, { recursive: true });
        const scriptPath = path.join(codexScriptsDir, 'session-start');
        fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "hi"', { mode: 0o755 });
        fs.writeFileSync(
            path.join(codexScriptsDir, 'heartbeat.json'),
            JSON.stringify({ hash: hashOf(scriptPath), ts: new Date().toISOString() }),
        );

        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('codex');
        expect(result.checks.settingsEntry.ok).toBe(false);
        expect(result.trust).toBeUndefined();
    });

    it('reports HEALTHY overall with no bootstrapSkill/runHookWrapper checks', () => {
        installCodexFixture({ heartbeat: true });
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('codex');
        expect(result.overall).toBe('HEALTHY');
        expect(result.checks.sessionStartScript.ok).toBe(true);
        expect(result.checks.settingsEntry.ok).toBe(true);
        expect(result.checks.bootstrapSkill).toBeUndefined();
        expect(result.checks.runHookWrapper).toBeUndefined();
    });

    it('uninstall removes only the AWM entry and preserves other Codex hooks', () => {
        fs.mkdirSync(path.dirname(hooksJson), { recursive: true });
        fs.writeFileSync(hooksJson, JSON.stringify({
            description: 'user hooks',
            hooks: {
                Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
                SessionStart: [awmSessionStartEntry()],
            },
        }, null, 2));

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'codex' });

        expect(result.status).toBe('uninstalled');
        expect(result.backupPath).not.toBeNull();
        const cfg = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
        expect(cfg.description).toBe('user hooks');
        expect(cfg.hooks.Stop).toHaveLength(1);
        expect(cfg.hooks.SessionStart).toBeUndefined();
    });

    it('uninstall is a no-op when hooks.json does not exist', () => {
        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'codex' });
        expect(result.status).toBe('not-installed');
        expect(result.backupPath).toBeNull();
    });
});
