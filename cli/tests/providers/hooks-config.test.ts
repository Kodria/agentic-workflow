import fs from 'fs';
import os from 'os';
import path from 'path';
import { getHookConfig, providerFor } from '../../src/providers';

describe('Hook configuration in providers', () => {
    const originalHome = process.env.HOME;
    const originalAwmHome = process.env.AWM_HOME;
    let tmpHome: string;
    let tmpWork: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-hook-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-hook-work-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpWork, 'awm');
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    it('claude-code provider defines a HookConfig', () => {
        const cc = providerFor('claude-code');
        expect(cc.hooks).toBeDefined();
        expect(cc.hooks?.type).toBe('cc-settings-merge');
        expect(cc.hooks?.eventName).toBe('SessionStart');
        expect(cc.hooks?.matcher).toBe('startup|clear|compact');
    });

    it('claude-code paths use current HOME and normalized AWM_HOME directory', () => {
        const cc = providerFor('claude-code');
        expect(cc.hooks?.settingsPath).toBe(path.join(tmpHome, '.claude/settings.json'));
        expect(cc.hooks?.scriptsDir).toBe(path.join(process.env.AWM_HOME!, 'hooks/claude-code'));
    });

    it('antigravity and opencode have no hooks', () => {
        expect(providerFor('antigravity').hooks).toBeUndefined();
        expect(providerFor('opencode').hooks).toBeUndefined();
    });

    it('getHookConfig returns config for supported target', () => {
        const config = getHookConfig('claude-code');
        expect(config).toBeDefined();
        expect(config?.type).toBe('cc-settings-merge');
    });

    it('getHookConfig returns undefined for unsupported target', () => {
        expect(getHookConfig('antigravity')).toBeUndefined();
    });

    it('respects AWM_HOME changes at call time', () => {
        const nextAwmHome = path.join(tmpWork, 'next-awm');
        process.env.AWM_HOME = nextAwmHome;
        expect(getHookConfig('claude-code')?.scriptsDir)
            .toBe(path.join(nextAwmHome, 'hooks/claude-code'));
    });
});
