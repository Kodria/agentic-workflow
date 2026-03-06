// tests/providers/index.test.ts
import { getTargetPath, PROVIDERS } from '../../src/providers';
import os from 'os';

describe('Providers Routing', () => {
    // ── Existing Antigravity tests (preserved) ──
    it('routes antigravity global skills correctly', () => {
        const result = getTargetPath('skill', 'antigravity', 'global');
        expect(result).toBe(`${os.homedir()}/.gemini/antigravity/skills`);
    });

    it('routes opencode local skills correctly', () => {
        const result = getTargetPath('skill', 'opencode', 'local');
        expect(result).toBe('.agents/skills');
    });

    it('routes antigravity global workflows correctly', () => {
        const result = getTargetPath('workflow', 'antigravity', 'global');
        expect(result).toBe(`${os.homedir()}/.gemini/antigravity/global_workflows`);
    });

    it('throws on opencode workflow', () => {
        expect(() => getTargetPath('workflow', 'opencode', 'global')).toThrow('not supported');
    });

    // ── New Claude Code tests ──
    it('routes claude-code global skills correctly', () => {
        const result = getTargetPath('skill', 'claude-code', 'global');
        expect(result).toBe(`${os.homedir()}/.claude/skills`);
    });

    it('routes claude-code local skills correctly', () => {
        const result = getTargetPath('skill', 'claude-code', 'local');
        expect(result).toBe('.claude/skills');
    });

    it('routes claude-code global agents correctly', () => {
        const result = getTargetPath('agent', 'claude-code', 'global');
        expect(result).toBe(`${os.homedir()}/.claude/agents`);
    });

    it('routes claude-code local agents correctly', () => {
        const result = getTargetPath('agent', 'claude-code', 'local');
        expect(result).toBe('.claude/agents');
    });

    it('throws on claude-code workflow', () => {
        expect(() => getTargetPath('workflow', 'claude-code', 'global')).toThrow('not supported');
    });

    it('throws on unknown agent target', () => {
        expect(() => getTargetPath('skill', 'unknown-agent' as any, 'global')).toThrow('Unknown agent target');
    });

    // ── PROVIDERS map structure tests ──
    it('exports PROVIDERS with all three targets', () => {
        expect(Object.keys(PROVIDERS)).toEqual(
            expect.arrayContaining(['antigravity', 'opencode', 'claude-code'])
        );
    });

    it('marks unsupported artifact types as null', () => {
        expect(PROVIDERS['antigravity'].agent).toBeNull();
        expect(PROVIDERS['opencode'].workflow).toBeNull();
        expect(PROVIDERS['claude-code'].workflow).toBeNull();
    });
});
