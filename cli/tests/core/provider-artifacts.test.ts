import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    preflightLinkArtifactPairs,
    scanLegacyArtifacts,
} from '../../src/core/provider-artifacts';

describe('preflightLinkArtifactPairs', () => {
    it('rejects a mixed Codex selection before any installer call', () => {
        const install = jest.fn();

        expect(() => {
            const pairs = [
                { agent: 'codex', artifact: { type: 'skill' as const, name: 'linked-skill' } },
                { agent: 'codex', artifact: { type: 'agent' as const, name: 'toml-agent' } },
            ] as const;
            preflightLinkArtifactPairs(pairs);
            for (const item of pairs) install(item);
        }).toThrow("Renderer 'codex-agent-toml' for codex agent artifacts is not implemented yet");
        expect(install).not.toHaveBeenCalled();
    });
});

describe('scanLegacyArtifacts', () => {
    const originalHome = process.env.HOME;
    const originalAwmHome = process.env.AWM_HOME;
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-artifacts-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('never lists Codex TOML agents for legacy removal', () => {
        const skillPath = path.join(tmpHome, '.agents/skills/linked-skill');
        const agentPath = path.join(tmpHome, '.codex/agents/protected.toml');
        fs.mkdirSync(skillPath, { recursive: true });
        fs.mkdirSync(path.dirname(agentPath), { recursive: true });
        fs.writeFileSync(agentPath, 'name = "protected"\n');

        const listed = scanLegacyArtifacts(['codex'], 'global');
        const legacyRemove = jest.fn((target: string) => fs.rmSync(target, {
            recursive: true,
            force: true,
        }));
        for (const artifact of listed) {
            for (const fullPath of artifact.fullPaths) legacyRemove(fullPath);
        }

        expect(listed.map((artifact) => artifact.name)).toEqual(['linked-skill']);
        expect(legacyRemove).not.toHaveBeenCalledWith(agentPath);
        expect(fs.existsSync(agentPath)).toBe(true);
    });

    it('Gap C — an agent with a null global skill dir (copilot) at global scope skips cleanly instead of crashing', () => {
        // Copilot's skill.global is null (no user-level skill discovery mechanism —
        // providers/index.ts) and its skill renderer is 'copilot-instructions', not
        // 'link', so scanLegacyArtifacts's `dir === null` guard (config[scope]) is
        // the same defensive shape this task's null-skip audit covers for the other
        // 4 files. Proves the call is a clean no-op for copilot at 'global' scope —
        // no crash, nothing listed — rather than throwing on a null target dir.
        expect(() => scanLegacyArtifacts(['copilot'], 'global')).not.toThrow();
        const listed = scanLegacyArtifacts(['copilot'], 'global');
        expect(listed).toEqual([]);
    });
});
