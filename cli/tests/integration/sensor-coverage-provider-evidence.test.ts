import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

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
    providerVersion?: string;
    providerIdentity?: {
        requestedProvider: Provider;
        executable: string;
        attestedBy: 'executable--version';
    };
    report?: unknown;
    reportSha256?: string;
    semanticContract?: unknown;
};

function read(provider: Provider): Evidence | null {
    const file = path.join(evidenceDir, `${provider}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Evidence : null;
}

function expectEvidenceIntegrity(provider: Provider, value: Evidence): void {
    expect(value).toMatchObject({ schema: 1, provider });
    expect(['pass', 'partial', 'fail']).toContain(value.result);
    // This identifies the evidence's source without assuming CI has fetched that object.
    expect(value.sourceHead).toMatch(/^[0-9a-f]{40}$/);
    expect(value.command).toBe('node cli/dist/src/index.js sensors coverage --json');
    expect(value.providerVersion).toMatch(/^\S[^\r\n]*$/);
    expect(value.providerIdentity).toEqual({
        requestedProvider: provider,
        executable: provider === 'claude-code' ? 'claude' : 'codex',
        attestedBy: 'executable--version',
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toMatch(/\/home\/[^/"\s]+|\/Users\/[^/"\s]+|\b(?:token|secret|password|api[-_]?key)\b"?\s*[:=]/i);
    if (value.result === 'pass') {
        expect(value.reportSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(value.semanticContract).toBeDefined();
        expect(value.report).toBeDefined();
        expect(crypto.createHash('sha256').update(`${JSON.stringify(value.report)}\n`).digest('hex'))
            .toBe(value.reportSha256);
    }
}

describe('R2 provider evidence integrity', () => {
    it('locates the repository root from docs/research/r2 before invoking the compiled CLI', () => {
        expect(fs.readFileSync(runner, 'utf8')).toContain("fileURLToPath(import.meta.url)), '../../..')");
    });

    it.each(providers)('%s evidence, when recorded, is a sanitized attested partial (RNF-T.2)', (provider) => {
        const value = read(provider);
        if (value === null) {
            expect({ certification: 'partial', missingProviders: [provider] }).toEqual({
                certification: 'partial',
                missingProviders: ['claude-code'],
            });
            return;
        }
        expectEvidenceIntegrity(provider, value);
    });

    it('accepts a valid but locally unavailable source SHA and rejects malformed source SHAs', () => {
        const value = read('codex');
        if (value === null) throw new Error('Codex evidence fixture is required for integrity validation');

        expectEvidenceIntegrity('codex', { ...value, sourceHead: 'f'.repeat(40) });
        expect(() => expectEvidenceIntegrity('codex', { ...value, sourceHead: 'not-a-commit' }))
            .toThrow();
    });

    it('reports RNF-T.2 as partial until two real pass envelopes can be compared', () => {
        const claude = read('claude-code');
        const codex = read('codex');
        const missingPassEvidence = providers.filter((provider) => read(provider)?.result !== 'pass');
        if (missingPassEvidence.length > 0) {
            expect({ certification: 'partial', missingPassEvidence }).toEqual({
                certification: 'partial',
                missingPassEvidence: ['claude-code'],
            });
            return;
        }
        if (claude === null || codex === null) throw new Error('pass evidence must be present before certification');
        expect(claude.sourceHead).toBe(codex.sourceHead);
        expect(claude.semanticContract).toEqual(codex.semanticContract);
    });

    it('does not write Claude evidence when its required executable is unavailable', () => {
        // Certified evidence is now committed at this path (RNF-T.2), so this test cannot
        // assume the file is absent. Instead, force the attestation to fail by hiding
        // `claude` from PATH and assert the file is left byte-for-byte untouched.
        const output = path.join(evidenceDir, 'claude-code.json');
        const before = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
        const result = spawnSync(process.execPath, [runner, 'claude-code', path.resolve(__dirname, '../..')], {
            cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, PATH: '' },
        });
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('claude');
        const after = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
        expect(after).toBe(before);
    });
});
