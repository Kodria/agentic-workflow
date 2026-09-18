import fs from 'fs';
import os from 'os';
import path from 'path';
import { fsyncDirSync } from '../../../src/core/atomic-file';
import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { approvePolicyWithBoundary, readEffectivePolicy, type ApprovePolicyInput, type PolicyStoreBoundary } from '../../../src/core/model-policy/store';
import { userPolicyPath } from '../../../src/core/model-policy/paths';
import type { PolicyContent } from '../../../src/core/model-policy/types';
import type { FileIdentityToken } from '../../../src/core/secure-fs/native-bridge';

const policy = (): PolicyContent => ({ schema: 'model-policy/v1', mappings: [{ target: 'codex', runtimeKind: 'native', profiles: {
    mechanical: { selector: { kind: 'model', id: 'gpt-5.6-luna' }, effort: { kind: 'explicit', value: 'medium' } },
    integration: { selector: { kind: 'model', id: 'gpt-5.6-terra' }, effort: { kind: 'explicit', value: 'medium' } },
    judgment: { selector: { kind: 'model', id: 'gpt-5.6-sol' }, effort: { kind: 'explicit', value: 'medium' } },
}, fullCapability: { selector: { kind: 'model', id: 'gpt-5.6-sol' }, effort: { kind: 'explicit', value: 'high' } }, degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } }], implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } });

function createIdentityFencedBoundary(): PolicyStoreBoundary {
    const observations = new WeakMap<object, { file: string; bytes: Buffer }>();
    return {
    withProjectLease: <T,>(_root: string, operation: () => T): T => operation(),
    readRegularFile: (file: string) => {
        const identity = Object.freeze({}) as FileIdentityToken;
        const bytes = fs.readFileSync(file); observations.set(identity, { file, bytes });
        return { bytes, identity };
    },
    writeProjectTransaction: (root: string, destination: string, content: Buffer, options) => {
        const file = path.join(root, destination); fs.mkdirSync(path.dirname(file), { recursive: true });
        if (options.mode === 'create' && fs.existsSync(file)) throw new Error('project destination already exists');
        if (options.mode === 'replace') {
            const observed = observations.get(options.expectedIdentity);
            if (!observed || observed.file !== file || !observed.bytes.equals(options.expected) || !fs.readFileSync(file).equals(options.expected)) throw new Error('original changed before fenced replacement');
        }
        const temporary = `${file}.test-tmp`; const fd = fs.openSync(temporary, 'wx', 0o600);
        try {
            fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd);
            fs.renameSync(temporary, file);
            // La durabilidad de la ENTRADA publicada se pide por el unico helper
            // que define esa politica (atomic-file.fsyncDirSync): fail-closed en
            // POSIX y degradado SOLO ante el gap conocido de win32 (EPERM al
            // fsync-ear un fd de directorio, capacidad que el SO no expone).
            // Reimplementarla aca la hacia divergir y rompia la matriz Windows.
            fsyncDirSync(path.dirname(file));
        }
        finally { try { fs.rmSync(temporary, { force: true }); } catch { /* preserve transaction result */ } }
    },
}; }
const identityFencedBoundary = createIdentityFencedBoundary();
const approve = (input: ApprovePolicyInput) => approvePolicyWithBoundary(input, identityFencedBoundary);

describe('approved policy store', () => {
    let root: string; let oldHome: string | undefined; let oldAwmHome: string | undefined;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-policy-')); oldHome = process.env.HOME; oldAwmHome = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator'); });
    afterEach(() => { jest.restoreAllMocks(); delete process.env.POLICY_TEST_FAIL_WRITE; delete process.env.POLICY_TEST_MUTATE_DURING_REPLACE; if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; if (oldAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = oldAwmHome; fs.rmSync(root, { recursive: true, force: true }); });
    const candidate = (): string => { const file = path.join(root, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(policy())); return file; };

    it('publishes only an expected digest and reads it without creating state', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        expect(readEffectivePolicy(root)).toEqual({ state: 'absent' });
        const approved = approve({ file, scope: 'user', cwd: root, expectedDigest: digest });
        expect(approved.contentDigest).toBe(digest);
        expect(readEffectivePolicy(root)).toMatchObject({ state: 'approved', provenance: 'user', policy: { contentDigest: digest } });
    });

    it('rejects a mismatched digest before writing', () => {
        const file = candidate();
        expect(() => approve({ file, scope: 'user', cwd: root, expectedDigest: '0'.repeat(64) })).toThrow(/digest/i);
        expect(fs.existsSync(userPolicyPath())).toBe(false);
    });

    it('allows exactly one initial writer and exact CAS replacement', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        approve({ file, scope: 'user', cwd: root, expectedDigest: digest });
        expect(() => approve({ file, scope: 'user', cwd: root, expectedDigest: digest })).toThrow(/replace|existing/i);
        expect(() => approve({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: 'f'.repeat(64) })).toThrow(/predecessor|replace/i);
        expect(approve({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: digest }).lineage.previousDigest).toBe(digest);
    });

    it('rejects an unexpected opaque identity token before replacing bytes', () => {
        const target = path.join(root, 'identity.json'); fs.writeFileSync(target, 'observed');
        const observed = identityFencedBoundary.readRegularFile(target, 1024);
        expect(() => identityFencedBoundary.writeProjectTransaction(root, 'identity.json', Buffer.from('replacement'), {
            mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: Object.freeze({}) as FileIdentityToken,
        })).toThrow(/original changed/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('observed');
    });

    it('resolves a relative candidate through cwd instead of process cwd', () => {
        const cwd = path.join(root, 'project'); fs.mkdirSync(cwd); const file = path.join(cwd, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(policy()));
        const digest = canonicalPolicyDigest(policy());
        expect(approve({ file: 'candidate.json', scope: 'project', cwd, expectedDigest: digest }).contentDigest).toBe(digest);
    });

    it('accepts exactly one of two competing fenced replacements', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy()); approve({ file, scope: 'user', cwd: root, expectedDigest: digest });
        const input = { file, scope: 'user' as const, cwd: root, expectedDigest: digest, replaceDigest: digest };
        let entered = false; let accepted = 0;
        const boundary: PolicyStoreBoundary = {
            withProjectLease: <T,>(_root: string, operation: () => T): T => operation(),
            readRegularFile: (target: string) => ({ bytes: fs.readFileSync(target), identity: Object.freeze({}) as FileIdentityToken }),
            writeProjectTransaction: (base: string, destination: string, bytes: Buffer, options: { mode: 'create' | 'replace'; expected?: Buffer }) => {
                const target = path.join(base, destination);
                if (options.mode === 'replace' && !entered) {
                    entered = true;
                    // Model a non-cooperating external process: the native
                    // identity fence, not this advisory lock, must reject us.
                    fs.rmSync(`${target}.lock`);
                    approvePolicyWithBoundary(input, boundary);
                    fs.writeFileSync(`${target}.lock`, 'outer lock placeholder');
                }
                if (options.mode === 'replace' && (!options.expected || !fs.readFileSync(target).equals(options.expected))) throw new Error('original changed before fenced replacement');
                fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); accepted++;
            },
        };
        expect(() => approvePolicyWithBoundary(input, boundary)).toThrow(/changed|replacement/i);
        expect(accepted).toBe(1);
    });

    it('returns a failed publication and preserves predecessor bytes on injected transaction failure', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy()); approve({ file, scope: 'user', cwd: root, expectedDigest: digest });
        const before = fs.readFileSync(userPolicyPath());
        const boundary: PolicyStoreBoundary = {
            withProjectLease: <T,>(_root: string, operation: () => T): T => operation(),
            readRegularFile: (target: string) => ({ bytes: fs.readFileSync(target), identity: Object.freeze({}) as FileIdentityToken }),
            writeProjectTransaction: () => { throw new Error('injected durable publication failure'); },
        };
        expect(() => approvePolicyWithBoundary({ file, scope: 'user', cwd: root, expectedDigest: digest, replaceDigest: digest }, boundary)).toThrow(/publication failure/);
        expect(fs.readFileSync(userPolicyPath()).equals(before)).toBe(true);
    });

    it('blocks an invalid project policy instead of falling back to a valid user policy', () => {
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        approve({ file, scope: 'user', cwd: root, expectedDigest: digest });
        fs.mkdirSync(path.join(root, '.awm')); fs.writeFileSync(path.join(root, '.awm', 'model-policy.json'), '{"content":');
        expect(readEffectivePolicy(root)).toMatchObject({ state: 'invalid', provenance: 'project' });
    });

    it('rejects duplicate JSON keys and symlinked parent or destination without touching the target', () => {
        const duplicate = path.join(root, 'duplicate.json'); fs.writeFileSync(duplicate, '{"schema":"model-policy/v1","schema":"model-policy/v1"}');
        expect(() => approve({ file: duplicate, scope: 'user', cwd: root, expectedDigest: 'a'.repeat(64) })).toThrow(/duplicate/i);
        const file = candidate(); const digest = canonicalPolicyDigest(policy());
        fs.mkdirSync(process.env.AWM_HOME!); fs.symlinkSync(root, path.join(process.env.AWM_HOME!, 'link'));
        const target = userPolicyPath(); fs.symlinkSync(path.join(root, 'outside'), target);
        expect(() => approve({ file, scope: 'user', cwd: root, expectedDigest: digest })).toThrow(/symlink/i);
    });
});
