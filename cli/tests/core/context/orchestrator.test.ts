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

    it('contextStatus returns stale when the materialized file drifts without re-materializing it', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        // Drift the materialized file content after install
        fs.writeFileSync(absPath, 'DRIFTED CONTENT');
        // contextStatus must detect stale without correcting the file
        expect(orch.contextStatus(args)).toBe('stale');
        // Confirm the drifted content is still on disk (not silently corrected)
        expect(fs.readFileSync(absPath, 'utf-8')).toBe('DRIFTED CONTENT');
    });

    it('uninstallContext succeeds even when the registry does not exist', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        // Remove the registry to simulate a degraded state
        fs.rmSync(registryRoot, { recursive: true, force: true });
        // uninstallContext must not throw 'using-awm skill not found'
        expect(() => orch.uninstallContext(args)).not.toThrow();
        // After removal the sentinel must be gone from opencode.json
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect((cfg.instructions ?? []).includes(absPath)).toBe(false);
    });
});
