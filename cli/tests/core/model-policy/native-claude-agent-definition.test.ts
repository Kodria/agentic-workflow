import fs from 'fs';
import os from 'os';
import path from 'path';
import { readClaudeAgentDeclaredModel } from '../../../src/core/model-policy/native-claude-agent-definition';

describe('Claude custom-agent declared model', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-agent-'));
    const cwd = path.join(root, 'project'); const configDir = path.join(root, 'config');
    const directory = path.join(configDir, 'agents');
    beforeAll(() => { fs.mkdirSync(cwd); fs.mkdirSync(directory, { recursive: true }); });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
    afterEach(() => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); });
    it('requires an explicit full ID on the matching native agent type', () => {
        fs.writeFileSync(path.join(directory, 'integration.md'), '---\nname: awm-integration\ndescription: work\nmodel: claude-sonnet-4-6\n---\n');
        expect(readClaudeAgentDeclaredModel({ cwd, configDir, agentType: 'awm-integration' })).toEqual({ agentType: 'awm-integration', modelId: 'claude-sonnet-4-6' });
        expect(() => readClaudeAgentDeclaredModel({ cwd, configDir, agentType: 'awm-missing' })).toThrow(/no explicit custom definition/);
    });
    it('rejects aliases, inherit, duplicate definitions and unsafe paths', () => {
        fs.writeFileSync(path.join(directory, 'integration.md'), '---\nname: awm-integration\ndescription: work\nmodel: sonnet\n---\n');
        expect(() => readClaudeAgentDeclaredModel({ cwd, configDir, agentType: 'awm-integration' })).toThrow(/full model ID/);
        fs.writeFileSync(path.join(directory, 'integration.md'), '---\nname: awm-integration\ndescription: work\nmodel: claude-sonnet-4-6\n---\n');
        fs.writeFileSync(path.join(directory, 'duplicate.md'), '---\nname: awm-integration\ndescription: work\nmodel: claude-sonnet-4-6\n---\n');
        expect(() => readClaudeAgentDeclaredModel({ cwd, configDir, agentType: 'awm-integration' })).toThrow(/ambiguous/);
    });
});
