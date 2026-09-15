import { Command } from 'commander';
import { assertVerifiedValidPlanReport, validatePlanFile } from '../../core/plan/validate';
import type { PlanDiagnostic, PlanValidationReport } from '../../core/plan/types';

const SUPPORTED_SCHEMA = 'compact-slices/v1';
const MAX_PATH_LENGTH = 4096;
const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_LENGTH = 4096;

export interface PlanCommandDependencies {
    validatePlanFile: (planPath: string, cwd: string) => PlanValidationReport;
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

export function registerPlanCommand(program: Command, deps: PlanCommandDependencies = { validatePlanFile }): void {
    if (!program || typeof program.command !== 'function') throw new Error('program must be a Commander command');
    assertDependencies(deps);

    const plan = program.command('plan').description('inspect plan contracts');
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
}
