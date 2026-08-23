// `awm process` — el ÚNICO punto de parseo del modelo durable (R5.1). Todo
// consumidor (Dashboard incluido) consume esta salida, no reimplementa el parser.
import { Command } from 'commander';
import { discoverProcessModels, type DiscoveredProcessModels } from '../../core/process/discover';
import type { ProcessModel } from '../../core/process/types';

export interface CommandResult { code: 0 | 2; stdout: string; stderr: string }

/** `source` es un path absoluto del filesystem local: identifica la máquina, no
 *  el proceso. Se usa internamente para diagnósticos, y se omite de toda salida
 *  destinada a ser compartida o consumida por otro programa. */
function publicView(model: ProcessModel): Omit<ProcessModel, 'source'> {
    const { source: _source, ...rest } = model;
    return rest;
}

export function runProcessList(discovered: DiscoveredProcessModels): CommandResult {
    const stderr = discovered.diagnostics.map((d) => `warning: ${d}\n`).join('');
    if (discovered.models.length === 0) {
        return { code: 0, stdout: 'No process models declared by the installed registries.\n', stderr };
    }
    const rows = discovered.models
        .map((m) => `${m.name}  ${m.status}  ${m.entryPoint ? 'entry-point' : 'phase'}  -> ${m.terminatesTo}`)
        .join('\n');
    return { code: 0, stdout: `${rows}\n`, stderr };
}

export function runProcessShow(discovered: DiscoveredProcessModels, name: string, json: boolean): CommandResult {
    const stderr = discovered.diagnostics.map((d) => `warning: ${d}\n`).join('');
    const found = discovered.models.find((m) => m.name === name);
    if (!found) {
        const available = discovered.models.map((m) => m.name).join(', ') || '(none)';
        return { code: 2, stdout: '', stderr: `${stderr}awm process show: no process named "${name}" — available: ${available}\n` };
    }
    if (!json) {
        const view = publicView(found);
        const structure = view.body.structure
            .map((sg) => [`${sg.id} — ${sg.text}`, ...sg.operations.map((op) => `  ${op.id} — ${op.text}`)].join('\n')).join('\n');
        return { code: 0, stdout: `${view.name} (${view.status})\n\n${view.body.objective}\n\n${structure}\n`, stderr };
    }
    return { code: 0, stdout: `${JSON.stringify(publicView(found), null, 2)}\n`, stderr };
}

export function registerProcessCommand(program: Command): void {
    const process_ = program.command('process').description('declared process models (the CLI is their only parser)');

    process_
        .command('list')
        .description('list process models declared by the installed registries')
        .action(() => emit(runProcessList(discoverProcessModels())));

    process_
        .command('show <name>')
        .description('show one process model')
        .option('--json', 'emit the parsed model as JSON')
        .action((name: string, opts: { json?: boolean }) => emit(runProcessShow(discoverProcessModels(), name, opts.json === true)));
}

function emit(result: CommandResult): void {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.code !== 0) process.exitCode = result.code;
}
