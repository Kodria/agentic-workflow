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

function findings(items: unknown, optional = false): DashboardItemV1[] {
    if (optional && items === undefined) return [];
    if (!Array.isArray(items)) throw new Error('Dashboard findings must be an array');
    return items.flatMap((item) => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.trim() === '' || typeof item.label !== 'string' || item.label.trim() === '') throw new Error('Dashboard finding is invalid');
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

function isolatedFindings(items: DashboardFinding[] | undefined): { value?: DashboardItemV1[]; failed: boolean; failure: OptionalFailure } {
    return optional(() => findings(items, true));
}

/** Pure read-only aggregation over injected source adapters. */
export function collectDashboardSnapshot(options: CollectDashboardOptions): DashboardSnapshotV1 {
    if (!options || typeof options.cwd !== 'string' || options.cwd.length === 0 || typeof options.now !== 'string' || Number.isNaN(Date.parse(options.now))) throw new Error('collectDashboardSnapshot requires cwd and valid now');
    const adapters = { ...EMPTY_ADAPTERS, ...(options.adapters ?? {}) };
    const machine = adapters.machine({ cwd: options.cwd });
    if (!Array.isArray(machine?.findings)) throw new Error('Dashboard findings must be an array');
    const root = findProjectRoot(options.cwd);
    const machineItems = findings((sanitizeDashboardSource(machine) as MachineDashboardSource).findings);
    const machineSection = section('machine', 'available', machineItems);
    if (!root) {
        const degraded = machineSection.items.some((item) => item.state !== 'ok' && item.state !== 'not_applicable');
        return validateDashboardSnapshotV1({ schema: 1, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: false, label: 'No project detected' }, confidence: 'none', sections: [machineSection] });
    }

    const projectResult = optional(() => sanitizeDashboardSource(adapters.project({ root })) as ProjectDashboardSource);
    const plansResult = optional(() => sanitizeDashboardSource(adapters.plans({ root })) as PlanDashboardSource[]);
    const executionResult = optional(() => {
        const source = adapters.execution({ root });
        return source === undefined ? undefined : sanitizeDashboardSource(source) as ExecutionDashboardSource;
    });
    const projectSource = projectResult.value;
    const execution = executionResult.value;
    const projectItemsResult = projectSource ? isolatedFindings(projectSource.findings) : { value: [], failed: false, failure: {} };
    const planItemsResult = plansResult.value ? optional(() => findings(plansResult.value!.map((plan) => plan.lifecycle
        ? { ...plan, detail: classifyPlanState(plan.lifecycle) } : plan))) : { value: [], failed: false, failure: {} };
    const executionItems = isolatedFindings(execution?.execution);
    const qaItems = isolatedFindings(execution?.qa);
    const retroItems = isolatedFindings(execution?.retro);
    const historyItems = isolatedFindings(execution?.history);
    const executionUnavailable = !executionResult.failed && execution === undefined;
    const sections = [
        machineSection,
        section('project', projectResult.failed || projectItemsResult.failed ? 'unavailable' : 'available', projectResult.failed
            ? canonicalOptionalFailure(projectResult.failure) : projectItemsResult.failed ? [] : projectItemsResult.value),
        section('planning', plansResult.failed || planItemsResult.failed ? 'unavailable' : 'available', plansResult.failed
            ? canonicalOptionalFailure(plansResult.failure) : planItemsResult.failed ? [] : planItemsResult.value),
        section('execution', executionResult.failed || executionUnavailable || executionItems.failed ? 'unavailable' : 'available', executionResult.failed ? canonicalOptionalFailure(executionResult.failure) : executionUnavailable ? canonicalOptionalFailure({ findingId: 'execution.source.unavailable', remediationVerified: true }) : executionItems.value),
        // There is no read-only QA, retro, or history adapter in Release A. An
        // absent execution source is not evidence of a successful empty cycle.
        section('qa', executionResult.failed || executionUnavailable || qaItems.failed ? 'unavailable' : 'available', qaItems.value),
        section('retro', executionResult.failed || executionUnavailable || retroItems.failed ? 'unavailable' : 'available', retroItems.value),
        section('history', executionResult.failed || executionUnavailable || historyItems.failed ? 'unavailable' : 'available', historyItems.value),
    ];
    const degraded = sections.some((entry) => entry.availability === 'unavailable' || entry.items.some((item) => item.state !== 'ok' && item.state !== 'not_applicable'));
    return validateDashboardSnapshotV1({ schema: 1, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: true, label: projectSource?.label || 'Project detected' }, confidence: 'provisional', sections });
}
