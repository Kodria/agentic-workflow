jest.mock('../../../src/commands/sensors/run', () => ({ runSensors: jest.fn(), findManifestDir: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { RUNTIME_STATE_EXCLUDES, buildReceipt, captureReceiptPrecondition, computeReceiptDigest, finalizeReceipt, isFullSelection, readReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { registerSensorsCommand } from '../../../src/commands/sensors/index';
import { runSensors } from '../../../src/commands/sensors/run';

const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_CONFIG_NOSYSTEM'];
let saved: Record<string, string | undefined> = {};
let root: string; let home: string;
// Jest's sandboxed `process.env` is a copy, so identity must be passed to the child explicitly.
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' };
const g = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: GIT_ENV }).trim();

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcpt-')));
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    g('add', '.'); g('commit', '-q', '-m', 'feat: a');
});
afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

const output = { overall: 'pass' as const, sensors: [{ name: 'lint', status: 'pass' as const, errors: [] }, { name: 'a-typecheck', status: 'pass' as const, errors: [] }] };
const runsFile = (head: string) => path.join(root, '.awm', 'sensors', 'runs', `${head}.json`);
const writeValid = () => {
    const head = g('rev-parse', 'HEAD');
    writeReceipt(root, buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '9.20.0', output: output as never }));
    return head;
};
/** Rewrites the on-disk receipt with `mutate` applied, keeping (or not) the old digest. */
const mutateFile = (head: string, mutate: (r: Record<string, unknown>) => void, redigest = false) => {
    const parsed = JSON.parse(fs.readFileSync(runsFile(head), 'utf8'));
    mutate(parsed);
    if (redigest) { const { digest: _d, ...body } = parsed; parsed.digest = computeReceiptDigest(body); }
    fs.writeFileSync(runsFile(head), JSON.stringify(parsed));
};

describe('receipt', () => {
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
    test('R2.1 a receipt replacing an existing 0666 file ends with mode 0600', () => {
        if (process.platform === 'win32') return;
        const head = g('rev-parse', 'HEAD');
        fs.mkdirSync(path.dirname(runsFile(head)), { recursive: true });
        fs.writeFileSync(runsFile(head), 'stale');
        fs.chmodSync(runsFile(head), 0o666);
        const pre = captureReceiptPrecondition(root);
        expect(finalizeReceipt(pre, output as never)).toBe('');
        expect(fs.statSync(runsFile(head)).mode & 0o777).toBe(0o600);
        expect(readReceipt(root, head).ok).toBe(true);
    });
    test('R2.1 writeReceipt forces mode 0600 on an existing file', () => {
        if (process.platform === 'win32') return;
        const head = writeValid();
        fs.chmodSync(runsFile(head), 0o644);
        writeValid();
        expect(fs.statSync(runsFile(head)).mode & 0o777).toBe(0o600);
    });
    test('R2.1 the receipt directory is 0700', () => {
        if (process.platform === 'win32') return;
        writeValid();
        expect(fs.statSync(path.join(root, '.awm', 'sensors', 'runs')).mode & 0o777).toBe(0o700);
    });
    test('R2.1 selection rules', () => {
        expect(isFullSelection({})).toBe(true);
        expect(isFullSelection({ all: true })).toBe(true);
        expect(isFullSelection({ fast: true, slow: true })).toBe(true);
        expect(isFullSelection({ fast: true })).toBe(false);
        expect(isFullSelection({ slow: true })).toBe(false);
        expect(isFullSelection({ all: true, changed: true })).toBe(false);
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
    test('R2.1 the runtime-state exclusion list is exactly the local state paths', () => {
        expect([...RUNTIME_STATE_EXCLUDES]).toEqual(['.awm/sensors/runs', '.awm/journal', '.awm/ledger', '.awm/evidence', '.awm/track.json']);
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
    test('R2.1 the precondition resolves the repository root from a subdirectory', () => {
        fs.mkdirSync(path.join(root, 'sub'));
        const pre = captureReceiptPrecondition(path.join(root, 'sub'));
        expect(pre).toMatchObject({ eligible: true, root, commit: g('rev-parse', 'HEAD') });
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
        const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-')));
        try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
            expect(captureReceiptPrecondition(empty).eligible).toBe(false);
        } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    });
    test('R2.2 a non-string cwd yields no receipt without throwing', () => {
        expect(captureReceiptPrecondition(undefined as never)).toEqual({ eligible: false, reason: 'cwd must be a non-empty string' });
    });
    test('R2.2 an ineligible or malformed precondition reports a reason without throwing', () => {
        expect(finalizeReceipt(undefined as never, output as never)).toMatch(/^no sensor receipt written: /);
    });
    test('R2.2 a write failure is reported as a single escaped line and never thrown', () => {
        if (process.platform === 'win32') return;
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
    test('R2.3 buildReceipt rejects a commit that is not 40 lowercase hex', () => {
        const mk = (commit: string) => () => buildReceipt({ commit, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', output: output as never });
        expect(mk('../x')).toThrow(/40 lowercase hex/);
        expect(mk('A'.repeat(40))).toThrow(/40 lowercase hex/);
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
    test('R2.5 a symlinked receipt file is invalid', () => {
        if (process.platform === 'win32') return;
        const head = writeValid();
        const real = path.join(root, 'real.json');
        fs.renameSync(runsFile(head), real);
        fs.symlinkSync(real, runsFile(head));
        expect(readReceipt(root, head)).toEqual({ ok: false, code: 'receipt-invalid' });
    });
    test('R2.5 a receipt read through a symlinked .awm directory is invalid', () => {
        if (process.platform === 'win32') return;
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
    test('refuses a symlinked runs directory', () => {
        if (process.platform === 'win32') return;
        const head = g('rev-parse', 'HEAD');
        fs.mkdirSync(path.join(root, '.awm', 'sensors'), { recursive: true });
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-else-'));
        fs.symlinkSync(elsewhere, path.join(root, '.awm', 'sensors', 'runs'));
        const r = buildReceipt({ commit: head, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1.0.0', output: output as never });
        expect(() => writeReceipt(root, r)).toThrow(/symlink/);
        expect(fs.readdirSync(elsewhere)).toEqual([]);
        fs.rmSync(elsewhere, { recursive: true, force: true });
    });
    test('refuses a symlinked .awm directory on write', () => {
        if (process.platform === 'win32') return;
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
    beforeEach(() => {
        process.exitCode = undefined;
        (runSensors as jest.Mock).mockReset().mockResolvedValue(output);
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
        expect(fs.readdirSync(receiptsDir())).toEqual([`${g('rev-parse', 'HEAD')}.json`]);
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
        (runSensors as jest.Mock).mockResolvedValue({ overall: 'fail', sensors: [{ name: 'lint', status: 'fail', errors: [] }] });
        fs.writeFileSync(path.join(root, 'b.txt'), 'b');
        await runCli();
        expect(written(stderr)).toMatch(/^no sensor receipt written: .*uncommitted.*\n$/);
        expect(written(stdout)).toContain('"overall": "fail"');
        expect(process.exitCode).toBe(1);
        expect(fs.existsSync(receiptsDir())).toBe(false);
    });
    test('R2.2 untracked sensor output during the run still gets a receipt with no stderr', async () => {
        (runSensors as jest.Mock).mockImplementation(async () => { fs.writeFileSync(path.join(root, 'c.txt'), 'c'); return output; });
        await runCli();
        expect(written(stderr)).toBe('');
        expect(fs.readdirSync(receiptsDir())).toEqual([`${g('rev-parse', 'HEAD')}.json`]);
    });
    test('R2.2 a tracked file changed during the run withholds the receipt with one stderr line', async () => {
        (runSensors as jest.Mock).mockImplementation(async () => { fs.writeFileSync(path.join(root, 'a.txt'), 'fixed'); return output; });
        await runCli();
        expect(written(stderr)).toMatch(/HEAD or tracked files changed/);
        expect(fs.existsSync(receiptsDir())).toBe(false);
        expect(process.exitCode).toBe(0);
    });
});
