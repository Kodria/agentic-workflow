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

/** Unico punto que escribe a stderr y sale != 0 por un fallo de guard —
 *  ambos guards de abajo comparten esta forma (R9.4). */
function failGuard(message: string): never {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

/** Autentica el cwd (R9.4) y devuelve el contexto resuelto: sin descriptor
 *  de track es un no-op que resuelve a modo plan (caso comun); con
 *  descriptor presente que no autentica, rechaza ANTES de que el verbo
 *  emita o consulte nada. */
function resolveGuardedContext(repo: string, branch: string): CommandContext {
    try {
        return resolveCommandContext(repo, branch);
    } catch (e) {
        failGuard((e as Error).message);
    }
}

/** Guard de entrada identico al de `awm job`/`awm watch`: solo autentica. */
function assertAuthenticatedCwd(repo: string, branch: string): void {
    resolveGuardedContext(repo, branch);
}

/** Guard mas estricto para `list`/`status`: ambos verbos agregan el journal
 *  del PLAN (R9.5/R9.6 — `tracks` solo existe ahi, nunca en el journal de un
 *  track individual). Sin esto, correrlos desde el worktree de un track
 *  produce silenciosamente "sin tracks declarados" — indistinguible de un
 *  plan serial/vacio genuino. */
function assertPlanCwd(repo: string, branch: string): void {
    const ctx = resolveGuardedContext(repo, branch);
    if (ctx.mode === 'track') {
        failGuard(
            `este cwd es el worktree del track '${ctx.context.trackContext.trackId}', no la raiz del plan: `
            + `'awm track list'/'status' agregan el journal del PLAN — corre el comando desde ahi`,
        );
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
            // R5.10: sale != 0 ante CUALQUIER violacion, incluyendo que la
            // tuberia leer-plan -> parsear -> evaluar independencia lance
            // sincronicamente (id de track peligroso, `Integration argv`
            // no-JSON, `Shared resources` sin forma `<clase>:<valor>`, etc.)
            // — nunca un stack trace crudo. El try envuelve la tuberia
            // ENTERA a proposito (no solo el parseo) y el `process.exit` de
            // abajo vive AFUERA de el: los tests mockean `process.exit` para
            // que *lance*, y si ese exit ocurriera dentro del try se
            // re-atraparia como un fallo de dominio mas.
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
