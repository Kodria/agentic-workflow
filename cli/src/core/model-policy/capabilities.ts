import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { AGENT_TARGETS } from '../../providers';
import type { ProviderExecutionCapabilities } from './capability-types';
import type { PlanDiagnostic } from '../plan/types';
import type { CapabilityReceipt, RuntimeKey, Selection } from './types';
import { MAX_IDENTIFIER, assertDigest, canonicalUtcTimestamp } from './validate';
import { awmHome } from '../paths';
import { parseJsonNoDuplicate } from '../plan/json';
import { secureFs } from '../secure-fs/native-bridge';

const RUNTIME_KIND = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CAPABILITY_KEYS: Array<keyof ProviderExecutionCapabilities> = ['artifactDelivery', 'interactiveExecution', 'unattendedController', 'nativeSubagents', 'modelOverride', 'effortOverride', 'observedModelEvidence', 'durableResume'];
const CAPABILITY_VALUES = new Set(['supported', 'unsupported', 'unverified']);

function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[], name: string): void { const actual = Object.keys(value); if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${name} has unknown or missing fields`); }
function text(value: unknown, name: string, pattern?: RegExp): string { if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER || CONTROL.test(value) || (pattern && !pattern.test(value))) throw new Error(`${name} is invalid`); return value; }
function timestamp(value: unknown, name: string): string { return canonicalUtcTimestamp(value, name); }
function selection(value: unknown, name: string): Selection {
    const item = object(value, name); exact(item, ['selector', 'effort'], name);
    const selector = object(item.selector, `${name}.selector`); exact(selector, ['kind', 'id'], `${name}.selector`);
    if (selector.kind !== 'model' && selector.kind !== 'tier') throw new Error(`${name}.selector.kind is invalid`);
    const effort = object(item.effort, `${name}.effort`);
    if (effort.kind === 'explicit') { exact(effort, ['kind', 'value'], `${name}.effort`); return { selector: { kind: selector.kind, id: text(selector.id, `${name}.selector.id`) }, effort: { kind: 'explicit', value: text(effort.value, `${name}.effort.value`) } }; }
    if (effort.kind === 'runtime-default') { exact(effort, ['kind'], `${name}.effort`); return { selector: { kind: selector.kind, id: text(selector.id, `${name}.selector.id`) }, effort: { kind: 'runtime-default' } }; }
    throw new Error(`${name}.effort.kind is invalid`);
}
function sameSelection(left: Selection, right: Selection): boolean { return left.selector.kind === right.selector.kind && left.selector.id === right.selector.id && left.effort.kind === right.effort.kind && (left.effort.kind !== 'explicit' || left.effort.value === (right.effort as { kind: 'explicit'; value: string }).value); }
export function validateRuntimeKey(value: unknown): RuntimeKey {
    const item = object(value, 'runtime'); exact(item, ['target', 'kind', 'version', 'accountScopeDigest'], 'runtime');
    if (typeof item.target !== 'string' || !(AGENT_TARGETS as readonly string[]).includes(item.target)) throw new Error('runtime target is invalid');
    const accountScopeDigest = text(item.accountScopeDigest, 'runtime.accountScopeDigest'); assertDigest(accountScopeDigest, 'runtime.accountScopeDigest');
    return { target: item.target as RuntimeKey['target'], kind: text(item.kind, 'runtime.kind', RUNTIME_KIND), version: text(item.version, 'runtime.version', SEMVER), accountScopeDigest };
}
function capabilities(value: unknown): ProviderExecutionCapabilities {
    const item = object(value, 'capabilities'); exact(item, CAPABILITY_KEYS, 'capabilities');
    for (const key of CAPABILITY_KEYS) if (!CAPABILITY_VALUES.has(item[key] as string)) throw new Error(`capabilities.${key} is invalid`);
    return item as ProviderExecutionCapabilities;
}
function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; const item = value as Record<string, unknown>; return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`; }
export function capabilityReceiptDigest(receipt: CapabilityReceipt): string { return createHash('sha256').update(canonical(validateCapabilityReceipt(receipt)), 'utf8').digest('hex'); }
export function validateCapabilityReceipt(value: unknown): CapabilityReceipt {
    const item = object(value, 'capability receipt'); exact(item, ['schema', 'runtime', 'recordedAt', 'expiresAt', 'capabilities', 'availableSelections', 'runtimeDefaultSelection', 'evidence', 'approval'].filter(key => item[key] !== undefined), 'capability receipt');
    if (item.schema !== 'routing-capabilities/v1') throw new Error('capability receipt schema is invalid');
    const runtime = validateRuntimeKey(item.runtime); const recordedAt = timestamp(item.recordedAt, 'recordedAt'); const expiresAt = timestamp(item.expiresAt, 'expiresAt');
    const elapsed = Date.parse(expiresAt) - Date.parse(recordedAt); if (elapsed < 0 || elapsed > 24 * 60 * 60 * 1000) throw new Error('capability receipt expiry must be within 24 hours');
    const caps = capabilities(item.capabilities);
    if (!Array.isArray(item.availableSelections) || item.availableSelections.length === 0 || item.availableSelections.length > 64) throw new Error('availableSelections is invalid');
    const availableSelections = item.availableSelections.map((entry, index) => selection(entry, `availableSelections[${index}]`));
    if (new Set(availableSelections.map(canonical)).size !== availableSelections.length) throw new Error('availableSelections contains duplicates');
    const runtimeDefaultSelection = item.runtimeDefaultSelection === undefined ? undefined : selection(item.runtimeDefaultSelection, 'runtimeDefaultSelection');
    if (runtimeDefaultSelection && !availableSelections.some(entry => sameSelection(entry, runtimeDefaultSelection))) throw new Error('runtimeDefaultSelection must be available');
    if (!Array.isArray(item.evidence) || item.evidence.length > 64) throw new Error('evidence is invalid');
    const evidence = item.evidence.map((entry, index) => { const proof = object(entry, `evidence[${index}]`); exact(proof, ['capability', 'kind', 'receiptDigest'], `evidence[${index}]`); if (!CAPABILITY_KEYS.includes(proof.capability as keyof ProviderExecutionCapabilities) || !['native-control', 'native-dispatch', 'unsupported'].includes(proof.kind as string)) throw new Error(`evidence[${index}] is invalid`); const receiptDigest = text(proof.receiptDigest, `evidence[${index}].receiptDigest`); assertDigest(receiptDigest, `evidence[${index}].receiptDigest`); return { capability: proof.capability as keyof ProviderExecutionCapabilities, kind: proof.kind as 'native-control' | 'native-dispatch' | 'unsupported', receiptDigest }; });
    for (const key of CAPABILITY_KEYS) if (caps[key] === 'supported' && !evidence.some(proof => proof.capability === key && (proof.kind === 'native-control' || proof.kind === 'native-dispatch'))) throw new Error(`supported capability ${key} lacks native evidence`);
    const approval = object(item.approval, 'approval'); exact(approval, ['approvalId', 'snapshotDigest'], 'approval'); const approvalId = text(approval.approvalId, 'approval.approvalId'); const snapshotDigest = text(approval.snapshotDigest, 'approval.snapshotDigest'); assertDigest(snapshotDigest, 'approval.snapshotDigest');
    return { schema: 'routing-capabilities/v1', runtime, recordedAt, expiresAt, capabilities: caps, availableSelections, ...(runtimeDefaultSelection ? { runtimeDefaultSelection } : {}), evidence, approval: { approvalId, snapshotDigest } };
}
export function receiptIsCurrent(receipt: CapabilityReceipt, runtime: RuntimeKey, now: Date): boolean { return receipt.runtime.target === runtime.target && receipt.runtime.kind === runtime.kind && receipt.runtime.version === runtime.version && receipt.runtime.accountScopeDigest === runtime.accountScopeDigest && Number.isFinite(now.getTime()) && Date.parse(receipt.recordedAt) <= now.getTime() && now.getTime() <= Date.parse(receipt.expiresAt); }
export function routingDiagnostic(code: string, message: string): PlanDiagnostic { return { code, message }; }

export type CapabilityRead = { state: 'current'; receipt: CapabilityReceipt; digest: string } | { state: 'absent' } | { state: 'stale'; reason: string } | { state: 'invalid'; reason: string };
export type ApproveCapabilitiesInput = { file: string; cwd: string; expectedDigest: string; replaceDigest?: string; now?: Date };
export function storedCapabilityPath(target: RuntimeKey['target'], kind: string): string {
    if (typeof target !== 'string' || !(AGENT_TARGETS as readonly string[]).includes(target) || typeof kind !== 'string' || !RUNTIME_KIND.test(kind)) throw new Error('stored capability target or kind is invalid');
    return path.join(awmHome(), 'routing-capabilities', target, `${kind}.json`);
}
export function capabilityReceiptPath(runtime: RuntimeKey): string { const valid = validateRuntimeKey(runtime); return storedCapabilityPath(valid.target, valid.kind); }
function safeParents(file: string): void { for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) { try { const stat = fs.lstatSync(dir); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe capability parent: ${dir}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } if (dir === path.dirname(dir)) return; } }
function readBytes(file: string): Buffer | null { safeParents(file); try { const stat = fs.lstatSync(file, { bigint: true }); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > BigInt(256 * 1024)) throw new Error('capability receipt is unsafe or exceeds 256 KiB'); return fs.readFileSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function parseReceipt(bytes: Buffer): CapabilityReceipt { return validateCapabilityReceipt(parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
export function readCapabilities(runtime: RuntimeKey, now: Date): CapabilityRead {
    try { const valid = validateRuntimeKey(runtime); const bytes = readBytes(capabilityReceiptPath(valid)); if (!bytes) return { state: 'absent' }; const receipt = parseReceipt(bytes); if (!receiptIsCurrent(receipt, valid, now)) return { state: 'stale', reason: 'receipt runtime does not match or attestation expired' }; return { state: 'current', receipt, digest: capabilityReceiptDigest(receipt) }; }
    catch (error) { return { state: 'invalid', reason: (error as Error).message.slice(0, 4096) }; }
}
function ensureParents(file: string): void { const chain: string[] = []; for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) { chain.unshift(dir); if (dir === path.dirname(dir)) break; } for (const dir of chain) { try { const stat = fs.lstatSync(dir); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe capability parent: ${dir}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; fs.mkdirSync(dir, { mode: 0o700 }); } } }
export function approveCapabilities(input: ApproveCapabilitiesInput): CapabilityReceipt {
    if (!input || typeof input !== 'object' || typeof input.file !== 'string' || typeof input.cwd !== 'string') throw new Error('capability approval input is required'); assertDigest(input.expectedDigest, 'expectedDigest'); if (input.replaceDigest !== undefined) assertDigest(input.replaceDigest, 'replaceDigest'); const now = input.now ?? new Date(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('capability approval requires a finite clock');
    const candidate = readBytes(path.resolve(input.cwd, input.file)); if (!candidate) throw new Error('capability candidate is absent'); const receipt = parseReceipt(candidate); if (!receiptIsCurrent(receipt, receipt.runtime, now)) throw new Error('capability receipt is future or stale'); const digest = capabilityReceiptDigest(receipt); if (digest !== input.expectedDigest) throw new Error('capability receipt digest does not match expectedDigest');
    const target = capabilityReceiptPath(receipt.runtime); ensureParents(target); const root = awmHome(); const destination = path.relative(root, target).split(path.sep).join('/');
    secureFs.withProjectLease(root, () => { const current = readBytes(target); if (!current) { if (input.replaceDigest) throw new Error('replacement requires existing capability receipt'); secureFs.writeProjectTransaction(root, destination, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`), { mode: 'create', createParents: true }); return; } const observed = secureFs.readRegularFile(target, 256 * 1024); const prior = parseReceipt(observed.bytes); if (!input.replaceDigest || capabilityReceiptDigest(prior) !== input.replaceDigest) throw new Error('capability receipt replacement predecessor mismatch'); secureFs.writeProjectTransaction(root, destination, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`), { mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: observed.identity }); });
    return receipt;
}
