import { Command } from 'commander';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { emitTrackRequest } from './emit';
import { aggregateTrackStatus } from './status';
import { readJournal } from '../../core/journal/store';
import { EXEC_STDIO } from '../../core/journal/process';
import { resolveCommandContext, type CommandContext } from '../../core/tracks/context';
import { parseTrackPlan } from '../../core/tracks/plan-parser';
import { assessDeclaredIndependence } from '../../core/tracks/ownership';
import { gitCheckTrackId } from '../../core/tracks/git';

// Mismo patron que cli/src/commands/job/index.ts (branchOf/assertAuthenticatedCwd):
// duplicado deliberadamente en vez de exportado desde job/index.ts, que no
// expone esos helpers y no forma parte del alcance de esta task.
function branchOf(cwd: string): string {
    const b = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: EXEC_STDIO }).trim();
    if (b.length === 0) throw new Error('no hay rama actual (HEAD detached): el journal es por rama');
    return b;
}

/** Guard de entrada (R9.4), identico al de `awm job`/`awm watch`: sin
 *  descriptor de track es un no-op (caso comun); con descriptor presente
 *  que no autentica, rechaza ANTES de que el verbo emita o consulte nada. */
function assertAuthenticatedCwd(repo: string, branch: string): void {
    try {
        resolveCommandContext(repo, branch);
    } catch (e) {
        process.stderr.write(`${(e as Error).message}\n`);
        process.exit(1);
    }
}

/** Guard mas estricto para `list`/`status`: ambos verbos agregan el journal
 *  del PLAN (R9.5/R9.6 — `tracks` solo existe ahi, nunca en el journal de un
 *  track individual). Sin esto, correrlos desde el worktree de un track
 *  produce silenciosamente "sin tracks declarados" — indistinguible de un
 *  plan serial/vacio genuino. `assertAuthenticatedCwd` ya prueba que el cwd
 *  autentica; esto ademas exige que autentique como PLAN, no como track. */
function assertPlanCwd(repo: string, branch: string): void {
    let ctx: CommandContext;
    try {
        ctx = resolveCommandContext(repo, branch);
    } catch (e) {
        process.stderr.write(`${(e as Error).message}\n`);
        process.exit(1);
    }
    if (ctx.mode === 'track') {
        process.stderr.write(
            `este cwd es el worktree del track '${ctx.context.trackContext.trackId}', no la raiz del plan: `
            + `'awm track list'/'status' agregan el journal del PLAN — corre el comando desde ahi\n`,
        );
        process.exit(1);
    }
}

export function registerTrackCommand(program: Command): void {
    const track = program.command('track').description('tracks paralelos sobre worktrees (R5): superficie request-only + status agregado read-only');

    // --- Verbos mutantes: SOLO emiten una request (R6.1). Jamas tocan Git ni
    // el journal directamente — el supervisor del plan la consume despues.

    track.command('add')
        .description('emite track-prepare-request — el supervisor del plan la consume (R6.1)')
        .requiredOption('--generation <token>', 'token de la generacion vigente')
        .argument('<trackId>')
        .action((trackId: string, opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = emitTrackRequest(repo, branch, opts.generation, 'track-prepare-request', trackId);
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    track.command('join')
        .description('emite track-join-request — integracion es propiedad exclusiva del supervisor del plan (R6.1)')
        .requiredOption('--generation <token>', 'token de la generacion vigente')
        .argument('<trackId>')
        .action((trackId: string, opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = emitTrackRequest(repo, branch, opts.generation, 'track-join-request', trackId);
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    track.command('remove')
        .description('emite track-teardown-request — el supervisor del plan desmantela worktree/rama (R6.1)')
        .requiredOption('--generation <token>', 'token de la generacion vigente')
        .argument('<trackId>')
        .action((trackId: string, opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = emitTrackRequest(repo, branch, opts.generation, 'track-teardown-request', trackId);
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    // --- Verbos read-only: nunca aceptan --generation ni emiten requests.

    track.command('list')
        .description('lista los TrackRef declarados en el journal del plan (read-only)')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertPlanCwd(repo, branch);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) {
                process.stdout.write(JSON.stringify({ corruptState: true }, null, 2) + '\n');
                process.exit(1);
            }
            process.stdout.write(JSON.stringify({ tracks: r.state.tracks ?? [] }, null, 2) + '\n');
        });

    track.command('status')
        .description('agregado read-only: compone el gate de cada journal de track + fase de la cohorte (R9.5, R9.6)')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertPlanCwd(repo, branch);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) {
                process.stdout.write(JSON.stringify({ corruptState: true }, null, 2) + '\n');
                process.exit(1);
            }
            const out = aggregateTrackStatus(repo, r.state);
            process.stdout.write(JSON.stringify(out, null, 2) + '\n');
            // Fail-closed (R3.2 aplicado por composicion, R9.6): CUALQUIER
            // track con gate rojo — corrupto, bloqueado o con evidencia
            // pendiente — hace que `status` salga != 0, aunque el agregado
            // completo ya se haya impreso arriba.
            if (Object.values(out.tracks).some((t) => !t.gate.pass)) process.exit(1);
        });

    track.command('verify-independence')
        .description('R5.10: verifica independencia declarada de un plan de tracks; invocable por argv, sale != 0 ante cualquier violacion')
        .requiredOption('--plan <file>', 'ruta al plan markdown con membresia de Track y tabla ## Tracks')
        .action((opts) => {
            // R5.10 exige "invocable por argv y sale != 0 ante CUALQUIER
            // violacion" — TODA la tuberia leer-plan -> parsear -> evaluar
            // independencia puede lanzar sincronicamente con un input
            // malformo, no solo el parser: `assessDeclaredIndependence`
            // (via `canonicalResource`, ownership.ts) lanza si una celda de
            // `Shared resources` no tiene forma `<clase>:<valor>` — un
            // formato que el parser NUNCA valida (bloqueador encontrado en
            // re-review: la primera version de este fix envolvia solo
            // read+parse y dejaba escapar exactamente el mismo tipo de
            // stack trace crudo un paso mas adelante en el pipeline). Por
            // eso el try/catch envuelve la tuberia ENTERA — nada que pueda
            // tirar queda fuera — y el `process.exit` de cada rama vive
            // AFUERA del try: en los tests `process.exit` esta mockeado
            // para *lanzar* (para poder capturar el exit code sin matar el
            // proceso de jest), y si esos exits vivieran dentro del try,
            // ese throw de control de flujo se re-atraparia como si fuera
            // un fallo de dominio, produciendo un JSON duplicado.
            //
            // Se reporta con el mismo shape {parallel, reasons} que el resto
            // del verbo (consistencia de salida) en vez de partir a stderr;
            // se usa el MISMO exit code (1) para cualquier violacion —
            // parseo fallido, plan serial, ownership solapado o resource
            // compartido malformado — a proposito: todas significan lo
            // mismo para quien invoca por argv, "no se puede certificar
            // paralelismo ahora", y un solo exit code evita que un script
            // necesite ramificar entre variantes para decidir si aborta. El
            // reason de una excepcion (parseo O evaluacion) se prefija
            // `parse-error:` deliberadamente con el MISMO prefijo para
            // ambas etapas: desde la perspectiva del caller, "el archivo de
            // plan no produce un veredicto valido" es un unico modo de
            // fallo, sea cual sea la etapa interna que lo detecto: separar
            // en `parse-error`/`assessment-error` no le agrega ninguna
            // decision distinta a quien lee el JSON, solo mas prefijos que
            // aprender. El mensaje original de la excepcion (siempre
            // incluido despues del prefijo) ya deja clarisimo cual etapa
            // fallo para quien depura a mano.
            let result: { parallel: boolean; reasons: string[] };
            try {
                const source = fs.readFileSync(opts.plan, 'utf8');
                const parsed = parseTrackPlan(source, gitCheckTrackId);
                result = parsed.mode === 'serial'
                    // Un plan que ni siquiera califica como candidato paralelo
                    // (recursos compartidos sin declarar, dependencias entre
                    // tracks, etc.) es, por definicion, una violacion de R5.10.
                    ? { parallel: false, reasons: [parsed.reason] }
                    : assessDeclaredIndependence(Object.values(parsed.tracks));
            } catch (e) {
                result = { parallel: false, reasons: [`parse-error:${(e as Error).message}`] };
            }
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            if (!result.parallel) process.exit(1);
        });
}
