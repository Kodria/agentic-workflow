import { queryCodexMachineFacts } from '../../../src/core/model-policy/native-codex-machine';

describe('Codex machine facts', () => {
    it('hashes effective config and ChatGPT account scope without returning identifiers', async () => {
        const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
  if (request.method === 'config/read') process.stdout.write(JSON.stringify({ id: request.id, result: { config: { model: 'gpt-6-sol', model_reasoning_effort: 'medium' }, origins: {} } }) + '\\n');
  if (request.method === 'account/read') process.stdout.write(JSON.stringify({ id: request.id, result: { account: { type: 'chatgpt', email: 'secret@example.com', planType: 'pro' }, requiresOpenaiAuth: true } }) + '\\n');
});`;
        const input = { command: process.execPath, args: ['-e', server], timeoutMs: 5000, cwd: process.cwd(), key: Buffer.alloc(32, 7) };
        const first = await queryCodexMachineFacts(input);
        const second = await queryCodexMachineFacts(input);
        expect(first).toEqual(second);
        expect(first).toMatchObject({ provenance: 'codex-app-server-config-account', accountState: 'identified', configDigest: expect.stringMatching(/^[a-f0-9]{64}$/), accountScopeDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(JSON.stringify(first)).not.toContain('secret@example.com');
    });

    it('keeps API-key account identity unverified instead of equating all keys', async () => {
        const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
  if (request.method === 'config/read') process.stdout.write(JSON.stringify({ id: request.id, result: { config: {}, origins: {} } }) + '\\n');
  if (request.method === 'account/read') process.stdout.write(JSON.stringify({ id: request.id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true } }) + '\\n');
});`;
        await expect(queryCodexMachineFacts({ command: process.execPath, args: ['-e', server], timeoutMs: 5000, cwd: process.cwd(), key: Buffer.alloc(32, 7) })).resolves.toMatchObject({ accountState: 'unverified', accountScopeDigest: null });
    });
});
