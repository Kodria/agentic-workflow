import { Command } from 'commander';
import { assertVerifiedValidPlanReport, validatePlanFile } from '../../core/plan/validate';
import type { PlanDiagnostic, PlanValidationReport } from '../../core/plan/types';
import { admitPlan, sanitizeAdmissionReport, type AdmissionInput, type AdmissionReport } from '../../core/admission';
import { checkCurrentness } from '../../core/currentness/check';
import { runSensors } from '../sensors/run';
import { readPreferences } from '../../utils/config';
import { isAgentTarget } from '../../providers';
import { listRegistries, type RegistrySource } from '../../core/registries';
import { admitRegistryPlan } from '../../core/admission/registry-contracts';
import { CONTROLLER_AUTONOMIES, isControllerAutonomy } from '../../core/journal/adapter';
import path from 'path';
import { execFileSync } from 'child_process';
import { readJournal } from '../../core/journal/store';
import { collectIssue148HistoricalFacts, collectMigrationFacts, type MigrationFactsReport } from '../../core/migration';
import { readEffectivePolicy } from '../../core/model-policy/store';
import { readCapabilities, validateRuntimeKey } from '../../core/model-policy/capabilities';
import { resolveDispatch, resolveEscalatedSelection } from '../../core/model-policy/resolve';
import { resolveLineageEscalation } from '../../core/model-policy/journal';
import type { ImplementerProfile, RoutingRole } from '../../core/model-policy/types';

const SUPPORTED_SCHEMA = 'compact-slices/v1, compact-slices/v2';
const MAX_PATH_LENGTH = 4096;
const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_LENGTH = 4096;

export interface PlanCommandDependencies {
    validatePlanFile: (planPath: string, cwd: string) => PlanValidationReport;
    admitPlan?: (input: AdmissionInput) => Promise<AdmissionReport>;
    checkCurrentness?: typeof checkCurrentness;
    runSensors?: typeof runSensors;
    readPreferences?: typeof readPreferences;
    listRegistries?: () => RegistrySource[];
    collectMigrationFacts?: (planPath: string, cwd: string, issueLinks: string[]) => MigrationFactsReport;
    readEffectivePolicy?: typeof readEffectivePolicy;
    readCapabilities?: typeof readCapabilities;
    /** Test seam only; production defaults to the real clock. */
    routingNow?: () => Date;
}

function journalObservation(cwd: string): { journalState: ReturnType<typeof readJournal>['state']; journalCorrupt: boolean } {
    try {
        const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
        if (!branch) return { journalState: null, journalCorrupt: true };
        const journal = readJournal(cwd, branch);
        return { journalState: journal.state, journalCorrupt: journal.corrupt };
    } catch { return { journalState: null, journalCorrupt: true }; }
}

function assertText(value: unknown, name: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH || value.startsWith('--') || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
        throw new Error(`${name} must be a non-empty path without control characters`);
    }
}

function terminalSafe(value: string): string {
    return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, character => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`);
}

function assertDependencies(deps: PlanCommandDependencies): void {
    if (!deps || typeof deps.validatePlanFile !== 'function') throw new Error('validatePlanFile must be a function');
    if (deps.admitPlan !== undefined && typeof deps.admitPlan !== 'function') throw new Error('admitPlan must be a function');
}

function admissionOutput(report: AdmissionReport, json: boolean): string {
    report = sanitizeAdmissionReport(report);
    if (json) return `${JSON.stringify(report)}\n`;
    const diagnostic = report.diagnostics[0];
    return `Plan admission: ${report.state}${report.provider ? ` (${terminalSafe(report.provider)})` : ''}${diagnostic ? `\n- ${terminalSafe(diagnostic.code)}: ${terminalSafe(diagnostic.message)}` : ''}\n`;
}

function boundedDiagnostics(diagnostics: PlanDiagnostic[]): PlanDiagnostic[] {
    if (!Array.isArray(diagnostics)) throw new Error('plan validator returned invalid diagnostics');
    return diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => {
        if (!diagnostic || typeof diagnostic.code !== 'string' || typeof diagnostic.message !== 'string') {
            throw new Error('plan validator returned an invalid diagnostic');
        }
        return {
            code: diagnostic.code.slice(0, MAX_DIAGNOSTIC_LENGTH),
            message: diagnostic.message.slice(0, MAX_DIAGNOSTIC_LENGTH),
            ...(typeof diagnostic.field === 'string' ? { field: diagnostic.field.slice(0, MAX_DIAGNOSTIC_LENGTH) } : {}),
        };
    });
}

function assertReport(report: PlanValidationReport): void {
    if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('plan validator returned an invalid report');
    switch (report.state) {
    case 'valid':
        assertVerifiedValidPlanReport(report);
        return;
    case 'migration-required':
        if (report.reason !== 'unmarked-plan') throw new Error('plan validator returned an invalid migration reason');
        return;
    case 'invalid':
        boundedDiagnostics(report.diagnostics);
        return;
    case 'unsupported':
        if (typeof report.schema !== 'string' || report.schema.length === 0 || report.schema.length > MAX_PATH_LENGTH) {
            throw new Error('plan validator returned an invalid unsupported schema');
        }
        boundedDiagnostics(report.diagnostics);
        return;
    default:
        throw new Error('plan validator returned an unknown report state');
    }
}

function reportPayload(report: PlanValidationReport, planPath: string): Record<string, unknown> {
    assertReport(report);
    switch (report.state) {
    case 'valid':
        return {
            state: report.state, path: planPath, schema: report.schema, planId: report.manifest.planId,
            planDigest: report.planDigest,
            requirements: report.manifest.requirements.length, sources: report.manifest.sources.length,
            commands: report.manifest.commands.length, slices: report.manifest.slices.length, completeOwnership: true,
        };
    case 'migration-required':
        return { state: report.state, path: planPath, reason: report.reason };
    case 'invalid':
        return { state: report.state, path: planPath, diagnostics: boundedDiagnostics(report.diagnostics) };
    case 'unsupported':
        return {
            state: report.state, path: planPath, schema: report.schema, supportedSchema: SUPPORTED_SCHEMA,
            diagnostics: boundedDiagnostics(report.diagnostics), remedy: 'update AWM to support this compact plan schema.',
        };
    default:
        throw new Error('plan validator returned an unknown report state');
    }
}

export function exitCodeFor(report: PlanValidationReport): 0 | 2 {
    assertReport(report);
    return report.state === 'valid' ? 0 : 2;
}

export function formatReport(report: PlanValidationReport, planPath: string): string {
    const payload = reportPayload(report, planPath);
    switch (report.state) {
    case 'valid':
        return `Plan validation: valid "${terminalSafe(planPath)}" (${terminalSafe(report.schema)}; ${payload.slices} slices; ${payload.requirements} requirements; complete ownership)\n`;
    case 'migration-required':
        return `Plan validation: migration-required "${terminalSafe(planPath)}" (${terminalSafe(report.reason)})\nMigrate this plan to compact-slices/v1 before execution.\n`;
    case 'invalid':
        return `Plan validation: invalid "${terminalSafe(planPath)}"\n${(payload.diagnostics as PlanDiagnostic[]).map(diagnostic => `- ${terminalSafe(diagnostic.code)}: ${terminalSafe(diagnostic.message)}${diagnostic.field ? ` (${terminalSafe(diagnostic.field)})` : ''}`).join('\n')}\n`;
    case 'unsupported':
        return `Plan validation: unsupported "${terminalSafe(planPath)}" (${terminalSafe(report.schema)}; supported: ${SUPPORTED_SCHEMA})\nUpdate AWM to support this compact plan schema.\n`;
    default:
        throw new Error('plan validator returned an unknown report state');
    }
}

export function registerPlanCommand(program: Command, deps: PlanCommandDependencies = { validatePlanFile, admitPlan }): void {
    if (!program || typeof program.command !== 'function') throw new Error('program must be a Commander command');
    assertDependencies(deps);

    const plan = program.command('plan').description('inspect plan contracts');
    plan.command('resolve <plan-path>').requiredOption('--provider <target>').requiredOption('--runtime-kind <kind>').requiredOption('--runtime-version <version>').requiredOption('--account-scope-digest <sha>').requiredOption('--role <role>').option('--opt-in-v1').option('--slice <id>').option('--lineage <id>').option('--cwd <path>').option('--json').action((planPath: string, options: { provider: string; runtimeKind: string; runtimeVersion: string; accountScopeDigest: string; role: string; optInV1?: boolean; slice?: string; lineage?: string; cwd?: string; json?: boolean }) => {
        assertText(planPath, 'plan path'); for (const [value, label] of [[options.provider, '--provider'], [options.runtimeKind, '--runtime-kind'], [options.runtimeVersion, '--runtime-version'], [options.accountScopeDigest, '--account-scope-digest'], [options.role, '--role']]) assertText(value, label); if (options.slice) assertText(options.slice, '--slice'); if (options.lineage) assertText(options.lineage, '--lineage');
        const cwd = options.cwd ?? process.cwd(); assertText(cwd, '--cwd'); const report = deps.validatePlanFile(planPath, cwd); assertReport(report);
        if (report.state !== 'valid') { process.stdout.write(options.json ? `${JSON.stringify({ state: 'blocked', diagnostics: report.state === 'invalid' ? report.diagnostics : [{ code: 'ROUTING_PLAN_INVALID', message: 'Plan must validate before resolution.' }] })}\n` : 'Plan routing: blocked\n'); process.exitCode = 2; return; }
        if (options.lineage) {
            if (report.schema !== 'compact-slices/v2') { process.stdout.write(options.json ? `${JSON.stringify({ state: 'blocked', diagnostics: [{ code: 'ROUTING_LINEAGE_V1', message: 'Lineage routing is only available for compact v2 plans.' }] })}\n` : 'Plan routing: blocked\n'); process.exitCode = 2; return; }
            const observed = journalObservation(cwd);
            const binding = observed.journalState?.planBinding;
            const attempts = observed.journalState?.routingAttempts?.filter((attempt) => attempt.lineageId === options.lineage) ?? [];
            const lineage = observed.journalState?.implementationLineages?.find((candidate) => candidate.id === options.lineage);
            const bound = !observed.journalCorrupt && binding?.digest === report.planDigest && binding.executionDigest === report.executionDigest;
            const lineageMatches = lineage !== undefined && lineage.sliceId === options.slice && lineage.planDigest === report.planDigest && lineage.executionDigest === report.executionDigest && attempts.every((attempt) => attempt.obligationId === lineage.obligationId && attempt.envelope.sliceId === options.slice);
            if (!bound || !lineageMatches || attempts.length > 3 || attempts.some((attempt) => attempt.envelope.planDigest !== report.planDigest || attempt.envelope.executionDigest !== report.executionDigest || ['unknown', 'reserved', 'active'].includes(attempt.state))) {
                process.stdout.write(options.json ? `${JSON.stringify({ state: 'blocked', diagnostics: [{ code: 'ROUTING_LINEAGE_UNBOUND', message: 'Lineage routing requires a current journal binding and non-unknown matching attempts.' }] })}\n` : 'Plan routing: blocked\n'); process.exitCode = 2; return;
            }
        }
        const roles: readonly string[] = ['implementer', 'specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'architecture', 'track-a-qa', 'track-b-qa', 'controller', 'documentation', 'retro', 'finishing']; if (!roles.includes(options.role)) throw new Error('--role is invalid');
        const runtime = validateRuntimeKey({ target: options.provider, kind: options.runtimeKind, version: options.runtimeVersion, accountScopeDigest: options.accountScopeDigest });
        const result = report.schema === 'compact-slices/v1' && !options.optInV1 ? resolveDispatch({ plan: report, role: options.role as RoutingRole, policy: undefined, capabilities: undefined, runtime, now: new Date(), optInV1: false }) : (() => { const policy = (deps.readEffectivePolicy ?? readEffectivePolicy)(cwd); const capabilities = (deps.readCapabilities ?? readCapabilities)(runtime, new Date()); if (!options.lineage) {
            const first = resolveDispatch({ plan: report, role: options.role as RoutingRole, sliceId: options.slice, policy: policy.state === 'approved' ? policy.policy : undefined, capabilities: capabilities.state === 'current' ? capabilities.receipt : undefined, runtime, now: new Date(), optInV1: options.optInV1 === true });
            // The consumer forwards THIS envelope to `job routing-reserve`, which
            // is what creates the lineage the --lineage escalation path below
            // then reads. Emitting it only there made the first attempt of any
            // lineage unreservable: envelope <= lineage <= reserve <= envelope.
            // Every field comes from values already in hand, so the CLI stays the
            // sole author and the consumer never assembles a protocol document.
            // No custodyHandoff here on purpose: the obligation and lineage ids
            // are the caller's to choose on a first attempt, and inventing them
            // would put identity the CLI cannot know into custody.
            if (first.state !== 'resolved' || report.schema !== 'compact-slices/v2' || report.executionDigest === undefined) return first;
            const slice = (report.manifest as unknown as { slices: Array<{ id: string; implementerProfile: ImplementerProfile }> }).slices.find((candidate) => candidate.id === options.slice);
            const requestedProfile = options.role === 'implementer' ? slice?.implementerProfile : 'full';
            if (requestedProfile === undefined) return first;
            return { ...first, envelope: { schema: 'routing-envelope/v1' as const, runtime, role: options.role, planDigest: report.planDigest, executionDigest: report.executionDigest, ...(options.slice === undefined ? {} : { sliceId: options.slice }), requestedProfile, effectiveProfile: first.effectiveProfile, resolved: first.selection, policyDigest: first.policyDigest, capabilityDigest: first.capabilityDigest, outcome: first.outcome, unavailableEvidence: first.unavailableEvidence } };
        } const state = journalObservation(cwd).journalState!; const lineage = state.implementationLineages!.find(candidate => candidate.id === options.lineage)!; const next = resolveLineageEscalation(state, options.lineage, lineage.initialProfile); const resolved = resolveEscalatedSelection({ role: 'implementer', requestedProfile: next.profile, expectedEffort: next.effort, policy: policy.state === 'approved' ? policy.policy : undefined, capabilities: capabilities.state === 'current' ? capabilities.receipt : undefined, runtime, now: new Date() }); if (resolved.state === 'blocked') return resolved; return { ...resolved, envelope: { schema: 'routing-envelope/v1' as const, runtime, role: 'implementer', planDigest: report.planDigest, executionDigest: report.executionDigest!, sliceId: lineage.sliceId, requestedProfile: lineage.initialProfile, effectiveProfile: next.profile, resolved: resolved.selection, policyDigest: resolved.policyDigest, capabilityDigest: resolved.capabilityDigest, outcome: resolved.outcome, unavailableEvidence: resolved.unavailableEvidence }, custodyHandoff: { kind: 'routing-reserve', obligationId: lineage.obligationId, lineageId: lineage.id } }; })();
        process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `Plan routing: ${result.state}\n`); if (result.state === 'blocked') process.exitCode = 2;
    });
    plan.command('migration-facts <plan-path>')
        .description('collect read-only durable migration facts')
        .option('--cwd <path>')
        .option('--historical-root <path>', 'admitted sibling #148 worktree')
        .requiredOption('--issue <https-url...>', 'durable issue links, including #126')
        .option('--json')
        .action((planPath: string, options: { cwd?: string; issue: string[]; historicalRoot?: string; json?: boolean }) => {
            assertText(planPath, 'plan path'); const cwd = options.cwd ?? process.cwd(); assertText(cwd, '--cwd');
            const report = options.historicalRoot ? collectIssue148HistoricalFacts(options.historicalRoot, options.issue) : (deps.collectMigrationFacts ?? collectMigrationFacts)(planPath, cwd, options.issue);
            process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : `Migration facts: ${report.state}\n`);
            process.exitCode = report.state === 'supported-completion' ? 0 : 2;
        });
    plan
        .command('validate <plan-path>')
        .description('validate a compact plan without modifying it')
        .option('--json', 'emit one stable JSON report')
        .option('--cwd <path>', 'repository root for plan containment and source resolution')
        .action((planPath: string, options: { json?: boolean; cwd?: string }) => {
            assertText(planPath, 'plan path');
            const cwd = options.cwd ?? process.cwd();
            assertText(cwd, '--cwd');
            const report = deps.validatePlanFile(planPath, cwd);
            const output = options.json === true
                ? `${JSON.stringify(reportPayload(report, planPath))}\n`
                : formatReport(report, planPath);
            process.stdout.write(output);
            const code = exitCodeFor(report);
            process.exitCode = code;
        });

    plan
        .command('admit <plan-path>')
        .description('read-only fail-closed compact-plan admission')
        .requiredOption('--provider <target>', 'target provider')
        .requiredOption('--cwd <path>', 'repository root for plan containment and source resolution')
        .option('--execution-mode <mode>', 'explicit override: interactivo or desatendido')
        .option('--require-current', 'require authoritative consumed-contract currentness')
        .option('--verify-sensors', 'require an empirical sensor pass')
        .option('--runtime-kind <kind>', 'routing runtime kind for compact v2')
        .option('--runtime-version <version>', 'routing runtime version for compact v2')
        .option('--account-scope-digest <sha>', 'routing account scope digest for compact v2')
        .option('--controller-autonomy <posture>', 'unattended controller autonomy posture (#168)')
        .option('--json', 'emit one stable JSON report')
        .action(async (planPath: string, options: { provider: string; cwd: string; executionMode?: string; requireCurrent?: boolean; verifySensors?: boolean; runtimeKind?: string; runtimeVersion?: string; accountScopeDigest?: string; controllerAutonomy?: string; json?: boolean }) => {
            assertText(planPath, 'plan path');
            assertText(options.cwd, '--cwd');
            assertText(options.provider, '--provider');
            const admission = deps.admitPlan ?? admitPlan;
            const preferences = deps.readPreferences ?? readPreferences;
            const currentnessCheck = deps.checkCurrentness ?? checkCurrentness;
            const sensorRun = deps.runSensors ?? runSensors;
            const registryInventory = deps.listRegistries ?? listRegistries;
            const planReport = deps.validatePlanFile(planPath, options.cwd);
            // The mode comes from the same authenticated bytes/digest that produced
            // planReport. Never reopen the path to parse a mutable header.
            const executionMode = options.executionMode === undefined
                ? planReport.state === 'valid' ? (planReport.executionMode ?? 'interactivo') : 'interactivo'
                : options.executionMode === 'desatendido' ? 'desatendido' : options.executionMode === 'interactivo' ? 'interactivo' : options.executionMode as any;
            const journal = executionMode === 'desatendido' ? journalObservation(options.cwd) : {};
            const normalizedPlanPath = path.relative(options.cwd, path.resolve(options.cwd, planPath)).replace(/\\/g, '/');
            const enabledAgents = preferences().enabledAgents;
            // The documented order is plan, provider, currentness, sensors, journal,
            // capabilities. Do not call the full composer early: that would resolve a
            // capability before empirical evidence gates have had their ordered turn.
            const earlyBoundary = planReport.state !== 'valid' || !isAgentTarget(options.provider) || !enabledAgents.includes(options.provider);
            if (earlyBoundary) {
                const report = await admission({ plan: planReport, provider: options.provider, cwd: options.cwd, enabledAgents, executionMode, planPath: normalizedPlanPath, ...journal });
                process.stdout.write(admissionOutput(report, options.json === true));
                process.exitCode = 2;
                return;
            }
            const readRouting = (): AdmissionInput['routing'] => { if (!options.runtimeKind || !options.runtimeVersion || !options.accountScopeDigest) return undefined; const runtime = validateRuntimeKey({ target: options.provider, kind: options.runtimeKind, version: options.runtimeVersion, accountScopeDigest: options.accountScopeDigest }); const policy = (deps.readEffectivePolicy ?? readEffectivePolicy)(options.cwd); const at = deps.routingNow?.() ?? new Date(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('routingNow must return a finite Date'); const capabilities = (deps.readCapabilities ?? readCapabilities)(runtime, at); return { runtime, policy: policy.state === 'approved' ? policy.policy : undefined, capabilities: capabilities.state === 'current' ? capabilities.receipt : undefined, now: at }; };
            if (options.controllerAutonomy !== undefined && !isControllerAutonomy(options.controllerAutonomy)) throw new Error(`--controller-autonomy is invalid: ${options.controllerAutonomy} (valid: ${CONTROLLER_AUTONOMIES.join(', ')})`);
            const report = await admitRegistryPlan({ plan: planReport, provider: options.provider, cwd: options.cwd, enabledAgents, executionMode, planPath: normalizedPlanPath, ...journal, requireCurrent: options.requireCurrent === true, verifySensors: options.verifySensors === true, ...(options.controllerAutonomy === undefined ? {} : { controllerAutonomy: options.controllerAutonomy }) },
                { admitPlan: admission, listRegistries: registryInventory, checkCurrentness: currentnessCheck, runSensors: sensorRun, readRouting });
            process.stdout.write(admissionOutput(report, options.json === true));
            if (report.state !== 'admitted') process.exitCode = 2;
        });
}
