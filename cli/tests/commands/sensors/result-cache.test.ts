import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    canCacheRawResult,
    computeSensorFingerprint,
    readResultCache,
    toCacheRaw,
    writeResultCache,
    type ResultCacheRecord,
} from '../../../src/commands/sensors/result-cache';
import type { SensorResult } from '../../../src/commands/sensors/types';
import { applyBaseline, interpretResult } from '../../../src/commands/sensors/result';
import { fingerprint as findingFingerprint } from '../../../src/commands/sensors/baseline';
import { exited, ok, spawnFailed } from './exec-fixtures';

function prepared(overrides: Record<string, unknown> = {}) {
    return {
        name: 'lint',
        formatter: 'eslint-llm',
        timeoutMs: 30_000,
        timeoutSource: 'project' as const,
        requestedScope: 'full' as const,
        effectiveScope: 'full' as const,
        command: { kind: 'structured' as const, value: { executable: 'eslint', resolution: 'path' as const, args: ['.'] } },
        ...overrides,
    };
}

function sampleRaw(overrides: Partial<SensorResult> = {}): SensorResult {
    return {
        name: 'lint',
        status: 'pass',
        errors: [],
        ...overrides,
    };
}

describe('result cache helpers (RF-2.4, RF-2.10, RF-2.15)', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    it('sets failureKind findings|missing-binary|exit-code on fail results (RF-2.4)', () => {
        const findings = interpretResult(prepared(), exited(1, JSON.stringify([{
            filePath: 'a.ts',
            messages: [{ line: 1, column: 1, message: 'x', ruleId: 'no-x', severity: 2 }],
        }])));
        expect(findings.status).toBe('fail');
        expect(findings.failureKind).toBe('findings');

        // Name `security` selects the semgrep formatter (no invented findings from shell noise).
        const missing = interpretResult(prepared({ name: 'security', formatter: undefined }), exited(127, '', 'command not found'));
        expect(missing.status).toBe('fail');
        expect(missing.failureKind).toBe('missing-binary');

        const spawn = interpretResult(prepared({ formatter: 'exit-code' }), spawnFailed('ENOENT'));
        expect(spawn.status).toBe('fail');
        expect(spawn.failureKind).toBe('missing-binary');

        const exitCode = interpretResult(prepared({ formatter: 'exit-code', name: 'iac' }), exited(1, 'drift\n'));
        expect(exitCode.status).toBe('fail');
        expect(exitCode.failureKind).toBe('exit-code');
    });

    it('canCacheRawResult allows pass and findings-fail with errors; rejects exit-code/missing-binary/incomplete (RF-2.4)', () => {
        expect(canCacheRawResult(sampleRaw({ status: 'pass' }))).toBe(true);
        expect(canCacheRawResult(sampleRaw({
            status: 'fail',
            failureKind: 'findings',
            errors: [{ message: 'x', file: 'a.ts', rule: 'r' }],
        }))).toBe(true);
        expect(canCacheRawResult(sampleRaw({ status: 'fail', failureKind: 'exit-code', errors: [{ message: 'exit 1' }] }))).toBe(false);
        expect(canCacheRawResult(sampleRaw({ status: 'fail', failureKind: 'missing-binary', errors: [{ message: 'gone' }] }))).toBe(false);
        expect(canCacheRawResult(sampleRaw({ status: 'fail', failureKind: 'findings', errors: [] }))).toBe(false);
        expect(canCacheRawResult(sampleRaw({ status: 'inconclusive', errors: [], skipReason: 'timeout' }))).toBe(false);
        expect(canCacheRawResult(sampleRaw({
            status: 'fail',
            failureKind: 'findings',
            errors: [{ message: 'x' }],
            incomplete: 'timeout after 1ms',
        }))).toBe(false);
        expect(canCacheRawResult(interpretResult(prepared({ formatter: 'exit-code' }), exited(1, 'x')))).toBe(false);
        expect(canCacheRawResult(interpretResult(prepared({ name: 'security', formatter: undefined }), exited(127, '', 'command not found')))).toBe(false);
        expect(canCacheRawResult(interpretResult(prepared(), ok()))).toBe(true);
    });

    it('canCacheRawResult / planted pass+errors or pass+failureKind is a miss (not cacheable)', () => {
        expect(canCacheRawResult(sampleRaw({
            status: 'pass',
            errors: [{ message: 'planted finding' }],
        }))).toBe(false);
        expect(canCacheRawResult(sampleRaw({
            status: 'pass',
            failureKind: 'findings',
            errors: [],
        }))).toBe(false);
        expect(canCacheRawResult(sampleRaw({
            status: 'pass',
            failureKind: 'exit-code',
            errors: [{ message: 'x' }],
        }))).toBe(false);

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcache-pass-errors-'));
        roots.push(root);
        const base = {
            schema: 1 as const,
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: 'sha256:' + 'a'.repeat(64),
            inputDigest: 'sha256:' + 'b'.repeat(64),
            originCommit: 'c'.repeat(40),
            originDirty: false,
        };
        const lookup = {
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: base.sensorFingerprint,
            inputDigest: base.inputDigest,
        };
        const { cacheFileName } = require('../../../src/commands/sensors/result-cache') as typeof import('../../../src/commands/sensors/result-cache');
        const dir = path.join(root, '.awm', 'sensors', 'runs');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, cacheFileName(lookup)),
            JSON.stringify({
                ...base,
                raw: { name: 'lint', status: 'pass', errors: [{ message: 'planted' }] },
            }, null, 2) + '\n',
        );
        expect(readResultCache(root, lookup)).toBeNull();
        expect(() => writeResultCache(root, {
            ...base,
            raw: { name: 'lint', status: 'pass', errors: [{ message: 'planted' }] },
        })).toThrow(/cacheable|refuse|uncacheable|RF-2\.4|errors|failureKind/i);
    });

    it('binds raw.name to sensorId on write and read; mismatch refuses write / misses on read', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcache-name-bind-'));
        roots.push(root);
        const base = {
            schema: 1 as const,
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: 'sha256:' + 'a'.repeat(64),
            inputDigest: 'sha256:' + 'b'.repeat(64),
            originCommit: 'c'.repeat(40),
            originDirty: false,
        };
        expect(() => writeResultCache(root, {
            ...base,
            raw: { name: 'typecheck', status: 'pass', errors: [] },
        })).toThrow(/name|sensorId|mismatch|bind/i);

        writeResultCache(root, {
            ...base,
            raw: { name: 'lint', status: 'pass', errors: [] },
        });
        const lookup = {
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: base.sensorFingerprint,
            inputDigest: base.inputDigest,
        };
        const { cacheFileName } = require('../../../src/commands/sensors/result-cache') as typeof import('../../../src/commands/sensors/result-cache');
        const dir = path.join(root, '.awm', 'sensors', 'runs');
        const cachePath = path.join(dir, cacheFileName(lookup));
        const record = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        record.raw.name = 'typecheck';
        fs.writeFileSync(cachePath, JSON.stringify(record, null, 2) + '\n');
        expect(readResultCache(root, lookup)).toBeNull();
    });

    it('constrains cached SensorError message/file to single-line strings', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcache-error-line-'));
        roots.push(root);
        const base = {
            schema: 1 as const,
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: 'sha256:' + 'a'.repeat(64),
            inputDigest: 'sha256:' + 'b'.repeat(64),
            originCommit: 'c'.repeat(40),
            originDirty: false,
        };
        expect(() => writeResultCache(root, {
            ...base,
            raw: {
                name: 'lint',
                status: 'fail',
                failureKind: 'findings',
                errors: [{ message: 'bad\nline', file: 'a.ts' }],
            },
        })).toThrow(/single.?line|message|errors/i);
        expect(() => writeResultCache(root, {
            ...base,
            raw: {
                name: 'lint',
                status: 'fail',
                failureKind: 'findings',
                errors: [{ message: 'ok', file: 'a\nts' }],
            },
        })).toThrow(/single.?line|file|errors/i);
    });

    it('computeSensorFingerprint returns null without live tool/runtime versions (RF-2.10)', () => {
        expect(computeSensorFingerprint({
            variantId: 'eslint-10',
            command: { executable: 'eslint', args: ['.'] },
            cliVersion: '9.21.0',
            inputs: ['**/*.ts'],
            toolVersion: null,
            runtimeVersion: '22.0.0',
        })).toBeNull();
        expect(computeSensorFingerprint({
            variantId: null,
            command: { executable: 'node', args: ['x'] },
            cliVersion: '9.21.0',
            inputs: ['**/*.ts'],
            toolVersion: undefined,
            runtimeVersion: undefined,
        })).toBeNull();

        const fp = computeSensorFingerprint({
            variantId: 'eslint-10',
            command: { executable: 'eslint', args: ['.'] },
            cliVersion: '9.21.0',
            inputs: ['**/*.ts'],
            toolVersion: '10.0.0',
            runtimeVersion: '22.0.0',
        });
        expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
        const changedTool = computeSensorFingerprint({
            variantId: 'eslint-10',
            command: { executable: 'eslint', args: ['.'] },
            cliVersion: '9.21.0',
            inputs: ['**/*.ts'],
            toolVersion: '10.1.0',
            runtimeVersion: '22.0.0',
        });
        expect(changedTool).not.toBe(fp);
    });

    it('validates cache reads recursively; tamper or symlink yields miss (RF-2.15, RF-E.1)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcache-'));
        roots.push(root);
        const record: ResultCacheRecord = {
            schema: 1,
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: 'sha256:' + 'a'.repeat(64),
            inputDigest: 'sha256:' + 'b'.repeat(64),
            originCommit: 'c'.repeat(40),
            originDirty: false,
            raw: { name: 'lint', status: 'pass', errors: [] },
        };
        writeResultCache(root, record);
        const hit = readResultCache(root, {
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: record.sensorFingerprint,
            inputDigest: record.inputDigest,
        });
        expect(hit).toEqual(record);

        const file = path.join(root, '.awm', 'sensors', 'runs', hit ? path.basename(
            // discover written file
            fs.readdirSync(path.join(root, '.awm', 'sensors', 'runs')).find((n) => n.startsWith('cache-'))!,
        ) : '');
        const cacheDir = path.join(root, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.readdirSync(cacheDir).filter((n) => n.startsWith('cache-'));
        expect(cacheFiles).toHaveLength(1);
        const cachePath = path.join(cacheDir, cacheFiles[0]!);
        fs.writeFileSync(cachePath, JSON.stringify({ ...record, raw: { status: 'pass' } }));
        expect(readResultCache(root, {
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: record.sensorFingerprint,
            inputDigest: record.inputDigest,
        })).toBeNull();

        fs.writeFileSync(cachePath, JSON.stringify(record));
        fs.unlinkSync(cachePath);
        fs.symlinkSync('/tmp/evil', cachePath);
        expect(readResultCache(root, {
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: record.sensorFingerprint,
            inputDigest: record.inputDigest,
        })).toBeNull();
        void file;
    });

    it('rejects cache reads whose raw would fail canCacheRawResult (RF-2.15/2.4)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcache-uncacheable-'));
        roots.push(root);
        const base = {
            schema: 1 as const,
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: 'sha256:' + 'a'.repeat(64),
            inputDigest: 'sha256:' + 'b'.repeat(64),
            originCommit: 'c'.repeat(40),
            originDirty: false,
        };
        const lookup = {
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: base.sensorFingerprint,
            inputDigest: base.inputDigest,
        };
        const plant = (raw: ResultCacheRecord['raw']) => {
            // Bypass writeResultCache so uncacheable raw can be planted on disk.
            const dir = path.join(root, '.awm', 'sensors', 'runs');
            fs.mkdirSync(dir, { recursive: true });
            const { cacheFileName } = require('../../../src/commands/sensors/result-cache') as typeof import('../../../src/commands/sensors/result-cache');
            fs.writeFileSync(path.join(dir, cacheFileName(lookup)), JSON.stringify({ ...base, raw }, null, 2) + '\n');
        };

        plant({ name: 'lint', status: 'fail', failureKind: 'exit-code', errors: [{ message: 'exit 1' }] });
        expect(readResultCache(root, lookup)).toBeNull();

        plant({ name: 'lint', status: 'fail', failureKind: 'missing-binary', errors: [{ message: 'gone' }] });
        expect(readResultCache(root, lookup)).toBeNull();

        plant({ name: 'lint', status: 'fail', failureKind: 'findings', errors: [] });
        expect(readResultCache(root, lookup)).toBeNull();

        plant({
            name: 'lint',
            status: 'fail',
            failureKind: 'findings',
            errors: [{ message: 'x', file: 'a.ts', rule: 'r' }],
            incomplete: 'timeout after 1ms',
        });
        expect(readResultCache(root, lookup)).toBeNull();

        plant({
            name: 'lint',
            status: 'fail',
            failureKind: 'findings',
            errors: [{ message: 'x', file: 'a.ts', rule: 'r' }],
        });
        expect(readResultCache(root, lookup)).toMatchObject({
            raw: { status: 'fail', failureKind: 'findings' },
        });
    });

    it('writeResultCache refuses uncacheable raw; toCacheRaw does not coerce skipped/inconclusive to pass (QA-3)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rcache-write-gate-'));
        roots.push(root);
        const base = {
            schema: 1 as const,
            sensorId: 'lint',
            projectKey: 'proj',
            sensorFingerprint: 'sha256:' + 'a'.repeat(64),
            inputDigest: 'sha256:' + 'b'.repeat(64),
            originCommit: 'c'.repeat(40),
            originDirty: false,
        };
        expect(() => writeResultCache(root, {
            ...base,
            raw: { name: 'lint', status: 'fail', failureKind: 'exit-code', errors: [{ message: 'exit 1' }] },
        })).toThrow(/cacheable|refuse|uncacheable|RF-2\.4/i);

        expect(() => toCacheRaw(sampleRaw({ status: 'skipped', skipReason: 'disabled' }))).toThrow(/pass|fail|cache/i);
        expect(() => toCacheRaw(sampleRaw({ status: 'inconclusive', skipReason: 'timeout' }))).toThrow(/pass|fail|cache/i);
        expect(toCacheRaw(sampleRaw({ status: 'pass' }))).toMatchObject({ status: 'pass', errors: [] });
    });

    it('strips failureKind when applyBaseline yields pass (QA-4)', () => {
        const err = { file: 'a.ts', line: 1, column: 1, message: 'no-x', rule: 'no-x' };
        const raw: SensorResult = {
            name: 'lint',
            status: 'fail',
            failureKind: 'findings',
            errors: [err],
        };
        const suppressed = applyBaseline(raw, [findingFingerprint('lint', err)]);
        expect(suppressed.status).toBe('pass');
        expect(suppressed.failureKind).toBeUndefined();
        expect(suppressed.errors).toEqual([]);
    });
});
