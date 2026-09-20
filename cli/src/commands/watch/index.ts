import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { initWatch, rebindWatchPlan } from './init';
import { runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG, type RoutingIdentity } from './supervisor';
import { validateRuntimeKey } from '../../core/model-policy/capabilities';
import { CONTROLLER_AUTONOMIES, isControllerAutonomy } from '../../core/journal/adapter';
import { EXEC_STDIO } from '../../core/journal/process';
import { WATCH_PROVIDERS, isWatchProvider } from '../../core/journal/adapter';
import { resolveCommandContext } from '../../core/tracks/context';
import { parseMaxParallel, loadDefaultParallelism } from '../../core/tracks/concurrency';
import { validatePlanFile } from '../../core/plan/validate';
import path from 'path';
import { archiveUnusedWatch, watchJournalStatus } from './archive-unused';
import { readJournal } from '../../core/journal/store';
import { computeFingerprint } from '../../core/journal/fingerprint';

function currentBranch(cwd: string): string {
    // stdio explicito (ver EXEC_STDIO en journal/process.ts): evita el relay
    // default de execFileSync del stderr de git hacia el stderr del llamante,
    // que EPIPE-crashea si ese fd es un pipe roto.
    const b = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: EXEC_STDIO }).trim();
    if (b.length === 0) throw new Error('no hay rama actual (HEAD detached): el journal es por rama');
    return b;
}

function minutes(flag: string, raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} requiere un numero de minutos > 0`);
    return n * 60000;
}

function validPlanPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001F\u007F-\u009F]/.test(value);
}

function planForBinding(repo: string, rawPath: string) {
    const report = validatePlanFile(rawPath, repo);
    return { path: path.relative(repo, path.resolve(repo, rawPath)).replace(/\\/g, '/'), report };
}

export function registerWatchCommand(program: Command): void {
    const watch = program
        .command('watch')
        .description('supervisor durable: ejecuta jobs, releva controladores caidos, nunca mata trabajo vivo')
        .option('--init', 'bootstrap: crea el journal de la rama actual, detecta verificadores y sale')
        .option('--plan <path>', 'plan compacto desatendido que se vincula al inicializar')
        .option('--provider <p>', WATCH_PROVIDERS.join(' | '), 'codex')
        .option('--heartbeat-timeout <min>', 'minutos de silencio de heartbeat', '5')
        .option('--activity-window <min>', 'minutos extra sin actividad de proceso', '10')
        .option('--max-parallel <n>', 'tope de tracks ACTIVE simultáneos (default: derivado del benchmark empaquetado)')
        // #166: la admisión compact v2 exige la identidad de runtime. Se declara
        // acá, igual que en `plan admit`/`plan resolve`: el operador la asserta y
        // el receipt debe coincidir, nunca al revés.
        .option('--runtime-kind <kind>', 'identidad de runtime para despacho compact v2')
        .option('--runtime-version <version>', 'identidad de runtime para despacho compact v2')
        .option('--account-scope-digest <sha>', 'identidad de runtime para despacho compact v2')
        // #168: sin esto el controller desatendido arranca y se cuelga en la
        // primera herramienta pidiendo aprobación. Se declara, no se adivina.
        .option('--controller-autonomy <postura>', `postura del controller desatendido (${CONTROLLER_AUTONOMIES.join(' | ')})`)
        .action(async (opts) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            // R9.4: sin descriptor de track, no-op (modo plan de siempre); con
            // descriptor presente que no autentica, rechaza ANTES de tocar el
            // journal — mismo patron de salida que el resto de `awm job`.
            try {
                resolveCommandContext(repo, branch);
            } catch (e) {
                process.stderr.write(`${(e as Error).message}\n`);
                process.exit(1);
            }
            if (opts.plan !== undefined && !opts.init) {
                process.stderr.write('--plan requiere --init\n');
                process.exitCode = 1;
                return;
            }
            if (opts.init && opts.plan === undefined) {
                process.stderr.write('watch --init requiere --plan con un plan compacto válido\n');
                process.exitCode = 1;
                return;
            }
            if (opts.plan !== undefined && !validPlanPath(opts.plan)) {
                process.stderr.write('--plan requiere un path sin caracteres de control\n');
                process.exitCode = 1;
                return;
            }
            if (opts.init) {
                const plan = opts.plan === undefined ? undefined : planForBinding(repo, opts.plan);
                const out = initWatch(repo, branch, plan);
                process.stdout.write(`journal inicializado para ${branch}; verificadores requeridos: ${JSON.stringify(out.requiredVerifiers)}\n`);
                return;
            }
            // Validado ACA, antes de tocar nada: `adapterFor` ya rechazaba lo
            // desconocido, pero recien en el primer tick — con el journal escrito y el
            // lock tomado, y el error saliendo del supervisor en vez de del flag que lo
            // causo. Un typo en `--provider` tiene que costar un mensaje, no un ciclo.
            if (!isWatchProvider(opts.provider)) {
                process.stderr.write(
                    `--provider invalido: ${String(opts.provider)} (validos: ${WATCH_PROVIDERS.join(', ')})\n`,
                );
                process.exitCode = 1;
                return;
            }
            // Los tres viajan juntos o ninguno: una identidad parcial produciría
            // exactamente el bloqueo silencioso que este flag existe para evitar.
            const identityFlags: Array<[string, unknown]> = [['--runtime-kind', opts.runtimeKind], ['--runtime-version', opts.runtimeVersion], ['--account-scope-digest', opts.accountScopeDigest]];
            const suppliedIdentity = identityFlags.filter(([, value]) => value !== undefined);
            if (suppliedIdentity.length !== 0 && suppliedIdentity.length !== identityFlags.length) {
                const missing = identityFlags.filter(([, value]) => value === undefined).map(([flag]) => flag);
                process.stderr.write(`la identidad de runtime requiere los tres flags juntos; faltan: ${missing.join(', ')}\n`);
                process.exitCode = 1;
                return;
            }
            let routingIdentity: RoutingIdentity | undefined;
            if (suppliedIdentity.length === identityFlags.length) {
                try {
                    // Valida acá, antes de tomar el lock: un digest mal formado
                    // tiene que costar un mensaje, no un ciclo de custodia.
                    validateRuntimeKey({ target: opts.provider, kind: opts.runtimeKind, version: opts.runtimeVersion, accountScopeDigest: opts.accountScopeDigest });
                } catch (e) {
                    process.stderr.write(`${(e as Error).message}\n`);
                    process.exitCode = 1;
                    return;
                }
                routingIdentity = { kind: String(opts.runtimeKind), version: String(opts.runtimeVersion), accountScopeDigest: String(opts.accountScopeDigest) };
            }
            if (opts.controllerAutonomy !== undefined && !isControllerAutonomy(opts.controllerAutonomy)) {
                process.stderr.write(`--controller-autonomy invalido: ${String(opts.controllerAutonomy)} (validos: ${CONTROLLER_AUTONOMIES.join(', ')})\n`);
                process.exitCode = 1;
                return;
            }
            const cfg = {
                ...DEFAULT_SUPERVISOR_CONFIG,
                provider: opts.provider,
                heartbeatTimeoutMs: minutes('--heartbeat-timeout', opts.heartbeatTimeout),
                activityWindowMs: minutes('--activity-window', opts.activityWindow),
                maxParallelTracks: opts.maxParallel !== undefined ? parseMaxParallel(opts.maxParallel) : loadDefaultParallelism(),
                ...(routingIdentity === undefined ? {} : { routingIdentity }),
                ...(opts.controllerAutonomy === undefined ? {} : { controllerAutonomy: opts.controllerAutonomy }),
            };
            process.stdout.write(`awm watch: supervisor activo (${cfg.provider}) — Ctrl-C para terminar\n`);
            await runSupervisorLoop(repo, branch, cfg);
            process.stdout.write('gate verde: ciclo COMPLETE — drenado, lock liberado, apagando\n');
        });

    watch
        .command('rebind')
        .description('reconcilia intencionalmente el binding desatendido tras un cambio válido del ciclo del plan')
        // `watch` conserva su --plan histórico para `watch --init --plan`.
        // Commander lo asocia al padre incluso después del subcomando, por lo
        // que este option es documental y la acción toma el valor del padre
        // cuando corresponde; marcarlo required acá rechazaría una invocación
        // válida antes de llegar a esa reconciliación explícita.
        .option('--plan <path>', 'mismo plan compacto previamente vinculado; valida y conserva la historia antes de actualizar su digest')
        .action((opts: { plan?: unknown }, command: Command) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            try {
                resolveCommandContext(repo, branch);
            } catch (e) {
                process.stderr.write(`${(e as Error).message}\n`);
                process.exitCode = 1;
                return;
            }
            const plan = opts.plan ?? command.parent?.opts().plan;
            if (!validPlanPath(plan)) {
                process.stderr.write('--plan requiere un path sin caracteres de control\n');
                process.exitCode = 1;
                return;
            }
            try {
                const binding = rebindWatchPlan(repo, branch, planForBinding(repo, plan));
                process.stdout.write(`binding reconciliado para ${binding.path}; digest ${binding.digest}\n`);
                const state = readJournal(repo, branch).state!;
                const staleJobs = Object.values(state.jobs).filter(job => job.verdict === 'pass' && (() => {
                    try { return computeFingerprint(repo, job.argv, job.paths, job.cwd).fingerprint !== job.fingerprint; }
                    catch { return true; }
                })()).map(job => job.id);
                if (staleJobs.length > 0) {
                    process.stdout.write(`stale-fingerprint: ${staleJobs.join(', ')}; el rebind no conserva PASS con fingerprint cambiado. Re-ejecutar las verificaciones afectadas mediante awm job request con generation, paths y satisfies originales; no repetir watch/rebind ni re-fingerprinting de evidencia anterior.\n`);
                }
            } catch (e) {
                process.stderr.write(`${(e as Error).message}\n`);
                process.exitCode = 1;
            }
        });

    watch.command('archive-unused')
        .description('archiva recuperablemente solo un bootstrap no utilizado; nunca declara COMPLETE ni crea evidencia de ejecución')
        .option('--plan <path>', 'mismo plan vinculado al bootstrap; no adopta evidencia de trabajo manual')
        .action((opts: { plan?: unknown }, command: Command) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            try {
                resolveCommandContext(repo, branch);
                const plan = opts.plan ?? command.parent?.opts().plan;
                if (!validPlanPath(plan)) throw new Error('--plan requiere un path sin caracteres de control');
                const relative = path.relative(repo, path.resolve(repo, plan)).replace(/\\/g, '/');
                process.stdout.write(`${JSON.stringify(archiveUnusedWatch(repo, branch, relative))}\n`);
            } catch (error) {
                process.stderr.write(`${(error as Error).message}\n`);
                process.exitCode = 1;
            }
        });

    watch.command('journal-status')
        .description('consulta read-only el journal de la rama actual: missing | corrupt | present; no exporta contenido')
        .option('--json', 'estado estructural y metadata de binding, sin cuerpos ni evidencia inferida')
        .action(() => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            process.stdout.write(`${JSON.stringify(watchJournalStatus(repo, branch))}\n`);
        });
}
