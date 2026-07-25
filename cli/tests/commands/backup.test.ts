// tests/commands/backup.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { restoreBackup, listBackups, beginBackupSession } from '../../src/core/install-transaction';
import { registerBackupCommand } from '../../src/commands/backup';

let tmpHome: string;
let tmpWork: string;
let originalHome: string | undefined;
let originalAwmHome: string | undefined;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-backupcmd-home-'));
    tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-backupcmd-work-'));
    originalHome = process.env.HOME;
    originalAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
});

afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpWork, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = originalAwmHome;
});

describe('restoreBackup', () => {
    it('restores only manifest targets and rejects path traversal ids', () => {
        const codexAgentsFile = path.join(tmpWork, 'AGENTS.md');
        const preferencesFile = path.join(tmpWork, 'preferences.json');
        const unrelatedFile = path.join(tmpWork, 'unrelated.txt');

        fs.writeFileSync(codexAgentsFile, 'codex-before');
        fs.writeFileSync(preferencesFile, 'prefs-before');
        fs.writeFileSync(unrelatedFile, 'keep');

        const session = beginBackupSession([codexAgentsFile, preferencesFile]);
        fs.writeFileSync(codexAgentsFile, 'codex-after');
        fs.writeFileSync(preferencesFile, 'prefs-after');

        expect(() => restoreBackup('../outside')).toThrow('invalid backup transaction id');

        const validTransactionId = session.transactionId;
        const result = restoreBackup(validTransactionId);
        expect(result.restored).toEqual([codexAgentsFile, preferencesFile]);
        expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe('keep'); // verifies R25
        expect(fs.readFileSync(codexAgentsFile, 'utf8')).toBe('codex-before');
        expect(fs.readFileSync(preferencesFile, 'utf8')).toBe('prefs-before');
    });

    it('rejects ids that embed a path separator even when digit-prefixed', () => {
        expect(() => restoreBackup('2024-01-01T00-00-00-000Z/../../etc')).toThrow('invalid backup transaction id');
    });

    it('rejects a well-formed but nonexistent transaction id', () => {
        expect(() => restoreBackup('2020-01-01T00-00-00-000Z')).toThrow();
    });
});

describe('listBackups', () => {
    it('lists recorded transactions newest first, without leaking file contents', () => {
        const fileA = path.join(tmpWork, 'a.txt');
        fs.writeFileSync(fileA, 'secret-value');
        const session = beginBackupSession([fileA]);

        const backups = listBackups();
        expect(backups.length).toBe(1);
        expect(backups[0].id).toBe(session.transactionId);
        expect(backups[0].targets).toEqual([fileA]);
        expect(backups[0].committed).toBe(false);
        expect(JSON.stringify(backups)).not.toContain('secret-value');
    });

    it('returns an empty list when no backups exist yet', () => {
        expect(listBackups()).toEqual([]);
    });
});

describe('registerBackupCommand', () => {
    it('registers `backup list` and `backup restore` subcommands', () => {
        const program = new Command();
        registerBackupCommand(program);

        const backup = program.commands.find((c) => c.name() === 'backup');
        expect(backup).toBeDefined();
        const subNames = backup!.commands.map((c) => c.name());
        expect(subNames).toEqual(expect.arrayContaining(['list', 'restore']));
    });

    it('`backup list --json` prints the same data as listBackups()', () => {
        const fileA = path.join(tmpWork, 'b.txt');
        fs.writeFileSync(fileA, 'v');
        beginBackupSession([fileA]);

        const program = new Command();
        program.exitOverride();
        registerBackupCommand(program);

        let output = '';
        const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            output += chunk.toString();
            return true;
        });
        try {
            program.parse(['node', 'awm', 'backup', 'list', '--json']);
        } finally {
            write.mockRestore();
        }

        const parsed = JSON.parse(output);
        expect(parsed).toEqual(listBackups());
    });
});
