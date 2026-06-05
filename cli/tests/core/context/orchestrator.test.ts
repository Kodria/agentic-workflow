// cli/tests/core/context/orchestrator.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InjectionOrchestrator } from '../../../src/core/context/orchestrator';

function tmpRegistry(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
    const dir = path.join(root, 'registry/skills/using-awm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nversion: "1.0.0"\n---\nBODY');
    return root;
}

describe('InjectionOrchestrator (opencode, real strategy)', () => {
    let configPath: string;
    let absPath: string;
    let orch: InjectionOrchestrator;
    let registryRoot: string;

    beforeEach(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-oc-'));
        configPath = path.join(dir, 'opencode.json');
        absPath = path.join(dir, 'awm-context.md');
        registryRoot = tmpRegistry();
        orch = new InjectionOrchestrator({
            providerOverride: {
                label: 'OpenCode', skill: { global: '', local: '' }, workflow: null, agent: null,
                injection: { type: 'config-instructions', configPath, field: 'instructions' },
            },
            contextPathOverride: absPath,
        });
    });

    it('installContext materializes content and injects the sentinel; status reports injected', () => {
        orch.installContext({ agent: 'opencode', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] });
        expect(fs.existsSync(absPath)).toBe(true);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain(absPath);
        expect(orch.contextStatus({ agent: 'opencode', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] })).toBe('injected');
    });

    it('uninstallContext removes the sentinel; status reports absent', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        orch.uninstallContext(args);
        expect(orch.contextStatus(args)).toBe('absent');
    });

    it('throws when the agent has no injection mechanism', () => {
        const bare = new InjectionOrchestrator();
        expect(() => bare.installContext({ agent: 'antigravity', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] }))
            .toThrow('no injection mechanism');
    });
});
