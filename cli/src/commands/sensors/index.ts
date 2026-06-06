import { Command } from 'commander';
import pc from 'picocolors';
import { log } from '@clack/prompts';
import { runSensors, findManifestDir } from './run';
import { initSensors } from './init';
import { computeSensorStatus } from './status';
import { installSensorHook } from './install';
import { buildBaseline, writeBaseline } from './baseline';
import { REGISTRY_CONTENT_DIR } from '../../core/bundles';

export type RunOutputLike = { sensors: unknown[]; overall: 'pass' | 'fail' | 'skipped' | 'not_certified' };

/** Map a sensor run verdict to a process exit code. fail → 1; everything else → 0.
 *  not_certified intentionally exits 0: its signal lives in `overall`, because
 *  exit code 2 is a blocking error in Claude Code hooks. */
export function exitCodeFor(output: RunOutputLike): number {
    return output.overall === 'fail' ? 1 : 0;
}

export function registerSensorsCommand(program: Command): void {
    const sensors = program.command('sensors').description('manage computational sensors for the current project');

    sensors
        .command('run')
        .description('run sensors from .awm/sensors.json')
        .option('--fast', 'run fast sensors only (tsc, lint)')
        .option('--slow', 'run slow sensors only (semgrep, mutation)')
        .option('--all', 'run all sensors regardless of speed')
        .action((opts) => {
            const output = runSensors({ fast: opts.fast, slow: opts.slow, all: opts.all });
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
        .option('--registry-root <path>', 'path to AWM registry root', REGISTRY_CONTENT_DIR)
        .action((opts) => {
            const result = initSensors({ configure: opts.configure, registryRoot: opts.registryRoot });
            log.success(`Detected: ${result.detection.pack} (${result.detection.indicators.join(', ') || 'fallback'})`);
            log.success('Wrote .awm/sensors.json');
            result.configured.forEach((f: string) => log.info(`  Installed ${f}`));
        });

    sensors
        .command('baseline')
        .description('snapshot current findings as accepted — sensors then fail only on NEW ones')
        .action(() => {
            const manifestDir = findManifestDir(process.cwd());
            const output = runSensors({ all: true, ignoreBaseline: true });
            const baseline = buildBaseline(output.sensors.map(s => ({ name: s.name, errors: s.errors })));
            const writeDir = manifestDir ?? process.cwd();
            writeBaseline(writeDir, baseline);
            const total = Object.values(baseline).reduce((n, fps) => n + fps.length, 0);
            log.success(`Baseline guardado: ${total} hallazgos aceptados en .awm/sensors.baseline.json`);
            log.info('Los sensors ahora fallan solo ante hallazgos nuevos. Re-corré `awm sensors baseline` tras reducir deuda.');
        });

    sensors
        .command('status')
        .description('check sensor health for the current project')
        .action(() => {
            const status = computeSensorStatus();
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
