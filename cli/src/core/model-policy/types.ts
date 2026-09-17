import type { AgentTarget } from '../../providers';
import type { ProviderExecutionCapabilities } from './capability-types';

export type ImplementerProfile = 'mechanical' | 'integration' | 'judgment';
export type RoutingRole = 'implementer' | 'specification-reviewer' | 'code-quality-reviewer' | 'final-reviewer' | 'architecture' | 'track-a-qa' | 'track-b-qa' | 'controller' | 'documentation' | 'retro' | 'finishing';
export type Selection = { selector: { kind: 'model' | 'tier'; id: string }; effort: { kind: 'explicit'; value: string } | { kind: 'runtime-default' } };
export type PolicyMapping = { target: AgentTarget; runtimeKind: string; profiles: Record<ImplementerProfile, Selection>; fullCapability: Selection; degradation: { allowMissingModelOverride: boolean; allowMissingEffortOverride: boolean; allowMissingObservedIdentity: boolean } };
export type PolicyContent = { schema: 'model-policy/v1'; mappings: PolicyMapping[]; implementationBudget: { maxAttempts: 3; escalation: ['mechanical', 'integration', 'judgment']; judgmentEfforts: ['medium', 'high'] } };
export type ApprovedPolicy = { schema: 'approved-model-policy/v1'; content: PolicyContent; contentDigest: string; approval: { approvedAt: string; approvalId: string }; lineage: { previousDigest: string | null } };
export type EffectivePolicy = { state: 'approved'; provenance: 'user' | 'project'; policy: ApprovedPolicy } | { state: 'absent' } | { state: 'invalid'; provenance: 'user' | 'project'; reason: string };
export type RuntimeKey = { target: AgentTarget; kind: string; version: string; accountScopeDigest: string };
export type CapabilityEvidence = { capability: keyof ProviderExecutionCapabilities; kind: 'native-control' | 'native-dispatch' | 'unsupported'; receiptDigest: string };
export type CapabilityReceipt = { schema: 'routing-capabilities/v1'; runtime: RuntimeKey; recordedAt: string; expiresAt: string; capabilities: ProviderExecutionCapabilities; availableSelections: Selection[]; runtimeDefaultSelection?: Selection; evidence: CapabilityEvidence[]; approval: { approvalId: string; snapshotDigest: string } };
