import fs from 'fs';
import os from 'os';
import path from 'path';
jest.mock('../../../src/core/secure-fs/native-bridge', () => ({
    secureFs: {
        withProjectLease: (_root: string, operation: () => unknown) => operation(),
        readRegularFile: (file: string) => ({ bytes: fs.readFileSync(file), identity: Object.freeze({ file }) }),
        writeProjectTransaction: (root: string, destination: string, content: Buffer, options: { mode: 'create' | 'replace'; expected?: Buffer }) => {
            if (process.env.POLICY_TEST_FAIL_WRITE === '1') throw new Error('injected transaction failure');
            const file = path.join(root, destination);
            if (process.env.POLICY_TEST_MUTATE_DURING_REPLACE === '1' && options.mode === 'replace') fs.writeFileSync(file, 'external mutation');
            if (options.mode === 'create' && fs.existsSync(file)) throw new Error('project destination already exists');
            if (options.mode === 'replace' && (!options.expected || !fs.readFileSync(file).equals(options.expected))) throw new Error('original changed before fenced replacement');
            fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, { mode: 0o600 });
        },
    },
}));
import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { approvePolicy, readEffectivePolicy } from '../../../src/core/model-policy/store';
import { userPolicyPath } from '../../../src/core/model-policy/paths';
import type { PolicyContent } from '../../../src/core/model-policy/types';

const policy = (): PolicyContent => ({ schema: 'model-policy/v1', mappings: [{ target: 'codex', runtimeKind: 'native', profiles: {
    mechanical: { selector: { kind: 'model', id: 'gpt-5.6-luna' }, effort: { kind: 'explicit', value: 'medium' } },
    integration: { selector: { kind: 'model', id: 'gpt-5.6-terra' }, effort: { kind: 'explicit', value: 'medium' } },
    judgment: { selector: { kind: 'model', id: 'gpt-5.6-sol' }, effort: { kind: 'explicit', value: 'medium' } },
}, fullCapability: { selector: { kind: 'model', id: 'gpt-5.6-sol' }, effort: { kind: 'explicit', value: 'high' } }, degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } }], implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } });

describe('approved policy store', () => {
    let root: string; let oldHome: string | undefined; let oldAwmHome: string | undefined;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-policy-')); oldHome = process.env.HOME; oldAwmHome = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator'); });
    afterEach(() => { jest.restoreAllMocks(); delete process.env.POLICY_TEST_FAIL_WRITE; delete process.env.POLICY_TEST_MUTATE_DURING_REPLACE; if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; if (oldAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = oldAwmHome; fs.rmSync(root, { recursive: true, force: true }); });
    const candidate = (): string => { const file = path.join(root, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(policy())); return file; };

    it('publishes only an expected digest and reads it without creating state', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        expect(readEffectivePolicy(root)).toEqual({ state: 'absent' });
        const approved = approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest });
        expect(approved.contentDigest).toBe(digest);
        expect(readEffectivePolicy(root)).toMatchObject({ state: 'approved', provenance: 'user', policy: { contentDigest: digest } });
    });

    it('rejects a mismatched digest before writing', () => {
        const file = candidate();
        expect(() => approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: '0'.repeat(64) })).toThrow(/digest/i);
        expect(fs.existsSync(userPolicyPath())).toBe(false);
    });

    it('allows exactly one initial writer and exact CAS replacement', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest });
        expect(() => approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest })).toThrow(/replace|existing/i);
        expect(() => approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: 'f'.repeat(64) })).toThrow(/predecessor|replace/i);
        expect(approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: digest }).lineage.previousDigest).toBe(digest);
    });

    it('resolves a relative candidate through cwd instead of process cwd', () => {
        const cwd = path.join(root, 'project'); fs.mkdirSync(cwd); const file = path.join(cwd, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(policy()));
        const digest = canonicalPolicyDigest(policy());
        expect(approvePolicy({ file: 'candidate.json', scope: 'project', cwd, expectedDigest: digest }).contentDigest).toBe(digest);
    });

    it('preserves predecessor bytes when a replace publication fails', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy()); approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest });
        const destination = userPolicyPath(); const before = fs.readFileSync(destination);
        process.env.POLICY_TEST_FAIL_WRITE = '1';
        expect(() => approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: digest })).toThrow();
        expect(fs.readFileSync(destination).equals(before)).toBe(true);
    });

    it('accepts exactly one replacement when an external writer mutates the fenced predecessor', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy()); approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest });
        process.env.POLICY_TEST_MUTATE_DURING_REPLACE = '1';
        expect(() => approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: digest })).toThrow(/changed|replacement/i);
        expect(fs.readFileSync(userPolicyPath(), 'utf8')).toBe('external mutation');
    });

    it('blocks an invalid project policy instead of falling back to a valid user policy', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest });
        fs.mkdirSync(path.join(root, '.awm')); fs.writeFileSync(path.join(root, '.awm', 'model-policy.json'), '{"content":');
        expect(readEffectivePolicy(root)).toMatchObject({ state: 'invalid', provenance: 'project' });
    });

    it('rejects duplicate JSON keys and symlinked parent or destination without touching the target', () => {
        const duplicate = path.join(root, 'duplicate.json'); fs.writeFileSync(duplicate, '{"schema":"model-policy/v1","schema":"model-policy/v1"}');
        expect(() => approvePolicy({ file: duplicate, scope: 'user', cwd: root, expectedDigest: 'a'.repeat(64) })).toThrow(/duplicate/i);
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        fs.mkdirSync(process.env.AWM_HOME!); fs.symlinkSync(root, path.join(process.env.AWM_HOME!, 'link'));
        const target = userPolicyPath(); fs.symlinkSync(path.join(root, 'outside'), target);
        expect(() => approvePolicy({ file, scope: 'user', cwd: root, expectedDigest: digest })).toThrow(/symlink/i);
    });
});
