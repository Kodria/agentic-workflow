import fs from 'fs';
import os from 'os';
import path from 'path';
import { bad, branchOff, makeRepo, nonRepoDir as plainDir, withEnv, type TestRepo } from './helpers';
import { LOG_SAFETY_ARGS, isSafeRef, isSafeRevision, resolveBase, mergeBase, isAncestor, changedFiles, isDirtyOutside, repoRoot, headSha, repoIdentity, runGit } from '../../../src/core/changes/git';

const ANY_DIR = os.tmpdir();
const NOT_STRINGS = [undefined, null, 7, {}, ['main'], true];
const UNSAFE_REFS = ['--upload-pack=x', '-x', '-', 'a..b', 'a b', 'main\n', 'x\ny', 'a\u0000b', 'a;b', '$(id)', 'a`b`', 'main^', 'HEAD~1', 'a:b', '', 'a'.repeat(300), 'ma\u0301in'];

describe('ref and revision predicates (no repository)', () => {
    test('isSafeRef accepts plain ref names only', () => {
        for (const ok of ['main', 'refs/remotes/origin/HEAD', 'feat/x-1.2', 'a'.repeat(40), '.hidden']) expect(isSafeRef(ok)).toBe(true);
        for (const no of ['', '-x', '--a', 'a..b', 'a b', 'a\nb', 'a^', 'a~1', 'a@{1}', 'a:b', 'a'.repeat(256), 7, null, undefined, {}]) expect(isSafeRef(no)).toBe(false);
    });
    test('isSafeRevision accepts a ref or a two-sided range', () => {
        for (const ok of ['main', 'a..b', 'a...b', 'refs/heads/x..HEAD']) expect(isSafeRevision(ok)).toBe(true);
        for (const no of ['', '..', 'a..', '..b', 'a..b..c', '-x..b', 'a..-x', 'a b..c', 7, null]) expect(isSafeRevision(no)).toBe(false);
    });
    test('LOG_SAFETY_ARGS switches signature display off and fixes the encoding', () => {
        expect([...LOG_SAFETY_ARGS]).toEqual(['--no-show-signature', '--encoding=UTF-8']);
    });
    test.each(NOT_STRINGS)('returns null for a non-string cwd (%p)', (cwd) => {
        expect(runGit(bad(cwd), ['status'])).toBeNull();
    });
    test('returns null for a non-array args value', () => {
        expect(runGit(ANY_DIR, bad('status'))).toBeNull();
    });
    test('returns null when an argument is not a string or holds a NUL', () => {
        expect(runGit(ANY_DIR, bad(['status', 7]))).toBeNull();
        expect(runGit(ANY_DIR, ['status', 'a\u0000b'])).toBeNull();
    });
});

describe('git functions in a repository', () => {
    let repo: TestRepo;
    beforeEach(() => { repo = makeRepo(); });
    afterEach(() => repo.cleanup());
    const branch = () => branchOff(repo);
    const noNewFile = (name: string) => expect(fs.existsSync(path.join(repo.root, name))).toBe(false);
    const nonRepoDir = () => plainDir(repo);

    test('returns the output of a successful command', () => {
        expect(runGit(repo.root, ['rev-parse', '--is-inside-work-tree'])?.trim()).toBe('true');
    });
    test('returns null when git fails', () => {
        expect(runGit(repo.root, ['rev-parse', '--verify', '--quiet', 'nope-ref'])).toBeNull();
    });
    test('returns null for a directory that does not exist', () => {
        expect(runGit(path.join(repo.home, 'missing'), ['status'])).toBeNull();
    });
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
        test('lowercases the host in the scp-style and the URL form alike, so both name the same repository', () => {
            expect(identity('git@GitHub.com:o/r.git')).toBe('github.com/o/r');
            const other = makeRepo();
            try {
                other.git('remote', 'add', 'origin', 'https://GITHUB.com/o/r');
                expect(repoIdentity(other.root)).toBe('github.com/o/r');
            } finally { other.cleanup(); }
        });
        test('strips credentials in the scp-style form too', () => {
            expect(identity('user:secret@Host.example:o/r')).toBe('host.example/o/r');
        });
        test('an over-long remote url is null and is read in linear time', () => {
            fs.appendFileSync(path.join(repo.root, '.git', 'config'), `[remote "origin"]\n\turl = https://h.example/${'/'.repeat(100000)}x\n`);
            const start = performance.now();
            expect(repoIdentity(repo.root)).toBeNull();
            expect(performance.now() - start).toBeLessThan(500);
        });
        test('is null for a non-string root or outside a repository', () => {
            expect(repoIdentity(bad(null))).toBeNull();
            expect(repoIdentity(nonRepoDir())).toBeNull();
        });
        test('is null when the remote path carries a control character', () => {
            expect(identity('git@host:o/r\u0001x.git')).toBeNull();
        });
    });
    test.each(['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'])('R3.4 %s=1 does not change the file list', (name) => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(c): a');
        withEnv({ [name]: '1' }, () => expect(changedFiles(repo.root, base)).toEqual(['cli/src/a.ts']));
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
