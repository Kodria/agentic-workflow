import { Command } from 'commander';
import { execFileSync } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { requestJob } from './request';
import { emitHeartbeat } from './heartbeat';
import { queryPs, queryList, queryShow } from './query';
import { computeGate, FingerprintNow } from './gate';
import { reconcileJobs } from './reconcile';
import { planReap, executeReap } from './reap';
import { buildExport, BaselineMetrics } from './export';
import { runExecWrapper } from './exec-wrapper';
import { emitRequest } from '../../core/journal/requests';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { EXEC_STDIO } from '../../core/journal/process';
import { readJournal } from '../../core/journal/store';
import { exportDir, logsDir } from '../../core/journal/paths';
import { verifyBranchInvariant } from '../watch/lock';
import { writeFileAtomicDurable } from '../../core/atomic-file';
import fs from 'fs';

function branchOf(cwd: string): string {
    // stdio explicito (ver EXEC_STDIO en journal/process.ts): evita el relay
    // default de execFileSync del stderr de git hacia el stderr del llamante,
    // que EPIPE-crashea si ese fd es un pipe roto.
    const b = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: EXEC_STDIO }).trim();
    if (b.length === 0) throw new Error('no hay rama actual (HEAD detached): el journal es por rama');
    return b;
}

function realFingerprintNow(repo: string): FingerprintNow {
    return (argv, paths, cwd) => {
        try { return computeFingerprint(repo, argv, paths, cwd).fingerprint; }
        catch { return null; }
    };
}

// CONSTITUTION: commander valida los tokens de las options declaradas; los
// variadicos van tras `--`. Los flags numericos/JSON se validan fail-fast.

export function registerJobCommand(program: Command): void {
    const job = program.command('job').description('journal durable de trabajo del ciclo SDD (R1)');

    job.command('request')
        .description('registra la intencion de una verificacion — el supervisor la ejecuta')
        .requiredOption('--generation <token>', 'token de la generacion vigente')
        .option('--paths <globs...>', 'paths que el comando observa (default: arbol completo)')
        .option('--cwd <dir>', 'cwd relativo del comando dentro del repo', '.')
        .option('--satisfies <itemId>', 'id del item de VerificationPlan que este job satisface')
        .argument('<cmd...>', 'comando tras --')
        .action((cmd: string[], opts) => {
            const repo = process.cwd();
            const r = requestJob(repo, branchOf(repo), opts.generation, cmd, opts.paths ?? [], opts.cwd, { satisfies: opts.satisfies });
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    job.command('register')
        .description('registra una entidad del ciclo (task | cycle-plan | dispatch | task-status | next-action) ANTES de actuar')
        .requiredOption('--generation <token>')
        .requiredOption('--entity <kind>', 'task | cycle-plan | dispatch | task-status | next-action')
        .requiredOption('--json <payload>', 'payload JSON de la entidad')
        .action((opts) => {
            let payload: unknown;
            try { payload = JSON.parse(opts.json); } catch { throw new Error('--json requiere un objeto JSON valido'); }
            if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('--json requiere un objeto JSON');
            const repo = process.cwd();
            const r = emitRequest(repo, branchOf(repo), {
                kind: 'register-entity', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`${opts.entity}:${opts.json}`).digest('hex'),
                payload: { entity: opts.entity, ...(payload as Record<string, unknown>) },
            });
            process.stdout.write(JSON.stringify({ requestId: r.requestId }, null, 2) + '\n');
        });

    job.command('verdict')
        .description('registra el veredicto de una ReviewObligation AL RECIBIRSE')
        .requiredOption('--generation <token>')
        .requiredOption('--obligation <id>')
        .requiredOption('--result <r>', 'pass | fail | inconclusive')
        .option('--detail <texto>', 'detalle del veredicto', '')
        .action((opts) => {
            if (!['pass', 'fail', 'inconclusive'].includes(opts.result)) throw new Error('--result debe ser pass | fail | inconclusive');
            const repo = process.cwd();
            // Determinista a partir de los MISMOS inputs que idempotencyKey (mas
            // generation, para que veredictos de generaciones distintas sobre la
            // misma obligacion+result+detail no colisionen): un retry genuino del
            // mismo comando produce un payload byte-identico, no un
            // rejected-digest-mismatch espurio (Fix 3).
            const verdictId = `verd-${crypto.createHash('sha256').update(`${opts.generation}:${opts.obligation}:${opts.result}:${opts.detail}`).digest('hex').slice(0, 16)}`;
            emitRequest(repo, branchOf(repo), {
                kind: 'verdict', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`verdict:${opts.obligation}:${opts.result}:${opts.detail}`).digest('hex'),
                payload: { verdictId, obligationId: opts.obligation, result: opts.result, detail: opts.detail },
            });
            process.stdout.write(JSON.stringify({ verdictId }, null, 2) + '\n');
        });

    job.command('controller-heartbeat')
        .requiredOption('--generation <token>')
        .action((opts) => { emitHeartbeat(process.cwd(), branchOf(process.cwd()), opts.generation); });

    job.command('ps').action(() => {
        process.stdout.write(JSON.stringify(queryPs(process.cwd(), branchOf(process.cwd())), null, 2) + '\n');
    });

    job.command('list').action(() => {
        process.stdout.write(JSON.stringify(queryList(process.cwd(), branchOf(process.cwd())), null, 2) + '\n');
    });

    job.command('show')
        .argument('<jobId>')
        .action((jobId: string) => {
            const out = queryShow(process.cwd(), branchOf(process.cwd()), jobId);
            process.stdout.write(JSON.stringify(out, null, 2) + '\n');
            if (out.corruptState || out.job === null) process.exit(1);
        });

    job.command('reconcile')
        .description('informe read-only de la matriz unica R1.8 + next_action (la mutacion es del supervisor)')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) {
                process.stdout.write(JSON.stringify({ corruptState: true }, null, 2) + '\n');
                process.exit(1);
            }
            try { verifyBranchInvariant(repo, r.state.branch); }
            catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }
            // copia en memoria: reconcileJobs muta SU copia, jamas el disco (R3.1)
            const clone = JSON.parse(JSON.stringify(r.state));
            const out = reconcileJobs(clone, logsDir(repo, branch));
            process.stdout.write(JSON.stringify({ decisions: out.decisions, nextAction: r.state.cycle.nextAction ?? null, cycleStatus: r.state.cycle.status }, null, 2) + '\n');
        });

    job.command('gate')
        .description('interlock fail-closed: exit != 0 si CUALQUIER cosa impide certificar')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.state !== null) {
                try { verifyBranchInvariant(repo, r.state.branch); }
                catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }
            }
            const g = computeGate(r.state, r.corrupt, realFingerprintNow(repo));
            process.stdout.write(JSON.stringify(g, null, 2) + '\n');
            if (!g.pass) process.exit(1);   // falla cerrado (R3.2)
        });

    job.command('reap')
        .description('lista procesos de jobs (identidad completa); --execute --jobs <ids...> para terminar confirmando')
        .option('--execute', 'ejecutar la terminacion de los jobs listados en --jobs')
        .option('--jobs <ids...>', 'ids de jobs a terminar (obligatorio con --execute)')
        .action(async (opts) => {
            const repo = process.cwd();
            const r = readJournal(repo, branchOf(repo));
            if (r.corrupt || r.state === null) { process.stderr.write('journal corrupto o ausente\n'); process.exit(1); }
            const plan = planReap(r.state);
            process.stdout.write(JSON.stringify(plan, null, 2) + '\n');   // R2.2: listar SIEMPRE primero
            if (opts.execute) {
                if (!Array.isArray(opts.jobs) || opts.jobs.length === 0) throw new Error('--execute requiere --jobs <ids...>');
                const killed = await executeReap(r.state, opts.jobs);
                process.stdout.write(JSON.stringify({ killed }, null, 2) + '\n');
            }
        });

    job.command('export')
        .option('--provider <p>', 'provider del ciclo', 'codex')
        .option('--baseline <file>', 'JSON con metricas del baseline 2026-07-29 (source/wallTimeMs/dispatches/mechanicalRuns)')
        .action((opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) { process.stderr.write('journal corrupto\n'); process.exit(1); }
            let baseline: BaselineMetrics | null = null;
            if (opts.baseline !== undefined) {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(fs.readFileSync(opts.baseline, 'utf8'));
                } catch (e) {
                    throw new Error(`--baseline: no se pudo leer o parsear ${opts.baseline} como JSON (${(e as Error).message})`);
                }
                if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { source?: unknown }).source !== 'string') {
                    throw new Error('--baseline requiere un JSON con al menos {source: string}');
                }
                baseline = parsed as BaselineMetrics;
            }
            const e = buildExport(r.state, opts.provider, { logsRoot: logsDir(repo, branch), baseline });
            const out = path.join(exportDir(repo, branch), 'cycle-export.json');
            writeFileAtomicDurable(out, JSON.stringify(e, null, 2) + '\n', 0o600);
            process.stdout.write(out + '\n');
        });

    // Entrypoint INTERNO del wrapper externo (Task 9). Oculto del help: lo
    // invoca el supervisor, no un humano — pero DEBE ser un comando real para
    // que el wrapper sea un proceso independiente (bloqueador 3).
    job.command('exec-wrapper', { hidden: true })
        .requiredOption('--job <id>')
        .requiredOption('--nonce <n>')
        .requiredOption('--logs <dir>')
        .option('--cwd <dir>', 'cwd del comando', '.')
        .argument('<cmd...>')
        .action(async (cmd: string[], opts) => {
            // El exit code del WRAPPER es 0 si registro el resultado (su exito
            // propio); el exit code del COMANDO viaja en el result sidecar.
            await runExecWrapper({ logsRoot: opts.logs, jobId: opts.job, nonce: opts.nonce, argv: cmd, cwd: opts.cwd });
        });
}
