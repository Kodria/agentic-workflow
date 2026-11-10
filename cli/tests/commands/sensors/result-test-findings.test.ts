import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyBaseline, executePrepared, interpretResult } from '../../../src/commands/sensors/result';
import { fingerprint } from '../../../src/commands/sensors/baseline';
import type { PreparedSensorExecution } from '../../../src/commands/sensors/types';
import { exited, ok, spawnFailed, timedOut } from './exec-fixtures';

const mockRunCommand = jest.fn();
const mockRunStructuredCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: unknown[]) => mockRunCommand(...args),
    runStructuredCommand: (...args: unknown[]) => mockRunStructuredCommand(...args),
}));

const DEFAULT_JSON = 'coverage/awm-test-results.json';
const DEFAULT_XML = 'coverage/awm-test-results.xml';

function prepared(overrides: Partial<PreparedSensorExecution> = {}): PreparedSensorExecution {
    return {
        name: 'test',
        formatter: 'test',
        timeoutMs: 30_000,
        timeoutSource: 'project',
        requestedScope: 'full',
        effectiveScope: 'full',
        certification: 'project-declared',
        command: { kind: 'structured', value: { executable: 'node', resolution: 'path', args: ['run-tests.js'] } },
        ...overrides,
    };
}

function jestPassing(): string {
    return JSON.stringify({
        numFailedTests: 0,
        numFailedTestSuites: 0,
        numRuntimeErrorTestSuites: 0,
        wasInterrupted: false,
        testResults: [],
    });
}

function jestOneFail(opts: {
    coverageMap?: unknown;
    numRuntimeErrorTestSuites?: number;
    wasInterrupted?: boolean;
    file?: string;
    fullName?: string;
} = {}): string {
    const file = opts.file ?? 'src/math.test.ts';
    const fullName = opts.fullName ?? 'math adds';
    return JSON.stringify({
        numFailedTests: 1,
        numFailedTestSuites: 1,
        numRuntimeErrorTestSuites: opts.numRuntimeErrorTestSuites ?? 0,
        wasInterrupted: opts.wasInterrupted ?? false,
        ...(opts.coverageMap !== undefined ? { coverageMap: opts.coverageMap } : {}),
        testResults: [
            {
                name: file,
                status: 'failed',
                assertionResults: [
                    { status: 'failed', fullName, title: 'adds', ancestorTitles: ['math'] },
                ],
            },
        ],
    });
}

function writeRel(cwd: string, rel: string, content: string | Buffer): string {
    const abs = path.join(cwd, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
}

function identityOf(abs: string): { mtimeMs: number; size: number; ino?: number } {
    const st = fs.lstatSync(abs);
    return { mtimeMs: st.mtimeMs, size: st.size, ino: Number(st.ino) };
}

describe('test findings interpretResult / executePrepared (RF-1.1–1.11)', () => {
    let cwd: string;

    beforeEach(() => {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-test-findings-'));
        mockRunCommand.mockReset();
        mockRunStructuredCommand.mockReset();
        mockRunStructuredCommand.mockResolvedValue(exited(1));
        mockRunCommand.mockResolvedValue(exited(1));
    });

    afterEach(() => {
        fs.rmSync(cwd, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    it('exit 0 with no artifact → pass (RF-1.5)', () => {
        const result = interpretResult(prepared(), ok('ok\n'), { cwd });
        expect(result).toMatchObject({ status: 'pass', errors: [] });
        expect(result.failureKind).toBeUndefined();
    });

    it('exit 0 with fresh json and 0 failures → pass', () => {
        writeRel(cwd, DEFAULT_JSON, jestPassing());
        const result = interpretResult(prepared(), ok(''), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result).toMatchObject({ status: 'pass', errors: [] });
    });

    it('exit 0 with fresh json and ≥1 failure → fail findings (RF-1.1/1.7)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        const result = interpretResult(prepared(), ok(''), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.status).toBe('fail');
        expect(result.failureKind).toBe('findings');
        expect(result.errors).toEqual([
            expect.objectContaining({ file: 'src/math.test.ts', rule: 'math adds' }),
        ]);
    });

    it('exit ≠0 with no artifact → synthetic exit-code (RF-1.5)', () => {
        const result = interpretResult(prepared(), exited(1, 'tests failed'), { cwd });
        expect(result).toMatchObject({
            status: 'fail',
            failureKind: 'exit-code',
            errors: [{ message: 'SENSOR[test] failed (exit 1)' }],
        });
    });

    it('exit ≠0 with bad JSON content → synthetic exit-code (RF-1.4)', () => {
        writeRel(cwd, DEFAULT_JSON, 'not-json{{{');
        const result = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.failureKind).toBe('exit-code');
        expect(result.errors[0]?.message).toMatch(/SENSOR\[test\] failed/);
    });

    it('exit ≠0 with symlink-leaf escape → synthetic exit-code (RF-1.3)', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-outside-'));
        try {
            const secret = path.join(outside, 'secret.json');
            fs.writeFileSync(secret, jestOneFail());
            fs.mkdirSync(path.join(cwd, 'coverage'), { recursive: true });
            fs.symlinkSync(secret, path.join(cwd, DEFAULT_JSON));
            const result = interpretResult(prepared(), exited(1), {
                cwd,
                priorIdentities: { [DEFAULT_JSON]: null },
            });
            expect(result.failureKind).toBe('exit-code');
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('exit ≠0 with oversize artifact → synthetic exit-code (RF-1.3)', () => {
        const abs = writeRel(cwd, DEFAULT_JSON, '');
        const fd = fs.openSync(abs, 'w');
        fs.ftruncateSync(fd, 16 * 1024 * 1024 + 1);
        fs.closeSync(fd);
        const result = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.failureKind).toBe('exit-code');
    });

    it('exit ≠0 with non-UTF8 artifact → synthetic exit-code (RF-1.3)', () => {
        writeRel(cwd, DEFAULT_JSON, Buffer.from([0xff, 0xfe, 0xfd]));
        const result = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.failureKind).toBe('exit-code');
    });

    it('exit ≠0 with fresh 0 findings → synthetic exit-code (RF-1.6)', () => {
        writeRel(cwd, DEFAULT_JSON, jestPassing());
        const result = interpretResult(prepared(), exited(2), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result).toMatchObject({
            status: 'fail',
            failureKind: 'exit-code',
            errors: [{ message: 'SENSOR[test] failed (exit 2)' }],
        });
    });

    it('exit ≠0 with explained findings → findings; baseline may pass (RF-1.7/1.10)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        const raw = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(raw.status).toBe('fail');
        expect(raw.failureKind).toBe('findings');
        expect(raw.errors).toHaveLength(1);

        const fp = fingerprint('test', raw.errors[0]!);
        const baselined = applyBaseline(raw, [fp]);
        expect(baselined.status).toBe('pass');
        expect(baselined.failureKind).toBeUndefined();
        expect(baselined.baselineCount).toBe(1);
    });

    it('exit ≠0 with findings + coverageMap → exit-code; baseline of findings must not pass (RF-1.10 N1)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail({ coverageMap: {} }));
        const raw = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(raw.status).toBe('fail');
        expect(raw.failureKind).toBe('exit-code');
        expect(raw.errors[0]?.message).toMatch(/SENSOR\[test\] failed/);

        const findingFp = fingerprint('test', {
            file: 'src/math.test.ts',
            rule: 'math adds',
            message: 'math adds',
        });
        const baselined = applyBaseline(raw, [findingFp]);
        expect(baselined.status).toBe('fail');
        expect(baselined.failureKind).toBe('exit-code');
    });

    it('exit ≠0 with findings + runtimeError → exit-code (RF-1.10 H2)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail({ numRuntimeErrorTestSuites: 1 }));
        const result = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.failureKind).toBe('exit-code');
    });

    it('exit ≠0 with findings + wasInterrupted → exit-code (RF-1.10 H2)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail({ wasInterrupted: true }));
        const result = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.failureKind).toBe('exit-code');
    });

    it('stale: pre-seed artifact cleared and not rewritten → exit-code, never pass (RF-1.9 H1)', async () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        mockRunStructuredCommand.mockResolvedValue(exited(1));
        const result = await executePrepared(prepared(), cwd);
        expect(result.failureKind).toBe('exit-code');
        expect(result.errors[0]?.message).toMatch(/SENSOR\[test\] failed/);
        expect(fs.existsSync(path.join(cwd, DEFAULT_JSON))).toBe(false);
    });

    it('unlink fails with unchanged identity → exit-code, never pass (RF-1.9 N2)', async () => {
        const abs = writeRel(cwd, DEFAULT_JSON, jestOneFail());
        const before = identityOf(abs);
        const unlink = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
            throw new Error('EPERM');
        });
        mockRunStructuredCommand.mockImplementation(async () => {
            // Identity unchanged — do not rewrite.
            expect(identityOf(abs)).toEqual(before);
            return exited(1);
        });
        try {
            const result = await executePrepared(prepared(), cwd);
            expect(result.failureKind).toBe('exit-code');
            expect(result.errors[0]?.rule).toBeUndefined();
            expect(result.errors[0]?.message).toMatch(/SENSOR\[test\] failed/);
        } finally {
            unlink.mockRestore();
        }
    });

    it('symlink intermediate parent refuses clear / treats artifact unusable (RF-1.11 N3)', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-parent-esc-'));
        try {
            fs.writeFileSync(path.join(outside, 'awm-test-results.json'), jestOneFail());
            fs.symlinkSync(outside, path.join(cwd, 'coverage'));
            mockRunStructuredCommand.mockResolvedValue(exited(1));
            const result = await executePrepared(prepared(), cwd);
            expect(result.failureKind).toBe('exit-code');
            // Outside file must remain (clear refused — no escape unlink).
            expect(fs.existsSync(path.join(outside, 'awm-test-results.json'))).toBe(true);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('honors custom resultsFile under cwd (non-readOnly)', async () => {
        const custom = 'custom/out.json';
        mockRunStructuredCommand.mockImplementation(async () => {
            writeRel(cwd, custom, jestOneFail({ file: 'custom.test.ts', fullName: 'custom fails' }));
            return exited(1);
        });
        const result = await executePrepared(prepared({ resultsFile: custom }), cwd);
        expect(result.failureKind).toBe('findings');
        expect(result.errors[0]).toMatchObject({ file: 'custom.test.ts', rule: 'custom fails' });
    });

    it('defaults prefer coverage/awm-test-results.json over .xml (RF-1.2)', () => {
        writeRel(cwd, DEFAULT_XML, `<?xml version="1.0"?>
<testsuites>
  <testsuite name="x" failures="1" errors="0">
    <testcase classname="Xml" name="from-xml" file="xml.test.ts">
      <failure message="boom"/>
    </testcase>
  </testsuite>
</testsuites>`);
        writeRel(cwd, DEFAULT_JSON, jestOneFail({ file: 'json.test.ts', fullName: 'from json' }));
        const result = interpretResult(prepared(), exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null, [DEFAULT_XML]: null },
        });
        expect(result.failureKind).toBe('findings');
        expect(result.errors[0]).toMatchObject({ file: 'json.test.ts', rule: 'from json' });
    });

    it('timeout stays inconclusive without file-first substitute (RF-1.8)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        const result = interpretResult(prepared(), timedOut('partial'), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.status).toBe('inconclusive');
        expect(result.skipReason).toMatch(/timeout/);
    });

    it('spawn failure stays missing-binary without file-first substitute (RF-1.8)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        const result = interpretResult(prepared(), spawnFailed('ENOENT'), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.status).toBe('fail');
        expect(result.failureKind).toBe('missing-binary');
    });

    it('readOnly + default under coverage unlinks coverage candidate and does not mutate .awm (RF-1.11)', async () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(cwd, '.awm', 'keep.txt'), 'intact');
        const awmBefore = fs.readFileSync(path.join(cwd, '.awm', 'keep.txt'), 'utf8');
        mockRunStructuredCommand.mockImplementation(async () => {
            expect(fs.existsSync(path.join(cwd, DEFAULT_JSON))).toBe(false);
            writeRel(cwd, DEFAULT_JSON, jestOneFail());
            return exited(1);
        });
        const result = await executePrepared(prepared(), cwd, { readOnly: true });
        expect(result.failureKind).toBe('findings');
        expect(fs.readFileSync(path.join(cwd, '.awm', 'keep.txt'), 'utf8')).toBe(awmBefore);
        expect(fs.readdirSync(path.join(cwd, '.awm'))).toEqual(['keep.txt']);
    });

    it('readOnly + resultsFile outside exclusion names does not unlink; freshness via identity only (RF-1.11 N3)', async () => {
        const custom = 'reports/out.json';
        const abs = writeRel(cwd, custom, jestOneFail({ fullName: 'stale finding' }));
        const before = identityOf(abs);
        const unlink = jest.spyOn(fs, 'unlinkSync');
        mockRunStructuredCommand.mockImplementation(async () => {
            expect(fs.existsSync(abs)).toBe(true);
            expect(identityOf(abs)).toEqual(before);
            // Rewrite with new identity so freshness can accept it.
            fs.writeFileSync(abs, jestOneFail({ fullName: 'fresh finding' }));
            // Ensure mtime/size differ from snapshot.
            const st = fs.lstatSync(abs);
            fs.utimesSync(abs, st.atime, new Date(st.mtimeMs + 1000));
            return exited(1);
        });
        try {
            const result = await executePrepared(prepared({ resultsFile: custom }), cwd, { readOnly: true });
            const unlinkedCustom = unlink.mock.calls.some((args) => {
                const target = String(args[0]);
                return target.includes(`${path.sep}reports${path.sep}out.json`) || target.endsWith(path.join('reports', 'out.json'));
            });
            expect(unlinkedCustom).toBe(false);
            expect(result.failureKind).toBe('findings');
            expect(result.errors[0]?.rule).toBe('fresh finding');
        } finally {
            unlink.mockRestore();
        }
    });

    it('sensor named test without formatter still uses file-first path (RF-1.1)', () => {
        writeRel(cwd, DEFAULT_JSON, jestOneFail());
        const { formatter: _drop, ...rest } = prepared();
        const result = interpretResult(rest, exited(1), {
            cwd,
            priorIdentities: { [DEFAULT_JSON]: null },
        });
        expect(result.failureKind).toBe('findings');
    });
});
