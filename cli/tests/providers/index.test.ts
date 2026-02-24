// tests/providers/index.test.ts
import { getTargetPath } from '../../src/providers';
import os from 'os';

describe('Providers Routing', () => {
    it('routes antigravity global skills correctly', () => {
        const path = getTargetPath('skill', 'antigravity', 'global');
        expect(path).toBe(`${os.homedir()}/.agents/skills`);
    });

    it('routes opencode local skills correctly', () => {
        const path = getTargetPath('skill', 'opencode', 'local');
        expect(path).toBe(`.agents/skills`);
    });

    it('routes antigravity global workflows correctly', () => {
        const path = getTargetPath('workflow', 'antigravity', 'global');
        expect(path).toBe(`${os.homedir()}/.gemini/antigravity/global_workflows`);
    });
    
    it('throws on opencode workflow', () => {
        expect(() => getTargetPath('workflow', 'opencode', 'global')).toThrow();
    });
});
