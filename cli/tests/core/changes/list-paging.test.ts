import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { gitAtLeast, importCommits, cloneRepo, makeRepo, posixOnly, spyOnGit, type TestRepo } from './helpers';
import { FIRST, SINCE_48H, adoptIn, byClass, commitLiterally, historyIn, listIn, ok, record, recordPath, snapshotDir, subjects } from './list-fixtures';
import { DEFAULT_LIMIT, MAX_RECORDS_PER_ENTRY, MAX_RECORDS_PER_RUN, MAX_SUBJECT, PAGE_SIZE, listChanges, type ListedChange, type ListOutcome, type ListResult } from '../../../src/core/changes/list';

let repo: TestRepo;
let template: TestRepo;
/** The template plus the default adoption commit of `adoptIn`: `adopt()` starts a test from a copy of it (no git process). */
let adopted: TestRepo;
beforeAll(() => { template = makeRepo(); adopted = cloneRepo(template); adoptIn(adopted); });
afterAll(() => { adopted.cleanup(); template.cleanup(); });
beforeEach(() => { repo = cloneRepo(template); });
afterEach(() => { jest.restoreAllMocks(); repo.cleanup(); });

const list = (opts: Record<string, unknown> = {}): ListOutcome => listIn(repo, opts);
const listed = (opts: Record<string, unknown> = {}): ListResult => ok(list(opts));
/** The default adoption commit (a copy of the prebuilt `adopted` repository), or `adoptIn(repo, id)` for another id. */
const adopt = (id?: string): void => {
    if (id !== undefined) { adoptIn(repo, id); return; }
    repo.cleanup();
    repo = cloneRepo(adopted);
};
const history = (): void => historyIn(repo);
type Planned = [files: Record<string, string>, message: string, date: string];
/** The commits `repo.commit(files, message, date)` would make, in order, written by one `git fast-import` (importCommits). */
const commitMany = (planned: Planned[]): void => importCommits(repo, planned.map(([files, message, date]) => ({ files, message: `${message}\n`, date })));
/** `n` commits `${prefix}${i}` (i from `from`), each adding `${file}${i}.ts`, all at `date`. */
const series = (n: number, prefix: string, file: string, date: string, from = 1): Planned[] =>
    Array.from({ length: n }, (_, k) => [{ [`${file}${from + k}.ts`]: '1' }, `${prefix}${from + k}`, date]);

/**
 * A state for read-only tests, built once (lazily, by `build` acting on `repo`) and listed once under a git spy; the tests that
 * share it only read the result and the recorded git calls, and never change the state.
 */
function sharedListing(build: () => void, opts: Record<string, unknown> = {}): () => { result: ListResult; calls: string[][] } {
    let state: TestRepo | undefined;
    let memo: { result: ListResult; calls: string[][] } | undefined;
    afterAll(() => state?.cleanup());
    return () => {
        if (memo === undefined) {
            const own = repo;
            repo = cloneRepo(template);
            try {
                build();
                state = repo;
                const spy = spyOnGit();
                try { memo = { result: listed(opts), calls: spy.calls }; } finally { spy.restore(); }
            } catch (error) {
                if (state === undefined) repo.cleanup();
                throw error;
            } finally {
                repo = own;
            }
        }
        return memo;
    };
}
/** One `fix: a` commit after the adoption point, listed once. */
const oneFix = sharedListing(() => { adopt(); repo.commit({ 'a.ts': '1' }, 'fix: a', '2026-10-16T10:00:00Z'); });

describe('listChanges: window and bounds (R5.2, R5.5, R5.7)', () => {
    test('the window start is inclusive and a commit one second older is out', () => {
        adopt();
        commitMany([
            [{ 'a.ts': '1' }, 'fix: before', '2026-10-15T11:59:59Z'],
            [{ 'b.ts': '1' }, 'fix: at start', '2026-10-15T12:00:00Z'],
            [{ 'c.ts': '1' }, 'fix: after', '2026-10-15T12:00:01Z'],
        ]);
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
        commitMany([
            [{ 'a.ts': '1' }, 'fix: x', '2026-10-16T10:00:00Z'],
            [{ 'b.ts': '1' }, 'fix: y old', '2026-10-01T10:00:00Z'],
            [{ 'c.ts': '1' }, 'fix: z', '2026-10-16T12:00:00Z'],
        ]);
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
        commitMany(Array.from({ length: 5 }, (_, k) => [{ [`f${k + 1}.ts`]: '1' }, `fix: n${k + 1}`, `2026-10-16T0${k + 1}:00:00Z`]));
        const r = listed({ limit: 3 });
        expect(subjects(r)).toEqual(['fix: n5', 'fix: n4', 'fix: n3']);
        expect(r).toMatchObject({ truncated: true, omitted: 2 });
    });
    test('exactly at the limit is not truncated', () => {
        adopt();
        commitMany(Array.from({ length: 3 }, (_, k) => [{ [`f${k + 1}.ts`]: '1' }, `fix: n${k + 1}`, `2026-10-16T0${k + 1}:00:00Z`]));
        expect(listed({ limit: 3 })).toMatchObject({ truncated: false, omitted: 0 });
    });
    test('the limit counts window entries only, not older commits', () => {
        adopt();
        commitMany([[{ 'a.ts': '1' }, 'fix: old', '2026-10-01T00:00:00Z'], [{ 'b.ts': '1' }, 'fix: new', '2026-10-16T00:00:00Z']]);
        expect(listed({ limit: 1 })).toMatchObject({ truncated: false, omitted: 0 });
    });
    test('a limit above 200 is capped at 200: 205 window entries give 200 listed and 5 omitted', () => {
        expect(DEFAULT_LIMIT).toBe(200);
        expect(MAX_RECORDS_PER_ENTRY).toBe(50);
        expect(MAX_RECORDS_PER_RUN).toBe(500);
        adopt();
        importCommits(repo, Array.from({ length: 205 }, (_, i) => ({ message: `fix: n${i}`, files: { [`f${i}.ts`]: '1' }, date: new Date(Date.UTC(2026, 9, 16, 0, 0, 0) + i * 60_000).toISOString() })));
        const r = listed({ limit: 100_000 });
        expect(r.changes).toHaveLength(200);
        expect(r).toMatchObject({ truncated: true, omitted: 5 });
        expect(r.changes[0].subject).toBe('fix: n204');
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
        commitMany(Array.from({ length: 3 }, (_, k) => [{ [recordPath(`2026-10-16-r${k + 1}`)]: record(`2026-10-16-r${k + 1}`) }, `feat: r${k + 1}`, `2026-10-16T0${k + 1}:00:00Z`]));
        const r = listed({ maxRecords: 2 });
        expect(byClass(r)).toEqual({ 'feat: r3': 'recorded', 'feat: r2': 'recorded', 'feat: r1': 'invalid-record' });
        expect(r.changes[2].records).toEqual([{ path: 'docs/changes', diagnostics: [expect.objectContaining({ code: 'too-many-records' })] }]);
    });
    test('the per-run budget is spent on records actually read: a commit refused for being too large does not use it up', () => {
        adopt();
        commitMany([
            [files(1, 100), 'feat: small', '2026-10-16T01:00:00Z'],
            [files(3, 200), 'feat: big', '2026-10-16T02:00:00Z'],
            [files(2, 300), 'feat: medium', '2026-10-16T03:00:00Z'],
        ]);
        const r = listed({ maxRecords: 3 });
        expect(byClass(r)).toEqual({ 'feat: medium': 'recorded', 'feat: big': 'invalid-record', 'feat: small': 'recorded' });
        expect(r.changes.find((c) => c.subject === 'feat: big')?.records).toHaveLength(1);
    });
    test('a budget of exactly the records of the run reads them all', () => {
        adopt();
        commitMany([[files(2, 100), 'feat: a', '2026-10-16T01:00:00Z'], [files(1, 200), 'feat: b', '2026-10-16T02:00:00Z']]);
        expect(Object.values(byClass(listed({ maxRecords: 3 })))).toEqual(['recorded', 'recorded']);
        expect(Object.values(byClass(listed({ maxRecords: 2 })))).toEqual(['recorded', 'invalid-record']);
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
        const call = oneFix().calls.find((a) => a.some((x) => x.startsWith('--format=%H%x1f%<(')));
        expect(call).toBeDefined();
        expect(call?.some((x) => /%<\(\d+,trunc\)%s/.test(x))).toBe(true);
    });
    test('a short subject is returned without the padding git adds', () => {
        expect(subjects(oneFix().result)).toEqual(['fix: a']);
    });
    test('R5.5 a commit whose subject cannot be read still lists: its pr is null (the tail fallback), never a failure', () => {
        adopt();
        const file = path.join(repo.home, 'message.txt');
        fs.writeFileSync(file, `fix: ${'\u0301'.repeat(9_000_000)} (#12)\n`);
        repo.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '-F', file);
        const r = listed();
        expect(r.changes).toHaveLength(1);
        expect(r.changes[0]).toMatchObject({ subject: '<subject unavailable>', pr: null });
    });
    test('one bad subject among many is found by halving the batch: a logarithmic number of calls, not one per commit', () => {
        adopt();
        commitMany(series(7, 'fix: n', 'f', '2026-10-16T10:00:00Z'));
        repo.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '-F', bigMessage(`fix: ${'\u0301'.repeat(9_000_000)}`));
        commitMany(series(8, 'fix: n', 'f', '2026-10-16T11:00:00Z', 8));
        const spy = spyOnGit();
        const r = listed();
        spy.restore();
        const asked = (needle: string): number => spy.calls.filter((a) => a.some((x) => x.startsWith('--format=%H%x1f%<(') && x.includes(needle))).length;
        expect(subjects(r).filter((s) => s === '<subject unavailable>')).toHaveLength(1);
        expect(subjects(r).filter((s) => /^fix: n\d+$/.test(s))).toHaveLength(15);
        // 16 commits: the whole batch, then one failing half and one good half per level (4 levels); asking each one took 17.
        expect(asked(',trunc)')).toBeLessThanOrEqual(9);
        expect(asked(',ltrunc)')).toBeLessThanOrEqual(9);
        expect(asked(',trunc)')).toBeGreaterThan(1);
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

describe('listChanges: the first-parent scan is read in pages (R5.7)', () => {
    const isScan = (a: string[]): boolean => a.includes('log') && a.some((x) => x === '--format=%H%x1f%ct%x1f%P');
    const isAdoptionPage = (a: string[]): boolean => a.includes('log') && a.some((x) => x.startsWith(':(top,glob)docs/changes/'));
    /** `n` commits in the window, `fix: n1` oldest. */
    const inWindow = (n: number, from = 1): Planned[] => series(n, 'fix: n', 'f', '2026-10-16T10:00:00Z', from);
    const commits = (n: number, from = 1): void => commitMany(inWindow(n, from));
    /** `n` commits `fix: old${i}`, each adding `o${i}.ts`, dated before the window. */
    const old = (n: number): Planned[] => series(n, 'fix: old', 'o', '2026-10-01T10:00:00Z');
    /** `n` commits `docs: note ${i}`, each adding `docs/changes/2026-10-16-n${i}.md` (a record-like name: they touch docs/changes). */
    const notes = (n: number, from = 1): Planned[] => Array.from({ length: n }, (_, k) => [{ [`docs/changes/2026-10-16-n${from + k}.md`]: '1' }, `docs: note ${from + k}`, '2026-10-16T10:00:00Z']);
    const countCalls = (pred: (a: string[]) => boolean, opts: Record<string, unknown>): number => { const spy = spyOnGit(); listed(opts); spy.restore(); return spy.calls.filter(pred).length; };

    test('the real page size is 10 000 commits and is what a default run asks git for', () => {
        expect(PAGE_SIZE).toBe(10_000);
        adopt();
        const spy = spyOnGit();
        listed();
        spy.restore();
        expect(spy.calls.filter(isScan).every((a) => a.includes('--max-count=10000'))).toBe(true);
        expect(spy.calls.filter(isAdoptionPage).every((a) => a.includes('--max-count=10000'))).toBe(true);
    });
    test('a page size above the real one is capped to it', () => {
        adopt();
        const spy = spyOnGit();
        listed({ pageSize: 1_000_000 });
        spy.restore();
        expect(spy.calls.filter(isScan).every((a) => a.includes('--max-count=10000'))).toBe(true);
    });
    test.each([0, -1, 1.5, Number.NaN, '3', null])('the page size %j is invalid-input', (pageSize) => {
        expect(list({ pageSize })).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
    });
    test('entries across page boundaries are listed exactly as with one page', () => {
        adopt();
        commits(8);
        const paged = listed({ pageSize: 3 });
        expect(paged.changes).toHaveLength(8);
        expect(paged).toEqual(listed());
        expect(subjects(paged)[0]).toBe('fix: n8');
        expect(subjects(paged)[7]).toBe('fix: n1');
    });
    test('a page size of 1 gives the same answer', () => {
        adopt();
        commits(4);
        expect(listed({ pageSize: 1 })).toEqual(listed());
    });
    test('the scan stops at the adoption point: no page is read beyond the one holding it', () => {
        commitMany([[{ 'old.ts': '1' }, 'feat: before', '2026-10-16T09:00:00Z'], [{ 'old2.ts': '1' }, 'feat: before too', '2026-10-16T09:30:00Z']]);
        adopt('2026-10-16-first');
        commits(5);
        const r = listed({ pageSize: 2 });
        expect(subjects(r)).toEqual(['fix: n5', 'fix: n4', 'fix: n3', 'fix: n2', 'fix: n1']);
        expect(countCalls(isScan, { pageSize: 2 })).toBe(3);
    });
    test('the scan stops at the first page without a commit in the window', () => {
        adopt();
        commitMany([...old(6), ...inWindow(2)]);
        expect(subjects(listed({ pageSize: 2 }))).toEqual(['fix: n2', 'fix: n1']);
        expect(countCalls(isScan, { pageSize: 2 })).toBe(2);
    });
    test('a window with no commit in it reads one page only', () => {
        adopt();
        commitMany(old(6));
        expect(listed({ pageSize: 2 })).toMatchObject({ adopted: true, changes: [], truncated: false, omitted: 0 });
        expect(countCalls(isScan, { pageSize: 2 })).toBe(1);
    });
    test('a page that holds some commits of the window and some older ones is followed by one more page', () => {
        adopt();
        commitMany([...old(4), ...inWindow(1)]);
        expect(subjects(listed({ pageSize: 2 }))).toEqual(['fix: n1']);
        expect(countCalls(isScan, { pageSize: 2 })).toBe(2);
    });
    test('a commit dated inside the window beyond a page with none is not listed (dates are assumed not to decrease)', () => {
        adopt();
        commitMany([...inWindow(1), ...old(3), ...inWindow(1, 2)]);
        expect(subjects(listed({ pageSize: 2 }))).toEqual(['fix: n2']);
        expect(subjects(listed({ pageSize: 10 }))).toEqual(['fix: n2', 'fix: n1']);
    });
    test('an unusable date counts as inside the window when it decides whether to read on', () => {
        adopt();
        commitMany(old(4));
        commitLiterally(repo, '');
        repo.commit({ 'o5.ts': '1' }, 'fix: old5', '2026-10-01T10:00:00Z');
        expect(subjects(listed({ pageSize: 2 }))).toEqual(['fix: odd date']);
        expect(countCalls(isScan, { pageSize: 2 })).toBe(2);
    });
    test('the omitted entries are counted over every page', () => {
        adopt();
        commits(8);
        expect(listed({ pageSize: 3, limit: 3 })).toMatchObject({ truncated: true, omitted: 5 });
        expect(listed({ pageSize: 3, limit: 3 })).toEqual(listed({ limit: 3 }));
    });
    test('merge commits count as one commit of the first-parent chain, across pages', () => {
        adopt();
        repo.git('checkout', '-q', '-b', 'side1');
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: side1', '2026-10-16T08:00:00Z');
        repo.git('checkout', '-q', 'main');
        repo.gitAt('2026-10-16T09:00:00Z', 'merge', '--no-ff', '-q', 'side1', '-m', 'Merge side1');
        repo.git('checkout', '-q', '-b', 'side2');
        repo.commit({ 's2.ts': '1' }, 'chore: side2\n\nChange-Record: none', '2026-10-16T10:00:00Z');
        repo.git('checkout', '-q', 'main');
        repo.gitAt('2026-10-16T11:00:00Z', 'merge', '--no-ff', '-q', 'side2', '-m', 'Merge side2');
        commits(1);
        const paged = listed({ pageSize: 2 });
        expect(byClass(paged)).toEqual({ 'fix: n1': 'missing', 'Merge side2': 'exempt', 'Merge side1': 'recorded' });
        expect(paged).toEqual(listed());
    });
    test('the adoption search is paged too: the oldest commit that touched docs/changes is found across pages', () => {
        commitMany([[{ 'old.ts': '1' }, 'feat: before', '2026-10-16T09:00:00Z'], ...notes(7)]);
        const paged = listed({ pageSize: 3 });
        expect(subjects(paged)).toEqual(Array.from({ length: 7 }, (_, i) => `docs: note ${7 - i}`));
        expect(paged).toEqual(listed());
        expect(countCalls(isAdoptionPage, { pageSize: 3 })).toBe(3);
    });
    test('the adoption search reads one more, empty, page when the last one was full', () => {
        commitMany(notes(6));
        expect(subjects(listed({ pageSize: 3 }))).toHaveLength(6);
        expect(countCalls(isAdoptionPage, { pageSize: 3 })).toBe(3);
    });
    test('the adoption search skips commits that did not touch docs/changes between two pages', () => {
        commitMany([1, 2, 3].flatMap((i) => [...notes(1, i), ...inWindow(2, i * 10)]));
        const r = listed({ pageSize: 2 });
        expect(r.changes.map((c) => c.subject).filter((x) => x.startsWith('docs:'))).toEqual(['docs: note 3', 'docs: note 2', 'docs: note 1']);
        expect(r).toEqual(listed());
    });
    test('a root commit that adopts ends the paging', () => {
        repo.git('checkout', '-q', '--orphan', 'orph');
        repo.git('rm', '-rfq', '.');
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: root record', '2026-10-16T20:00:00Z');
        repo.commit({ 'z.ts': '1' }, 'fix: after root', '2026-10-16T21:00:00Z');
        expect(listed({ base: 'orph', pageSize: 1 })).toEqual(listed({ base: 'orph' }));
        expect(subjects(listed({ base: 'orph', pageSize: 1 }))).toEqual(['fix: after root', 'feat: root record']);
    });
    test('a git failure on a later page is a git-failed failure, not a partial list', () => {
        adopt();
        commits(6);
        let seen = 0;
        const spy = spyOnGit((args) => { if (isScan(args) && ++seen === 2) throw new Error('boom'); });
        const outcome = list({ pageSize: 2 });
        spy.restore();
        expect(outcome).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
    });
    test('a git failure on a later page of the adoption search is a git-failed failure', () => {
        commitMany(notes(6));
        let seen = 0;
        const spy = spyOnGit((args) => { if (isAdoptionPage(args) && ++seen === 2) throw new Error('boom'); });
        const outcome = list({ pageSize: 2 });
        spy.restore();
        expect(outcome).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
    });
});

describe('listChanges: the pr comes from the true end of the full subject (R5.5)', () => {
    const CASES: Array<[string, string, number | null]> = [
        ['5000 characters long', `fix: ${'a'.repeat(5000)} (#12)`, 12],
        ['1030 characters long (just beyond the subject cap)', `fix: ${'a'.repeat(1030 - 12)} (#12)`, 12],
        ['exactly the width of the tail', `${'x'.repeat(64 - 6)} (#12)`, 12],
        ['one column beyond the width of the tail', `${'x'.repeat(65 - 6)} (#12)`, 12],
        ['one column short of the width of the tail', `${'x'.repeat(63 - 6)} (#12)`, 12],
        ['shorter than the tail', 'fix: x (#3)', 3],
        ['with (#12) glued to a longer token at the end', `fix: ${'a'.repeat(300)}tok(#12)`, 12],
        ['with (#12) followed by more text', `fix: ${'a'.repeat(300)} (#12)x`, null],
        ['with (#12) early and a long tail after it', `fix: (#12) ${'a'.repeat(5000)}`, null],
        ['with a pr number longer than the tail would keep', `fix: ${'a'.repeat(300)} (#${'9'.repeat(60)})`, null],
        ['with the largest safe number at the end', `fix: ${'a'.repeat(300)} (#9007199254740991)`, 9007199254740991],
        ['with wide characters at the cut', `${'\u6f22'.repeat(100)} (#12)`, 12],
        ['with accented characters at the cut', `${'\u00e9'.repeat(100)} (#12)`, 12],
        ['with astral characters at the cut', `${'\u{1F600}'.repeat(100)} (#12)`, 12],
        ['with two (#n) at the end', `fix: ${'a'.repeat(300)} (#1) (#2)`, 2],
    ];
    const CLIPPED = `fix: ${'a'.repeat(5000)} (#12)`;
    const SHORT = 'fix: short (#4)';
    // Every subject below is its own commit of one shared history, listed once; an entry is found by its (unique) commit date.
    const SUBJECTS = [...CASES.map(([, subject]) => subject), CLIPPED, SHORT];
    const dateOf = (i: number): string => new Date(Date.UTC(2026, 9, 16, 10, 0, 0) + i * 60_000).toISOString();
    const shared = sharedListing(() => {
        adopt();
        commitMany(SUBJECTS.map((subject, i) => [{ [`a${i}.ts`]: '1' }, subject, dateOf(i)]));
    });
    const entryOf = (subject: string): ListedChange => {
        const { changes } = shared().result;
        expect(changes).toHaveLength(SUBJECTS.length);
        const i = SUBJECTS.indexOf(subject);
        expect(i).toBeGreaterThan(-1);
        const entry = changes.find((c) => c.merged_at === dateOf(i));
        if (entry === undefined) throw new Error(`no entry for subject ${i}`);
        return entry;
    };
    test.each(CASES)('a subject %s', (_label, subject, pr) => {
        expect(entryOf(subject).pr).toBe(pr);
    });
    test('the end of the subject is asked from git bounded to the tail width', () => {
        expect(oneFix().calls.some((a) => a.includes('--format=%H%x1f%<(64,ltrunc)%s'))).toBe(true);
    });
    test('the subject itself is still clipped while the pr is read from its end', () => {
        const entry = entryOf(CLIPPED);
        expect(entry.subject.length).toBe(MAX_SUBJECT);
        expect(entry.pr).toBe(12);
    });
    test('the tail never leaks into the subject', () => {
        expect(entryOf(SHORT).subject).toBe(SHORT);
    });
});

describe('listChanges: read-only and bounded (R5.7)', () => {
    // The whole tree is hashed, .git/objects included: reading must not add an object, a pack or a lock either.
    const snapshot = (): string => `${snapshotDir(repo.root)}\n${repo.git('--no-optional-locks', 'status', '--porcelain', '--ignored')}\n${repo.git('for-each-ref')}`;
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
    // GIT_NO_LAZY_FETCH is honoured from git 2.43 on; an older git would fetch the blobs, so the test is reported as skipped there.
    const needsGit243: typeof test = gitAtLeast(2, 43) ? test : (test.skip as typeof test);
    needsGit243('a partial clone fails closed instead of fetching the blobs it lacks: nothing is written and nothing is fetched (needs git 2.43+)', () => {
        adopt();
        repo.commit({ [recordPath(FIRST)]: record(FIRST) }, 'feat: first', '2026-10-16T10:00:00Z');
        repo.commit({ 'b.ts': '1' }, 'fix: next', '2026-10-16T11:00:00Z');
        repo.git('config', 'uploadpack.allowFilter', 'true');
        repo.git('config', 'uploadpack.allowAnySHA1InWant', 'true');
        const dest = path.join(repo.home, 'partial');
        repo.git('clone', '-q', '--filter=blob:none', '--no-checkout', pathToFileURL(repo.root).href, dest);
        const missing = (): number => repo.git('-C', dest, 'rev-list', '--objects', '--all', '--missing=print').split('\n').filter((l) => l.startsWith('?')).length;
        const packs = (): string[] => fs.readdirSync(path.join(dest, '.git', 'objects', 'pack')).sort();
        const before = { tree: snapshotDir(dest), missing: missing(), packs: packs() };
        expect(before.missing).toBeGreaterThan(0);

        const r = ok(listChanges(dest, { since: SINCE_48H }));

        expect({ tree: snapshotDir(dest), missing: missing(), packs: packs() }).toEqual(before);
        expect(byClass(r)).toEqual({ 'fix: next': 'missing', 'feat: first': 'invalid-record' });
        expect(r.changes[1].records).toEqual([{ path: recordPath(FIRST), diagnostics: [expect.objectContaining({ code: 'git-failed' })] }]);
    });
    // The history of `historyIn`, listed once under a git spy: the next four tests only read the calls it made.
    const historyCalls = (() => { const shared = sharedListing(history); return (): string[][] => shared().calls; })();
    test('every git call is read-only', () => {
        const subcommands = new Set(historyCalls().map((a) => a.find((x) => !x.startsWith('-') && x !== 'diff.relative=false') ?? ''));
        expect([...subcommands].sort()).toEqual(expect.arrayContaining(['log']));
        for (const name of subcommands) expect(['rev-parse', 'log', 'diff', 'ls-tree', 'show', 'for-each-ref', 'config']).toContain(name);
    });
    test('every git log carries the safety flags', () => {
        const logs = historyCalls().filter((a) => a.includes('log'));
        expect(logs.length).toBeGreaterThanOrEqual(3);
        for (const call of logs) {
            expect(call).toContain('--no-show-signature');
            expect(call).toContain('--encoding=UTF-8');
            expect(call).toContain('--end-of-options');
        }
    });
    test('pathspecs are literal and follow a --', () => {
        const withPath = historyCalls().filter((a) => a.some((x) => x.includes('docs/changes')));
        expect(withPath.length).toBeGreaterThan(0);
        for (const call of withPath) {
            const dash = call.indexOf('--');
            expect(dash).toBeGreaterThan(-1);
            expect(call.slice(dash + 1).every((x) => x.startsWith(':(top,literal)') || x.startsWith(':(top,glob)docs/changes/') || /^docs\/changes\/[a-z0-9-]+\.md$/.test(x))).toBe(true);
        }
    });
    test('the history is read along the first parent only, in pages', () => {
        const scans = historyCalls().filter((a) => a.includes('log') && a.some((x) => x.startsWith('--max-count=')));
        expect(scans.length).toBeGreaterThanOrEqual(2);
        for (const call of scans) { expect(call).toContain('--first-parent'); expect(call).toContain(`--max-count=${PAGE_SIZE}`); }
    });
    test('git calls per entry are constant: recorded entries cost the same however long the history', () => {
        adopt();
        const add = (from: number, to: number): void => commitMany(Array.from({ length: to - from + 1 }, (_, k) => {
            const i = from + k;
            const id = `2026-10-16-r${String(i).padStart(3, '0')}`;
            return [{ [recordPath(id)]: record(id) }, `feat: r${i}`, '2026-10-16T10:00:00Z'];
        }));
        const count = (): number => { const spy = spyOnGit(); const r = listed(); spy.restore(); expect(r.changes.length).toBeGreaterThan(0); return spy.calls.length; };
        add(1, 5);
        const small = count();
        add(6, 25);
        const large = count();
        expect((large - small) / 20).toBeLessThanOrEqual(5);
        expect(large - small).toBeGreaterThan(0);
    });
});
