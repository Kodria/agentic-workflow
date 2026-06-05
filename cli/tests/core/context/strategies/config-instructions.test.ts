// cli/tests/core/context/strategies/config-instructions.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigInstructionsStrategy } from '../../../../src/core/context/strategies/config-instructions';
import { ProviderConfig } from '../../../../src/providers';
import { InjectionInput } from '../../../../src/core/context/types';
import { sha256 } from '../../../../src/core/context/provider';

function setup(opencodeJson?: object) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-oc-'));
    const configPath = path.join(dir, 'opencode.json');
    if (opencodeJson) fs.writeFileSync(configPath, JSON.stringify(opencodeJson, null, 2));
    const absPath = path.join(dir, '.awm/context/awm-context.md');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, 'CTX');
    const provider: ProviderConfig = {
        label: 'OpenCode', skill: { global: '', local: '' }, workflow: null, agent: null,
        injection: { type: 'config-instructions', configPath, field: 'instructions' },
    };
    const input: InjectionInput = {
        ref: { absPath, scope: 'global', contentHash: sha256('CTX') },
        registryRoot: '/reg', installMethod: 'symlink', agent: 'opencode', scope: 'global',
    };
    return { configPath, absPath, provider, input };
}

const strat = new ConfigInstructionsStrategy();

describe('ConfigInstructionsStrategy.inject', () => {
    it('creates opencode.json with the sentinel when it does not exist', () => {
        const { configPath, absPath, provider, input } = setup();
        strat.inject(input, provider);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain(absPath);
        expect(cfg.$schema).toBe('https://opencode.ai/config.json');
    });

    it('preserves user instructions and is idempotent (no duplicate)', () => {
        const { configPath, absPath, provider, input } = setup({ instructions: ['docs/rules.md'] });
        strat.inject(input, provider);
        strat.inject(input, provider);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain('docs/rules.md');
        expect(cfg.instructions.filter((e: string) => e === absPath)).toHaveLength(1);
    });
});

describe('ConfigInstructionsStrategy.remove', () => {
    it('removes only the sentinel, preserving user entries', () => {
        const { configPath, absPath, provider, input } = setup({ instructions: ['docs/rules.md'] });
        strat.inject(input, provider);
        strat.remove(input, provider);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toEqual(['docs/rules.md']);
    });
});

describe('ConfigInstructionsStrategy.status', () => {
    it('absent when no config / no entry', () => {
        const { provider, input } = setup();
        expect(strat.status(input, provider)).toBe('absent');
    });

    it('injected when entry present and materialized hash matches', () => {
        const { provider, input } = setup();
        strat.inject(input, provider);
        expect(strat.status(input, provider)).toBe('injected');
    });

    it('stale when entry present but materialized file content drifted', () => {
        const { absPath, provider, input } = setup();
        strat.inject(input, provider);
        fs.writeFileSync(absPath, 'DRIFTED');
        expect(strat.status(input, provider)).toBe('stale');
    });

    it('throws actionable error on malformed opencode.json instead of clobbering', () => {
        const { configPath, provider, input } = setup();
        fs.writeFileSync(configPath, '{ not json');
        expect(() => strat.inject(input, provider)).toThrow('not valid JSON');
    });

    it('throws when instructions is a non-array value instead of silently overwriting it', () => {
        const { provider, input } = setup({ instructions: 'docs/rules.md' as unknown as string[] });
        expect(() => strat.inject(input, provider)).toThrow("'instructions' field must be an array");
    });
});
