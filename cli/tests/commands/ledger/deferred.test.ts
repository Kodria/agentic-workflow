import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { registerLedgerCommand } from '../../../src/commands/ledger';
import { listDeferredOpen, listEntries } from '../../../src/core/ledger/store';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ledger-defer-'));
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

function addDeferred(cwd: string, signature: string, reason: string, desc: string): void {
    run([
        'add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'proceso',
        '--signature', signature, '--severity', 'minor', '--desc', desc,
        '--deferred', reason,
    ], cwd);
}

describe('awm ledger deferred/resolved CLI (RF-4.7)', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('add --deferred round-ceiling assigns unique id and deferred.at', () => {
        addDeferred(cwd, 'sig-a', 'round-ceiling', 'non-blocking style finding');
        const entries = listEntries(cwd, 'feat-x');
        expect(entries).toHaveLength(1);
        expect(entries[0].id).toEqual(expect.stringMatching(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/i));
        expect(entries[0].id!.length).toBeGreaterThan(8);
        expect(entries[0].deferred).toMatchObject({ reason: 'round-ceiling' });
        expect(entries[0].deferred!.at).toMatch(/\d{4}-\d{2}-\d{2}T/);
        expect(entries[0].resolved).toBeUndefined();
    });

    test('add --deferred re-review-defer is accepted', () => {
        addDeferred(cwd, 'sig-b', 're-review-defer', 'non-blocking re-review deferral');
        expect(listEntries(cwd, 'feat-x')[0].deferred).toMatchObject({ reason: 're-review-defer' });
    });

    test('add without --deferred still assigns a stable unique id', () => {
        run([
            'add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
            '--signature', 'plain', '--severity', 'blocker', '--desc', 'real finding text',
        ], cwd);
        const [entry] = listEntries(cwd, 'feat-x');
        expect(entry.id).toEqual(expect.any(String));
        expect(entry.deferred).toBeUndefined();
    });

    test('two deferred entries with the same signature get distinct ids; resolve --id resolves only one', () => {
        addDeferred(cwd, 'shared-sig', 'round-ceiling', 'first deferred finding');
        addDeferred(cwd, 'shared-sig', 're-review-defer', 'second deferred finding');
        const [first, second] = listEntries(cwd, 'feat-x');
        expect(first.id).toBeDefined();
        expect(second.id).toBeDefined();
        expect(first.id).not.toBe(second.id);
        expect(first.signature).toBe('shared-sig');
        expect(second.signature).toBe('shared-sig');

        run(['resolve', '--branch', 'feat-x', '--id', first.id!, '--how', 'accepted'], cwd);

        const after = listEntries(cwd, 'feat-x');
        expect(after.find(e => e.id === first.id)!.resolved).toMatchObject({ how: 'accepted' });
        expect(after.find(e => e.id === second.id)!.resolved).toBeUndefined();

        const open = JSON.parse(run(['list', '--branch', 'feat-x', '--deferred-open'], cwd));
        expect(open).toHaveLength(1);
        expect(open[0].id).toBe(second.id);
    });

    test('list --deferred-open returns only deferred && !resolved', () => {
        addDeferred(cwd, 'open-a', 'round-ceiling', 'stays open finding');
        addDeferred(cwd, 'open-b', 'round-ceiling', 'will be resolved finding');
        run([
            'add', '--branch', 'feat-x', '--polarity', 'win', '--class', 'proceso',
            '--signature', 'not-deferred', '--severity', 'info', '--desc', 'plain win entry',
        ], cwd);
        const entries = listEntries(cwd, 'feat-x');
        const toResolve = entries.find(e => e.signature === 'open-b')!;
        run(['resolve', '--branch', 'feat-x', '--id', toResolve.id!, '--how', 'fixed'], cwd);

        const open = JSON.parse(run(['list', '--branch', 'feat-x', '--deferred-open'], cwd));
        expect(open).toHaveLength(1);
        expect(open[0].signature).toBe('open-a');
        expect(listDeferredOpen(cwd, 'feat-x')).toEqual([
            expect.objectContaining({ signature: 'open-a', deferred: expect.any(Object) }),
        ]);
        expect(listDeferredOpen(cwd, 'feat-x')[0].resolved).toBeUndefined();
    });

    test('resolve --id unknown exits non-zero', () => {
        addDeferred(cwd, 'sig', 'round-ceiling', 'exists but wrong id target');
        expect(() => run(['resolve', '--branch', 'feat-x', '--id', 'no-such-id', '--how', 'fixed'], cwd))
            .toThrow(/unknown|not found|no entry/i);
    });

    test('double-resolve same id errors', () => {
        addDeferred(cwd, 'sig', 'round-ceiling', 'resolve once then again');
        const id = listEntries(cwd, 'feat-x')[0].id!;
        run(['resolve', '--branch', 'feat-x', '--id', id, '--how', 'fixed'], cwd);
        expect(() => run(['resolve', '--branch', 'feat-x', '--id', id, '--how', 'accepted'], cwd))
            .toThrow(/already resolved|double|resolved/i);
    });

    test('--all-with-signature resolves every deferred-open sharing a signature (explicit, not default)', () => {
        addDeferred(cwd, 'shared', 'round-ceiling', 'first of shared signature');
        addDeferred(cwd, 'shared', 're-review-defer', 'second of shared signature');
        addDeferred(cwd, 'other', 'round-ceiling', 'different signature stays open');

        run(['resolve', '--branch', 'feat-x', '--all-with-signature', 'shared', '--how', 'accepted'], cwd);

        const entries = listEntries(cwd, 'feat-x');
        expect(entries.filter(e => e.signature === 'shared').every(e => e.resolved?.how === 'accepted')).toBe(true);
        expect(entries.find(e => e.signature === 'other')!.resolved).toBeUndefined();
        expect(listDeferredOpen(cwd, 'feat-x')).toEqual([
            expect.objectContaining({ signature: 'other' }),
        ]);
    });

    test('resolve by signature alone is not a silent multi-resolve path', () => {
        addDeferred(cwd, 'shared', 'round-ceiling', 'first of shared signature');
        addDeferred(cwd, 'shared', 're-review-defer', 'second of shared signature');
        // No --id and no --all-with-signature: must fail closed, not pick one / resolve all.
        expect(() => run(['resolve', '--branch', 'feat-x', '--how', 'fixed'], cwd))
            .toThrow(/--id|--all-with-signature/i);
        expect(listDeferredOpen(cwd, 'feat-x')).toHaveLength(2);
    });
});
