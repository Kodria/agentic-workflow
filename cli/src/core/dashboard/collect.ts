import { findProjectRoot } from '../profile';
import { sanitizeDashboardSource } from './sanitize';
import { validateDashboardSnapshotV1 } from './validate';
import { classifyPlanState, type PlanStateInput } from './plan-state';
import type { DashboardItemState, DashboardItemV1, DashboardSectionV1, DashboardSnapshotV1 } from './types';

export interface DashboardFinding { id: string; label: string; state: DashboardItemState; detail?: string; }
export interface MachineDashboardSource { findings?: DashboardFinding[]; }
export interface ProjectDashboardSource { label?: string; findings?: DashboardFinding[]; }
export interface PlanDashboardSource { id: string; label: string; state: DashboardItemState; detail?: string; lifecycle?: PlanStateInput; }
export interface ExecutionDashboardSource {
    execution?: DashboardFinding[]; qa?: DashboardFinding[]; retro?: DashboardFinding[]; history?: DashboardFinding[];
}
export interface DashboardSourceAdapters {
    machine(input: { cwd: string }): MachineDashboardSource;
    project(input: { root: string }): ProjectDashboardSource;
    plans(input: { root: string }): PlanDashboardSource[];
    execution(input: { root: string }): ExecutionDashboardSource | undefined;
}
export interface CollectDashboardOptions { cwd: string; now: string; adapters?: DashboardSourceAdapters; }
type OptionalFailure = { findingId?: string; remediationVerified?: boolean };

export const REMEDIATION_BY_FINDING_ID: Readonly<Record<string, string>> = {
    'machine.preferences.missing': 'awm init',
    'machine.registries.stale': 'awm update',
    'project.profile.missing': 'awm init',
    'project.sensors.unavailable': 'awm sensors status',
    'project.preflight.degraded': 'awm preflight',
    'planning.source.unavailable': 'awm preflight',
    'execution.source.unavailable': 'awm sensors status',
};

const EMPTY_ADAPTERS: DashboardSourceAdapters = {
    machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined,
};

function findings(items: DashboardFinding[] | undefined): DashboardItemV1[] {
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.label !== 'string') throw new Error('Dashboard finding is invalid');
        if (!['ok', 'attention', 'missing', 'unavailable', 'not_applicable'].includes(item.state)) throw new Error('Dashboard finding state is invalid');
        const remediation = REMEDIATION_BY_FINDING_ID[item.id];
        if (item.state !== 'ok' && item.state !== 'not_applicable' && !remediation) return [];
        return [{ id: item.id, label: item.label, state: item.state, ...(item.detail ? { detail: item.detail } : {}), ...(remediation ? { remediation } : {}) }];
    }).sort((left, right) => left.id.localeCompare(right.id));
}

function section(id: DashboardSectionV1['id'], availability: DashboardSectionV1['availability'], items: DashboardItemV1[] = []): DashboardSectionV1 {
    return { id, availability, items };
}

function optional<T>(source: () => T): { value?: T; failed: boolean; failure: OptionalFailure } {
    try { return { value: source(), failed: false, failure: {} }; } catch (error) {
        const findingId = error && typeof error === 'object' && typeof (error as { findingId?: unknown }).findingId === 'string'
            ? (error as { findingId: string }).findingId : undefined;
        const remediationVerified = error !== null && typeof error === 'object'
            ? (error as { remediationVerified?: unknown }).remediationVerified === true : false;
        return { failed: true, failure: { findingId, remediationVerified } };
    }
}

function canonicalOptionalFailure(failure: OptionalFailure): DashboardItemV1[] {
    if (!failure.remediationVerified || !failure.findingId || !Object.hasOwn(REMEDIATION_BY_FINDING_ID, failure.findingId)) return [];
    return [{ id: failure.findingId, label: 'Optional source unavailable', state: 'unavailable', remediation: REMEDIATION_BY_FINDING_ID[failure.findingId] }];
}

/** Pure read-only aggregation over injected source adapters. */
export function collectDashboardSnapshot(options: CollectDashboardOptions): DashboardSnapshotV1 {
    if (!options || typeof options.cwd !== 'string' || options.cwd.length === 0 || typeof options.now !== 'string' || Number.isNaN(Date.parse(options.now))) throw new Error('collectDashboardSnapshot requires cwd and valid now');
    const adapters = { ...EMPTY_ADAPTERS, ...(options.adapters ?? {}) };
    const machine = adapters.machine({ cwd: options.cwd });
    const root = findProjectRoot(options.cwd);
    const machineSection = section('machine', 'available', findings((sanitizeDashboardSource(machine) as MachineDashboardSource).findings));
    if (!root) {
        const degraded = machineSection.items.some((item) => item.state !== 'ok' && item.state !== 'not_applicable');
        return validateDashboardSnapshotV1({ schema: 1, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: false, label: 'No project detected' }, confidence: 'none', sections: [machineSection] });
    }

    const projectResult = optional(() => adapters.project({ root }));
    const plansResult = optional(() => adapters.plans({ root }));
    const executionResult = optional(() => adapters.execution({ root }));
    const projectSource = projectResult.value ? sanitizeDashboardSource(projectResult.value) as ProjectDashboardSource : undefined;
    const execution = executionResult.value ? sanitizeDashboardSource(executionResult.value) as ExecutionDashboardSource : undefined;
    const planItems = plansResult.value ? findings((sanitizeDashboardSource(plansResult.value) as PlanDashboardSource[]).map((plan) => plan.lifecycle
        ? { ...plan, detail: classifyPlanState(plan.lifecycle) } : plan)) : [];
    const sections = [
        machineSection,
        section('project', projectResult.failed ? 'unavailable' : 'available', projectResult.failed ? canonicalOptionalFailure(projectResult.failure) : findings(projectSource?.findings)),
        section('planning', plansResult.failed ? 'unavailable' : 'available', plansResult.failed ? canonicalOptionalFailure(plansResult.failure) : planItems),
        section('execution', executionResult.failed ? 'unavailable' : 'available', executionResult.failed ? canonicalOptionalFailure(executionResult.failure) : findings(execution?.execution)),
        section('qa', executionResult.failed ? 'unavailable' : 'available', findings(execution?.qa)),
        section('retro', executionResult.failed ? 'unavailable' : 'available', findings(execution?.retro)),
        section('history', executionResult.failed ? 'unavailable' : 'available', findings(execution?.history)),
    ];
    const degraded = sections.some((entry) => entry.availability === 'unavailable' || entry.items.some((item) => item.state !== 'ok' && item.state !== 'not_applicable'));
    return validateDashboardSnapshotV1({ schema: 1, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: true, label: projectSource?.label || 'Project detected' }, confidence: 'provisional', sections });
}
