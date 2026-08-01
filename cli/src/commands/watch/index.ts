import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { initWatch } from './init';
import { runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG } from './supervisor';

function currentBranch(cwd: string): string {
    const b = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
    if (b.length === 0) throw new Error('no hay rama actual (HEAD detached): el journal es por rama');
    return b;
}

function minutes(flag: string, raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} requiere un numero de minutos > 0`);
    return n * 60000;
}

export function registerWatchCommand(program: Command): void {
    program
        .command('watch')
        .description('supervisor durable: ejecuta jobs, releva controladores caidos, nunca mata trabajo vivo')
        .option('--init', 'bootstrap: crea el journal de la rama actual, detecta verificadores y sale')
        .option('--provider <p>', 'codex | claude-code', 'codex')
        .option('--heartbeat-timeout <min>', 'minutos de silencio de heartbeat', '5')
        .option('--activity-window <min>', 'minutos extra sin actividad de proceso', '10')
        .action(async (opts) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            if (opts.init) {
                const out = initWatch(repo, branch);
                process.stdout.write(`journal inicializado para ${branch}; verificadores requeridos: ${JSON.stringify(out.requiredVerifiers)}\n`);
                return;
            }
            const cfg = {
                ...DEFAULT_SUPERVISOR_CONFIG,
                provider: opts.provider,
                heartbeatTimeoutMs: minutes('--heartbeat-timeout', opts.heartbeatTimeout),
                activityWindowMs: minutes('--activity-window', opts.activityWindow),
            };
            process.stdout.write(`awm watch: supervisor activo (${cfg.provider}) — Ctrl-C para terminar\n`);
            await runSupervisorLoop(repo, branch, cfg);
            process.stdout.write('gate verde: ciclo COMPLETE — drenado, lock liberado, apagando\n');
        });
}
