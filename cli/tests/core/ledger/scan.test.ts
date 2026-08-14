import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanProjectLedgers } from '../../../src/core/ledger/scan';
import type { LedgerEntry } from '../../../src/core/ledger/types';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ledger-scan-'));
}

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        ts: '2026-08-14T00:00:00.000Z', branch: 'feat-x', phase: 'qa', source_skill: 'post-implementation-qa',
        polarity: 'finding', class: 'logica', signature: 'lint-error', severity: 'important', desc: 'private detail',
        defectClass: 'lint-errors', ...over,
    };
}

function write(root: string, relative: string, lines: unknown[]): void {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
}

describe('scanProjectLedgers', () => {
    let root: string;
    beforeEach(() => { root = mkTmp(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    test('reads only direct active and archive files in deterministic path and line order', () => {
        write(root, '.awm/ledger/z.jsonl', [entry({ signature: 'z' })]);
        write(root, '.awm/ledger/a.jsonl', [entry({ signature: 'a' })]);
        write(root, '.awm/ledger/archive/b.jsonl', [entry({ signature: 'b' })]);
        write(root, '.awm/ledger/archive/nested/ignored.jsonl', [entry({ signature: 'ignored' })]);
        const scan = scanProjectLedgers(root);
        expect(scan.entries.map(item => item.source)).toEqual([
            '.awm/ledger/a.jsonl:1', '.awm/ledger/archive/b.jsonl:1', '.awm/ledger/z.jsonl:1',
        ]);
        expect(scan.sources).toMatchObject({ activeFiles: 2, archivedFiles: 1, validFindings: 3, skippedFindings: 0 });
    });

    test('orders direct active and archive sources together by their relative path', () => {
        write(root, '.awm/ledger/b.jsonl', [entry({ signature: 'active-b' })]);
        write(root, '.awm/ledger/archive/a.jsonl', [entry({ signature: 'archive-a' })]);

        const scan = scanProjectLedgers(root);

        expect(scan.entries.map(item => item.source)).toEqual([
            '.awm/ledger/archive/a.jsonl:1', '.awm/ledger/b.jsonl:1',
        ]);
    });

    test('counts wins as valid but excludes them from findings', () => {
        write(root, '.awm/ledger/a.jsonl', [entry({ polarity: 'win' }), entry({ signature: 'finding' })]);
        const scan = scanProjectLedgers(root);
        expect(scan.entries.map(item => item.entry.signature)).toEqual(['finding']);
        expect(scan.sources).toMatchObject({ validEntries: 2, validFindings: 1 });
    });

    test.each([
        ['invalid JSON', 'invalid-json', ['{not-json'], {}],
        ['invalid persisted class', 'invalid-defect-class', [{ ...entry(), defectClass: 'Bad_ID' }], {}],
        ['oversized line', 'line-too-large', [JSON.stringify(entry()) + 'x'.repeat(100)], { maxLineBytes: 64 }],
    ])('reports %s as a typed skipped finding', (_name, reason, lines, limits) => {
        write(root, '.awm/ledger/a.jsonl', lines);
        const scan = scanProjectLedgers(root, limits);
        expect(scan.sources.skippedFindings).toBe(1);
        expect(scan.sources.skippedByReason).toMatchObject({ [reason]: 1 });
    });

    test('rejects a symlink without reading its target', () => {
        const outside = path.join(root, 'outside.jsonl');
        fs.writeFileSync(outside, JSON.stringify(entry()));
        const ledger = path.join(root, '.awm', 'ledger');
        fs.mkdirSync(ledger, { recursive: true });
        fs.symlinkSync(outside, path.join(ledger, 'linked.jsonl'));
        const scan = scanProjectLedgers(root);
        expect(scan.entries).toEqual([]);
        expect(scan.sources.skippedByReason).toMatchObject({ 'symlink-entry': 1 });
    });

    test('records direct non-regular entries and never descends into them', () => {
        fs.mkdirSync(path.join(root, '.awm', 'ledger', 'directory.jsonl'), { recursive: true });
        write(root, '.awm/ledger/directory.jsonl/hidden.jsonl', [entry({ signature: 'hidden' })]);
        const scan = scanProjectLedgers(root);
        expect(scan.entries).toEqual([]);
        expect(scan.sources.skippedByReason).toMatchObject({ 'nonregular-entry': 1 });
    });

    test('reports file and entry limits once without reading candidates beyond the bound', () => {
        write(root, '.awm/ledger/a.jsonl', [entry({ signature: 'a' })]);
        write(root, '.awm/ledger/b.jsonl', [entry({ signature: 'b' })]);
        const files = scanProjectLedgers(root, { maxFiles: 1 });
        expect(files.entries.map(item => item.entry.signature)).toEqual(['a']);
        expect(files.sources.skippedByReason).toMatchObject({ 'file-limit': 1 });

        write(root, '.awm/ledger/entries.jsonl', [entry({ signature: 'first' }), entry({ signature: 'second' })]);
        const entries = scanProjectLedgers(root, { maxEntries: 1, maxFiles: 10 });
        expect(entries.entries).toHaveLength(1);
        expect(entries.sources.skippedByReason).toMatchObject({ 'entry-limit': 1 });
    });

    test('reports a too-large file without parsing it', () => {
        write(root, '.awm/ledger/a.jsonl', [entry()]);
        const scan = scanProjectLedgers(root, { maxFileBytes: 1 });
        expect(scan.entries).toEqual([]);
        expect(scan.sources.skippedByReason).toMatchObject({ 'file-too-large': 1 });
    });

    test('reports over-deep JSON before parsing it', () => {
        write(root, '.awm/ledger/a.jsonl', ['{"x":{"x":{"x":{"x":{"x":1}}}}}']);
        const scan = scanProjectLedgers(root, { maxJsonDepth: 3 });
        expect(scan.entries).toEqual([]);
        expect(scan.sources.skippedByReason).toMatchObject({ 'json-too-deep': 1 });
    });

    test('keeps every finding for analysis while bounding renderable references per defect class', () => {
        write(root, '.awm/ledger/a.jsonl', [
            entry({ signature: 'first', defectClass: 'lint-errors' }),
            entry({ signature: 'second', defectClass: 'lint-errors' }),
            entry({ signature: 'other', defectClass: 'static-type-errors' }),
        ]);
        const scan = scanProjectLedgers(root, { maxRefsPerClass: 1 });
        expect(scan.entries.map(item => item.entry.signature)).toEqual(['first', 'second', 'other']);
        expect(scan.entries.map(item => item.evidenceRef)).toEqual([
            '.awm/ledger/a.jsonl:1', null, '.awm/ledger/a.jsonl:3',
        ]);
        expect(scan.omittedEvidenceRefs).toBe(1);
        expect(scan.sources).toMatchObject({
            validFindings: 3,
            skippedFindings: 1,
            skippedByReason: { 'evidence-ref-limit': 1 },
        });
    });

    test('rejects non-object limit overrides instead of accepting an impossible public input', () => {
        expect(() => scanProjectLedgers(root, null as unknown as Record<string, number>)).toThrow(/limits.*object/i);
    });
});
