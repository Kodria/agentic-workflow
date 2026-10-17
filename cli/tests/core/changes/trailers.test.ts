import fs from 'fs';
import path from 'path';
import { bad, expectLinearScaling, branchOff, commitForgedSigned, cloneRepo, makeRepo, nonRepoDir as plainDir, posixOnly, showSignaturesInLog, withEnv, type TestRepo } from './helpers';
import { hasOptOut, optsOut } from '../../../src/core/changes/trailers';

describe('hasOptOut', () => {
    let repo: TestRepo;
    let template: TestRepo;
    beforeAll(() => { template = makeRepo(); });
    afterAll(() => template.cleanup());
    beforeEach(() => { repo = cloneRepo(template); });
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
    // The verification text of a signed commit comes out BEFORE the formatted message when log.showSignature is on. A fake gpg that
    // ends its text with a blank line turns a subject-only `Change-Record: none` into a "second paragraph": without
    // --no-show-signature (LOG_SAFETY_ARGS) hasOptOut would exempt a change that never opted out.
    posixOnly('a signed commit whose verification text ends in a blank line is not read as having a final paragraph (LOG_SAFETY_ARGS)', () => {
        const gpg = path.join(repo.home, 'fake-gpg.sh');
        fs.writeFileSync(gpg, '#!/bin/sh\necho "[GNUPG:] GOODSIG 0123456789ABCDEF t <t@t>"\nprintf \'gpg: Signature made today\\ngpg: Good signature from "t"\\n\\n\' >&2\nexit 0\n', { mode: 0o755 });
        repo.git('config', 'log.showSignature', 'true');
        repo.git('config', 'gpg.program', gpg);
        commitForgedSigned(repo, 'Change-Record: none');
        // The fixture works: an unprotected log really carries the verification text in front of the message.
        expect(repo.git('log', '-1', '-z', '--format=%B')).toContain('gpg: Good signature from "t"');
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(false);
    });
    test('R4.2 a message with CRLF line endings (kept verbatim) still opts out: the trailing CR of the trailer line is ignored', () => {
        const file = path.join(repo.home, 'crlf.txt');
        fs.writeFileSync(file, 'docs: crlf\r\n\r\nChange-Record: none\r\n');
        fs.writeFileSync(path.join(repo.root, 'crlf.ts'), '1');
        repo.git('add', '-A');
        repo.git('commit', '-q', '--cleanup=verbatim', '-F', file);
        expect(repo.git('log', '-1', '--format=%B')).toContain('\r');
        expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(true);
    });
    test.each(['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'])('%s=1 does not change the opt-out result', (name) => {
        const base = branch();
        repo.commit({ 'cli/src/a.ts': '1' }, 'feat(c): a\n\nChange-Record: none');
        withEnv({ [name]: '1' }, () => expect(hasOptOut(repo.root, [`${base}..HEAD`])).toBe(true));
    });

    // Untrusted commit messages are scanned in linear time: a regex that backtracks over a long whitespace run took seconds (80k spaces: 6.6 s).
    // The scaling is measured on the pure parser (no git child), so a slow or loaded runner cannot fail it; the git-level test only
    // checks the result.
    describe('linear-time parsing of hostile messages', () => {
        const CASES: Array<[string, (n: number) => string, boolean]> = [
            ['spaces inside a line of the final paragraph', (n) => `docs: a\n\nx${' '.repeat(n)}y`, false],
            ['spaces inside the subject line', (n) => `docs: x${' '.repeat(n)}y\n\nChange-Record: none`, true],
            ['alternating blanks inside a line', (n) => `docs: a\n\nx${' \t'.repeat(n / 2)}y`, false],
            ['a single very long line', (n) => `docs: a\n\n${'x'.repeat(n)}`, false],
            ['an opt-out line followed by blanks and text', (n) => `docs: a\n\nChange-Record: none${' '.repeat(n)}x`, false],
            ['an opt-out key followed by blanks and no value', (n) => `docs: a\n\nChange-Record:${' '.repeat(n)}`, false],
            ['an opt-out line with trailing blanks', (n) => `docs: a\n\nChange-Record: none${' '.repeat(n)}`, true],
            ['many blank lines between paragraphs', (n) => `docs: a\n${'\n'.repeat(n / 2)}Change-Record: none`, true],
            ['many whitespace-only lines', (n) => `docs: a\n\n${' \n'.repeat(n / 2)}Change-Record: none`, true],
        ];
        test.each(CASES)('%s gives the usual result through git', (_label, message, expected) => {
            const file = path.join(repo.home, 'message.txt');
            fs.writeFileSync(file, message(200_000));
            fs.writeFileSync(path.join(repo.root, 'perf.txt'), 'x');
            repo.git('add', '-A');
            repo.git('commit', '-q', '--cleanup=verbatim', '-F', file);
            expect(hasOptOut(repo.root, ['-1', 'HEAD'])).toBe(expected);
        });
        test.each(CASES)('%s: the parser gives the usual result and scales linearly', (_label, message, expected) => {
            expect(optsOut(message(200_000))).toBe(expected);
            expectLinearScaling((n) => { optsOut(message(n)); }, 20_000);
        });
    });
});
