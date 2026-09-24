import { queryClaudeAuthStatus } from '../../../src/core/model-policy/native-claude-machine';

describe('Claude Code read-only account discovery', () => {
    const key = Buffer.alloc(32, 7);
    it('HMACs a logged-in identity without returning the email or starting a model', async () => {
        const response = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'owner@example.test', orgId: 'org-1', subscriptionType: 'max' };
        const script = `process.stdout.write(${JSON.stringify(JSON.stringify(response))})`;
        const facts = await queryClaudeAuthStatus({ command: process.execPath, args: ['-e', script], timeoutMs: 5000, key });
        expect(facts).toMatchObject({ provenance: 'claude-auth-status', accountState: 'identified', inferenceDispatched: false });
        expect(facts.accountScopeDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(facts)).not.toContain(response.email);
    });
    it('keeps missing account fields unverified instead of inventing a scope', async () => {
        const script = `process.stdout.write('${JSON.stringify({ loggedIn: true, authMethod: 'apiKey', apiProvider: 'firstParty' })}')`;
        expect(await queryClaudeAuthStatus({ command: process.execPath, args: ['-e', script], timeoutMs: 5000, key })).toMatchObject({ accountState: 'unverified', accountScopeDigest: null });
    });
});
