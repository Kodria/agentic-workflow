import type { AgentTarget } from '../../providers';
import { AGENT_TARGETS, isAgentTarget } from '../../providers';
import type { CurrentnessReport } from '../currentness/types';
import type { PlanDiagnostic, PlanValidationReport } from '../plan/types';
import type { RunOutput } from '../../commands/sensors/types';

export type ExecutionMode = 'interactivo' | 'desatendido';
export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';
export type ProviderExecutionCapabilities = {
    artifactDelivery: CapabilityStatus; interactiveExecution: CapabilityStatus; unattendedController: CapabilityStatus;
    nativeSubagents: CapabilityStatus; modelOverride: CapabilityStatus; effortOverride: CapabilityStatus;
    observedModelEvidence: CapabilityStatus; durableResume: CapabilityStatus;
};
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
};
export type AdmissionInput = {
    plan: PlanValidationReport; provider: string; cwd: string; enabledAgents?: readonly AgentTarget[];
    executionMode?: ExecutionMode; requireCurrent?: boolean; verifySensors?: boolean;
    currentness?: CurrentnessReport; sensors?: RunOutput;
    /** Exact registry components reached from validated plan-source provenance. */
    consumedRegistryComponents?: readonly string[];
    /** No registry may be ignored until source-to-contract provenance is complete. */
    provenance?: 'proven' | 'unknown';
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

/** Defensive public-output boundary for injected dependencies as well as core reports. */
export function sanitizeAdmissionReport(report: AdmissionReport): AdmissionReport {
    return { ...report, diagnostics: sanitizeDiagnostics(Array.isArray(report.diagnostics) ? report.diagnostics : []) };
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
    if (input.requireCurrent) {
        if (input.provenance !== 'proven') return blocked(input, [diagnostic('ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED', 'Consumed registry contracts cannot be proven from validated plan sources.')], { planDigest: plan.planDigest, provider, executionMode: mode, currentness: 'unverifiable' });
        if (!input.currentness) return blocked(input, [diagnostic('ADMISSION_CURRENTNESS_REQUIRED', 'Currentness evidence was required but not supplied.')], { planDigest: plan.planDigest, provider, executionMode: mode });
        const gate = currentness(input.currentness, input.consumedRegistryComponents ?? []);
        if (gate.diagnostics.length) return blocked(input, gate.diagnostics, { planDigest: plan.planDigest, provider, executionMode: mode, currentness: gate.status });
    }
    if (input.verifySensors) {
        if (!input.sensors) return blocked(input, [diagnostic('ADMISSION_SENSORS_REQUIRED', 'Sensor evidence was required but not supplied.')], { planDigest: plan.planDigest, provider, executionMode: mode, currentness: input.requireCurrent ? 'current' : 'not-checked' });
        const sensors = sensorVerdict(input.sensors);
        if (sensors !== 'pass') return blocked(input, [diagnostic('ADMISSION_SENSORS_BLOCKED', `Sensor verdict is ${sensors}.`)], { planDigest: plan.planDigest, provider, executionMode: mode, currentness: input.requireCurrent ? 'current' : 'not-checked', sensors });
    }
    if (mode === 'desatendido') {
        return blocked(input, [diagnostic('ADMISSION_JOURNAL_SCHEMA_2_REQUIRED', 'Schema-2 plan binding is not available until S3; run watch --init --plan after S3.')], { planDigest: plan.planDigest, provider, executionMode: mode, journal: 'missing', currentness: input.requireCurrent ? 'current' : 'not-checked', sensors: input.verifySensors ? 'pass' : 'not-required' });
    }
    const capabilities = PROVIDER_EXECUTION_CAPABILITIES[provider];
    const resolution: ProviderExecutionResolution = { outcome: capabilities.interactiveExecution === 'supported' ? 'native' : 'blocked', provider, capabilities, evidenceVersion: 'r1-v1', diagnostics: [] };
    if (resolution.outcome === 'blocked') return blocked(input, [diagnostic('ADMISSION_CAPABILITY_UNVERIFIED', `Provider ${provider} has no verified interactive execution capability.`)], { planDigest: plan.planDigest, provider, executionMode: mode, capabilityResolution: resolution });
    return { state: 'admitted', planState: 'valid', planDigest: plan.planDigest, provider, executionMode: mode, journal: 'not-required', currentness: input.requireCurrent ? 'current' : 'not-checked', sensors: input.verifySensors ? 'pass' : 'not-required', capabilityResolution: resolution, forecast: forecast(plan.manifest.slices.length), diagnostics: [] };
}

// Structural exhaustiveness guard: adding an AgentTarget requires an explicit entry above.
const capabilityTargets: readonly AgentTarget[] = AGENT_TARGETS;
if (Object.keys(PROVIDER_EXECUTION_CAPABILITIES).length !== capabilityTargets.length || !capabilityTargets.every(target => target in PROVIDER_EXECUTION_CAPABILITIES)) throw new Error('provider capability table must be exhaustive');
