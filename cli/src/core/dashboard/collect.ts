import { findProjectRoot } from '../profile';
import fs from 'fs';
import path from 'path';
import { buildEvidenceHistory, type EvidenceHistory } from '../evidence/history';
import { validateCycleEvidence } from '../evidence/types';
import { detectBranch } from '../ledger/store';
import { journalDir, statePath } from '../journal/paths';
import { readJournal } from '../journal/store';
import { discoverProcessModels } from '../process/discover';
import { sanitizeDashboardSource, sanitizeDashboardId, sanitizeDashboardLabel } from './sanitize';
import { validateDashboardSnapshotV1 } from './validate';
import { classifyPlanState, type PlanStateInput } from './plan-state';
import type { DashboardItemState, DashboardItemV1, DashboardSectionV1, DashboardSnapshotV1 } from './types';
import type { HarnessContext, ProviderCheck, ProviderCheckState } from '../diagnostics/types';

export interface DashboardFinding { id: string; label: string; state: DashboardItemState; detail?: string; remediation?: string; remediationVerified?: boolean; }
export interface MachineDashboardSource { findings?: DashboardFinding[]; }
export interface ProjectDashboardSource { label?: string; findings?: DashboardFinding[]; }
export interface PlanDashboardSource { id: string; label: string; state: DashboardItemState; detail?: string; lifecycle?: PlanStateInput; }
export interface ExecutionDashboardSource {
    execution?: DashboardFinding[]; qa?: DashboardFinding[]; docs?: DashboardFinding[]; retro?: DashboardFinding[]; history?: DashboardFinding[];
}
export interface ProcessDashboardSource { name: string; status: 'draft' | 'active' }

export interface DashboardSourceAdapters {
    machine(input: { cwd: string }): MachineDashboardSource;
    project(input: { root: string }): ProjectDashboardSource;
    plans(input: { root: string }): PlanDashboardSource[];
    execution(input: { root: string }): ExecutionDashboardSource | undefined;
    processes(input: { root: string }): ProcessDashboardSource[];
}
export interface CollectDashboardOptions { cwd: string; now: string; adapters?: DashboardSourceAdapters; }
type OptionalFailure = { findingId?: string; remediationVerified?: boolean };
type JournalOverlay = { state: 'active' | 'blocked'; tasks: { total: number; completed: number } };

export const REMEDIATION_BY_FINDING_ID: Readonly<Record<string, string>> = {
    'machine.preferences.missing': 'awm init',
    'machine.registries.stale': 'awm update',
    'project.profile.missing': 'awm init',
    'project.sensors.unavailable': 'awm sensors status',
    'project.preflight.degraded': 'awm preflight',
    'planning.source.unavailable': 'awm preflight',
    'execution.source.unavailable': 'awm sensors status',
};

const BLOCKED_CYCLE_REMEDIATION = 'awm preflight';

const EMPTY_ADAPTERS: DashboardSourceAdapters = {
    machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined, processes: () => [],
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
        plans: ({ root }) => {
            const history = readEvidenceHistory(root);
            const journal = readJournalOverlay(root);
            const latestCycleId = history.cycles.at(-1)?.cycleId;
            const latestByPlan = new Map<string, typeof history.cycles[number]>();
            for (const cycle of history.cycles) latestByPlan.set(cycle.plan.ref, cycle);
            if (latestByPlan.size === 0 && journal) return [journalPlanFinding(journal)];
            return [...latestByPlan.values()].map((cycle) => {
                const overlay = cycle.cycleId === latestCycleId ? journal : undefined;
                const blocked = overlay?.state === 'blocked' || cycle.plan.state === 'blocked';
                return {
                    id: `planning.cycle.${cycle.cycleId}`,
                    // The plan reference is intentionally never rendered: a plan path
                    // can expose repository-specific names. Its opaque cycle ID gives
                    // the dashboard deterministic identity without exporting it.
                    label: 'Project context',
                    state: blocked ? 'attention' : 'ok',
                    ...(blocked ? { remediation: BLOCKED_CYCLE_REMEDIATION, remediationVerified: true } : {}),
                    lifecycle: overlay ? lifecycleForJournal(overlay) : lifecycleForCycle(cycle),
                };
            });
        },
        execution: ({ root }) => {
            const journal = readJournalOverlay(root);
            if (!evidenceDirectoryExists(root)) return journal ? journalExecutionFinding(journal) : undefined;
            const history = readEvidenceHistory(root);
            if (history.cycles.length === 0) return journal ? journalExecutionFinding(journal) : undefined;
            return {
                execution: history.cycles.map((cycle) => cycleFinding('execution', 'Static preflight', cycle, cycle.cycleState === 'blocked')),
                qa: history.cycles.map((cycle) => cycleFinding('qa', 'Sensors', cycle, cycle.qa.fixes < cycle.qa.findings)),
                docs: history.cycles.map((cycle) => cycleFinding('docs', 'Documentation', cycle, !lifecycleForCycle(cycle).markers.docsComplete)),
                retro: history.cycles.map((cycle) => cycleFinding('retro', 'Project context', cycle, cycle.plan.state !== 'executed')),
            };
        },
        processes: () => discoverProcessModels().models.map((m) => ({ name: m.name, status: m.status })),
    };
}

/** A journal has no durable plan reference. Use a generic fixed row so its
 * authoritative lifecycle remains visible without publishing branch or path. */
function journalPlanFinding(overlay: JournalOverlay): PlanDashboardSource {
    const blocked = overlay.state === 'blocked';
    return {
        id: 'planning.current-journal', label: 'Project context', state: blocked ? 'attention' : 'ok',
        ...(blocked ? { remediation: BLOCKED_CYCLE_REMEDIATION, remediationVerified: true } : {}),
        lifecycle: lifecycleForJournal(overlay),
    };
}

function journalExecutionFinding(overlay: JournalOverlay): ExecutionDashboardSource {
    const blocked = overlay.state === 'blocked';
    return {
        execution: [{
            id: 'execution.current-journal', label: 'Static preflight', state: blocked ? 'attention' : 'ok',
            ...(blocked ? { remediation: BLOCKED_CYCLE_REMEDIATION, remediationVerified: true } : {}),
        }],
        qa: [], docs: [], retro: [],
    };
}

function lifecycleForJournal(overlay: JournalOverlay): PlanStateInput {
    return { journal: { state: overlay.state }, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: overlay.tasks };
}

/** Reconstructs a PlanStateInput (markers + tasks) from a stored historical
 * evidence record's plan.state for display purposes — the inverse of the
 * live→durable direction. `retro_pending` predates the docs phase: that
 * evidence was written before `docsComplete` existed, so treating it as
 * docs-done is the only non-regressive reading; reconstructing it as
 * `docsComplete: false` would invent retroactive docs debt on every
 * historical cycle. */
export function lifecycleForCycle(cycle: ReturnType<typeof readEvidenceHistory>['cycles'][number]): PlanStateInput {
    const total = cycle.tasks.length;
    if (cycle.plan.state === 'blocked' || cycle.cycleState === 'blocked') return { journal: { state: 'blocked' }, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total, completed: 0 } };
    if (cycle.plan.state === 'active') return { journal: { state: 'active' }, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total, completed: 0 } };
    if (cycle.plan.state === 'executed') return { markers: { qaComplete: true, docsComplete: true, retroComplete: true }, tasks: { total, completed: total } };
    if (cycle.plan.state === 'retro_pending') return { markers: { qaComplete: true, docsComplete: true, retroComplete: false }, tasks: { total, completed: total } };
    if (cycle.plan.state === 'qa_pending') return { markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total, completed: total } };
    return { markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total: 0, completed: 0 } };
}

function cycleFinding(section: 'execution' | 'qa' | 'docs' | 'retro', label: string, cycle: ReturnType<typeof readEvidenceHistory>['cycles'][number], actionable: boolean): DashboardFinding {
    return {
        id: `${section}.cycle.${cycle.cycleId}`,
        label,
        state: actionable ? 'attention' : 'ok',
        ...(actionable ? { remediation: BLOCKED_CYCLE_REMEDIATION, remediationVerified: true } : {}),
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

function evidenceDirectoryExists(root: string): boolean {
    try { return fs.lstatSync(path.join(root, '.awm', 'evidence', 'cycles')).isDirectory(); }
    catch (error) {
        if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/** Reads only the current branch journal. Missing journals are not observations;
 * corrupt or redirected journal paths fail closed rather than changing lifecycle
 * state from untrusted content. */
function readJournalOverlay(root: string): JournalOverlay | undefined {
    const branch = detectBranch(root);
    const file = statePath(root, branch);
    if (!safeJournalStateExists(root, branch, file)) return undefined;
    const journal = readJournal(root, branch);
    if (journal.corrupt || !journal.state) throw new Error('current journal is unavailable or corrupt');
    if (journal.state.cycle.status === 'COMPLETE') return undefined;
    return {
        state: journal.state.cycle.status === 'BLOCKED' ? 'blocked' : 'active',
        tasks: { total: journal.state.tasks.length, completed: journal.state.tasks.filter((task) => task.status === 'done').length },
    };
}

function safeJournalStateExists(root: string, branch: string, file: string): boolean {
    for (const directory of [path.join(root, '.awm'), path.join(root, '.awm', 'journal'), journalDir(root, branch)]) {
        let stat: fs.Stats;
        try { stat = fs.lstatSync(directory); } catch (error) {
            if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('journal directory is unsafe');
    }
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); } catch (error) {
        if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('journal state is unsafe');
    return true;
}

function readEvidenceHistory(root: string): EvidenceHistory {
    const awmDirectory = path.join(root, '.awm');
    const evidenceDirectory = path.join(awmDirectory, 'evidence');
    const directory = path.join(evidenceDirectory, 'cycles');
    for (const ancestor of [awmDirectory, evidenceDirectory, directory]) {
        let stat: fs.Stats;
        try { stat = fs.lstatSync(ancestor); } catch (error) {
            if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return buildEvidenceHistory([]);
            throw error;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('evidence history directory is unsafe');
    }
    const seenCycleIds = new Set<string>();
    const records = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
            if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error('evidence history contains an unsupported entry');
            const file = path.join(directory, entry.name);
            if (fs.lstatSync(file).isSymbolicLink()) throw new Error('evidence history file is unsafe');
            const evidence = validateCycleEvidence(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
            if (entry.name !== `${evidence.cycleId}.json` || seenCycleIds.has(evidence.cycleId)) throw new Error('evidence history filename is invalid');
            seenCycleIds.add(evidence.cycleId);
            return evidence;
        });
    return buildEvidenceHistory(records);
}

function evidenceHistoryItems(root: string): { confidence: DashboardSnapshotV1['confidence']; items: DashboardItemV1[] } {
    const history = readEvidenceHistory(root);
    return {
        confidence: history.confidence,
        items: history.cycles.map((cycle) => {
            const cures = cycle.cureEfficacy.length === 0 ? 'none' : cycle.cureEfficacy.map((cure) => cure.efficacy).join(', ');
            return {
                id: `history.cycle.${cycle.cycleId}`,
                label: `Cycle ${cycle.cycleId.slice(0, 12)}`,
                state: cycle.cycleState === 'blocked' ? 'attention' : 'ok',
                ...(cycle.cycleState === 'blocked' ? { remediation: BLOCKED_CYCLE_REMEDIATION } : {}),
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
        return validateDashboardSnapshotV1({ schema: 2, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: false, label: 'No project detected' }, confidence: 'none', sections: [machineSection] });
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
    const docsItems = isolatedFindings(execution?.docs);
    const retroItems = isolatedFindings(execution?.retro);
    const evidenceResult = optional(() => evidenceHistoryItems(root));
    const executionUnavailable = !executionResult.failed && execution === undefined;
    const processesResult = optional(() => sanitizeDashboardSource(adapters.processes({ root })) as ProcessDashboardSource[]);
    // `id`/`label`/`detail` se construyen acá, en código de aplicación, DESPUÉS de
    // la sanitización de source — igual que `planning` hace con `classifyPlanState`:
    // el sanitizador descarta todo `detail` que venga del adapter (sanitize.ts), así
    // que ponerlo antes sería escribirlo para que se borre en silencio. Y como estos
    // tres campos nunca pasan por el recorrido recursivo de sanitizeDashboardSource
    // de arriba, se los corre por las mismas ramas de sanitize() (sanitizeDashboardId/
    // sanitizeDashboardLabel) para sostener la segunda barrera: un `p.name` que no es
    // slug cae al id hasheado `item-*` en vez de colarse como `process.<bad-name>`.
    // El estado `attention` es accionable (ver validate.ts): un modelo en draft no
    // tiene un comando que lo "arregle" — el remediation apunta a inspeccionarlo, no
    // a resolverlo automáticamente.
    const processItems: DashboardItemV1[] = (processesResult.value ?? []).map((p) => ({
        id: sanitizeDashboardId(`process.${p.name}`),
        // El literal 'Process' ya está en CANONICAL_LABELS, así que el branch
        // [redacted] de sanitizeDashboardLabel nunca se ejecuta desde este call
        // site hoy — el wrapper queda por simetría con sanitizeDashboardId y como
        // guardia ante un futuro label dinámico, no porque esta llamada pueda fallar.
        label: sanitizeDashboardLabel('Process'),
        state: p.status === 'active' ? 'ok' : 'attention',
        detail: p.status,
        ...(p.status === 'active' ? {} : { remediation: 'awm process list' }),
    }));
    const sections = [
        machineSection,
        section('project', projectResult.failed || projectItemsResult.failed ? 'unavailable' : 'available', projectResult.failed
            ? canonicalOptionalFailure(projectResult.failure) : projectItemsResult.failed ? [] : projectItemsResult.value),
        section('planning', plansResult.failed || planItemsResult.failed ? 'unavailable' : 'available', plansResult.failed
            ? canonicalOptionalFailure(plansResult.failure) : planItemsResult.failed ? [] : planItemsResult.value),
        section('execution', executionResult.failed || executionUnavailable || executionItems.failed ? 'unavailable' : 'available', executionResult.failed ? canonicalOptionalFailure(executionResult.failure) : executionUnavailable ? canonicalOptionalFailure({ findingId: 'execution.source.unavailable', remediationVerified: true }) : executionItems.value),
        // There is no read-only QA, docs, retro, or history adapter in Release A. An
        // absent execution source is not evidence of a successful empty cycle.
        section('qa', executionResult.failed || executionUnavailable || qaItems.failed ? 'unavailable' : 'available', qaItems.value),
        section('docs', executionResult.failed || executionUnavailable || docsItems.failed ? 'unavailable' : 'available', docsItems.value),
        section('retro', executionResult.failed || executionUnavailable || retroItems.failed ? 'unavailable' : 'available', retroItems.value),
        section('history', evidenceResult.failed ? 'unavailable' : 'available', evidenceResult.failed ? [] : evidenceResult.value!.items),
        // R1a puebla `processes` desde su adapter. Sin modelos declarados la
        // sección conserva `not_applicable` — el mismo valor que R0 dejó
        // reservado — para que un proyecto sin procesos se vea igual que antes.
        section('processes', processesResult.failed ? 'unavailable' : processItems.length === 0 ? 'not_applicable' : 'available',
            processesResult.failed ? [] : processItems),
    ];
    const degraded = sections.some((entry) => entry.availability === 'unavailable' || entry.items.some((item) => item.state !== 'ok' && item.state !== 'not_applicable'));
    return validateDashboardSnapshotV1({ schema: 2, generatedAt: options.now, overall: degraded ? 'degraded' : 'healthy', project: { detected: true, label: projectSource?.label || 'Project detected' }, confidence: evidenceResult.failed ? 'none' : evidenceResult.value!.confidence, sections });
}
