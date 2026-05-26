import { Command } from 'commander';
import path from 'path';
import os from 'os';
import pc from 'picocolors';
import { log } from '@clack/prompts';
import { runSensors } from './run';
import { initSensors } from './init';
import { computeSensorStatus } from './status';
import { installSensorHook } from './install';

const DEFAULT_REGISTRY_ROOT = path.join(os.homedir(), '.awm', 'cli-source');

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
            if (output.sensors.length > 0) {
                process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            }
            if (output.overall === 'fail') process.exit(1);
        });

    sensors
        .command('init')
        .description('detect stack and write .awm/sensors.json (+ copy pack config files)')
        .option('--no-configure', 'skip copying sensor pack config files into the project')
        .option('--registry-root <path>', 'path to AWM registry root', DEFAULT_REGISTRY_ROOT)
        .action((opts) => {
            const result = initSensors({ configure: opts.configure, registryRoot: opts.registryRoot });
            log.success(`Detected: ${result.detection.pack} (${result.detection.indicators.join(', ') || 'fallback'})`);
            log.success('Wrote .awm/sensors.json');
            result.configured.forEach((f: string) => log.info(`  Installed ${f}`));
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
