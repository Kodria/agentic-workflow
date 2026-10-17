import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { bad, cloneRepo, makeRepo, nonRepoDir, type TestRepo } from '../../core/changes/helpers';
import { pathToFileURL } from 'url';
import { commitLiterally, now, record, recordPath } from '../../core/changes/list-fixtures';
import { registerChangesCommand, runChangesList } from '../../../src/commands/changes';
import * as listModule from '../../../src/core/changes/list';
import type { CommandResult } from '../../../src/core/command-result';

const REAL_CHANGES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'changes');
const listReal = (): string[] | null => { try { return fs.readdirSync(REAL_CHANGES_DIR).sort(); } catch { return null; } };
const realBefore = listReal();
// The command only reads the throwaway repository: the real checkout is never touched.
afterEach(() => expect(listReal()).toEqual(realBefore));

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
let repo: TestRepo;
let template: TestRepo;
beforeAll(() => { template = makeRepo(); });
afterAll(() => template.cleanup());
beforeEach(() => { repo = cloneRepo(template); });
afterEach(() => { jest.restoreAllMocks(); repo.cleanup(); });

const FIRST = '2026-10-16-first';
function history(): void {
    repo.commit({ 'old.ts': '1' }, 'feat: before adoption', '2026-10-16T09:00:00Z');
    repo.commit({ [recordPath(FIRST)]: record(FIRST), 'a.ts': '1' }, 'feat: first (#10)', '2026-10-16T20:00:00Z');
    repo.commit({ 'b.ts': '1' }, 'fix: no record', '2026-10-16T21:00:00Z');
    repo.commit({ 'c.ts': '1' }, 'chore(release): v1.0.0 [skip ci]\n\nChange-Record: none', '2026-10-16T22:00:00Z');
    repo.commit({ [recordPath('2026-10-17-bad')]: '---\nschema: nope\n---\n' }, 'feat: bad record', '2026-10-17T01:00:00Z');
    repo.gitAt('2026-10-17T02:00:00Z', 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
}
const run = (opts: Record<string, unknown> = {}, deps: Record<string, unknown> = {}): CommandResult => runChangesList(repo.root, opts as never, { now, ...deps } as never);
const json = (opts: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) => JSON.parse(run({ since: '48h', format: 'json', ...opts }, deps).stdout);
const failure = (r: CommandResult, code: string): void => {
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr.startsWith(`${code}: `)).toBe(true);
    expect(r.stderr.endsWith('\n')).toBe(true);
    const lines = r.stderr.split('\n').slice(0, -1);
    for (const line of lines) { expect(line).not.toMatch(UNSAFE); expect(line.length).toBeLessThanOrEqual(300); }
};

describe('awm changes list: flags (R5.2, R5.6)', () => {
    test('an invalid --since exits 2 with since-invalid', () => {
        failure(run({ since: 'soon' }), 'since-invalid');
    });
    test('an invalid --since with --format json still prints on stderr only, like change new', () => {
        failure(run({ since: '0h', format: 'json' }), 'since-invalid');
    });
    test('an invalid --format exits 2 with format-invalid', () => {
        failure(run({ format: 'xml' }), 'format-invalid');
    });
    test('the format is case-sensitive', () => {
        failure(run({ format: 'JSON' }), 'format-invalid');
    });
    test('hostile --since and --format values are not echoed raw', () => {
        const hostile = `\u001b[31m\n${'x'.repeat(600)}`;
        for (const r of [run({ since: hostile }), run({ format: hostile })]) {
            expect(r.code).toBe(2);
            expect(r.stderr).not.toContain('\u001b');
            expect(r.stderr.split('\n')).toHaveLength(2);
        }
    });
    test.each([
        ['since', 5], ['base', 5], ['format', 5], ['since', {}], ['format', ['json']], ['base', true],
    ])('the option %s with the value %j is flag-invalid', (key, value) => {
        failure(run({ [key]: value }), 'flag-invalid');
    });
    test.each([5, 'x', [], null])('options %j that are not an object are flag-invalid', (opts) => {
        failure(runChangesList(repo.root, bad(opts), { now }), 'flag-invalid');
    });
    test('missing options use the defaults: 24h and text', () => {
        history();
        expect(runChangesList(repo.root, bad(undefined), { now }).code).toBe(0);
    });
    test('the default window is 24h', () => {
        history();
        const out = JSON.parse(run({ format: 'json' }).stdout);
        expect(out.since).toBe('2026-10-16T12:00:00.000Z');
        expect(out.changes.map((c: { subject: string }) => c.subject)).toEqual(['feat: bad record', 'chore(release): v1.0.0 [skip ci]', 'fix: no record', 'feat: first (#10)']);
    });
    test('--since leaves out what is older than the window', () => {
        history();
        const out = JSON.parse(run({ format: 'json', since: '12h' }).stdout);
        expect(out.changes.map((c: { subject: string }) => c.subject)).toEqual(['feat: bad record']);
    });
    test('a clock that is not usable is invalid-input, not a throw', () => {
        history();
        for (const clock of [() => { throw new Error('x'); }, () => 'later', () => new Date(Number.NaN)]) failure(run({}, { now: clock }), 'invalid-input');
    });
});

describe('awm changes list: repository and base (R5.1, R3.1, R3.2, R3.5)', () => {
    test('outside a repository exits 2 with not-a-git-repo', () => {
        failure(runChangesList(nonRepoDir(repo), {}, { now }), 'not-a-git-repo');
    });
    test.each([undefined, null, 5, ''])('a working directory %j is invalid-input', (cwd) => {
        failure(runChangesList(bad(cwd), {}, { now }), 'invalid-input');
    });
    test('an unresolvable base exits 2 with base-unresolved and the remedy', () => {
        const r = run({ base: 'nope' });
        failure(r, 'base-unresolved');
        expect(r.stderr).toContain('remedy: pass --base <ref>');
    });
    test('no default base exits 2 with base-unresolved', () => {
        repo.git('branch', '-m', 'trunk');
        failure(run(), 'base-unresolved');
    });
    test.each(['--upload-pack=x', '-x', 'a..b', 'main^', ' main'])('an unsafe --base %j exits 2 with invalid-input', (base) => {
        failure(run({ base }), 'invalid-input');
    });
    test('an unsafe --base is echoed escaped and clipped', () => {
        const r = run({ base: `-x\u001b[31m${'y'.repeat(600)}` });
        failure(r, 'invalid-input');
    });
    test('--base selects the branch to read', () => {
        history();
        repo.git('checkout', '-q', '-b', 'release');
        repo.commit({ 'r.ts': '1' }, 'fix: only on release', '2026-10-17T03:00:00Z');
        repo.git('checkout', '-q', 'main');
        expect(json({ base: 'release' }).changes[0].subject).toBe('fix: only on release');
        expect(json({ base: 'release' }).base).toBe('release');
        expect(json().changes[0].subject).toBe('feat: bad record');
    });
    test('it reads the base branch whichever branch is checked out, and does not need a clean tree', () => {
        history();
        repo.git('checkout', '-q', '-b', 'feat/x');
        fs.writeFileSync(path.join(repo.root, 'a.ts'), 'dirty');
        fs.writeFileSync(path.join(repo.root, 'new.txt'), 'untracked');
        const r = run({ since: '48h' });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/recorded/);
    });
    test('a repository with no commit on the base resolves nothing', () => {
        const fresh = fs.mkdtempSync(path.join(repo.home, 'fresh-'));
        repo.git('init', '-q', '-b', 'main', fresh);
        failure(runChangesList(fresh, {}, { now }), 'base-unresolved');
    });
});

describe('awm changes list: adoption (R5.4)', () => {
    test('a repo without records reports non-adoption and exits 0', () => {
        const r = run();
        expect(r.code).toBe(0);
        expect(r.stderr).toBe('');
        expect(r.stdout).toMatch(/not adopted Change Records/);
        expect(r.stdout.split('\n')).toHaveLength(2);
    });
    test('a repo without records reports non-adoption in voice', () => {
        expect(run({ format: 'voice' }).stdout).toMatch(/todavía no usa Change Records/);
    });
    test('a repo without records prints an empty JSON document', () => {
        const r = run({ format: 'json' });
        expect(r.code).toBe(0);
        expect(JSON.parse(r.stdout)).toMatchObject({ adopted: false, changes: [], truncated: false, omitted: 0, base: 'main' });
    });
    test('R5.4 a docs/changes/ that holds only a README prints the one-line notice saying that no record exists (not that the directory is empty)', () => {
        repo.commit({ 'docs/changes/README.md': 'how we record changes' }, 'docs: readme');
        const r = run();
        expect(r.code).toBe(0);
        expect(r.stdout).toBe(`${path.basename(repo.root)} has not adopted Change Records (no record under docs/changes/ on main).\n`);
        expect(JSON.parse(run({ format: 'json' }).stdout)).toMatchObject({ adopted: false, changes: [] });
    });
    test('a repo without records is named after its directory when it has no remote', () => {
        expect(run().stdout.startsWith(`${path.basename(repo.root)} has not adopted`)).toBe(true);
    });
});

describe('awm changes list: classification and derived fields (R5.1, R5.3, R5.4, R5.5)', () => {
    test('classifies and derives', () => {
        history();
        const out = json();
        const byClass = Object.fromEntries(out.changes.map((c: { subject: string; classification: string }) => [c.subject, c.classification]));
        expect(byClass).toEqual({ 'feat: first (#10)': 'recorded', 'fix: no record': 'missing', 'chore(release): v1.0.0 [skip ci]': 'exempt', 'feat: bad record': 'invalid-record' });
        const first = out.changes.find((c: { subject: string }) => c.subject === 'feat: first (#10)');
        expect(first).toMatchObject({ pr: 10, release: 'v1.0.0', merged_at: '2026-10-16T20:00:00.000Z' });
        expect(first.records[0]).toMatchObject({ path: recordPath(FIRST), summary_short: 'Primer cambio.' });
        expect(out.repo).toBeNull();
    });
    test('pre-adoption commits are omitted', () => {
        history();
        expect(JSON.stringify(json())).not.toContain('before adoption');
    });
    test('repo identity strips credentials', () => {
        history();
        repo.git('remote', 'add', 'origin', 'https://user:tok@github.com/Kodria/belanz.git');
        const r = run({ since: '48h', format: 'json' });
        expect(JSON.parse(r.stdout).repo).toBe('github.com/Kodria/belanz');
        expect(r.stdout).not.toContain('tok');
        expect(run({ since: '48h', format: 'voice' }).stdout.startsWith('belanz: ')).toBe(true);
        expect(run({ since: '48h' }).stdout).not.toContain('tok');
    });
    test('hostile commit text never reaches any format raw', () => {
        history();
        repo.commit({ 'h.ts': '1' }, 'fix: \u001b[31mred\u001b[0m \u202eevil\u2028 end', '2026-10-17T03:00:00Z');
        for (const format of ['text', 'json', 'voice']) {
            const out = run({ since: '48h', format }).stdout;
            expect(out).not.toMatch(/\u001b|\u202e|\u2028/);
        }
        const subjects = json().changes.map((c: { subject: string }) => c.subject);
        expect(subjects[0]).toBe('fix: \\u001b[31mred\\u001b[0m \\u202eevil\\u2028 end');
    });
});

describe('awm changes list: mixed invalid commits, odd dates and shallow clones (R5.1, R5.5, R5.6)', () => {
    const mixed = (): void => {
        history();
        repo.commit({ [recordPath('2026-10-17-aaa')]: record('2026-10-17-aaa', { summary: 'Valido.' }), [recordPath('2026-10-17-zzz')]: 'junk' }, 'feat: mixed', '2026-10-17T03:00:00Z');
    };
    test('json lists both records of the mixed commit: the valid one with empty diagnostics, the junk one with its diagnostics', () => {
        mixed();
        const entry = json().changes[0];
        expect(entry.classification).toBe('invalid-record');
        expect(entry.records).toEqual([
            { path: recordPath('2026-10-17-aaa'), diagnostics: [] },
            { path: recordPath('2026-10-17-zzz'), diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'frontmatter-missing' })]) },
        ]);
    });
    test('the text row of the mixed commit shows the junk record diagnostic, not the valid first record', () => {
        mixed();
        const row = run({ since: '48h' }).stdout.split('\n')[1];
        expect(row).toContain('feat: mixed');
        expect(row).toContain('(frontmatter-missing)');
    });
    test('voice counts the mixed commit as invalid and does not speak its valid record', () => {
        mixed();
        const out = run({ since: '48h', format: 'voice' }).stdout;
        expect(out).not.toContain('Valido.');
        expect(out).toMatch(/1 cambio\(s\) sin record y 2 con record inválido/);
    });
    test.each(['text', 'json', 'voice'])('a commit with an unusable committer date is listed in the %s format', (format) => {
        history();
        commitLiterally(repo, '');
        const r = run({ since: '48h', format });
        expect(r.code).toBe(0);
        if (format === 'json') expect(json().changes[0]).toMatchObject({ subject: 'fix: odd date', merged_at: null });
        if (format === 'text') expect(r.stdout.split('\n')[1]).toMatch(/^unknown\s+missing\s/);
        if (format === 'voice') expect(r.stdout).toMatch(/2 cambio\(s\) sin record/);
    });
    test('a shallow clone exits 2 with shallow-history and its remedy', () => {
        history();
        const dest = path.join(repo.home, 'shallow');
        repo.git('clone', '-q', '--depth', '1', pathToFileURL(repo.root).href, dest);
        const r = runChangesList(dest, { since: '48h', format: 'json' }, { now });
        failure(r, 'shallow-history');
        expect(r.stderr).toContain('remedy: git fetch --unshallow');
    });
});

describe('awm changes list: formats (R5.6)', () => {
    test('json is one document on one line', () => {
        history();
        const r = run({ since: '48h', format: 'json' });
        expect(r.stdout.split('\n')).toHaveLength(2);
        expect(Object.keys(JSON.parse(r.stdout))).toEqual(['schema', 'repo', 'base', 'since', 'adopted', 'truncated', 'omitted', 'changes']);
        expect(JSON.parse(r.stdout).adopted).toBe(true);
    });
    test('voice speaks recorded changes and counts the rest', () => {
        history();
        const r = run({ since: '48h', format: 'voice' });
        expect(r.stdout).toContain('Primer cambio. feat, verificado, 2 validaciones manuales pendientes.');
        expect(r.stdout).toMatch(/1 cambio\(s\) sin record y 1 con record inválido/);
    });
    test('text is a table with the classification of each change', () => {
        history();
        const out = run({ since: '48h' }).stdout;
        for (const word of ['recorded', 'missing', 'exempt', 'invalid-record', 'v1.0.0', '#10']) expect(out).toContain(word);
        expect(out.split('\n')[0]).toMatch(/^WHEN\s+CLASSIFICATION/);
    });
    test('text is the default format', () => {
        history();
        expect(run({ since: '48h' }).stdout).toBe(run({ since: '48h', format: 'text' }).stdout);
    });
    test('an empty window says so in text', () => {
        history();
        expect(run({ since: '1h' }).stdout).toMatch(/^No changes on main since /);
    });
    test('beyond the limit every format ends with a notice and json reports the omitted count', () => {
        history();
        const deps = { limit: 2 };
        const out = JSON.parse(run({ since: '48h', format: 'json' }, deps).stdout);
        expect(out).toMatchObject({ truncated: true, omitted: 2 });
        expect(out.changes).toHaveLength(2);
        expect(run({ since: '48h' }, deps).stdout).toMatch(/2 older change\(s\) not shown/);
        expect(run({ since: '48h', format: 'voice' }, deps).stdout).toMatch(/Hay 2 cambio\(s\) más antiguo\(s\) sin mostrar/);
    });
    test('no format prints anything on stderr when it succeeds', () => {
        history();
        for (const format of ['text', 'json', 'voice']) expect(run({ since: '48h', format }).stderr).toBe('');
    });
});

describe('awm changes list: read-only (R5.7)', () => {
    test('leaves the repository exactly as it was', () => {
        history();
        fs.writeFileSync(path.join(repo.root, 'untracked.txt'), 'u');
        const before = [repo.git('status', '--porcelain', '--ignored'), repo.git('for-each-ref'), fs.readFileSync(path.join(repo.root, '.git', 'index')).toString('hex')];
        for (const format of ['text', 'json', 'voice']) run({ since: '48h', format }, { limit: 2 });
        expect([repo.git('status', '--porcelain', '--ignored'), repo.git('for-each-ref'), fs.readFileSync(path.join(repo.root, '.git', 'index')).toString('hex')]).toEqual(before);
        expect(fs.readdirSync(repo.root).sort()).toEqual(['.git', '.gitignore', 'README.md', 'a.ts', 'b.ts', 'c.ts', 'docs', 'old.ts', 'untracked.txt']);
    });
    test('never creates .awm or docs/changes files in the repository it reads', () => {
        repo.commit({ 'a.ts': '1' }, 'feat: a', '2026-10-16T09:00:00Z');
        run();
        expect(fs.existsSync(path.join(repo.root, '.awm'))).toBe(false);
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
    });
});

describe('awm changes list: never throws', () => {
    test('an unexpected failure inside is an internal-error on stderr', () => {
        history();
        jest.spyOn(listModule, 'listChanges').mockImplementation(() => { throw new Error('secret\u001b[31m detail'); });
        const r = run({ since: '48h' });
        failure(r, 'internal-error');
        expect(r.stderr).not.toContain('secret');
    });
    test('a failure of git inside the run is reported as git-failed', () => {
        history();
        jest.spyOn(listModule, 'listChanges').mockReturnValue({ ok: false, failure: { code: 'git-failed', message: 'git could not read the history' } });
        failure(run({ since: '48h', format: 'json' }), 'git-failed');
    });
    test('a failure carries its remedy on a second line', () => {
        jest.spyOn(listModule, 'listChanges').mockReturnValue({ ok: false, failure: { code: 'base-unresolved', message: 'm', remedy: 'pass --base <ref>' } });
        expect(run().stderr).toBe('base-unresolved: m\n  remedy: pass --base <ref>\n');
    });
});

describe('registerChangesCommand', () => {
    function program(): Command {
        const p = new Command();
        p.exitOverride();
        registerChangesCommand(p, { now });
        return p;
    }
    let savedExit: typeof process.exitCode;
    let out: jest.SpyInstance; let err: jest.SpyInstance;
    beforeEach(() => {
        savedExit = process.exitCode;
        out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        jest.spyOn(process, 'cwd').mockImplementation(() => repo.root);
    });
    afterEach(() => { process.exitCode = savedExit; });
    const sub = () => program().commands.find((c) => c.name() === 'changes')?.commands.find((c) => c.name() === 'list');
    test('registers changes list with its documented flags', () => {
        expect(sub()?.options.map((o) => o.long).sort()).toEqual(['--base', '--format', '--since']);
        expect(sub()?.registeredArguments).toEqual([]);
    });
    test('a run prints the result and leaves the exit code alone', async () => {
        history();
        await program().parseAsync(['node', 'awm', 'changes', 'list', '--since', '48h', '--format', 'json']);
        expect(JSON.parse(out.mock.calls[0][0]).changes).toHaveLength(4);
        expect(process.exitCode).toBe(savedExit);
    });
    test('flags reach the command', async () => {
        history();
        repo.git('branch', 'other');
        await program().parseAsync(['node', 'awm', 'changes', 'list', '--base', 'other', '--since', '1h', '--format', 'voice']);
        expect(out.mock.calls[0][0]).toBe(`${path.basename(repo.root)}: sin cambios desde 2026-10-17.\n`);
    });
    test('a failure goes to stderr and sets the exit code 2', async () => {
        await program().parseAsync(['node', 'awm', 'changes', 'list', '--since', 'soon']);
        expect(err.mock.calls[0][0]).toMatch(/^since-invalid: /);
        expect(out).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(2);
    });
    test('a working directory that is gone is reported, not thrown', async () => {
        jest.spyOn(process, 'cwd').mockImplementation(() => { throw new Error('ENOENT'); });
        await expect(program().parseAsync(['node', 'awm', 'changes', 'list'])).resolves.toBeDefined();
        expect(err.mock.calls[0][0]).toMatch(/^not-a-git-repo: /);
        expect(process.exitCode).toBe(2);
    });
    test('an unexpected throw inside the action is reported, not thrown', async () => {
        jest.spyOn(listModule, 'listChanges').mockImplementation(() => { throw new Error('boom'); });
        await expect(program().parseAsync(['node', 'awm', 'changes', 'list'])).resolves.toBeDefined();
        expect(err.mock.calls[0][0]).toMatch(/^internal-error: /);
        expect(process.exitCode).toBe(2);
    });
});
