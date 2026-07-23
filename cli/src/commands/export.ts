// src/commands/export.ts
//
// awm export <nombre> [--target claude-ai] [--out <dir>] — genera artefactos
// subibles a claude.ai desde el registry instalado (issue #9). Comando delgado:
// la lógica vive en core/export.
import { Command } from 'commander';
import pc from 'picocolors';
import path from 'path';
import { runExport, RunExportOptions } from '../core/export';
import { ZipFn } from '../core/export/types';

interface CommandFlags {
    target?: string;
    out?: string;
}

/** Deps inyectables para tests (roots/zip/log); producción usa defaults del motor. */
interface CommandDeps {
    roots?: string[];
    zip?: ZipFn;
    log?: (msg: string) => void;
}

export function runExportCommand(name: string, flags: CommandFlags, deps: CommandDeps = {}): void {
    const log = deps.log ?? console.log;
    const opts: RunExportOptions = {
        name,
        target: flags.target,
        out: flags.out,
        roots: deps.roots,
        zip: deps.zip,
    };
    const summary = runExport(opts);

    log(pc.dim(`Exported ${summary.kind} "${name}"`));
    for (const e of summary.exported) {
        log(pc.green(`✓ ${e.name}`) + pc.dim(` → ${e.zip ?? e.dir}`));
    }
    if (summary.skipped.length > 0) {
        log(pc.dim(`Skipped (not portable): ${summary.skipped.join(', ')}`));
    }
    if (!summary.zipAvailable) {
        log(pc.yellow('zip binary not found — folders were written without archives.'));
        log(pc.dim(`Compress manually, e.g.: cd ${summary.outDir} && zip -r <skill>.zip <skill>`));
    }
    log(pc.dim(`Output: ${path.resolve(summary.outDir)}`));
}

export function registerExportCommand(program: Command): void {
    program.command('export <name>')
        .description('Export a bundle or skill as claude.ai-uploadable custom skill artifacts (folder + zip)')
        .option('--target <target>', 'export target', 'claude-ai')
        .option('--out <dir>', 'output directory (default: ./awm-export)')
        .action((name: string, flags: CommandFlags) => {
            try {
                runExportCommand(name, flags);
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });
}
