import fs from 'fs';
import os from 'os';
import path from 'path';
import { candidateDigest } from '../../../src/core/model-policy/digest';
import { approvePolicyWithBoundary, type PolicyStoreBoundary } from '../../../src/core/model-policy/store';
import { approveCapabilities } from '../../../src/core/model-policy/capabilities';
import type { FileIdentityToken } from '../../../src/core/secure-fs/native-bridge';
import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { capabilityReceiptDigest } from '../../../src/core/model-policy/capabilities';
import type { CapabilityReceipt, PolicyContent } from '../../../src/core/model-policy/types';

const sha = 'a'.repeat(64);
const policy = (): PolicyContent => ({ schema: 'model-policy/v1', mappings: [{ target: 'codex', runtimeKind: 'native', profiles: {
    mechanical: { selector: { kind: 'model', id: 'gpt-5.6-luna' }, effort: { kind: 'explicit', value: 'medium' } },
    integration: { selector: { kind: 'model', id: 'gpt-5.6-terra' }, effort: { kind: 'explicit', value: 'medium' } },
    judgment: { selector: { kind: 'model', id: 'gpt-5.6-sol' }, effort: { kind: 'explicit', value: 'medium' } },
}, fullCapability: { selector: { kind: 'model', id: 'gpt-5.6-sol' }, effort: { kind: 'explicit', value: 'high' } }, degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } }], implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } });
const receipt = (): CapabilityReceipt => ({
    schema: 'routing-capabilities/v1',
    runtime: { target: 'codex', kind: 'native', version: '1.0.0', accountScopeDigest: sha },
    recordedAt: '2026-09-17T00:00:00.000Z', expiresAt: '2026-09-18T00:00:00.000Z',
    capabilities: { artifactDelivery: 'unverified', interactiveExecution: 'supported', unattendedController: 'supported', nativeSubagents: 'unverified', modelOverride: 'supported', effortOverride: 'supported', observedModelEvidence: 'supported', durableResume: 'unverified' },
    availableSelections: [{ selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } }],
    runtimeDefaultSelection: { selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } },
    evidence: (['interactiveExecution', 'unattendedController', 'modelOverride', 'effortOverride', 'observedModelEvidence'] as const).map(capability => ({ capability, kind: 'native-control' as const, receiptDigest: sha })),
    approval: { approvalId: 'approval-1', snapshotDigest: sha },
});

describe('candidateDigest', () => {
    let cwd: string; const home = process.env.HOME; const awmHome = process.env.AWM_HOME;
    beforeEach(() => { cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'awm-digest-')); process.env.HOME = cwd; process.env.AWM_HOME = path.join(cwd, '.awm'); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); if (home === undefined) delete process.env.HOME; else process.env.HOME = home; if (awmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = awmHome; });
    const write = (name: string, value: unknown): string => { const file = path.join(cwd, name); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return name; };

    it('emits the digest the policy approval path will demand, not a second opinion', () => {
        const file = write('policy.json', policy());
        expect(candidateDigest({ file, cwd })).toEqual({ schema: 'model-policy/v1', digest: canonicalPolicyDigest(policy()) });
    });
    it('emits the digest the capability approval path will demand', () => {
        const file = write('receipt.json', receipt());
        expect(candidateDigest({ file, cwd })).toEqual({ schema: 'routing-capabilities/v1', digest: capabilityReceiptDigest(receipt()) });
    });
    it('is insensitive to key order and whitespace, because the digest is over the canonical form', () => {
        const content = policy(); const reordered = { implementationBudget: content.implementationBudget, mappings: content.mappings, schema: content.schema };
        fs.writeFileSync(path.join(cwd, 'a.json'), JSON.stringify(content));
        fs.writeFileSync(path.join(cwd, 'b.json'), JSON.stringify(reordered, null, 4));
        expect(candidateDigest({ file: 'a.json', cwd }).digest).toBe(candidateDigest({ file: 'b.json', cwd }).digest);
    });
    it('refuses a document whose declared schema it does not own, instead of guessing', () => {
        const file = write('other.json', { schema: 'approved-model-policy/v1' });
        expect(() => candidateDigest({ file, cwd })).toThrow(/schema model-policy\/v1 or routing-capabilities\/v1/);
    });
    it('refuses an invalid document rather than emitting a digest approval would reject', () => {
        const broken = policy() as unknown as Record<string, unknown>; delete broken.implementationBudget;
        const file = write('broken.json', broken);
        expect(() => candidateDigest({ file, cwd })).toThrow();
    });
    it('reports an absent candidate loudly', () => {
        expect(() => candidateDigest({ file: 'missing.json', cwd })).toThrow(/absent/);
    });
    it('refuses a symlinked candidate, matching the approval path', () => {
        write('policy.json', policy()); fs.symlinkSync(path.join(cwd, 'policy.json'), path.join(cwd, 'link.json'));
        expect(() => candidateDigest({ file: 'link.json', cwd })).toThrow(/unsafe/);
    });
    it('rejects malformed input instead of returning undefined', () => {
        expect(() => candidateDigest(undefined as never)).toThrow(/digest input is required/);
        expect(() => candidateDigest({ file: '', cwd })).toThrow(/bounded path/);
        expect(() => candidateDigest({ file: 'policy.json', cwd: '' })).toThrow(/bounded path/);
        fs.writeFileSync(path.join(cwd, 'array.json'), '[]');
        expect(() => candidateDigest({ file: 'array.json', cwd })).toThrow(/must be a JSON object/);
    });
    // The point of the command: the digest it discloses is the one approval
    // demands. A digest that merely looked plausible would be worthless, so the
    // proof is that approval ACCEPTS it, not that two functions agree.
    it('produces a digest that the policy approval path accepts end to end', () => {
        const file = write('policy.json', policy());
        const observed: Array<{ bytes: Buffer; identity: FileIdentityToken }> = [];
        const boundary: PolicyStoreBoundary = {
            withProjectLease: <T,>(_root: string, operation: () => T): T => operation(),
            readRegularFile: (target: string) => { const entry = { bytes: fs.readFileSync(target), identity: Object.freeze({}) as FileIdentityToken }; observed.push(entry); return entry; },
            writeProjectTransaction: (root: string, destination: string, content: Buffer) => { const target = path.join(root, destination); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); },
        };
        const approved = approvePolicyWithBoundary({ file, scope: 'project', cwd, expectedDigest: candidateDigest({ file, cwd }).digest }, boundary);
        expect(approved.contentDigest).toBe(candidateDigest({ file, cwd }).digest);
        expect(JSON.parse(fs.readFileSync(path.join(cwd, '.awm', 'model-policy.json'), 'utf8')).contentDigest).toBe(approved.contentDigest);
    });
    it('produces a digest that the capability approval path accepts end to end', () => {
        const value = receipt(); const file = write('receipt.json', value);
        const approved = approveCapabilities({ file, cwd, expectedDigest: candidateDigest({ file, cwd }).digest, now: new Date('2026-09-17T12:00:00.000Z') });
        expect(approved).toEqual(value);
    });
    // Falsifiability: the same approval must REJECT any digest but the disclosed
    // one, or the assertion above would pass against a command that emitted noise.
    it('is the only digest approval accepts', () => {
        const value = receipt(); const file = write('receipt.json', value);
        expect(() => approveCapabilities({ file, cwd, expectedDigest: 'f'.repeat(64), now: new Date('2026-09-17T12:00:00.000Z') })).toThrow(/does not match expectedDigest/);
    });
    it('writes nothing: digesting is not approving', () => {
        const file = write('policy.json', policy());
        candidateDigest({ file, cwd });
        expect(fs.existsSync(path.join(cwd, '.awm'))).toBe(false);
        expect(fs.readdirSync(cwd).sort()).toEqual(['policy.json']);
    });
});
