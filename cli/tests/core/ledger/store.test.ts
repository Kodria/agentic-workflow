import fs from 'fs';
import os from 'os';
import path from 'path';
import { addEntry, listEntries, ledgerPath, detectBranch, recurring, archiveLedger } from '../../../src/core/ledger/store';
import { parseLedgerEntry } from '../../../src/core/ledger/types';
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

    test.each(['..\\outside', 'feature\\..\\outside'])
    ('rejects a Windows path-traversal branch %p before it can escape the ledger directory', (branch) => {
        // On Windows, a backslash is a separator even when this test suite runs on POSIX.
        // Keep the regression explicit so future path changes cannot reintroduce the escape.
        expect(branch.split(path.win32.sep)).toContain('..');

        expect(() => ledgerPath(cwd, branch)).toThrow(/invalid ledger branch/i);
        expect(() => addEntry(cwd, entry({ branch }))).toThrow(/invalid ledger branch/i);
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger'))).toBe(false);
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

    test('persists an optional reusable defect class', () => {
        addEntry(cwd, entry({ defectClass: 'lint-errors' }));
        expect(JSON.parse(fs.readFileSync(ledgerPath(cwd, 'feat-x'), 'utf-8'))).toMatchObject({ defectClass: 'lint-errors' });
    });

    test('rejects an invalid direct entry before it can cross the durable boundary', () => {
        expect(() => addEntry(cwd, { ...entry(), defectClass: 'Bad_ID' })).toThrow(/invalid-defect-class/i);
        expect(fs.existsSync(ledgerPath(cwd, 'feat-x'))).toBe(false);
    });

    test('keeps a legacy entry without defectClass valid and unclassified', () => {
        const parsed = parseLedgerEntry(entry(), 'line 1');
        expect(parsed).toMatchObject({ ok: true, entry: { defectClass: undefined } });
    });

    test.each(['', 'Bad_ID', '../escape', 'a b', '-leading', 'trailing-'])
    ('skips a persisted invalid defect class %p', (defectClass) => {
        const parsed = parseLedgerEntry({ ...entry(), defectClass }, 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-defect-class' });
    });

    test('rejects a non-string durable source instead of returning an unsafe parse result', () => {
        expect(() => parseLedgerEntry(entry(), null as unknown as string)).toThrow(/source.*string/i);
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

    test('listEntries skips a shape-invalid (but syntactically valid) entry without throwing', () => {
        const p = ledgerPath(cwd, 'feat-x');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const missingDesc = JSON.stringify({ ts: 't', branch: 'feat-x', phase: 'p', source_skill: 's', polarity: 'finding', class: 'logica', signature: 'missing-desc', severity: 'minor', ref: 'a.ts:1' });
        const nullDesc = JSON.stringify({ ...entry(), desc: null });
        const numericSignature = JSON.stringify({ ...entry(), signature: 42 });
        fs.writeFileSync(p, [missingDesc, nullDesc, numericSignature, JSON.stringify(entry({ signature: 's2' }))].join('\n') + '\n');
        const got = listEntries(cwd, 'feat-x');
        expect(got).toHaveLength(1);
        expect(got[0].signature).toBe('s2');
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
            exec('git init && git -c user.email=test@test.com -c user.name=Test commit --allow-empty -m init && git checkout -b test-ledger-branch', { cwd: tmp, stdio: 'ignore' });
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

    test('groups by signature and reports clusters with count >= min', () => {  // verifies R1.1
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'solo', ref: 'src/other.ts:3', desc: 'pagination cursor skips a page' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ signature: 'dup', count: 2, kind: 'exact' });
        expect(clusters[0].entries).toHaveLength(2);
    });

    test('respects --min: count 2 is excluded when min is 3', () => {  // verifies R1.1
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        expect(recurring(cwd, 'feat-x', 3)).toEqual([]);
    });

    test('sorts clusters by count descending', () => {  // verifies R1.9
        addEntry(cwd, entry({ signature: 'a', ref: 'src/a.ts:1', desc: 'alpha slug mismatch' }));
        addEntry(cwd, entry({ signature: 'a', ref: 'src/a.ts:1', desc: 'alpha slug mismatch' }));
        addEntry(cwd, entry({ signature: 'b', ref: 'src/b.ts:1', desc: 'beta timeout on retry' }));
        addEntry(cwd, entry({ signature: 'b', ref: 'src/b.ts:1', desc: 'beta timeout on retry' }));
        addEntry(cwd, entry({ signature: 'b', ref: 'src/b.ts:1', desc: 'beta timeout on retry' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters.map(c => c.signature)).toEqual(['b', 'a']);
    });

    test('reports independent lenses on one file as a single convergent cluster', () => {  // verifies R1.2, R1.5
        addEntry(cwd, entry({
            signature: 'validator-scope-skills-only',
            desc: 'validator scope covers skills only',
            ref: 'scripts/validate-portability.mjs:41',
        }));
        addEntry(cwd, entry({
            signature: 'gate-walks-skills-only',
            desc: 'the gate walks skills and nothing else',
            ref: 'scripts/validate-portability.mjs:58',
        }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ count: 2, kind: 'convergent' });
        expect(clusters[0].signatures).toEqual(['gate-walks-skills-only', 'validator-scope-skills-only']);
    });

    test('recurring does not crash on a shape-invalid entry mixed into an otherwise valid ledger', () => {
        addEntry(cwd, entry({ signature: 'dup', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }));
        addEntry(cwd, entry({ signature: 'dup', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }));
        const p = ledgerPath(cwd, 'feat-x');
        fs.appendFileSync(p, JSON.stringify({ ts: 't', branch: 'feat-x', phase: 'p', source_skill: 's', polarity: 'finding', class: 'logica', signature: 'no-desc', severity: 'minor', ref: 'b.ts:1' }) + '\n');
        expect(() => recurring(cwd, 'feat-x', 2)).not.toThrow();
        expect(recurring(cwd, 'feat-x', 2)).toEqual([expect.objectContaining({ signature: 'dup', count: 2 })]);
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

    test('refuses to overwrite an existing archive and preserves both ledger files', () => {
        addEntry(cwd, entry({ signature: 'active-evidence' }));
        const archivePath = path.join(cwd, '.awm', 'ledger', 'archive', 'feat-x-20260606T000000.jsonl');
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        fs.writeFileSync(archivePath, JSON.stringify(entry({ signature: 'archived-evidence' })) + '\n');

        expect(() => archiveLedger(cwd, 'feat-x', '20260606T000000')).toThrow(/archive.*already exists/i);
        expect(listEntries(cwd, 'feat-x')).toEqual([expect.objectContaining({ signature: 'active-evidence' })]);
        expect(fs.readFileSync(archivePath, 'utf-8')).toContain('archived-evidence');
    });

    test('refuses a dangling symlink archive destination and preserves the active ledger', () => {
        addEntry(cwd, entry({ signature: 'active-evidence' }));
        const archivePath = path.join(cwd, '.awm', 'ledger', 'archive', 'feat-x-20260606T000000.jsonl');
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        try {
            fs.symlinkSync(path.join(cwd, 'missing-target.jsonl'), archivePath);
        } catch (error) {
            if (process.platform === 'win32') return;
            throw error;
        }

        expect(() => archiveLedger(cwd, 'feat-x', '20260606T000000')).toThrow(/archive.*already exists/i);
        expect(fs.lstatSync(archivePath).isSymbolicLink()).toBe(true);
        expect(listEntries(cwd, 'feat-x')).toEqual([expect.objectContaining({ signature: 'active-evidence' })]);
    });

    test('rejects a symlinked archive directory without moving the active ledger outside the project', () => {
        addEntry(cwd, entry({ signature: 'active-evidence' }));
        const archive = path.join(cwd, '.awm', 'ledger', 'archive');
        const outside = path.join(cwd, 'outside');
        fs.mkdirSync(outside, { recursive: true });
        try {
            fs.symlinkSync(outside, archive, 'dir');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
        }

        expect(() => archiveLedger(cwd, 'feat-x', '20260606T000000')).toThrow(/unsafe|escape|symlink/i);
        expect(listEntries(cwd, 'feat-x')).toEqual([expect.objectContaining({ signature: 'active-evidence' })]);
        expect(fs.readdirSync(outside)).toEqual([]);
    });

    test('rejects a symlinked source ledger and preserves the link target', () => {
        const outside = path.join(cwd, 'outside.jsonl');
        fs.writeFileSync(outside, JSON.stringify(entry({ signature: 'outside-evidence' })) + '\n');
        const source = ledgerPath(cwd, 'feat-x');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        try {
            fs.symlinkSync(outside, source);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
        }

        expect(() => archiveLedger(cwd, 'feat-x', '20260606T000000')).toThrow(/unsafe|escape|symlink/i);
        expect(fs.lstatSync(source).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(outside, 'utf-8')).toContain('outside-evidence');
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger', 'archive', 'feat-x-20260606T000000.jsonl'))).toBe(false);
    });

    test.each(['', '.', '..', '../outside', '/tmp/outside', 'C:\\temp\\outside'])
    ('rejects an unsafe archive label %p before touching a ledger', (label) => {
        expect(() => archiveLedger(cwd, 'feat-x', label)).toThrow(/invalid ledger label/i);
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger'))).toBe(false);
    });

    test.each(['safe/child', 'safe\\child'])
    ('rejects an archive label with a separator %p before it can create ledger files', (label) => {
        expect(() => archiveLedger(cwd, 'feat-x', label)).toThrow(/invalid ledger label/i);
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger'))).toBe(false);
        expect(fs.existsSync(ledgerPath(cwd, 'feat-x'))).toBe(false);
    });

    test('rejects a Windows traversal archive label before it can create an escaped file', () => {
        const label = '..\\outside';
        const archiveRoot = path.win32.join('C:\\project', '.awm', 'ledger', 'archive');
        const escaped = path.win32.resolve(archiveRoot, label);
        addEntry(cwd, entry());

        expect(escaped.startsWith(`${archiveRoot}\\`)).toBe(false);
        expect(() => archiveLedger(cwd, 'feat-x', label)).toThrow(/invalid ledger label/i);
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger', 'archive'))).toBe(false);
        expect(fs.existsSync(path.join(cwd, 'outside.jsonl'))).toBe(false);
        expect(fs.existsSync(ledgerPath(cwd, 'feat-x'))).toBe(true);
    });
});
