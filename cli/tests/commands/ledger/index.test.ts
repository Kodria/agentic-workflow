import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { registerLedgerCommand } from '../../../src/commands/ledger';
import { listEntries } from '../../../src/core/ledger/store';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ledger-cli-'));
}

function run(argv: string[], cwd: string): string {
    const prog = new Command();
    prog.exitOverride();
    registerLedgerCommand(prog);
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    try {
        prog.parse(['node', 'awm', 'ledger', ...argv]);
    } finally {
        cwdSpy.mockRestore();
    }
    const out = spy.mock.calls.map(c => String(c[0])).join('');
    spy.mockRestore();
    return out;
}

describe('awm ledger CLI', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('add writes an entry to the current branch ledger', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
             '--signature', 'sig-1', '--severity', 'blocker', '--desc', 'boom', '--ref', 'a.ts:1'], cwd);
        const entries = listEntries(cwd, 'feat-x');
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ signature: 'sig-1', polarity: 'finding', class: 'logica' });
        expect(entries[0].ts).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    test('add persists an optional reusable defect class', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
             '--signature', 'sig-1', '--severity', 'blocker', '--desc', 'boom', '--defect-class', 'lint-errors'], cwd);
        expect(listEntries(cwd, 'feat-x')).toEqual([expect.objectContaining({ defectClass: 'lint-errors' })]);
    });

    test.each(['', 'Bad_ID', '../escape', 'a b', '-leading', 'trailing-'])
    ('add rejects invalid defect class %p before writing', (defectClass) => {
        expect(() => run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
            '--signature', 'sig-1', '--severity', 'blocker', '--desc', 'boom', '--defect-class', defectClass], cwd))
            .toThrow(/defect-class.*kebab-case/i);
        expect(listEntries(cwd, 'feat-x')).toEqual([]);
    });

    test.each(['test', 'Test', 'test-check', 'test_x', 'placeholder', 'foo', 'bar', 'todo', 'tbd'])
    ('add rejects a placeholder --desc %p before writing', (desc) => {
        expect(() => run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
            '--signature', 'sig-1', '--severity', 'blocker', '--desc', desc], cwd))
            .toThrow(/placeholder.*ledger add --help/i);
        expect(listEntries(cwd, 'feat-x')).toEqual([]);
    });

    test('add accepts a real description that merely contains the word test', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
             '--signature', 'sig-1', '--severity', 'blocker', '--desc', 'unit test for parseConfig throws on empty input'], cwd);
        expect(listEntries(cwd, 'feat-x')).toHaveLength(1);
    });

    test('list emits the branch entries as JSON', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'win', '--class', 'proceso',
             '--signature', 'good', '--severity', 'info', '--desc', 'nice'], cwd);
        const out = run(['list', '--branch', 'feat-x'], cwd);
        expect(JSON.parse(out)).toHaveLength(1);
        expect(JSON.parse(out)[0].polarity).toBe('win');
    });

    test('recurring reports clusters at or above --min', () => {
        for (const _ of [0, 1]) {
            run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
                 '--signature', 'dup', '--severity', 'minor', '--desc', 'x'], cwd);
        }
        const out = run(['recurring', '--branch', 'feat-x', '--min', '2'], cwd);
        expect(JSON.parse(out)).toMatchObject([{ signature: 'dup', count: 2 }]);
    });

    test('archive removes the active ledger', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
             '--signature', 's', '--severity', 'minor', '--desc', 'x'], cwd);
        run(['archive', '--branch', 'feat-x'], cwd);
        expect(listEntries(cwd, 'feat-x')).toEqual([]);
    });
});
