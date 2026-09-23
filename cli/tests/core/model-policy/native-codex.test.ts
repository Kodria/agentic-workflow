import { normalizeCodexModelCatalog, queryCodexModelCatalog } from '../../../src/core/model-policy/native-codex';

describe('Codex native model discovery', () => {
    const response = () => ({
        data: [
            { id: 'gpt-6-sol', model: 'gpt-6-sol', hidden: false, isDefault: true,
                defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
                    { reasoningEffort: 'medium', description: 'balanced' },
                    { reasoningEffort: 'high', description: 'deep' },
                ] },
        ], nextCursor: null,
    });

    it('normalizes catalog selections without certifying dispatch or actual model identity', () => {
        expect(normalizeCodexModelCatalog(response())).toEqual({
            provenance: 'native-catalog',
            selections: [
                { selector: { kind: 'model', id: 'gpt-6-sol' }, effort: { kind: 'explicit', value: 'medium' } },
                { selector: { kind: 'model', id: 'gpt-6-sol' }, effort: { kind: 'explicit', value: 'high' } },
            ],
            nativeDispatchVerified: false,
            actualModelVerified: false,
        });
    });

    it('rejects malformed and duplicate native catalog data instead of inventing selections', () => {
        expect(() => normalizeCodexModelCatalog({ data: [{ ...response().data[0], model: '' }] })).toThrow(/model/i);
        expect(() => normalizeCodexModelCatalog({ data: [response().data[0], response().data[0]] })).toThrow(/duplicate/i);
        expect(() => normalizeCodexModelCatalog({ data: [
            { ...response().data[0], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
        ] })).toThrow(/effort/i);
    });

    it('reads the native model/list protocol without starting a model turn', async () => {
        const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: { userAgent: 'fake' } }) + '\\n');
  if (request.method === 'model/list') process.stdout.write(JSON.stringify({ id: request.id, result: ${JSON.stringify(response())} }) + '\\n');
});`;
        const result = await queryCodexModelCatalog({ command: process.execPath, args: ['-e', server], timeoutMs: 5000 });
        expect(result.selections).toHaveLength(2);
        expect(result.nativeDispatchVerified).toBe(false);
    });

    it('fails closed on an invalid native response', async () => {
        const server = `process.stdin.on('data', () => process.stdout.write('not-json\\n'));`;
        await expect(queryCodexModelCatalog({ command: process.execPath, args: ['-e', server], timeoutMs: 5000 })).rejects.toThrow(/protocol|JSON/i);
    });
});
