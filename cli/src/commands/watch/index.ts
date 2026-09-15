import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { initWatch, rebindWatchPlan } from './init';
import { runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG } from './supervisor';
import { EXEC_STDIO } from '../../core/journal/process';
import { WATCH_PROVIDERS, isWatchProvider } from '../../core/journal/adapter';
import { resolveCommandContext } from '../../core/tracks/context';
import { parseMaxParallel, loadDefaultParallelism } from '../../core/tracks/concurrency';
import { validatePlanFile } from '../../core/plan/validate';
import path from 'path';

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
            const cfg = {
                ...DEFAULT_SUPERVISOR_CONFIG,
                provider: opts.provider,
                heartbeatTimeoutMs: minutes('--heartbeat-timeout', opts.heartbeatTimeout),
                activityWindowMs: minutes('--activity-window', opts.activityWindow),
                maxParallelTracks: opts.maxParallel !== undefined ? parseMaxParallel(opts.maxParallel) : loadDefaultParallelism(),
            };
            process.stdout.write(`awm watch: supervisor activo (${cfg.provider}) — Ctrl-C para terminar\n`);
            await runSupervisorLoop(repo, branch, cfg);
            process.stdout.write('gate verde: ciclo COMPLETE — drenado, lock liberado, apagando\n');
        });

    watch
        .command('rebind')
        .description('reconcilia intencionalmente el binding desatendido tras un cambio válido del ciclo del plan')
        .requiredOption('--plan <path>', 'mismo plan compacto previamente vinculado; valida y conserva la historia antes de actualizar su digest')
        .action((opts: { plan: unknown }) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            try {
                resolveCommandContext(repo, branch);
            } catch (e) {
                process.stderr.write(`${(e as Error).message}\n`);
                process.exitCode = 1;
                return;
            }
            if (!validPlanPath(opts.plan)) {
                process.stderr.write('--plan requiere un path sin caracteres de control\n');
                process.exitCode = 1;
                return;
            }
            try {
                const binding = rebindWatchPlan(repo, branch, planForBinding(repo, opts.plan));
                process.stdout.write(`binding reconciliado para ${binding.path}; digest ${binding.digest}\n`);
            } catch (e) {
                process.stderr.write(`${(e as Error).message}\n`);
                process.exitCode = 1;
            }
        });
}
