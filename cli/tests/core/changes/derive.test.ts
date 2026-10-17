import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LINEAR_TIME_BOUND_MS, bad, branchOff, commitForgedSigned, makeRepo, nonRepoDir as plainDir, posixOnly, showSignaturesInLog, withEnv, type TestRepo } from './helpers';
import { changedFiles, mergeBase } from '../../../src/core/changes/git';
import { deriveFields, deriveFromCommits, deriveModules } from '../../../src/core/changes/derive';

const NOT_STRINGS = [undefined, null, 7, {}, ['main'], true];
const c = (type: string, scope: string | null, breaking = false) => ({ type, scope, breaking, subject: 's' });
const ANY_ROOT = os.tmpdir();

describe('deriveFromCommits and deriveModules (no repository)', () => {
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
    test('R3.3 several breaking commits: the FIRST one gives the type', () => {
        expect(deriveFromCommits([c('docs', null), c('refactor', null, true), c('chore', null, true)])?.type).toBe('refactor');
        expect(deriveFromCommits([c('chore', null, true), c('refactor', null, true)])?.type).toBe('chore');
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
        expect(deriveFromCommits([c('feat', 'a'), c('feat', 'Z')])?.scope).toBe('Z');
        expect(deriveFromCommits([c('feat', 'f'), c('feat', 'é')])?.scope).toBe('f');
        expect(deriveFromCommits([c('feat', 'é'), c('feat', 'e')])?.scope).toBe('e');
        expect(deriveFromCommits([c('feat', 'B'), c('feat', 'b'), c('feat', 'b')])?.scope).toBe('b');
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

    test.each([...NOT_STRINGS, '', 'HEAD', '--output=x', 'abc', 'g'.repeat(40), 'a'.repeat(65), 'main'])('deriveFields rejects a merge-base that is not a commit id (%p) with invalid-input', (sha) => {
        expect(deriveFields(ANY_ROOT, bad(sha))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'invalid-input' }) });
    });
    test('deriveFields rejects a non-string root with invalid-input', () => {
        expect(deriveFields(bad(null), 'a'.repeat(40))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'invalid-input' }) });
    });
    test('A3.2 diagnostics never echo untrusted text raw', () => {
        const hostile = 'abc\ndef\u001b[31m\u2028x';
        const result = deriveFields(ANY_ROOT, hostile);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.diagnostic.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
        expect(result.diagnostic.message).toContain('abc\\ndef');
        expect(result.diagnostic.message.length).toBeLessThanOrEqual(300);
    });
});

describe('deriveFields in a repository', () => {
    let repo: TestRepo;
    beforeEach(() => { repo = makeRepo(); });
    afterEach(() => repo.cleanup());
    const branch = () => branchOff(repo);
    const noNewFile = (name: string) => expect(fs.existsSync(path.join(repo.root, name))).toBe(false);
    const nonRepoDir = () => plainDir(repo);

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
    test('R3.3 type order in a real range follows the history, oldest first: the first commit when nothing else outranks it', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'chore(x): first');
        repo.commit({ 'b.ts': '1' }, 'docs(x): second');
        repo.commit({ 'c.ts': '1' }, 'test(x): third');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'chore', scope: 'x', semver: 'none', breaking: false, modules: ['.'] } });
    });
    test('R3.3 with several breaking commits in a real range the OLDEST breaking one gives the type', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs(x): intro');
        repo.commit({ 'b.ts': '1' }, 'refactor(x)!: first break');
        repo.commit({ 'c.ts': '1' }, 'chore(x)!: second break');
        repo.commit({ 'd.ts': '1' }, 'feat(x): later feature');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'refactor', scope: 'x', semver: 'major', breaking: true, modules: ['.'] } });
    });
    test('R3.3 a fix after a docs commit outranks it, whatever the order', () => {
        const base = branch();
        repo.commit({ 'a.ts': '1' }, 'docs(x): intro');
        repo.commit({ 'b.ts': '1' }, 'fix(x): a fix');
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toMatchObject({ ok: true, fields: { type: 'fix', semver: 'patch' } });
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
    posixOnly('R3.4 modules with unrepresentable directory names are dropped from the derived fields', () => {
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
    test('R3.3 a signed breaking commit is derived even with log.showSignature on', () => {
        const base = branch();
        showSignaturesInLog(repo);
        commitForgedSigned(repo, 'feat(zzz)!: signed');
        expect(repo.git('log', '-1', '--format=%s')).not.toBe('feat(zzz)!: signed'); // the config really pollutes plain git log
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'zzz', semver: 'major', breaking: true, modules: ['.'] } });
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
    test.each(['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'])('R3.3 %s=1 does not change the derived range or modules', (name) => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(c): a');
        withEnv({ [name]: '1' }, () => {
            expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: 'c', semver: 'minor', breaking: false, modules: ['cli/src'] } });
        });
    });
    test('deriveFields rejects a merge-base that is not a commit id without creating files', () => {
        expect(deriveFields(repo.root, '--output=x')).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'invalid-input' }) });
        noNewFile('x');
    });
    test('a hostile 200k-character subject is parsed in linear time', () => {
        const base = branch();
        const file = path.join(repo.home, 'message.txt');
        for (const [i, subject] of [`feat(${' '.repeat(200000)}`, `feat: ${' '.repeat(200000)}y`, `feat${'('.repeat(100000)}`, `fix(${'x'.repeat(200000)})!: z`].entries()) {
            fs.writeFileSync(file, subject);
            fs.writeFileSync(path.join(repo.root, `f${i}.txt`), 'x');
            repo.git('add', '-A');
            repo.git('commit', '-q', '--cleanup=verbatim', '-F', file);
        }
        const start = performance.now();
        const result = deriveFields(repo.root, mergeBase(repo.root, base));
        expect(performance.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
        // every one of these subjects is over 1024 units, so none is a conventional commit (R3.3)
        expect(result).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-conventional-commits' }) });
    });
    // The release parser's header regex backtracks quadratically on blanks followed by a line terminator its `.` cannot cross
    // (60k spaces then `\ry\rz` took 3.3 s). A subject over 1024 UTF-16 units is therefore never handed to it (R3.3).
    test.each([
        ['spaces followed by lone CRs', `feat: ${' '.repeat(100000)}\ry\rz`],
        ['spaces followed by U+2028 separators', `feat: ${' '.repeat(100000)}\u2028y\u2028z`],
        ['a 200k-character subject', `feat: ${'x'.repeat(200000)}`],
    ])('R3.3 a hostile subject (%s) is ignored in linear time', (_label, subject) => {
        const base = branch();
        const file = path.join(repo.home, 'message.txt');
        fs.writeFileSync(file, subject);
        fs.writeFileSync(path.join(repo.root, 'f.txt'), 'x');
        repo.git('add', '-A');
        repo.git('commit', '-q', '--cleanup=verbatim', '-F', file);
        const start = performance.now();
        const result = deriveFields(repo.root, mergeBase(repo.root, base));
        expect(performance.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
        expect(result).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-conventional-commits' }) });
    });
    test('R3.3 a subject of exactly 1024 units is parsed, one of 1025 is not a conventional commit', () => {
        const base = branch();
        const long = (type: string, units: number) => `${type}: ${'x'.repeat(units - type.length - 2)}`;
        repo.commit({ 'a.ts': '1' }, long('feat', 1024));
        expect(long('feat', 1024)).toHaveLength(1024);
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: null, semver: 'minor', breaking: false, modules: ['.'] } });
        repo.commit({ 'b.ts': '1' }, long('fix!', 1025));
        expect(long('fix!', 1025)).toHaveLength(1025);
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: null, semver: 'minor', breaking: false, modules: ['.'] } });
    });
    test.each([
        ['a trailing record separator makes a 1025-unit subject', `feat: ${'a'.repeat(1018)}\u001e`],
        ['a record separator inside makes a 1025-unit subject', `feat: ${'a'.repeat(600)}\u001e${'a'.repeat(418)}`],
    ])('R3.3 the subject cap counts the raw subject, before any separator is stripped (%s)', (_label, subject) => {
        const base = branch();
        expect(subject).toHaveLength(1025);
        repo.commit({ 'a.ts': '1' }, subject);
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: false, diagnostic: expect.objectContaining({ code: 'no-conventional-commits' }) });
    });
    test('R3.3 a raw 1024-unit subject holding a record separator is still parsed', () => {
        const base = branch();
        const subject = `feat: ${'a'.repeat(600)}\u001e${'a'.repeat(417)}`;
        expect(subject).toHaveLength(1024);
        repo.commit({ 'a.ts': '1' }, subject);
        expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'feat', scope: null, semver: 'minor', breaking: false, modules: ['.'] } });
    });
    test('R3.3 one HEAD is read and pinned: a commit made while deriving is not mixed in', () => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'fix(a): before');
        const real = childProcess.execFileSync;
        let moved = false;
        const spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args: string[], opts: unknown) => {
            if (!moved && args[0] === 'log') {
                moved = true; // HEAD moves after it was read and before the log and the diff: both must still describe the pinned HEAD
                spy.mockRestore();
                repo.commit({ 'late/z.ts': '1' }, 'feat(late)!: after');
            }
            return (real as (...a: unknown[]) => unknown)(cmd, args, opts);
        }) as never);
        try {
            expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'fix', scope: 'a', semver: 'patch', breaking: false, modules: ['cli/src'] } });
        } finally { spy.mockRestore(); }
        expect(moved).toBe(true);
    });
});
