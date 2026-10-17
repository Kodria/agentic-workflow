import fs from 'fs';
import path from 'path';
import { makeRepo, type TestRepo } from './helpers';
import { LOG_SAFETY_ARGS, isSafeRef, isSafeRevision, isSafeRelativePath, resolveBase, mergeBase, isAncestor, changedFiles, isDirtyOutside, repoRoot, headSha, repoIdentity, runGit } from '../../../src/core/changes/git';
import { deriveFields, deriveFromCommits, deriveModules } from '../../../src/core/changes/derive';
import { hasOptOut } from '../../../src/core/changes/trailers';

let repo: TestRepo;
beforeEach(() => { repo = makeRepo(); });
afterEach(() => repo.cleanup());

const bad = (v: unknown) => v as never;
const NOT_STRINGS = [undefined, null, 7, {}, ['main'], true];
const UNSAFE_REFS = ['--upload-pack=x', '-x', '-', 'a..b', 'a b', 'main\n', 'x\ny', 'a\u0000b', 'a;b', '$(id)', 'a`b`', 'main^', 'HEAD~1', 'a:b', '', 'a'.repeat(300), 'ma\u0301in'];
const c = (type: string, scope: string | null, breaking = false) => ({ type, scope, breaking, subject: 's' });
const noNewFile = (name: string) => expect(fs.existsSync(path.join(repo.root, name))).toBe(false);
const nonRepoDir = () => fs.mkdtempSync(path.join(repo.home, 'plain-'));

/** A commit carrying a forged `gpgsig` header, written straight into the object store (no gpg needed). */
function commitForgedSigned(message: string, file = 'signed.ts'): string {
    fs.writeFileSync(path.join(repo.root, file), '1');
    repo.git('add', '-A');
    const body = [`tree ${repo.git('write-tree')}`, `parent ${repo.git('rev-parse', 'HEAD')}`, 'author t <t@t> 1700000000 +0000', 'committer t <t@t> 1700000000 +0000',
        'gpgsig -----BEGIN PGP SIGNATURE-----', ' ', ' forged', ' -----END PGP SIGNATURE-----', '', message, ''].join('\n');
    const bodyFile = path.join(repo.home, 'forged-commit.txt');
    fs.writeFileSync(bodyFile, body);
    const sha = repo.git('hash-object', '-t', 'commit', '-w', bodyFile);
    repo.git('reset', '-q', '--hard', sha);
    return sha;
}

/** Repo-local config (the helper only isolates the global one): git prints verification text before each signed commit. */
function showSignaturesInLog(): void {
    repo.git('config', 'log.showSignature', 'true');
    repo.git('config', 'gpg.program', process.execPath); // any program that writes to stderr; the output is what matters, not a real gpg
}

function branch(): string {
    repo.git('checkout', '-q', '-b', 'feat/x');
    return repo.git('rev-parse', 'main');
}

describe('git runner', () => {
    test('returns the output of a successful command', () => {
        expect(runGit(repo.root, ['rev-parse', '--is-inside-work-tree'])?.trim()).toBe('true');
    });
    test('returns null when git fails', () => {
        expect(runGit(repo.root, ['rev-parse', '--verify', '--quiet', 'nope-ref'])).toBeNull();
    });
    test.each(NOT_STRINGS)('returns null for a non-string cwd (%p)', (cwd) => {
        expect(runGit(bad(cwd), ['status'])).toBeNull();
    });
    test('returns null for a non-array args value', () => {
        expect(runGit(repo.root, bad('status'))).toBeNull();
    });
    test('returns null when an argument is not a string or holds a NUL', () => {
        expect(runGit(repo.root, bad(['status', 7]))).toBeNull();
        expect(runGit(repo.root, ['status', 'a\u0000b'])).toBeNull();
    });
    test('returns null for a directory that does not exist', () => {
        expect(runGit(path.join(repo.home, 'missing'), ['status'])).toBeNull();
    });
});

describe('git wrappers', () => {
    test('R3.1 resolves base: explicit, origin/HEAD, main, master', () => {
        branch();
        expect(resolveBase(repo.root)).toBe('main');
        expect(resolveBase(repo.root, 'main')).toBe('main');
        repo.git('update-ref', 'refs/remotes/origin/main', 'main');
        repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
        expect(resolveBase(repo.root)).toBe('refs/remotes/origin/HEAD');
    });
    test('R3.1 an explicit base wins over origin/HEAD and main', () => {
        branch();
        repo.git('branch', 'release');
        repo.git('update-ref', 'refs/remotes/origin/main', 'main');
        repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
        expect(resolveBase(repo.root, 'release')).toBe('release');
    });
    test('R3.1 main wins over master and master is the last resort', () => {
        repo.git('branch', 'master');
        expect(resolveBase(repo.root)).toBe('main');
        repo.git('branch', '-m', 'main', 'trunk');
        expect(resolveBase(repo.root)).toBe('master');
    });
    test('R3.1 origin/HEAD that points nowhere is skipped', () => {
        repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone');
        expect(resolveBase(repo.root)).toBe('main');
    });
    test('R3.2 unresolvable base returns null', () => {
        repo.git('branch', '-m', 'main', 'trunk');
        expect(resolveBase(repo.root)).toBeNull();
        expect(resolveBase(repo.root, 'nope')).toBeNull();
    });
    test.each(UNSAFE_REFS)('R3.2 unsafe explicit base %j returns null without falling back to main', (ref) => {
        repo.commit({ 'second.ts': '1' }, 'feat: second');
        expect(resolveBase(repo.root, ref)).toBeNull();
        noNewFile('x');
    });
    test.each(NOT_STRINGS.filter((v) => v !== undefined))('R3.2 non-string explicit base (%p) returns null', (ref) => {
        expect(resolveBase(repo.root, bad(ref))).toBeNull();
    });
    test('R3.2 a non-string root returns null', () => {
        expect(resolveBase(bad(null))).toBeNull();
        expect(resolveBase(nonRepoDir())).toBeNull();
    });
    test('R3.1 a ref that names a tree rather than a commit is not a base', () => {
        const tree = repo.git('rev-parse', 'HEAD^{tree}');
        repo.git('update-ref', 'refs/tags/treeish', tree);
        expect(resolveBase(repo.root, 'treeish')).toBeNull();
    });

    test('mergeBase returns the fork point, not the tip of the base', () => {
        const fork = branch();
        repo.commit({ 'a.ts': '1' }, 'feat: a');
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'm.ts': '1' }, 'feat: moves main');
        repo.git('checkout', '-q', 'feat/x');
        expect(mergeBase(repo.root, 'main')).toBe(fork);
        expect(mergeBase(repo.root, 'main')).not.toBe(repo.git('rev-parse', 'main'));
    });
    test('mergeBase returns null for unrelated histories, unknown, unsafe or non-string refs', () => {
        repo.git('checkout', '-q', '--orphan', 'orphan');
        repo.commit({ 'o.ts': '1' }, 'feat: orphan');
        expect(mergeBase(repo.root, 'main')).toBeNull();
        expect(mergeBase(repo.root, 'nope')).toBeNull();
        expect(mergeBase(repo.root, '--output=x')).toBeNull();
        expect(mergeBase(repo.root, 'a..b')).toBeNull();
        repo.commit({ 'second.ts': '1' }, 'feat: second');
        expect(mergeBase(repo.root, 'HEAD~1')).toBeNull();
        expect(mergeBase(repo.root, bad(7))).toBeNull();
        expect(mergeBase(bad(undefined), 'main')).toBeNull();
        noNewFile('x');
    });

    test('ancestry', () => {
        const base = branch();
        const c1 = repo.commit({ 'src/a.ts': '1' }, 'feat: a');
        expect(isAncestor(repo.root, base, c1)).toBe(true);
        expect(isAncestor(repo.root, c1, base)).toBe(false);
        expect(isAncestor(repo.root, 'f'.repeat(40), c1)).toBe(false);
    });
    test('ancestry is false for unsafe or non-string arguments', () => {
        const base = branch();
        repo.commit({ 'second.ts': '1' }, 'feat: second');
        expect(isAncestor(repo.root, 'HEAD~1', 'HEAD')).toBe(false);
        expect(isAncestor(repo.root, 'main', 'HEAD^')).toBe(false);
        expect(isAncestor(repo.root, '--help', 'HEAD')).toBe(false);
        expect(isAncestor(repo.root, base, '-x')).toBe(false);
        expect(isAncestor(repo.root, 'a..b', 'HEAD')).toBe(false);
        expect(isAncestor(repo.root, bad(null), 'HEAD')).toBe(false);
        expect(isAncestor(repo.root, base, bad(7))).toBe(false);
        expect(isAncestor(bad({}), base, 'HEAD')).toBe(false);
    });

    test('changedFiles lists the files of the range', () => {
        const base = branch();
        repo.commit({ 'src/a.ts': '1' }, 'feat: a');
        expect(changedFiles(repo.root, base, 'HEAD')).toEqual(['src/a.ts']);
    });
    test('changedFiles reports a rename as the old and the new path', () => {
        repo.commit({ 'old.ts': 'same content, long enough to be detected as a rename\n'.repeat(5) }, 'feat: old');
        const base = branch();
        repo.git('mv', 'old.ts', 'new.ts');
        repo.git('commit', '-q', '-m', 'refactor: rename');
        expect(changedFiles(repo.root, base)?.slice().sort()).toEqual(['new.ts', 'old.ts']);
    });
    test('changedFiles returns paths verbatim: spaces, unicode and (off Windows) a newline', () => {
        const base = branch();
        const names = ['dir with space/ñandú.ts'];
        if (process.platform !== 'win32') names.push('line\nbreak/x.ts');
        repo.commit(Object.fromEntries(names.map((n) => [n, '1'])), 'feat: odd names');
        expect(changedFiles(repo.root, base)?.slice().sort()).toEqual([...names].sort());
    });
    test('changedFiles returns null for unsafe, unknown or non-string revisions and for a non-repo', () => {
        branch();
        expect(changedFiles(repo.root, '--output=x', 'HEAD')).toBeNull();
        expect(changedFiles(repo.root, 'HEAD', '--output=x')).toBeNull();
        expect(changedFiles(repo.root, 'nope', 'HEAD')).toBeNull();
        expect(changedFiles(repo.root, bad(7), 'HEAD')).toBeNull();
        repo.commit({ 'second.ts': '1' }, 'feat: second');
        expect(changedFiles(repo.root, 'HEAD~1', 'HEAD')).toBeNull();
        expect(changedFiles(repo.root, 'HEAD', 'HEAD^')).toBeNull();
        expect(changedFiles(nonRepoDir(), 'main', 'HEAD')).toBeNull();
        noNewFile('x');
    });

    test('dirtiness ignores only the excluded paths', () => {
        branch();
        expect(isDirtyOutside(repo.root, ['docs/changes'])).toBe(false);
        fs.mkdirSync(path.join(repo.root, 'docs/changes'), { recursive: true });
        fs.writeFileSync(path.join(repo.root, 'docs/changes/r.md'), 'r');
        expect(isDirtyOutside(repo.root, ['docs/changes'])).toBe(false);
        expect(isDirtyOutside(repo.root, [])).toBe(true);
        fs.writeFileSync(path.join(repo.root, 'docs-x.md'), 'y');
        expect(isDirtyOutside(repo.root, ['.awm', 'docs/changes'])).toBe(true);
    });
    test('dirtiness: runtime state under .awm is ignored but a modified tracked sensors.json is dirty', () => {
        fs.mkdirSync(path.join(repo.root, '.awm/journal'), { recursive: true });
        fs.writeFileSync(path.join(repo.root, '.awm/sensors.json'), '{}');
        fs.writeFileSync(path.join(repo.root, '.awm/journal/j.json'), '1');
        repo.git('add', '-f', '.awm/sensors.json', '.awm/journal/j.json');
        repo.git('commit', '-q', '-m', 'chore: track awm files');
        fs.writeFileSync(path.join(repo.root, '.awm/journal/j.json'), '2');
        expect(isDirtyOutside(repo.root, [])).toBe(false);
        fs.writeFileSync(path.join(repo.root, '.awm/sensors.json'), '{"a":1}');
        expect(isDirtyOutside(repo.root, [])).toBe(true);
    });
    test('dirtiness: runtime state stays excluded when extra exclusions are given too', () => {
        fs.mkdirSync(path.join(repo.root, '.awm/journal'), { recursive: true });
        fs.writeFileSync(path.join(repo.root, '.awm/journal/j.json'), '1');
        repo.git('add', '-f', '.awm/journal/j.json');
        repo.git('commit', '-q', '-m', 'chore: track journal');
        fs.writeFileSync(path.join(repo.root, '.awm/journal/j.json'), '2');
        fs.mkdirSync(path.join(repo.root, 'docs/changes'), { recursive: true });
        fs.writeFileSync(path.join(repo.root, 'docs/changes/r.md'), 'r');
        expect(isDirtyOutside(repo.root, ['docs/changes'])).toBe(false);
    });
    test('dirtiness is reported (fail closed) when the state cannot be read or the excludes are unsafe', () => {
        expect(isDirtyOutside(nonRepoDir(), [])).toBe(true);
        expect(isDirtyOutside(bad(null), [])).toBe(true);
        expect(isDirtyOutside(repo.root, bad('docs/changes'))).toBe(true);
        expect(isDirtyOutside(repo.root, bad([7]))).toBe(true);
        expect(isDirtyOutside(repo.root, ['../outside'])).toBe(true);
        expect(isDirtyOutside(repo.root, ['a\nb'])).toBe(true);
        expect(isDirtyOutside(repo.root, ['/abs'])).toBe(true);
    });

    test('repoRoot and headSha describe the repository, from a subdirectory too', () => {
        const sub = path.join(repo.root, 'deep', 'er');
        fs.mkdirSync(sub, { recursive: true });
        expect(fs.realpathSync.native(repoRoot(repo.root) as string)).toBe(fs.realpathSync.native(repo.root));
        expect(fs.realpathSync.native(repoRoot(sub) as string)).toBe(fs.realpathSync.native(repo.root));
        expect(path.isAbsolute(repoRoot(sub) as string)).toBe(true);
        expect(headSha(sub)).toBe(repo.git('rev-parse', 'HEAD'));
    });
    test('repoRoot and headSha are null outside a repository and for non-string input', () => {
        expect(repoRoot(nonRepoDir())).toBeNull();
        expect(headSha(nonRepoDir())).toBeNull();
        expect(repoRoot(bad(undefined))).toBeNull();
        expect(headSha(bad(7))).toBeNull();
    });

    describe('repoIdentity', () => {
        const identity = (url: string) => { repo.git('remote', 'add', 'origin', url); return repoIdentity(repo.root); };
        test('is null without a remote', () => expect(repoIdentity(repo.root)).toBeNull());
        test('reads an https remote and strips credentials and .git', () => {
            expect(identity('https://user:secret@github.com/Kodria/awm.git')).toBe('github.com/Kodria/awm');
        });
        test('reads an scp-style remote', () => expect(identity('git@github.com:Kodria/awm.git')).toBe('github.com/Kodria/awm'));
        test('reads an ssh:// remote with a port', () => expect(identity('ssh://git@host.example:2222/o/r')).toBe('host.example/o/r'));
        test('is null for an unparseable remote', () => expect(identity('not a url')).toBeNull());
        test('is null for a non-string root or outside a repository', () => {
            expect(repoIdentity(bad(null))).toBeNull();
            expect(repoIdentity(nonRepoDir())).toBeNull();
        });
        test('is null when the remote path carries a control character', () => {
            expect(identity('git@host:o/r\u0001x.git')).toBeNull();
        });
    });
});

describe('derivation', () => {
    test('R3.3 semver/type/breaking/scope rules', () => {
        expect(deriveFromCommits([c('fix', 'a'), c('feat', 'b'), c('feat', 'b')])).toEqual({ type: 'feat', scope: 'b', semver: 'minor', breaking: false });
        expect(deriveFromCommits([c('feat', 'a'), c('refactor', 'z', true)])).toEqual({ type: 'refactor', scope: 'a', semver: 'major', breaking: true });
        expect(deriveFromCommits([c('docs', null), c('chore', null)])).toEqual({ type: 'docs', scope: null, semver: 'none', breaking: false });
        expect(deriveFromCommits([c('perf', 'b'), c('perf', 'a')])).toEqual({ type: 'perf', scope: 'a', semver: 'patch', breaking: false });
    });
    test('R3.3 type precedence is breaking > feat > fix > perf > first commit', () => {
        expect(deriveFromCommits([c('perf', null), c('fix', null), c('docs', null)])?.type).toBe('fix');
        expect(deriveFromCommits([c('docs', null), c('perf', null), c('chore', null)])?.type).toBe('perf');
        expect(deriveFromCommits([c('chore', null), c('docs', null)])?.type).toBe('chore');
        expect(deriveFromCommits([c('fix', null), c('feat', null), c('docs', null, true)])?.type).toBe('docs');
    });
    test('R3.3 the most frequent scope wins, ties break alphabetically, null scopes do not count', () => {
        expect(deriveFromCommits([c('feat', 'a'), c('feat', 'b'), c('feat', 'b')])?.scope).toBe('b');
        expect(deriveFromCommits([c('feat', 'b'), c('feat', 'a')])?.scope).toBe('a');
        expect(deriveFromCommits([c('feat', null), c('feat', null), c('feat', 'z')])?.scope).toBe('z');
    });
    test('R3.3 semver none for non-releasing types, patch for fix', () => {
        expect(deriveFromCommits([c('fix', null), c('docs', null)])?.semver).toBe('patch');
        expect(deriveFromCommits([c('test', null)])?.semver).toBe('none');
    });
    test('deriveFromCommits returns null for an empty list and for non-array input', () => {
        expect(deriveFromCommits([])).toBeNull();
        expect(deriveFromCommits(bad(null))).toBeNull();
        expect(deriveFromCommits(bad('feat: x'))).toBeNull();
    });
    test('deriveFromCommits ignores entries that are not usable conventional commits', () => {
        const hostile = [null, 'x', { type: 7, scope: null, breaking: false, subject: 's' }, c('', 'a'), c('fe-at', 'a'), c('fe at', 'a'), c('fe\nat', 'a')];
        expect(deriveFromCommits(bad(hostile))).toBeNull();
        expect(deriveFromCommits(bad([...hostile, c('fix', 'k')]))).toEqual({ type: 'fix', scope: 'k', semver: 'patch', breaking: false });
    });
    test('R3.3 breaking and semver cover every commit the release parser accepts, whatever the type spelling', () => {
        expect(deriveFromCommits([c('Feat', null, true)])).toEqual({ type: 'feat', scope: null, semver: 'major', breaking: true });
        expect(deriveFromCommits([c('Feat', null, true), c('fix', 'a')])).toEqual({ type: 'feat', scope: 'a', semver: 'major', breaking: true });
        expect(deriveFromCommits([c('Refactor', 'core', true)])).toEqual({ type: 'refactor', scope: 'core', semver: 'major', breaking: true });
    });
    test('R3.3 a type that is not purely letters after lowercasing is recorded as other', () => {
        expect(deriveFromCommits([c('feat2', null, true)])).toEqual({ type: 'other', scope: null, semver: 'major', breaking: true });
        expect(deriveFromCommits([c('fix_x', null, true)])?.type).toBe('other');
        expect(deriveFromCommits([c('FIX_X', null)])).toEqual({ type: 'other', scope: null, semver: 'none', breaking: false });
        expect(deriveFromCommits([c('FEAT', null)])?.type).toBe('feat');
    });
    test('R3.3 semver follows the release parser: only an exact feat or fix type releases', () => {
        expect(deriveFromCommits([c('Feat', null)])?.semver).toBe('none');
        expect(deriveFromCommits([c('Fix', null), c('docs', null)])?.semver).toBe('none');
    });
    test('R3.3 the scope tie-break is by UTF-16 code-unit order, not by locale', () => {
        const saved = process.env.LC_ALL;
        process.env.LC_ALL = 'sv_SE.UTF-8';
        try {
            expect(deriveFromCommits([c('feat', 'a'), c('feat', 'Z')])?.scope).toBe('Z');
            expect(deriveFromCommits([c('feat', 'f'), c('feat', 'é')])?.scope).toBe('f');
            expect(deriveFromCommits([c('feat', 'é'), c('feat', 'e')])?.scope).toBe('e');
            expect(deriveFromCommits([c('feat', 'B'), c('feat', 'b'), c('feat', 'b')])?.scope).toBe('b');
        } finally {
            if (saved === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = saved;
        }
    });
    test('deriveFromCommits treats only a literal true as breaking', () => {
        expect(deriveFromCommits(bad([{ type: 'feat', scope: null, breaking: 'yes', subject: 's' }]))).toEqual({ type: 'feat', scope: null, semver: 'minor', breaking: false });
    });
    test('deriveFromCommits drops a scope that is blank or not single-line', () => {
        expect(deriveFromCommits([c('feat', 'a\nb'), c('feat', 'a\nb'), c('feat', '  '), c('feat', 'ok')])).toEqual({ type: 'feat', scope: 'ok', semver: 'minor', breaking: false });
        expect(deriveFromCommits([c('feat', 'tab\there')])?.scope).toBeNull();
    });

    test('R3.4 modules: parent dirs truncated to 3 segments, root files map to ., docs/changes excluded', () => {
        expect(deriveModules(['cli/src/core/changes/x.ts', 'README.md', 'docs/changes/2026-10-17-a.md', 'cli/src/a.ts', 'cli/src/core/y.ts']))
            .toEqual(['.', 'cli/src', 'cli/src/core']);
    });
    test('R3.4 truncation keeps exactly three segments and deduplicates', () => {
        expect(deriveModules(['a/b/c/d/e.ts', 'a/b/c/f.ts', 'a/b/c/g/h/i.ts'])).toEqual(['a/b/c']);
        expect(deriveModules(['a/b/x.ts', 'a/b/c/y.ts'])).toEqual(['a/b', 'a/b/c']);
    });
    test('R3.4 modules are sorted', () => {
        expect(deriveModules(['z/a.ts', 'm.md', 'b/a.ts'])).toEqual(['.', 'b', 'z']);
    });
    test('R3.4 only docs/changes itself is excluded, not similarly named directories', () => {
        expect(deriveModules(['docs/changes/x.md', 'docs/changes/sub/y.md', 'docs/changes-old/z.md', 'docs/changesx/w.md', 'docs/other.md']))
            .toEqual(['docs', 'docs/changes-old', 'docs/changesx']);
    });
    test('R3.4 a docs/changes file does not contribute a module even when it is the only file', () => {
        expect(deriveModules(['docs/changes/x.md'])).toEqual([]);
    });
    test('R3.4 directories a record cannot represent are dropped instead of leaking into modules', () => {
        const odd = ['a\nb/x.ts', 'tab\there/x.ts', 'back\\slash/x.ts', ' pad/x.ts', 'ok/x.ts', '../up/x.ts', '/abs/x.ts', 'a//b/x.ts'];
        expect(deriveModules(odd)).toEqual(['ok']);
    });
    test('R3.4 a bad segment beyond the third is truncated away and does not matter', () => {
        expect(deriveModules(['a/b/c/we\nird/x.ts'])).toEqual(['a/b/c']);
    });
    test('deriveModules tolerates non-array input and non-string entries', () => {
        expect(deriveModules(bad(null))).toEqual([]);
        expect(deriveModules(bad(['ok/a.ts', 7, null, {}]))).toEqual(['ok']);
    });

    test('R3.3/R3.4 deriveFields over a real range ignores record-only commits', () => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): add a');
        repo.commit({ 'cli/src/b.ts': '1' }, 'fix(changes): b');
        const before = deriveFields(repo.root, mergeBase(repo.root, base));
        repo.commit({ 'docs/changes/2026-10-17-x.md': 'r' }, 'docs(other): add record');
        const after = deriveFields(repo.root, mergeBase(repo.root, base));
        expect(before).toEqual({ ok: true, fields: { type: 'feat', scope: 'changes', semver: 'minor', breaking: false, modules: ['cli/src'] } });
        expect(after).toEqual(before);
    });
    test('R3.3 a record commit that also touches code still counts', () => {
        const base = branch();
        repo.commit({ 'docs/changes/r.md': 'r', 'cli/src/a.ts': '1' }, 'fix(mixed): code with its record');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'fix', scope: 'mixed', semver: 'patch', breaking: false, modules: ['cli/src'] } });
    });
    test('R3.3 a BREAKING CHANGE footer or a ! marks the range as major', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'refactor(core): drop api\n\nBREAKING CHANGE: gone');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'refactor', scope: 'core', semver: 'major', breaking: true, modules: ['.'] } });
    });
    test('R3.1 only the commits after the merge base count', () => {
        branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'fix(mine): mine');
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'other/z.ts': '1' }, 'feat(theirs)!: theirs');
        repo.git('checkout', '-q', 'feat/x');
        expect(deriveFields(repo.root, mergeBase(repo.root, 'main'))).toEqual({ ok: true, fields: { type: 'fix', scope: 'mine', semver: 'patch', breaking: false, modules: ['cli/src'] } });
    });
    test('R3.3 a capitalised breaking type from a real commit is major', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'Feat!: remove api');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: null, semver: 'major', breaking: true, modules: ['.'] } });
    });
    test('R3.3 a commit with a type the release parser accepts but a record cannot hold is other', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'feat2!: x');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'other', scope: null, semver: 'major', breaking: true, modules: ['.'] } });
    });
    test('R3.3 a side branch merged with a tree-discarding merge still counts', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'fix(a): a');
        repo.git('checkout', '-q', '-b', 'side', 'main');
        repo.commit({ 'b.ts': '1' }, 'feat(b)!: big');
        repo.git('checkout', '-q', 'feat/x');
        repo.git('merge', '-q', '-s', 'ours', '--no-ff', 'side', '-m', 'chore: merge side, keeping ours');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'a', semver: 'major', breaking: true, modules: ['.'] } });
    });
    test('R3.5 code that only sits on a side branch merged with -s ours is not "no commits"', () => {
        const base = branch();
        repo.git('checkout', '-q', '-b', 'side', 'main');
        repo.commit({ 'b.ts': '1' }, 'fix(b): only on the side');
        repo.git('checkout', '-q', 'feat/x');
        repo.git('merge', '-q', '-s', 'ours', '--no-ff', 'side', '-m', 'chore: merge side, keeping ours');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'fix', scope: 'b', semver: 'patch', breaking: false, modules: [] } });
    });
    test('R3.1 merge commits are not derived from', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'feat(core): a');
        repo.git('checkout', '-q', '-b', 'side');
        repo.commit({ 'side.ts': '1' }, 'docs(side): side');
        repo.git('checkout', '-q', 'feat/x');
        repo.commit({ 'b.ts': '1' }, 'fix(core): b');
        repo.git('merge', '-q', '--no-ff', 'side', '-m', 'feat(merge)!: merged');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'core', semver: 'minor', breaking: false, modules: ['.'] } });
    });
    test('R3.3 non-conventional commits are skipped when another one is conventional', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'random message');
        repo.commit({ 'b.ts': '1' }, 'fix(x): real');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'fix', scope: 'x', semver: 'patch', breaking: false, modules: ['.'] } });
    });
    test('R3.3 one commit cannot forge another through the record separator in its message', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs(x): innocent\n\nsee \u001efeat(forged)!: evil\u001f more');
        repo.commit({ 'b.ts': '1' }, 'docs(x): fake \u001efeat(forged)!: subject forgery');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'docs', scope: 'x', semver: 'none', breaking: false, modules: ['.'] } });
    });
    test('R3.4 modules with unrepresentable directory names are dropped from the derived fields', () => {
        if (process.platform === 'win32') return;
        const base = branch();
        repo.commit({ 'ok/a.ts': '1', 'bad\nname/b.ts': '1' }, 'feat(x): odd');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'x', semver: 'minor', breaking: false, modules: ['ok'] } });
    });
    test('R3.5 no commits and no conventional commits fail', () => {
        const base = branch();
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-commits' }) });
        repo.commit({ 'a.ts': '1' }, 'random message');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-conventional-commits' }) });
    });
    // R3.3: only non-merge commits that touch at least one path outside docs/changes/ are derived from; an empty commit
    // (`git commit --allow-empty`) changes no path at all, so it is ignored, as the release script's path-limited log does.
    const emptyCommit = (message: string) => repo.git('commit', '-q', '--allow-empty', '-m', message);
    test('R3.3 an empty breaking commit is ignored', () => {
        const base = branch();
        repo.commit({ 'src/x.ts': '1' }, 'fix: y');
        emptyCommit('feat!: empty');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'fix', scope: null, semver: 'patch', breaking: false, modules: ['src'] } });
    });
    test('R3.5 a range holding only an empty commit has no commits', () => {
        const base = branch();
        emptyCommit('feat: empty');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-commits' }) });
    });
    test('R3.3 with an empty commit, a record-only commit and a real commit, only the real one counts', () => {
        const base = branch();
        emptyCommit('feat(e)!: empty');
        repo.commit({ 'docs/changes/r.md': 'r' }, 'feat(r)!: record');
        repo.commit({ 'src/real.ts': '1' }, 'perf(real): real');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'perf', scope: 'real', semver: 'patch', breaking: false, modules: ['src'] } });
    });
    test('R3.5 a range holding only record commits has no commits', () => {
        const base = branch();
        repo.commit({ 'docs/changes/r.md': 'r' }, 'docs(changes): record');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-commits' }) });
    });
    test('R3.5 a range holding only a merge commit has no commits', () => {
        const fork = branch();
        repo.git('checkout', '-q', 'main');
        const moved = repo.commit({ 'm.ts': '1' }, 'feat(main): moves main');
        repo.git('checkout', '-q', 'feat/x');
        // An evil merge (it adds a file of its own), so that path-limited history simplification cannot hide it.
        repo.git('merge', '-q', '--no-ff', '--no-commit', 'main');
        fs.writeFileSync(path.join(repo.root, 'evil.ts'), '1');
        repo.git('add', 'evil.ts');
        repo.git('commit', '-q', '-m', 'feat(merge)!: bring main');
        expect(deriveFields(repo.root, fork)).toEqual({ ok: true, fields: expect.objectContaining({ type: 'feat', scope: 'main', breaking: false }) });
        expect(deriveFields(repo.root, moved)).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-commits' }) });
    });
    test('deriveFields reports git-failed when git cannot read the range', () => {
        branch();
        const result = deriveFields(nonRepoDir(), 'a'.repeat(40));
        expect(result).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'git-failed' }) });
    });
    test('deriveFields works from a subdirectory of the repository', () => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1', 'top.ts': '1' }, 'feat(c): top and sub');
        const sub = path.join(repo.root, 'cli');
        expect(deriveFields(sub, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'c', semver: 'minor', breaking: false, modules: ['.', 'cli/src'] } });
    });
    test.each([...NOT_STRINGS, '', 'HEAD', '--output=x', 'abc', 'g'.repeat(40), 'a'.repeat(65), 'main'])('deriveFields rejects a merge-base that is not a commit id (%p) with invalid-input', (sha) => {
        expect(deriveFields(repo.root, bad(sha))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'invalid-input' }) });
        noNewFile('x');
    });
    test('deriveFields rejects a non-string root with invalid-input', () => {
        expect(deriveFields(bad(null), 'a'.repeat(40))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'invalid-input' }) });
    });
    test('A3.2 diagnostics never echo untrusted text raw', () => {
        const hostile = 'abc\ndef\u001b[31m\u2028x';
        const result = deriveFields(repo.root, hostile);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.diagnostic.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
        expect(result.diagnostic.message).toContain('abc\\ndef');
        expect(result.diagnostic.message.length).toBeLessThanOrEqual(300);
    });
});

describe('user git configuration does not change what is parsed', () => {
    test('LOG_SAFETY_ARGS switches signature display off and fixes the encoding', () => {
        expect([...LOG_SAFETY_ARGS]).toEqual(['--no-show-signature', '--encoding=UTF-8']);
    });
    test('R3.3 a signed breaking commit is derived even with log.showSignature on', () => {
        const base = branch();
        showSignaturesInLog();
        commitForgedSigned('feat(zzz)!: signed');
        expect(repo.git('log', '-1', '--format=%s')).not.toBe('feat(zzz)!: signed'); // the config really pollutes plain git log
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'zzz', semver: 'major', breaking: true, modules: ['.'] } });
    });
    test('hasOptOut sees a signed Change-Record: none commit even with log.showSignature on', () => {
        const base = branch();
        showSignaturesInLog();
        commitForgedSigned('docs: signed\n\nChange-Record: none');
        expect(repo.git('log', '-1', '--format=%s')).not.toBe('docs: signed');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
    });
    test('R3.3 a non-ASCII scope survives i18n.logOutputEncoding', () => {
        const base = branch();
        repo.git('config', 'i18n.logOutputEncoding', 'ISO-8859-1');
        repo.commit({ 'a.ts': '1' }, 'feat(mañana): x');
        expect(repo.git('log', '-1', '--format=%s')).not.toBe('feat(mañana): x'); // the config really re-encodes plain git log
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'mañana', semver: 'minor', breaking: false, modules: ['.'] } });
    });
    test('R3.4 changed paths stay repo-relative with diff.relative on, from a subdirectory too', () => {
        const base = branch();
        repo.git('config', 'diff.relative', 'true');
        repo.commit({ 'cli/src/a.ts': '1', 'top.ts': '1' }, 'feat(c): top and sub');
        const sub = path.join(repo.root, 'cli');
        expect(changedFiles(sub, base)?.slice().sort()).toEqual(['cli/src/a.ts', 'top.ts']);
        expect(deriveFields(sub, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'c', semver: 'minor', breaking: false, modules: ['.', 'cli/src'] } });
    });
});

/** Sets variables on process.env (the environment runGit hands to git) for the duration of `fn`. */
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

describe('the environment does not change what is parsed', () => {
    const PATHSPEC_VARS = ['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'];
    test.each(PATHSPEC_VARS)('R3.3 %s=1 does not change the derived range, modules, opt-out or file list', (name) => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(c): a\n\nChange-Record: none');
        withEnv({ [name]: '1' }, () => {
            expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'c', semver: 'minor', breaking: false, modules: ['cli/src'] } });
            expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
            expect(changedFiles(repo.root, base)).toEqual(['cli/src/a.ts']);
        });
    });
    test('R3.5 a commit that only touches a differently cased Docs/Changes is not a record commit, with or without GIT_ICASE_PATHSPECS', () => {
        const base = branch();
        repo.commit({ 'Docs/Changes/up.md': '1' }, 'feat(c): up');
        const expected = { ok: true, fields: { type: 'feat', scope: 'c', semver: 'minor', breaking: false, modules: ['Docs/Changes'] } };
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual(expected);
        withEnv({ GIT_ICASE_PATHSPECS: '1' }, () => expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual(expected));
    });
    test('R3.5 a commit that only touches docs/changes stays excluded when the environment asks for literal pathspecs', () => {
        const base = branch();
        repo.commit({ 'docs/changes/r.md': '1' }, 'docs(c): record');
        withEnv({ GIT_LITERAL_PATHSPECS: '1' }, () => expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-commits' }) }));
    });
    test('dirtiness with extra exclusions is not changed by GIT_LITERAL_PATHSPECS', () => {
        fs.mkdirSync(path.join(repo.root, 'docs/changes'), { recursive: true });
        fs.writeFileSync(path.join(repo.root, 'docs/changes/r.md'), 'r');
        withEnv({ GIT_LITERAL_PATHSPECS: '1' }, () => {
            expect(isDirtyOutside(repo.root, ['docs/changes'])).toBe(false);
            expect(isDirtyOutside(repo.root, [])).toBe(true);
        });
    });
});

describe('R3.4 submodule changes are not hidden by configuration', () => {
    test('a bumped gitlink stays in modules with diff.ignoreSubmodules=all and ignore=all in .gitmodules', () => {
        const first = repo.git('rev-parse', 'HEAD');
        const second = repo.commit({ 'x.txt': '1', '.gitmodules': '[submodule "vendor/sm"]\n\tpath = vendor/sm\n\turl = ./nowhere\n\tignore = all\n' }, 'chore: gitmodules');
        repo.git('config', 'diff.ignoreSubmodules', 'all');
        repo.git('update-index', '--add', '--cacheinfo', `160000,${first},vendor/sm`);
        repo.git('commit', '-q', '-m', 'chore: add submodule');
        const base = branch();
        repo.git('update-index', '--cacheinfo', `160000,${second},vendor/sm`);
        repo.git('commit', '-q', '-m', 'feat(v): bump submodule');
        expect(changedFiles(repo.root, base)).toEqual(['vendor/sm']);
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'v', semver: 'minor', breaking: false, modules: ['vendor'] } });
    });
});

describe('safety predicates', () => {
    test('isSafeRef accepts plain ref names only', () => {
        for (const ok of ['main', 'refs/remotes/origin/HEAD', 'feat/x-1.2', 'a'.repeat(40), '.hidden']) expect(isSafeRef(ok)).toBe(true);
        for (const no of ['', '-x', '--a', 'a..b', 'a b', 'a\nb', 'a^', 'a~1', 'a@{1}', 'a:b', 'a'.repeat(256), 7, null, undefined, {}]) expect(isSafeRef(no)).toBe(false);
    });
    test('isSafeRevision accepts a ref or a two-sided range', () => {
        for (const ok of ['main', 'a..b', 'a...b', 'refs/heads/x..HEAD']) expect(isSafeRevision(ok)).toBe(true);
        for (const no of ['', '..', 'a..', '..b', 'a..b..c', '-x..b', 'a..-x', 'a b..c', 7, null]) expect(isSafeRevision(no)).toBe(false);
    });
    test('isSafeRelativePath accepts clean repo-relative paths only', () => {
        for (const ok of ['a', 'a/b', 'docs/changes', '.awm/journal']) expect(isSafeRelativePath(ok)).toBe(true);
        for (const no of ['', '.', '..', '../a', 'a/../b', 'a//b', 'a/', '/a', 'C:/a', 'a\\b', ' a', 'a ', 'a\nb', 'a\tb', 'a'.repeat(1025), 7, null]) expect(isSafeRelativePath(no)).toBe(false);
    });
});

describe('trailers', () => {
    test('detects Change-Record: none in a range', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs: typo');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
        repo.commit({ 'b.ts': '1' }, 'docs: typo2\n\nChange-Record: none');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
    });
    test('the key and the value match case-insensitively', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs: typo\n\nchange-record:   NONE  ');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
    });
    test('another value, another key or a longer key is not an opt-out', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs: a\n\nChange-Record: pending');
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Records: none');
        repo.commit({ 'c.ts': '1' }, 'docs: c\n\nX-Change-Record: none');
        repo.commit({ 'd.ts': '1' }, 'docs: d\n\nChange-Record: none-ish');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
    });
    test('an opt-out is found among several trailers and among several commits', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs: a');
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: pending\nChange-Record: none');
        repo.commit({ 'c.ts': '1' }, 'docs: c');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
    });
    test('trailer.* configuration cannot turn another separator or token into an opt-out', () => {
        const base = branch();
        repo.git('config', 'trailer.separators', ':=#');
        repo.git('config', 'trailer.cr.key', 'Change-Record');
        repo.commit({ 'a.ts': '1' }, 'docs: a\n\nChange-Record= none');
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nCR: none');
        repo.commit({ 'c.ts': '1' }, 'docs: c\n\nChange-Record# none');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
        repo.commit({ 'd.ts': '1' }, 'docs: d\n\nChange-Record: none');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
    });
    test('the value must be exactly none after optional blanks, in the final paragraph', () => {
        branch();
        repo.commit({ 'a.ts': '1' }, 'docs: a\n\nChange-Record:none');
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record:\t none \t');
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
        repo.commit({ 'c.ts': '1' }, 'docs: c\n\nSigned-off-by: t\nChange-Record: none');
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
        for (const message of ['docs: d\n\nChange-Record: nonesuch', 'docs: e\n\nChange-Record: none of it', 'docs: f\n\nChange-Record:', 'docs: g\n\nChange-Record:\n none', 'docs: h\n\n Change-Record: none', 'docs: i\n\nChange-Record: none\u00a0', 'docs: j\n\nChange-Record: none\u2028', 'docs: k\n\nChange-Record: none\u000b']) {
            repo.commit({ [`${message[6]}.ts`]: '1' }, message);
            expect([message, hasOptOut(repo.root, ['-1', 'HEAD'])]).toEqual([message, false]);
        }
    });
    test('text that is not in the trailer block does not count', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'Change-Record: none');
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none\n\nand then more prose after it');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
    });
    test('a trailer value cannot forge none through folding or separators', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs: a\n\nChange-Record: other\n none');
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: other\u001fnone');
        repo.commit({ 'c.ts': '1' }, 'docs: c\n\nChange-Record: other\u001enone');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
    });
    test('only the commits selected by the revisions are examined', () => {
        repo.commit({ 'a.ts': '1' }, 'docs: early\n\nChange-Record: none');
        const base = branch();
        const tip = repo.commit({ 'b.ts': '1' }, 'docs: plain');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
        expect(hasOptOut(repo.root, ['-1', tip])).toBe(false);
        expect(hasOptOut(repo.root, [base])).toBe(true);
        expect(hasOptOut(repo.root, ['-1', base])).toBe(true);
    });
    test.each([
        [['--output=x']], [['--all']], [['-1', '--all']], [['-1', '-2', 'HEAD']], [['HEAD~1']], [['HEAD^']], [['HEAD@{1}']], [['-x', 'HEAD']], [['a\nb']], [['HEAD\u0000']], [[]], [['-1']], [bad('HEAD')], [bad(null)], [bad([7])], [bad([null])], [['']], [['-99999999', 'HEAD']],
    ])('hostile revisions %j are rejected as no opt-out', (revArgs) => {
        repo.commit({ 'z.ts': '1' }, 'docs: z\n\nChange-Record: none');
        repo.commit({ 'y.ts': '1' }, 'docs: y');
        expect(hasOptOut(repo.root, revArgs)).toBe(false);
        noNewFile('x');
    });
    test('option injection through the revisions creates no file', () => {
        expect(hasOptOut(repo.root, ['--output=injected.txt', 'HEAD'])).toBe(false);
        noNewFile('injected.txt');
    });
    test('a non-string root or a non-repository is no opt-out', () => {
        expect(hasOptOut(bad(null), ['HEAD'])).toBe(false);
        expect(hasOptOut(nonRepoDir(), ['HEAD'])).toBe(false);
    });
});
