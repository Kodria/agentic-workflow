import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LINEAR_TIME_BOUND_MS, bad, commitForgedSigned, makeRepo, posixOnly, showSignaturesInLog, spyOnGit, withEnv, type TestRepo } from './helpers';
import { NOW, SINCE_48H, commitLiterally, record, recordPath } from './list-fixtures';
import { resolveBase } from '../../../src/core/changes/git';
import { resolveRange } from '../../../src/core/changes/range';
import { pathToFileURL } from 'url';
import { DEFAULT_LIMIT, MAX_RECORDS_PER_ENTRY, MAX_SUBJECT, listChanges, parseSince, type ListOutcome, type ListResult } from '../../../src/core/changes/list';
import { MAX_RECORD_BYTES } from '../../../src/core/changes/types';

let repo: TestRepo;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => { jest.restoreAllMocks(); repo.cleanup(); });

const list = (opts: Record<string, unknown> = {}): ListOutcome => listChanges(repo.root, { since: SINCE_48H, ...opts } as never);
function ok(outcome: ListOutcome): ListResult {
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.failure.code}: ${outcome.failure.message}`);
    return outcome.result;
}
const listed = (opts: Record<string, unknown> = {}): ListResult => ok(list(opts));
const subjects = (r: ListResult): string[] => r.changes.map((c) => c.subject);
const byClass = (r: ListResult): Record<string, string> => Object.fromEntries(r.changes.map((c) => [c.subject, c.classification]));
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** The commit that opens the adoption point, before the 48h window. */
function adopt(id = '2026-10-10-adopt'): string {
    return repo.commit({ [recordPath(id)]: record(id, { summary: 'Adopcion.' }) }, 'feat: adopt', '2026-10-10T00:00:00Z');
}
const FIRST = '2026-10-16-first';
function history(): void {
    repo.commit({ 'old.ts': '1' }, 'feat: before adoption', '2026-10-16T09:00:00Z');
    repo.commit({ [recordPath(FIRST)]: record(FIRST), 'a.ts': '1' }, 'feat: first (#10)', '2026-10-16T20:00:00Z');
    repo.commit({ 'b.ts': '1' }, 'fix: no record', '2026-10-16T21:00:00Z');
    repo.commit({ 'c.ts': '1' }, 'chore(release): v1.0.0 [skip ci]\n\nChange-Record: none', '2026-10-16T22:00:00Z');
    repo.commit({ [recordPath('2026-10-17-bad')]: '---\nschema: nope\n---\n' }, 'feat: bad record', '2026-10-17T01:00:00Z');
    repo.gitAt('2026-10-17T02:00:00Z', 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
}

describe('parseSince (R5.2)', () => {
    test.each([
        ['24h', '2026-10-16T12:00:00.000Z'],
        ['7d', '2026-10-10T12:00:00.000Z'],
        ['1h', '2026-10-17T11:00:00.000Z'],
        ['3650d', '2016-10-19T12:00:00.000Z'],
        ['87600h', '2016-10-19T12:00:00.000Z'],
        ['3651d', '2016-10-18T12:00:00.000Z'],
        ['87601h', '2016-10-19T11:00:00.000Z'],
        ['99999d', '1753-01-02T12:00:00.000Z'],
        ['12345h', '2025-05-21T03:00:00.000Z'],
        ['2026-10-01', '2026-10-01T00:00:00.000Z'],
        ['2026-02-28', '2026-02-28T00:00:00.000Z'],
        ['2028-02-29', '2028-02-29T00:00:00.000Z'],
    ])('accepts %s', (value, iso) => {
        expect(parseSince(value, NOW)?.toISOString()).toBe(iso);
    });
    test.each(['', '0h', '0d', '00d', '-1h', '+1h', '1.5h', '24', 'h', '24x', '24H', '24 h', ' 24h', '24h ', '24h\n', '1234567890h', '1234567890d', '0000000000h', '999999999d',
        '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '2026-10-1', '2026-10-01T00:00:00Z', '2026-10-01 ', 'soon', 'now', '\u0661\u0662h', '1e3h', '0x10h',
        ])('rejects %j', (value) => {
        expect(parseSince(value, NOW)).toBeNull();
    });
    test('a count of 9 digits is valid while the resulting instant is a valid date', () => {
        expect(parseSince('999999999h', NOW)).toBeInstanceOf(Date);
        expect(parseSince('100000000d', NOW)).toBeInstanceOf(Date);
        expect(parseSince('999999999d', NOW)).toBeNull();
    });
    test('rejects a very long text without scanning it more than once', () => {
        const start = Date.now();
        expect(parseSince(`${'9'.repeat(1_000_000)}h`, NOW)).toBeNull();
        expect(parseSince('x'.repeat(1_000_000), NOW)).toBeNull();
        expect(Date.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
    });
    test.each([undefined, null, 24, {}, [], true])('rejects the non-string %j without throwing', (value) => {
        expect(parseSince(bad(value), NOW)).toBeNull();
    });
    test.each([undefined, null, 'x', 5, new Date(Number.NaN), {}])('rejects the unusable clock %j', (clock) => {
        expect(parseSince('24h', bad(clock))).toBeNull();
    });
});

describe('listChanges: input and base (R5.1, R3.1, R3.2, R3.5)', () => {
    test('resolves the local main by default and reports it', () => {
        adopt();
        expect(listed().base).toBe('main');
    });
    test('an explicit base is used and reported', () => {
        adopt();
        repo.git('branch', 'trunk');
        expect(listed({ base: 'trunk' }).base).toBe('trunk');
    });
    test('an explicit base that does not resolve is base-unresolved', () => {
        expect(list({ base: 'nope' })).toMatchObject({ ok: false, failure: { code: 'base-unresolved' } });
    });
    test('no resolvable default base is base-unresolved with the remedy', () => {
        repo.git('branch', '-m', 'trunk');
        expect(list()).toMatchObject({ ok: false, failure: { code: 'base-unresolved', remedy: 'pass --base <ref>' } });
    });
    test.each(['--upload-pack=x', '-x', 'a..b', 'a...b', 'main^', 'main~1', 'main@{1}', 'a b', 'main\n', ':/x', '', 'x'.repeat(300)])('an unsafe base %j is invalid-input and never reaches git', (base) => {
        const spy = spyOnGit();
        const outcome = list({ base });
        spy.restore();
        expect(outcome).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
        expect(spy.calls).toEqual([]);
    });
    test('an unsafe base is echoed escaped and clipped, never raw', () => {
        const outcome = list({ base: `-x\u001b[31m${'y'.repeat(500)}` });
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            expect(outcome.failure.message).not.toMatch(UNSAFE);
            expect(outcome.failure.message.length).toBeLessThan(300);
        }
    });
    test.each([undefined, null, 5, {}, ''])('the repository root %j is invalid-input', (root) => {
        expect(listChanges(bad(root), { since: SINCE_48H })).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
    });
    test.each([undefined, null, 'x', 5, new Date(Number.NaN)])('the window start %j is invalid-input', (since) => {
        expect(listChanges(repo.root, bad({ since }))).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
    });
    test('options that are not an object are invalid-input', () => {
        expect(listChanges(repo.root, bad(undefined))).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
    });
    test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null])('the limit %j is invalid-input', (limit) => {
        expect(list({ limit })).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
    });
    test.each([['maxRecordsPerEntry', 0], ['maxRecords', -3], ['maxRecords', 1.5]])('%s %j is invalid-input', (key, value) => {
        expect(list({ [key]: value })).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
    });
    test('a directory that is not a repository is git-failed, not a throw', () => {
        const plain = fs.mkdtempSync(path.join(repo.home, 'plain-'));
        expect(listChanges(plain, { since: SINCE_48H })).toMatchObject({ ok: false });
    });
    test('does not need a clean tree or HEAD on the base: it reads the base ref, not HEAD or the working tree', () => {
        history();
        repo.git('checkout', '-q', '-b', 'feat/x');
        repo.commit({ 'x.ts': '1' }, 'feat: only on the branch', '2026-10-17T05:00:00Z');
        fs.writeFileSync(path.join(repo.root, recordPath(FIRST)), 'garbage in the working tree');
        fs.writeFileSync(path.join(repo.root, 'untracked.txt'), 'u');
        const r = listed();
        expect(subjects(r)).toEqual(['feat: bad record', 'chore(release): v1.0.0 [skip ci]', 'fix: no record', 'feat: first (#10)']);
        expect(r.changes.find((c) => c.subject === 'feat: first (#10)')?.classification).toBe('recorded');
    });
    test('a base that moves during the run cannot change the answer: every git call after the pin uses commit ids', () => {
        history();
        const spy = spyOnGit();
        listed();
        spy.restore();
        const afterPin = spy.calls.filter((a) => a.includes('log') || a.includes('diff') || a.includes('ls-tree') || a.includes('for-each-ref'));
        expect(afterPin.length).toBeGreaterThan(0);
        for (const call of afterPin) expect(call).not.toContain('main');
    });
});

describe('listChanges: adoption point (R5.4)', () => {
    test('a repo where no file was ever added under docs/changes is not adopted and lists nothing', () => {
        repo.commit({ 'a.ts': '1' }, 'feat: a', '2026-10-16T09:00:00Z');
        expect(listed()).toMatchObject({ adopted: false, changes: [], truncated: false, omitted: 0 });
    });
    test('any file added under docs/changes marks the adoption, even one that is not a record', () => {
        repo.commit({ 'docs/changes/README.md': 'hello' }, 'docs: readme', '2026-10-16T09:00:00Z');
        repo.commit({ 'a.ts': '1' }, 'feat: a', '2026-10-16T10:00:00Z');
        const r = listed();
        expect(r.adopted).toBe(true);
        expect(byClass(r)).toEqual({ 'feat: a': 'missing', 'docs: readme': 'missing' });
    });
    test('a record that was added and later deleted still marks the adoption', () => {
        adopt();
        repo.git('rm', '-q', recordPath('2026-10-10-adopt'));
        repo.git('commit', '-q', '-m', 'chore: drop');
        expect(listed().adopted).toBe(true);
    });
    test('commits older than the first one that added a file under docs/changes are omitted; the adopting commit itself is kept', () => {
        history();
        expect(subjects(listed())).not.toContain('feat: before adoption');
        expect(subjects(listed())).not.toContain('chore: init');
        expect(subjects(listed())).toContain('feat: first (#10)');
    });
    test('modifying a file under docs/changes is not an adoption: only the commit that added the first file is', () => {
        repo.commit({ 'a.ts': '1' }, 'feat: before', '2026-10-16T09:00:00Z');
        repo.commit({ 'docs/changes/x.txt': '1' }, 'docs: first file', '2026-10-16T10:00:00Z');
        repo.commit({ 'docs/changes/x.txt': '2' }, 'docs: edit', '2026-10-16T11:00:00Z');
        expect(subjects(listed())).toEqual(['docs: edit', 'docs: first file']);
    });
    test('an adopted repo whose window holds no commit lists nothing', () => {
        adopt();
        expect(listed()).toMatchObject({ adopted: true, changes: [], truncated: false, omitted: 0 });
    });
    test('the adoption can be a root commit', () => {
        repo.git('checkout', '-q', '--orphan', 'orph');
        repo.git('rm', '-rfq', '.');
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: root record', '2026-10-16T20:00:00Z');
        repo.commit({ 'z.ts': '1' }, 'fix: after root', '2026-10-16T21:00:00Z');
        const r = listed({ base: 'orph' });
        expect(byClass(r)).toEqual({ 'fix: after root': 'missing', 'feat: root record': 'recorded' });
        expect(r.changes[1].records[0]).toMatchObject({ path: recordPath(FIRST), id: FIRST });
    });
    test('the adoption is decided on the first-parent history: a record merged in from a side branch adopts at the merge', () => {
        repo.commit({ 'm0.ts': '1' }, 'feat: before merge', '2026-10-16T08:00:00Z');
        repo.git('checkout', '-q', '-b', 'side');
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: side work', '2026-10-16T09:00:00Z');
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'm1.ts': '1' }, 'fix: main work', '2026-10-16T10:00:00Z');
        repo.gitAt('2026-10-16T11:00:00Z', 'merge', '--no-ff', '-q', 'side', '-m', 'Merge side (#7)');
        const r = listed();
        expect(subjects(r)).toEqual(['Merge side (#7)']);
        expect(r.changes[0]).toMatchObject({ classification: 'recorded', pr: 7 });
        expect(r.changes[0].records[0]).toMatchObject({ path: recordPath(FIRST) });
    });
});

describe('listChanges: classification (R5.3)', () => {
    test('recorded, missing, exempt and invalid-record', () => {
        history();
        expect(byClass(listed())).toEqual({ 'feat: first (#10)': 'recorded', 'fix: no record': 'missing', 'chore(release): v1.0.0 [skip ci]': 'exempt', 'feat: bad record': 'invalid-record' });
    });
    test('entries come newest first, in first-parent order', () => {
        history();
        expect(subjects(listed())).toEqual(['feat: bad record', 'chore(release): v1.0.0 [skip ci]', 'fix: no record', 'feat: first (#10)']);
    });
    test('a recorded entry holds the path and the full frontmatter, nothing else', () => {
        history();
        const first = listed().changes.find((c) => c.subject === 'feat: first (#10)');
        expect(first?.records).toHaveLength(1);
        expect(first?.records[0]).toMatchObject({ path: recordPath(FIRST), schema: 'awm.change-record/v1', id: FIRST, title: `T ${FIRST}`, summary_short: 'Primer cambio.', type: 'feat', modules: ['cli'] });
        expect(first?.records[0]).not.toHaveProperty('diagnostics');
        expect(first?.records[0]).toHaveProperty('verification.overall', 'pass');
    });
    test('an invalid-record entry holds the path and its diagnostics, no frontmatter', () => {
        history();
        const bad = listed().changes.find((c) => c.subject === 'feat: bad record');
        expect(bad?.records).toHaveLength(1);
        expect(bad?.records[0]).toMatchObject({ path: recordPath('2026-10-17-bad') });
        expect(bad?.records[0]).not.toHaveProperty('schema');
        expect((bad?.records[0] as { diagnostics: Array<{ code: string }> }).diagnostics.map((d) => d.code)).toContain('body-section-missing');
    });
    test('exempt and missing entries have no records', () => {
        history();
        const r = listed();
        expect(r.changes.find((c) => c.classification === 'exempt')?.records).toEqual([]);
        expect(r.changes.find((c) => c.classification === 'missing')?.records).toEqual([]);
    });
    test('a record plus the opt-out trailer is recorded: the first matching rule wins', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: both\n\nChange-Record: none', '2026-10-16T20:00:00Z');
        expect(byClass(listed())['feat: both']).toBe('recorded');
    });
    test('an invalid record plus the opt-out trailer is invalid-record, not exempt', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: 'nope' }, 'feat: both\n\nChange-Record: none', '2026-10-16T20:00:00Z');
        expect(byClass(listed())['feat: both']).toBe('invalid-record');
    });
    test('the opt-out must be a trailer of the final paragraph: a mention in the subject or the body does not exempt', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'feat: Change-Record: none', '2026-10-16T20:00:00Z');
        repo.commit({ 'b.ts': '1' }, 'feat: b\n\nChange-Record: none\n\nand more text', '2026-10-16T21:00:00Z');
        expect(byClass(listed())).toEqual({ 'feat: Change-Record: none': 'missing', 'feat: b': 'missing' });
    });
    test('a commit adding two records, one of them invalid, is invalid-record and lists both', () => {
        adopt();
        repo.commit({ [recordPath('2026-10-16-good')]: record('2026-10-16-good'), [recordPath('2026-10-16-broken')]: record('2026-10-16-other') }, 'feat: two', '2026-10-16T20:00:00Z');
        const entry = listed().changes[0];
        expect(entry.classification).toBe('invalid-record');
        expect(entry.records.map((r) => r.path).sort()).toEqual([recordPath('2026-10-16-broken'), recordPath('2026-10-16-good')]);
        const diagnostics = Object.fromEntries(entry.records.map((r) => [r.path, (r as { diagnostics: unknown[] }).diagnostics.length]));
        expect(diagnostics[recordPath('2026-10-16-good')]).toBe(0);
        expect(diagnostics[recordPath('2026-10-16-broken')]).toBeGreaterThan(0);
        expect(entry.records.every((r) => !('schema' in r))).toBe(true);
    });
    test('a commit adding two valid records is recorded and lists both', () => {
        adopt();
        repo.commit({ [recordPath('2026-10-16-one')]: record('2026-10-16-one'), [recordPath('2026-10-16-two')]: record('2026-10-16-two') }, 'feat: two', '2026-10-16T20:00:00Z');
        const entry = listed().changes[0];
        expect(entry.classification).toBe('recorded');
        expect(entry.records).toHaveLength(2);
    });
    test('modifying an existing record is not adding one: the commit is missing', () => {
        adopt();
        repo.commit({ [recordPath('2026-10-10-adopt')]: record('2026-10-10-adopt', { summary: 'Edited.' }) }, 'fix: edit the record', '2026-10-16T20:00:00Z');
        expect(byClass(listed())['fix: edit the record']).toBe('missing');
    });
    test('renames are not followed: the new name of a renamed record is an added record', () => {
        adopt();
        repo.git('mv', recordPath('2026-10-10-adopt'), recordPath('2026-10-16-moved'));
        fs.writeFileSync(path.join(repo.root, recordPath('2026-10-16-moved')), record('2026-10-16-moved'));
        repo.git('add', '-A');
        repo.gitAt('2026-10-16T20:00:00Z', 'commit', '-q', '-m', 'refactor: rename the record');
        const entry = listed().changes[0];
        expect(entry.classification).toBe('recorded');
        expect(entry.records.map((r) => r.path)).toEqual([recordPath('2026-10-16-moved')]);
    });
    test.each([
        ['a README', 'docs/changes/README.md'],
        ['a file in a subdirectory', 'docs/changes/sub/2026-10-16-x.md'],
        ['a name that does not match the record pattern', 'docs/changes/2026-10-16-X.md'],
        ['a record outside the directory', 'docs/2026-10-16-x.md'],
        ['a lookalike directory', 'docs/changes2/2026-10-16-x.md'],
    ])('%s is not a record: the commit is missing', (_label, file) => {
        adopt();
        repo.commit({ [file]: record('2026-10-16-x') }, 'feat: not a record', '2026-10-16T20:00:00Z');
        expect(byClass(listed())['feat: not a record']).toBe('missing');
    });
    test('a name that matches the pattern but is not a valid date is invalid-record with name-invalid', () => {
        adopt();
        repo.commit({ [recordPath('2026-13-45-x')]: record('2026-13-45-x') }, 'feat: bad name', '2026-10-16T20:00:00Z');
        const entry = listed().changes[0];
        expect(entry.classification).toBe('invalid-record');
        expect((entry.records[0] as { diagnostics: Array<{ code: string }> }).diagnostics.map((d) => d.code)).toContain('name-invalid');
    });
    test('link files are not checked: a record whose links.plan does not exist is still recorded', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST, { extra: 'links:\n  plan: docs/plans/missing.md\n' }) }, 'feat: links', '2026-10-16T20:00:00Z');
        expect(byClass(listed())['feat: links']).toBe('recorded');
    });
    test('the record is read from history: deleting it later does not change the entry', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: first', '2026-10-16T20:00:00Z');
        repo.git('rm', '-q', recordPath(FIRST));
        repo.gitAt('2026-10-16T21:00:00Z', 'commit', '-q', '-m', 'chore: delete it');
        const r = listed();
        expect(byClass(r)).toEqual({ 'feat: first': 'recorded', 'chore: delete it': 'missing' });
    });
    test('the record is read from history, not the working tree', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST, { summary: 'Del historial.' }) }, 'feat: first', '2026-10-16T20:00:00Z');
        fs.writeFileSync(path.join(repo.root, recordPath(FIRST)), 'not a record any more');
        expect(listed().changes[0].records[0]).toMatchObject({ summary_short: 'Del historial.' });
    });
    test('a merge commit whose side branch adds the record is recorded; the side commits are not listed', () => {
        adopt();
        repo.git('checkout', '-q', '-b', 'side');
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: side work', '2026-10-16T09:00:00Z');
        repo.commit({ 's.ts': '1' }, 'fix: more side work', '2026-10-16T09:30:00Z');
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'm.ts': '1' }, 'fix: main work', '2026-10-16T10:00:00Z');
        repo.gitAt('2026-10-16T11:00:00Z', 'merge', '--no-ff', '-q', 'side', '-m', 'Merge side');
        const r = listed();
        expect(byClass(r)).toEqual({ 'Merge side': 'recorded', 'fix: main work': 'missing' });
    });
    test('an opt-out trailer only on a commit of the merged side branch exempts the merge commit', () => {
        adopt();
        repo.git('checkout', '-q', '-b', 'side');
        repo.commit({ 's.ts': '1' }, 'chore: side\n\nChange-Record: none', '2026-10-16T09:00:00Z');
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'm.ts': '1' }, 'fix: main work', '2026-10-16T10:00:00Z');
        repo.gitAt('2026-10-16T11:00:00Z', 'merge', '--no-ff', '-q', 'side', '-m', 'Merge side');
        expect(byClass(listed())).toEqual({ 'Merge side': 'exempt', 'fix: main work': 'missing' });
    });
    test('a merge commit whose side branch has no record and no opt-out is missing', () => {
        adopt();
        repo.git('checkout', '-q', '-b', 'side');
        repo.commit({ 's.ts': '1' }, 'fix: side', '2026-10-16T09:00:00Z');
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'm.ts': '1' }, 'fix: main work', '2026-10-16T10:00:00Z');
        repo.gitAt('2026-10-16T11:00:00Z', 'merge', '--no-ff', '-q', 'side', '-m', 'Merge side');
        expect(byClass(listed())['Merge side']).toBe('missing');
    });
    test('a record that the side branch added and the first parent already had is not added by the merge', () => {
        adopt();
        repo.git('checkout', '-q', '-b', 'side');
        repo.commit({ 's.ts': '1' }, 'fix: side', '2026-10-16T09:00:00Z');
        repo.git('checkout', '-q', 'main');
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: first', '2026-10-16T10:00:00Z');
        repo.git('checkout', '-q', 'side');
        repo.git('merge', '-q', '--no-edit', 'main');
        repo.git('checkout', '-q', 'main');
        repo.gitAt('2026-10-16T11:00:00Z', 'merge', '--no-ff', '-q', 'side', '-m', 'Merge side');
        expect(byClass(listed())).toEqual({ 'Merge side': 'missing', 'feat: first': 'recorded' });
    });
});

describe('listChanges: window and bounds (R5.2, R5.5, R5.7)', () => {
    test('the window start is inclusive and a commit one second older is out', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: before', '2026-10-15T11:59:59Z');
        repo.commit({ 'b.ts': '1' }, 'fix: at start', '2026-10-15T12:00:00Z');
        repo.commit({ 'c.ts': '1' }, 'fix: after', '2026-10-15T12:00:01Z');
        expect(subjects(listed())).toEqual(['fix: after', 'fix: at start']);
    });
    test('a future-dated commit is included', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: future', '2030-01-01T00:00:00Z');
        const r = listed();
        expect(subjects(r)).toEqual(['fix: future']);
        expect(r.changes[0].merged_at).toBe('2030-01-01T00:00:00.000Z');
    });
    test('each commit is tested individually: an old-dated commit between two in-window ones does not stop the walk', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: x', '2026-10-16T10:00:00Z');
        repo.commit({ 'b.ts': '1' }, 'fix: y old', '2026-10-01T10:00:00Z');
        repo.commit({ 'c.ts': '1' }, 'fix: z', '2026-10-16T12:00:00Z');
        expect(subjects(listed())).toEqual(['fix: z', 'fix: x']);
    });
    test('merged_at is the committer date, not the author date', () => {
        adopt();
        repo.gitAt('2026-10-16T12:00:00Z', 'commit', '--allow-empty', '-q', '-m', 'fix: dates', '--date=2020-01-01T00:00:00Z');
        expect(repo.git('log', '-1', '--format=%at')).toBe(String(Date.parse('2020-01-01T00:00:00Z') / 1000));
        const r = listed();
        expect(r.changes[0].merged_at).toBe('2026-10-16T12:00:00.000Z');
    });
    test('the window start is reported as an ISO instant', () => {
        adopt();
        expect(listed().since).toBe('2026-10-15T12:00:00.000Z');
    });
    test('beyond the limit the newest entries are kept and the rest are counted', () => {
        adopt();
        for (let i = 1; i <= 5; i++) repo.commit({ [`f${i}.ts`]: '1' }, `fix: n${i}`, `2026-10-16T0${i}:00:00Z`);
        const r = listed({ limit: 3 });
        expect(subjects(r)).toEqual(['fix: n5', 'fix: n4', 'fix: n3']);
        expect(r).toMatchObject({ truncated: true, omitted: 2 });
    });
    test('exactly at the limit is not truncated', () => {
        adopt();
        for (let i = 1; i <= 3; i++) repo.commit({ [`f${i}.ts`]: '1' }, `fix: n${i}`, `2026-10-16T0${i}:00:00Z`);
        expect(listed({ limit: 3 })).toMatchObject({ truncated: false, omitted: 0 });
    });
    test('the limit counts window entries only, not older commits', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: old', '2026-10-01T00:00:00Z');
        repo.commit({ 'b.ts': '1' }, 'fix: new', '2026-10-16T00:00:00Z');
        expect(listed({ limit: 1 })).toMatchObject({ truncated: false, omitted: 0 });
    });
    test('a limit above 200 is capped at 200', () => {
        expect(DEFAULT_LIMIT).toBe(200);
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T00:00:00Z');
        expect(listed({ limit: 100_000 })).toMatchObject({ truncated: false });
    });
    const files = (n: number, from = 0): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => {
        const id = `2026-10-16-r${String(from + i).padStart(3, '0')}`;
        return [recordPath(id), record(id)];
    }));
    test('a commit adding more records than the per-commit bound is not read: one too-many-records diagnostic stands for it', () => {
        adopt();
        repo.commit(files(MAX_RECORDS_PER_ENTRY + 1), 'feat: many', '2026-10-16T20:00:00Z');
        const spy = spyOnGit();
        const entry = listed().changes[0];
        spy.restore();
        expect(entry.classification).toBe('invalid-record');
        expect(entry.records).toEqual([{ path: 'docs/changes', diagnostics: [expect.objectContaining({ code: 'too-many-records' })] }]);
        expect(spy.calls.filter((a) => a.includes('ls-tree') || a.includes('show'))).toEqual([]);
    });
    test('a commit adding exactly the per-commit bound of valid records is recorded and all are read', () => {
        adopt();
        repo.commit(files(MAX_RECORDS_PER_ENTRY), 'feat: many', '2026-10-16T20:00:00Z');
        const entry = listed().changes[0];
        expect(entry.classification).toBe('recorded');
        expect(entry.records).toHaveLength(MAX_RECORDS_PER_ENTRY);
        expect(entry.records.every((r) => 'schema' in r)).toBe(true);
    });
    test('the per-commit bound can be lowered, and the commit is then not read at all', () => {
        adopt();
        repo.commit(files(2), 'feat: two', '2026-10-16T20:00:00Z');
        const entry = listed({ maxRecordsPerEntry: 1 }).changes[0];
        expect(entry.classification).toBe('invalid-record');
        expect(entry.records).toEqual([{ path: 'docs/changes', diagnostics: [expect.objectContaining({ code: 'too-many-records' })] }]);
        expect(listed({ maxRecordsPerEntry: 2 }).changes[0].classification).toBe('recorded');
    });
    test('the per-run budget fails closed on the commits that come after it is spent', () => {
        adopt();
        for (let i = 1; i <= 3; i++) repo.commit({ [recordPath(`2026-10-16-r${i}`)]: record(`2026-10-16-r${i}`) }, `feat: r${i}`, `2026-10-16T0${i}:00:00Z`);
        const r = listed({ maxRecords: 2 });
        expect(byClass(r)).toEqual({ 'feat: r3': 'recorded', 'feat: r2': 'recorded', 'feat: r1': 'invalid-record' });
        expect(r.changes[2].records).toEqual([{ path: 'docs/changes', diagnostics: [expect.objectContaining({ code: 'too-many-records' })] }]);
    });
    test('the per-run budget is spent on records actually read: a commit refused for being too large does not use it up', () => {
        adopt();
        repo.commit(files(1, 100), 'feat: small', '2026-10-16T01:00:00Z');
        repo.commit(files(3, 200), 'feat: big', '2026-10-16T02:00:00Z');
        repo.commit(files(2, 300), 'feat: medium', '2026-10-16T03:00:00Z');
        const r = listed({ maxRecords: 3 });
        expect(byClass(r)).toEqual({ 'feat: medium': 'recorded', 'feat: big': 'invalid-record', 'feat: small': 'recorded' });
        expect(r.changes.find((c) => c.subject === 'feat: big')?.records).toHaveLength(1);
    });
    test('a budget of exactly the records of the run reads them all', () => {
        adopt();
        repo.commit(files(2, 100), 'feat: a', '2026-10-16T01:00:00Z');
        repo.commit(files(1, 200), 'feat: b', '2026-10-16T02:00:00Z');
        expect(Object.values(byClass(listed({ maxRecords: 3 })))).toEqual(['recorded', 'recorded']);
        expect(Object.values(byClass(listed({ maxRecords: 2 })))).toEqual(['recorded', 'invalid-record']);
    });
});

describe('listChanges: size and paths of what git prints (R5.7, R1.8)', () => {
    test('an oversize record in history is invalid-record with record-too-large and is never read', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST) + 'x'.repeat(MAX_RECORD_BYTES + 10) }, 'feat: huge', '2026-10-16T20:00:00Z');
        const spy = spyOnGit();
        const entry = listed().changes[0];
        spy.restore();
        expect(entry.classification).toBe('invalid-record');
        expect(entry.records).toEqual([{ path: recordPath(FIRST), diagnostics: [expect.objectContaining({ code: 'record-too-large' })] }]);
        expect(spy.calls.filter((a) => a.includes('show') || a.includes('cat-file'))).toEqual([]);
    });
    test('a record of exactly the size limit is read', () => {
        adopt();
        const head = record(FIRST);
        const padded = head + '\n'.repeat(MAX_RECORD_BYTES - Buffer.byteLength(head));
        expect(Buffer.byteLength(padded)).toBe(MAX_RECORD_BYTES);
        repo.commit({ [recordPath(FIRST)]: padded }, 'feat: at the limit', '2026-10-16T20:00:00Z');
        expect(listed().changes[0].classification).toBe('recorded');
    });
    test('the size is checked before the blob is read: the one oversize record of an entry does not hide the others', () => {
        adopt();
        repo.commit({ [recordPath('2026-10-16-big')]: record('2026-10-16-big') + 'x'.repeat(MAX_RECORD_BYTES), [recordPath('2026-10-16-ok')]: record('2026-10-16-ok') }, 'feat: both', '2026-10-16T20:00:00Z');
        const entry = listed().changes[0];
        expect(entry.records.map((r) => [r.path, (r as { diagnostics: unknown[] }).diagnostics.length > 0])).toEqual([[recordPath('2026-10-16-big'), true], [recordPath('2026-10-16-ok'), false]]);
    });
    posixOnly('a record that is a symlink in history is invalid-record and its target is never read', () => {
        adopt();
        fs.mkdirSync(path.join(repo.root, 'docs', 'changes'), { recursive: true });
        fs.symlinkSync('../../README.md', path.join(repo.root, recordPath(FIRST)));
        repo.git('add', '-A');
        repo.gitAt('2026-10-16T20:00:00Z', 'commit', '-q', '-m', 'feat: link');
        const spy = spyOnGit();
        const entry = listed().changes[0];
        spy.restore();
        expect(entry.classification).toBe('invalid-record');
        expect(entry.records[0]).toMatchObject({ path: recordPath(FIRST), diagnostics: [{ code: 'record-invalid' }] });
        expect(spy.calls.filter((a) => a.includes('show'))).toEqual([]);
    });
    posixOnly('a path that git prints is validated: a record name with a newline is not a record', () => {
        adopt();
        repo.commit({ [`docs/changes/2026-10-16-a\nb.md`]: record('2026-10-16-a') }, 'feat: odd name', '2026-10-16T20:00:00Z');
        expect(byClass(listed())['feat: odd name']).toBe('missing');
    });
    test('a failing ls-tree makes the entry invalid-record with git-failed, and the others are still read', () => {
        adopt();
        repo.commit({ [recordPath('2026-10-16-a')]: record('2026-10-16-a') }, 'feat: a', '2026-10-16T10:00:00Z');
        repo.commit({ [recordPath('2026-10-16-b')]: record('2026-10-16-b') }, 'feat: b', '2026-10-16T11:00:00Z');
        let fails = 1;
        const spy = spyOnGit((args) => { if (args.includes('ls-tree') && fails-- > 0) throw new Error('boom'); });
        const r = listed();
        spy.restore();
        expect(byClass(r)).toEqual({ 'feat: b': 'invalid-record', 'feat: a': 'recorded' });
        expect(r.changes[0].records).toEqual([{ path: recordPath('2026-10-16-b'), diagnostics: [expect.objectContaining({ code: 'git-failed' })] }]);
    });
    test('a failing read of one blob makes that record git-failed only', () => {
        adopt();
        repo.commit({ [recordPath('2026-10-16-a')]: record('2026-10-16-a') }, 'feat: a', '2026-10-16T10:00:00Z');
        repo.commit({ [recordPath('2026-10-16-b')]: record('2026-10-16-b') }, 'feat: b', '2026-10-16T11:00:00Z');
        let fails = 1;
        const spy = spyOnGit((args) => { if (args.includes('show') && fails-- > 0) throw new Error('boom'); });
        const r = listed();
        spy.restore();
        expect(byClass(r)).toEqual({ 'feat: b': 'invalid-record', 'feat: a': 'recorded' });
        expect(r.changes[0].records[0]).toMatchObject({ diagnostics: [{ code: 'git-failed' }] });
    });
    test('a failing listing of the added files makes that entry invalid-record with git-failed, not missing', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        const spy = spyOnGit((args) => { if (args.includes('diff')) throw new Error('boom'); });
        const r = listed();
        spy.restore();
        expect(r.changes[0].classification).toBe('invalid-record');
        expect(r.changes[0].records).toEqual([{ path: 'docs/changes', diagnostics: [expect.objectContaining({ code: 'git-failed' })] }]);
    });
    test('a failing scan of the history is a git-failed failure, not a throw', () => {
        adopt();
        const spy = spyOnGit((args) => { if (args.includes('log') && args.includes('-z') && args.some((a) => a.startsWith('--format=%H%x1f'))) throw new Error('boom'); });
        const outcome = list();
        spy.restore();
        expect(outcome).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
    });
    test('a failing adoption lookup is a git-failed failure', () => {
        adopt();
        const spy = spyOnGit((args) => { if (args.includes('--diff-filter=A') && args.includes('log')) throw new Error('boom'); });
        const outcome = list();
        spy.restore();
        expect(outcome).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
    });
});

describe('listChanges: derived fields (R5.5)', () => {
    test('the PR number comes from a trailing (#n)', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'feat: squash style (#123)', '2026-10-16T10:00:00Z');
        expect(listed().changes[0].pr).toBe(123);
    });
    test.each([
        ['feat: x', null],
        ['feat: x (#12) more', null],
        ['feat: (#12) x', null],
        ['feat: x (#)', null],
        ['feat: x (#1a)', null],
        ['feat: x (# 12)', null],
        ['feat: x (#-5)', null],
        ['feat: x #12', null],
        ['feat: x (#12', null],
        ['feat: x (#99999999999999999999)', null],
        ['feat: x (#9007199254740993)', null],
        ['feat: x (#9007199254740991)', 9007199254740991],
        ['feat: x (#007)', 7],
        ['feat: x (#12)   ', 12],
        ['feat: x (#1) (#2)', 2],
        ['(#3)', 3],
    ])('the PR of %j is %j', (subject, pr) => {
        adopt();
        repo.commit({ 'a.ts': '1' }, subject, '2026-10-16T10:00:00Z');
        expect(listed().changes[0].pr).toBe(pr);
    });
    test('a very long run of digits or of blanks after (# is parsed in linear time', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, `feat: x (#${'9'.repeat(50_000)}`, '2026-10-16T10:00:00Z');
        repo.commit({ 'b.ts': '1' }, `feat: y (#${' '.repeat(50_000)}1)`, '2026-10-16T11:00:00Z');
        const start = Date.now();
        const r = listed();
        expect(Date.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
        expect(r.changes.map((c) => c.pr)).toEqual([null, null]);
    });
    test('release is the tag that contains the commit, null when none does', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: tagged', '2026-10-16T10:00:00Z');
        repo.gitAt('2026-10-16T11:00:00Z', 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
        repo.commit({ 'b.ts': '1' }, 'fix: untagged', '2026-10-16T12:00:00Z');
        const r = listed();
        expect(r.changes.map((c) => [c.subject, c.release])).toEqual([['fix: untagged', null], ['fix: tagged', 'v1.0.0']]);
    });
    test('a tag on a later commit contains the earlier ones', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.commit({ 'b.ts': '1' }, 'fix: b', '2026-10-16T11:00:00Z');
        repo.gitAt('2026-10-16T12:00:00Z', 'tag', '-a', 'v2.0.0', '-m', 'v2.0.0');
        expect(listed().changes.map((c) => c.release)).toEqual(['v2.0.0', 'v2.0.0']);
    });
    test('the earliest-created tag wins, whatever its name', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.gitAt('2026-10-16T13:00:00Z', 'tag', '-a', 'v1.0.0', '-m', 'late');
        repo.gitAt('2026-10-16T11:00:00Z', 'tag', '-a', 'v9.9.9', '-m', 'early');
        expect(listed().changes[0].release).toBe('v9.9.9');
    });
    test('equal creation dates are broken by tag name ascending', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        for (const name of ['v1.0.2', 'v1.0.0', 'v1.0.1']) repo.gitAt('2026-10-16T11:00:00Z', 'tag', '-a', name, '-m', name);
        expect(listed().changes[0].release).toBe('v1.0.0');
    });
    test('a lightweight tag is dated by its commit', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.git('tag', 'light');
        repo.gitAt('2026-10-16T09:00:00Z', 'tag', '-a', 'older-annotated', '-m', 'x');
        expect(listed().changes[0].release).toBe('older-annotated');
    });
    test('only tags count: a branch that contains the commit is not a release', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.git('branch', 'release/1.0');
        expect(listed().changes[0].release).toBeNull();
    });
    posixOnly('a tag name with a bidi override is escaped, never raw', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.git('tag', 'v1\u202e0');
        const release = listed().changes[0].release;
        expect(release).toBe('v1\\u202e0');
        expect(release).not.toMatch(UNSAFE);
    });
    test('repo is host/owner/name with credentials stripped (https)', () => {
        adopt();
        repo.git('remote', 'add', 'origin', 'https://user:tok@github.com/Kodria/belanz.git');
        const r = listed();
        expect(r.repo).toBe('github.com/Kodria/belanz');
        expect(JSON.stringify(r)).not.toContain('tok');
        expect(JSON.stringify(r)).not.toContain('user');
    });
    test('repo is host/owner/name for an scp-style remote', () => {
        adopt();
        repo.git('remote', 'add', 'origin', 'git@GitHub.com:Kodria/belanz.git');
        expect(listed().repo).toBe('github.com/Kodria/belanz');
    });
    test('repo is null without a remote', () => {
        adopt();
        expect(listed().repo).toBeNull();
    });
    test.each([
        ['an scp-style user:password containing @', 'user:p@ss@host.example:o/n.git'],
        ['a password in an ssh URL', 'ssh://git:secretpw@host.example/o/n.git'],
        ['a token as the user', 'https://ghp_secrettoken@github.com/o/n'],
    ])('no part of the credentials appears for %s', (_label, url) => {
        adopt();
        repo.git('remote', 'add', 'origin', url);
        const out = JSON.stringify(listed());
        expect(out).not.toMatch(/secret|ss@|p@ss|ghp_/);
    });
    test('a remote with control characters in it is not echoed raw', () => {
        adopt();
        repo.git('config', 'remote.origin.url', 'https://host.example/o/n\u001b[31m');
        const r = listed();
        expect(r.repo === null || !UNSAFE.test(r.repo)).toBe(true);
    });
});

describe('listChanges: a committer date that cannot be one (R5.5)', () => {
    test.each([
        ['empty', ''],
        ['negative', '-5 +0000'],
        ['not a number', 'abc +0000'],
        ['without a time zone', '1700000000'],
        ['beyond what a Date holds', '9000000000000 +0000'],
        ['far beyond', '99999999999999 +0000'],
        ['the largest 64-bit number', '18446744073709551615 +0000'],
    ])('a %s date gives merged_at null, the commit is listed normally and the run does not fail', (_label, date) => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: before', '2026-10-16T10:00:00Z');
        const sha = commitLiterally(repo, date);
        repo.commit({ 'b.ts': '1' }, 'fix: after', '2026-10-16T12:00:00Z');
        const r = listed();
        expect(subjects(r)).toEqual(['fix: after', 'fix: odd date', 'fix: before']);
        expect(r.changes[1]).toMatchObject({ sha, merged_at: null, classification: 'missing', pr: null });
        expect(r.changes[0].merged_at).toBe('2026-10-16T12:00:00.000Z');
    });
    test('such a commit is inside any window, even a narrow one, since it cannot be shown to be outside it', () => {
        adopt();
        commitLiterally(repo, 'abc +0000');
        expect(subjects(listed({ since: new Date('2026-10-17T11:59:00Z') }))).toEqual(['fix: odd date']);
    });
    test('it counts against the limit like any other entry', () => {
        adopt();
        commitLiterally(repo, '');
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        expect(listed({ limit: 1 })).toMatchObject({ truncated: true, omitted: 1 });
    });
    test('a record added by such a commit is read like any other', () => {
        adopt();
        const files = { [recordPath(FIRST)]: record(FIRST) };
        for (const [rel, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo.root, rel)), { recursive: true }); fs.writeFileSync(path.join(repo.root, rel), content); }
        repo.git('add', '-A');
        commitLiterally(repo, '', 'feat: odd and recorded');
        expect(byClass(listed())).toEqual({ 'feat: odd and recorded': 'recorded' });
    });
    test('the largest instant a Date can hold is representable: a future-dated commit that is included', () => {
        adopt();
        commitLiterally(repo, '8640000000000 +0000');
        expect(listed().changes[0].merged_at).toBe('+275760-09-13T00:00:00.000Z');
    });
    test('the epoch itself is a date: such a commit is older than the window', () => {
        adopt();
        commitLiterally(repo, '0 +0000');
        expect(listed().changes).toEqual([]);
    });
});

describe('listChanges: subjects and tags beyond their caps are clipped, never an error (R5.5, R5.7)', () => {
    const bigMessage = (first: string): string => { const file = path.join(repo.home, 'message.txt'); fs.writeFileSync(file, `${first}\n`); return file; };
    test('a 17 MB subject is clipped to the cap and the run succeeds', () => {
        adopt();
        repo.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '-F', bigMessage(`feat: ${'x'.repeat(17_000_000)}`));
        repo.commit({ 'b.ts': '1' }, 'fix: next', '2026-10-16T11:00:00Z');
        const r = listed();
        expect(subjects(r)[0]).toBe('fix: next');
        expect(r.changes[1].subject.length).toBe(MAX_SUBJECT);
        expect(r.changes[1].subject.startsWith('feat: xxxx')).toBe(true);
        expect(r.changes[1].subject.endsWith('…')).toBe(true);
    }, 120_000);
    test('the subject is asked from git bounded, so that git never prints all of it', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        const spy = spyOnGit();
        listed();
        spy.restore();
        const call = spy.calls.find((a) => a.some((x) => x.startsWith('--format=%H%x1f%<(')));
        expect(call).toBeDefined();
        expect(call?.some((x) => /%<\(\d+,trunc\)%s/.test(x))).toBe(true);
    });
    test('a short subject is returned without the padding git adds', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        expect(subjects(listed())).toEqual(['fix: a']);
    });
    test('a subject made of zero-width characters, which git does not count, gets a placeholder and the others are intact', () => {
        adopt();
        repo.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '-F', bigMessage(`fix: ${'\u0301'.repeat(9_000_000)}`));
        repo.commit({ 'b.ts': '1' }, 'fix: next', '2026-10-16T11:00:00Z');
        const r = listed();
        expect(subjects(r)).toEqual(['fix: next', '<subject unavailable>']);
    }, 120_000);
    posixOnly('a tag name longer than 255 characters is clipped, never git-failed', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.git('tag', `${'a'.repeat(120)}/${'b'.repeat(200)}`);
        const release = listed().changes[0].release;
        expect(release?.length).toBe(255);
        expect(release?.startsWith('aaaa')).toBe(true);
        expect(release?.endsWith('…')).toBe(true);
    });
});

describe('listChanges: shallow clones and the default base (R5.1)', () => {
    function clone(depth?: number): string {
        const dest = path.join(repo.home, `clone-${depth ?? 'full'}`);
        repo.git('clone', '-q', ...(depth === undefined ? [] : ['--depth', String(depth)]), pathToFileURL(repo.root).href, dest);
        return dest;
    }
    test('a shallow clone fails with shallow-history and the remedy', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        repo.commit({ 'b.ts': '1' }, 'fix: b', '2026-10-16T11:00:00Z');
        const dest = clone(1);
        expect(repo.git('-C', dest, 'rev-parse', '--is-shallow-repository')).toBe('true');
        expect(listChanges(dest, { since: SINCE_48H })).toMatchObject({ ok: false, failure: { code: 'shallow-history', remedy: 'git fetch --unshallow' } });
    });
    test('a full clone of the same repository is listed', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z');
        const dest = clone();
        expect(repo.git('-C', dest, 'rev-parse', '--is-shallow-repository')).toBe('false');
        expect(subjects(ok(listChanges(dest, { since: SINCE_48H })))).toEqual(['fix: a']);
    });
    test('a git that cannot say whether the repository is shallow fails closed', () => {
        adopt();
        const spy = spyOnGit((args) => { if (args.includes('--is-shallow-repository')) throw new Error('old git'); });
        const outcome = list();
        spy.restore();
        expect(outcome).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
    });
    test('list and change new resolve the same default base: origin/HEAD first', () => {
        adopt();
        repo.git('update-ref', 'refs/remotes/origin/main', repo.git('rev-parse', 'HEAD'));
        repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
        repo.commit({ 'a.ts': '1' }, 'fix: ahead of origin', '2026-10-16T10:00:00Z');
        const r = listed();
        expect(r.base).toBe('refs/remotes/origin/HEAD');
        expect(r.base).toBe(resolveBase(repo.root));
        expect(r.changes).toEqual([]);
        const range = resolveRange(repo.root, undefined);
        expect(range.ok && range.mergeBase).toBe(repo.git('merge-base', 'refs/remotes/origin/HEAD', 'HEAD'));
    });
    test('without origin/HEAD both fall back to the local main', () => {
        adopt();
        expect(listed().base).toBe('main');
        expect(resolveBase(repo.root)).toBe('main');
    });
});

describe('listChanges: hostile text from git is escaped and clipped', () => {
    test('control characters, line separators and bidi marks in a subject are escaped', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, 'feat: \u001b[31mred\u001b[0m \u202eevil\u202c \u2028 \u0085 \u007f end (#5)', '2026-10-16T10:00:00Z');
        const entry = listed().changes[0];
        expect(entry.subject).not.toMatch(UNSAFE);
        expect(entry.subject).toContain('\\u001b[31mred');
        expect(entry.subject).toContain('\\u202e');
        expect(entry.pr).toBe(5);
    });
    test('a subject is clipped to the subject cap with an ellipsis', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, `feat: ${'x'.repeat(5000)}`, '2026-10-16T10:00:00Z');
        const subject = listed().changes[0].subject;
        expect(MAX_SUBJECT).toBe(1024);
        expect(subject.length).toBe(MAX_SUBJECT);
        expect(subject.endsWith('…')).toBe(true);
    });
    test('a subject exactly at the cap is not clipped', () => {
        adopt();
        const subject = `feat: ${'x'.repeat(MAX_SUBJECT - 6)}`;
        repo.commit({ 'a.ts': '1' }, subject, '2026-10-16T10:00:00Z');
        expect(listed().changes[0].subject).toBe(subject);
    });
    test('the cut never splits a surrogate pair', () => {
        adopt();
        repo.commit({ 'a.ts': '1' }, `feat: ${'x'.repeat(MAX_SUBJECT - 7)}\u{1F600}\u{1F600}`, '2026-10-16T10:00:00Z');
        const subject = listed().changes[0].subject;
        expect(Buffer.from(subject, 'utf8').toString('utf8')).toBe(subject);
        expect(subject.length).toBeLessThanOrEqual(MAX_SUBJECT);
    });
    test('a subject made only of controls is still one clean line', () => {
        adopt();
        repo.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '--allow-empty-message', '-m', '\u001b\u001b');
        const subject = listed().changes[0].subject;
        expect(subject).not.toMatch(UNSAFE);
    });
    test('a commit with an empty message has an empty subject', () => {
        adopt();
        repo.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '--allow-empty-message', '-m', '');
        expect(listed().changes[0].subject).toBe('');
    });
    test('bidi marks inside a valid record are escaped in what list returns', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST, { summary: 'Uno \u202edos' }) }, 'feat: bidi', '2026-10-16T10:00:00Z');
        const rec = listed().changes[0].records[0] as { summary_short: string };
        expect(rec.summary_short).toBe('Uno \\u202edos');
    });
    test('a sensor named __proto__ stays an own key of the returned record', () => {
        adopt();
        const text = record(FIRST).replace('sensors: { lint: pass }', 'sensors: { "__proto__": pass }');
        repo.commit({ [recordPath(FIRST)]: text }, 'feat: proto', '2026-10-16T10:00:00Z');
        const rec = listed().changes[0].records[0] as { verification: { sensors: Record<string, string> } };
        expect(Object.keys(rec.verification.sensors)).toEqual(['__proto__']);
        expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    });
    test('a signed commit and log.showSignature do not change what is parsed', () => {
        adopt();
        showSignaturesInLog(repo);
        commitForgedSigned(repo, 'fix: signed (#9)');
        const r = listed({ since: new Date('2000-01-01T00:00:00Z') });
        expect(r.changes[0]).toMatchObject({ subject: 'fix: signed (#9)', pr: 9, classification: 'missing' });
        expect(r.changes[0].sha).toMatch(/^[0-9a-f]{40}$/);
    });
    test('GIT_LITERAL_PATHSPECS and GIT_GLOB_PATHSPECS in the environment do not change the answer', () => {
        history();
        const plain = byClass(listed());
        expect(withEnv({ GIT_LITERAL_PATHSPECS: '1', GIT_GLOB_PATHSPECS: '1' }, () => byClass(listed()))).toEqual(plain);
    });
});

describe('listChanges: read-only and bounded (R5.7)', () => {
    function snapshot(): string {
        const hash = crypto.createHash('sha1');
        const walk = (dir: string, rel: string): void => {
            for (const name of fs.readdirSync(dir).sort()) {
                if (rel === '.git' && name === 'objects') continue;
                const abs = path.join(dir, name);
                const here = `${rel}/${name}`;
                const stat = fs.lstatSync(abs);
                if (stat.isDirectory()) { hash.update(`d ${here}\n`); walk(abs, here); } else hash.update(`f ${here} ${crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex')}\n`);
            }
        };
        walk(repo.root, '');
        return `${hash.digest('hex')}\n${repo.git('status', '--porcelain', '--ignored')}\n${repo.git('for-each-ref')}`;
    }
    test('writes nothing: files, index, refs and ignored files are byte-identical afterwards', () => {
        history();
        fs.writeFileSync(path.join(repo.root, 'untracked.txt'), 'u');
        fs.mkdirSync(path.join(repo.root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo.root, '.awm', 'ignored.txt'), 'i');
        const before = snapshot();
        listed();
        listed({ limit: 2 });
        expect(snapshot()).toBe(before);
    });
    test('every git call is read-only', () => {
        history();
        const spy = spyOnGit();
        listed();
        spy.restore();
        const subcommands = new Set(spy.calls.map((a) => a.find((x) => !x.startsWith('-') && x !== 'diff.relative=false') ?? ''));
        expect([...subcommands].sort()).toEqual(expect.arrayContaining(['log']));
        for (const name of subcommands) expect(['rev-parse', 'log', 'diff', 'ls-tree', 'show', 'for-each-ref', 'config']).toContain(name);
    });
    test('every git log carries the safety flags', () => {
        history();
        const spy = spyOnGit();
        listed();
        spy.restore();
        const logs = spy.calls.filter((a) => a.includes('log'));
        expect(logs.length).toBeGreaterThanOrEqual(3);
        for (const call of logs) {
            expect(call).toContain('--no-show-signature');
            expect(call).toContain('--encoding=UTF-8');
            expect(call).toContain('--end-of-options');
        }
    });
    test('pathspecs are literal and follow a --', () => {
        history();
        const spy = spyOnGit();
        listed();
        spy.restore();
        const withPath = spy.calls.filter((a) => a.some((x) => x.includes('docs/changes')));
        expect(withPath.length).toBeGreaterThan(0);
        for (const call of withPath) {
            const dash = call.indexOf('--');
            expect(dash).toBeGreaterThan(-1);
            expect(call.slice(dash + 1).every((x) => x.startsWith(':(top,literal)') || /^docs\/changes\/[a-z0-9-]+\.md$/.test(x))).toBe(true);
        }
    });
    test('the first-parent history is read with the merge diff against the first parent', () => {
        history();
        const spy = spyOnGit();
        listed();
        spy.restore();
        const scans = spy.calls.filter((a) => a.includes('log') && a.includes('--first-parent'));
        expect(scans.length).toBeGreaterThanOrEqual(2);
        for (const call of scans.filter((a) => a.includes('--diff-filter=A'))) expect(call).toContain('--diff-merges=first-parent');
    });
    test('git calls per entry are constant: recorded entries cost the same however long the history', () => {
        adopt();
        const add = (from: number, to: number): void => {
            for (let i = from; i <= to; i++) {
                const id = `2026-10-16-r${String(i).padStart(3, '0')}`;
                repo.commit({ [recordPath(id)]: record(id) }, `feat: r${i}`, '2026-10-16T10:00:00Z');
            }
        };
        const count = (): number => { const spy = spyOnGit(); const r = listed(); spy.restore(); expect(r.changes.length).toBeGreaterThan(0); return spy.calls.length; };
        add(1, 5);
        const small = count();
        add(6, 25);
        const large = count();
        expect((large - small) / 20).toBeLessThanOrEqual(5);
        expect(large - small).toBeGreaterThan(0);
    });
    test('git calls per entry are constant for entries without a record too', () => {
        adopt();
        const add = (from: number, to: number): void => { for (let i = from; i <= to; i++) repo.commit({ [`f${i}.ts`]: '1' }, `fix: n${i}`, '2026-10-16T10:00:00Z'); };
        const count = (): number => { const spy = spyOnGit(); listed(); spy.restore(); return spy.calls.length; };
        add(1, 5);
        const small = count();
        add(6, 25);
        const large = count();
        expect((large - small) / 20).toBeLessThanOrEqual(4);
    });
    test('the limit bounds the work: entries beyond it cost no per-entry git calls', () => {
        adopt();
        for (let i = 1; i <= 30; i++) repo.commit({ [`f${i}.ts`]: '1' }, `fix: n${i}`, '2026-10-16T10:00:00Z');
        const calls = (limit: number): number => { const spy = spyOnGit(); listed({ limit }); spy.restore(); return spy.calls.length; };
        expect(calls(30) - calls(5)).toBeGreaterThanOrEqual(25 * 3);
        expect(calls(5)).toBeLessThan(calls(30) / 2);
    });
});

describe('listChanges: a long history', () => {
    let big: TestRepo;
    beforeAll(() => {
        big = makeRepo();
        big.commit({ [recordPath('2026-10-10-adopt')]: record('2026-10-10-adopt') }, 'feat: adopt', '2026-10-10T00:00:00Z');
        for (let i = 1; i <= 201; i++) big.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '-m', `fix: n${i}`);
    }, 180_000);
    afterAll(() => big.cleanup());
    test('beyond 200 entries only the newest 200 are listed and the rest is counted', () => {
        const outcome = listChanges(big.root, { since: SINCE_48H });
        if (!outcome.ok) throw new Error(outcome.failure.message);
        expect(outcome.result.changes).toHaveLength(200);
        expect(outcome.result.changes[0].subject).toBe('fix: n201');
        expect(outcome.result.changes[199].subject).toBe('fix: n2');
        expect(outcome.result).toMatchObject({ truncated: true, omitted: 1 });
    }, 180_000);
    test('scanning a long history for a small page is linear: the time does not grow with the omitted entries', () => {
        const start = Date.now();
        const outcome = listChanges(big.root, { since: SINCE_48H, limit: 3 });
        const elapsed = Date.now() - start;
        if (!outcome.ok) throw new Error(outcome.failure.message);
        expect(outcome.result).toMatchObject({ truncated: true, omitted: 198 });
        expect(elapsed).toBeLessThan(LINEAR_TIME_BOUND_MS);
    });
});
