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
import path from 'path';
import { execFileSync } from 'child_process';
import { readJournal } from '../../core/journal/store';
import { collectIssue148HistoricalFacts, collectMigrationFacts, type MigrationFactsReport } from '../../core/migration';

const SUPPORTED_SCHEMA = 'compact-slices/v1';
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
        .option('--json', 'emit one stable JSON report')
        .action(async (planPath: string, options: { provider: string; cwd: string; executionMode?: string; requireCurrent?: boolean; verifySensors?: boolean; json?: boolean }) => {
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
            const report = await admitRegistryPlan({ plan: planReport, provider: options.provider, cwd: options.cwd, enabledAgents, executionMode, planPath: normalizedPlanPath, ...journal, requireCurrent: options.requireCurrent === true, verifySensors: options.verifySensors === true },
                { admitPlan: admission, listRegistries: registryInventory, checkCurrentness: currentnessCheck, runSensors: sensorRun });
            process.stdout.write(admissionOutput(report, options.json === true));
            if (report.state !== 'admitted') process.exitCode = 2;
        });
}
