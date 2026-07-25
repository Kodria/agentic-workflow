// src/commands/backup.ts
import { Command } from 'commander';
import pc from 'picocolors';
import { listBackups, restoreBackup } from '../core/install-transaction';

export function registerBackupCommand(program: Command): void {
    const backup = program.command('backup')
        .description('inspect and restore AWM filesystem backups (~/.awm/backups)');

    backup
        .command('list')
        .description('list recorded backup transactions')
        .option('--json', 'emit the list as JSON')
        .action((options: { json?: boolean }) => {
            const backups = listBackups();
            if (options.json) {
                process.stdout.write(JSON.stringify(backups, null, 2) + '\n');
                return;
            }
            if (backups.length === 0) {
                console.log(pc.dim('(no backups recorded)'));
                return;
            }
            for (const b of backups) {
                const status = b.committed ? pc.dim('committed') : pc.yellow('uncommitted');
                console.log(`${b.id}  ${status}  ${b.targets.length} target(s)`);
            }
        });

    backup
        .command('restore <transactionId>')
        .description('restore every filesystem target recorded in a backup transaction')
        .action((transactionId: string) => {
            try {
                const result = restoreBackup(transactionId);
                console.log(pc.green(`Restored ${result.restored.length} target(s) from ${transactionId}`));
                for (const target of result.restored) console.log(`  ${target}`);
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });
}
