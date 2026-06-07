import fs from 'fs';
import os from 'os';
import path from 'path';
import { addEntry, listEntries, ledgerPath, detectBranch, recurring, archiveLedger } from '../../../src/core/ledger/store';
import type { LedgerEntry } from '../../../src/core/ledger/types';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ledger-'));
}

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        ts: '2026-06-06T00:00:00.000Z',
        branch: 'feat-x',
        phase: 'post-qa',
        source_skill: 'post-implementation-qa',
        polarity: 'finding',
        class: 'logica',
        signature: 'public-fn-returns-infinity',
        severity: 'blocker',
        desc: 'splitBill(100,0) returns Infinity',
        ref: 'src/split.ts:12',
        ...over,
    };
}

describe('ledger store — add/list', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('ledgerPath sanitizes branch slashes into the filename', () => {
        expect(ledgerPath(cwd, 'feature/foo')).toBe(path.join(cwd, '.awm', 'ledger', 'feature__foo.jsonl'));
    });

    test('addEntry creates .awm/ledger/ and appends one jsonl line', () => {
        addEntry(cwd, entry());
        const raw = fs.readFileSync(ledgerPath(cwd, 'feat-x'), 'utf-8');
        expect(raw.trim().split('\n')).toHaveLength(1);
        expect(JSON.parse(raw.trim())).toMatchObject({ signature: 'public-fn-returns-infinity', polarity: 'finding' });
    });

    test('addEntry appends without clobbering prior entries', () => {
        addEntry(cwd, entry());
        addEntry(cwd, entry({ signature: 'second', desc: 'another' }));
        expect(listEntries(cwd, 'feat-x')).toHaveLength(2);
    });

    test('listEntries on a branch with no ledger returns []', () => {
        expect(listEntries(cwd, 'never-touched')).toEqual([]);
    });

    test('listEntries skips a malformed line without throwing', () => {
        const p = ledgerPath(cwd, 'feat-x');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(entry()) + '\n' + 'NOT JSON\n' + JSON.stringify(entry({ signature: 's2' })) + '\n');
        const got = listEntries(cwd, 'feat-x');
        expect(got).toHaveLength(2);
        expect(got.map(e => e.signature)).toEqual(['public-fn-returns-infinity', 's2']);
    });
});

describe('ledger store — detectBranch', () => {
    test('falls back to _no-branch outside a git repo', () => {
        const tmp = mkTmp();
        try {
            expect(detectBranch(tmp)).toBe('_no-branch');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    test('returns the current branch name from an actual git repo', () => {
        const { execSync: exec } = require('child_process');
        const tmp = mkTmp();
        try {
            exec('git init && git commit --allow-empty -m init && git checkout -b test-ledger-branch', { cwd: tmp, stdio: 'ignore' });
            expect(detectBranch(tmp)).toBe('test-ledger-branch');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});

describe('ledger store — recurring', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('groups by signature and reports clusters with count >= min', () => {
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'solo' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ signature: 'dup', count: 2 });
        expect(clusters[0].entries).toHaveLength(2);
    });

    test('respects --min: count 2 is excluded when min is 3', () => {
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        expect(recurring(cwd, 'feat-x', 3)).toEqual([]);
    });

    test('sorts clusters by count descending', () => {
        addEntry(cwd, entry({ signature: 'a' }));
        addEntry(cwd, entry({ signature: 'a' }));
        addEntry(cwd, entry({ signature: 'b' }));
        addEntry(cwd, entry({ signature: 'b' }));
        addEntry(cwd, entry({ signature: 'b' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters.map(c => c.signature)).toEqual(['b', 'a']);
    });
});

describe('ledger store — archive', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('moves the branch ledger into archive/ and leaves no active ledger', () => {
        addEntry(cwd, entry());
        const moved = archiveLedger(cwd, 'feat-x', '20260606T000000');
        expect(moved).toBe(true);
        expect(fs.existsSync(ledgerPath(cwd, 'feat-x'))).toBe(false);
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger', 'archive', 'feat-x-20260606T000000.jsonl'))).toBe(true);
    });

    test('archiving a non-existent ledger is a no-op returning false', () => {
        expect(archiveLedger(cwd, 'feat-x', '20260606T000000')).toBe(false);
    });
});
