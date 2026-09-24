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
import { ABSENT_JOURNAL_DETAIL, journalPresence, readJournal } from '../../core/journal/store';
import { exportDir, logsDir } from '../../core/journal/paths';
import { verifyBranchInvariant } from '../watch/lock';
import { writeFileAtomicDurable } from '../../core/atomic-file';
import { resolveCommandContext } from '../../core/tracks/context';
import { routingReport } from '../../core/model-policy/journal';
import { isRoutingEnvelope, isRoutingSelection } from '../../core/journal/types';
import { parseJsonNoDuplicate } from '../../core/plan/json';
import fs from 'fs';
import { observeNativeRoutingChild } from '../../core/model-policy/native-routing-observe';
import { secureFs } from '../../core/secure-fs/native-bridge';

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
export function readBoundedJson(file: string): unknown {
    if (typeof file !== 'string' || file.length === 0 || file.length > 4096) throw new Error('routing file path is invalid');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) throw new Error('routing file must be a bounded non-symlink regular file');
    let bytes: Uint8Array;
    try { bytes = secureFs.readRegularFile(file, 256 * 1024).bytes; }
    catch { throw new Error('routing file must remain a bounded non-symlink regular file'); }
    try { return parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('routing file must contain UTF-8 JSON without duplicate keys'); }
}

/** Guard de entrada (R9.4): sin descriptor de track, es un no-op — el caso
 *  comun de siempre no paga costo ni riesgo nuevo. Con descriptor presente
 *  que no autentica (fencing/realpath/journalId no coinciden), rechaza ANTES
 *  de que el verbo emita o consulte nada, mismo patron de salida que
 *  verifyBranchInvariant mas abajo (stderr + exit 1). */
function assertAuthenticatedCwd(repo: string, branch: string): void {
    try {
        resolveCommandContext(repo, branch);
    } catch (e) {
        process.stderr.write(`${(e as Error).message}\n`);
        process.exit(1);
    }
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
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = requestJob(repo, branch, opts.generation, cmd, opts.paths ?? [], opts.cwd, { satisfies: opts.satisfies });
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    job.command('register')
        .description('registra una entidad del ciclo (task | cycle-plan | dispatch | task-status | next-action | custody-decision) ANTES de actuar')
        .requiredOption('--generation <token>')
        .requiredOption('--entity <kind>', 'task | cycle-plan | dispatch | task-status | next-action | custody-decision')
        .requiredOption('--json <payload>', 'payload JSON de la entidad')
        .action((opts) => {
            let payload: unknown;
            try { payload = JSON.parse(opts.json); } catch { throw new Error('--json requiere un objeto JSON valido'); }
            if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('--json requiere un objeto JSON');
            if ('entity' in payload && (payload as Record<string, unknown>).entity !== opts.entity) {
                throw new Error('--json entity debe coincidir con --entity');
            }
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            if (opts.entity === 'task') {
                const current = readJournal(repo, branch);
                if (current.corrupt || current.state === null) throw new Error('register --entity task requiere journal valido');
                const taskId = (payload as Record<string, unknown>).taskId;
                const rawPlan = (payload as Record<string, unknown>).verificationPlan;
                const allowedKinds = ['test', 'lint', 'sensors', 'review', 'qa', 'interlock', 'track-integration'];
                if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('register --entity task requiere taskId');
                if (rawPlan !== undefined && (!Array.isArray(rawPlan) || !rawPlan.every(item =>
                    typeof item === 'object' && item !== null && typeof item.id === 'string' && item.id.length > 0
                    && allowedKinds.includes(item.kind) && (item.satisfiedBy === undefined || typeof item.satisfiedBy === 'string')))) {
                    throw new Error('register --entity task requiere verificationPlan valido');
                }
                const plan = (rawPlan ?? []) as Array<{ kind: string }>;
                const missing = current.state.requiredVerifiers.filter(kind => !plan.some(item => item.kind === kind));
                if (missing.length > 0) throw new Error(`register --entity task: verificationPlan no cubre los verificadores requeridos: ${missing.join(', ')}`);
            }
            const r = emitRequest(repo, branch, {
                kind: 'register-entity', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`${opts.entity}:${opts.json}`).digest('hex'),
                payload: { ...(payload as Record<string, unknown>), entity: opts.entity },
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
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const reviewArgv = ['awm-review', opts.obligation];
            const reviewFingerprint = computeFingerprint(repo, reviewArgv, [], '.');
            // Determinista a partir de los MISMOS inputs que idempotencyKey, INCLUYENDO
            // generation en ambos (alineado — bug post-624a4c0: idempotencyKey se habia
            // quedado sin generation mientras verdictId si la incluia, lo que hacia que
            // un veredicto genuinamente distinto en otra generacion colisionara en
            // idempotencyKey pero difiriera en payloadDigest, cayendo a
            // rejected-digest-mismatch en vez de aplicarse como veredicto nuevo):
            // un retry genuino del mismo comando (misma generation) produce un payload
            // byte-identico, no un rejected-digest-mismatch espurio (Fix 3); una
            // generation distinta produce una idempotencyKey ENTERAMENTE distinta, no
            // una colision con digest distinto.
            const verdictId = `verd-${crypto.createHash('sha256').update(`${opts.generation}:${opts.obligation}:${opts.result}:${opts.detail}:${reviewFingerprint.fingerprint}`).digest('hex').slice(0, 16)}`;
            emitRequest(repo, branch, {
                kind: 'verdict', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`verdict:${opts.generation}:${opts.obligation}:${opts.result}:${opts.detail}:${reviewFingerprint.fingerprint}`).digest('hex'),
                payload: {
                    verdictId, obligationId: opts.obligation, result: opts.result, detail: opts.detail,
                    fingerprint: reviewFingerprint.fingerprint, argv: reviewArgv, paths: [], cwd: '.',
                },
            });
            process.stdout.write(JSON.stringify({ verdictId }, null, 2) + '\n');
        });

    job.command('controller-heartbeat')
        .requiredOption('--generation <token>')
        .action((opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            emitHeartbeat(repo, branch, opts.generation);
        });

    job.command('routing-reserve')
        .requiredOption('--generation <token>').requiredOption('--obligation <id>').requiredOption('--lineage <id>')
        .requiredOption('--envelope-file <file>').requiredOption('--fingerprint <sha>').option('--cwd <root>', 'repository root', '.').option('--json')
        .action((opts) => {
            const envelope = readBoundedJson(opts.envelopeFile); if (!isRoutingEnvelope(envelope) || !/^[a-f0-9]{64}$/.test(opts.fingerprint)) throw new Error('routing-reserve requires a valid envelope and fingerprint');
            const repo = path.resolve(opts.cwd); const branch = branchOf(repo); assertAuthenticatedCwd(repo, branch);
            const emitted = emitRequest(repo, branch, { kind: 'routing-reserve', generationToken: opts.generation, idempotencyKey: crypto.createHash('sha256').update(`routing-reserve:${opts.generation}:${opts.obligation}:${opts.lineage}:${opts.fingerprint}:${JSON.stringify(envelope)}`).digest('hex'), payload: { obligationId: opts.obligation, lineageId: opts.lineage, envelope, fingerprint: opts.fingerprint } });
            process.stdout.write(JSON.stringify({ requestId: emitted.requestId }) + '\n');
        });
    job.command('routing-observe')
        .requiredOption('--generation <token>').requiredOption('--attempt <id>').requiredOption('--native-agent-id <id>')
        .requiredOption('--observation-file <file>').option('--cwd <root>', 'repository root', '.').option('--json')
        .action(async (opts) => {
            const observation = readBoundedJson(opts.observationFile); if (typeof observation !== 'object' || observation === null || Array.isArray(observation)) throw new Error('routing-observe requires an observation object'); const observed = (observation as { observed?: unknown }).observed; const unavailableReason = (observation as { unavailableReason?: unknown }).unavailableReason; if ((observed !== undefined && !isRoutingSelection(observed)) || (unavailableReason !== undefined && typeof unavailableReason !== 'string')) throw new Error('routing-observe requires a valid observation');
            const repo = path.resolve(opts.cwd); const branch = branchOf(repo); assertAuthenticatedCwd(repo, branch);
            const read = readJournal(repo, branch);
            if (read.corrupt || !read.state) throw new Error('routing-observe requires a healthy journal');
            const attempt = read.state.routingAttempts?.find(item => item.id === opts.attempt);
            if (!attempt) throw new Error('routing-observe attempt is unknown');
            let nativeProof: Awaited<ReturnType<typeof observeNativeRoutingChild>> | undefined;
            let reason = unavailableReason;
            if (attempt.nativeEvidenceRequired && reason === undefined) {
                try {
                    const parentThreadId = (observation as { parentThreadId?: unknown }).parentThreadId;
                    if (read.state.routingAttempts?.some(item => item.id !== attempt.id && item.nativeEvidenceRequired && item.nativeAgentId === opts.nativeAgentId))
                        throw new Error('native child was already used by another attempt');
                    nativeProof = await observeNativeRoutingChild({ attempt, nativeAgentId: opts.nativeAgentId,
                        ...(typeof parentThreadId === 'string' ? { parentThreadId } : {}), cwd: repo, now: new Date(),
                        consumedEventDigests: (read.state.routingAttempts ?? []).map(item => item.nativeEventDigest).filter((item): item is string => item !== undefined) });
                } catch { reason = 'PROVENANCE_MISSING'; }
            }
            const payload = { attemptId: opts.attempt, nativeAgentId: opts.nativeAgentId,
                ...(nativeProof ? { observed: nativeProof.selection, nativeProof } : attempt.nativeEvidenceRequired ? {} : observed === undefined ? {} : { observed }),
                ...(reason === undefined ? {} : { unavailableReason: reason }) };
            const emitted = emitRequest(repo, branch, { kind: 'routing-observe', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`routing-observe:${opts.generation}:${opts.attempt}:${opts.nativeAgentId}:${JSON.stringify(payload)}`).digest('hex'), payload });
            process.stdout.write(JSON.stringify({ requestId: emitted.requestId }) + '\n');
        });

    job.command('ps').action(() => {
        const repo = process.cwd();
        const branch = branchOf(repo);
        assertAuthenticatedCwd(repo, branch);
        process.stdout.write(JSON.stringify(queryPs(repo, branch), null, 2) + '\n');
    });

    job.command('list').action(() => {
        const repo = process.cwd();
        const branch = branchOf(repo);
        assertAuthenticatedCwd(repo, branch);
        process.stdout.write(JSON.stringify(queryList(repo, branch), null, 2) + '\n');
    });

    job.command('show')
        .argument('<jobId>')
        .action((jobId: string) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const out = queryShow(repo, branch, jobId);
            process.stdout.write(JSON.stringify(out, null, 2) + '\n');
            if (out.corruptState || out.job === null) process.exit(1);
        });

    job.command('reconcile')
        .description('informe read-only de la matriz unica R1.8 + next_action (la mutacion es del supervisor)')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = readJournal(repo, branch);
            const presence = journalPresence(r);
            if (presence !== 'present' || r.state === null) {
                // Absence and corruption need different responses, so they are
                // reported as different facts. Both still fail closed (#173).
                process.stdout.write(JSON.stringify(presence === 'absent'
                    ? { journal: 'absent', corruptState: false, remedy: ABSENT_JOURNAL_DETAIL }
                    : { journal: 'corrupt', corruptState: true }, null, 2) + '\n');
                process.exit(1);
            }
            try { verifyBranchInvariant(repo, r.state.branch); }
            catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }
            // copia en memoria: reconcileJobs muta SU copia, jamas el disco (R3.1)
            const clone = JSON.parse(JSON.stringify(r.state));
            const out = reconcileJobs(clone, logsDir(repo, branch));
            const active = r.state.generations.find((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
            process.stdout.write(JSON.stringify({
                decisions: out.decisions,
                nextAction: r.state.cycle.nextAction ?? null,
                cycleStatus: r.state.cycle.status,
                generation: active === undefined ? null : { n: active.n, token: active.token },
            }, null, 2) + '\n');
        });

    job.command('gate')
        .description('interlock fail-closed: exit != 0 si CUALQUIER cosa impide certificar')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = readJournal(repo, branch);
            if (r.state !== null) {
                try { verifyBranchInvariant(repo, r.state.branch); }
                catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }
            }
            const g = computeGate(r.state, r.corrupt, realFingerprintNow(repo), r.absent);
            process.stdout.write(JSON.stringify(g, null, 2) + '\n');
            if (!g.pass) process.exit(1);   // falla cerrado (R3.2)
        });

    job.command('routing-report')
        .description('informe de routing read-only; nunca expone envelopes ni identidad nativa')
        .option('--json', 'emit the routing report as JSON')
        .action(() => {
            const repo = process.cwd(); const branch = branchOf(repo); assertAuthenticatedCwd(repo, branch);
            const r = readJournal(repo, branch);
            const presence = journalPresence(r);
            if (presence !== 'present' || r.state === null) { process.stdout.write(JSON.stringify({ journal: presence, corruptState: presence === 'corrupt' }) + '\n'); process.exit(1); return; }
            process.stdout.write(JSON.stringify(routingReport(r.state), null, 2) + '\n');
        });

    job.command('reap')
        .description('lista procesos de jobs (identidad completa); --execute --jobs <ids...> para terminar confirmando')
        .option('--execute', 'ejecutar la terminacion de los jobs listados en --jobs')
        .option('--jobs <ids...>', 'ids de jobs a terminar (obligatorio con --execute)')
        .action(async (opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            assertAuthenticatedCwd(repo, branch);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) { process.stderr.write(`${r.absent && !r.corrupt ? ABSENT_JOURNAL_DETAIL : 'journal corrupto o ilegible'}\n`); process.exit(1); }
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
            assertAuthenticatedCwd(repo, branch);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) { process.stderr.write(`${r.absent && !r.corrupt ? ABSENT_JOURNAL_DETAIL : 'journal corrupto o ilegible'}\n`); process.exit(1); }
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
