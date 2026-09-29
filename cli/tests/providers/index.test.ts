import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    AGENT_TARGETS,
    assertLinkRenderer,
    getTargetPath,
    isAgentTarget,
    providerFor,
    providers,
} from '../../src/providers';

describe('Providers Routing', () => {
    const originalHome = process.env.HOME;
    const originalAwmHome = process.env.AWM_HOME;
    let tmpHome: string;
    let tmpWork: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-work-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm-test');
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    it('resolves Codex paths from the current HOME at call time', () => {
        const first = fs.mkdtempSync(path.join(tmpWork, 'awm-home-a-'));
        const second = fs.mkdtempSync(path.join(tmpWork, 'awm-home-b-'));
        process.env.HOME = first;
        expect(getTargetPath('skill', 'codex', 'global'))
            .toBe(path.join(first, '.agents/skills'));
        process.env.HOME = second;
        expect(getTargetPath('agent', 'codex', 'global'))
            .toBe(path.join(second, '.codex/agents'));
    });

    it('returns a fresh provider graph using current HOME and AWM_HOME', () => {
        const first = providers();
        const nextHome = path.join(tmpWork, 'next-home');
        const nextAwmHome = path.join(tmpWork, 'next-awm');
        process.env.HOME = nextHome;
        process.env.AWM_HOME = nextAwmHome;

        const second = providers();

        expect(second).not.toBe(first);
        expect(second.codex.skill.global).toBe(path.join(nextHome, '.agents/skills'));
        expect(second.codex.hooks?.scriptsDir).toBe(path.join(nextAwmHome, 'hooks/codex'));
        expect(first.codex.skill.global).toBe(path.join(tmpHome, '.agents/skills'));
    });

    it('declares the complete Codex capability metadata', () => {
        expect(providerFor('codex')).toEqual({
            label: 'Codex',
            // El unico proveedor con override confirmado contra su binario real (D-011).
            configHome: { envVar: 'CODEX_HOME', dir: '.codex', resolved: path.join(tmpHome, '.codex') },
            minimumVersion: '0.145.0',
            versionCommand: { command: 'codex', args: ['--version'], versionPattern: /^codex-cli (\d+\.\d+\.\d+)$/ },
            skill: {
                global: path.join(tmpHome, '.agents/skills'),
                local: '.agents/skills',
                renderer: 'link',
            },
            workflow: null,
            agent: {
                global: path.join(tmpHome, '.codex/agents'),
                local: '.codex/agents',
                renderer: 'codex-agent-toml',
            },
            hooks: {
                type: 'codex-hooks-json',
                settingsPath: path.join(tmpHome, '.codex/hooks.json'),
                scriptsDir: path.join(process.env.AWM_HOME!, 'hooks/codex'),
                matcher: 'startup|resume|clear|compact',
                eventName: 'SessionStart',
            },
            injection: {
                type: 'managed-agents-md',
                globalPath: path.join(tmpHome, '.codex/AGENTS.md'),
                localFile: 'AGENTS.md',
            },
        });
    });

    it('keeps Claude Code, OpenCode, and Antigravity contracts unchanged', () => {
        const graph = providers();
        expect(graph.antigravity).toEqual({
            label: 'Antigravity',
            configHome: { envVar: null, dir: '.gemini/antigravity', resolved: path.join(tmpHome, '.gemini/antigravity') },
            skill: {
                global: path.join(tmpHome, '.gemini/antigravity/skills'),
                local: '.agent/skills',
                renderer: 'link',
            },
            workflow: {
                global: path.join(tmpHome, '.gemini/antigravity/global_workflows'),
                local: '.agent/workflows',
                renderer: 'link',
            },
            agent: null,
        });
        expect(graph.opencode).toEqual({
            label: 'OpenCode',
            configHome: { envVar: null, dir: '.config/opencode', resolved: path.join(tmpHome, '.config/opencode') },
            skill: {
                global: path.join(tmpHome, '.agents/skills'),
                local: '.agents/skills',
                renderer: 'link',
            },
            workflow: null,
            agent: {
                global: path.join(tmpHome, '.config/opencode/agents'),
                local: '.agents/profiles',
                renderer: 'link',
            },
            injection: {
                type: 'config-instructions',
                configPath: path.join(tmpHome, '.config/opencode/opencode.json'),
                field: 'instructions',
            },
        });
        expect(graph['claude-code']).toEqual({
            label: 'Claude Code',
            configHome: { envVar: 'CLAUDE_CONFIG_DIR', dir: '.claude', resolved: path.join(tmpHome, '.claude') },
            skill: {
                global: path.join(tmpHome, '.claude/skills'),
                local: '.claude/skills',
                renderer: 'link',
            },
            workflow: null,
            agent: {
                global: path.join(tmpHome, '.claude/agents'),
                local: '.claude/agents',
                renderer: 'link',
            },
            hooks: {
                type: 'cc-settings-merge',
                settingsPath: path.join(tmpHome, '.claude/settings.json'),
                scriptsDir: path.join(process.env.AWM_HOME!, 'hooks'),
                matcher: 'startup|clear|compact',
                eventName: 'SessionStart',
            },
            injection: { type: 'cc-settings-merge' },
        });
    });

    it('keeps Claude Code and OpenCode destinations unchanged', () => {
        expect(getTargetPath('skill', 'claude-code', 'global'))
            .toBe(path.join(process.env.HOME!, '.claude/skills'));
        expect(getTargetPath('skill', 'opencode', 'global'))
            .toBe(path.join(process.env.HOME!, '.agents/skills'));
    });

    it('uses AGENT_TARGETS as the single iterable target catalog', () => {
        expect(AGENT_TARGETS).toEqual(['antigravity', 'opencode', 'claude-code', 'codex', 'cursor', 'copilot']);
        expect(Object.keys(providers())).toEqual([...AGENT_TARGETS]);
    });

    it('throws on unsupported artifacts', () => {
        expect(() => getTargetPath('workflow', 'opencode', 'global')).toThrow('not supported');
        expect(() => getTargetPath('workflow', 'claude-code', 'global')).toThrow('not supported');
        expect(() => getTargetPath('agent', 'antigravity', 'local')).toThrow('not supported');
    });

    it('fails loudly for invalid runtime provider input', () => {
        expect(() => providerFor('unknown-agent' as any)).toThrow('Unknown agent target');
        expect(() => getTargetPath('skill', 'unknown-agent' as any, 'global'))
            .toThrow('Unknown agent target');
    });

    describe('Cursor and Copilot (D4)', () => {
        it('recognizes cursor and copilot as valid agent targets', () => {
            expect(isAgentTarget('cursor')).toBe(true);
            expect(isAgentTarget('copilot')).toBe(true);
        });

        it('joins the shared agents skills dirs with link renderer (Plan B R1/R2)', () => {
            expect(providerFor('cursor').skill).toEqual({
                global: path.join(process.env.HOME!, '.agents/skills'),
                local: '.agents/skills',
                renderer: 'link',
            });
            expect(getTargetPath('skill', 'cursor', 'local')).toBe('.agents/skills');
            expect(getTargetPath('skill', 'cursor', 'global'))
                .toBe(path.join(process.env.HOME!, '.agents/skills'));
        });

        it('installs canonical Cursor agents under .cursor/agents with link (Plan B R6/R9)', () => {
            expect(providerFor('cursor').agent).toEqual({
                global: path.join(process.env.HOME!, '.cursor/agents'),
                local: '.cursor/agents',
                renderer: 'link',
            });
            expect(getTargetPath('agent', 'cursor', 'local')).toBe('.cursor/agents');
            expect(getTargetPath('agent', 'cursor', 'global'))
                .toBe(path.join(process.env.HOME!, '.cursor/agents'));
        });

        it('resolves the Copilot local skill path', () => {
            expect(getTargetPath('skill', 'copilot', 'local')).toBe('.github/instructions');
        });

        it('throws a specific, non-generic reason when Copilot global skills are requested', () => {
            expect(() => getTargetPath('skill', 'copilot', 'global')).toThrow(
                'skill global scope is not supported by Copilot: GitHub Copilot has no user-level skill discovery mechanism — skills must be installed per-project.',
            );
        });

        it('keeps workflow unsupported for cursor and agent unsupported for copilot', () => {
            expect(() => getTargetPath('workflow', 'cursor', 'local')).toThrow(
                'workflows are not supported by Cursor.',
            );
            expect(() => getTargetPath('agent', 'copilot', 'local')).toThrow(
                'agents are not supported by Copilot.',
            );
        });

        it('declares cursor-hooks-json for cursor and none for copilot', () => {
            expect(providerFor('cursor').hooks).toEqual({
                type: 'cursor-hooks-json',
                settingsPath: path.join(tmpHome, '.cursor/hooks.json'),
                scriptsDir: path.join(process.env.AWM_HOME!, 'hooks/cursor'),
                matcher: '',
                eventName: '',
            });
            expect(providerFor('copilot').hooks).toBeUndefined();
        });

        it('declares Cursor agent version gate (Plan C R26)', () => {
            expect(providerFor('cursor').minimumVersion).toBe('2026.09.26');
            expect(providerFor('cursor').versionCommand).toEqual({
                command: 'agent',
                args: ['--version'],
                versionPattern: /^(\d{4}\.\d{2}\.\d{2})-[0-9a-f]+$/,
            });
        });

        it('assigns Copilot instructions renderer; Cursor skills use link (cursor-mdc kept for migration)', () => {
            expect(providerFor('cursor').skill.renderer).toBe('link');
            expect(providerFor('copilot').skill.renderer).toBe('copilot-instructions');
        });

        it('assertLinkRenderer accepts Cursor link skills and still refuses Copilot', () => {
            expect(() => assertLinkRenderer('skill', 'cursor')).not.toThrow();
            expect(assertLinkRenderer('skill', 'cursor')?.renderer).toBe('link');
            // Copilot still renders via the add pipeline only — a raw SKILL.md under
            // `.github/instructions/` lacks `.instructions.md` + applyTo frontmatter.
            expect(() => assertLinkRenderer('skill', 'copilot')).toThrow(/not implemented yet/);
        });
    });
});
