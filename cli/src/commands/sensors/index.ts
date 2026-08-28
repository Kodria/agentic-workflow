import { Command } from 'commander';
import pc from 'picocolors';
import { log } from '@clack/prompts';
import { runSensors, findManifestDir } from './run';
import { computeSensorStatus } from './status';
import { installSensorHook } from './install';
import { buildBaseline, writeBaseline } from './baseline';
import { runCoverage } from './coverage';
import { renderCoverageHuman, renderCoverageJson } from './coverage/render';
import { capabilityRoot } from '../../core/registries';
import { exitCodeForVerdict } from './verdict';
import { applySensorBootstrap, planSensorBootstrap, type BootstrapMode } from './bootstrap';

/** Commander coercion for coverage recurrence emphasis. It deliberately runs
 * before the action, so an invalid value cannot trigger ledger I/O. */
export function parsePositiveSafeInteger(value: string): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new Error('--min must be a positive safe integer');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error('--min must be a positive safe integer');
    return parsed;
}

export function registerSensorsCommand(program: Command): void {
    const sensors = program.command('sensors').description('manage computational sensors for the current project');

    sensors
        .command('coverage')
        .description('report static gaps between configured sensors and the pack reference')
        .option('--json', 'emit the versioned machine-readable envelope')
        .option('--min <count>', 'recurrence emphasis threshold', parsePositiveSafeInteger, 2)
        .action(async (opts: { json?: boolean; min: number }) => {
            try {
                const report = await runCoverage(process.cwd(), {}, { min: opts.min });
                process.stdout.write(opts.json ? renderCoverageJson(report) : renderCoverageHuman(report));
            } catch (error) {
                log.error(error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        });

    sensors
        .command('run')
        .description('run sensors from .awm/sensors.json')
        .option('--fast', 'run fast sensors only (tsc, lint)')
        .option('--slow', 'run slow sensors only (semgrep, mutation)')
        .option('--all', 'run all sensors regardless of speed')
        .option('--changed', 'scope sensors that support it to the files changed vs --base')
        .option('--base <ref>', 'comparison point for --changed (default: HEAD, i.e. uncommitted work)')
        .action(async (opts) => {
            const output = await runSensors({
                fast: opts.fast, slow: opts.slow, all: opts.all,
                changed: opts.changed, base: opts.base,
            });
            // Emit the verdict ALWAYS — an empty `sensors` with overall:'not_certified'
            // must be visible, never a silent exit-0 that reads as "clean".
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            process.exitCode = exitCodeForVerdict(output.overall);
        });

    sensors
        .command('init')
        .description('detect stack and write .awm/sensors.json (+ copy pack config files)')
        .option('--no-configure', 'skip copying sensor pack config files into the project')
        .option('--registry-root <path>', 'path to AWM registry root')
        .option('--pack <name>', 'skip auto-detection, use this pack explicitly')
        .option('--package-root <dir>', 'run detection/execution from this subdirectory (monorepo support) — the manifest still writes at the current directory')
        .action(async (opts) => {
            const registryRoot = opts.registryRoot ?? capabilityRoot('sensor-packs') ?? undefined;
            try {
                const plan = await planSensorBootstrap(process.cwd(), { mode: 'project-sensors', registryRoot, configure: opts.configure, pack: opts.pack, packageRoot: opts.packageRoot });
                if (plan.kind === 'blocked') throw new Error(`${plan.reason}: ${plan.remedy}`);
                if (plan.kind === 'noop') { log.info('already-configured'); return; }
                if (plan.kind === 'migrate') throw new Error('sensors init does not migrate an existing v2 manifest; run awm sensors bootstrap');
                const result = applySensorBootstrap(plan);
                const detected = plan.manifest.mode === 'project-sensors' ? plan.manifest.pack : 'none';
                log.success(`Detected: ${detected}`);
                // Said BEFORE "Wrote .awm/sensors.json": the manifest about to be
                // reported as written is not the one the detection implied.
                log.success(`${result} .awm/sensors.json`);
            } catch (e) {
                log.error(e instanceof Error ? e.message : String(e));
                process.exit(1);
            }
        });

    sensors
        .command('bootstrap')
        .description('explicitly create or migrate portable project sensor configuration')
        .option('--mode <mode>', 'project-sensors, native-gate, or opt-out')
        .option('--reason <text>', 'versioned reason required by native-gate and opt-out')
        .option('--dry-run', 'report exact project changes without writing files')
        .action(async (opts: { mode?: BootstrapMode; reason?: string; dryRun?: boolean }) => {
            try {
                const plan = await planSensorBootstrap(process.cwd(), { mode: opts.mode, reason: opts.reason, dryRun: opts.dryRun });
                if (plan.kind === 'blocked') {
                    log.error(`${plan.reason}: ${plan.remedy}`);
                    process.exitCode = 1;
                    return;
                }
                if (plan.kind === 'noop') {
                    log.info('already-configured');
                    return;
                }
                const summary = plan.changes.map(change => change.path).join(', ');
                if (plan.dryRun) {
                    log.info(`dry-run: ${plan.kind}; ${summary}`);
                    return;
                }
                const result = applySensorBootstrap(plan);
                log.success(`${result}: ${summary}`);
            } catch (error) {
                log.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });

    sensors
        .command('baseline')
        .description('snapshot current findings as accepted — sensors then fail only on NEW ones')
        .action(async () => {
            const manifestDir = findManifestDir(process.cwd());
            const output = await runSensors({ all: true, ignoreBaseline: true });
            const baseline = buildBaseline(output.sensors.map(s => ({ name: s.name, errors: s.errors })));
            const writeDir = manifestDir ?? process.cwd();
            writeBaseline(writeDir, baseline);
            const total = Object.values(baseline).reduce((n, fps) => n + fps.length, 0);
            log.success(`Baseline saved: ${total} findings accepted in .awm/sensors.baseline.json`);
            log.info('Sensors now fail only on new findings. Re-run `awm sensors baseline` after reducing debt.');
        });

    sensors
        .command('status')
        .description('check static sensor readiness for the current project')
        .action(async () => {
            const status = await computeSensorStatus();
            const icon = status.overall === 'READY' ? pc.green('✔') : pc.yellow('⚠');
            console.log(`\nPack:    ${status.pack ?? 'none'}`);
            console.log(`Overall: ${icon} ${status.overall}\n`);
            for (const [name, check] of Object.entries(status.checks)) {
                const mark = check.ok ? pc.green('✔') : pc.red('✘');
                console.log(`  ${mark}  ${name.padEnd(12)} ${check.detail}`);
            }
            console.log('');
            if (status.overall !== 'READY') process.exit(1);
        });

    sensors
        .command('install')
        .description('install PostToolUse hook in ~/.claude/settings.json')
        .action(() => {
            const result = installSensorHook();
            if (result.status === 'already-installed') {
                log.info('PostToolUse hook already installed.');
            } else {
                log.success('PostToolUse hook installed in ~/.claude/settings.json');
                if (result.backupPath) log.info(`  Backup: ${result.backupPath}`);
            }
        });
}
