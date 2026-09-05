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
// emite solo los campos estructurados de cada declaración — y `composedOrchestrators`
// (core/context/provider.ts) ya es, por si sola, la sanitización COMPLETA de esos
// campos (markdown + bytes de control, vía `sanitizeDeclaredField` en core/text.ts).
// Este comando no vuelve a sanear nada: consumir la salida de `composedOrchestrators`
// tal cual es justamente lo que garantiza que lo que se ve acá sea lo que se compone
// en el payload real (R5.2) — sanear de nuevo aquí sería una segunda fuente de verdad.
import { Command } from 'commander';
import { collectDeclaredOrchestrators } from '../../core/orchestrators';
import { composedOrchestrators } from '../../core/context/provider';
import { sanitizeDeclaredField } from '../../core/text';
import { type CommandResult, diagnosticsToStderr, emit } from '../../core/command-result';

export type CollectedOrchestrators = ReturnType<typeof collectDeclaredOrchestrators>;
export interface OrchestratorsOptions { json: boolean; verify?: string }

export function runContextOrchestrators(collected: CollectedOrchestrators, opts: OrchestratorsOptions): CommandResult {
    const stderr = diagnosticsToStderr(collected.diagnostics);
    const composed = composedOrchestrators(collected.declared);

    if (opts.verify !== undefined) {
        // opts.verify es el argumento CRUDO tal como lo tipeo el usuario; composed[].name
        // ya paso por sanitizeDeclaredField. Sin normalizar este lado con la MISMA funcion,
        // un usuario que tipee el nombre declarado exacto (con un caracter que el saneo
        // quita, p.ej. `_` o un byte de control) se lleva un falso "not composed" (R3.5/R3.6).
        const verifyNormalized = sanitizeDeclaredField(opts.verify);
        // A dropped raw identity must not borrow a retained declaration's sanitized name.
        const found = !collected.droppedNames.includes(opts.verify)
            && composed.some((o) => o.name === verifyNormalized);
        if (!found) {
            const available = composed.map((o) => o.name).join(', ') || '(none)';
            return {
                code: 2, stdout: '',
                stderr: `${stderr}awm context orchestrators: "${verifyNormalized}" is not composed — available: ${available}\n`,
            };
        }
        return { code: 0, stdout: `"${verifyNormalized}" is composed into the session context.\n`, stderr };
    }

    if (opts.json) {
        return { code: 0, stdout: `${JSON.stringify({ orchestrators: composed }, null, 2)}\n`, stderr };
    }

    if (composed.length === 0) {
        return { code: 0, stdout: 'No declared orchestrators in the installed registries.\n', stderr };
    }
    const rows = composed
        .map((o) => `${o.name}  applies when: ${o.appliesWhen}  -> ${o.terminatesTo}`)
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
