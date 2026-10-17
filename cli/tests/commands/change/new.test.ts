import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import childProcess from 'child_process';
import yaml from 'js-yaml';
import { makeRepo, nonRepoDir, type TestRepo } from '../../core/changes/helpers';
import { registerChangeCommand, runChangeNew, type NewOpts } from '../../../src/commands/change';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { buildReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { loadFrontmatter, splitRecord } from '../../../src/core/changes/parse';
import { refreshDerived, renderSkeleton } from '../../../src/core/changes/render';
import { validateRecordShape } from '../../../src/core/changes/validate-shape';
import { PENDING_MARKER, type DerivedFields, type Verification } from '../../../src/core/changes/types';
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
beforeEach(() => {
    repo = makeRepo();
    repo.git('checkout', '-q', '-b', 'feat/x');
    repo.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): a');
});
afterEach(() => {
    repo.cleanup();
    // The command writes only into the throwaway repository: the real checkout is never touched.
    expect(listReal()).toEqual(realBefore);
});

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
    test('HOME and AWM_HOME point into the throwaway home', () => {
        expect(process.env.HOME).toBe(repo.home);
        expect(process.env.AWM_HOME).toBe(path.join(repo.home, '.awm'));
        expect(fs.realpathSync.native(repo.root).startsWith(fs.realpathSync.native(os.tmpdir()))).toBe(true);
    });
});

describe('awm change new: receipt and clean tree (R3.6)', () => {
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
    test('an unusable clock fails with date-invalid and writes nothing', () => {
        receiptForHead();
        expectFailure(run('change-record', {}, { now: () => new Date(NaN) }), 'date-invalid');
        expectFailure(run('change-record', {}, { now: () => new Date('+010000-01-01T00:00:00.000Z') }), 'date-invalid');
        expectFailure(run('change-record', {}, { now: () => { throw new Error('boom'); } }), 'date-invalid');
        expectFailure(run('change-record', {}, { now: (() => 'x') as never }), 'date-invalid');
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: generated record is checked before it is written', () => {
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
        const real = fs.readFileSync;
        const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof real>) => {
            const out = real(...args);
            if (typeof args[0] === 'string' && args[0] === file()) { spy.mockRestore(); repo.commit({ 'cli/src/late.ts': '1' }, 'fix(core): late'); }
            return out;
        }) as never);
        try {
            expectFailure(run('change-record', { refresh: true }), 'git-failed');
        } finally { spy.mockRestore(); }
        expect(read()).toBe(before);
    });
});

describe('awm change new: HEAD is pinned before the derivation', () => {
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
        const spy = onGit('merge-base', 'after', land);
        try {
            expectFailure(run('change-record'), 'git-failed');
        } finally { spy.mockRestore(); }
        expect(recordFiles()).toEqual([]);
    });
    test('the message says HEAD moved during derivation', () => {
        receiptForHead();
        const spy = onGit('merge-base', 'after', land);
        try {
            expect(run('change-record').stderr).toContain('HEAD moved during derivation');
        } finally { spy.mockRestore(); }
    });
    test('a commit landing after the derivation but before the write is git-failed', () => {
        receiptForHead();
        const spy = onGit('status', 'before', () => repo.commit({ 'cli/src/late.ts': '1' }, 'fix(core): late'));
        try {
            expectFailure(run('change-record'), 'git-failed');
        } finally { spy.mockRestore(); }
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: provenance (R3.8)', () => {
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
    test('a symlink named like the record counts as existing and its target is not written', () => {
        if (process.platform === 'win32') return;
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
        const spy = jest.spyOn(fs, 'readdirSync').mockImplementationOnce((() => []) as never);
        try {
            expectFailure(run('change-record'), 'record-exists', 'use --refresh to update derived fields');
        } finally { spy.mockRestore(); }
        expect(read()).toBe('edited by hand');
    });
    test('an unreadable docs/changes listing fails closed instead of creating', () => {
        receiptForHead();
        fs.mkdirSync(recordsDir(), { recursive: true });
        const spy = jest.spyOn(fs, 'readdirSync').mockImplementationOnce((() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }) as never);
        try {
            expectFailure(run('change-record'), 'io-failed');
        } finally { spy.mockRestore(); }
        expect(recordFiles()).toEqual([]);
    });
    test('a failed write leaves no partial file behind', () => {
        receiptForHead();
        const spy = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce((() => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); }) as never);
        try {
            expectFailure(run('change-record'), 'io-failed');
        } finally { spy.mockRestore(); }
        expect(recordFiles()).toEqual([]);
    });
});

describe('awm change new: path safety (R3.12)', () => {
    const BAD_SLUGS = ['../evil', 'a/b', 'a\\b', 'Upper', 'a_b', '', '-a', 'a-', 'a--b', 'a b', 'a\nb', 'a'.repeat(65), 'é', '.hidden'];
    test.each(BAD_SLUGS)('rejects the slug %j before building any path', (slug) => {
        receiptForHead();
        expectFailure(run(slug), 'slug-invalid');
        expect(fs.existsSync(recordsDir())).toBe(false);
    });
    test('accepts a slug of exactly 64 characters', () => {
        receiptForHead();
        expect(run('a'.repeat(64)).code).toBe(0);
    });
    test('a non-string slug is slug-invalid, not a throw', () => {
        receiptForHead();
        expectFailure(runChangeNew(repo.root, undefined as never, {}, { now }), 'slug-invalid');
        expectFailure(runChangeNew(repo.root, { toString: () => 'ok' } as never, {}, { now }), 'slug-invalid');
    });
    test('a hostile slug never reaches the diagnostic raw', () => {
        const r = run('a\u2028b\u001b[31m'.repeat(40));
        expectFailure(r, 'slug-invalid');
        expect(r.stderr).not.toContain('\u001b');
    });
    test('refuses a symlinked docs/changes and writes nothing through it', () => {
        if (process.platform === 'win32') return;
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.mkdirSync(path.join(repo.root, 'docs'), { recursive: true });
        fs.symlinkSync(outside, recordsDir());
        expectFailure(run('ok'), 'unsafe-path');
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    test('refuses a symlinked docs and creates nothing through it', () => {
        if (process.platform === 'win32') return;
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
    test('refuses to refresh through a symlinked docs/changes', () => {
        if (process.platform === 'win32') return;
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.writeFileSync(path.join(outside, '2026-10-17-ok.md'), 'precious');
        fs.mkdirSync(path.join(repo.root, 'docs'), { recursive: true });
        fs.symlinkSync(outside, recordsDir());
        expectFailure(run('ok', { refresh: true }), 'unsafe-path');
        expect(fs.readFileSync(path.join(outside, '2026-10-17-ok.md'), 'utf8')).toBe('precious');
    });
    test('a link planted while the directory is being created is still refused', () => {
        if (process.platform === 'win32') return;
        receiptForHead();
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        const spy = jest.spyOn(fs, 'mkdirSync').mockImplementationOnce(((p: string) => { fs.symlinkSync(outside, p); }) as never);
        try {
            expectFailure(run('ok'), 'unsafe-path');
        } finally { spy.mockRestore(); }
        expect(fs.readdirSync(path.join(outside, 'changes'))).toEqual([]);
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

describe('awm change new: flag validation (R3.12)', () => {
    beforeEach(() => receiptForHead());
    const bad = (opts: NewOpts, what: string) => {
        const r = run('ok', opts);
        expectFailure(r, 'flag-invalid');
        expect(r.stderr).toContain(what);
        expect(recordFiles()).toEqual([]);
    };
    test('--issue must be an https URL: http is refused', () => bad({ issue: 'http://example.com/1' }, '--issue'));
    test('--issue: a non-URL is refused', () => bad({ issue: 'not a url' }, '--issue'));
    test('--issue: javascript: is refused', () => bad({ issue: 'javascript:alert(1)' }, '--issue'));
    test('--issue: embedded credentials are refused', () => bad({ issue: 'https://user@example.com/1' }, '--issue'));
    test('--issue: whitespace is refused', () => bad({ issue: 'https://example.com/a b' }, '--issue'));
    test('--issue: a line break is refused', () => bad({ issue: 'https://example.com/a\nb: c' }, '--issue'));
    test('--issue: a host-less https is refused', () => bad({ issue: 'https://' }, '--issue'));
    test('--issue: a very long URL is refused', () => bad({ issue: `https://example.com/${'a'.repeat(3000)}` }, '--issue'));
    test('--issue: https is accepted', () => { expect(run('ok', { issue: 'https://example.com/1' }).code).toBe(0); });
    test('--model: a line break is refused', () => bad({ model: 'a\nb' }, '--model'));
    test('--model: a control character is refused', () => bad({ model: 'a\u0000b' }, '--model'));
    test('--model: U+2028 is refused', () => bad({ model: 'a\u2028b' }, '--model'));
    test('--model: an empty or blank value is refused', () => { bad({ model: '' }, '--model'); bad({ model: '   ' }, '--model'); });
    test('--model: 201 characters are refused', () => bad({ model: 'm'.repeat(201) }, '--model'));
    test('--model: 200 characters are accepted', () => { expect(run('ok', { model: 'm'.repeat(200) }).code).toBe(0); });
    test('--model: the limit counts code points, not UTF-16 units', () => {
        expect(run('ok', { model: '\u{1F600}'.repeat(200) }).code).toBe(0);
    });
    test('--model: 201 code points are refused', () => bad({ model: '\u{1F600}'.repeat(201) }, '--model'));
    test('--model: a lone surrogate is refused', () => bad({ model: 'a\ud800b' }, '--model'));
    test('--session: a line break is refused', () => bad({ session: 'a\r\nb' }, '--session'));
    test('--session: 201 characters are refused', () => bad({ session: 's'.repeat(201) }, '--session'));
    test('--session: a plain value is accepted', () => { expect(run('ok', { session: 'abc' }).code).toBe(0); });
    test('a flag that is not a string is refused', () => {
        bad({ model: 5 as never }, '--model');
        bad({ plan: ['a'] as never }, '--plan');
        bad({ refresh: 'yes' as never }, '--refresh');
    });
    test('--plan: a missing file is refused', () => bad({ plan: 'docs/plans/missing.md' }, '--plan'));
    test('--plan: .. segments are refused', () => bad({ plan: '../outside.md' }, '--plan'));
    test('--plan: an absolute path is refused', () => bad({ plan: path.join(repo.root, 'README.md') }, '--plan'));
    test('--plan: a backslash path is refused', () => bad({ plan: 'docs\\plans\\p.md' }, '--plan'));
    test('--plan: a drive-letter path is refused', () => bad({ plan: 'C:/plan.md' }, '--plan'));
    test('--plan: a directory is refused', () => bad({ plan: 'cli' }, '--plan'));
    test('--plan: a symlink is refused', () => {
        if (process.platform === 'win32') return;
        fs.symlinkSync(path.join(repo.root, 'README.md'), path.join(repo.root, 'link.md'));
        bad({ plan: 'link.md' }, '--plan');
    });
    test('--plan: a file reached through a symlinked directory outside the repository is refused', () => {
        if (process.platform === 'win32') return;
        const outside = fs.mkdtempSync(path.join(repo.home, 'out-'));
        fs.writeFileSync(path.join(outside, 'p.md'), 'x');
        fs.symlinkSync(outside, path.join(repo.root, 'plans'));
        bad({ plan: 'plans/p.md' }, '--plan');
    });
    test('--plan: an existing repo file is accepted', () => { expect(run('ok', { plan: 'README.md' }).code).toBe(0); });
    test('a hostile --plan value never reaches the diagnostic raw', () => {
        const r = run('ok', { plan: 'a\u001b[31m\nb' });
        expectFailure(r, 'flag-invalid');
        expect(r.stderr).not.toContain('\u001b');
    });
    test('a non-object opts is flag-invalid, not a throw', () => {
        expectFailure(runChangeNew(repo.root, 'ok', 'x' as never, { now }), 'flag-invalid');
    });
});

describe('awm change new: base and derivation diagnostics (R3.1, R3.2, R3.5)', () => {
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
    test.each(['-x', '--upload-pack=evil', 'a..b', 'a b', 'a\nb', 'HEAD~1', 'a^', 'a:b', 'a@{1}', ''])('an unsafe --base %j is invalid-input', (base) => {
        receiptForHead();
        expectFailure(run('ok', { base }), 'invalid-input');
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
    test('a record that is a symlink is refused and its target untouched', () => {
        if (process.platform === 'win32') return;
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
        const spy = jest.spyOn(fs, 'renameSync').mockImplementationOnce((() => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); }) as never);
        try {
            expectFailure(run('change-record', { refresh: true }), 'io-failed');
        } finally { spy.mockRestore(); }
        expect(read()).toBe(edited);
        expect(recordFiles()).toEqual(['2026-10-17-change-record.md']);
    });
    test('refresh keeps the file mode', () => {
        if (process.platform === 'win32') return;
        recordCommitted();
        fs.chmodSync(file(), 0o640);
        run('change-record', { refresh: true });
        expect(fs.statSync(file()).mode & 0o777).toBe(0o640);
    });
});

describe('render: renderSkeleton', () => {
    const fields: DerivedFields = { type: 'feat', scope: null, semver: 'minor', breaking: false, modules: ['cli/src'] };
    const verification: Verification = { commit: 'a'.repeat(40), overall: 'pass', sensors: { lint: 'pass' }, receipt_digest: `sha256:${'b'.repeat(64)}` };
    test('renders frontmatter and the four body sections', () => {
        const text = renderSkeleton({ id: '2026-10-17-x', fields, verification }) as string;
        expect(text.startsWith('---\nschema: awm.change-record/v1\nid: 2026-10-17-x\n')).toBe(true);
        expect(validateRecordShape('2026-10-17-x.md', text).diagnostics.map((d) => d.code)).toEqual(['pending-content']);
    });
    test('hostile provenance and link values survive a YAML round trip as plain strings', () => {
        const nasty = 'a: b # c\n- d';
        const text = renderSkeleton({ id: '2026-10-17-x', fields, verification, provenance: { model: nasty, session: '&anchor *alias !!tag' }, links: { issue: 'https://e.com/?a=b#c' } });
        expect(text).not.toBeNull();
        const fm = frontmatter(text as string);
        expect(fm.provenance).toEqual({ model: nasty, session: '&anchor *alias !!tag' });
        expect(fm.links).toEqual({ issue: 'https://e.com/?a=b#c' });
        expect(Object.keys(fm)).toEqual(['schema', 'id', 'title', 'summary_short', 'type', 'scope', 'semver', 'breaking', 'modules', 'links', 'verification', 'manual_validation', 'risks', 'rollback', 'provenance']);
    });
    test('an unusable input yields null instead of throwing', () => {
        expect(renderSkeleton(null as never)).toBeNull();
        expect(renderSkeleton({ id: '2026-10-17-x', fields, verification: undefined as never })).toBeNull();
        expect(renderSkeleton({ id: 5 as never, fields, verification })).toBeNull();
        const circular: Record<string, unknown> = {}; circular.self = circular;
        expect(renderSkeleton({ id: '2026-10-17-x', fields, verification, provenance: circular as never })).toBeNull();
    });
});

describe('render: refreshDerived', () => {
    const FRESH: DerivedFields = { type: 'feat', scope: 'core', semver: 'minor', breaking: false, modules: ['cli/src/core'] };
    const FRESH_V: Verification = { commit: 'c'.repeat(40), overall: 'pass', sensors: { lint: 'pass' }, receipt_digest: `sha256:${'d'.repeat(64)}` };
    const OLD = [
        '---', 'schema: awm.change-record/v1', 'id: 2026-10-17-x', '# derived fields follow', 'type: fix', 'scope: null', 'semver: patch', 'breaking: false',
        'modules:', '- old/a', '- old/b', '# a comment after the list', '', 'links:', '  plan: docs/plans/p.md', 'verification:', `  commit: ${'0'.repeat(40)}`,
        '  overall: fail', '  sensors:', '    lint: fail', `  receipt_digest: sha256:${'0'.repeat(64)}`, 'title: Hello', '---', '', 'body text', '',
    ];
    const NEW_BLOCKS = [
        '---', 'schema: awm.change-record/v1', 'id: 2026-10-17-x', '# derived fields follow', 'type: feat', 'scope: core', 'semver: minor', 'breaking: false',
        'modules:', '  - cli/src/core', '# a comment after the list', '', 'links:', '  plan: docs/plans/p.md', 'verification:', `  commit: ${'c'.repeat(40)}`,
        '  overall: pass', '  sensors:', '    lint: pass', `  receipt_digest: sha256:${'d'.repeat(64)}`, 'title: Hello', '---', '', 'body text', '',
    ];
    const lf = (lines: string[]) => lines.join('\n');
    const crlf = (lines: string[]) => lines.join('\r\n');

    test('replaces exactly the derived blocks, keeping comments, blank lines, other keys and the body', () => {
        expect(refreshDerived(lf(OLD), FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS));
    });
    test('a column-0 list is replaced as one block and the key after it is untouched', () => {
        const old = ['---', 'type: fix', 'scope: x', 'semver: none', 'breaking: false', 'modules:', '- a', '- b', 'verification: {}', 'title: T', '---', 'b', ''];
        const out = refreshDerived(lf(old), FRESH, FRESH_V) as string;
        expect(out.endsWith('title: T\n---\nb\n')).toBe(true);
        expect(frontmatter(out).modules).toEqual(['cli/src/core']);
        expect(frontmatter(out).title).toBe('T');
    });
    test('CRLF files keep CRLF', () => {
        expect(refreshDerived(crlf(OLD), FRESH, FRESH_V)).toBe(crlf(NEW_BLOCKS));
    });
    test('mixed line endings keep each untouched line ending', () => {
        const old = OLD.map((l, i) => (i % 2 === 0 ? `${l}\r` : l));
        const out = refreshDerived(old.join('\n'), FRESH, FRESH_V) as string;
        expect(out.split('\n').find((l) => l.startsWith('title:'))).toBe(old.find((l) => l.startsWith('title:')));
        expect(out.endsWith(old.slice(-2).join('\n'))).toBe(true);
        expect(frontmatter(out).modules).toEqual(['cli/src/core']);
    });
    test('the body is preserved byte for byte, even when it looks like frontmatter', () => {
        const tail = '\n\n---\ntype: nope\n---\nmodules:\n- z\n';
        const out = refreshDerived(lf(OLD) + tail, FRESH, FRESH_V) as string;
        expect(out.endsWith(tail)).toBe(true);
    });
    test('trailing whitespace after the closing delimiter content and a missing final newline survive', () => {
        const out = refreshDerived(lf(OLD).replace(/\n$/, '') + '  ', FRESH, FRESH_V) as string;
        expect(out.endsWith('body text  ')).toBe(true);
    });
    test('a scalar with a trailing comment on the key line is replaced as a unit', () => {
        const old = lf(OLD).replace('type: fix', 'type: fix # why');
        expect(refreshDerived(old, FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS));
    });
    test('a null scope round-trips as null', () => {
        const out = refreshDerived(lf(OLD), { ...FRESH, scope: null }, FRESH_V) as string;
        expect(frontmatter(out).scope).toBeNull();
    });
    test('hostile sensor names and module names are quoted so they parse back unchanged', () => {
        const v: Verification = { ...FRESH_V, sensors: { 'a: b': 'pass', '# x': 'fail', 'yes': 'skipped', '-': 'pass' } };
        const out = refreshDerived(lf(OLD), { ...FRESH, modules: ['a b', 'c#d', '*x', 'y:z'] }, v) as string;
        expect(frontmatter(out).verification).toEqual(v);
        expect(frontmatter(out).modules).toEqual(['a b', 'c#d', '*x', 'y:z']);
        expect(strip2(out)).toBe(strip2(lf(NEW_BLOCKS)));
    });
    // The title/id/links/body lines, which a refresh never touches.
    const strip2 = (s: string) => s.split('\n').filter((l) => /^(schema|id|title|links|  plan|#|body)/.test(l)).join('\n');
    test.each([
        ['no frontmatter', 'type: fix\n'],
        ['unclosed frontmatter', '---\ntype: fix\n'],
        ['unparseable yaml', '---\n: : :\n---\n'],
        ['a missing derived key', lf(OLD).replace('semver: patch\n', '')],
        ['a missing verification', lf(OLD).replace(/^verification:[\s\S]*?(?=^title)/m, '')],
        ['a non-mapping frontmatter', '---\n- a\n- b\n---\n'],
        ['a duplicated key', lf(OLD).replace('title: Hello', 'type: fix\ntitle: Hello')],
        ['an anchor', lf(OLD).replace('title: Hello', 'title: &a Hello')],
        ['a key the line scan cannot recognise, right after a replaced block', lf(OLD).replace('title: Hello', 'odd key: 1\ntitle: Hello')],
        ['an escaped spelling of a derived key next to the bare one', lf(OLD).replace('title: Hello', '"\\u0074ype": x\ntitle: Hello')],
        ['an escaped spelling of a derived key instead of the bare one', lf(OLD).replace('type: fix\n', '"\\u0074ype": fix\n')],
        ['an empty string', ''],
    ])('returns null for %s', (_name, raw) => {
        expect(refreshDerived(raw, FRESH, FRESH_V)).toBeNull();
    });
    test('returns null for input that is not usable, never throws', () => {
        expect(refreshDerived(undefined as never, FRESH, FRESH_V)).toBeNull();
        expect(refreshDerived(lf(OLD), null as never, FRESH_V)).toBeNull();
        expect(refreshDerived(lf(OLD), FRESH, undefined as never)).toBeNull();
        expect(refreshDerived(lf(OLD), { ...FRESH, scope: undefined as never }, FRESH_V)).toBeNull();
        const circular: Record<string, unknown> = {}; circular.self = circular;
        expect(refreshDerived(lf(OLD), FRESH, circular as never)).toBeNull();
    });
    test('a block scalar after the derived keys is carried over byte for byte', () => {
        const raw = lf(OLD).replace('title: Hello', 'title: >\n  one\n  two\nrollback: kept');
        const out = refreshDerived(raw, FRESH, FRESH_V) as string;
        expect(frontmatter(out).title).toBe('one two\n');
        expect(frontmatter(out).rollback).toBe('kept');
        expect(out).toContain('title: >\n  one\n  two\nrollback: kept');
    });
    test('never alters a key that is not derived, whatever follows a replaced block', () => {
        const raw = lf(OLD).replace('breaking: false\n', 'breaking: false\nrisks:\n- r1\n- r2\n');
        const out = refreshDerived(raw, FRESH, FRESH_V) as string;
        expect(frontmatter(out).risks).toEqual(['r1', 'r2']);
        expect(out).toContain('risks:\n- r1\n- r2\n');
    });
    describe('recomputed keys written other than bare', () => {
        const SPELLINGS: Array<[string, (k: string) => string]> = [
            ['double-quoted', (k) => `"${k}":`],
            ['single-quoted', (k) => `'${k}':`],
            ['bare with a space before the colon', (k) => `${k} :`],
            ['bare with a tab before the colon', (k) => `${k}\t:`],
            ['double-quoted with spaces before the colon', (k) => `"${k}"  :`],
            ['single-quoted with a tab before the colon', (k) => `'${k}'\t:`],
        ];
        const spell = (lines: string[], key: string, fn: (k: string) => string) => lines.map((l) => (l.startsWith(`${key}:`) ? fn(key) + l.slice(key.length + 1) : l));
        const KEYS = ['type', 'scope', 'semver', 'breaking', 'modules', 'verification'];
        test.each(SPELLINGS.flatMap(([name, fn]) => KEYS.map((key) => [name, key, fn] as const)))('%s %s is recomputed like a bare key', (_name, key, fn) => {
            const old = spell(OLD, key, fn);
            expect(old).not.toEqual(OLD);
            expect(refreshDerived(lf(old), FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS));
        });
        test.each(SPELLINGS)('%s keys keep CRLF', (_name, fn) => {
            const old = KEYS.reduce((lines, key) => spell(lines, key, fn), OLD);
            expect(refreshDerived(crlf(old), FRESH, FRESH_V)).toBe(crlf(NEW_BLOCKS));
        });
        test('a spelled key is also found in the middle of a file next to other keys', () => {
            const old = lf(OLD).replace('title: Hello', '"title": Hello');
            expect(refreshDerived(old, FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS).replace('title: Hello', '"title": Hello'));
        });
        test('a quoted key with an escaped quote is kept, never taken for a derived key', () => {
            const line = '"sem\\"ver": 1';
            const out = refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V) as string;
            expect(out).toBe(lf(NEW_BLOCKS).replace('title: Hello', `${line}\ntitle: Hello`));
            expect(frontmatter(out)['sem"ver']).toBe(1);
        });
        test('a single-quoted key with a doubled quote is kept, never taken for a derived key', () => {
            const line = "'it''s': 1";
            const out = refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V) as string;
            expect(out).toBe(lf(NEW_BLOCKS).replace('title: Hello', `${line}\ntitle: Hello`));
            expect(frontmatter(out)["it's"]).toBe(1);
        });
        test('a quoted key that merely contains a derived name is not recomputed', () => {
            const line = '"type extra": 1';
            const out = refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V) as string;
            expect(out).toContain(`${line}\ntitle: Hello`);
        });
        test('a hostile very long quoted line is scanned in linear time', () => {
            const line = `"${'\\'.repeat(200000)}`;
            const started = Date.now();
            expect(refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V)).toBeNull();
            expect(Date.now() - started).toBeLessThan(5000);
        });
    });
    test('the dumped blocks use the core schema (what the validator parses)', () => {
        const out = refreshDerived(lf(OLD), { ...FRESH, scope: 'null' }, FRESH_V) as string;
        expect(out).toContain("scope: 'null'");
        expect(yaml.load(out.split('\n---')[0].slice(4), { schema: yaml.CORE_SCHEMA })).toMatchObject({ scope: 'null' });
    });
});

describe('registerChangeCommand', () => {
    function program(): Command {
        const p = new Command();
        p.exitOverride();
        registerChangeCommand(p, { now });
        return p;
    }
    let cwd: string;
    let savedExit: typeof process.exitCode;
    let out: jest.SpyInstance; let err: jest.SpyInstance;
    beforeEach(() => {
        cwd = process.cwd(); savedExit = process.exitCode;
        out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
        process.chdir(cwd); process.exitCode = savedExit;
        out.mockRestore(); err.mockRestore();
    });
    test('registers change new with its documented flags', () => {
        const change = program().commands.find((c) => c.name() === 'change');
        const sub = change?.commands.find((c) => c.name() === 'new');
        expect(sub?.options.map((o) => o.long).sort()).toEqual(['--base', '--issue', '--model', '--plan', '--refresh', '--session']);
    });
    test('runs from the cwd, prints the created path and leaves the exit code alone', async () => {
        receiptForHead();
        process.chdir(repo.root);
        await program().parseAsync(['node', 'awm', 'change', 'new', 'change-record', '--model', 'm1']);
        expect(out).toHaveBeenCalledWith('Created docs/changes/2026-10-17-change-record.md\n');
        expect(process.exitCode).toBe(savedExit);
        expect((frontmatter(read()).provenance as Record<string, string>).model).toBe('m1');
    });
    test('a failure writes the diagnostic to stderr and sets exit code 2', async () => {
        process.chdir(repo.root);
        await program().parseAsync(['node', 'awm', 'change', 'new', 'change-record']);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('receipt-missing: '));
        expect(process.exitCode).toBe(2);
    });
    test('--refresh reaches the command', async () => {
        receiptForHead();
        process.chdir(repo.root);
        await program().parseAsync(['node', 'awm', 'change', 'new', 'change-record', '--refresh']);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('record-missing: '));
    });
    test('a cwd that no longer exists is reported, not thrown', async () => {
        const gone = fs.mkdtempSync(path.join(repo.home, 'gone-'));
        process.chdir(gone);
        fs.rmSync(gone, { recursive: true });
        await program().parseAsync(['node', 'awm', 'change', 'new', 'x']);
        expect(process.exitCode).toBe(2);
        expect(err).toHaveBeenCalledWith(expect.stringMatching(/^[a-z-]+: /));
    });
});
