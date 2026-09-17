import type { AgentTarget } from '../../providers';
import { AGENT_TARGETS, isAgentTarget } from '../../providers';
import type { CurrentnessReport } from '../currentness/types';
import type { PlanDiagnostic, PlanValidationReport } from '../plan/types';
import type { RunOutput } from '../../commands/sensors/types';
import type { JournalState } from '../journal/types';
import { bindingPlanPath } from '../journal/paths';
import type { CapabilityStatus, ProviderExecutionCapabilities } from '../model-policy/capability-types';
type ImplementerProfile = 'mechanical' | 'integration' | 'judgment';
import type { ApprovedPolicy, CapabilityReceipt, RuntimeKey } from '../model-policy/types';
import { resolveSelection } from '../model-policy/resolve';
import { validateRuntimeKey } from '../model-policy/capabilities';

export type ExecutionMode = 'interactivo' | 'desatendido';
export type { CapabilityStatus, ProviderExecutionCapabilities } from '../model-policy/capability-types';
export type ProviderExecutionResolution = {
    outcome: 'native' | 'degraded' | 'blocked'; provider: AgentTarget; capabilities: ProviderExecutionCapabilities;
    evidenceVersion: 'r1-v1'; diagnostics: PlanDiagnostic[];
};
export type DispatchForecast = {
    kind: 'topology'; slices: number; roles: Record<'implementer' | 'specification-reviewer' | 'code-quality-reviewer' | 'final-reviewer' | 'track-a-qa' | 'track-b-qa' | 'documentation' | 'retro' | 'finishing', number>;
    total: number;
};
export type AdmissionReport = {
    state: 'admitted' | 'blocked'; planState: PlanValidationReport['state']; planDigest?: string;
    executionMode?: ExecutionMode; provider?: AgentTarget; journal: 'not-required' | 'current' | 'missing' | 'corrupt' | 'stale';
    currentness: 'current' | 'stale' | 'unverifiable' | 'not-checked'; sensors: 'pass' | 'fail' | 'not-certified' | 'not-required';
    capabilityResolution?: ProviderExecutionResolution; forecast?: DispatchForecast; diagnostics: PlanDiagnostic[];
    routingForecast?: RoutingForecast;
};
export type RoutingForecast = {
    kind: 'routing-v1'; slices: number; implementerProfiles: Record<ImplementerProfile, number>;
    roles: Record<'specification-reviewer' | 'code-quality-reviewer' | 'final-reviewer' | 'track-a-qa' | 'documentation' | 'retro' | 'finishing', number>;
    trackB: { state: 'known'; count: number } | { state: 'unavailable'; lowerBound: 1 };
    controller: { state: 'known'; count: number } | { state: 'unavailable'; lowerBound: 0 };
};
export type AdmissionInput = {
    plan: PlanValidationReport; provider: string; cwd: string; enabledAgents?: readonly AgentTarget[];
    executionMode?: ExecutionMode; requireCurrent?: boolean; verifySensors?: boolean;
    currentness?: CurrentnessReport; sensors?: RunOutput;
    /** Exact registry components reached from validated plan-source provenance. */
    consumedRegistryComponents?: readonly string[];
    /** No registry may be ignored until source-to-contract provenance is complete. */
    provenance?: 'proven' | 'unknown';
    /** Registry manifest compatibility is distinct from remote currentness. */
    compatibilityDiagnostics?: PlanDiagnostic[];
    /** Read-only journal observation supplied by the command boundary. */
    journalState?: JournalState | null;
    journalCorrupt?: boolean;
    /** Repository-relative path used to make the binding identity exact. */
    planPath?: string;
    /** Explicit routing evidence; absent facts block v2 only after existing gates. */
    routing?: { policy?: ApprovedPolicy; capabilities?: CapabilityReceipt; runtime?: RuntimeKey; now?: Date; qaLens?: readonly string[]; controllerCount?: number };
};

const UNKNOWN: ProviderExecutionCapabilities = {
    artifactDelivery: 'unverified', interactiveExecution: 'unverified', unattendedController: 'unverified', nativeSubagents: 'unverified',
    modelOverride: 'unverified', effortOverride: 'unverified', observedModelEvidence: 'unverified', durableResume: 'unverified',
};

/** Deliberate R1 evidence table. Artifact delivery is never used as execution evidence. */
export const PROVIDER_EXECUTION_CAPABILITIES: Readonly<Record<AgentTarget, ProviderExecutionCapabilities>> = {
    antigravity: { ...UNKNOWN },
    opencode: { ...UNKNOWN },
    'claude-code': { ...UNKNOWN, interactiveExecution: 'supported', unattendedController: 'supported', durableResume: 'supported' },
    codex: { ...UNKNOWN, interactiveExecution: 'supported', unattendedController: 'supported', durableResume: 'supported' },
    cursor: { ...UNKNOWN },
    copilot: { ...UNKNOWN },
};

const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_LENGTH = 4096;
function safe(value: string): string { return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, character => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`).slice(0, MAX_DIAGNOSTIC_LENGTH); }
function sanitizeDiagnostics(diagnostics: PlanDiagnostic[]): PlanDiagnostic[] { return diagnostics.slice(0, MAX_DIAGNOSTICS).map(item => ({ code: safe(String(item.code)), message: safe(String(item.message)), ...(typeof item.field === 'string' ? { field: safe(item.field) } : {}) })); }
function diagnostic(code: string, message: string): PlanDiagnostic { return { code: safe(code), message: safe(message) }; }
function blocked(input: AdmissionInput, diagnostics: PlanDiagnostic[], extras: Partial<Omit<AdmissionReport, 'state' | 'planState' | 'diagnostics'>> = {}): AdmissionReport {
    const { journal = 'not-required', currentness = 'not-checked', sensors = 'not-required', ...rest } = extras;
    return { state: 'blocked', planState: input.plan.state, journal, currentness, sensors, ...rest, diagnostics: sanitizeDiagnostics(diagnostics) };
}
function forecast(slices: number): DispatchForecast {
    const roles = { implementer: slices, 'specification-reviewer': slices, 'code-quality-reviewer': slices, 'final-reviewer': 1, 'track-a-qa': 1, 'track-b-qa': 1, documentation: 1, retro: 1, finishing: 1 };
    return { kind: 'topology', slices, roles, total: Object.values(roles).reduce((sum, count) => sum + count, 0) };
}
function routingForecast(plan: Extract<PlanValidationReport, { state: 'valid' }>, routing: NonNullable<AdmissionInput['routing']>): RoutingForecast {
    const profiles: Record<ImplementerProfile, number> = { mechanical: 0, integration: 0, judgment: 0 };
    for (const slice of plan.manifest.slices) profiles[(slice as unknown as { implementerProfile: ImplementerProfile }).implementerProfile] += 1;
    const qa = routing.qaLens;
    if (qa !== undefined && (!Array.isArray(qa) || qa.length > 64 || new Set(qa).size !== qa.length || qa.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)))) throw new Error('routing qaLens must be unique validated lens ids');
    if (routing.controllerCount !== undefined && (!Number.isSafeInteger(routing.controllerCount) || routing.controllerCount < 0 || routing.controllerCount > 1)) throw new Error('routing controllerCount must be 0 or 1');
    return { kind: 'routing-v1', slices: plan.manifest.slices.length, implementerProfiles: profiles, roles: { 'specification-reviewer': plan.manifest.slices.length, 'code-quality-reviewer': plan.manifest.slices.length, 'final-reviewer': 1, 'track-a-qa': 1, documentation: 1, retro: 1, finishing: 1 }, trackB: qa === undefined ? { state: 'unavailable', lowerBound: 1 } : { state: 'known', count: qa.length }, controller: routing.controllerCount === undefined ? { state: 'unavailable', lowerBound: 0 } : { state: 'known', count: routing.controllerCount } };
}
function currentness(report: CurrentnessReport, consumedRegistryComponents: readonly string[]): { status: AdmissionReport['currentness']; diagnostics: PlanDiagnostic[] } {
    const consumed = new Set(['cli', ...consumedRegistryComponents]);
    const present = new Set(report.components.map(component => component.component));
    const missing = [...consumed].filter(component => !present.has(component));
    if (missing.length > 0) return { status: 'unverifiable', diagnostics: [diagnostic('ADMISSION_CURRENTNESS_MISSING_COMPONENT', `Currentness evidence is missing consumed components: ${missing.join(', ')}.`)] };
    const failed = report.components.filter(component => consumed.has(component.component) && component.status !== 'current');
    if (failed.length === 0) return { status: 'current', diagnostics: [] };
    const names = failed.map(component => component.component).join(', ');
    const status = failed.some(component => component.status === 'unverifiable') ? 'unverifiable' : 'stale';
    return { status, diagnostics: [diagnostic('ADMISSION_CURRENTNESS_BLOCKED', `Consumed contract currentness is ${status}: ${names}.`)] };
}
function sensorVerdict(report: RunOutput): AdmissionReport['sensors'] { return report.overall === 'not_certified' ? 'not-certified' : report.overall === 'pass' ? 'pass' : 'fail'; }
function journalStatus(input: AdmissionInput, plan: Extract<PlanValidationReport, { state: 'valid' }>): AdmissionReport['journal'] {
    if (input.journalCorrupt) return 'corrupt';
    const journal = input.journalState;
    if (!journal) return 'missing';
    if (journal.schema !== 2 || !journal.planBinding) return 'stale';
    let planPath: string;
    try { planPath = bindingPlanPath(input.planPath ?? ''); } catch { return 'stale'; }
    const binding = journal.planBinding;
    return binding.path === planPath && binding.digest === plan.planDigest && binding.schema === plan.schema && binding.executionMode === 'desatendido'
        ? 'current' : 'stale';
}

const PLAN_STATES = new Set<AdmissionReport['planState']>(['valid', 'migration-required', 'invalid', 'unsupported']);
const JOURNALS = new Set<AdmissionReport['journal']>(['not-required', 'current', 'missing', 'corrupt', 'stale']);
const CURRENTNESS = new Set<AdmissionReport['currentness']>(['current', 'stale', 'unverifiable', 'not-checked']);
const SENSORS = new Set<AdmissionReport['sensors']>(['pass', 'fail', 'not-certified', 'not-required']);
const CAPABILITY = new Set<CapabilityStatus>(['supported', 'unsupported', 'unverified']);
function invalidAdmission(): never { throw new Error('admission returned an invalid report'); }
function validCapabilities(value: unknown): value is ProviderExecutionCapabilities {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const keys: Array<keyof ProviderExecutionCapabilities> = ['artifactDelivery', 'interactiveExecution', 'unattendedController', 'nativeSubagents', 'modelOverride', 'effortOverride', 'observedModelEvidence', 'durableResume'];
    return Object.keys(record).length === keys.length && keys.every(key => CAPABILITY.has(record[key] as CapabilityStatus));
}
function validForecast(value: unknown): value is DispatchForecast {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const roles = ['implementer', 'specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'track-a-qa', 'track-b-qa', 'documentation', 'retro', 'finishing'];
    const slices = record.slices as number;
    const topology = { implementer: slices, 'specification-reviewer': slices, 'code-quality-reviewer': slices, 'final-reviewer': 1, 'track-a-qa': 1, 'track-b-qa': 1, documentation: 1, retro: 1, finishing: 1 };
    return record.kind === 'topology' && Number.isSafeInteger(slices) && slices >= 0 && Number.isSafeInteger(record.total) && (record.total as number) >= 0
        && !!record.roles && typeof record.roles === 'object' && !Array.isArray(record.roles) && Object.keys(record.roles as object).length === roles.length
        && roles.every(role => (record.roles as Record<string, unknown>)[role] === topology[role as keyof typeof topology])
        && record.total === Object.values(topology).reduce((sum, count) => sum + count, 0);
}
function validRoutingForecast(value: unknown): value is RoutingForecast {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>; const profiles = record.implementerProfiles as Record<string, unknown>; const roles = record.roles as Record<string, unknown>;
    const count = (item: unknown): boolean => Number.isSafeInteger(item) && (item as number) >= 0;
    const roleKeys = ['specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'track-a-qa', 'documentation', 'retro', 'finishing'];
    return record.kind === 'routing-v1' && Object.keys(record).length === 6 && count(record.slices) && !!profiles && Object.keys(profiles).length === 3 && ['mechanical', 'integration', 'judgment'].every(key => count(profiles[key])) && (Object.values(profiles) as unknown[]).reduce<number>((sum, profile) => sum + (profile as number), 0) === record.slices && !!roles && typeof roles === 'object' && Object.keys(roles).length === roleKeys.length && roleKeys.every(key => key in roles) && roles['specification-reviewer'] === record.slices && roles['code-quality-reviewer'] === record.slices && ['final-reviewer', 'track-a-qa', 'documentation', 'retro', 'finishing'].every(key => roles[key] === 1)
        && !!record.trackB && typeof record.trackB === 'object' && (((record.trackB as any).state === 'known' && count((record.trackB as any).count)) || ((record.trackB as any).state === 'unavailable' && (record.trackB as any).lowerBound === 1))
        && !!record.controller && typeof record.controller === 'object' && (((record.controller as any).state === 'known' && count((record.controller as any).count)) || ((record.controller as any).state === 'unavailable' && (record.controller as any).lowerBound === 0));
}
function validDiagnostics(value: unknown): value is PlanDiagnostic[] {
    return Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof (item as PlanDiagnostic).code === 'string' && typeof (item as PlanDiagnostic).message === 'string' && ((item as PlanDiagnostic).field === undefined || typeof (item as PlanDiagnostic).field === 'string'));
}

/** Defensive public-output boundary for injected dependencies as well as core reports. */
export function sanitizeAdmissionReport(report: unknown): AdmissionReport {
    if (!report || typeof report !== 'object' || Array.isArray(report)) invalidAdmission();
    const value = report as Record<string, unknown>;
    if ((value.state !== 'admitted' && value.state !== 'blocked') || !PLAN_STATES.has(value.planState as AdmissionReport['planState']) || !JOURNALS.has(value.journal as AdmissionReport['journal']) || !CURRENTNESS.has(value.currentness as AdmissionReport['currentness']) || !SENSORS.has(value.sensors as AdmissionReport['sensors']) || !validDiagnostics(value.diagnostics)) invalidAdmission();
    if (value.planDigest !== undefined && (typeof value.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.planDigest))) invalidAdmission();
    if (value.executionMode !== undefined && value.executionMode !== 'interactivo' && value.executionMode !== 'desatendido') invalidAdmission();
    if (value.provider !== undefined && !isAgentTarget(value.provider)) invalidAdmission();
    if (value.capabilityResolution !== undefined) {
        const resolution = value.capabilityResolution as Record<string, unknown>;
        if (!resolution || typeof resolution !== 'object' || !['native', 'degraded', 'blocked'].includes(resolution.outcome as string) || !isAgentTarget(resolution.provider) || !validCapabilities(resolution.capabilities) || resolution.evidenceVersion !== 'r1-v1' || !validDiagnostics(resolution.diagnostics)) invalidAdmission();
    }
    if (value.forecast !== undefined && !validForecast(value.forecast)) invalidAdmission();
    if (value.routingForecast !== undefined && !validRoutingForecast(value.routingForecast)) invalidAdmission();
    const capabilityResolution = value.capabilityResolution === undefined ? undefined : { ...(value.capabilityResolution as ProviderExecutionResolution), diagnostics: sanitizeDiagnostics((value.capabilityResolution as ProviderExecutionResolution).diagnostics) };
    return { ...(value as AdmissionReport), ...(capabilityResolution ? { capabilityResolution } : {}), diagnostics: sanitizeDiagnostics(value.diagnostics as PlanDiagnostic[]) };
}

/** Pure, read-only composition. Callers own every I/O dependency and no dispatch API is exposed here. */
export async function admitPlan(input: AdmissionInput): Promise<AdmissionReport> {
    if (!input || typeof input !== 'object' || typeof input.cwd !== 'string' || input.cwd.length === 0) throw new Error('admission requires a cwd');
    const plan = input.plan;
    if (!plan || typeof plan !== 'object') throw new Error('admission requires a plan report');
    if (plan.state !== 'valid') {
        if (plan.state === 'unsupported') return blocked(input, [diagnostic('ADMISSION_PLAN_UNSUPPORTED', 'This compact plan schema is not supported for admission.'), ...plan.diagnostics]);
        const code = plan.state === 'migration-required' ? 'ADMISSION_PLAN_MIGRATION_REQUIRED' : 'ADMISSION_PLAN_INVALID';
        return blocked(input, [diagnostic(code, 'Compact plan validation must succeed before admission.'), ...(plan.state === 'invalid' ? plan.diagnostics : [])]);
    }
    if (!isAgentTarget(input.provider)) return blocked(input, [diagnostic('ADMISSION_PROVIDER_INVALID', `Unknown provider: ${String(input.provider)}.`)], { planDigest: plan.planDigest });
    const provider = input.provider;
    if (input.enabledAgents && !input.enabledAgents.includes(provider)) {
        return blocked(input, [diagnostic('ADMISSION_PROVIDER_DISABLED', `Provider ${provider} is not enabled.`)], { planDigest: plan.planDigest, provider });
    }
    // v1 manifests do not yet carry executionMode in their typed schema. Accept only
    // the exact future field when an already-validated caller supplies it; otherwise
    // preserve the safe interactive default until S3 owns durable unattended binding.
    const manifestMode = (plan.manifest as unknown as { executionMode?: unknown }).executionMode;
    const mode = input.executionMode ?? (manifestMode === 'desatendido' ? 'desatendido' : 'interactivo');
    if (mode !== 'interactivo' && mode !== 'desatendido') return blocked(input, [diagnostic('ADMISSION_EXECUTION_MODE_INVALID', 'Execution mode must be interactivo or desatendido.')], { planDigest: plan.planDigest, provider, executionMode: 'interactivo' });
    if (input.requireCurrent) {
        if (input.provenance !== 'proven') return blocked(input, [diagnostic('ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED', 'Consumed registry contracts cannot be proven from validated plan sources.')], { planDigest: plan.planDigest, provider, executionMode: mode, currentness: 'unverifiable' });
        if (!input.currentness) return blocked(input, [diagnostic('ADMISSION_CURRENTNESS_REQUIRED', 'Currentness evidence was required but not supplied.')], { planDigest: plan.planDigest, provider, executionMode: mode });
        const gate = currentness(input.currentness, input.consumedRegistryComponents ?? []);
        if (gate.diagnostics.length) return blocked(input, gate.diagnostics, { planDigest: plan.planDigest, provider, executionMode: mode, currentness: gate.status });
        if (input.compatibilityDiagnostics?.length) return blocked(input, input.compatibilityDiagnostics, { planDigest: plan.planDigest, provider, executionMode: mode, currentness: 'unverifiable' });
    }
    if (input.verifySensors) {
        if (!input.sensors) return blocked(input, [diagnostic('ADMISSION_SENSORS_REQUIRED', 'Sensor evidence was required but not supplied.')], { planDigest: plan.planDigest, provider, executionMode: mode, currentness: input.requireCurrent ? 'current' : 'not-checked' });
        const sensors = sensorVerdict(input.sensors);
        if (sensors !== 'pass') return blocked(input, [diagnostic('ADMISSION_SENSORS_BLOCKED', `Sensor verdict is ${sensors}.`)], { planDigest: plan.planDigest, provider, executionMode: mode, currentness: input.requireCurrent ? 'current' : 'not-checked', sensors });
    }
    if (mode === 'desatendido') {
        const journal = journalStatus(input, plan);
        if (journal !== 'current') return blocked(input, [diagnostic('ADMISSION_JOURNAL_BINDING_REQUIRED', 'Unattended execution requires a healthy schema-2 journal binding for this exact plan; run watch --init --plan.')], { planDigest: plan.planDigest, provider, executionMode: mode, journal, currentness: input.requireCurrent ? 'current' : 'not-checked', sensors: input.verifySensors ? 'pass' : 'not-required' });
        const capabilities = PROVIDER_EXECUTION_CAPABILITIES[provider];
        const resolution: ProviderExecutionResolution = { outcome: capabilities.unattendedController === 'supported' ? 'native' : 'blocked', provider, capabilities, evidenceVersion: 'r1-v1', diagnostics: [] };
        if (resolution.outcome === 'blocked') return blocked(input, [diagnostic('ADMISSION_CAPABILITY_UNVERIFIED', `Provider ${provider} has no verified unattended execution capability.`)], { planDigest: plan.planDigest, provider, executionMode: mode, journal, currentness: input.requireCurrent ? 'current' : 'not-checked', sensors: input.verifySensors ? 'pass' : 'not-required', capabilityResolution: resolution });
        return completeAdmission(input, plan, provider, mode, journal, input.requireCurrent ? 'current' : 'not-checked', input.verifySensors ? 'pass' : 'not-required', resolution);
    }
    const capabilities = PROVIDER_EXECUTION_CAPABILITIES[provider];
    const resolution: ProviderExecutionResolution = { outcome: capabilities.interactiveExecution === 'supported' ? 'native' : 'blocked', provider, capabilities, evidenceVersion: 'r1-v1', diagnostics: [] };
    if (resolution.outcome === 'blocked') return blocked(input, [diagnostic('ADMISSION_CAPABILITY_UNVERIFIED', `Provider ${provider} has no verified interactive execution capability.`)], { planDigest: plan.planDigest, provider, executionMode: mode, capabilityResolution: resolution });
    return completeAdmission(input, plan, provider, mode, 'not-required', input.requireCurrent ? 'current' : 'not-checked', input.verifySensors ? 'pass' : 'not-required', resolution);
}

function completeAdmission(input: AdmissionInput, plan: Extract<PlanValidationReport, { state: 'valid' }>, provider: AgentTarget, executionMode: ExecutionMode, journal: AdmissionReport['journal'], currentness: AdmissionReport['currentness'], sensors: AdmissionReport['sensors'], capabilityResolution: ProviderExecutionResolution): AdmissionReport {
    if (plan.schema === 'compact-slices/v1') return { state: 'admitted', planState: 'valid', planDigest: plan.planDigest, provider, executionMode, journal, currentness, sensors, capabilityResolution, forecast: forecast(plan.manifest.slices.length), diagnostics: [] };
    const routing = input.routing;
    if (!routing?.runtime || !routing.policy || !routing.capabilities) return blocked(input, [diagnostic('ADMISSION_ROUTING_FACTS_REQUIRED', 'Compact v2 requires an approved policy, current capability receipt, and runtime identity.')], { planDigest: plan.planDigest, provider, executionMode, journal, currentness, sensors, capabilityResolution });
    let runtime: RuntimeKey;
    try { runtime = validateRuntimeKey(routing.runtime); } catch { return blocked(input, [diagnostic('ADMISSION_ROUTING_RUNTIME_INVALID', 'Compact v2 routing runtime identity is invalid.')], { planDigest: plan.planDigest, provider, executionMode, journal, currentness, sensors, capabilityResolution }); }
    if (runtime.target !== provider) return blocked(input, [diagnostic('ADMISSION_ROUTING_PROVIDER_MISMATCH', 'Compact v2 routing runtime target must exactly match the admitted provider.')], { planDigest: plan.planDigest, provider, executionMode, journal, currentness, sensors, capabilityResolution });
    const now = routing.now ?? new Date();
    for (const slice of plan.manifest.slices) {
        const resolved = resolveSelection({ role: 'implementer', requestedProfile: (slice as unknown as { implementerProfile: ImplementerProfile }).implementerProfile, policy: routing.policy, capabilities: routing.capabilities, runtime, now });
        if (resolved.state === 'blocked') return blocked(input, resolved.diagnostics, { planDigest: plan.planDigest, provider, executionMode, journal, currentness, sensors, capabilityResolution });
    }
    return { state: 'admitted', planState: 'valid', planDigest: plan.planDigest, provider, executionMode, journal, currentness, sensors, capabilityResolution, forecast: forecast(plan.manifest.slices.length), routingForecast: routingForecast(plan, routing), diagnostics: [] };
}

// Structural exhaustiveness guard: adding an AgentTarget requires an explicit entry above.
const capabilityTargets: readonly AgentTarget[] = AGENT_TARGETS;
if (Object.keys(PROVIDER_EXECUTION_CAPABILITIES).length !== capabilityTargets.length || !capabilityTargets.every(target => target in PROVIDER_EXECUTION_CAPABILITIES)) throw new Error('provider capability table must be exhaustive');
