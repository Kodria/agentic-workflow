import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parseJsonNoDuplicate } from '../plan/json';
import { secureFs } from '../secure-fs/native-bridge';
import { canonicalPolicyDigest } from './canonical';
import { projectPolicyPath, userPolicyPath } from './paths';
import type { ApprovedPolicy, EffectivePolicy, PolicyContent } from './types';
import { assertDigest, MAX_POLICY_BYTES, validateApprovedPolicy, validatePolicyContent } from './validate';

export interface ApprovePolicyInput { file: string; scope: 'user' | 'project'; cwd: string; expectedDigest: string; replaceDigest?: string; }

function assertPath(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`${label} must be a bounded path without control characters`);
}
function ancestors(file: string): string[] { const absolute = path.resolve(file); const result: string[] = []; for (let current = path.dirname(absolute); ; current = path.dirname(current)) { result.unshift(current); if (current === path.dirname(current)) return result; } }
function assertSafeParents(file: string): void {
    for (const parent of ancestors(file)) { try { const stat = fs.lstatSync(parent, { bigint: true }); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe policy parent: ${parent}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}
function assertRegularOrAbsent(file: string): void { try { const stat = fs.lstatSync(file, { bigint: true }); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`policy file rejects symlink or non-regular file: ${file}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
function readBounded(file: string): string | null {
    assertSafeParents(file); let inspected: fs.BigIntStats;
    try { inspected = fs.lstatSync(file, { bigint: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (inspected.isSymbolicLink() || !inspected.isFile() || inspected.size < 0n || inspected.size > BigInt(MAX_POLICY_BYTES)) throw new Error('policy file is unsafe or exceeds 256 KiB');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try { const opened = fs.fstatSync(fd, { bigint: true }); if (!opened.isFile() || opened.dev !== inspected.dev || opened.ino !== inspected.ino || opened.size !== inspected.size) throw new Error('policy file identity changed'); assertSafeParents(file); return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
}
function parseApproved(raw: string): ApprovedPolicy { const policy = validateApprovedPolicy(parseJsonNoDuplicate(raw)); if (canonicalPolicyDigest(policy.content) !== policy.contentDigest) throw new Error('approved policy content digest mismatch'); return policy; }
function policyTarget(scope: 'user' | 'project', cwd: string): string { if (scope !== 'user' && scope !== 'project') throw new Error('scope must be user or project'); assertPath(cwd, 'cwd'); return scope === 'user' ? userPolicyPath() : projectPolicyPath(cwd); }
function createDirectories(file: string): void {
    const chain = ancestors(file); for (const directory of chain) { try { const stat = fs.lstatSync(directory); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe policy parent: ${directory}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; fs.mkdirSync(directory, { mode: 0o700 }); } }
}
function lock(file: string): () => void { const lockPath = `${file}.lock`; assertRegularOrAbsent(lockPath); let fd: number; try { fd = fs.openSync(lockPath, 'wx', 0o600); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('policy writer lock already exists; explicit recovery required'); throw error; } return () => { try { fs.closeSync(fd); } finally { fs.rmSync(lockPath, { force: false }); } }; }

export function readEffectivePolicy(cwd: string): EffectivePolicy {
    assertPath(cwd, 'cwd');
    const project = projectPolicyPath(cwd);
    try { const raw = readBounded(project); if (raw !== null) return { state: 'approved', provenance: 'project', policy: parseApproved(raw) }; } catch (error) { return { state: 'invalid', provenance: 'project', reason: (error as Error).message.slice(0, 4096) }; }
    const user = userPolicyPath();
    try { const raw = readBounded(user); if (raw === null) return { state: 'absent' }; return { state: 'approved', provenance: 'user', policy: parseApproved(raw) }; } catch (error) { return { state: 'invalid', provenance: 'user', reason: (error as Error).message.slice(0, 4096) }; }
}

export function approvePolicy(input: ApprovePolicyInput): ApprovedPolicy {
    if (!input || typeof input !== 'object') throw new Error('approval input is required');
    assertPath(input.file, 'file'); assertPath(input.cwd, 'cwd'); assertDigest(input.expectedDigest, 'expectedDigest'); if (input.replaceDigest !== undefined) assertDigest(input.replaceDigest, 'replaceDigest');
    const cwd = path.resolve(input.cwd);
    const candidateRaw = readBounded(path.resolve(cwd, input.file)); if (candidateRaw === null) throw new Error('policy candidate is absent');
    const content: PolicyContent = validatePolicyContent(parseJsonNoDuplicate(candidateRaw)); const digest = canonicalPolicyDigest(content);
    if (digest !== input.expectedDigest) throw new Error('policy content digest does not match expectedDigest');
    const target = policyTarget(input.scope, cwd); createDirectories(target); assertSafeParents(target); assertRegularOrAbsent(target);
    const unlock = lock(target);
    try {
        const existingRaw = readBounded(target); const existing = existingRaw === null ? null : parseApproved(existingRaw);
        if (existing === null && input.replaceDigest !== undefined) throw new Error('replacement requires an existing predecessor');
        if (existing !== null && input.replaceDigest === undefined) throw new Error('existing policy requires replaceDigest');
        if (existing !== null && existing.contentDigest !== input.replaceDigest) throw new Error('replacement predecessor digest mismatch');
        const approved: ApprovedPolicy = { schema: 'approved-model-policy/v1', content, contentDigest: digest, approval: { approvedAt: new Date().toISOString(), approvalId: crypto.randomUUID() }, lineage: { previousDigest: existing?.contentDigest ?? null } };
        const serialized = `${JSON.stringify(approved, null, 2)}\n`;
        const root = input.scope === 'project' ? cwd : path.dirname(target);
        const destination = input.scope === 'project' ? '.awm/model-policy.json' : path.basename(target);
        secureFs.withProjectLease(root, () => {
            if (existing === null) {
                secureFs.writeProjectTransaction(root, destination, Buffer.from(serialized, 'utf8'), { mode: 'create', createParents: true });
                return;
            }
            // A native identity-fenced transaction proves that neither bytes nor
            // file identity changed after the bounded observation. A JS rename
            // cannot make that CAS claim, so it is deliberately not used here.
            const observed = secureFs.readRegularFile(target, MAX_POLICY_BYTES);
            const current = parseApproved(new TextDecoder('utf-8', { fatal: true }).decode(observed.bytes));
            if (current.contentDigest !== input.replaceDigest) throw new Error('replacement predecessor digest changed under writer lock');
            secureFs.writeProjectTransaction(root, destination, Buffer.from(serialized, 'utf8'), { mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: observed.identity });
        });
        return approved;
    } finally { unlock(); }
}
