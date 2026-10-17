import fs from 'fs';
import path from 'path';
import { LINEAR_TIME_BOUND_MS, bad, branchOff, commitForgedSigned, makeRepo, nonRepoDir as plainDir, showSignaturesInLog, withEnv, type TestRepo } from './helpers';
import { hasOptOut } from '../../../src/core/changes/trailers';

describe('hasOptOut', () => {
    let repo: TestRepo;
    beforeEach(() => { repo = makeRepo(); });
    afterEach(() => repo.cleanup());
    const branch = () => branchOff(repo);
    const noNewFile = (name: string) => expect(fs.existsSync(path.join(repo.root, name))).toBe(false);
    const nonRepoDir = () => plainDir(repo);

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
    test('DD-6 documented limit: a trailer in a mid-message paragraph (a squash-merge body) is NOT an opt-out; only the final paragraph counts', () => {
        const base = branch();
        // What a squash merge produces: the squashed commits' messages become the body, so the author's trailer is not last.
        repo.commit({ 'a.ts': '1' }, 'docs: typo (#12)\n\n* docs: typo\n\nChange-Record: none\n\n* fix: other');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(false);
        // The same trailer as the final paragraph (the author edited the squash message) is found.
        repo.commit({ 'b.ts': '1' }, 'docs: typo (#13)\n\n* docs: typo\n\nChange-Record: none');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
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
    test('hasOptOut sees a signed Change-Record: none commit even with log.showSignature on', () => {
        const base = branch();
        showSignaturesInLog(repo);
        commitForgedSigned(repo, 'docs: signed\n\nChange-Record: none');
        expect(repo.git('log', '-1', '--format=%s')).not.toBe('docs: signed');
        expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true);
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
    });
    test.each(['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'])('%s=1 does not change the opt-out result', (name) => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(c): a\n\nChange-Record: none');
        withEnv({ [name]: '1' }, () => expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true));
    });

    // Untrusted commit messages are scanned in linear time: a regex that backtracks over a long whitespace run took seconds (80k spaces: 6.6 s).
    describe('linear-time parsing of hostile messages', () => {
        const timed = (message: string): { opted: boolean; ms: number } => {
            const file = path.join(repo.home, 'message.txt');
            fs.writeFileSync(file, message);
            fs.writeFileSync(path.join(repo.root, 'perf.txt'), message.length.toString());
            repo.git('add', '-A');
            repo.git('commit', '-q', '--cleanup=verbatim', '-F', file);
            const start = performance.now();
            const opted = hasOptOut(repo.root, ['-1', 'HEAD']);
            return { opted, ms: performance.now() - start };
        };
        test.each([
            ['200k spaces inside a line of the final paragraph', `docs: a\n\nx${' '.repeat(200000)}y`, false],
            ['200k spaces inside the subject line', `docs: x${' '.repeat(200000)}y\n\nChange-Record: none`, true],
            ['alternating blanks inside a line', `docs: a\n\nx${' \t'.repeat(100000)}y`, false],
            ['a 200k-character single line', `docs: a\n\n${'x'.repeat(200000)}`, false],
            ['an opt-out line followed by 200k blanks and text', `docs: a\n\nChange-Record: none${' '.repeat(200000)}x`, false],
            ['an opt-out key followed by 200k blanks and no value', `docs: a\n\nChange-Record:${' '.repeat(200000)}`, false],
            ['an opt-out line with 200k trailing blanks', `docs: a\n\nChange-Record: none${' '.repeat(200000)}`, true],
            ['100k blank lines between paragraphs', `docs: a\n${'\n'.repeat(100000)}Change-Record: none`, true],
            ['100k whitespace-only lines', `docs: a\n\n${' \n'.repeat(100000)}Change-Record: none`, true],
        ])('%s is processed quickly and gives the usual result', (_label, message, expected) => {
            const { opted, ms } = timed(message);
            expect(opted).toBe(expected);
            expect(ms).toBeLessThan(LINEAR_TIME_BOUND_MS);
        });
    });
});
