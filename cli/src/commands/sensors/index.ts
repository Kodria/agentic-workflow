import { Command } from 'commander';
import pc from 'picocolors';
import { log } from '@clack/prompts';
import { runSensors, findManifestDir } from './run';
import { initSensors } from './init';
import { computeSensorStatus } from './status';
import { installSensorHook } from './install';
import { buildBaseline, writeBaseline } from './baseline';
import { runCoverage } from './coverage';
import { renderCoverageHuman, renderCoverageJson } from './coverage/render';
import { capabilityRoot } from '../../core/registries';

export type RunOutputLike = { sensors: unknown[]; overall: 'pass' | 'fail' | 'skipped' | 'not_certified' };

/** Map a sensor run verdict to a process exit code. fail → 1; everything else → 0.
 *  not_certified intentionally exits 0: its signal lives in `overall`, because
 *  exit code 2 is a blocking error in Claude Code hooks. */
export function exitCodeFor(output: RunOutputLike): number {
    return output.overall === 'fail' ? 1 : 0;
}

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
            const code = exitCodeFor(output);
            if (code !== 0) process.exit(code);
        });

    sensors
        .command('init')
        .description('detect stack and write .awm/sensors.json (+ copy pack config files)')
        .option('--no-configure', 'skip copying sensor pack config files into the project')
        .option('--registry-root <path>', 'path to AWM registry root')
        .option('--pack <name>', 'skip auto-detection, use this pack explicitly')
        .action(async (opts) => {
            const registryRoot = opts.registryRoot ?? capabilityRoot('sensor-packs') ?? undefined;
            try {
                const result = await initSensors({ configure: opts.configure, registryRoot, pack: opts.pack });
                log.success(`Detected: ${result.detection.pack} (${result.detection.indicators.join(', ') || 'fallback'})`);
                // Said BEFORE "Wrote .awm/sensors.json": the manifest about to be
                // reported as written is not the one the detection implied.
                if (result.unavailablePack) {
                    log.warn(
                        `No '${result.unavailablePack}' sensor-pack in the registry — wrote the `
                        + `'${result.manifest.pack}' pack instead (${Object.keys(result.manifest.sensors).length} sensors). `
                        + 'Run `awm update`, or add a registry that ships it, then re-run `awm sensors init`.',
                    );
                }
                log.success('Wrote .awm/sensors.json');
                result.configured.forEach((f: string) => log.info(`  Installed ${f}`));
            } catch (e) {
                log.error(e instanceof Error ? e.message : String(e));
                process.exit(1);
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
        .description('check sensor health for the current project')
        .action(async () => {
            const status = await computeSensorStatus();
            const icon = status.overall === 'HEALTHY' ? pc.green('✔') : pc.yellow('⚠');
            console.log(`\nPack:    ${status.pack ?? 'none'}`);
            console.log(`Overall: ${icon} ${status.overall}\n`);
            for (const [name, check] of Object.entries(status.checks)) {
                const mark = check.ok ? pc.green('✔') : pc.red('✘');
                console.log(`  ${mark}  ${name.padEnd(12)} ${check.detail}`);
            }
            console.log('');
            if (status.overall !== 'HEALTHY') process.exit(1);
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
