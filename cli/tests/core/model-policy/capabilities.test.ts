import fs from 'fs';
import os from 'os';
import path from 'path';
import { fork } from 'child_process';
import { approveCapabilities, capabilityReceiptDigest, capabilityReceiptPath, readCapabilities, validateCapabilityReceipt } from '../../../src/core/model-policy/capabilities';
import type { CapabilityReceipt } from '../../../src/core/model-policy/types';

const digest = 'a'.repeat(64);
const receipt = (): CapabilityReceipt => ({
    schema: 'routing-capabilities/v1',
    runtime: { target: 'codex', kind: 'native', version: '1.0.0', accountScopeDigest: digest },
    recordedAt: '2026-09-17T00:00:00.000Z', expiresAt: '2026-09-18T00:00:00.000Z',
    capabilities: { artifactDelivery: 'unverified', interactiveExecution: 'supported', unattendedController: 'supported', nativeSubagents: 'unverified', modelOverride: 'supported', effortOverride: 'supported', observedModelEvidence: 'supported', durableResume: 'unverified' },
    availableSelections: [{ selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } }],
    runtimeDefaultSelection: { selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } },
    evidence: (['interactiveExecution', 'unattendedController', 'modelOverride', 'effortOverride', 'observedModelEvidence'] as const).map(capability => ({ capability, kind: 'native-control' as const, receiptDigest: digest })),
    approval: { approvalId: 'approval-1', snapshotDigest: digest },
});
type C2Outcome = { outcome: 'accepted'; digest: string } | { outcome: 'rejected'; reason: string };
type C2Competitor = { ready: Promise<void>; release: () => void; outcome: Promise<C2Outcome>; close: () => Promise<void> };

/** A child can retain its fixture script briefly after it reports an outcome on
 * Windows. Retry only that documented transient after every child has exited. */
async function removeC2Fixture(target: string, attempts = 10, delayMs = 50, remove = (pathToRemove: string) => fs.rmSync(pathToRemove, { recursive: true, force: true }), isWindows = process.platform === 'win32'): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            remove(target);
            return;
        } catch (error) {
            if (!isWindows || (error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === attempts - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

function startC2Competitor(root: string, candidate: string, expectedDigest: string, predecessor: string, awmHome: string): C2Competitor {
    const module = path.resolve(__dirname, '../../../dist/src/core/model-policy/capabilities.js');
    const worker = path.join(root, `c2-competitor-${path.basename(candidate)}.js`);
    fs.writeFileSync(worker, `
const { approveCapabilities, capabilityReceiptDigest } = require(process.env.C2_CAPABILITIES_MODULE);
function report(message) {
    if (typeof process.send !== 'function' || !process.connected) process.exit(1);
    process.send(message, () => {
        if (process.connected) process.disconnect();
    });
}
process.once('message', message => {
    if (message !== 'go') process.exit(1);
    try {
        const receipt = approveCapabilities({ file: process.env.C2_CANDIDATE, cwd: process.env.C2_CWD, expectedDigest: process.env.C2_EXPECTED_DIGEST, replaceDigest: process.env.C2_PREDECESSOR, now: new Date(process.env.C2_NOW) });
        report({ outcome: 'accepted', digest: capabilityReceiptDigest(receipt) });
    } catch (error) {
        report({ outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
    }
});
process.once('disconnect', () => process.exit(0));
process.send({ type: 'ready' });
`);
    let readyResolve!: () => void; let readyReject!: (error: Error) => void; let outcomeResolve!: (outcome: C2Outcome) => void; let outcomeReject!: (error: Error) => void;
    let readySettled = false; let outcomeSettled = false; let exitResolve!: () => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const outcome = new Promise<C2Outcome>((resolve, reject) => { outcomeResolve = resolve; outcomeReject = reject; });
    const exited = new Promise<void>(resolve => { exitResolve = resolve; });
    const child = fork(worker, [], { cwd: root, env: { ...process.env, AWM_HOME: awmHome, C2_CAPABILITIES_MODULE: module, C2_CANDIDATE: candidate, C2_CWD: root, C2_EXPECTED_DIGEST: expectedDigest, C2_PREDECESSOR: predecessor, C2_NOW: '2026-09-17T12:00:00.000Z' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const rejectPending = (error: Error) => {
        if (!readySettled) { readySettled = true; readyReject(error); }
        if (!outcomeSettled) { outcomeSettled = true; outcomeReject(error); }
    };
    child.once('error', rejectPending);
    child.on('message', (message: unknown) => {
        if (message && typeof message === 'object' && (message as { type?: string }).type === 'ready') {
            if (!readySettled) { readySettled = true; readyResolve(); }
            return;
        }
        const result = message as Partial<C2Outcome>;
        if (!outcomeSettled && (result.outcome === 'accepted' || result.outcome === 'rejected')) { outcomeSettled = true; outcomeResolve(result as C2Outcome); }
    });
    child.once('exit', code => { exitResolve(); rejectPending(new Error(`C2 competitor exited before reporting an outcome (${code})`)); });
    // A failure before both outcomes are awaited must not leave a rejected
    // promise unobserved while the test's finally block is closing the child.
    void ready.catch(() => undefined);
    void outcome.catch(() => undefined);
    return {
        ready,
        release: () => {
            if (!child.connected) throw new Error('C2 competitor IPC closed before release');
            child.send('go');
        },
        outcome,
        close: async () => {
            if (child.exitCode !== null || child.signalCode !== null) return exited;
            if (child.connected) {
                try { child.disconnect(); }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ERR_IPC_DISCONNECTED') throw error;
                }
            }
            const timeout = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) child.kill();
            }, 5000);
            try { await exited; }
            finally { clearTimeout(timeout); }
        },
    };
}

describe('capability receipt validation', () => {
    it('accepts an exhaustive explicit native attestation', () => {
        expect(validateCapabilityReceipt(receipt())).toMatchObject({ runtime: { target: 'codex', kind: 'native' } });
    });
    it.each([
        ['renderer-only supported evidence', () => { const value = receipt(); value.evidence[0].kind = 'unsupported'; return value; }],
        ['expiry greater than 24 hours', () => { const value = receipt(); value.expiresAt = '2026-09-18T00:00:00.001Z'; return value; }],
        ['missing capability field', () => { const value = receipt(); delete (value.capabilities as any).effortOverride; return value; }],
    ])('rejects %s', (_name, make) => expect(() => validateCapabilityReceipt(make())).toThrow());
    it.each(['September 17, 2026 00:00:00 UTC', '2026-09-17', '2026-09-17T00:00:00.000+00:00', '2026-09-17T00:00:00.000Zx', '2026-02-30T00:00:00.000Z', '2026-09-17T00:00:00Z'])('rejects a noncanonical receipt timestamp: %s', timestamp => {
        const recorded = receipt(); recorded.recordedAt = timestamp;
        const expires = receipt(); expires.expiresAt = timestamp;
        expect(() => validateCapabilityReceipt(recorded)).toThrow();
        expect(() => validateCapabilityReceipt(expires)).toThrow();
    });
    it.each(['renderer', 'documentation'])('does not certify supported execution from %s evidence', kind => {
        const value = receipt(); value.evidence = value.evidence.map(entry => ({ ...entry, kind: kind as any })); expect(() => validateCapabilityReceipt(value)).toThrow(/evidence|native/i);
    });
    it('reads absent capability state without creating operator storage', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const prior = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator');
        try { expect(readCapabilities(receipt().runtime, new Date('2026-09-17T12:00:00.000Z'))).toEqual({ state: 'absent' }); expect(fs.existsSync(process.env.AWM_HOME!)).toBe(false); }
        finally { if (prior === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = prior; fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('uses only a validated target and runtime kind in its persistence path', () => {
        expect(capabilityReceiptPath(receipt().runtime)).toMatch(/routing-capabilities[\\/]codex[\\/]native\.json$/);
        expect(() => capabilityReceiptPath({ ...receipt().runtime, kind: '../native' } as any)).toThrow();
    });
    it.each(['2026-09-15T23:59:59.999Z', '2026-09-18T00:00:00.001Z'])('rejects stale or future approval at the injected clock', recordedAt => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const candidate = path.join(root, 'receipt.json'); const value = receipt(); value.recordedAt = recordedAt; value.expiresAt = recordedAt === '2026-09-15T23:59:59.999Z' ? '2026-09-16T23:59:59.999Z' : '2026-09-19T00:00:00.001Z'; fs.writeFileSync(candidate, JSON.stringify(value));
        try { expect(() => approveCapabilities({ file: candidate, cwd: root, expectedDigest: capabilityReceiptDigest(value), now: new Date('2026-09-17T00:00:00.000Z') })).toThrow(/future|stale/); }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('rejects an empty replace digest before reading or writing capability state', () => {
        expect(() => approveCapabilities({ file: 'missing.json', cwd: process.cwd(), expectedDigest: digest, replaceDigest: '' })).toThrow(/replaceDigest/);
    });
    it('rejects a symlinked candidate and a symlinked receipt destination', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const linked = path.join(root, 'linked.json'); const outside = path.join(root, 'outside.json'); fs.writeFileSync(outside, JSON.stringify(receipt())); const before = fs.readFileSync(outside); fs.symlinkSync(outside, linked);
        try { expect(() => approveCapabilities({ file: linked, cwd: root, expectedDigest: digest, now: new Date('2026-09-17T00:00:00.000Z') })).toThrow(/symlink|unsafe/); expect(fs.readFileSync(outside).equals(before)).toBe(true); }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it.each(['destination', 'ancestor'] as const)('rejects a symlinked %s without changing external bytes', kind => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const prior = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator'); const external = path.join(root, 'external.json'); fs.writeFileSync(external, 'outside'); const runtime = receipt().runtime;
        try { const target = capabilityReceiptPath(runtime); const ancestor = path.dirname(path.dirname(target)); if (kind === 'destination') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(external, target); } else { const externalTree = path.join(root, 'external-tree'); const sentinel = path.join(externalTree, 'codex', 'native.json'); fs.mkdirSync(path.dirname(sentinel), { recursive: true }); fs.writeFileSync(sentinel, 'sentinel'); fs.mkdirSync(path.dirname(ancestor), { recursive: true }); fs.symlinkSync(externalTree, ancestor); } expect(readCapabilities(runtime, new Date('2026-09-17T12:00:00.000Z')).state).toBe('invalid'); expect(fs.readFileSync(external, 'utf8')).toBe('outside'); }
        finally { if (prior === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = prior; fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('publishes with exact predecessor CAS and leaves the accepted C2 receipt intact', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const previous = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator'); const file = path.join(root, 'receipt.json'); const now = new Date('2026-09-17T12:00:00.000Z'); const first = receipt(); fs.writeFileSync(file, JSON.stringify(first));
        try {
            const firstDigest = capabilityReceiptDigest(first); expect(approveCapabilities({ file, cwd: root, expectedDigest: firstDigest, now })).toEqual(first);
            expect(() => approveCapabilities({ file, cwd: root, expectedDigest: firstDigest, now })).toThrow(/predecessor|exists/i);
            const second = receipt(); second.approval.approvalId = 'approval-2'; fs.writeFileSync(file, JSON.stringify(second)); const secondDigest = capabilityReceiptDigest(second);
            expect(() => approveCapabilities({ file, cwd: root, expectedDigest: secondDigest, replaceDigest: 'f'.repeat(64), now })).toThrow(/predecessor/);
            expect(approveCapabilities({ file, cwd: root, expectedDigest: secondDigest, replaceDigest: firstDigest, now })).toEqual(second);
            expect(readCapabilities(second.runtime, now)).toMatchObject({ state: 'current', digest: secondDigest });
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('retries only bounded Windows EBUSY cleanup after a C2 child exits', async () => {
        const calls: string[] = [];
        await removeC2Fixture('fixture', 3, 0, () => {
            calls.push('remove');
            if (calls.length < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        }, true);
        expect(calls).toHaveLength(3);
        await expect(removeC2Fixture('fixture', 3, 0, () => {
            calls.push('non-busy');
            throw Object.assign(new Error('denied'), { code: 'EPERM' });
        }, true)).rejects.toThrow('denied');
        expect(calls.filter(call => call === 'non-busy')).toHaveLength(1);
    });
    it('accepts exactly one process-raced C2 replacement from the same observed predecessor', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-'));
        const prior = process.env.AWM_HOME;
        const now = new Date('2026-09-17T12:00:00.000Z');
        const file = path.join(root, 'receipt.json');
        const base = receipt();
        let leftProcess: C2Competitor | undefined;
        let rightProcess: C2Competitor | undefined;
        process.env.AWM_HOME = path.join(root, 'operator');
        fs.writeFileSync(file, JSON.stringify(base));
        try {
            const predecessor = capabilityReceiptDigest(base);
            approveCapabilities({ file, cwd: root, expectedDigest: predecessor, now });
            const candidate = (id: string) => {
                const value = receipt();
                value.approval.approvalId = id;
                const candidateFile = path.join(root, `${id}.json`);
                fs.writeFileSync(candidateFile, JSON.stringify(value), { mode: 0o400 });
                return { file: candidateFile, digest: capabilityReceiptDigest(value) };
            };
            const left = candidate('left');
            const right = candidate('right');
            leftProcess = startC2Competitor(root, left.file, left.digest, predecessor, process.env.AWM_HOME!);
            rightProcess = startC2Competitor(root, right.file, right.digest, predecessor, process.env.AWM_HOME!);
            await Promise.all([leftProcess.ready, rightProcess.ready]);
            leftProcess.release();
            rightProcess.release();
            const outcomes = await Promise.all([leftProcess.outcome, rightProcess.outcome]);
            const accepted = outcomes.filter((outcome): outcome is Extract<C2Outcome, { outcome: 'accepted' }> => outcome.outcome === 'accepted');
            const rejected = outcomes.filter((outcome): outcome is Extract<C2Outcome, { outcome: 'rejected' }> => outcome.outcome === 'rejected');
            expect(accepted).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toMatch(/predecessor|lease|exist/i);
            const persisted = readCapabilities(base.runtime, now);
            expect(persisted).toMatchObject({ state: 'current', digest: accepted[0].digest });
            expect([left.digest, right.digest]).toContain(accepted[0].digest);
        } finally {
            await Promise.all([leftProcess?.close(), rightProcess?.close()].filter((value): value is Promise<void> => value !== undefined));
            if (prior === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = prior;
            await removeC2Fixture(root);
        }
    });
    it.each(['destination', 'ancestor'] as const)('writer rejects symlinked %s and preserves external bytes', kind => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const prior = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator'); const now = new Date('2026-09-17T12:00:00.000Z'); const value = receipt(); const file = path.join(root, 'candidate.json'); fs.writeFileSync(file, JSON.stringify(value)); const outside = path.join(root, 'outside'); fs.writeFileSync(outside, 'outside'); const target = capabilityReceiptPath(value.runtime); const ancestor = path.dirname(path.dirname(target));
        try { if (kind === 'destination') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(outside, target); } else { const externalTree = path.join(root, 'external-tree'); const sentinel = path.join(externalTree, 'codex', 'native.json'); fs.mkdirSync(path.dirname(sentinel), { recursive: true }); fs.writeFileSync(sentinel, 'sentinel'); fs.mkdirSync(path.dirname(ancestor), { recursive: true }); fs.symlinkSync(externalTree, ancestor); } expect(() => approveCapabilities({ file, cwd: root, expectedDigest: capabilityReceiptDigest(value), now })).toThrow(/unsafe|symlink|lease/); expect(fs.readFileSync(outside, 'utf8')).toBe('outside'); }
        finally { if (prior === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = prior; fs.rmSync(root, { recursive: true, force: true }); }
    });
});
