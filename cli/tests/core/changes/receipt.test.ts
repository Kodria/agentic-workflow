// Only the sensor execution is faked; shouldRun stays real so the selection-parity test checks the production rule.
jest.mock('../../../src/commands/sensors/run', () => ({
    runSensors: jest.fn(), findManifestDir: jest.fn(),
    shouldRun: jest.requireActual('../../../src/commands/sensors/run').shouldRun,
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess, { execFileSync } from 'child_process';
import { Command } from 'commander';
import { makeHiddenSubmodule, makeRepo, posixOnly, type TestRepo } from './helpers';
import { buildReceipt, captureReceiptPrecondition, computeReceiptDigest, finalizeReceipt, isFullSelection, readReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { registerSensorsCommand } from '../../../src/commands/sensors/index';
import { runSensors, findManifestDir, shouldRun } from '../../../src/commands/sensors/run';
import { resolveSensorProject } from '../../../src/commands/sensors/project';
import { exitCodeForVerdict } from '../../../src/commands/sensors/verdict';

const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'];
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
// The real checkout must stay untouched. Receipts are written under the git TOPLEVEL of the cwd (not the cwd itself),
// so both that runs directory and the cwd-relative one are watched. Outside a git repository only the latter exists.
const checkoutToplevel = (): string | null => {
    try {
        return path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } }).trim());
    } catch { return null; }
};
const TOPLEVEL = checkoutToplevel();
const WATCHED_RUNS = [...new Set([path.resolve('.awm', 'sensors', 'runs'), ...(TOPLEVEL === null ? [] : [path.join(TOPLEVEL, '.awm', 'sensors', 'runs')])])];
const listRuns = (): Record<string, string[] | null> => Object.fromEntries(WATCHED_RUNS.map((d) => [d, fs.existsSync(d) ? fs.readdirSync(d).sort() : null]));
const RUNS_BEFORE = listRuns();
let repo: TestRepo;
let root: string; let home: string;
// Child git processes get an explicit identity and config isolation; the shared makeRepo already points HOME and AWM_HOME at a throwaway home.
const gitEnv = () => ({ ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' });
const g = (...args: string[]) => repo.git(...args);

beforeEach(() => {
    repo = makeRepo();
    root = repo.root; home = repo.home;
    // makeRepo's own .gitignore ignores `.awm/`; these tests need a repository that does NOT (R2.2b), so the first commit is replaced.
    repo.commit({ '.gitignore': 'node_modules\n', 'a.txt': 'a' }, 'feat: a');
});
afterEach(() => repo.cleanup());

afterAll(() => {
    for (const k of ENV_KEYS) expect(process.env[k]).toBe(ORIGINAL[k]);
    expect(listRuns()).toEqual(RUNS_BEFORE);
});

// `manifestPath` is the manifest the run reports (SensorAuthority): the repository root's, by default.
const output = {
    overall: 'pass' as const,
    sensors: [{ name: 'lint', status: 'pass' as const, errors: [] }, { name: 'a-typecheck', status: 'pass' as const, errors: [] }],
    get manifestPath() { return path.join(root, '.awm', 'sensors.json'); },
};
const runsFile = (head: string) => path.join(root, '.awm', 'sensors', 'runs', `${head}.json`);
const listTree = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? [] : e.isDirectory() ? [e.name + '/', ...listTree(path.join(dir, e.name)).map((c) => `${e.name}/${c}`)] : [e.name]));
const writeValid = () => {
    const head = g('rev-parse', 'HEAD');
    writeReceipt(root, buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '9.20.0', output: output as never }));
    return head;
};
/** Rewrites the on-disk receipt with `mutate` applied, keeping (or not) the old digest. */
const mutateFile = (head: string, mutate: (r: Record<string, unknown>) => void, redigest = false) => {
    const parsed = JSON.parse(fs.readFileSync(runsFile(head), 'utf8'));
    mutate(parsed);
    if (redigest) {
        const { digest: _d, ...body } = parsed;
        // computeReceiptDigest refuses a body with non-object sensors; such a fixture keeps its old digest (the shape check rejects it first).
        try { parsed.digest = computeReceiptDigest(body); } catch { /* keep the old digest */ }
    }
    fs.writeFileSync(runsFile(head), JSON.stringify(parsed));
};

describe('receipt', () => {
    test('isolation: HOME and AWM_HOME point at a throwaway directory, never the real ones', () => {
        expect(process.env.HOME).toBe(home);
        expect(process.env.HOME).not.toBe(ORIGINAL.HOME);
        expect(process.env.AWM_HOME).toBe(path.join(home, '.awm'));
        expect(process.env.AWM_HOME).not.toBe(ORIGINAL.AWM_HOME);
        expect(process.env.GIT_CONFIG_GLOBAL).toBe(os.devNull);
    });
    test('R2.1 full selection on a clean tree writes a 0600 receipt keyed by HEAD', () => {
        const pre = captureReceiptPrecondition(root);
        expect(pre.eligible).toBe(true);
        const note = finalizeReceipt(pre, output as never, { now: () => new Date('2026-10-17T10:00:00.000Z'), version: () => '9.20.0' });
        expect(note).toBe('');
        const head = g('rev-parse', 'HEAD');
        const file = path.join(root, '.awm', 'sensors', 'runs', `${head}.json`);
        expect(fs.existsSync(file)).toBe(true);
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        const read = readReceipt(root, head);
        expect(read.ok && read.receipt.sensors).toEqual({ 'a-typecheck': 'pass', lint: 'pass' });
        expect(read.ok && Object.keys(read.receipt.sensors)).toEqual(['a-typecheck', 'lint']);
    });
    test('R2.3 the receipt carries schema, commit, ranAt, cliVersion and overall from the run', () => {
        const head = g('rev-parse', 'HEAD');
        const r = buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '9.20.0', output: { overall: 'fail', sensors: [{ name: 'lint', status: 'fail', errors: [] }] } as never });
        expect(r).toMatchObject({ schema: 1, commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '9.20.0', overall: 'fail', sensors: { lint: 'fail' } });
    });
    posixOnly('R2.1 a receipt replacing an existing 0666 file ends with mode 0600', () => {
        const head = g('rev-parse', 'HEAD');
        fs.mkdirSync(path.dirname(runsFile(head)), { recursive: true });
        fs.writeFileSync(runsFile(head), 'stale');
        fs.chmodSync(runsFile(head), 0o666);
        const pre = captureReceiptPrecondition(root);
        expect(finalizeReceipt(pre, output as never)).toBe('');
        expect(fs.statSync(runsFile(head)).mode & 0o777).toBe(0o600);
        expect(readReceipt(root, head).ok).toBe(true);
    });
    posixOnly('R2.1 writeReceipt forces mode 0600 on an existing file', () => {
        const head = writeValid();
        fs.chmodSync(runsFile(head), 0o644);
        writeValid();
        expect(fs.statSync(runsFile(head)).mode & 0o777).toBe(0o600);
    });
    posixOnly('R2.1 the receipt directory is 0700', () => {
        writeValid();
        expect(fs.statSync(path.join(root, '.awm', 'sensors', 'runs')).mode & 0o777).toBe(0o700);
    });
    describe('R2.2b receipt hygiene: a receipt can never be committed by git add -A', () => {
        const ignoreFile = () => path.join(root, '.awm', 'sensors', 'runs', '.gitignore');
        const stagedAfterAddAll = () => { g('add', '-A'); return g('diff', '--cached', '--name-only'); };
        test('a repository that does not ignore .awm stages nothing under the runs directory', () => {
            expect(g('ls-files', '--others', '--exclude-standard')).toBe('');
            expect(finalizeReceipt(captureReceiptPrecondition(root), output as never)).toBe('');
            expect(stagedAfterAddAll()).toBe('');
            // ... and the receipt is still there, untracked and ignored.
            const head = g('rev-parse', 'HEAD');
            expect(readReceipt(root, head).ok).toBe(true);
            expect(g('check-ignore', `.awm/sensors/runs/${head}.json`)).toBe(`.awm/sensors/runs/${head}.json`);
        });
        test('the runs directory gets .gitignore containing exactly `*`', () => {
            writeValid();
            expect(fs.readFileSync(ignoreFile(), 'utf8')).toBe('*\n');
        });
        test('writing again is idempotent and keeps the .gitignore (same inode and content)', () => {
            writeValid();
            const before = fs.statSync(ignoreFile());
            writeValid();
            expect(fs.readFileSync(ignoreFile(), 'utf8')).toBe('*\n');
            expect(fs.statSync(ignoreFile()).ino).toBe(before.ino);
        });
        test('a .gitignore with other content is replaced by `*`', () => {
            fs.mkdirSync(path.dirname(ignoreFile()), { recursive: true });
            fs.writeFileSync(ignoreFile(), '!*\n');
            writeValid();
            expect(fs.readFileSync(ignoreFile(), 'utf8')).toBe('*\n');
        });
        posixOnly('a symlinked .gitignore is refused and its target left alone, with no receipt written', () => {
            const target = path.join(root, 'elsewhere.txt');
            fs.writeFileSync(target, 'keep');
            fs.mkdirSync(path.dirname(ignoreFile()), { recursive: true });
            fs.symlinkSync(target, ignoreFile());
            expect(() => writeValid()).toThrow(/symlink/);
            expect(fs.readFileSync(target, 'utf8')).toBe('keep');
            expect(fs.readdirSync(path.dirname(ignoreFile()))).toEqual(['.gitignore']);
        });
        test('the dirty-tree logic is unchanged: the runs directory and its .gitignore never make the tree dirty', () => {
            writeValid();
            expect(captureReceiptPrecondition(root).eligible).toBe(true);
            g('add', '-f', '.awm/sensors/runs/.gitignore');
            g('commit', '-q', '-m', 'chore: force-add the ignore file');
            fs.writeFileSync(ignoreFile(), 'edited\n');
            expect(captureReceiptPrecondition(root).eligible).toBe(true);
        });
    });
    test('R2.1 selection rules', () => {
        expect(isFullSelection({})).toBe(true);
        expect(isFullSelection({ all: true })).toBe(true);
        expect(isFullSelection({ fast: true, slow: true })).toBe(true);
        expect(isFullSelection({ fast: true })).toBe(false);
        expect(isFullSelection({ slow: true })).toBe(false);
        expect(isFullSelection({ all: true, changed: true })).toBe(false);
    });
    test('R2.1 isFullSelection agrees with shouldRun for every combination of fast, slow, all and changed', () => {
        const values = [undefined, false, true];
        let combinations = 0;
        for (const fast of values) for (const slow of values) for (const all of values) for (const changed of values) {
            const opts = { fast, slow, all, changed };
            // shouldRun does not model `changed` (it only scopes files), but a --changed run is never a full selection.
            const expected = shouldRun(true, opts as never) && shouldRun(false, opts as never) && !changed;
            expect({ opts, full: isFullSelection(opts) }).toEqual({ opts, full: expected });
            combinations++;
        }
        expect(combinations).toBe(81);
    });
    test('R2.1 changed alone is a partial selection', () => {
        expect(isFullSelection({ changed: true })).toBe(false);
    });
    test('R2.1 all wins over fast or slow', () => {
        expect(isFullSelection({ all: true, fast: true })).toBe(true);
    });
    test('R2.2 a non-object selection is not a full selection', () => {
        expect(isFullSelection(undefined as never)).toBe(false);
        expect(isFullSelection(null as never)).toBe(false);
    });
    test('R2.2 an untracked file yields no receipt and a reason', () => {
        fs.writeFileSync(path.join(root, 'b.txt'), 'b');
        const pre = captureReceiptPrecondition(root);
        expect(pre.eligible).toBe(false);
        const note = finalizeReceipt(pre, output as never);
        expect(note).toMatch(/no sensor receipt written: .*uncommitted/);
        expect(note.endsWith('\n')).toBe(true);
        expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
    });
    test('R2.2 a modified tracked file makes the tree dirty', () => {
        fs.writeFileSync(path.join(root, 'a.txt'), 'changed');
        expect(captureReceiptPrecondition(root).eligible).toBe(false);
    });
    test('R2.2 a staged change makes the tree dirty', () => {
        fs.writeFileSync(path.join(root, 'a.txt'), 'staged'); g('add', 'a.txt');
        expect(captureReceiptPrecondition(root).eligible).toBe(false);
    });
    test('R2.1 a modified tracked .awm/sensors.json makes the tree dirty', () => {
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{}');
        g('add', '.'); g('commit', '-q', '-m', 'chore: sensors');
        expect(captureReceiptPrecondition(root).eligible).toBe(true);
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{"edited":true}');
        expect(captureReceiptPrecondition(root).eligible).toBe(false);
    });
    test('R2.1 a modified tracked .awm/profile.json makes the tree dirty', () => {
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), '{}');
        g('add', '.'); g('commit', '-q', '-m', 'chore: profile');
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), '{"edited":true}');
        expect(captureReceiptPrecondition(root).eligible).toBe(false);
    });
    test('R2.1 an untracked file elsewhere under .awm/ makes the tree dirty', () => {
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'scratch.txt'), 'x');
        expect(captureReceiptPrecondition(root).eligible).toBe(false);
    });
    test.each([
        ['.awm/sensors/runs/x.json'], ['.awm/journal/entry.json'], ['.awm/ledger/l.jsonl'], ['.awm/evidence/e.txt'], ['.awm/track.json'],
    ])('R2.1 an untracked %s does not make the tree dirty', (rel) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), 'x');
        expect(g('status', '--porcelain')).not.toBe('');
        expect(captureReceiptPrecondition(root).eligible).toBe(true);
    });
    test('R2.1 a modified tracked file under an excluded runtime path does not make the tree dirty', () => {
        fs.mkdirSync(path.join(root, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'journal', 'j.json'), '{}');
        g('add', '.'); g('commit', '-q', '-m', 'chore: journal');
        fs.writeFileSync(path.join(root, '.awm', 'journal', 'j.json'), '{"edited":true}');
        expect(captureReceiptPrecondition(root).eligible).toBe(true);
    });
    test('R2.1 the pre-run check sees untracked files even when status.showUntrackedFiles is no', () => {
        g('config', 'status.showUntrackedFiles', 'no');
        fs.writeFileSync(path.join(root, 'new.ts'), 'export {};');
        expect(g('status', '--porcelain')).toBe('');
        const pre = captureReceiptPrecondition(root);
        expect(pre.eligible).toBe(false);
        expect(pre.eligible === false && pre.reason).toMatch(/uncommitted/);
    });
    test('R2.1 with status.showUntrackedFiles no, an untracked runtime-state file stays eligible', () => {
        g('config', 'status.showUntrackedFiles', 'no');
        fs.mkdirSync(path.join(root, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'journal', 'j.json'), 'x');
        expect(captureReceiptPrecondition(root).eligible).toBe(true);
    });
    test.each([
        ['a path traversal', '../../../x'], ['a slash', 'a/b'], ['39 hex', 'a'.repeat(39)], ['41 hex', 'a'.repeat(41)],
        ['uppercase hex', 'A'.repeat(40)], ['a non-string', 5 as unknown as string], ['undefined', undefined as unknown as string],
    ])('R2.5 writeReceipt rejects %s as commit and writes nothing', (_n, commit) => {
        const valid = buildReceipt({ commit: g('rev-parse', 'HEAD'), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        const before = listTree(root);
        const attempt = () => writeReceipt(root, { ...valid, commit });
        expect(attempt).toThrow(/invalid receipt/);
        expect(attempt).not.toThrow(TypeError);
        expect(listTree(root)).toEqual(before);
        expect(fs.existsSync(path.join(root, '.awm'))).toBe(false);
    });
    test.each([['null', null], ['a string', 'x'], ['an array', []]])('R2.5 writeReceipt rejects %s as receipt without a raw TypeError', (_n, receipt) => {
        const attempt = () => writeReceipt(root, receipt as never);
        expect(attempt).toThrow(/invalid receipt/);
        expect(attempt).not.toThrow(TypeError);
        expect(fs.existsSync(path.join(root, '.awm'))).toBe(false);
    });
    test.each([['undefined', undefined], ['empty', ''], ['a number', 5]])('R2.5 writeReceipt rejects %s as root', (_n, bad) => {
        const valid = buildReceipt({ commit: g('rev-parse', 'HEAD'), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        const attempt = () => writeReceipt(bad as never, valid);
        expect(attempt).toThrow(/root must be a non-empty string/);
        expect(attempt).not.toThrow(TypeError);
    });
    test('R2.5 writeReceipt rejects a receipt whose digest does not match', () => {
        const valid = buildReceipt({ commit: g('rev-parse', 'HEAD'), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        expect(() => writeReceipt(root, { ...valid, overall: 'fail' })).toThrow(/invalid receipt: digest/);
        expect(fs.existsSync(path.join(root, '.awm'))).toBe(false);
    });
    test('R2.3 a valid receipt round-trips write then read', () => {
        const head = writeValid();
        const read = readReceipt(root, head);
        expect(read.ok && read.receipt.commit).toBe(head);
        expect(read.ok && read.receipt.digest).toMatch(/^sha256:/);
    });
    test.each([
        ['a multi-line sensor name', { overall: 'pass', sensors: [{ name: 'a\nb', status: 'pass', errors: [] }] }, undefined],
        ['an empty sensor name', { overall: 'pass', sensors: [{ name: '', status: 'pass', errors: [] }] }, undefined],
        ['a 129 code point sensor name', { overall: 'pass', sensors: [{ name: '\u{1F600}'.repeat(129), status: 'pass', errors: [] }] }, undefined],
        ['an unknown overall', { overall: 'great', sensors: [] }, undefined],
        ['an unknown sensor status', { overall: 'pass', sensors: [{ name: 'lint', status: 'ok', errors: [] }] }, undefined],
        ['non-array sensors', { overall: 'pass', sensors: 'x' }, undefined],
        ['a multi-line cliVersion', output, '1\n2'],
    ])('R2.5 finalizeReceipt fails closed on %s: one escaped stderr line and nothing written', (_n, out, version) => {
        const pre = captureReceiptPrecondition(root);
        const note = finalizeReceipt(pre, out as never, { version: () => version ?? '1.0.0' });
        expect(note).toMatch(/^no sensor receipt written: invalid receipt: [^\n]+\n$/);
        expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
    });
    test('R2.5 a sensor name of exactly 128 code points is accepted and round-trips', () => {
        const name = '\u{1F600}'.repeat(128);
        const pre = captureReceiptPrecondition(root);
        expect(finalizeReceipt(pre, { overall: 'pass', sensors: [{ name, status: 'pass', errors: [] }] } as never)).toBe('');
        const read = readReceipt(root, g('rev-parse', 'HEAD'));
        expect(read.ok && Object.keys(read.receipt.sensors)).toEqual([name]);
    });
    test('R2.5 a receipt larger than readReceipt accepts is refused on write', () => {
        const sensors = Array.from({ length: 12000 }, (_v, i) => ({ name: `${String(i).padStart(5, '0')}-${'x'.repeat(100)}`, status: 'pass', errors: [] }));
        const pre = captureReceiptPrecondition(root);
        expect(finalizeReceipt(pre, { overall: 'pass', sensors } as never)).toMatch(/^no sensor receipt written: invalid receipt: larger than/);
        expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
    });
    test('R2.5 buildReceipt rejects a null input without a raw TypeError', () => {
        expect(() => buildReceipt(null as never)).toThrow(/invalid receipt/);
        expect(() => buildReceipt(null as never)).not.toThrow(TypeError);
    });
    test('R2.2 a real directory outside git still reports not a git repository', () => {
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plain-'));
        try {
            const pre = captureReceiptPrecondition(plain);
            expect(pre.eligible === false && pre.reason).toBe('not inside a git repository with a commit');
        } finally { fs.rmSync(plain, { recursive: true, force: true }); }
    });
    describe('git failures', () => {
        let spy: jest.SpyInstance; 
        const failStatusWith = (code: string) => {
            const real = childProcess.execFileSync;
            spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>) => {
                if (cmd === 'git' && args[0] === 'status') { throw Object.assign(new Error(`spawnSync git ${code}`), { code }); }
                return (real as (...a: unknown[]) => unknown)(cmd, args, opts);
            }) as never);
        };
        afterEach(() => spy?.mockRestore());
        test.each([['ENOBUFS'], ['ETIMEDOUT']])('R2.2 a %s from git status is reported as a git failure, not a missing repository', (code) => {
            failStatusWith(code);
            const pre = captureReceiptPrecondition(root);
            expect(pre).toEqual({ eligible: false, reason: 'git command failed or timed out' });
        });
        test('R2.2 a git failure during the post-run recheck withholds the receipt with the failure reason', () => {
            const pre = captureReceiptPrecondition(root);
            failStatusWith('ETIMEDOUT');
            expect(finalizeReceipt(pre, output as never)).toBe('no sensor receipt written: git command failed or timed out\n');
            expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
        });
    });
    test('R2.1 the precondition resolves the repository root from a subdirectory', () => {
        fs.mkdirSync(path.join(root, 'sub'));
        const pre = captureReceiptPrecondition(path.join(root, 'sub'));
        // git prints forward slashes on Windows and may resolve short names: compare both sides through the OS.
        expect(pre.eligible).toBe(true);
        expect(pre.eligible && fs.realpathSync.native(pre.root)).toBe(fs.realpathSync.native(root));
        expect(pre.eligible && pre.root).toBe(path.resolve(pre.eligible ? pre.root : ''));
        expect(pre.eligible && pre.commit).toBe(g('rev-parse', 'HEAD'));
    });
    test('R2.2 HEAD moving during the run yields no receipt', () => {
        const pre = captureReceiptPrecondition(root);
        fs.writeFileSync(path.join(root, 'c.txt'), 'c'); g('add', '.'); g('commit', '-q', '-m', 'fix: c');
        expect(finalizeReceipt(pre, output as never)).toMatch(/HEAD or tracked files changed/);
        expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
    });
    test('R2.2 a tracked file modified during the run yields no receipt and a note', () => {
        const pre = captureReceiptPrecondition(root);
        fs.writeFileSync(path.join(root, 'a.txt'), 'auto-fixed by a sensor');
        expect(finalizeReceipt(pre, output as never)).toMatch(/^no sensor receipt written: HEAD or tracked files changed during the run\n$/);
        expect(fs.existsSync(path.join(root, '.awm', 'sensors', 'runs'))).toBe(false);
    });
    test('R2.2 a tracked file staged for deletion during the run yields no receipt', () => {
        const pre = captureReceiptPrecondition(root);
        g('rm', '-q', 'a.txt');
        expect(finalizeReceipt(pre, output as never)).toMatch(/HEAD or tracked files changed/);
    });
    describe('a submodule (hidden by .gitmodules ignore=all and diff.ignoreSubmodules=all)', () => {
        let sm = ''; let commitInSm: (name: string) => string = () => '';
        beforeEach(() => {
            const hidden = makeHiddenSubmodule(root, (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: gitEnv() }).trim());
            sm = hidden.dir; commitInSm = hidden.commitInSm;
        });
        test('R2.2 a sensor writing an untracked file inside a clean submodule still gets a receipt', () => {
            const pre = captureReceiptPrecondition(root);
            expect(pre.eligible).toBe(true);
            fs.writeFileSync(path.join(sm, 'coverage.out'), 'x');
            expect(finalizeReceipt(pre, output as never)).toBe('');
            expect(readReceipt(root, g('rev-parse', 'HEAD')).ok).toBe(true);
        });
        test('R2.2 a sensor that moves the submodule checkout withholds the receipt', () => {
            const pre = captureReceiptPrecondition(root);
            commitInSm('two');
            expect(finalizeReceipt(pre, output as never)).toMatch(/^no sensor receipt written: HEAD or tracked files changed during the run\n$/);
        });
        test('R2.2 a sensor that modifies tracked content inside the submodule withholds the receipt', () => {
            const pre = captureReceiptPrecondition(root);
            fs.writeFileSync(path.join(sm, 'one'), 'changed');
            expect(finalizeReceipt(pre, output as never)).toMatch(/HEAD or tracked files changed/);
        });
        test('R2.1 a submodule moved before the run makes the tree ineligible', () => {
            commitInSm('two');
            expect(captureReceiptPrecondition(root)).toEqual({ eligible: false, reason: 'working tree has uncommitted changes (commit them first)' });
        });
    });
    test('R2.2 an untracked file created by a sensor during the run does not prevent the receipt', () => {
        const pre = captureReceiptPrecondition(root);
        fs.mkdirSync(path.join(root, 'coverage'));
        fs.writeFileSync(path.join(root, 'coverage', 'lcov.info'), 'x');
        expect(finalizeReceipt(pre, output as never)).toBe('');
        expect(readReceipt(root, g('rev-parse', 'HEAD')).ok).toBe(true);
    });
    test('R2.2 a tracked change under an excluded runtime path during the run does not prevent the receipt', () => {
        fs.mkdirSync(path.join(root, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'journal', 'j.json'), '{}');
        g('add', '.'); g('commit', '-q', '-m', 'chore: journal');
        const pre = captureReceiptPrecondition(root);
        fs.writeFileSync(path.join(root, '.awm', 'journal', 'j.json'), '{"edited":true}');
        expect(finalizeReceipt(pre, output as never)).toBe('');
    });
    test('R2.2 a tracked .awm/sensors.json modified during the run yields no receipt', () => {
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{}');
        g('add', '.'); g('commit', '-q', '-m', 'chore: sensors');
        const pre = captureReceiptPrecondition(root);
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{"edited":true}');
        expect(finalizeReceipt(pre, output as never)).toMatch(/HEAD or tracked files changed/);
    });
    test('R2.2 outside git yields no receipt', () => {
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plain-'));
        try {
            const pre = captureReceiptPrecondition(plain);
            expect(pre.eligible).toBe(false);
            expect(finalizeReceipt(pre, output as never)).toMatch(/no sensor receipt written: not inside a git repository/);
        } finally { fs.rmSync(plain, { recursive: true, force: true }); }
    });
    test('R2.2 a repository without a commit yields no receipt', () => {
        const empty = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-')));
        try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty, env: gitEnv() });
            expect(captureReceiptPrecondition(empty).eligible).toBe(false);
        } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    });
    test('R2.2 a non-string cwd yields no receipt without throwing', () => {
        expect(captureReceiptPrecondition(undefined as never)).toEqual({ eligible: false, reason: 'cwd must be a non-empty string' });
    });
    test('R2.2 an ineligible or malformed precondition reports a reason without throwing', () => {
        expect(finalizeReceipt(undefined as never, output as never)).toMatch(/^no sensor receipt written: /);
    });
    posixOnly('R2.2 a write failure is reported as a single escaped line and never thrown', () => {
        const pre = captureReceiptPrecondition(root);
        fs.mkdirSync(path.join(root, '.awm', 'sensors'), { recursive: true });
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-else\n-'));
        fs.symlinkSync(elsewhere, path.join(root, '.awm', 'sensors', 'runs'));
        try {
            const note = finalizeReceipt(pre, output as never);
            expect(note).toMatch(/^no sensor receipt written: .*symlink/);
            expect(note.slice(0, -1)).not.toMatch(/[\n\r]/);
            expect(note.endsWith('\n')).toBe(true);
        } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
    });
    test('R2.2 an error message with control characters is escaped to a single line', () => {
        const pre = captureReceiptPrecondition(root);
        const note = finalizeReceipt(pre, output as never, { version: () => { throw new Error('bad\nline\u001b[31m'); } });
        expect(note).toBe('no sensor receipt written: bad\\nline\\u001b[31m\n');
    });
    test('R2.5 an oversized receipt file is invalid', () => {
        const head = writeValid();
        fs.appendFileSync(runsFile(head), ' '.repeat(1024 * 1024)); // still valid JSON with a matching digest
        expect(fs.statSync(runsFile(head)).size).toBeGreaterThan(1024 * 1024);
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('R2.5 a directory in place of the receipt file is invalid', () => {
        const head = writeValid();
        fs.rmSync(runsFile(head)); fs.mkdirSync(runsFile(head));
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('R2.3/R2.5 digest covers every field and tampering invalidates', () => {
        const head = g('rev-parse', 'HEAD');
        const r = buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '9.20.0', output: output as never });
        expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        writeReceipt(root, r);
        const file = path.join(root, '.awm', 'sensors', 'runs', `${head}.json`);
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        parsed.overall = 'fail';
        fs.writeFileSync(file, JSON.stringify(parsed));
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
        expect(readReceipt(root, 'f'.repeat(40))).toEqual({ ok: false, code: 'receipt-missing' });
        expect(readReceipt(root, '../x')).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test.each([
        ['ranAt', (r: Record<string, unknown>) => { r.ranAt = '2026-10-17T11:00:00.000Z'; }],
        ['cliVersion', (r: Record<string, unknown>) => { r.cliVersion = '0.0.1'; }],
        ['sensors', (r: Record<string, unknown>) => { (r.sensors as Record<string, string>).lint = 'fail'; }],
    ])('R2.5 changing %s without re-digesting invalidates the receipt', (_field, mutate) => {
        const head = writeValid();
        mutateFile(head, mutate);
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('R2.3 the digest changes with each covered field', () => {
        const base = { schema: 1 as const, commit: 'a'.repeat(40), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', overall: 'pass' as const, sensors: { lint: 'pass' as const } };
        const d = computeReceiptDigest(base);
        expect(computeReceiptDigest({ ...base, commit: 'b'.repeat(40) })).not.toBe(d);
        expect(computeReceiptDigest({ ...base, ranAt: '2026-10-17T10:00:00.001Z' })).not.toBe(d);
        expect(computeReceiptDigest({ ...base, cliVersion: '1.0.1' })).not.toBe(d);
        expect(computeReceiptDigest({ ...base, overall: 'fail' })).not.toBe(d);
        expect(computeReceiptDigest({ ...base, sensors: { lint: 'fail' } })).not.toBe(d);
        expect(computeReceiptDigest({ ...base, sensors: { a: 'pass', b: 'pass' } })).toBe(computeReceiptDigest({ ...base, sensors: { b: 'pass', a: 'pass' } }));
    });
    test.each([
        ['null', null], ['undefined', undefined], ['a number', 42], ['a string', 'x'], ['an array', []],
        ['a body whose sensors is null', { schema: 1, commit: 'a'.repeat(40), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', overall: 'pass', sensors: null }],
        ['a body whose sensors is a string', { schema: 1, commit: 'a'.repeat(40), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', overall: 'pass', sensors: 'x' }],
        ['a body whose sensors is an array', { schema: 1, commit: 'a'.repeat(40), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', overall: 'pass', sensors: [] }],
    ])('R2.3 computeReceiptDigest rejects %s with a typed Error, never a TypeError', (_n, body) => {
        let caught: unknown;
        try { computeReceiptDigest(body as never); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).not.toBeInstanceOf(TypeError);
        expect((caught as Error).message).toMatch(/^invalid receipt: digest body (sensors )?must be an object$/);
        if (!/sensors/.test(_n)) expect((caught as Error).message).toBe('invalid receipt: digest body must be an object');
    });
    test('R2.3 buildReceipt rejects a commit that is not lowercase hex', () => {
        const mk = (commit: string) => () => buildReceipt({ commit, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', output: output as never });
        expect(mk('../x')).toThrow(/lowercase hex/);
        expect(mk('A'.repeat(40))).toThrow(/lowercase hex/);
        expect(mk('a'.repeat(40))).not.toThrow();
    });
    test('R2.5 an extra key invalidates the receipt even with a recomputed digest', () => {
        const head = writeValid();
        mutateFile(head, (r) => { r.extra = 1; }, true);
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('R2.5 a receipt whose commit differs from the requested one is invalid', () => {
        const head = writeValid();
        mutateFile(head, (r) => { r.commit = 'e'.repeat(40); }, true);
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test.each([
        ['non-canonical ranAt', (r: Record<string, unknown>) => { r.ranAt = '2026-10-17'; }],
        ['unparseable ranAt', (r: Record<string, unknown>) => { r.ranAt = 'not-a-date'; }],
        ['numeric ranAt', (r: Record<string, unknown>) => { r.ranAt = 5; }],
        ['unknown overall', (r: Record<string, unknown>) => { r.overall = 'great'; }],
        ['unknown sensor status', (r: Record<string, unknown>) => { (r.sensors as Record<string, string>).lint = 'ok'; }],
        ['array sensors', (r: Record<string, unknown>) => { r.sensors = []; }],
        ['null sensors', (r: Record<string, unknown>) => { r.sensors = null; }],
        ['schema 2', (r: Record<string, unknown>) => { r.schema = 2; }],
        ['non-string cliVersion', (r: Record<string, unknown>) => { r.cliVersion = 1; }],
        ['multi-line cliVersion', (r: Record<string, unknown>) => { r.cliVersion = '1.0\n2.0'; }],
        ['multi-line sensor name', (r: Record<string, unknown>) => { (r.sensors as Record<string, string>)['bad\nname'] = 'pass'; }],
    ])('R2.5 strict shape rejects %s even with a recomputed digest', (_name, mutate) => {
        const head = writeValid();
        mutateFile(head, mutate, true);
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test.each([['not json', 'nope{'], ['null', 'null'], ['an array', '[]'], ['a string', '"x"']])('R2.5 a file containing %s is invalid', (_n, body) => {
        const head = writeValid();
        fs.writeFileSync(runsFile(head), body);
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    posixOnly('R2.5 a symlinked receipt file is invalid', () => {
        const head = writeValid();
        const real = path.join(root, 'real.json');
        fs.renameSync(runsFile(head), real);
        fs.symlinkSync(real, runsFile(head));
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    posixOnly('R2.5 a receipt read through a symlinked .awm directory is invalid', () => {
        const head = writeValid();
        const moved = path.join(root, 'moved-awm');
        fs.renameSync(path.join(root, '.awm'), moved);
        fs.symlinkSync(moved, path.join(root, '.awm'));
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('R2.5 a missing runs directory reads as receipt-missing', () => {
        expect(readReceipt(root, g('rev-parse', 'HEAD'))).toEqual({ ok: false, code: 'receipt-missing' });
    });
    test('R2.5 readReceipt never throws on non-string input', () => {
        expect(readReceipt(undefined as never, 'a'.repeat(40))).toEqual({ ok: false, code: 'receipt-invalid' });
        expect(readReceipt(root, undefined as never)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    posixOnly('refuses a symlinked runs directory', () => {
        const head = g('rev-parse', 'HEAD');
        fs.mkdirSync(path.join(root, '.awm', 'sensors'), { recursive: true });
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-else-'));
        fs.symlinkSync(elsewhere, path.join(root, '.awm', 'sensors', 'runs'));
        const r = buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        expect(() => writeReceipt(root, r)).toThrow(/symlink/);
        expect(fs.readdirSync(elsewhere)).toEqual([]);
        fs.rmSync(elsewhere, { recursive: true, force: true });
    });
    posixOnly('a symlink refusal escapes control characters in the path it names', () => {
        const weirdRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-weird\n-'));
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-else-'));
        try {
            fs.symlinkSync(elsewhere, path.join(weirdRoot, '.awm'));
            const r = buildReceipt({ commit: g('rev-parse', 'HEAD'), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
            let message = '';
            try { writeReceipt(weirdRoot, r); } catch (e) { message = (e as Error).message; }
            expect(message).toMatch(/^refusing to use symlinked path /);
            expect(message).not.toMatch(/[\n\r]/);
        } finally { fs.rmSync(weirdRoot, { recursive: true, force: true }); fs.rmSync(elsewhere, { recursive: true, force: true }); }
    });
    posixOnly('refuses a symlinked .awm directory on write', () => {
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-else-'));
        fs.symlinkSync(elsewhere, path.join(root, '.awm'));
        const r = buildReceipt({ commit: g('rev-parse', 'HEAD'), ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        expect(() => writeReceipt(root, r)).toThrow(/symlink/);
        expect(fs.readdirSync(elsewhere)).toEqual([]);
        fs.rmSync(elsewhere, { recursive: true, force: true });
    });
});

describe('sensors run wiring (R2.2, R2.4)', () => {
    let stdout: jest.SpyInstance; let stderr: jest.SpyInstance; let cwd: jest.SpyInstance;
    const runCli = async (...flags: string[]) => {
        const program = new Command();
        program.exitOverride();
        registerSensorsCommand(program);
        await program.parseAsync(['node', 'awm', 'sensors', 'run', ...flags]);
    };
    const written = (spy: jest.SpyInstance) => spy.mock.calls.map((c) => String(c[0])).join('');
    const receiptsDir = () => path.join(root, '.awm', 'sensors', 'runs');
    const rootManifest = () => path.join(root, '.awm', 'sensors.json');
    // What `runSensors` reports as the manifest it ran: whatever the real resolver finds from the (mocked) cwd.
    const resolvedManifest = () => resolveSensorProject(process.cwd()).manifestPath;
    const commitManifest = (dir: string) => {
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'), '{"v":1}');
        g('add', '-A'); g('commit', '-q', '-m', `chore: manifest in ${path.basename(dir)}`);
    };
    const receiptNames = () => fs.readdirSync(receiptsDir()).sort();
    beforeEach(() => {
        process.exitCode = undefined;
        commitManifest(root);
        (findManifestDir as jest.Mock).mockReset().mockImplementation((start: string) => {
            const project = resolveSensorProject(start);
            return project.state === 'configured' ? project.projectRoot : null;
        });
        (runSensors as jest.Mock).mockReset().mockImplementation(async () => ({ ...output, manifestPath: resolvedManifest() }));
        stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    });
    afterEach(() => { stdout.mockRestore(); stderr.mockRestore(); cwd.mockRestore(); process.exitCode = undefined; });

    test('R2.4 a full run on a clean tree writes a receipt and leaves stdout and the exit code unchanged', async () => {
        await runCli();
        expect(written(stdout)).toBe(JSON.stringify(output, null, 2) + '\n');
        expect(written(stderr)).toBe('');
        expect(process.exitCode).toBe(0);
        expect(receiptNames()).toEqual(['.gitignore', `${g('rev-parse', 'HEAD')}.json`]);
    });
    test('R2.1 --all is a full selection', async () => {
        await runCli('--all');
        expect(fs.existsSync(receiptsDir())).toBe(true);
    });
    test('R2.2 --fast writes no receipt and prints nothing on stderr', async () => {
        await runCli('--fast');
        expect(fs.existsSync(receiptsDir())).toBe(false);
        expect(written(stderr)).toBe('');
    });
    test('R2.2 --changed writes no receipt and prints nothing on stderr', async () => {
        await runCli('--changed');
        expect(fs.existsSync(receiptsDir())).toBe(false);
        expect(written(stderr)).toBe('');
    });
    test('R2.2 a full run on a dirty tree prints one stderr line and keeps verdict and exit code', async () => {
        (runSensors as jest.Mock).mockResolvedValue({ overall: 'fail', sensors: [{ name: 'lint', status: 'fail', errors: [] }], manifestPath: rootManifest() });
        fs.writeFileSync(path.join(root, 'b.txt'), 'b');
        await runCli();
        expect(written(stderr)).toMatch(/^no sensor receipt written: .*uncommitted.*\n$/);
        expect(written(stdout)).toContain('"overall": "fail"');
        expect(process.exitCode).toBe(1);
        expect(fs.existsSync(receiptsDir())).toBe(false);
    });
    test('R2.5 a sensor name the receipt cannot hold withholds the receipt but leaves stdout and the exit code unchanged', async () => {
        const bad = { overall: 'pass', sensors: [{ name: 'a\nb', status: 'pass', errors: [] }], manifestPath: rootManifest() };
        (runSensors as jest.Mock).mockResolvedValue(bad);
        await runCli();
        expect(written(stdout)).toBe(JSON.stringify(bad, null, 2) + '\n');
        expect(process.exitCode).toBe(0);
        expect(written(stderr)).toMatch(/^no sensor receipt written: invalid receipt: [^\n]+\n$/);
        expect(fs.existsSync(receiptsDir())).toBe(false);
    });
    test('R2.2 untracked sensor output during the run still gets a receipt with no stderr', async () => {
        (runSensors as jest.Mock).mockImplementation(async () => { fs.writeFileSync(path.join(root, 'c.txt'), 'c'); return { ...output, manifestPath: rootManifest() }; });
        await runCli();
        expect(written(stderr)).toBe('');
        expect(receiptNames()).toEqual(['.gitignore', `${g('rev-parse', 'HEAD')}.json`]);
    });
    test('R2.2 a tracked file changed during the run withholds the receipt with one stderr line', async () => {
        (runSensors as jest.Mock).mockImplementation(async () => { fs.writeFileSync(path.join(root, 'a.txt'), 'fixed'); return { ...output, manifestPath: rootManifest() }; });
        await runCli();
        expect(written(stderr)).toMatch(/HEAD or tracked files changed/);
        expect(fs.existsSync(receiptsDir())).toBe(false);
        expect(process.exitCode).toBe(0);
    });

    describe('R2.2b scope: only the repository root manifest, only when a sensor ran', () => {
        const stdoutOf = (out: unknown) => JSON.stringify(out, null, 2) + '\n';
        test('from a sub-directory WITHOUT its own manifest the root manifest runs (the resolver walks up) and certifies the commit', async () => {
            const sub = path.join(root, 'packages', 'app');
            fs.mkdirSync(sub, { recursive: true });
            cwd.mockReturnValue(sub);
            expect(resolvedManifest()).toBe(rootManifest());
            await runCli();
            expect(written(stderr)).toBe('');
            expect(receiptNames()).toEqual(['.gitignore', `${g('rev-parse', 'HEAD')}.json`]);
        });
        test('a monorepo sub-manifest run writes no receipt, says so on one stderr line, and leaves stdout and the exit code alone', async () => {
            const sub = path.join(root, 'packages', 'app');
            fs.mkdirSync(sub, { recursive: true });
            commitManifest(sub);
            cwd.mockReturnValue(sub);
            expect(fs.realpathSync.native(resolvedManifest())).toBe(fs.realpathSync.native(path.join(sub, '.awm', 'sensors.json')));
            await runCli();
            expect(written(stdout)).toBe(stdoutOf({ ...output, manifestPath: resolvedManifest() }));
            expect(process.exitCode).toBe(0);
            expect(written(stderr)).toMatch(/^no sensor receipt written: the manifest that ran is not the repository root's \.awm\/sensors\.json[^\n]*\n$/);
            expect(fs.existsSync(receiptsDir())).toBe(false);
        });
        test('the precondition is anchored at the manifest directory, not at the cwd', async () => {
            const plain = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plain-')));
            try {
                cwd.mockReturnValue(plain); // not a git repository: only the manifest directory leads to one
                (findManifestDir as jest.Mock).mockReturnValue(root);
                (runSensors as jest.Mock).mockResolvedValue({ ...output, manifestPath: rootManifest() });
                await runCli();
                expect(written(stderr)).toBe('');
                expect(receiptNames()).toEqual(['.gitignore', `${g('rev-parse', 'HEAD')}.json`]);
            } finally { fs.rmSync(plain, { recursive: true, force: true }); }
        });
        test.each([
            ['an empty sensors list with a pass verdict', { overall: 'pass', sensors: [] }],
            ['not_certified with an empty list (absent or invalid manifest)', { overall: 'not_certified', sensors: [], mode: 'invalid', reason: 'manifest-malformed' }],
            ['not_certified although sensors are listed (legacy manifest)', { overall: 'not_certified', sensors: [{ name: 'lint', status: 'pass', errors: [] }] }],
        ])('%s: no receipt, one stderr line, stdout and exit code unchanged', async (_n, partial) => {
            const out = { ...partial, manifestPath: rootManifest() };
            (runSensors as jest.Mock).mockResolvedValue(out);
            await runCli();
            expect(written(stdout)).toBe(stdoutOf(out));
            expect(process.exitCode).toBe(exitCodeForVerdict(out.overall as never));
            expect(written(stderr)).toBe('no sensor receipt written: no sensor ran, so there is nothing to certify\n');
            expect(fs.existsSync(receiptsDir())).toBe(false);
        });
        test('an output that does not say which manifest ran certifies nothing (fail closed)', async () => {
            (runSensors as jest.Mock).mockResolvedValue({ overall: 'pass', sensors: output.sensors });
            await runCli();
            expect(written(stderr)).toMatch(/^no sensor receipt written: the manifest that ran is not the repository root's/);
            expect(fs.existsSync(receiptsDir())).toBe(false);
        });
    });
});
