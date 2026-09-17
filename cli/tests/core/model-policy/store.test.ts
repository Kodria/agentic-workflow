import fs from 'fs';
import os from 'os';
import path from 'path';
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
    afterEach(() => { jest.restoreAllMocks(); if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; if (oldAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = oldAwmHome; fs.rmSync(root, { recursive: true, force: true }); });
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
