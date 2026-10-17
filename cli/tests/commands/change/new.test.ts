import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import childProcess from 'child_process';
import { cloneRepo, makeRepo, nonRepoDir, posixOnly, type TestRepo } from '../../core/changes/helpers';
import { registerChangeCommand, runChangeNew, type NewOpts } from '../../../src/commands/change';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { buildReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { loadFrontmatter, splitRecord } from '../../../src/core/changes/parse';
import * as renderModule from '../../../src/core/changes/render';
import { validateRecordShape } from '../../../src/core/changes/validate-shape';
import { PENDING_MARKER, type Verification } from '../../../src/core/changes/types';
import type { CommandResult } from '../../../src/core/command-result';

const REAL_CHANGES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'changes');
const listReal = (): string[] | null => { try { return fs.readdirSync(REAL_CHANGES_DIR).sort(); } catch { return null; } };
const realBefore = listReal();

let repo: TestRepo;
const now = () => new Date('2026-10-17T12:00:00.000Z');
const pass = { overall: 'pass' as const, sensors: [{ name: 'lint', status: 'pass' as const, errors: [] }] };
const RECEIPT_TIME = '2026-10-17T11:00:00.000Z';
const REMEDY = 'commit your work, then run awm sensors run';

function receiptForHead(): void {
    writeReceipt(repo.root, buildReceipt({ commit: repo.git('rev-parse', 'HEAD'), ranAt: RECEIPT_TIME, cliVersion: '9.20.0', output: pass as never }));
}
// One template repository for the whole file (it also holds HOME and AWM_HOME on a throwaway home); every test gets a copy.
let template: TestRepo;
beforeAll(() => {
    template = makeRepo();
    template.git('checkout', '-q', '-b', 'feat/x');
    template.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): a');
});
afterAll(() => template.cleanup());
function newRepo(): void {
    repo = cloneRepo(template);
}
/** A fresh repository for every test: for tests that write a record, move HEAD or change the tree. */
function freshRepo(): void {
    beforeEach(newRepo);
    afterEach(() => { jest.restoreAllMocks(); repo.cleanup(); });
}
/**
 * One repository (with a receipt for HEAD) for a whole group. Only for tests that are refused before anything is written
 * (they never change HEAD, the tree that matters, or docs/changes): they would otherwise pay for a repository each.
 */
function sharedRepo(): void {
    beforeAll(() => { newRepo(); receiptForHead(); });
    afterAll(() => repo.cleanup());
}
// The command writes only into the throwaway repository: the real checkout is never touched.
afterEach(() => expect(listReal()).toEqual(realBefore));
afterAll(() => expect(listReal()).toEqual(realBefore));

type AnyFn = (...args: unknown[]) => unknown;
/** Replaces one fs function for the calls `match` selects (by their arguments); every other call reaches the real one. */
function interceptFs(name: 'readdirSync' | 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'readFileSync', match: (args: unknown[]) => boolean, replace: (real: AnyFn, args: unknown[]) => unknown): jest.SpyInstance {
    const real = fs[name] as unknown as AnyFn;
    return jest.spyOn(fs, name).mockImplementation(((...args: unknown[]) => (match(args) ? replace(real, args) : real(...args))) as never);
}
const baseIs = (arg: unknown, name: string): boolean => typeof arg === 'string' && path.basename(arg) === name;
const isRecordsDirArg = (arg: unknown): boolean => baseIs(arg, 'changes') && baseIs(path.dirname(String(arg)), 'docs');

const recordsDir = () => path.join(repo.root, 'docs', 'changes');
const file = () => path.join(recordsDir(), '2026-10-17-change-record.md');
const run = (slug: string, opts: NewOpts = {}, deps: { now?: () => Date } = { now }) => runChangeNew(repo.root, slug, opts, deps);
const read = () => fs.readFileSync(file(), 'utf8');
const frontmatter = (text: string): Record<string, unknown> => {
    const split = splitRecord(text);
    if (!split.ok) throw new Error('not a record');
    const loaded = loadFrontmatter(split.frontmatterText);
    if (!loaded.ok) throw new Error('bad yaml');
    return loaded.value as Record<string, unknown>;
};
/** The failure contract: exit 2, nothing on stdout, `code: <one line of at most 300 units>` (+ an optional remedy line). */
function expectFailure(r: CommandResult, code: string, remedy?: string): void {
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    const lines = r.stderr.split('\n');
    expect(lines[lines.length - 1]).toBe('');
    expect(lines[0].startsWith(`${code}: `)).toBe(true);
    expect(lines[0].length).toBeLessThanOrEqual(300);
    // eslint-disable-next-line no-control-regex
    expect(r.stderr).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
    if (remedy !== undefined) expect(lines[1]).toBe(`  remedy: ${remedy}`);
    expect(lines.length).toBe(remedy === undefined ? 2 : 3);
}
const recordFiles = (): string[] => { try { return fs.readdirSync(recordsDir()).sort(); } catch { return []; } };

describe('test isolation', () => {
    freshRepo();
    test('HOME and AWM_HOME point into the throwaway home', () => {
        expect(process.env.HOME).toBe(repo.home);
        expect(process.env.AWM_HOME).toBe(path.join(repo.home, '.awm'));
        expect(fs.realpathSync.native(repo.root).startsWith(fs.realpathSync.native(os.tmpdir()))).toBe(true);
    });
});

describe('awm change new: receipt and clean tree (R3.6)', () => {
    freshRepo();
    test('a missing receipt fails with receipt-missing and the remedy, writing nothing', () => {
        expectFailure(run('change-record'), 'receipt-missing', REMEDY);
        expect(recordFiles()).toEqual([]);
    });
    test('an untracked file outside docs/changes fails with tree-dirty and the remedy', () => {
        receiptForHead();
        fs.writeFileSync(path.join(repo.root, 'dirty.ts'), 'x');
        expectFailure(run('change-record'), 'tree-dirty', REMEDY);
        expect(recordFiles()).toEqual([]);
    });
    test('a modified tracked file fails with tree-dirty', () => {
        receiptForHead();
        fs.writeFileSync(path.join(repo.root, 'cli', 'src', 'a.ts'), '2');
        expectFailure(run('change-record'), 'tree-dirty', REMEDY);
    });
    test('another uncommitted record in docs/changes does not make the tree dirty', () => {
        receiptForHead();
        fs.mkdirSync(recordsDir(), { recursive: true });
        fs.writeFileSync(path.join(recordsDir(), '2026-10-01-other.md'), 'draft');
        expect(run('change-record').code).toBe(0);
    });
    test('a receipt for another commit is receipt-missing', () => {
        receiptForHead();
        repo.commit({ 'cli/src/b.ts': '1' }, 'fix(changes): b');
        expectFailure(run('change-record'), 'receipt-missing', REMEDY);
    });
    test('a tampered receipt is receipt-invalid', () => {
        receiptForHead();
        const receiptFile = path.join(repo.root, '.awm', 'sensors', 'runs', `${repo.git('rev-parse', 'HEAD')}.json`);
        fs.writeFileSync(receiptFile, fs.readFileSync(receiptFile, 'utf8').replace('"pass"', '"fail"'));
        expectFailure(run('change-record'), 'receipt-invalid', REMEDY);
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: skeleton (R3.7, R3.9)', () => {
    freshRepo();
    test('prints the created path and writes exactly that file', () => {
        receiptForHead();
        const r = run('change-record');
        expect(r).toEqual({ code: 0, stdout: 'Created docs/changes/2026-10-17-change-record.md\n', stderr: '' });
        expect(recordFiles()).toEqual(['2026-10-17-change-record.md']);
    });
    test('derives type, scope, semver, breaking and modules from the branch commits', () => {
        receiptForHead();
        run('change-record');
        const fm = frontmatter(read());
        expect(fm).toMatchObject({ schema: 'awm.change-record/v1', id: '2026-10-17-change-record', type: 'feat', scope: 'changes', semver: 'minor', breaking: false, modules: ['cli/src'] });
    });
    test('copies commit, overall, sensors and the digest of the receipt into verification', () => {
        receiptForHead();
        run('change-record');
        const expected: Verification = {
            commit: repo.git('rev-parse', 'HEAD'),
            overall: 'pass',
            sensors: { lint: 'pass' },
            receipt_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as never,
        };
        expect(frontmatter(read()).verification).toEqual(expected);
    });
    test('the digest is the receipt digest, not a recomputation of the record', () => {
        receiptForHead();
        const receiptFile = path.join(repo.root, '.awm', 'sensors', 'runs', `${repo.git('rev-parse', 'HEAD')}.json`);
        const digest = (JSON.parse(fs.readFileSync(receiptFile, 'utf8')) as { digest: string }).digest;
        run('change-record');
        expect((frontmatter(read()).verification as Verification).receipt_digest).toBe(digest);
    });
    test('every narrative field and every body section carries the pending marker', () => {
        receiptForHead();
        run('change-record');
        const text = read();
        const fm = frontmatter(text);
        expect(fm.title).toBe(PENDING_MARKER);
        expect(fm.summary_short).toBe(PENDING_MARKER);
        expect(fm.manual_validation).toEqual([{ step: PENDING_MARKER, expected: PENDING_MARKER }]);
        expect(fm.risks).toEqual([PENDING_MARKER]);
        expect(fm.rollback).toBe(PENDING_MARKER);
        for (const heading of ['## Qué se hizo', '## Qué se probó', '## Qué falta validar', '## Riesgos y rollback']) {
            expect(text).toContain(`${heading}\n\n${PENDING_MARKER}\n`);
        }
    });
    test('the skeleton fails validation only because of its pending markers', () => {
        receiptForHead();
        run('change-record');
        const { diagnostics } = validateRecordShape('2026-10-17-change-record.md', read(), { root: repo.root });
        expect(diagnostics.map((d) => d.code)).toEqual(['pending-content']);
    });
    test('once the markers are replaced the record passes validateRecordShape', () => {
        repo.commit({ 'docs/plans/p.md': 'plan' }, 'docs: plan');
        receiptForHead();
        run('change-record', { plan: 'docs/plans/p.md', issue: 'https://github.com/o/r/issues/217', model: 'm1', session: 's1' });
        const filled = read().split(PENDING_MARKER).join('written by the agent');
        const r = validateRecordShape('2026-10-17-change-record.md', filled, { root: repo.root });
        expect(r.diagnostics).toEqual([]);
        expect(r.record?.verification.commit).toBe(repo.git('rev-parse', 'HEAD'));
    });
    test('links carry --plan and --issue exactly as given', () => {
        repo.commit({ 'docs/plans/p.md': 'plan' }, 'docs: plan');
        receiptForHead();
        run('change-record', { plan: 'docs/plans/p.md', issue: 'https://github.com/o/r/issues/217' });
        expect(frontmatter(read()).links).toEqual({ plan: 'docs/plans/p.md', issue: 'https://github.com/o/r/issues/217' });
    });
    test('without --plan and --issue there is no links key', () => {
        receiptForHead();
        run('change-record');
        expect(frontmatter(read())).not.toHaveProperty('links');
    });
    test('the record ends with a newline and uses LF only', () => {
        receiptForHead();
        run('change-record');
        const text = read();
        expect(text.endsWith('\n')).toBe(true);
        expect(text).not.toContain('\r');
    });
    test('a record is written outside the cwd-relative path: running from a subdirectory writes at the repo root', () => {
        receiptForHead();
        const sub = path.join(repo.root, 'cli', 'src');
        expect(runChangeNew(sub, 'change-record', {}, { now }).code).toBe(0);
        expect(recordFiles()).toEqual(['2026-10-17-change-record.md']);
        expect(fs.existsSync(path.join(sub, 'docs'))).toBe(false);
    });
    test('the date comes from the injected clock, in UTC', () => {
        receiptForHead();
        run('change-record', {}, { now: () => new Date('2027-01-02T23:59:59.000Z') });
        expect(recordFiles()).toEqual(['2027-01-02-change-record.md']);
    });
    test.each<[string, () => Date]>([
        ['an invalid date', () => new Date(NaN)],
        ['a year beyond 9999', () => new Date('+010000-01-01T00:00:00.000Z')],
        ['a clock that throws', () => { throw new Error('boom'); }],
        ['a clock that returns a string', (() => 'x') as never],
    ])('an unusable clock (%s) fails with date-invalid and writes nothing', (_name, bad) => {
        receiptForHead();
        expectFailure(run('change-record', {}, { now: bad }), 'date-invalid');
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: generated record is checked before it is written', () => {
    freshRepo();
    test('a skeleton over the record size limit is skeleton-invalid and writes nothing', () => {
        const sensors = Array.from({ length: 700 }, (_, i) => ({ name: `sensor-${String(i).padStart(4, '0')}-${'x'.repeat(100)}`, status: 'pass' as const, errors: [] }));
        writeReceipt(repo.root, buildReceipt({ commit: repo.git('rev-parse', 'HEAD'), ranAt: RECEIPT_TIME, cliVersion: '9.20.0', output: { overall: 'pass', sensors } as never }));
        const r = run('change-record');
        expectFailure(r, 'skeleton-invalid');
        expect(r.stderr).toContain('record-too-large');
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: HEAD moving while the command runs', () => {
    freshRepo();
    test('a HEAD that moves before the record is written is git-failed and nothing is written', () => {
        receiptForHead();
        const moving = () => { repo.commit({ 'cli/src/late.ts': '1' }, 'fix(core): late'); return now(); };
        expectFailure(run('change-record', {}, { now: moving }), 'git-failed');
        expect(recordFiles()).toEqual([]);
    });
    test('a HEAD that moves before a refresh is written is git-failed and the record is untouched', () => {
        receiptForHead();
        run('change-record');
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): record');
        receiptForHead();
        const before = read();
        const spy = interceptFs('readFileSync', (a) => baseIs(a[0], path.basename(file())), (real, a) => {
            const out = real(...a);
            spy.mockRestore();
            repo.commit({ 'cli/src/late.ts': '1' }, 'fix(core): late');
            return out;
        });
        expectFailure(run('change-record', { refresh: true }), 'git-failed');
        expect(read()).toBe(before);
    });
});

describe('awm change new: HEAD is pinned before the derivation', () => {
    freshRepo();
    /** Runs `act` once, right before (or after) the first git call whose first argument is `sub`. */
    function onGit(sub: string, when: 'before' | 'after', act: () => void): jest.SpyInstance {
        const real = childProcess.execFileSync;
        let fired = false;
        return jest.spyOn(childProcess, 'execFileSync').mockImplementation(((...args: Parameters<typeof real>) => {
            const git = Array.isArray(args[1]) ? (args[1] as string[]) : [];
            const hit = !fired && args[0] === 'git' && git.includes(sub);
            if (hit) fired = true;
            if (hit && when === 'before') act();
            const out = real(...args);
            if (hit && when === 'after') act();
            return out;
        }) as never);
    }
    const land = () => {
        // A commit lands and leaves an untracked file: with no early check the dirty-tree diagnostic would come first.
        repo.commit({ 'cli/src/late.ts': '1' }, 'fix(core): late');
        fs.writeFileSync(path.join(repo.root, 'late-untracked.txt'), 'x');
    };
    test('a commit landing between the pin and the derivation is git-failed, not a record of mixed commits', () => {
        receiptForHead();
        onGit('merge-base', 'after', land);
        expectFailure(run('change-record'), 'git-failed');
        expect(recordFiles()).toEqual([]);
    });
    test('the message says HEAD moved during derivation', () => {
        receiptForHead();
        onGit('merge-base', 'after', land);
        expect(run('change-record').stderr).toContain('HEAD moved during derivation');
    });
    test('a commit landing after the derivation but before the write is git-failed', () => {
        receiptForHead();
        onGit('status', 'before', () => repo.commit({ 'cli/src/late.ts': '1' }, 'fix(core): late'));
        expectFailure(run('change-record'), 'git-failed');
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: provenance (R3.8)', () => {
    freshRepo();
    const writeJournalWith = (patch: (state: ReturnType<typeof readStateOrThrow>) => void): void => {
        initJournal(repo.root, 'feat/x');
        const state = readStateOrThrow();
        patch(state);
        writeJournal(repo.root, 'feat/x', state);
    };
    function readStateOrThrow() {
        const r = readJournal(repo.root, 'feat/x');
        if (!r.state) throw new Error('no journal');
        return r.state;
    }
    test('omits the provenance key entirely when no source exists', () => {
        receiptForHead();
        run('change-record');
        expect(frontmatter(read())).not.toHaveProperty('provenance');
    });
    test('model and session come only from flags', () => {
        receiptForHead();
        run('change-record', { model: 'm1', session: 'https://claude.ai/code/session_x' });
        expect(frontmatter(read()).provenance).toEqual({ model: 'm1', session: 'https://claude.ai/code/session_x' });
    });
    test('agent and timestamps come from the branch journal', () => {
        writeJournalWith((s) => { s.admissionContext = { provider: 'claude-code' }; s.cycle.completedAt = '2026-10-17T10:30:00.000Z'; s.cycle.startedAt = '2026-10-17T09:00:00.000Z'; });
        receiptForHead();
        run('change-record', { model: 'm1' });
        expect(frontmatter(read()).provenance).toEqual({ agent: 'claude-code', started_at: '2026-10-17T09:00:00.000Z', finished_at: '2026-10-17T10:30:00.000Z', model: 'm1' });
    });
    test('a journal without admissionContext and completedAt yields only started_at', () => {
        writeJournalWith((s) => { s.cycle.startedAt = '2026-10-17T09:00:00.000Z'; });
        receiptForHead();
        run('change-record');
        expect(frontmatter(read()).provenance).toEqual({ started_at: '2026-10-17T09:00:00.000Z' });
    });
    test('a journal timestamp that is not canonical ISO is omitted, never copied', () => {
        writeJournalWith((s) => { s.cycle.startedAt = 'yesterday'; s.admissionContext = { provider: 'codex' }; });
        receiptForHead();
        expect(run('change-record').code).toBe(0);
        expect(frontmatter(read()).provenance).toEqual({ agent: 'codex' });
    });
    test('a corrupt journal is ignored: no journal keys and no error', () => {
        initJournal(repo.root, 'feat/x');
        const journalFile = path.join(repo.root, '.awm', 'journal', 'feat_2Fx', 'state.json');
        fs.writeFileSync(journalFile, '{ not json');
        receiptForHead();
        expect(run('change-record', { model: 'm1' }).code).toBe(0);
        expect(frontmatter(read()).provenance).toEqual({ model: 'm1' });
    });
    test('a journal of another branch is not used', () => {
        initJournal(repo.root, 'other');
        const other = readJournal(repo.root, 'other').state;
        if (!other) throw new Error('no journal');
        writeJournal(repo.root, 'other', { ...other, admissionContext: { provider: 'codex' } });
        receiptForHead();
        run('change-record');
        expect(frontmatter(read())).not.toHaveProperty('provenance');
    });
    test('a detached HEAD has no journal and is not an error', () => {
        repo.git('checkout', '-q', '--detach');
        receiptForHead();
        expect(run('change-record').code).toBe(0);
        expect(frontmatter(read())).not.toHaveProperty('provenance');
    });
});

describe('awm change new: no overwrite (R3.10)', () => {
    freshRepo();
    test('refuses to overwrite on the same date and leaves the file untouched', () => {
        receiptForHead();
        run('change-record');
        fs.writeFileSync(file(), 'edited by hand');
        expectFailure(run('change-record'), 'record-exists', 'use --refresh to update derived fields');
        expect(read()).toBe('edited by hand');
    });
    test('refuses the same slug on another date', () => {
        receiptForHead();
        run('change-record');
        const before = read();
        expectFailure(run('change-record', {}, { now: () => new Date('2026-10-20T12:00:00.000Z') }), 'record-exists', 'use --refresh to update derived fields');
        expect(recordFiles()).toEqual(['2026-10-17-change-record.md']);
        expect(read()).toBe(before);
    });
    test('a different slug is not blocked by an existing record', () => {
        receiptForHead();
        run('change-record');
        expect(run('change-record-2').code).toBe(0);
        expect(recordFiles()).toEqual(['2026-10-17-change-record-2.md', '2026-10-17-change-record.md']);
    });
    test('a slug that is only a prefix of an existing slug is not blocked', () => {
        receiptForHead();
        run('change-record-long');
        expect(run('change-record').code).toBe(0);
    });
    posixOnly('a symlink named like the record counts as existing and its target is not written', () => {
        receiptForHead();
        fs.mkdirSync(recordsDir(), { recursive: true });
        const outside = path.join(repo.home, 'outside.md');
        fs.writeFileSync(outside, 'precious');
        fs.symlinkSync(outside, file());
        expectFailure(run('change-record'), 'record-exists', 'use --refresh to update derived fields');
        expect(fs.readFileSync(outside, 'utf8')).toBe('precious');
    });
    test('a listing that misses an existing file still never overwrites it (exclusive create)', () => {
        receiptForHead();
        run('change-record');
        fs.writeFileSync(file(), 'edited by hand');
        interceptFs('readdirSync', (a) => isRecordsDirArg(a[0]), () => []);
        expectFailure(run('change-record'), 'record-exists', 'use --refresh to update derived fields');
        expect(read()).toBe('edited by hand');
    });
    test('an unreadable docs/changes listing fails closed instead of creating', () => {
        receiptForHead();
        fs.mkdirSync(recordsDir(), { recursive: true });
        interceptFs('readdirSync', (a) => isRecordsDirArg(a[0]), () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
        expectFailure(run('change-record'), 'io-failed');
        jest.restoreAllMocks();
        expect(fs.readdirSync(recordsDir())).toEqual([]);
    });
    test('a failed write leaves no partial file behind', () => {
        receiptForHead();
        // Only the write through the descriptor of the new record fails (the create itself succeeded).
        interceptFs('writeFileSync', (a) => typeof a[0] === 'number', () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); });
        expectFailure(run('change-record'), 'io-failed');
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: slug validation (R3.12)', () => {
    sharedRepo();
    const BAD_SLUGS = ['../evil', 'a/b', 'a\\b', 'Upper', 'a_b', '', '-a', 'a-', 'a--b', 'a b', 'a\nb', 'a'.repeat(65), 'é', '.hidden'];
    test.each(BAD_SLUGS)('rejects the slug %j before building any path', (slug) => {
        expectFailure(run(slug), 'slug-invalid');
        expect(fs.existsSync(recordsDir())).toBe(false);
    });
    test.each<[string, unknown]>([['undefined', undefined], ['an object with toString', { toString: () => 'ok' }]])('a non-string slug (%s) is slug-invalid, not a throw', (_name, slug) => {
        expectFailure(runChangeNew(repo.root, slug as never, {}, { now }), 'slug-invalid');
    });
    test('a hostile slug never reaches the diagnostic raw', () => {
        const r = run('a\u2028b\u001b[31m'.repeat(40));
        expectFailure(r, 'slug-invalid');
        expect(r.stderr).not.toContain('\u001b');
    });
    test('the whole first line, code included, is clipped to 300 units for a hostile slug', () => {
        const r = run('\0'.repeat(80));
        expectFailure(r, 'slug-invalid');
        expect(r.stderr.split('\n')[0].length).toBe(300);
        expect(r.stderr.split('\n')[0].endsWith('…')).toBe(true);
    });
});

describe('awm change new: path safety (R3.12)', () => {
    freshRepo();
    test('accepts a slug of exactly 64 characters', () => {
        receiptForHead();
        expect(run('a'.repeat(64)).code).toBe(0);
    });
    posixOnly('refuses a symlinked docs/changes and writes nothing through it', () => {
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.mkdirSync(path.join(repo.root, 'docs'), { recursive: true });
        fs.symlinkSync(outside, recordsDir());
        expectFailure(run('ok'), 'unsafe-path');
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    posixOnly('refuses a symlinked docs and creates nothing through it', () => {
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.symlinkSync(outside, path.join(repo.root, 'docs'));
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'chore: link docs');
        receiptForHead();
        expectFailure(run('ok'), 'unsafe-path');
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    test('refuses when docs/changes is a regular file', () => {
        receiptForHead();
        fs.mkdirSync(path.join(repo.root, 'docs'), { recursive: true });
        fs.writeFileSync(recordsDir(), 'x');
        expectFailure(run('ok'), 'unsafe-path');
        expect(fs.readFileSync(recordsDir(), 'utf8')).toBe('x');
    });
    posixOnly('refuses to refresh through a symlinked docs/changes', () => {
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.writeFileSync(path.join(outside, '2026-10-17-ok.md'), 'precious');
        fs.mkdirSync(path.join(repo.root, 'docs'), { recursive: true });
        fs.symlinkSync(outside, recordsDir());
        expectFailure(run('ok', { refresh: true }), 'unsafe-path');
        expect(fs.readFileSync(path.join(outside, '2026-10-17-ok.md'), 'utf8')).toBe('precious');
    });
    posixOnly('a link planted in place of docs while it is being created is refused, and nothing is created through it', () => {
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        interceptFs('mkdirSync', (a) => baseIs(a[0], 'docs'), (_real, a) => { fs.symlinkSync(outside, String(a[0])); });
        expectFailure(run('ok'), 'unsafe-path');
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    posixOnly('a link planted in place of changes while it is being created is refused, and nothing is created through it', () => {
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        interceptFs('mkdirSync', (a) => isRecordsDirArg(a[0]), (_real, a) => { fs.symlinkSync(outside, String(a[0])); });
        expectFailure(run('ok'), 'unsafe-path');
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    test('creates docs/changes when it does not exist yet', () => {
        receiptForHead();
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
        expect(run('ok').code).toBe(0);
        expect(fs.statSync(recordsDir()).isDirectory()).toBe(true);
    });
    test('a failure before the write never creates docs/changes', () => {
        expectFailure(run('ok'), 'receipt-missing', REMEDY);
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
    });
});

/** The command refuses `opts` as `flag-invalid`, names `what`, and writes nothing. */
const badFlag = (opts: NewOpts, what: string): void => {
    const r = run('ok', opts);
    expectFailure(r, 'flag-invalid');
    expect(r.stderr).toContain(what);
    expect(recordFiles()).toEqual([]);
};

describe('awm change new: refused flags (R3.12, R3.11b)', () => {
    sharedRepo();
    const bad = badFlag;
    test.each<[string, string]>([
        ['http is refused', 'http://example.com/1'],
        ['a non-URL is refused', 'not a url'],
        ['javascript: is refused', 'javascript:alert(1)'],
        ['embedded credentials are refused', 'https://user@example.com/1'],
        ['whitespace is refused', 'https://example.com/a b'],
        ['a line break is refused', 'https://example.com/a\nb: c'],
        ['a host-less https is refused', 'https://'],
        ['a very long URL is refused', `https://example.com/${'a'.repeat(3000)}`],
        ['a lone surrogate is refused', 'https://example.com/\ud800'],
    ])('--issue: %s', (_name, issue) => bad({ issue }, '--issue'));
    test.each<[string, string]>([
        ['a line break', 'a\nb'],
        ['a control character', 'a\u0000b'],
        ['U+2028', 'a\u2028b'],
        ['an empty value', ''],
        ['a blank value', '   '],
        ['201 characters', 'm'.repeat(201)],
        ['201 code points', '\u{1F600}'.repeat(201)],
        ['a lone surrogate', 'a\ud800b'],
    ])('--model: %s is refused', (_name, model) => bad({ model }, '--model'));
    test.each<[string, string]>([['a line break', 'a\r\nb'], ['201 characters', 's'.repeat(201)], ['a blank value', ' ']])('--session: %s is refused', (_name, session) => bad({ session }, '--session'));
    test.each<[string, NewOpts, string]>([
        ['--model as a number', { model: 5 as never }, '--model'],
        ['--plan as an array', { plan: ['a'] as never }, '--plan'],
        ['--refresh as a string', { refresh: 'yes' as never }, '--refresh'],
    ])('a flag that is not the right type is refused (%s)', (_name, opts, what) => bad(opts, what));
    test.each<[string, string]>([
        ['a missing file', 'docs/plans/missing.md'],
        ['.. segments', '../outside.md'],
        ['an absolute path', path.join(path.sep, 'etc', 'passwd')],
        ['a backslash path', 'docs\\plans\\p.md'],
        ['a drive-letter path', 'C:/plan.md'],
        ['a directory', 'cli'],
    ])('--plan: %s is refused', (_name, plan) => bad({ plan }, '--plan'));
    test('a hostile --plan value never reaches the diagnostic raw', () => {
        const r = run('ok', { plan: 'a\u001b[31m\nb' });
        expectFailure(r, 'flag-invalid');
        expect(r.stderr).not.toContain('\u001b');
    });
    test('a non-object opts is flag-invalid, not a throw', () => {
        expectFailure(runChangeNew(repo.root, 'ok', 'x' as never, { now }), 'flag-invalid');
    });
    test.each<[string, NewOpts]>([
        ['--plan', { plan: 'README.md' }],
        ['--issue', { issue: 'https://example.com/1' }],
        ['--model', { model: 'm1' }],
        ['--session', { session: 's1' }],
    ])('--refresh together with %s is flag-invalid and writes nothing', (flag, opts) => {
        const r = run('ok', { ...opts, refresh: true });
        expectFailure(r, 'flag-invalid');
        expect(r.stderr).toContain('--refresh');
        expect(r.stderr).toContain(flag);
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
    });
});

describe('awm change new: --plan through links', () => {
    freshRepo();
    beforeEach(() => receiptForHead());
    posixOnly('--plan: a symlink is refused', () => {
        fs.symlinkSync(path.join(repo.root, 'README.md'), path.join(repo.root, 'link.md'));
        badFlag({ plan: 'link.md' }, '--plan');
    });
    posixOnly('--plan: a file reached through a symlinked directory outside the repository is refused', () => {
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.writeFileSync(path.join(outside, 'p.md'), 'x');
        fs.symlinkSync(outside, path.join(repo.root, 'plans'));
        badFlag({ plan: 'plans/p.md' }, '--plan');
    });
});

describe('awm change new: accepted flags', () => {
    freshRepo();
    beforeEach(() => receiptForHead());
    test.each<[string, NewOpts]>([
        ['--issue https', { issue: 'https://example.com/1' }],
        ['--model of 200 characters', { model: 'm'.repeat(200) }],
        ['--model of 200 code points', { model: '\u{1F600}'.repeat(200) }],
        ['--session', { session: 'abc' }],
        ['--plan an existing repo file', { plan: 'README.md' }],
    ])('%s is accepted', (_name, opts) => {
        expect(run('ok', opts).code).toBe(0);
    });
});

describe('awm change new: unsafe --base (R3.5)', () => {
    sharedRepo();
    test.each(['-x', '--upload-pack=evil', 'a..b', 'a b', 'a\nb', 'HEAD~1', 'a^', 'a:b', 'a@{1}', ''])('an unsafe --base %j is invalid-input', (base) => {
        expectFailure(run('ok', { base }), 'invalid-input');
    });
    test('a hostile --base is echoed escaped, on one line of at most 300 units', () => {
        const r = run('ok', { base: '\0\u001b[31m'.repeat(80) });
        expectFailure(r, 'invalid-input');
        expect(r.stderr).toContain('\\u0000');
    });
});

describe('awm change new: base and derivation diagnostics (R3.1, R3.2, R3.5)', () => {
    freshRepo();
    test('an unknown --base is base-unresolved with its remedy', () => {
        receiptForHead();
        expectFailure(run('ok', { base: 'nope' }), 'base-unresolved', 'pass --base <ref>');
    });
    test('no main, master or origin/HEAD is base-unresolved', () => {
        repo.git('branch', '-m', 'main', 'trunk');
        receiptForHead();
        expectFailure(run('ok'), 'base-unresolved', 'pass --base <ref>');
    });
    test('an explicit --base is used instead of main', () => {
        repo.git('branch', 'trunk', 'main');
        repo.commit({ 'cli/src/b.ts': '1' }, 'fix(core): b');
        receiptForHead();
        repo.git('branch', 'mid', 'HEAD~1');
        run('change-record', { base: 'mid' });
        expect(frontmatter(read())).toMatchObject({ type: 'fix', scope: 'core', semver: 'patch', modules: ['cli/src'] });
    });
    test('a branch with no commits beyond the base is no-commits', () => {
        repo.git('checkout', '-q', 'main');
        expectFailure(run('ok'), 'no-commits');
    });
    test('only non-conventional commits is no-conventional-commits', () => {
        repo.git('checkout', '-q', '-b', 'feat/z', 'main');
        repo.commit({ 'cli/src/z.ts': '1' }, 'update some things');
        expectFailure(run('ok'), 'no-conventional-commits');
    });
    test('base and HEAD without a common ancestor is base-unresolved', () => {
        repo.git('checkout', '-q', '--orphan', 'orphan');
        repo.git('rm', '-rf', '-q', '.');
        repo.commit({ 'o.ts': '1' }, 'feat: orphan');
        receiptForHead();
        expectFailure(run('ok'), 'base-unresolved', 'pass --base <ref>');
    });
    test('outside a git repository it fails with not-a-git-repo', () => {
        expectFailure(runChangeNew(nonRepoDir(repo), 'ok', {}, { now }), 'not-a-git-repo');
    });
    test('a non-string cwd fails without throwing', () => {
        expectFailure(runChangeNew(undefined as never, 'ok', {}, { now }), 'invalid-input');
    });
});

describe('awm change new --refresh (R3.11)', () => {
    freshRepo();
    function recordCommitted(mutate: (text: string) => string = (t) => t): string {
        receiptForHead();
        run('change-record');
        const edited = mutate(read().split(PENDING_MARKER).join('written by agent'));
        fs.writeFileSync(file(), edited);
        repo.git('add', '-A');
        repo.git('commit', '-q', '-m', 'docs(changes): record');
        repo.commit({ 'cli/src/core/b.ts': '1' }, 'fix(core): b');
        receiptForHead();
        return edited;
    }
    const strip = (s: string) => s.replace(/^(type|scope|semver|breaking|modules|verification):[\s\S]*?(?=^[a-z_]+:|^---$)/gm, '');

    test('recomputes the derived fields and verification', () => {
        recordCommitted();
        const r = run('change-record', { refresh: true });
        expect(r).toEqual({ code: 0, stdout: 'Refreshed docs/changes/2026-10-17-change-record.md\n', stderr: '' });
        const fm = frontmatter(read());
        expect((fm.verification as Verification).commit).toBe(repo.git('rev-parse', 'HEAD'));
        expect(fm.modules).toEqual(['cli/src', 'cli/src/core']);
        expect(fm).toMatchObject({ type: 'feat', scope: 'changes', semver: 'minor' });
    });
    test('every byte outside the derived keys and verification is unchanged', () => {
        const edited = recordCommitted();
        run('change-record', { refresh: true });
        expect(strip(read())).toBe(strip(edited));
        expect(read()).not.toBe(edited);
    });
    test('the refreshed record still validates', () => {
        recordCommitted();
        run('change-record', { refresh: true });
        expect(validateRecordShape('2026-10-17-change-record.md', read(), { root: repo.root }).diagnostics).toEqual([]);
    });
    test('refresh works on the record of another date', () => {
        recordCommitted();
        run('change-record', { refresh: true }, { now: () => new Date('2030-01-01T00:00:00.000Z') });
        expect(frontmatter(read()).id).toBe('2026-10-17-change-record');
    });
    test('a CRLF record keeps CRLF everywhere and its other bytes', () => {
        const edited = recordCommitted((t) => t.replace(/\n/g, '\r\n'));
        run('change-record', { refresh: true });
        const after = read();
        expect(after).not.toMatch(/[^\r]\n/);
        expect(strip(after.replace(/\r\n/g, '\n'))).toBe(strip(edited.replace(/\r\n/g, '\n')));
        expect((frontmatter(after).verification as Verification).commit).toBe(repo.git('rev-parse', 'HEAD'));
    });
    test('refresh does not require a clean tree for docs/changes itself but still refuses other changes', () => {
        recordCommitted();
        fs.writeFileSync(path.join(repo.root, 'dirty.ts'), 'x');
        expectFailure(run('change-record', { refresh: true }), 'tree-dirty', REMEDY);
    });
    test('refresh needs a receipt for HEAD', () => {
        recordCommitted();
        fs.rmSync(path.join(repo.root, '.awm', 'sensors'), { recursive: true });
        expectFailure(run('change-record', { refresh: true }), 'receipt-missing', REMEDY);
    });
    test('a missing record is record-missing and creates nothing', () => {
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-missing', 'run awm change new change-record to create it');
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
    });
    test('an existing docs/changes without that slug is record-missing', () => {
        receiptForHead();
        run('other');
        expectFailure(run('change-record', { refresh: true }), 'record-missing', 'run awm change new change-record to create it');
    });
    test('two records with the same slug are record-ambiguous and neither is modified', () => {
        receiptForHead();
        run('change-record');
        run('change-record', {}, { now });
        fs.copyFileSync(file(), path.join(recordsDir(), '2026-11-01-change-record.md'));
        const before = recordFiles().map((f) => fs.readFileSync(path.join(recordsDir(), f), 'utf8'));
        expectFailure(run('change-record', { refresh: true }), 'record-ambiguous');
        expect(recordFiles().map((f) => fs.readFileSync(path.join(recordsDir(), f), 'utf8'))).toEqual(before);
    });
    test('a broken record is record-invalid and untouched', () => {
        receiptForHead();
        fs.mkdirSync(recordsDir(), { recursive: true });
        fs.writeFileSync(file(), '---\n: : :\n---\n');
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): broken');
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
        expect(read()).toBe('---\n: : :\n---\n');
    });
    test('a record missing a derived key is record-invalid and untouched', () => {
        receiptForHead();
        run('change-record');
        const broken = read().replace(/^semver: .*\n/m, '');
        fs.writeFileSync(file(), broken);
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): broken');
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
        expect(read()).toBe(broken);
    });
    test('a record that is not valid UTF-8 is record-invalid and untouched', () => {
        receiptForHead();
        run('change-record');
        const bytes = Buffer.concat([fs.readFileSync(file()), Buffer.from([0xff, 0xfe, 0x0a])]);
        fs.writeFileSync(file(), bytes);
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): bytes');
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
        expect(fs.readFileSync(file()).equals(bytes)).toBe(true);
    });
    test('a record with a UTF-8 BOM is record-invalid and its bytes are untouched', () => {
        receiptForHead();
        run('change-record');
        const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(file())]);
        fs.writeFileSync(file(), bytes);
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): bom');
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
        expect(fs.readFileSync(file()).equals(bytes)).toBe(true);
    });
    test('a record without a BOM but with non-ASCII text still refreshes and keeps those bytes', () => {
        receiptForHead();
        run('change-record');
        fs.writeFileSync(file(), fs.readFileSync(file(), 'utf8').split(PENDING_MARKER).join('Qué se probó ñandú \u{1F600}'));
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): text');
        repo.commit({ 'cli/src/core/b.ts': '1' }, 'fix(core): b');
        receiptForHead();
        expect(run('change-record', { refresh: true }).code).toBe(0);
        expect(read()).toContain('Qué se probó ñandú \u{1F600}');
        expect(read().charCodeAt(0)).toBe('-'.charCodeAt(0));
    });
    test('a record larger than the record limit is record-invalid', () => {
        receiptForHead();
        run('change-record');
        fs.appendFileSync(file(), 'x'.repeat(70 * 1024));
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): big');
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
    });
    test('a record whose derived keys are quoted is refreshed and still validates', () => {
        receiptForHead();
        run('change-record');
        const quoted = read().replace(/^(type|semver) *:/gm, '"$1" :');
        fs.writeFileSync(file(), quoted.split(PENDING_MARKER).join('written by agent'));
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): quoted');
        repo.commit({ 'cli/src/core/b.ts': '1' }, 'fix(core): b');
        receiptForHead();
        expect(run('change-record', { refresh: true }).code).toBe(0);
        expect(read()).not.toContain('"semver"');
        expect(validateRecordShape('2026-10-17-change-record.md', read(), { root: repo.root }).diagnostics).toEqual([]);
    });
    posixOnly('a record that is a symlink is refused and its target untouched', () => {
        receiptForHead();
        fs.mkdirSync(recordsDir(), { recursive: true });
        const outside = path.join(repo.home, 'real.md');
        fs.writeFileSync(outside, 'precious');
        fs.symlinkSync(outside, file());
        expectFailure(run('change-record', { refresh: true }), 'unsafe-path');
        expect(fs.readFileSync(outside, 'utf8')).toBe('precious');
    });
    test('a record that is a directory is record-invalid', () => {
        receiptForHead();
        fs.mkdirSync(file(), { recursive: true });
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
    });
    test('a failed write keeps the old content and leaves no temporary file', () => {
        const edited = recordCommitted();
        interceptFs('renameSync', (a) => baseIs(a[1], path.basename(file())), () => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); });
        expectFailure(run('change-record', { refresh: true }), 'io-failed');
        jest.restoreAllMocks();
        expect(read()).toBe(edited);
        expect(recordFiles()).toEqual(['2026-10-17-change-record.md']);
    });
    test('refresh accepts --base', () => {
        recordCommitted();
        expect(run('change-record', { refresh: true, base: 'main' }).code).toBe(0);
    });
    test('a derived key spelled with a YAML escape is record-invalid and the bytes are untouched', () => {
        receiptForHead();
        run('change-record');
        const bytes = Buffer.from(read().replace(/^type: .*$/m, '"t\\x79pe": fix'));
        expect(bytes.toString('utf8')).toContain('"t\\x79pe": fix');
        fs.writeFileSync(file(), bytes);
        repo.git('add', '-A'); repo.git('commit', '-q', '-m', 'docs(changes): escaped key');
        receiptForHead();
        expectFailure(run('change-record', { refresh: true }), 'record-invalid');
        expect(fs.readFileSync(file()).equals(bytes)).toBe(true);
    });
    describe('a record that changes between being read and being written', () => {
        /** Lets the real splice run, then edits the record as a concurrent editor would. */
        function editDuringRefresh(edit: () => void): void {
            const real = renderModule.refreshDerived;
            jest.spyOn(renderModule, 'refreshDerived').mockImplementation((...args) => { const out = real(...args); edit(); return out; });
        }
        const later = new Date(Date.now() + 60_000);
        test.each<[string, () => void]>([
            ['it grows', () => fs.appendFileSync(file(), 'edited meanwhile\n')],
            ['it keeps its size but is rewritten later', () => { const t = fs.readFileSync(file(), 'utf8'); fs.writeFileSync(file(), t.replace('written by agent', 'written by human')); fs.utimesSync(file(), later, later); }],
            ['only its modification time moves', () => fs.utimesSync(file(), later, later)],
        ])('%s: record-changed, and the editor\'s version is kept', (_name, edit) => {
            recordCommitted();
            editDuringRefresh(edit);
            expectFailure(run('change-record', { refresh: true }), 'record-changed');
            jest.restoreAllMocks();
            // The editor's version stands: the record still has the derived values of the commit it was written for.
            expect(frontmatter(read()).modules).toEqual(['cli/src']);
        });
        posixOnly('it is replaced by a symlink: record-changed, and the link target is untouched', () => {
            recordCommitted();
            const outside = path.join(repo.home, 'real.md');
            fs.writeFileSync(outside, 'precious');
            editDuringRefresh(() => { fs.rmSync(file()); fs.symlinkSync(outside, file()); });
            expectFailure(run('change-record', { refresh: true }), 'record-changed');
            jest.restoreAllMocks();
            expect(fs.readFileSync(outside, 'utf8')).toBe('precious');
            expect(fs.lstatSync(file()).isSymbolicLink()).toBe(true);
        });
        test('an untouched record is refreshed (the check is not always failing)', () => {
            recordCommitted();
            editDuringRefresh(() => undefined);
            expect(run('change-record', { refresh: true }).code).toBe(0);
        });
    });
    posixOnly('refresh keeps the file mode', () => {
        recordCommitted();
        fs.chmodSync(file(), 0o640);
        run('change-record', { refresh: true });
        expect(fs.statSync(file()).mode & 0o777).toBe(0o640);
    });
});

describe('registerChangeCommand', () => {
    freshRepo();
    function program(): Command {
        const p = new Command();
        p.exitOverride();
        registerChangeCommand(p, { now });
        return p;
    }
    let savedExit: typeof process.exitCode;
    let out: jest.SpyInstance; let err: jest.SpyInstance;
    beforeEach(() => {
        savedExit = process.exitCode;
        out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        // The action reads process.cwd(); pointing it at the repository needs no chdir (a process cannot delete its own cwd on Windows).
        jest.spyOn(process, 'cwd').mockImplementation(() => repo.root);
    });
    afterEach(() => { process.exitCode = savedExit; });
    test('registers change new with its documented flags', () => {
        const change = program().commands.find((c) => c.name() === 'change');
        const sub = change?.commands.find((c) => c.name() === 'new');
        expect(sub?.options.map((o) => o.long).sort()).toEqual(['--base', '--issue', '--model', '--plan', '--refresh', '--session']);
    });
    test('the change command describes both of its subcommands', () => {
        expect(program().commands.find((c) => c.name() === 'change')?.description()).toBe('create and validate the Change Record of the current branch');
    });
    test('runs from the cwd, prints the created path and leaves the exit code alone', async () => {
        receiptForHead();
        await program().parseAsync(['node', 'awm', 'change', 'new', 'change-record', '--model', 'm1']);
        expect(out).toHaveBeenCalledWith('Created docs/changes/2026-10-17-change-record.md\n');
        expect(process.exitCode).toBe(savedExit);
        expect((frontmatter(read()).provenance as Record<string, string>).model).toBe('m1');
    });
    test('a failure writes the diagnostic to stderr and sets exit code 2', async () => {
        await program().parseAsync(['node', 'awm', 'change', 'new', 'change-record']);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('receipt-missing: '));
        expect(process.exitCode).toBe(2);
    });
    test('--refresh reaches the command', async () => {
        receiptForHead();
        await program().parseAsync(['node', 'awm', 'change', 'new', 'change-record', '--refresh']);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('record-missing: '));
    });
    test('a cwd that is not accessible is reported, not thrown', async () => {
        jest.spyOn(process, 'cwd').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); });
        await program().parseAsync(['node', 'awm', 'change', 'new', 'x']);
        expect(process.exitCode).toBe(2);
        expect(err).toHaveBeenCalledWith(expect.stringMatching(/^[a-z-]+: /));
    });
});
