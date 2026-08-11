import fs from 'fs';
import path from 'path';

const evidenceDir = path.resolve(__dirname, '../../../docs/research/r2/evidence');
const runner = path.resolve(__dirname, '../../../docs/research/r2/provider-run.mjs');
const providers = ['claude-code', 'codex'] as const;
type Provider = typeof providers[number];

type Evidence = {
    schema: 1;
    provider: Provider;
    result: 'pass' | 'partial' | 'fail';
    sourceHead: string;
    command: string;
    reportSha256?: string;
    semanticContract?: unknown;
};

function read(provider: Provider): Evidence | null {
    const file = path.join(evidenceDir, `${provider}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Evidence : null;
}

describe('R2 provider evidence integrity', () => {
    it('locates the repository root from docs/research/r2 before invoking the compiled CLI', () => {
        expect(fs.readFileSync(runner, 'utf8')).toContain("fileURLToPath(import.meta.url)), '../../..')");
    });

    it.each(providers)('%s evidence, when recorded, is sanitized and well formed (RNF-T.2)', (provider) => {
        const value = read(provider);
        if (value === null) return;
        expect(value).toMatchObject({ schema: 1, provider });
        expect(['pass', 'partial', 'fail']).toContain(value.result);
        expect(value.sourceHead).toMatch(/^[0-9a-f]{40}$/);
        expect(value.command).toBe('node cli/dist/src/index.js sensors coverage --json');
        const serialized = JSON.stringify(value);
        expect(serialized).not.toMatch(/\/home\/[^/"\s]+|\/Users\/[^/"\s]+|\b(?:token|secret|password|api[-_]?key)\b"?\s*[:=]/i);
        if (value.result === 'pass') {
            expect(value.reportSha256).toMatch(/^[0-9a-f]{64}$/);
            expect(value.semanticContract).toBeDefined();
        }
    });

    it('compares exactly the two real pass envelopes when both providers have certified (RNF-T.2)', () => {
        const claude = read('claude-code');
        const codex = read('codex');
        if (claude?.result !== 'pass' || codex?.result !== 'pass') return;
        expect(claude.sourceHead).toBe(codex.sourceHead);
        expect(claude.semanticContract).toEqual(codex.semanticContract);
    });
});
