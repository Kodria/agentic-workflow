import { PROVIDERS, getHookConfig } from '../../src/providers';

describe('Hook configuration in providers', () => {
    it('claude-code provider defines a HookConfig', () => {
        const cc = PROVIDERS['claude-code'];
        expect(cc.hooks).toBeDefined();
        expect(cc.hooks?.type).toBe('cc-settings-merge');
        expect(cc.hooks?.eventName).toBe('SessionStart');
        expect(cc.hooks?.matcher).toBe('startup|clear|compact');
    });

    it('claude-code settingsPath resolves to ~/.claude/settings.json', () => {
        const cc = PROVIDERS['claude-code'];
        expect(cc.hooks?.settingsPath).toMatch(/\.claude\/settings\.json$/);
    });

    it('claude-code scriptsDir resolves to ~/.awm/hooks/', () => {
        const cc = PROVIDERS['claude-code'];
        expect(cc.hooks?.scriptsDir).toMatch(/\.awm\/hooks$/);
    });

    it('antigravity and opencode have no hooks (single-harness scope)', () => {
        expect(PROVIDERS['antigravity'].hooks).toBeUndefined();
        expect(PROVIDERS['opencode'].hooks).toBeUndefined();
    });

    it('getHookConfig returns config for supported target', () => {
        const config = getHookConfig('claude-code');
        expect(config).toBeDefined();
        expect(config?.type).toBe('cc-settings-merge');
    });

    it('getHookConfig returns undefined for unsupported target', () => {
        const config = getHookConfig('antigravity');
        expect(config).toBeUndefined();
    });

    it('respects AWM_HOME env var override for scriptsDir', () => {
        const originalEnv = process.env.AWM_HOME;
        process.env.AWM_HOME = '/tmp/awm-test';

        // Re-import to pick up env change
        jest.resetModules();
        const { PROVIDERS: P } = require('../../src/providers');
        expect(P['claude-code'].hooks.scriptsDir).toBe('/tmp/awm-test/hooks');

        if (originalEnv === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalEnv;
    });
});
