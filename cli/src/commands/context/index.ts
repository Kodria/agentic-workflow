// `awm context` — superficie READ-ONLY sobre el payload de contexto que AWM
// entrega a cada sesión de agente.
//
// Existe por R3.5: el ciclo de verificación de `process-lifecycle` debe poder
// confirmar que un orquestador declarado por un registry aparece EFECTIVAMENTE
// compuesto, y hasta acá `buildContext` solo era alcanzable escribiendo el skill
// materializado desde el hook de SessionStart.
//
// Deliberadamente NO imprime `ctx.markdown`: ese string incluye el SKILL.md crudo
// del registry (provider.ts:58-62), contenido externo sin filtro. Este comando
// emite solo los campos estructurados de cada declaración, que ya pasaron por
// `sanitizeForMarkdown` y acá además por `stripControlChars`.
import { Command } from 'commander';
import { collectDeclaredOrchestrators, type DeclaredOrchestrator } from '../../core/orchestrators';
import { composedOrchestrators } from '../../core/context/provider';
import { stripControlChars } from '../../core/text';

export interface CommandResult { code: 0 | 2; stdout: string; stderr: string }
export interface CollectedOrchestrators { declared: DeclaredOrchestrator[]; diagnostics: string[] }
export interface OrchestratorsOptions { json: boolean; verify?: string }

function diagnosticsToStderr(diagnostics: string[]): string {
    return diagnostics.map((d) => `warning: ${d}\n`).join('');
}

export function runContextOrchestrators(collected: CollectedOrchestrators, opts: OrchestratorsOptions): CommandResult {
    const stderr = diagnosticsToStderr(collected.diagnostics);
    const composed = composedOrchestrators(collected.declared);

    if (opts.verify !== undefined) {
        const found = composed.some((o) => o.name === opts.verify);
        if (!found) {
            const available = composed.map((o) => o.name).join(', ') || '(none)';
            return {
                code: 2, stdout: '',
                stderr: `${stderr}awm context orchestrators: "${stripControlChars(opts.verify)}" is not composed — available: ${stripControlChars(available)}\n`,
            };
        }
        return { code: 0, stdout: `"${stripControlChars(opts.verify)}" is composed into the session context.\n`, stderr };
    }

    if (opts.json) {
        // JSON.stringify ya escapa los caracteres de control como parte de
        // producir JSON válido, así que esta rama no necesita stripControlChars.
        return { code: 0, stdout: `${JSON.stringify({ orchestrators: composed }, null, 2)}\n`, stderr };
    }

    if (composed.length === 0) {
        return { code: 0, stdout: 'No declared orchestrators in the installed registries.\n', stderr };
    }
    const rows = composed
        .map((o) => `${stripControlChars(o.name)}  applies when: ${stripControlChars(o.appliesWhen)}  -> ${stripControlChars(o.terminatesTo)}`)
        .join('\n');
    return { code: 0, stdout: `${rows}\n`, stderr };
}

export function registerContextCommand(program: Command): void {
    const context = program.command('context').description('read-only view of the context AWM delivers to every agent session');

    context
        .command('orchestrators')
        .description('list the declared orchestrators as they are composed into the session context')
        .option('--json', 'emit the composed list as JSON')
        .option('--verify <name>', 'exit 0 only if that orchestrator is composed; 2 otherwise')
        .action((opts: { json?: boolean; verify?: string }) => emit(runContextOrchestrators(
            collectDeclaredOrchestrators(),
            { json: opts.json === true, verify: opts.verify },
        )));
}

function emit(result: CommandResult): void {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.code !== 0) process.exitCode = result.code;
}
