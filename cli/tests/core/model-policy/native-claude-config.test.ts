import fs from 'fs';
import os from 'os';
import path from 'path';
import { readClaudeModelConfigDigest } from '../../../src/core/model-policy/native-claude-config';

describe('Claude local model config fingerprint', () => {
    it('changes only when model-relevant settings change and never returns settings content', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-config-'));
        const configDir = path.join(root, 'home'); const cwd = path.join(root, 'project');
        fs.mkdirSync(configDir); fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
        const settings = path.join(cwd, '.claude', 'settings.json');
        fs.writeFileSync(settings, JSON.stringify({ model: 'claude-sonnet-4-6', permissions: { allow: ['Read'] } }));
        const key = Buffer.alloc(32, 7);
        try {
            const first = readClaudeModelConfigDigest({ cwd, configDir, key, environment: {} });
            expect(first).toMatch(/^[a-f0-9]{64}$/);
            fs.writeFileSync(settings, JSON.stringify({ model: 'claude-sonnet-4-6', permissions: { allow: ['Read', 'Edit'] } }));
            expect(readClaudeModelConfigDigest({ cwd, configDir, key, environment: {} })).toBe(first);
            fs.writeFileSync(settings, JSON.stringify({ model: 'claude-opus-4-7', permissions: { allow: ['Read', 'Edit'] } }));
            expect(readClaudeModelConfigDigest({ cwd, configDir, key, environment: {} })).not.toBe(first);
            const agents = path.join(cwd, '.claude', 'agents'); fs.mkdirSync(agents);
            const beforeAgent = readClaudeModelConfigDigest({ cwd, configDir, key, environment: {} });
            fs.writeFileSync(path.join(agents, 'reviewer.md'), '---\nmodel: claude-sonnet-4-6\n---\n');
            expect(readClaudeModelConfigDigest({ cwd, configDir, key, environment: {} })).not.toBe(beforeAgent);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('rejects a symlinked settings file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-config-'));
        const configDir = path.join(root, 'home'); const cwd = path.join(root, 'project');
        fs.mkdirSync(configDir); fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
        const outside = path.join(root, 'outside.json'); fs.writeFileSync(outside, '{}');
        fs.symlinkSync(outside, path.join(cwd, '.claude', 'settings.json'));
        try { expect(() => readClaudeModelConfigDigest({ cwd, configDir, key: Buffer.alloc(32, 7), environment: {} })).toThrow(/symlink|unsafe/i); }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
