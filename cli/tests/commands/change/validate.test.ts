import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { bad, cloneRepo, makeRepo, nonRepoDir, posixOnly, spyOnGit, type TestRepo } from '../../core/changes/helpers';
import { registerChangeCommand, runChangeNew, runChangeValidate, type ValidateOpts } from '../../../src/commands/change';
import * as deriveModule from '../../../src/core/changes/derive';
import * as gitModule from '../../../src/core/changes/git';
import { buildReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { MAX_RECORD_BYTES, PENDING_MARKER } from '../../../src/core/changes/types';
import type { CommandResult } from '../../../src/core/command-result';

const REAL_CHANGES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'changes');
const listReal = (): string[] | null => { try { return fs.readdirSync(REAL_CHANGES_DIR).sort(); } catch { return null; } };
const realBefore = listReal();
// The command only reads the throwaway repository: the real checkout is never touched.
afterEach(() => expect(listReal()).toEqual(realBefore));

interface Diag { code: string; message: string; field?: string }
interface Rec { path: string; state: string; diagnostics: Diag[] }
interface Report { state: string; records: Rec[] }

let repo: TestRepo;
let template: TestRepo;
const now = () => new Date('2026-10-17T12:00:00.000Z');
const REL = 'docs/changes/2026-10-17-rec.md';
const abs = (rel: string) => path.join(repo.root, ...rel.split('/'));

beforeAll(() => {
    template = makeRepo();
    template.git('checkout', '-q', '-b', 'feat/x');
    template.commit({ 'cli/src/a.ts': '1' }, 'feat(changes): a');
});
afterAll(() => template.cleanup());
beforeEach(() => { repo = cloneRepo(template); });
afterEach(() => { jest.restoreAllMocks(); repo.cleanup(); });

/** A receipt for HEAD whose verdict and every sensor (default: `lint`) are `overall`. */
function receipt(overall: 'pass' | 'fail' = 'pass', sensors: string[] = ['lint']): void {
    writeReceipt(repo.root, buildReceipt({ commit: repo.git('rev-parse', 'HEAD'), ranAt: '2026-10-17T11:00:00.000Z', cliVersion: '9.20.0', output: { overall, sensors: sensors.map((name) => ({ name, status: overall, errors: [] })) } as never }));
}
/** Creates the record of `slug` for HEAD (receipt included), fills the narrative and commits it. */
function commitRecord(slug = 'rec', overall: 'pass' | 'fail' = 'pass', sensors: string[] = ['lint']): string {
    receipt(overall, sensors);
    expect(runChangeNew(repo.root, slug, {}, { now }).code).toBe(0);
    const rel = `docs/changes/2026-10-17-${slug}.md`;
    fs.writeFileSync(abs(rel), fs.readFileSync(abs(rel), 'utf8').split(PENDING_MARKER).join('filled'));
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', `docs(changes): ${slug}`);
    return rel;
}
/** Edits the working-tree copy of a record (nothing is committed). */
function edit(rel: string, fn: (text: string) => string): void {
    const before = fs.readFileSync(abs(rel), 'utf8');
    const after = fn(before);
    expect(after).not.toBe(before);
    fs.writeFileSync(abs(rel), after);
}
const run = (target: string | undefined = undefined, opts: ValidateOpts = {}): CommandResult => runChangeValidate(repo.root, target, { json: true, ...opts });
const report = (r: CommandResult): Report => JSON.parse(r.stdout) as Report;
const diagsOf = (r: CommandResult, index = 0): Diag[] => report(r).records[index].diagnostics;
const codesOf = (r: CommandResult, index = 0): string[] => diagsOf(r, index).map((d) => d.code);
/** The one diagnostic with this code: asserts its field too (undefined when it names no field). */
function diag(r: CommandResult, code: string, field: string | undefined): Diag {
    const found = diagsOf(r).filter((d) => d.code === code);
    expect(found).toHaveLength(1);
    expect(found[0].field).toBe(field);
    return found[0];
}
function expectFailure(r: CommandResult, code: string): void {
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr.startsWith(`${code}: `)).toBe(true);
    const lines = r.stderr.split('\n');
    expect(lines[0].length).toBeLessThanOrEqual(300);
    expect(lines[lines.length - 1]).toBe('');
}
const rawUnsafe = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/;

describe('R4.1 target selection', () => {
    test('without a path every record added in merge-base..HEAD is validated', () => {
        commitRecord('aaa');
        commitRecord('bbb');
        const r = run();
        expect(report(r).records.map((x) => x.path)).toEqual(['docs/changes/2026-10-17-aaa.md', 'docs/changes/2026-10-17-bbb.md']);
        expect(r.code).toBe(0);
    });
    test('one invalid record among several makes the run invalid and is the one reported as such', () => {
        commitRecord('aaa');
        commitRecord('bbb');
        fs.writeFileSync(abs('docs/changes/2026-10-17-bbb.md'), 'not a record');
        const out = report(run());
        expect(out.state).toBe('invalid');
        expect(out.records.map((x) => x.state)).toEqual(['valid', 'invalid']);
    });
    test('a record that already exists at the merge base and is only modified is not an added record', () => {
        const rel = commitRecord();
        repo.git('branch', '-f', 'main', 'HEAD');
        repo.commit({ [rel]: fs.readFileSync(abs(rel), 'utf8') + '\nmore\n' }, 'docs: touch the record');
        expect(codesOf(run())).toEqual(['record-missing']);
    });
    test('a file in docs/changes that is not named like a record is not a record', () => {
        repo.commit({ 'docs/changes/notes.md': 'x', 'docs/changes/sub/2026-10-17-deep.md': 'x', 'other/2026-10-17-rec.md': 'x' }, 'docs: notes');
        expect(codesOf(run())).toEqual(['record-missing']);
    });
    test('with a path only that file is validated', () => {
        commitRecord('aaa');
        commitRecord('bbb');
        fs.writeFileSync(abs('docs/changes/2026-10-17-bbb.md'), 'not a record');
        const r = run('docs/changes/2026-10-17-aaa.md');
        expect(report(r).records.map((x) => x.path)).toEqual(['docs/changes/2026-10-17-aaa.md']);
        expect(r.code).toBe(0);
    });
    test('a path is read relative to the working directory, from a subdirectory', () => {
        const rel = commitRecord();
        const r = runChangeValidate(path.join(repo.root, 'cli'), `..${path.sep}docs${path.sep}changes${path.sep}2026-10-17-rec.md`, { json: true });
        expect(report(r).records[0].path).toBe(rel);
        expect(r.code).toBe(0);
    });
    test('an absolute path inside the repository is accepted', () => {
        const rel = commitRecord();
        const r = runChangeValidate(repo.root, abs(rel), { json: true });
        expect(report(r).records[0].path).toBe(rel);
        expect(r.code).toBe(0);
    });
    test('with a path the record is read even when the branch range holds no commit (derivation failure is reported for it)', () => {
        const rel = commitRecord();
        repo.git('branch', '-f', 'main', 'HEAD');
        const r = run(rel);
        expect(r.code).toBe(2);
        expect(report(r).records[0].path).toBe(rel);
        diag(r, 'no-commits', undefined);
    });
});

describe('target path safety', () => {
    test.each([
        ['outside the repository', '../x.md'],
        ['not in docs/changes', 'README.md'],
        ['in a subdirectory of docs/changes', 'docs/changes/sub/2026-10-17-rec.md'],
        ['not named like a record', 'docs/changes/notes.md'],
        ['an uppercase slug', 'docs/changes/2026-10-17-Rec.md'],
        ['the directory itself', 'docs/changes'],
        ['an empty string', ''],
        ['a NUL byte', 'docs/changes/2026-10-17-rec.md\u0000x'],
        ['an escape character', 'docs/changes/\u001b[31m.md'],
        ['a newline', 'docs/changes/a\nb.md'],
    ])('path-invalid: %s', (_name, target) => {
        const r = runChangeValidate(repo.root, target, {});
        expectFailure(r, 'path-invalid');
        expect(r.stderr).not.toMatch(rawUnsafe);
    });
    test('path-invalid: an absolute path outside the repository', () => {
        expectFailure(runChangeValidate(repo.root, path.join(repo.home, '2026-10-17-rec.md'), {}), 'path-invalid');
    });
    test('path-invalid: a hostile long path is clipped to one line of at most 300 units', () => {
        const r = runChangeValidate(repo.root, `docs/changes/${'\u001b'.repeat(500)}.md`, {});
        expectFailure(r, 'path-invalid');
        expect(r.stderr.length).toBeLessThanOrEqual(301);
    });
    test('a file named like a record with an impossible date is read and reported as name-invalid', () => {
        repo.commit({ 'docs/changes/2026-13-40-bad.md': 'x' }, 'docs: bad date');
        const r = run();
        expect(r.code).toBe(2);
        expect(report(r).records[0].path).toBe('docs/changes/2026-13-40-bad.md');
        diag(r, 'name-invalid', undefined);
    });
    test('a missing record file is record-missing', () => {
        const r = run('docs/changes/2026-10-17-nope.md');
        expect(r.code).toBe(2);
        diag(r, 'record-missing', undefined);
    });
    posixOnly('a record that is a symlink is record-missing and is never read', () => {
        commitRecord();
        const outside = path.join(fs.mkdtempSync(path.join(repo.home, 'outside-')), 'outside.md');
        fs.writeFileSync(outside, fs.readFileSync(abs(REL)));
        fs.rmSync(abs(REL));
        fs.symlinkSync(outside, abs(REL));
        const r = run(REL);
        expect(r.code).toBe(2);
        diag(r, 'record-missing', undefined);
    });
    posixOnly('a symlinked docs/changes directory is unsafe-path for every record', () => {
        commitRecord();
        const moved = path.join(fs.mkdtempSync(path.join(repo.home, 'moved-')), 'changes');
        fs.renameSync(path.join(repo.root, 'docs', 'changes'), moved);
        fs.symlinkSync(moved, path.join(repo.root, 'docs', 'changes'));
        diag(run(REL), 'unsafe-path', undefined);
        diag(run(), 'unsafe-path', undefined);
    });
    test('a missing docs/changes directory is record-missing for an explicit path', () => {
        diag(run(REL), 'record-missing', undefined);
    });
    test('a record of 65537 bytes is record-too-large and its content is not parsed', () => {
        repo.commit({ [REL]: 'x'.repeat(MAX_RECORD_BYTES + 1) }, 'docs: big');
        const r = run();
        expect(codesOf(r)).toEqual(['record-too-large']);
        expect(r.code).toBe(2);
    });
    test('record-too-large also applies to an explicit path', () => {
        repo.commit({ [REL]: 'x'.repeat(MAX_RECORD_BYTES + 1) }, 'docs: big');
        diag(run(REL), 'record-too-large', undefined);
    });
    test('a record of exactly 65536 bytes is read and judged on its content', () => {
        repo.commit({ [REL]: 'x'.repeat(MAX_RECORD_BYTES) }, 'docs: limit');
        expect(codesOf(run())).toEqual(['frontmatter-missing']);
    });
    test('a record that is not valid UTF-8 is record-invalid (not record-too-large)', () => {
        commitRecord();
        fs.writeFileSync(abs(REL), Buffer.from([0x2d, 0x2d, 0x2d, 0xff, 0xfe, 0x0a]));
        expect(codesOf(run(REL))).toEqual(['record-invalid']);
    });
});

describe('R4.2 missing record and the opt-out trailer', () => {
    test('no record and no trailer fails with record-missing, state invalid, exit 2', () => {
        const r = run();
        expect(r.code).toBe(2);
        expect(report(r).state).toBe('invalid');
        diag(r, 'record-missing', undefined);
    });
    test('a Change-Record: none trailer in the range passes as exempt with no records', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        const r = run();
        expect(r.code).toBe(0);
        expect(report(r)).toEqual({ state: 'exempt', records: [] });
    });
    test('the trailer of a commit at or below the merge base does not exempt the branch', () => {
        repo.git('checkout', '-q', 'main');
        repo.commit({ 'm.ts': '1' }, 'docs: m\n\nChange-Record: none');
        repo.git('checkout', '-q', '-b', 'feat/y');
        repo.commit({ 'cli/src/b.ts': '1' }, 'feat(changes): b');
        const r = run();
        expect(r.code).toBe(2);
        diag(r, 'record-missing', undefined);
    });
    test('trailer-like text in a subject does not exempt', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: Change-Record: none');
        diag(run(), 'record-missing', undefined);
    });
    test('a trailer outside the final paragraph does not exempt', () => {
        repo.commit({ 'c.ts': '1' }, 'docs: c\n\nChange-Record: none\n\nSigned-off-by: someone');
        diag(run(), 'record-missing', undefined);
    });
    test('an added record is validated (and reported) even when a trailer is present', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        commitRecord();
        const r = run();
        expect(report(r).state).toBe('valid');
        expect(report(r).records).toHaveLength(1);
    });
    test('a path run never consults the trailer', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        diag(run(REL), 'record-missing', undefined);
    });
});

describe('base resolution (R3.1, R3.2, R3.5)', () => {
    test('--base selects the base: a base at HEAD leaves no added record', () => {
        commitRecord();
        repo.git('branch', 'tip', 'HEAD');
        expect(run().code).toBe(0);
        diag(run(undefined, { base: 'tip' }), 'record-missing', undefined);
    });
    test('an unresolvable --base is base-unresolved with its remedy', () => {
        const r = runChangeValidate(repo.root, undefined, { base: 'no-such-branch' });
        expectFailure(r, 'base-unresolved');
        expect(r.stderr).toContain('remedy: pass --base <ref>');
    });
    test('no main, master or origin/HEAD is base-unresolved', () => {
        repo.git('branch', '-m', 'main', 'trunk');
        expectFailure(runChangeValidate(repo.root, undefined, {}), 'base-unresolved');
    });
    test.each(['--output=x', 'a..b', '-x', 'a b', 'main^', 'x\ny', '\u001b[31m'])('an unsafe --base %p is invalid-input and git is never given it', (base) => {
        const r = runChangeValidate(repo.root, undefined, { base });
        expectFailure(r, 'invalid-input');
        expect(r.stderr).not.toMatch(rawUnsafe);
        expect(fs.existsSync(path.join(repo.root, 'x'))).toBe(false);
    });
    test('a repository without a common ancestor with the base is base-unresolved', () => {
        repo.git('checkout', '-q', '--orphan', 'island');
        repo.git('rm', '-rfq', '.');
        repo.commit({ 'island.ts': '1' }, 'feat: island');
        expectFailure(runChangeValidate(repo.root, undefined, {}), 'base-unresolved');
    });
    test('outside a git repository is not-a-git-repo', () => {
        expectFailure(runChangeValidate(nonRepoDir(repo), undefined, {}), 'not-a-git-repo');
    });
});

describe('R4.3 base checks', () => {
    test('a filled record that matches git passes', () => {
        commitRecord();
        const r = run();
        expect(r.code).toBe(0);
        expect(report(r)).toMatchObject({ state: 'valid', records: [{ path: REL, state: 'valid', diagnostics: [] }] });
    });
    test('R1 shape errors are reported with their own code and field', () => {
        commitRecord();
        edit(REL, (t) => t.replace('schema: awm.change-record/v1', 'schema: other'));
        diag(run(REL), 'field-invalid', 'schema');
    });
    test('an unfilled record reports pending-content', () => {
        receipt();
        expect(runChangeNew(repo.root, 'rec', {}, { now }).code).toBe(0);
        repo.git('add', '-A');
        repo.git('commit', '-q', '-m', 'docs(changes): rec');
        diag(run(), 'pending-content', undefined);
    });
    test('a record that fails R1 is not checked against git (no record to compare)', () => {
        commitRecord();
        edit(REL, (t) => t.replace('type: feat', 'type: fix').replace('schema: awm.change-record/v1', 'schema: other'));
        expect(codesOf(run(REL))).not.toContain('derived-mismatch');
    });
    test.each([
        ['type', 'type: feat', 'type: fix'],
        ['semver', 'semver: minor', 'semver: patch'],
        ['breaking', 'breaking: false', 'breaking: true'],
        ['scope', 'scope: changes', 'scope: other'],
        ['modules', '  - cli/src', '  - cli/src\n  - docs'],
    ])('derived-mismatch names the field %s', (field, from, to) => {
        commitRecord();
        edit(REL, (t) => t.replace(from, to));
        const r = run(REL);
        expect(r.code).toBe(2);
        expect(diagsOf(r).filter((d) => d.code === 'derived-mismatch').map((d) => d.field)).toEqual([field]);
    });
    test('every mismatching derived field gets its own diagnostic', () => {
        commitRecord();
        edit(REL, (t) => t.replace('type: feat', 'type: fix').replace('semver: minor', 'semver: patch'));
        expect(diagsOf(run(REL)).filter((d) => d.code === 'derived-mismatch').map((d) => d.field).sort()).toEqual(['semver', 'type']);
    });
    test('a derived-mismatch message states the recorded and the derived value on one line', () => {
        commitRecord();
        edit(REL, (t) => t.replace('type: feat', 'type: fix'));
        const d = diag(run(REL), 'derived-mismatch', 'type');
        expect(d.message).toBe('type is "fix" but git derives "feat"');
    });
    test('a git-derivation failure is reported once with the derive code (no-conventional-commits)', () => {
        commitRecord();
        repo.git('reset', '-q', '--soft', 'main');
        repo.git('commit', '-q', '-m', 'work in progress');
        const r = run(REL);
        expect(codesOf(r)).toContain('no-conventional-commits');
        expect(codesOf(r)).not.toContain('derived-mismatch');
    });
    test('a verification commit that is not in the repository is verification-commit-foreign', () => {
        commitRecord();
        edit(REL, (t) => t.replace(/commit: [0-9a-f]{40}/, `commit: ${'e'.repeat(40)}`));
        diag(run(REL), 'verification-commit-foreign', 'verification.commit');
    });
    test('a verification commit on another branch is verification-commit-foreign', () => {
        commitRecord();
        const other = (() => {
            repo.git('checkout', '-q', '-b', 'side', 'main');
            const sha = repo.commit({ 'side.ts': '1' }, 'feat: side');
            repo.git('checkout', '-q', 'feat/x');
            return sha;
        })();
        edit(REL, (t) => t.replace(/commit: [0-9a-f]{40}/, `commit: ${other}`));
        diag(run(REL), 'verification-commit-foreign', 'verification.commit');
    });
    test('a verification commit equal to HEAD is accepted', () => {
        commitRecord();
        edit(REL, (t) => t.replace(/commit: [0-9a-f]{40}/, `commit: ${repo.git('rev-parse', 'HEAD')}`));
        const codes = codesOf(run(REL));
        expect(codes).not.toContain('verification-commit-foreign');
        expect(codes).not.toContain('code-changed-after-verification');
    });
    test('a foreign verification commit does not also report code-changed-after-verification', () => {
        commitRecord();
        edit(REL, (t) => t.replace(/commit: [0-9a-f]{40}/, `commit: ${'e'.repeat(40)}`));
        expect(codesOf(run(REL))).not.toContain('code-changed-after-verification');
    });
    test('code changed after the verified commit is code-changed-after-verification', () => {
        commitRecord();
        repo.commit({ 'cli/src/late.ts': '1' }, 'chore: late');
        const d = diag(run(), 'code-changed-after-verification', undefined);
        expect(d.message).toContain('cli/src/late.ts');
        expect(codesOf(run())).not.toContain('derived-mismatch'); // same module, same type: only the late code is wrong
    });
    test('files under docs/changes changed after the verified commit are not code', () => {
        commitRecord();
        repo.commit({ 'docs/changes/notes.md': 'n' }, 'docs: notes');
        expect(codesOf(run())).not.toContain('code-changed-after-verification');
    });
    test('a path that merely starts like docs/changes is code', () => {
        commitRecord();
        repo.commit({ 'docs/changes-extra/x.md': 'n' }, 'chore: extra');
        expect(codesOf(run())).toContain('code-changed-after-verification');
    });
    test('late code and derived drift are both reported', () => {
        commitRecord();
        repo.commit({ 'cli/src/core/late.ts': '1' }, 'feat(core): late');
        const c = codesOf(run());
        expect(c).toContain('code-changed-after-verification');
        expect(c).toContain('derived-mismatch');
    });
    test('one late file is reported as "1 file" and two as "2 files"', () => {
        commitRecord();
        repo.commit({ 'cli/src/one.ts': '1' }, 'chore: one');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toMatch(/^1 file changed after [0-9a-f]{12}: cli\/src\/one\.ts$/);
        repo.commit({ 'cli/src/two.ts': '1' }, 'chore: two');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toMatch(/^2 files changed after [0-9a-f]{12}: cli\/src\/one\.ts, cli\/src\/two\.ts$/);
    });
    test('the late-file list names at most 20 paths and counts them all', () => {
        commitRecord();
        repo.commit(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`a${String(i).padStart(2, '0')}.ts`, '1'])), 'chore: late');
        const d = diag(run(), 'code-changed-after-verification', undefined);
        expect(d.message).toContain('25 files changed after');
        expect(d.message).toContain('a00.ts');
        expect(d.message).toContain('a19.ts, …');
        expect(d.message).not.toContain('a20.ts');
    });
    test('exactly 20 late files are all listed with no ellipsis', () => {
        commitRecord();
        repo.commit(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`a${String(i).padStart(2, '0')}.ts`, '1'])), 'chore: late');
        const d = diag(run(), 'code-changed-after-verification', undefined);
        expect(d.message.endsWith('a19.ts')).toBe(true);
    });
    test('a long late-file list stays one line of at most 300 units', () => {
        commitRecord();
        repo.commit(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`cli/src/late/${'d'.repeat(60)}${i}.ts`, '1'])), 'chore: late');
        const d = diag(run(), 'code-changed-after-verification', undefined);
        expect(d.message.length).toBeLessThanOrEqual(300);
        expect(d.message).not.toContain('\n');
    });
    posixOnly('a late file named with an escape sequence and a newline never reaches the output raw', () => {
        commitRecord();
        repo.commit({ 'cli/src/\u001b[31mred\nline.ts': '1' }, 'chore: hostile');
        const text = runChangeValidate(repo.root, undefined, {});
        const json = run();
        for (const r of [text, json]) {
            expect(r.stdout).not.toMatch(/\u001b/);
            expect(r.stdout.replace(/\n$/, '')).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
        }
        expect(diag(json, 'code-changed-after-verification', undefined).message).toContain('\\u001b');
    });
    test('a git failure while listing the late files is reported, not thrown', () => {
        commitRecord();
        const verified = repo.git('rev-parse', 'HEAD~1');
        const real = gitModule.changedFiles;
        // Only the late-file listing (which starts at the verified commit) fails; the derivation's own diff still works.
        jest.spyOn(gitModule, 'changedFiles').mockImplementation((root, from, to) => (from === verified ? null : real(root, from, to)));
        const r = run();
        expect(r.code).toBe(2);
        expect(diag(r, 'git-failed', undefined).message).toContain('git could not list the files changed since');
        expect(codesOf(r)).not.toContain('derived-mismatch');
    });
});

describe('R4.4 strict checks', () => {
    test('strict passes with a matching, passing receipt', () => {
        commitRecord();
        const r = run(undefined, { strict: true });
        expect(r.code).toBe(0);
        expect(report(r).state).toBe('valid');
    });
    test('base mode never reads the receipt', () => {
        commitRecord();
        fs.rmSync(path.join(repo.root, '.awm', 'sensors', 'runs'), { recursive: true, force: true });
        expect(run().code).toBe(0);
    });
    test('strict: a missing receipt is receipt-missing', () => {
        commitRecord();
        fs.rmSync(path.join(repo.root, '.awm', 'sensors', 'runs'), { recursive: true, force: true });
        diag(run(undefined, { strict: true }), 'receipt-missing', 'verification.commit');
    });
    test('strict: a receipt that is not valid JSON is receipt-invalid', () => {
        commitRecord();
        const sha = /commit: ([0-9a-f]{40})/.exec(fs.readFileSync(abs(REL), 'utf8'))?.[1] as string;
        fs.writeFileSync(path.join(repo.root, '.awm', 'sensors', 'runs', `${sha}.json`), '{ nope');
        diag(run(undefined, { strict: true }), 'receipt-invalid', 'verification.commit');
    });
    test('strict: a receipt whose content was edited (digest broken) is receipt-invalid', () => {
        commitRecord();
        const sha = /commit: ([0-9a-f]{40})/.exec(fs.readFileSync(abs(REL), 'utf8'))?.[1] as string;
        const file = path.join(repo.root, '.awm', 'sensors', 'runs', `${sha}.json`);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"pass"', '"fail"'));
        diag(run(undefined, { strict: true }), 'receipt-invalid', 'verification.commit');
    });
    test('without --strict a missing or failing receipt is not reported', () => {
        commitRecord('rec', 'fail');
        expect(run().code).toBe(0);
    });
    test('strict: a failing verdict is verification-not-passing', () => {
        commitRecord('rec', 'fail');
        const r = run(undefined, { strict: true });
        expect(r.code).toBe(2);
        diag(r, 'verification-not-passing', 'verification.overall');
        expect(codesOf(r)).not.toContain('verification-mismatch');
    });
    test('strict: a record digest that differs from the receipt is verification-mismatch on receipt_digest', () => {
        commitRecord();
        edit(REL, (t) => t.replace(/receipt_digest: sha256:[0-9a-f]{64}/, `receipt_digest: sha256:${'0'.repeat(64)}`));
        const r = run(REL, { strict: true });
        expect(diagsOf(r).filter((d) => d.code === 'verification-mismatch').map((d) => d.field)).toEqual(['verification.receipt_digest']);
    });
    test('strict: a record verdict that differs from the receipt is verification-mismatch on overall', () => {
        commitRecord();
        edit(REL, (t) => t.replace('overall: pass', 'overall: fail'));
        const r = run(REL, { strict: true });
        expect(diagsOf(r).filter((d) => d.code === 'verification-mismatch').map((d) => d.field)).toEqual(['verification.overall']);
    });
    test('strict: a record sensor status that differs from the receipt is verification-mismatch on sensors', () => {
        commitRecord();
        edit(REL, (t) => t.replace('lint: pass', 'lint: fail'));
        const r = run(REL, { strict: true });
        expect(diagsOf(r).filter((d) => d.code === 'verification-mismatch').map((d) => d.field)).toEqual(['verification.sensors']);
    });
    test('strict: an extra sensor in the record is verification-mismatch on sensors', () => {
        commitRecord();
        edit(REL, (t) => t.replace('    lint: pass', '    lint: pass\n    extra: pass'));
        const r = run(REL, { strict: true });
        expect(diagsOf(r).filter((d) => d.code === 'verification-mismatch').map((d) => d.field)).toEqual(['verification.sensors']);
    });
    test('strict: a sensor the record omits is verification-mismatch on sensors', () => {
        commitRecord('rec', 'pass', ['lint', 'types']);
        expect(run(undefined, { strict: true }).code).toBe(0); // two sensors in the receipt and the record ...
        edit(REL, (t) => t.replace('    types: pass\n', '')); // ... and the record omits one
        const r = run(REL, { strict: true });
        expect(diagsOf(r).filter((d) => d.code === 'verification-mismatch').map((d) => d.field)).toEqual(['verification.sensors']);
    });
    test('strict: the sensor order in the record does not matter', () => {
        commitRecord('rec', 'pass', ['lint', 'types']);
        edit(REL, (t) => t.replace('    lint: pass\n    types: pass\n', '    types: pass\n    lint: pass\n'));
        expect(run(REL, { strict: true }).code).toBe(0);
    });
    test('without --strict a mismatching verification block is not reported', () => {
        commitRecord();
        edit(REL, (t) => t.replace('lint: pass', 'lint: fail'));
        expect(run(REL).code).toBe(0);
    });
    test('strict with a foreign verification commit asks for no receipt of it', () => {
        commitRecord();
        edit(REL, (t) => t.replace(/commit: [0-9a-f]{40}/, `commit: ${'e'.repeat(40)}`));
        const c = codesOf(run(REL, { strict: true }));
        expect(c).toContain('verification-commit-foreign');
        expect(c).toContain('receipt-missing');
    });
});

describe('R4.5 output and exit codes', () => {
    test('text report: header, one line per record, one indented line per diagnostic', () => {
        commitRecord();
        edit(REL, (t) => t.replace('type: feat', 'type: fix'));
        repo.git('commit', '-q', '-am', 'docs: edit the record');
        const r = runChangeValidate(repo.root, undefined, {});
        expect(r.code).toBe(2);
        expect(r.stderr).toBe('');
        expect(r.stdout).toBe(`Change Record validation: invalid\n- ${REL}: invalid\n  - derived-mismatch (type): type is "fix" but git derives "feat"\n`);
    });
    test('text report of a valid run', () => {
        commitRecord();
        const r = runChangeValidate(repo.root, undefined, {});
        expect(r.code).toBe(0);
        expect(r.stdout).toBe(`Change Record validation: valid\n- ${REL}: valid\n`);
    });
    test('text report of an exempt run', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        const r = runChangeValidate(repo.root, undefined, {});
        expect(r.code).toBe(0);
        expect(r.stdout).toBe('Change Record validation: exempt (Change-Record: none)\n');
    });
    test('text report of a missing record names docs/changes', () => {
        const r = runChangeValidate(repo.root, undefined, {});
        expect(r.code).toBe(2);
        expect(r.stdout.startsWith('Change Record validation: invalid\n- docs/changes: invalid\n  - record-missing: ')).toBe(true);
    });
    test('--json is one line with the documented shape, and a diagnostic without a field has no field key', () => {
        const r = run();
        expect(r.stdout.endsWith('\n')).toBe(true);
        expect(r.stdout.slice(0, -1)).not.toContain('\n');
        const out = report(r);
        expect(Object.keys(out).sort()).toEqual(['records', 'state']);
        expect(Object.keys(out.records[0]).sort()).toEqual(['diagnostics', 'path', 'state']);
        expect(Object.keys(out.records[0].diagnostics[0]).sort()).toEqual(['code', 'message']);
    });
    test('--json carries the field when a diagnostic names one', () => {
        commitRecord();
        edit(REL, (t) => t.replace('type: feat', 'type: fix'));
        expect(Object.keys(diagsOf(run(REL))[0]).sort()).toEqual(['code', 'field', 'message']);
    });
    test('exit code 0 for a valid run', () => {
        commitRecord();
        expect(run().code).toBe(0);
    });
    test('exit code 0 for an exempt run', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        expect(run().code).toBe(0);
        expect(runChangeValidate(repo.root, undefined, {}).code).toBe(0);
    });
    test('exit code 2 for a missing record', () => {
        expect(run().code).toBe(2);
    });
    test('exit code 2 for an invalid record', () => {
        commitRecord();
        repo.commit({ 'cli/src/more.ts': '1' }, 'chore: more');
        expect(run().code).toBe(2);
    });
    test('a report is never written to stderr', () => {
        expect(run().stderr).toBe('');
        expect(runChangeValidate(repo.root, undefined, {}).stderr).toBe('');
    });
    /** A committed record plus `count` unknown top-level keys in the working tree: `count` unknown-field diagnostics. */
    function withUnknownKeys(count: number): Diag[] {
        commitRecord();
        const extra = Array.from({ length: count }, (_, i) => `extra${i}: 1`).join('\n');
        edit(REL, (t) => t.replace('schema: awm.change-record/v1', `schema: awm.change-record/v1\n${extra}`));
        return diagsOf(run(REL));
    }
    test.each([
        [21, '2'], // just past the per-record cap
        [30, '11'],
        [50, '31'], // the shape validator's own cap is reached exactly
        [51, '32'], // one diagnostic dropped by the shape validator itself
        [80, '61'], // many dropped by the shape validator itself
    ])('%i diagnostics: 19 kept and one marker counting %s omitted', (count, omitted) => {
        const ds = withUnknownKeys(count);
        expect(ds).toHaveLength(20);
        expect(ds.slice(0, 19).every((d) => d.code === 'unknown-field')).toBe(true);
        expect(ds.filter((d) => d.code === 'diagnostics-truncated')).toHaveLength(1);
        expect(ds[19]).toMatchObject({ code: 'diagnostics-truncated', message: `${omitted} more diagnostics omitted` });
    });
    test('exactly 20 diagnostics are all kept, with no marker', () => {
        const ds = withUnknownKeys(20);
        expect(ds).toHaveLength(20);
        expect(ds.every((d) => d.code === 'unknown-field')).toBe(true);
    });
    test('at most 50 records are validated; a 51st-and-later record yields too-many-records and an invalid run', () => {
        const files = Object.fromEntries(Array.from({ length: 53 }, (_, i) => [`docs/changes/2026-10-17-r${String(i).padStart(2, '0')}.md`, 'x']));
        repo.commit(files, 'docs: many');
        const out = report(run());
        expect(out.state).toBe('invalid');
        expect(out.records).toHaveLength(51);
        expect(out.records[0].path).toBe('docs/changes/2026-10-17-r00.md');
        expect(out.records[49].path).toBe('docs/changes/2026-10-17-r49.md');
        expect(out.records[50]).toEqual({ path: 'docs/changes', state: 'invalid', diagnostics: [{ code: 'too-many-records', message: '53 records were added; only the first 50 were validated' }] });
        expect(out.records.slice(0, 50).every((x) => x.diagnostics.every((d) => d.code !== 'too-many-records'))).toBe(true);
        expect(run().code).toBe(2);
    });
    test('exactly 50 records are all validated with no too-many-records marker', () => {
        const files = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`docs/changes/2026-10-17-r${String(i).padStart(2, '0')}.md`, 'x']));
        repo.commit(files, 'docs: many');
        const out = report(run());
        expect(out.records).toHaveLength(50);
        expect(out.records.some((x) => x.diagnostics.some((d) => d.code === 'too-many-records'))).toBe(false);
    });
    test('every message is one line of at most 300 units, in both formats', () => {
        commitRecord();
        edit(REL, (t) => t.replace('type: feat', 'type: fix').replace('semver: minor', 'semver: patch'));
        repo.git('commit', '-q', '-am', 'docs: edit the record');
        repo.commit({ 'cli/src/late.ts': '1' }, 'chore: late');
        for (const d of diagsOf(run())) {
            expect(d.message.length).toBeLessThanOrEqual(300);
            expect(d.message).not.toMatch(rawUnsafe);
        }
        for (const l of runChangeValidate(repo.root, undefined, {}).stdout.split('\n')) expect(l.length).toBeLessThanOrEqual(300);
    });
    test('a long record value with quotes and backslashes in a derived-mismatch message stays one bounded, escaped line', () => {
        commitRecord();
        edit(REL, (t) => t.replace('scope: changes', `scope: ${JSON.stringify('"\\'.repeat(300))}`));
        const d = diag(run(REL), 'derived-mismatch', 'scope');
        expect(d.message.length).toBeLessThanOrEqual(300);
        expect(d.message).not.toMatch(rawUnsafe);
        expect(d.message.startsWith('scope is "')).toBe(true);
        for (const l of runChangeValidate(repo.root, REL, {}).stdout.split('\n')) expect(l.length).toBeLessThanOrEqual(300);
    });
    test('the modules of a derived-mismatch message are listed as a bracketed list', () => {
        commitRecord();
        edit(REL, (t) => t.replace('  - cli/src', '  - cli/src\n  - docs'));
        expect(diag(run(REL), 'derived-mismatch', 'modules').message).toBe('modules is ["cli/src", "docs"] but git derives ["cli/src"]');
    });
    test('a long recorded modules list does not hide the derived value (both halves stay visible)', () => {
        commitRecord();
        const many = Array.from({ length: 40 }, (_, i) => `  - mod/m${String(i).padStart(2, '0')}`).join('\n');
        edit(REL, (t) => t.replace('  - cli/src', `  - cli/src\n${many}`));
        const d = diag(run(REL), 'derived-mismatch', 'modules');
        expect(d.message.length).toBeLessThanOrEqual(300);
        expect(d.message.startsWith('modules is ["cli/src", "mod/m00"')).toBe(true);
        expect(d.message.endsWith('but git derives ["cli/src"]')).toBe(true);
    });
    test('a long derived modules list does not hide the recorded value', () => {
        commitRecord();
        repo.commit(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`wide/w${String(i).padStart(2, '0')}/x.ts`, '1'])), 'chore: wide');
        const d = diag(run(), 'derived-mismatch', 'modules');
        expect(d.message.length).toBeLessThanOrEqual(300);
        expect(d.message.startsWith('modules is ["cli/src"] but git derives ["cli/src", "wide/w00"')).toBe(true);
    });
    test('when both the recorded and the derived list are long, each is cut to its own share and the whole message stays under the limit', () => {
        commitRecord();
        repo.commit(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`wide/w${String(i).padStart(2, '0')}/x.ts`, '1'])), 'chore: wide');
        const many = Array.from({ length: 40 }, (_, i) => `  - mod/m${String(i).padStart(2, '0')}`).join('\n');
        repo.commit({ [REL]: fs.readFileSync(abs(REL), 'utf8').replace('  - cli/src', `  - cli/src\n${many}`) }, 'docs: record');
        const d = diag(run(), 'derived-mismatch', 'modules');
        expect(d.message.length).toBeLessThan(300); // not clipped by the 300-unit limit: each half was cut on its own
        expect(d.message).toMatch(/^modules is \["cli\/src", "mod\/m00".*… but git derives \["cli\/src", "wide\/w00"/);
    });
    test('a null scope and a boolean are shown as themselves', () => {
        commitRecord();
        edit(REL, (t) => t.replace('scope: changes', 'scope: null').replace('breaking: false', 'breaking: true'));
        const ds = diagsOf(run(REL));
        expect(ds.find((d) => d.field === 'scope')?.message).toBe('scope is null but git derives "changes"');
        expect(ds.find((d) => d.field === 'breaking')?.message).toBe('breaking is true but git derives false');
    });
});

describe('R4.5 operational failures under --json', () => {
    const J = { json: true };
    const cases: Array<[string, string, () => CommandResult]> = [
        ['not-a-git-repo', 'not-a-git-repo', () => runChangeValidate(nonRepoDir(repo), undefined, J)],
        ['base-unresolved (unknown --base)', 'base-unresolved', () => runChangeValidate(repo.root, undefined, { ...J, base: 'no-such-branch' })],
        ['base-unresolved (no default base)', 'base-unresolved', () => { repo.git('branch', '-m', 'main', 'trunk'); return runChangeValidate(repo.root, undefined, J); }],
        ['invalid-input (unsafe --base)', 'invalid-input', () => runChangeValidate(repo.root, undefined, { ...J, base: '--output=x' })],
        ['invalid-input (hostile --base)', 'invalid-input', () => runChangeValidate(repo.root, undefined, { ...J, base: `\u001b[31m${'y\n'.repeat(400)}` })],
        ['invalid-input (cwd)', 'invalid-input', () => runChangeValidate(bad(undefined), undefined, J)],
        ['path-invalid', 'path-invalid', () => runChangeValidate(repo.root, '../x.md', J)],
        ['path-invalid (hostile path)', 'path-invalid', () => runChangeValidate(repo.root, `docs/changes/\u001b${'z\n'.repeat(400)}.md`, J)],
        ['git-failed', 'git-failed', () => { jest.spyOn(gitModule, 'headSha').mockReturnValue(null); return runChangeValidate(repo.root, undefined, J); }],
        ['flag-invalid', 'flag-invalid', () => runChangeValidate(repo.root, undefined, bad({ ...J, base: 7 }))],
        ['internal-error', 'internal-error', () => { jest.spyOn(gitModule, 'resolveBaseCommit').mockImplementation(() => { throw new RangeError('x'); }); return runChangeValidate(repo.root, undefined, J); }],
    ];
    test.each(cases)('%s prints one JSON line of the report shape on stdout and exits 2', (_name, code, call) => {
        const r = call();
        expect(r.code).toBe(2);
        expect(r.stderr).toBe('');
        expect(r.stdout.endsWith('\n')).toBe(true);
        expect(r.stdout.slice(0, -1)).not.toContain('\n');
        const out = JSON.parse(r.stdout) as Report;
        expect(Object.keys(out).sort()).toEqual(['records', 'state']);
        expect(out.state).toBe('invalid');
        expect(out.records).toHaveLength(1);
        expect(out.records[0]).toMatchObject({ path: 'docs/changes', state: 'invalid' });
        expect(out.records[0].diagnostics).toHaveLength(1);
        const d = out.records[0].diagnostics[0];
        expect(d.code).toBe(code);
        expect(d.message.length).toBeLessThanOrEqual(300);
        expect(d.message).not.toMatch(rawUnsafe);
        expect(d.field).toBeUndefined();
    });
    test('the base-unresolved remedy travels in the JSON message', () => {
        const out = JSON.parse(runChangeValidate(repo.root, undefined, { ...J, base: 'nope' }).stdout) as Report;
        expect(out.records[0].diagnostics[0].message).toContain('pass --base <ref>');
    });
    test('the untrusted --base is escaped in the JSON message (no raw escape character, bounded)', () => {
        const out = JSON.parse(runChangeValidate(repo.root, undefined, { ...J, base: '\u001b[31mred' }).stdout) as Report;
        expect(out.records[0].diagnostics[0].message).toContain('\\u001b');
    });
    test('without --json the failure stays on stderr with an empty stdout', () => {
        const r = runChangeValidate(repo.root, undefined, { base: 'nope' });
        expectFailure(r, 'base-unresolved');
    });
    test('json: false keeps the stderr form', () => {
        expectFailure(runChangeValidate(repo.root, undefined, { json: false, base: 'nope' }), 'base-unresolved');
    });
});

describe('R4.3 committed-record verdict (record-uncommitted)', () => {
    test('a clean committed record has no record-uncommitted diagnostic', () => {
        commitRecord();
        expect(codesOf(run())).not.toContain('record-uncommitted');
        expect(run().code).toBe(0);
    });
    test('an unstaged edit of a committed record is record-uncommitted', () => {
        commitRecord();
        edit(REL, (t) => `${t}\nmore\n`);
        const r = run();
        expect(r.code).toBe(2);
        diag(r, 'record-uncommitted', undefined);
    });
    test('the verdict is not silently computed from the edit: an edit that keeps the record valid is still invalid', () => {
        commitRecord();
        edit(REL, (t) => `${t}\nmore\n`);
        expect(run(REL).code).toBe(0); // the edited file on its own is fine ...
        expect(report(run()).state).toBe('invalid'); // ... but the branch's committed record is not what was validated
    });
    test('a staged but uncommitted edit is record-uncommitted', () => {
        commitRecord();
        edit(REL, (t) => `${t}\nmore\n`);
        repo.git('add', REL);
        diag(run(), 'record-uncommitted', undefined);
    });
    test('an edit that also breaks the shape reports both', () => {
        commitRecord();
        edit(REL, (t) => t.replace('schema: awm.change-record/v1', 'schema: other'));
        const c = codesOf(run());
        expect(c).toContain('record-uncommitted');
        expect(c).toContain('field-invalid');
    });
    test('uncommitted edit of another record does not taint a clean one', () => {
        commitRecord('aaa');
        commitRecord('bbb');
        edit('docs/changes/2026-10-17-bbb.md', (t) => `${t}\nmore\n`);
        const out = report(run());
        expect(out.records.map((x) => x.state)).toEqual(['valid', 'invalid']);
    });
    test('an untracked unrelated file is not an uncommitted change of the record', () => {
        commitRecord();
        fs.writeFileSync(path.join(repo.root, 'docs', 'changes', 'notes.md'), 'x');
        expect(run().code).toBe(0);
    });
    test('with an explicit path the working-tree file is validated and no record-uncommitted is reported', () => {
        commitRecord();
        edit(REL, (t) => `${t}\nmore\n`);
        expect(codesOf(run(REL))).not.toContain('record-uncommitted');
    });
    test('a git failure while checking the record fails closed as record-uncommitted', () => {
        commitRecord();
        spyOnGit((args) => { if (args.includes('status')) throw Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }); });
        const r = run();
        expect(r.code).toBe(2);
        expect(diag(r, 'record-uncommitted', undefined).message).toContain('could not');
    });
});

describe('one derivation, one ancestry check and one late-file listing per verification commit', () => {
    /** Two valid records that both verify the same commit (the second is a copy of the first under another name). */
    function twoRecordsOneCommit(): string {
        commitRecord('aaa');
        const text = fs.readFileSync(abs('docs/changes/2026-10-17-aaa.md'), 'utf8').replace('id: 2026-10-17-aaa', 'id: 2026-10-17-bbb');
        repo.commit({ 'docs/changes/2026-10-17-bbb.md': text }, 'docs(changes): bbb');
        return /commit: ([0-9a-f]{40})/.exec(text)?.[1] as string;
    }
    function gitCalls(fn: () => void): string[][] {
        const git = spyOnGit();
        try { fn(); } finally { git.restore(); }
        return git.calls;
    }
    test('both records are valid, and git derives, checks ancestry and lists late files once', () => {
        const verified = twoRecordsOneCommit();
        let result: CommandResult | undefined;
        const calls = gitCalls(() => { result = run(); });
        expect(report(result as CommandResult)).toMatchObject({ state: 'valid', records: [{ state: 'valid' }, { state: 'valid' }] });
        expect(calls.filter((a) => a.includes('--no-merges'))).toHaveLength(1); // the derivation's git log
        expect(calls.filter((a) => a.includes('--is-ancestor'))).toHaveLength(1);
        expect(calls.filter((a) => a.includes('diff') && a.includes(verified))).toHaveLength(1); // the late-file listing
    });
    test('the committed-state check still runs once per record', () => {
        twoRecordsOneCommit();
        const calls = gitCalls(() => { run(); });
        expect(calls.filter((a) => a.includes('status'))).toHaveLength(2);
    });
});

describe('a path read through a symlinked working directory or repository root', () => {
    function link(target: string): string {
        const dir = fs.mkdtempSync(path.join(repo.home, 'link-'));
        const l = path.join(dir, 'repo-link');
        fs.symlinkSync(target, l);
        return l;
    }
    posixOnly('a relative path is read from a cwd that is a symlink to the repository', () => {
        commitRecord();
        const r = runChangeValidate(link(repo.root), REL, { json: true });
        expect(r.code).toBe(0);
        expect(report(r).records[0].path).toBe(REL);
    });
    posixOnly('a path to a record that does not exist, from a symlinked cwd, is record-missing (not outside the repository)', () => {
        const r = runChangeValidate(link(repo.root), REL, { json: true });
        expect(r.code).toBe(2);
        expect(report(r).records[0].diagnostics.map((d) => d.code)).toEqual(['record-missing']);
    });
    posixOnly('an absolute path through a symlink to the repository is accepted', () => {
        commitRecord();
        const r = runChangeValidate(repo.root, path.join(link(repo.root), ...REL.split('/')), { json: true });
        expect(r.code).toBe(0);
        expect(report(r).records[0].path).toBe(REL);
    });
    posixOnly('a repository root reported through a symlink still resolves a path given from the real directory', () => {
        commitRecord();
        jest.spyOn(gitModule, 'repoRoot').mockReturnValue(link(repo.root));
        const r = runChangeValidate(repo.root, abs(REL), { json: true });
        expect(report(r).records[0].path).toBe(REL);
        expect(r.code).toBe(0);
    });
    posixOnly('a symlink to somewhere else is still outside the repository', () => {
        commitRecord();
        const elsewhere = fs.mkdtempSync(path.join(repo.home, 'else-'));
        expectFailure(runChangeValidate(repo.root, path.join(link(elsewhere), '2026-10-17-rec.md'), {}), 'path-invalid');
    });
});

describe('R4.3 shape first', () => {
    test('an invalid-shape committed record with late code changes reports only the shape diagnostics', () => {
        commitRecord();
        edit(REL, (t) => t.replace('schema: awm.change-record/v1', 'schema: other').replace('type: feat', 'type: fix'));
        repo.git('commit', '-q', '-am', 'docs: break the record');
        repo.commit({ 'cli/src/core/late.ts': '1' }, 'feat(core): late');
        expect(codesOf(run(undefined, { strict: true }))).toEqual(['field-invalid']);
    });
    test('the same record with an explicit path reports only the shape diagnostics', () => {
        commitRecord();
        edit(REL, (t) => t.replace('schema: awm.change-record/v1', 'schema: other'));
        repo.git('commit', '-q', '-am', 'docs: break the record');
        repo.commit({ 'cli/src/core/late.ts': '1' }, 'feat(core): late');
        expect(codesOf(run(REL, { strict: true }))).toEqual(['field-invalid']);
    });
    test('once the shape is fixed the other diagnostics appear', () => {
        commitRecord();
        repo.commit({ 'cli/src/core/late.ts': '1' }, 'feat(core): late');
        expect(codesOf(run())).toEqual(expect.arrayContaining(['code-changed-after-verification', 'derived-mismatch']));
    });
});

describe('R4.6 read-only', () => {
    function snapshot(): Record<string, string> {
        const out: Record<string, string> = {};
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                const key = path.relative(repo.root, full);
                if (entry.isDirectory()) { out[key] = 'dir'; walk(full); }
                else if (entry.isSymbolicLink()) out[key] = `link:${fs.readlinkSync(full)}`;
                else out[key] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
            }
        };
        walk(repo.root);
        return out;
    }
    test.each([
        ['base', undefined, {}],
        ['strict', undefined, { strict: true }],
        ['json', undefined, { json: true }],
        ['a path', REL, { strict: true }],
    ] as Array<[string, string | undefined, ValidateOpts]>)('%s run changes no file, no directory and no git state', (_n, target, opts) => {
        commitRecord();
        repo.commit({ 'cli/src/late.ts': '1' }, 'chore: late');
        const before = snapshot();
        const status = repo.git('status', '--porcelain', '--ignored');
        const r = runChangeValidate(repo.root, target, opts);
        expect(r.code).toBe(2);
        expect(snapshot()).toEqual(before);
        expect(repo.git('status', '--porcelain', '--ignored')).toBe(status);
        expect(fs.existsSync(path.join(repo.home, '.awm'))).toBe(false);
    });
    test('a run that finds no record creates no docs/changes directory', () => {
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
        expect(run().code).toBe(2);
        expect(run(REL).code).toBe(2);
        expect(fs.existsSync(path.join(repo.root, 'docs'))).toBe(false);
    });
    test('a dirty working tree is not an error', () => {
        commitRecord();
        fs.writeFileSync(path.join(repo.root, 'scratch.txt'), 'x');
        expect(run().code).toBe(0);
    });
});

describe('robustness: never throws, always a CommandResult', () => {
    test.each([
        ['cwd', () => runChangeValidate(bad(undefined), undefined, {})],
        ['empty cwd', () => runChangeValidate('', undefined, {})],
        ['target', () => runChangeValidate(repo.root, bad(7), {})],
        ['opts', () => runChangeValidate(repo.root, undefined, bad('x'))],
        ['null opts', () => runChangeValidate(repo.root, undefined, bad(null))],
        ['array opts', () => runChangeValidate(repo.root, undefined, bad([]))],
        ['base', () => runChangeValidate(repo.root, undefined, bad({ base: 7 }))],
        ['strict', () => runChangeValidate(repo.root, undefined, bad({ strict: 'yes' }))],
        ['json', () => runChangeValidate(repo.root, undefined, bad({ json: 1 }))],
    ])('invalid %s is a one-line failure', (_n, call) => {
        const r = call();
        expect(r.code).toBe(2);
        expect(r.stdout).toBe('');
        expect(r.stderr).toMatch(/^(invalid-input|flag-invalid|path-invalid): [^\n]*\n$/);
    });
    test('undefined opts are accepted as no flags', () => {
        commitRecord();
        expect(runChangeValidate(repo.root, undefined, bad(undefined)).code).toBe(0);
    });
    test('an unexpected exception becomes internal-error carrying only the error name', () => {
        commitRecord();
        jest.spyOn(deriveModule, 'deriveFields').mockImplementation(() => { throw new TypeError('secret\u001b detail'); });
        const r = runChangeValidate(repo.root, undefined, {});
        expectFailure(r, 'internal-error');
        expect(r.stderr).toContain('TypeError');
        expect(r.stderr).not.toContain('secret');
    });
    test('a HEAD that moves during validation is git-failed, not a verdict', () => {
        commitRecord();
        const real = gitModule.headSha;
        let calls = 0;
        jest.spyOn(gitModule, 'headSha').mockImplementation((root: string) => (++calls === 1 ? real(root) : 'f'.repeat(40)));
        expectFailure(runChangeValidate(repo.root, undefined, {}), 'git-failed');
    });
    test('a HEAD that moves during an exempt run is git-failed, not an exemption', () => {
        repo.commit({ 'b.ts': '1' }, 'docs: b\n\nChange-Record: none');
        const real = gitModule.headSha;
        let calls = 0;
        jest.spyOn(gitModule, 'headSha').mockImplementation((root: string) => (++calls === 1 ? real(root) : 'f'.repeat(40)));
        const r = runChangeValidate(repo.root, undefined, {});
        expectFailure(r, 'git-failed');
        expect(r.stderr).toContain('HEAD moved');
    });
    test('an unreadable HEAD is git-failed', () => {
        commitRecord();
        jest.spyOn(gitModule, 'headSha').mockReturnValue(null);
        expectFailure(runChangeValidate(repo.root, undefined, {}), 'git-failed');
    });
    test('a git failure while listing the added records is git-failed', () => {
        commitRecord();
        jest.spyOn(gitModule, 'addedFilesUnder').mockReturnValue(null);
        expectFailure(runChangeValidate(repo.root, undefined, {}), 'git-failed');
    });
});

describe('registerChangeCommand: validate', () => {
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
        jest.spyOn(process, 'cwd').mockImplementation(() => repo.root);
    });
    afterEach(() => { process.exitCode = savedExit; });
    const sub = () => program().commands.find((c) => c.name() === 'change')?.commands.find((c) => c.name() === 'validate');
    test('registers change validate with its documented flags and optional path', () => {
        expect(sub()?.options.map((o) => o.long).sort()).toEqual(['--base', '--json', '--strict']);
        expect(sub()?.registeredArguments.map((a) => [a.name(), a.required])).toEqual([['path', false]]);
    });
    test('a valid run prints the report and leaves the exit code alone', async () => {
        commitRecord();
        await program().parseAsync(['node', 'awm', 'change', 'validate']);
        expect(out).toHaveBeenCalledWith(`Change Record validation: valid\n- ${REL}: valid\n`);
        expect(process.exitCode).toBe(savedExit);
    });
    test('flags and the path reach the command', async () => {
        commitRecord('rec', 'fail');
        await program().parseAsync(['node', 'awm', 'change', 'validate', REL, '--strict', '--json']);
        const printed = String(out.mock.calls[0][0]);
        expect(JSON.parse(printed).records[0].diagnostics.map((d: Diag) => d.code)).toContain('verification-not-passing');
        expect(process.exitCode).toBe(2);
    });
    test('--base reaches the command', async () => {
        await program().parseAsync(['node', 'awm', 'change', 'validate', '--base', 'nope']);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('base-unresolved: '));
        expect(process.exitCode).toBe(2);
    });
    test('an invalid run exits 2 with the report on stdout', async () => {
        await program().parseAsync(['node', 'awm', 'change', 'validate']);
        expect(out).toHaveBeenCalledWith(expect.stringContaining('record-missing'));
        expect(process.exitCode).toBe(2);
    });
    test('a cwd that is not accessible is reported, not thrown', async () => {
        jest.spyOn(process, 'cwd').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); });
        await program().parseAsync(['node', 'awm', 'change', 'validate']);
        expect(process.exitCode).toBe(2);
        expect(err).toHaveBeenCalledWith(expect.stringMatching(/^[a-z-]+: /));
    });
    test('a cwd that is not accessible is reported as a JSON line under --json', async () => {
        jest.spyOn(process, 'cwd').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); });
        await program().parseAsync(['node', 'awm', 'change', 'validate', '--json']);
        expect(process.exitCode).toBe(2);
        expect(err).not.toHaveBeenCalled();
        const printed = JSON.parse(String(out.mock.calls[0][0])) as Report;
        expect(printed.records[0]).toMatchObject({ path: 'docs/changes', diagnostics: [{ code: 'not-a-git-repo' }] });
    });
});
