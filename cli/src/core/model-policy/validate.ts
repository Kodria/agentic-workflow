import { AGENT_TARGETS, type AgentTarget } from '../../providers';
import type { ApprovedPolicy, ImplementerProfile, PolicyContent, PolicyMapping, Selection } from './types';

export const MAX_POLICY_BYTES = 256 * 1024;
export const MAX_MAPPINGS = 64;
export const MAX_IDENTIFIER = 128;
const SHA256 = /^[0-9a-f]{64}$/;
const RUNTIME_KIND = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const profiles: ImplementerProfile[] = ['mechanical', 'integration', 'judgment'];

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function exact(object: Record<string, unknown>, keys: string[], label: string): void {
    const actual = Object.keys(object);
    if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${label} has unknown or missing fields`);
}
function text(value: unknown, label: string, pattern?: RegExp): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER || CONTROL.test(value) || (pattern && !pattern.test(value))) throw new Error(`${label} is invalid`);
    return value;
}
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`); return value; }
function agent(value: unknown): AgentTarget { if (typeof value !== 'string' || !(AGENT_TARGETS as readonly string[]).includes(value)) throw new Error('mapping target is invalid'); return value as AgentTarget; }

function selection(value: unknown, label: string): Selection {
    const item = record(value, label); exact(item, ['selector', 'effort'], label);
    const selector = record(item.selector, `${label}.selector`); exact(selector, ['kind', 'id'], `${label}.selector`);
    if (selector.kind !== 'model' && selector.kind !== 'tier') throw new Error(`${label}.selector.kind is invalid`);
    const effort = record(item.effort, `${label}.effort`);
    if (effort.kind === 'explicit') { exact(effort, ['kind', 'value'], `${label}.effort`); return { selector: { kind: selector.kind, id: text(selector.id, `${label}.selector.id`) }, effort: { kind: 'explicit', value: text(effort.value, `${label}.effort.value`) } }; }
    if (effort.kind === 'runtime-default') { exact(effort, ['kind'], `${label}.effort`); return { selector: { kind: selector.kind, id: text(selector.id, `${label}.selector.id`) }, effort: { kind: 'runtime-default' } }; }
    throw new Error(`${label}.effort.kind is invalid`);
}
function mapping(value: unknown): PolicyMapping {
    const item = record(value, 'mapping'); exact(item, ['target', 'runtimeKind', 'profiles', 'fullCapability', 'degradation'], 'mapping');
    const rawProfiles = record(item.profiles, 'mapping.profiles'); exact(rawProfiles, profiles, 'mapping.profiles');
    const degradation = record(item.degradation, 'mapping.degradation'); exact(degradation, ['allowMissingModelOverride', 'allowMissingEffortOverride', 'allowMissingObservedIdentity'], 'mapping.degradation');
    return { target: agent(item.target), runtimeKind: text(item.runtimeKind, 'mapping.runtimeKind', RUNTIME_KIND), profiles: {
        mechanical: selection(rawProfiles.mechanical, 'mapping.profiles.mechanical'), integration: selection(rawProfiles.integration, 'mapping.profiles.integration'), judgment: selection(rawProfiles.judgment, 'mapping.profiles.judgment'),
    }, fullCapability: selection(item.fullCapability, 'mapping.fullCapability'), degradation: {
        allowMissingModelOverride: bool(degradation.allowMissingModelOverride, 'mapping.degradation.allowMissingModelOverride'), allowMissingEffortOverride: bool(degradation.allowMissingEffortOverride, 'mapping.degradation.allowMissingEffortOverride'), allowMissingObservedIdentity: bool(degradation.allowMissingObservedIdentity, 'mapping.degradation.allowMissingObservedIdentity'),
    } };
}

export function validatePolicyContent(value: unknown): PolicyContent {
    const item = record(value, 'policy content'); exact(item, ['schema', 'mappings', 'implementationBudget'], 'policy content');
    if (item.schema !== 'model-policy/v1') throw new Error('policy schema is invalid');
    if (!Array.isArray(item.mappings) || item.mappings.length > MAX_MAPPINGS) throw new Error('policy mappings are invalid');
    const mappings = item.mappings.map(mapping); const unique = new Set<string>();
    for (const row of mappings) { const key = `${row.target}\0${row.runtimeKind}`; if (unique.has(key)) throw new Error('duplicate policy target/runtime mapping'); unique.add(key); }
    const budget = record(item.implementationBudget, 'implementationBudget'); exact(budget, ['maxAttempts', 'escalation', 'judgmentEfforts'], 'implementationBudget');
    if (budget.maxAttempts !== 3 || !Array.isArray(budget.escalation) || budget.escalation.length !== 3 || budget.escalation.join(',') !== 'mechanical,integration,judgment' || !Array.isArray(budget.judgmentEfforts) || budget.judgmentEfforts.join(',') !== 'medium,high') throw new Error('implementation budget is invalid');
    return { schema: 'model-policy/v1', mappings, implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } };
}

export function validateApprovedPolicy(value: unknown): ApprovedPolicy {
    const item = record(value, 'approved policy'); exact(item, ['schema', 'content', 'contentDigest', 'approval', 'lineage'], 'approved policy');
    if (item.schema !== 'approved-model-policy/v1') throw new Error('approved policy schema is invalid');
    const approval = record(item.approval, 'approval'); exact(approval, ['approvedAt', 'approvalId'], 'approval');
    const lineage = record(item.lineage, 'lineage'); exact(lineage, ['previousDigest'], 'lineage');
    const contentDigest = text(item.contentDigest, 'contentDigest', SHA256);
    if (typeof approval.approvedAt !== 'string' || !Number.isFinite(Date.parse(approval.approvedAt)) || typeof approval.approvalId !== 'string' || approval.approvalId.length === 0 || approval.approvalId.length > MAX_IDENTIFIER || CONTROL.test(approval.approvalId) || (lineage.previousDigest !== null && (typeof lineage.previousDigest !== 'string' || !SHA256.test(lineage.previousDigest)))) throw new Error('approved policy metadata is invalid');
    return { schema: 'approved-model-policy/v1', content: validatePolicyContent(item.content), contentDigest, approval: { approvedAt: approval.approvedAt, approvalId: approval.approvalId }, lineage: { previousDigest: lineage.previousDigest as string | null } };
}

export function assertDigest(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a 64-character lowercase SHA-256 digest`); }
