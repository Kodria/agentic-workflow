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
            // violacion" — un plan que ni siquiera parsea (id de track
            // peligroso, `Files:` sin `Track:`, `Integration argv` no-JSON,
            // archivo inexistente, etc.) es, con mas razon, una violacion:
            // jamas debe escapar como una excepcion cruda con stack trace.
            // Se reporta con el mismo shape {parallel, reasons} que el resto
            // del verbo (consistencia de salida) en vez de partir a stderr;
            // se usa el MISMO exit code (1) que "declarado pero no
            // independiente" a proposito — ambos casos significan lo mismo
            // para quien invoca por argv: "no se puede certificar
            // paralelismo ahora", y un solo exit code evita que un script
            // necesite ramificar entre "malformado" y "colisiona" para
            // decidir si aborta. El reason se prefija `parse-error:` para
            // quien SI quiera distinguir el caso inspeccionando el JSON.
            let parsed: ReturnType<typeof parseTrackPlan>;
            try {
                const source = fs.readFileSync(opts.plan, 'utf8');
                parsed = parseTrackPlan(source, gitCheckTrackId);
            } catch (e) {
                process.stdout.write(JSON.stringify({ parallel: false, reasons: [`parse-error:${(e as Error).message}`] }, null, 2) + '\n');
                process.exit(1);
            }
            if (parsed.mode === 'serial') {
                // Un plan que ni siquiera califica como candidato paralelo
                // (recursos compartidos sin declarar, dependencias entre
                // tracks, etc.) es, por definicion, una violacion de R5.10.
                process.stdout.write(JSON.stringify({ parallel: false, reasons: [parsed.reason] }, null, 2) + '\n');
                process.exit(1);
            }
            const out = assessDeclaredIndependence(Object.values(parsed.tracks));
            process.stdout.write(JSON.stringify(out, null, 2) + '\n');
            if (!out.parallel) process.exit(1);
        });
}
