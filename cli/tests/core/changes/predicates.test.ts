import { COMMIT_ID, MAX_SENSOR_NAME, OVERALLS, SENSOR_STATUSES, isCommitId, isOverall, isSensorName, isSensorStatus } from '../../../src/core/changes/types';
import { buildReceipt, readReceipt, writeReceipt } from '../../../src/core/changes/receipt';
import { validateRecordShape } from '../../../src/core/changes/validate-shape';
import { commitSha } from '../../../src/core/changes/git';
import { makeRepo } from './helpers';
import fs from 'fs';
import path from 'path';

// One set of predicates for what a receipt, a record and git may hold (types.ts); receipt.ts, validate-shape.ts and git.ts use these.
const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const SHA256 = '0123456789abcdef'.repeat(4);

describe('shared receipt and record predicates', () => {
    test('a commit id is 40 or 64 lowercase hex characters, and nothing else', () => {
        expect(isCommitId(SHA1)).toBe(true);
        expect(isCommitId(SHA256)).toBe(true);
        expect(COMMIT_ID.test(SHA256)).toBe(true);
        for (const bad of ['', 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(40), 'g'.repeat(40), `${SHA1}\n`, undefined, null, 5]) expect(isCommitId(bad)).toBe(false);
    });
    test('the verdicts, the sensor statuses and the sensor names', () => {
        expect(OVERALLS).toEqual(['pass', 'fail', 'skipped', 'not_certified']);
        expect(SENSOR_STATUSES).toEqual(['pass', 'fail', 'inconclusive', 'skipped']);
        for (const ok of OVERALLS) expect(isOverall(ok)).toBe(true);
        for (const ok of SENSOR_STATUSES) expect(isSensorStatus(ok)).toBe(true);
        for (const bad of ['great', 'PASS', '', undefined, 1]) { expect(isOverall(bad)).toBe(false); expect(isSensorStatus(bad)).toBe(false); }
        expect(isOverall('inconclusive')).toBe(false);
        expect(isSensorStatus('not_certified')).toBe(false);
        expect(isSensorName('lint')).toBe(true);
        expect(isSensorName('\u{1F600}'.repeat(MAX_SENSOR_NAME))).toBe(true);
        for (const bad of ['', 'a\nb', '\u{1F600}'.repeat(MAX_SENSOR_NAME + 1), 'a b', 5, undefined]) expect(isSensorName(bad)).toBe(false);
    });
    test('a receipt and a record accept the same commit ids (a sha-256 repository works)', () => {
        const sensors = [{ name: 'lint', status: 'pass', errors: [] }];
        for (const commit of [SHA1, SHA256]) {
            const receipt = buildReceipt({ commit, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', output: { overall: 'pass', sensors } as never });
            expect(receipt.commit).toBe(commit);
        }
        for (const bad of ['a'.repeat(63), 'a'.repeat(65)]) {
            expect(() => buildReceipt({ commit: bad, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', output: { overall: 'pass', sensors } as never })).toThrow(/invalid receipt: commit/);
        }
    });
    test('a receipt for a 64-hex commit round-trips through the file', () => {
        const repo = makeRepo();
        try {
            const receipt = buildReceipt({ commit: SHA256, ranAt: '2026-10-17T10:00:00.000Z', cliVersion: '1', output: { overall: 'pass', sensors: [{ name: 'lint', status: 'pass', errors: [] }] } as never });
            writeReceipt(repo.root, receipt);
            expect(fs.existsSync(path.join(repo.root, '.awm', 'sensors', 'runs', `${SHA256}.json`))).toBe(true);
            const read = readReceipt(repo.root, SHA256);
            expect(read.ok && read.receipt.commit).toBe(SHA256);
        } finally { repo.cleanup(); }
    });
    test('validate-shape accepts a 64-hex verification.commit and rejects 63 and 65', () => {
        const record = (commit: string) => ['---', 'schema: awm.change-record/v1', 'id: 2026-10-17-x', 'title: t', 'summary_short: s', 'type: feat', 'scope: null', 'semver: minor', 'breaking: false', 'modules: []',
            'verification:', `  commit: "${commit}"`, '  overall: pass', '  sensors: {}', `  receipt_digest: "sha256:${'a'.repeat(64)}"`, 'manual_validation:', '  none: n/a', 'risks: []', 'rollback: git revert', '---', '', '## Qué se hizo', 'x', '## Qué se probó', 'x', '## Qué falta validar', 'x', '## Riesgos y rollback', 'x', ''].join('\n');
        const commitDiagnostics = (commit: string) => validateRecordShape('2026-10-17-x.md', record(commit)).diagnostics.filter((d) => d.field === 'verification.commit');
        expect(commitDiagnostics(SHA1)).toEqual([]);
        expect(commitDiagnostics(SHA256)).toEqual([]);
        expect(commitDiagnostics('a'.repeat(63))).toHaveLength(1);
        expect(commitDiagnostics('a'.repeat(65))).toHaveLength(1);
    });
    test('git.ts answers commit ids that satisfy the shared predicate', () => {
        const repo = makeRepo();
        try {
            expect(isCommitId(commitSha(repo.root, 'HEAD'))).toBe(true);
        } finally { repo.cleanup(); }
    });
});
