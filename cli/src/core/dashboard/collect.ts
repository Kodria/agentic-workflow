import { findProjectRoot } from '../profile';
import fs from 'fs';
import path from 'path';
import { buildEvidenceHistory } from '../evidence/history';
import { sanitizeDashboardSource } from './sanitize';
import { validateDashboardSnapshotV1 } from './validate';
import { classifyPlanState, type PlanStateInput } from './plan-state';
import type { DashboardItemState, DashboardItemV1, DashboardSectionV1, DashboardSnapshotV1 } from './types';
import type { HarnessContext, ProviderCheck, ProviderCheckState } from '../diagnostics/types';

export interface DashboardFinding { id: string; label: string; state: DashboardItemState; detail?: string; remediation?: string; remediationVerified?: boolean; }
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

const SAFE_REMEDIATIONS = new Set(['awm init', 'awm update', 'awm sync', 'awm sensors status', 'awm preflight']);
const HEALTHY_PROVIDER_STATES = new Set<ProviderCheckState>(['supported', 'healthy', 'shared', 'delivered']);
const INAPPLICABLE_PROVIDER_STATES = new Set<ProviderCheckState>(['unsupported']);

function providerState(state: ProviderCheckState): DashboardItemState {
    if (HEALTHY_PROVIDER_STATES.has(state)) return 'ok';
    if (INAPPLICABLE_PROVIDER_STATES.has(state)) return 'not_applicable';
    return 'attention';
}

/**
 * Maps the already-gathered diagnostics matrix into the snapshot's read-only
 * source seam. It deliberately does not re-read providers, execute sensors, or
 * relay provider detail/remediation prose: those values can contain local paths,
 * command output, or credentials. The fixed IDs are derived solely from the
 * provider/check enums and therefore remain stable across runs.
 */
export function productionDashboardAdapters(context: HarnessContext): DashboardSourceAdapters {
    if (!context || typeof context !== 'object' || !Array.isArray(context.providers)) throw new Error('productionDashboardAdapters requires gathered provider diagnostics');
    const machineFindings: DashboardFinding[] = context.providers.flatMap((provider) => provider.checks.flatMap((check: ProviderCheck) => {
        const finding: DashboardFinding = {
            id: `machine.provider.${provider.id}.${check.id}`,
            // Provider labels are configuration prose. The provider id and check id
            // are enum-controlled and sufficient for a stable public observation.
            label: `Provider ${provider.id}: ${check.id}`,
            state: providerState(check.state),
            // Provider remediation is intentionally not forwarded. It is free-form
            // diagnostics text, not a dashboard-approved canonical command.
            remediationVerified: false,
        };
        // These two legacy diagnosis states are the only provider observations
        // with a pre-existing, exact dashboard command mapping.
        if (check.id === 'skills.global' && check.state === 'absent') {
            return [finding, { id: 'machine.preferences.missing', label: 'Preferences', state: 'missing', remediationVerified: true }];
        }
        if (check.id === 'skills.global' && check.state === 'stale') {
            return [finding, { id: 'machine.registries.stale', label: 'Registries', state: 'attention', remediationVerified: true }];
        }
        return [finding];
    }));
    const project = context.project;
    const projectFindings: DashboardFinding[] = !project ? [] : [
        { id: project.profile.present ? 'project.profile.present' : 'project.profile.missing', label: 'Profile', state: project.profile.present ? 'ok' : 'missing', remediation: 'awm init', remediationVerified: true },
        { id: 'project.extensions.configured', label: 'Extensions', state: project.profile.extensions.length > 0 ? 'ok' : 'not_applicable' },
        { id: 'project.registry-pins.present', label: 'Registry pins', state: project.profile.registries && Object.keys(project.profile.registries).length > 0 ? 'ok' : 'not_applicable' },
        { id: 'project.bundles.coherent', label: 'Active bundles', state: project.activeBundles.broken.length === 0 ? 'ok' : 'attention', remediation: 'awm sync', remediationVerified: true },
        { id: 'project.context.present', label: 'Project context', state: project.context.present ? 'ok' : 'missing', remediation: 'awm init', remediationVerified: true },
        { id: 'project.constitution.present', label: 'Constitution', state: project.constitution.present ? 'ok' : 'missing' },
        { id: project.sensors.present ? 'project.sensors.present' : 'project.sensors.unavailable', label: 'Sensors', state: project.sensors.present ? 'ok' : 'unavailable', remediation: 'awm sensors status', remediationVerified: true },
        // `preflight()` is async because static tool inspection is async. Doctor's
        // synchronous legacy API must not dispatch it here; make the absence of that
        // observation explicit rather than inventing a readiness verdict.
        { id: 'project.preflight.not_collected', label: 'Static preflight', state: 'not_applicable' },
    ];
    return {
        machine: () => ({ findings: machineFindings }),
        project: () => ({ label: 'Project detected', findings: projectFindings }),
        plans: () => [],
        execution: () => undefined,
    };
}

function findings(items: unknown, optional = false): DashboardItemV1[] {
    if (optional && items === undefined) return [];
    if (!Array.isArray(items)) throw new Error('Dashboard findings must be an array');
    return items.flatMap((item) => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.trim() === '' || typeof item.label !== 'string' || item.label.trim() === '') throw new Error('Dashboard finding is invalid');
        if (!['ok', 'attention', 'missing', 'unavailable', 'not_applicable'].includes(item.state)) throw new Error('Dashboard finding state is invalid');
        const remediation = REMEDIATION_BY_FINDING_ID[item.id]
            ?? (item.remediationVerified === true && typeof item.remediation === 'string' && SAFE_REMEDIATIONS.has(item.remediation) ? item.remediation : undefined);
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

function evidenceHistoryItems(root: string): { confidence: DashboardSnapshotV1['confidence']; items: DashboardItemV1[] } {
    const awmDirectory = path.join(root, '.awm');
    const evidenceDirectory = path.join(awmDirectory, 'evidence');
    const directory = path.join(evidenceDirectory, 'cycles');
    for (const ancestor of [awmDirectory, evidenceDirectory, directory]) {
        let stat: fs.Stats;
        try { stat = fs.lstatSync(ancestor); } catch (error) {
            if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return { confidence: 'none', items: [] };
            throw error;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('evidence history directory is unsafe');
    }
    const records = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
            if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error('evidence history contains an unsupported entry');
            const file = path.join(directory, entry.name);
            if (fs.lstatSync(file).isSymbolicLink()) throw new Error('evidence history file is unsafe');
            return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
        });
    const history = buildEvidenceHistory(records);
    return {
        confidence: history.confidence,
        items: history.cycles.map((cycle) => {
            const cures = cycle.cureEfficacy.length === 0 ? 'none' : cycle.cureEfficacy.map((cure) => cure.efficacy).join(', ');
            return {
                id: `history.cycle.${cycle.cycleId}`,
                label: `Cycle ${cycle.cycleId.slice(0, 12)}`,
                state: cycle.cycleState === 'blocked' ? 'attention' : 'ok',
                detail: `plan ${cycle.plan.state}; tasks ${cycle.tasks.length}; retries ${cycle.retries}; QA ${cycle.qa.findings}/${cycle.qa.fixes}; first-pass ${cycle.gates.firstPass ? 'yes' : 'no'}; cures ${cures}`,
            };
        }),
    };
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
    const evidenceResult = optional(() => evidenceHistoryItems(root));
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
        section('history', evidenceResult.failed ? 'unavailable' : 'available', evidenceResult.failed ? [] : evidenceResult.value!.items),
    ];
    const degraded = sections.some((entry) => entry.availability === 'unavailable' || entry.items.some((item) => item.state !== 'ok' && item.state !== 'not_applicable'));
    return validateDashboardSnapshotV1({ schema: 1, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: true, label: projectSource?.label || 'Project detected' }, confidence: evidenceResult.failed ? 'none' : evidenceResult.value!.confidence, sections });
}
