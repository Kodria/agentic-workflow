import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateRecordShape } from '../../../src/core/changes/validate-shape';
import { PENDING_MARKER, MAX_RECORD_BYTES } from '../../../src/core/changes/types';

const SHA = 'a'.repeat(40);
const DIGEST = 'sha256:' + 'b'.repeat(64);
const NAME = '2026-10-17-change-record.md';

function fm(overrides: Record<string, string> = {}): string {
    const fields: Record<string, string> = {
        schema: 'schema: awm.change-record/v1',
        id: 'id: 2026-10-17-change-record',
        title: 'title: "Change Record por PR"',
        summary_short: 'summary_short: "Agrega el Change Record."',
        type: 'type: feat',
        scope: 'scope: changes',
        semver: 'semver: minor',
        breaking: 'breaking: false',
        modules: 'modules:\n  - cli/src/core\n  - cli/tests/core',
        verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n    lint: pass\n    typecheck: pass\n  receipt_digest: ${DIGEST}`,
        manual_validation: 'manual_validation:\n  - step: "Run awm changes list"\n    expected: "Shows the record"',
        risks: 'risks: []',
        rollback: 'rollback: "Revert the PR"',
        ...overrides,
    };
    return Object.values(fields).filter((v) => v !== '').join('\n');
}
const BODY = '## Qué se hizo\nA\n\n## Qué se probó\nB\n\n## Qué falta validar\nC\n\n## Riesgos y rollback\nD\n';
const doc = (front: string, body = BODY) => `---\n${front}\n---\n${body}`;
type Result = ReturnType<typeof validateRecordShape>;
const codes = (r: Result) => r.diagnostics.map((d) => d.code);
/** Asserts the diagnostic list contains `code` (and, when given, on exactly this `field`). */
function expectDiag(r: Result, code: string, field?: string): void {
    expect(r.record).toBeUndefined();
    expect(r.diagnostics).toContainEqual(expect.objectContaining(field === undefined ? { code } : { code, field }));
}
const check = (overrides: Record<string, string>, opts?: { root?: string }) => validateRecordShape(NAME, doc(fm(overrides)), opts);
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const withSensors = (sensors: string) => fm({ verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n${sensors}\n  receipt_digest: ${DIGEST}` });

describe('validateRecordShape', () => {
    test('accepts a complete valid record', () => {
        const r = validateRecordShape(NAME, doc(fm()));
        expect(r.diagnostics).toEqual([]);
        expect(r.record?.semver).toBe('minor');
    });

    describe('R1.1 file names', () => {
        test('rejects an invalid slug', () => {
            expectDiag(validateRecordShape('2026-10-17-Bad_Slug.md', doc(fm())), 'name-invalid');
        });
        test('rejects an impossible date', () => {
            expectDiag(validateRecordShape('2026-13-40-x.md', doc(fm({ id: 'id: 2026-13-40-x' }))), 'name-invalid');
        });
        test('rejects a slug longer than 64 characters', () => {
            expectDiag(validateRecordShape(`2026-10-17-${'a'.repeat(65)}.md`, doc(fm())), 'name-invalid');
        });
    });

    describe('R1.2 frontmatter', () => {
        test('is required', () => {
            expectDiag(validateRecordShape(NAME, BODY), 'frontmatter-missing');
        });
        test('rejects aliases of collections', () => {
            expectDiag(check({ risks: 'risks: &r ["x"]', rollback: 'rollback: *r' }), 'yaml-alias');
        });
        test('rejects custom tags', () => {
            expectDiag(check({ rollback: 'rollback: !!js/function "f"' }), 'yaml-invalid');
        });
        test('rejects scalar aliases and unused anchors', () => {
            expectDiag(check({ title: 'title: &a T', rollback: 'rollback: *a' }), 'yaml-alias');
            expectDiag(check({ rollback: 'rollback: &a r' }), 'yaml-alias');
            expectDiag(check({ risks: 'risks:\n  - &r x\n  - *r' }), 'yaml-alias');
            expectDiag(check({ modules: 'modules: &m\n  - cli/src/core' }), 'yaml-alias');
            expectDiag(check({ risks: 'risks:\n  - &r x' }), 'yaml-alias');
        });
        test('accepts quoted text that merely looks like an anchor or alias', () => {
            const r = check({ summary_short: 'summary_short: "uses *a and &b"', rollback: "rollback: 'revert &a *b'" });
            expect(r.diagnostics).toEqual([]);
        });
    });

    describe('R1.3 unknown fields', () => {
        test('are rejected at the top level', () => {
            expectDiag(check({ extra: 'status: merged' }), 'unknown-field', 'status');
        });
        test('are rejected under links', () => {
            expectDiag(check({ links: 'links:\n  pr: "https://x"' }), 'unknown-field', 'links.pr');
        });
        test('are rejected under verification, manual_validation items and provenance', () => {
            expectDiag(check({ verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors: {}\n  receipt_digest: ${DIGEST}\n  extra: 1` }), 'unknown-field', 'verification.extra');
            expectDiag(check({ manual_validation: 'manual_validation:\n  - step: "a"\n    expected: "b"\n    more: "c"' }), 'unknown-field', 'manual_validation.0.more');
            expectDiag(check({ provenance: 'provenance:\n  agent: "a"\n  host: "h"' }), 'unknown-field', 'provenance.host');
        });
    });

    describe('R1.4 field rules', () => {
        test('id must equal the file name', () => {
            expectDiag(check({ id: 'id: other' }), 'field-invalid', 'id');
        });
        test('summary_short is at most 280 characters', () => {
            expectDiag(check({ summary_short: `summary_short: "${'x'.repeat(281)}"` }), 'field-invalid', 'summary_short');
        });
        test('semver must be a known level', () => {
            expectDiag(check({ semver: 'semver: huge' }), 'field-invalid', 'semver');
        });
        test('modules must be sorted', () => {
            expectDiag(check({ modules: 'modules:\n  - b\n  - a' }), 'field-invalid', 'modules');
        });
        test('modules must be unique', () => {
            expectDiag(check({ modules: 'modules:\n  - a\n  - a' }), 'field-invalid', 'modules');
        });
        test('links.issue must be https', () => {
            expectDiag(check({ links: 'links:\n  issue: "http://insecure"' }), 'field-invalid', 'links.issue');
        });
        test('manual_validation must not be an empty list', () => {
            expectDiag(check({ manual_validation: 'manual_validation: []' }), 'field-invalid', 'manual_validation');
        });
        test('manual_validation accepts {none: reason}', () => {
            expect(check({ manual_validation: 'manual_validation:\n  none: "docs only"' }).diagnostics).toEqual([]);
        });
        test('provenance timestamps must be canonical ISO-8601', () => {
            expectDiag(check({ provenance: 'provenance:\n  started_at: "2026-10-17 10:00"' }), 'field-invalid', 'provenance.started_at');
        });
        test('a provenance unknown key with an invalid value yields only unknown-field', () => {
            const r = check({ provenance: 'provenance:\n  host: ""' });
            expect(r.diagnostics).toEqual([{ code: 'unknown-field', field: 'provenance.host', message: 'unknown field "provenance.host"' }]);
        });
        test('a provenance known key with an invalid value is field-invalid', () => {
            const r = check({ provenance: 'provenance:\n  agent: ""' });
            expect(r.diagnostics.map((d) => d.code)).toEqual(['field-invalid']);
            expectDiag(r, 'field-invalid', 'provenance.agent');
        });
        test('links.plan existence is checked when a root is given', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
            try {
                expectDiag(check({ links: 'links:\n  plan: docs/plans/missing.md' }, { root }), 'field-invalid', 'links.plan');
                expectDiag(check({ links: 'links:\n  plan: ../outside.md' }, { root }), 'field-invalid', 'links.plan');
            } finally { fs.rmSync(root, { recursive: true, force: true }); }
        });
        test('links.issue must be a clean https://host URL', () => {
            const issue = (v: string) => check({ links: `links:\n  issue: ${v}` });
            expect(issue('"https://github.com/Kodria/agentic-workflow/issues/217"').diagnostics).toEqual([]);
            for (const v of ['"https://e.com/a\\nb"', '"https://e.com/a\\tb"', '" https://e.com/a"', '"https://e.com/a "', '"https:example.com"', '"https:///nohost"', '"https://e.com/a\\u2028b"', '"https://e.com/a b"']) {
                expectDiag(issue(v), 'field-invalid', 'links.issue');
            }
        });
        test.each(['"https://user@example.com/1"', '"https://user:SECRET@example.com/1"', '"https://:SECRET@example.com/1"'])('R1.4 links.issue %s carries credentials and is field-invalid (a record never holds a secret)', (v) => {
            const result = check({ links: `links:\n  issue: ${v}` });
            expectDiag(result, 'field-invalid', 'links.issue');
            expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
        });
        (process.platform === 'win32' ? test.skip : test)('links.plan cannot escape the root through a symlinked directory', () => {
            const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
            const root = path.join(base, 'repo');
            const outside = path.join(base, 'outside');
            try {
                fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
                fs.mkdirSync(outside);
                fs.writeFileSync(path.join(outside, 'secret.md'), 'x');
                fs.writeFileSync(path.join(root, 'docs', 'plans', 'real.md'), 'x');
                fs.symlinkSync(outside, path.join(root, 'docs', 'link'));
                const plan = (p: string) => check({ links: `links:\n  plan: ${p}` }, { root });
                expect(plan('docs/plans/real.md').diagnostics).toEqual([]);
                expectDiag(plan('docs/link/secret.md'), 'field-invalid', 'links.plan');
            } finally { fs.rmSync(base, { recursive: true, force: true }); }
        });
        test('links.plan accepts in-repo files whose names start with two dots', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
            try {
                fs.mkdirSync(path.join(root, '..d'));
                fs.writeFileSync(path.join(root, '..notes.md'), 'x');
                fs.writeFileSync(path.join(root, '..d', 'p.md'), 'x');
                for (const plan of ['..notes.md', '..d/p.md']) {
                    expect(check({ links: `links:\n  plan: ${plan}` }, { root }).diagnostics).toEqual([]);
                }
                expectDiag(check({ links: 'links:\n  plan: ../outside.md' }, { root }), 'field-invalid', 'links.plan');
            } finally { fs.rmSync(root, { recursive: true, force: true }); }
        });
    });

    describe('R1.4 text safety', () => {
        const singleLine: Array<[string, Record<string, string>, string]> = [
            ['title with a newline', { title: 'title: "a\\nb"' }, 'title'],
            ['title with ESC', { title: 'title: "a\\x1bb"' }, 'title'],
            ['summary_short with U+0085', { summary_short: 'summary_short: "a\\u0085b"' }, 'summary_short'],
            ['summary_short with U+2028', { summary_short: 'summary_short: "a\\u2028b"' }, 'summary_short'],
            ['summary_short with U+2029', { summary_short: 'summary_short: "a\\u2029b"' }, 'summary_short'],
            ['scope with a newline', { scope: 'scope: "a\\nb"' }, 'scope'],
            ['scope with a tab', { scope: 'scope: "a\\tb"' }, 'scope'],
            ['type with a control character', { type: 'type: "fe\\x07at"' }, 'type'],
            ['modules entry with a newline', { modules: 'modules:\n  - "a\\nb"' }, 'modules'],
            ['modules entry with a leading space', { modules: 'modules:\n  - " a"' }, 'modules'],
            ['modules entry with a trailing space', { modules: 'modules:\n  - "a "' }, 'modules'],
            ['modules entry with a C1 character', { modules: 'modules:\n  - "a\\x85b"' }, 'modules'],
            ['links.plan with a newline', { links: 'links:\n  plan: "docs/a\\nb.md"' }, 'links.plan'],
            ['links.plan with a control character', { links: 'links:\n  plan: "docs/a\\x1bb.md"' }, 'links.plan'],
            ['links.issue with a control character', { links: 'links:\n  issue: "https://e.com/a\\x1bb"' }, 'links.issue'],
            ['provenance value with a newline', { provenance: 'provenance:\n  agent: "a\\nb"' }, 'provenance.agent'],
            ['provenance value with U+2029', { provenance: 'provenance:\n  model: "a\\u2029b"' }, 'provenance.model'],
        ];
        test.each(singleLine)('single-line rule: %s is rejected', (_label, overrides, field) => {
            expectDiag(check(overrides), 'field-invalid', field);
        });

        test('multi-line fields accept newline and tab', () => {
            const r = check({
                rollback: 'rollback: "step 1\\n\\tstep 2"',
                risks: 'risks:\n  - "a\\nb\\tc"',
                manual_validation: 'manual_validation:\n  - step: "one\\ntwo"\n    expected: "x\\ty"',
            });
            expect(r.diagnostics).toEqual([]);
        });
        test.each([
            ['rollback', { rollback: 'rollback: "a\\x1bb"' }, 'rollback'],
            ['risks item', { risks: 'risks:\n  - "a\\x1bb"' }, 'risks'],
            ['manual_validation step', { manual_validation: 'manual_validation:\n  - step: "a\\x1bb"\n    expected: "x"' }, 'manual_validation.0'],
            ['manual_validation expected', { manual_validation: 'manual_validation:\n  - step: "a"\n    expected: "x\\x07"' }, 'manual_validation.0'],
            ['manual_validation none', { manual_validation: 'manual_validation:\n  none: "a\\x1bb"' }, 'manual_validation.none'],
            ['rollback with a carriage return', { rollback: 'rollback: "a\\rb"' }, 'rollback'],
        ] as Array<[string, Record<string, string>, string]>)('multi-line rule: %s rejects other control characters', (_label, overrides, field) => {
            expectDiag(check(overrides), 'field-invalid', field);
        });
    });

    describe('R1.5 verification block', () => {
        test('commit must be a 40-hex SHA', () => {
            expectDiag(check({ verification: 'verification:\n  commit: abc\n  overall: pass\n  sensors: {}\n  receipt_digest: x' }), 'field-invalid', 'verification.commit');
        });
        test('receipt_digest must be sha256:<64 hex>', () => {
            expectDiag(check({ verification: 'verification:\n  commit: abc\n  overall: pass\n  sensors: {}\n  receipt_digest: x' }), 'field-invalid', 'verification.receipt_digest');
        });
        test('sensor status must be a known value', () => {
            expectDiag(check({ verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n    lint: green\n  receipt_digest: ${DIGEST}` }), 'field-invalid', 'verification.sensors');
        });
        test('accepts free-form sensor names', () => {
            expect(validateRecordShape(NAME, doc(withSensors('    "lint:ts": pass\n    "type check": skipped'))).diagnostics).toEqual([]);
        });
        test('rejects an empty sensor name', () => {
            expectDiag(validateRecordShape(NAME, doc(withSensors('    "": pass'))), 'field-invalid', 'verification.sensors');
        });
        test('rejects a sensor name with a newline', () => {
            expectDiag(validateRecordShape(NAME, doc(withSensors('    "a\\nb": pass'))), 'field-invalid', 'verification.sensors');
        });
        test('rejects a sensor name with a control character', () => {
            expectDiag(validateRecordShape(NAME, doc(withSensors('    "a\\x07b": pass'))), 'field-invalid', 'verification.sensors');
        });
        test('counts sensor name length in code points', () => {
            expect(validateRecordShape(NAME, doc(withSensors(`    "${'😀'.repeat(100)}": pass`))).diagnostics).toEqual([]);
            expect(validateRecordShape(NAME, doc(withSensors(`    "${'😀'.repeat(128)}": pass`))).diagnostics).toEqual([]);
            expectDiag(validateRecordShape(NAME, doc(withSensors(`    "${'😀'.repeat(129)}": pass`))), 'field-invalid', 'verification.sensors');
        });
    });

    describe('R1.4 required fields and value rules', () => {
        const REQUIRED = ['schema', 'id', 'title', 'summary_short', 'type', 'scope', 'semver', 'breaking', 'modules', 'verification', 'manual_validation', 'risks', 'rollback'];
        test.each(REQUIRED)('a missing %s is reported by name', (key) => {
            const r = check({ [key]: '' });
            expect(r.record).toBeUndefined();
            expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: 'field-invalid', field: key, message: `missing required field "${key}"` }));
        });
        test('links and provenance are optional', () => {
            expect(check({}).diagnostics).toEqual([]);
        });
        test('schema must be awm.change-record/v1', () => {
            expectDiag(check({ schema: 'schema: awm.change-record/v2' }), 'field-invalid', 'schema');
        });
        test.each(['"false"', '1', 'null', '[]'])('breaking: %s is not a boolean', (v) => {
            expectDiag(check({ breaking: `breaking: ${v}` }), 'field-invalid', 'breaking');
        });
        test('breaking: true is accepted', () => {
            expect(check({ breaking: 'breaking: true' }).diagnostics).toEqual([]);
        });
        test('verification.overall must be a receipt verdict', () => {
            expectDiag(check({ verification: `verification:\n  commit: ${SHA}\n  overall: green\n  sensors: {}\n  receipt_digest: ${DIGEST}` }), 'field-invalid', 'verification.overall');
        });
        test.each(['pass', 'fail', 'skipped', 'not_certified'])('verification.overall %s is accepted', (overall) => {
            expect(check({ verification: `verification:\n  commit: ${SHA}\n  overall: ${overall}\n  sensors: {}\n  receipt_digest: ${DIGEST}` }).diagnostics).toEqual([]);
        });
        test('title of 120 characters is accepted and 121 is rejected', () => {
            expect(check({ title: `title: "${'x'.repeat(120)}"` }).diagnostics).toEqual([]);
            expectDiag(check({ title: `title: "${'x'.repeat(121)}"` }), 'field-invalid', 'title');
        });
        test('title length counts code points', () => {
            expect(check({ title: `title: "${'😀'.repeat(120)}"` }).diagnostics).toEqual([]);
            expectDiag(check({ title: `title: "${'😀'.repeat(121)}"` }), 'field-invalid', 'title');
        });
        test('title must not be blank', () => {
            expectDiag(check({ title: 'title: "   "' }), 'field-invalid', 'title');
        });
        test.each(['"none"', '"a"', '{}', '5'])('risks: %s is not an array', (v) => {
            expectDiag(check({ risks: `risks: ${v}` }), 'field-invalid', 'risks');
        });
        test('risks items must be non-empty strings', () => {
            expectDiag(check({ risks: 'risks:\n  - ""' }), 'field-invalid', 'risks');
            expectDiag(check({ risks: 'risks:\n  - 5' }), 'field-invalid', 'risks');
        });
        test('risks with entries are accepted', () => {
            expect(check({ risks: 'risks:\n  - "latency"\n  - "format drift"' }).diagnostics).toEqual([]);
        });
        test('links.plan pointing at a directory is rejected', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
            try {
                fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
                expectDiag(check({ links: 'links:\n  plan: docs/plans' }, { root }), 'field-invalid', 'links.plan');
            } finally { fs.rmSync(root, { recursive: true, force: true }); }
        });
        test('a complete provenance block with canonical timestamps is accepted', () => {
            const r = check({ provenance: 'provenance:\n  agent: "claude-code"\n  model: "claude-sonnet-5-5"\n  session: "session_01"\n  started_at: "2026-10-17T10:00:00.000Z"\n  finished_at: "2026-10-17T11:30:15.250Z"' });
            expect(r.diagnostics).toEqual([]);
            expect(r.record?.provenance?.agent).toBe('claude-code');
        });
        test.each(['started_at', 'finished_at'])('provenance.%s without milliseconds is rejected', (key) => {
            expectDiag(check({ provenance: `provenance:\n  ${key}: "2026-10-17T10:00:00Z"` }), 'field-invalid', `provenance.${key}`);
        });
        test('provenance must be a mapping', () => {
            expectDiag(check({ provenance: 'provenance: "x"' }), 'field-invalid', 'provenance');
        });
    });

    describe('R1.5 commit and receipt digest', () => {
        const ver = (commit: string, digest: string) => check({ verification: `verification:\n  commit: "${commit}"\n  overall: pass\n  sensors: {}\n  receipt_digest: "${digest}"` });
        test('R1.5 a 64-hex commit (a sha-256 repository) is accepted', () => {
            expect(ver('0123456789abcdef'.repeat(4), DIGEST).diagnostics).toEqual([]);
        });
        test.each([['41 hex', 'a'.repeat(41)], ['63 hex', 'a'.repeat(63)], ['65 hex', 'a'.repeat(65)], ['64 hex with an uppercase letter', `A${'a'.repeat(63)}`]])('R1.5 a commit with %s is rejected', (_label, commit) => {
            expectDiag(ver(commit, DIGEST), 'field-invalid', 'verification.commit');
        });
        test('a 40-hex commit is accepted', () => {
            expect(ver('0123456789abcdef0123456789abcdef01234567', DIGEST).diagnostics).toEqual([]);
        });
        test.each([['39 hex', 'a'.repeat(39)], ['41 hex', 'a'.repeat(41)], ['uppercase hex', 'A'.repeat(40)], ['non-hex characters', 'g'.repeat(40)], ['empty', '']])('a commit with %s is rejected', (_label, commit) => {
            expectDiag(ver(commit, DIGEST), 'field-invalid', 'verification.commit');
        });
        test('a sha256 digest is accepted', () => {
            expect(ver(SHA, 'sha256:' + '0123456789abcdef'.repeat(4)).diagnostics).toEqual([]);
        });
        test.each([['63 hex', 'sha256:' + 'b'.repeat(63)], ['65 hex', 'sha256:' + 'b'.repeat(65)], ['uppercase hex', 'sha256:' + 'B'.repeat(64)], ['no sha256: prefix', 'b'.repeat(64)], ['another algorithm', 'sha1:' + 'b'.repeat(64)]])('a digest with %s is rejected', (_label, digest) => {
            expectDiag(ver(SHA, digest), 'field-invalid', 'verification.receipt_digest');
        });
    });

    describe('R1.6 body sections', () => {
        test('a missing section is rejected', () => {
            expectDiag(validateRecordShape(NAME, doc(fm(), '## Qué se hizo\nA\n')), 'body-section-missing');
        });
        test('out-of-order sections are rejected', () => {
            const swapped = '## Qué se probó\nB\n## Qué se hizo\nA\n## Qué falta validar\nC\n## Riesgos y rollback\nD\n';
            expectDiag(validateRecordShape(NAME, doc(fm(), swapped)), 'body-section-missing');
        });
        test('an empty section is rejected', () => {
            expectDiag(validateRecordShape(NAME, doc(fm(), BODY.replace('B\n', '\n'))), 'body-section-missing');
        });
    });

    describe('R1.7 pending markers', () => {
        test('are rejected in the raw frontmatter', () => {
            expectDiag(check({ rollback: `rollback: "${PENDING_MARKER}"` }), 'pending-content');
        });
        test('are rejected in the body', () => {
            expectDiag(validateRecordShape(NAME, doc(fm(), BODY.replace('A', PENDING_MARKER))), 'pending-content');
        });
        test('are rejected after YAML unescaping, at any depth', () => {
            const escaped = '\\x3c!-- awm:pending -->';
            expectDiag(check({ rollback: `rollback: "${escaped}"` }), 'pending-content');
            expectDiag(check({ risks: `risks:\n  - "ok"\n  - "see ${escaped}"` }), 'pending-content');
            expectDiag(check({ manual_validation: `manual_validation:\n  - step: "${escaped}"\n    expected: "x"` }), 'pending-content');
        });
    });

    describe('R1.8 bounds', () => {
        test('rejects oversize files before parsing', () => {
            const big = doc(fm()) + 'x'.repeat(MAX_RECORD_BYTES);
            expect(codes(validateRecordShape(NAME, big))).toEqual(['record-too-large']);
        });
        test('caps diagnostics at 50, the last being diagnostics-truncated', () => {
            const keys = Array.from({ length: 6000 }, (_v, i) => `k${i}: 1`).join('\n');
            const r = validateRecordShape(NAME, doc(`${fm()}\n${keys}`));
            expect(r.diagnostics.length).toBeLessThanOrEqual(50);
            expect(r.diagnostics[r.diagnostics.length - 1].code).toBe('diagnostics-truncated');
            expect(r.diagnostics[0].code).toBe('unknown-field');
        });
        test('reports how many diagnostics the cap dropped, so that kept + omitted is the total', () => {
            const keys = Array.from({ length: 6000 }, (_v, i) => `k${i}: 1`).join('\n');
            const r = validateRecordShape(NAME, doc(`${fm()}\n${keys}`));
            expect(r.omitted).toBe(6000 - 49);
            expect(r.diagnostics.length - 1 + (r.omitted ?? 0)).toBe(6000);
        });
        test('reports exactly 51 diagnostics as 49 kept and 2 omitted', () => {
            const keys = Array.from({ length: 51 }, (_v, i) => `k${i}: 1`).join('\n');
            expect(validateRecordShape(NAME, doc(`${fm()}\n${keys}`)).omitted).toBe(2);
        });
        test('has no omitted count when the cap was not reached', () => {
            expect(validateRecordShape(NAME, doc(`${fm()}\nk1: 1`))).not.toHaveProperty('omitted');
            expect(validateRecordShape(NAME, doc(fm()))).not.toHaveProperty('omitted');
        });
        test('does not add diagnostics-truncated when 50 or fewer diagnostics exist', () => {
            const r = validateRecordShape(NAME, doc(`${fm()}\nk1: 1\nk2: 1`));
            expect(codes(r)).toEqual(['unknown-field', 'unknown-field']);
        });
    });

    test('accepts CRLF line endings', () => {
        expect(validateRecordShape(NAME, doc(fm()).replace(/\n/g, '\r\n')).diagnostics).toEqual([]);
    });

    describe('hostile input never throws', () => {
        test.each([
            ['undefined raw', NAME, undefined],
            ['Buffer raw', NAME, Buffer.from(doc(fm()))],
            ['number raw', NAME, 42],
            ['null raw', NAME, null],
            ['undefined fileName', undefined, doc(fm())],
            ['number fileName', 7, doc(fm())],
            ['Buffer fileName', Buffer.from(NAME), doc(fm())],
        ])('%s yields input-invalid', (_label, name, raw) => {
            let r: Result | undefined;
            expect(() => { r = validateRecordShape(name as unknown as string, raw as unknown as string); }).not.toThrow();
            expect(codes(r as Result)).toEqual(['input-invalid']);
            expect((r as Result).record).toBeUndefined();
        });

        test('YAML nesting deeper than 100 levels yields a diagnostic', () => {
            for (const depth of [101, 200, 30000]) {
                const r = check({ title: `title: ${'['.repeat(depth)}${']'.repeat(depth)}` });
                expectDiag(r, 'yaml-invalid');
            }
        });
        test('duplicate keys yield yaml-invalid', () => {
            expectDiag(check({ extra: 'title: "again"' }), 'yaml-invalid');
        });
        test.each([['a sequence', '- a\n- b'], ['a scalar', 'just text'], ['an empty block', ''], ['comments only', '# nothing']])('frontmatter that is %s yields not-an-object', (_label, front) => {
            expectDiag(validateRecordShape(NAME, `---\n${front}\n---\n${BODY}`), 'not-an-object');
        });

        test('hostile unknown keys are escaped and bounded in field and message', () => {
            const r = check({ extra: 'k: 1\n"x\\ny\\x1b[31mz": 1\n"' + 'L'.repeat(1000) + '": 1' });
            const unknown = r.diagnostics.filter((d) => d.code === 'unknown-field');
            expect(unknown.length).toBe(3);
            for (const d of unknown) {
                expect(d.message).not.toMatch(UNSAFE);
                expect(d.field).toBeDefined();
                expect(d.field as string).not.toMatch(UNSAFE);
                expect((d.field as string).length).toBeLessThan(120);
                expect(d.message.length).toBeLessThan(250);
            }
            expect(unknown[1].field).toContain('x\\ny\\u001b[31mz');
        });
        test('a hostile file name is escaped in the name-invalid message', () => {
            const r = validateRecordShape('bad\n\x1b[31m' + 'N'.repeat(500) + '.md', doc(fm()));
            const d = r.diagnostics.find((x) => x.code === 'name-invalid');
            expect(d).toBeDefined();
            expect((d as { message: string }).message).not.toMatch(UNSAFE);
            expect((d as { message: string }).message.length).toBeLessThan(250);
        });
        test('a hostile links.plan is escaped in its diagnostic', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
            try {
                const r = check({ links: 'links:\n  plan: "docs/' + 'p'.repeat(500) + '.md"' }, { root });
                const d = r.diagnostics.find((x) => x.field === 'links.plan');
                expect(d).toBeDefined();
                expect((d as { message: string }).message.length).toBeLessThan(250);
            } finally { fs.rmSync(root, { recursive: true, force: true }); }
        });
        test('no diagnostic message is longer than 300 characters, ellipsis included', () => {
            const r = validateRecordShape('\u0001'.repeat(80) + '.md', doc(fm()));
            expect(r.diagnostics.length).toBeGreaterThan(0);
            for (const d of r.diagnostics) expect(d.message.length).toBeLessThanOrEqual(300);
            const long = validateRecordShape(NAME, `---\na: *${'"\\'.repeat(200)}\n---\n${BODY}`);
            expect(codes(long)).toContain('yaml-invalid');
            for (const d of long.diagnostics) expect(d.message.length).toBeLessThanOrEqual(300);
            const clipped = long.diagnostics.find((d) => d.code === 'yaml-invalid');
            expect(clipped?.message.length).toBe(300);
            expect(clipped?.message.endsWith('…')).toBe(true);
        });
        test('clipping never splits a surrogate pair', () => {
            const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
            for (const pad of ['', 'x']) {
                const r = validateRecordShape(NAME, `---\na: *${pad}${'😀'.repeat(300)}\n---\n${BODY}`);
                const d = r.diagnostics.find((x) => x.code === 'yaml-invalid');
                expect(d).toBeDefined();
                expect((d as { message: string }).message.length).toBeLessThanOrEqual(300);
                expect((d as { message: string }).message).not.toMatch(lone);
            }
        });
        test('escaping a hostile key never leaves a lone surrogate in message or field', () => {
            const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
            const keyed = (controls: number, pad: number) => `"${'\\u0001'.repeat(controls)}${'a'.repeat(pad)}😀bbbb": 1`;
            const run = (controls: number, pad: number) => {
                const r = validateRecordShape(NAME, doc(`${fm()}\n${keyed(controls, pad)}`));
                const unknown = r.diagnostics.filter((d) => d.code === 'unknown-field');
                expect(unknown).toHaveLength(1);
                expect(unknown[0].message).not.toMatch(lone);
                expect(unknown[0].field as string).not.toMatch(lone);
                expect(unknown[0].message.length).toBeLessThanOrEqual(300);
            };
            run(39, 5);
            for (let controls = 30; controls <= 44; controls++) for (let pad = 0; pad <= 7; pad++) run(controls, pad);
        });
        test('a short message is left unchanged', () => {
            const r = check({ rollback: 'rollback: ""' });
            expect(r.diagnostics).toContainEqual({ code: 'field-invalid', field: 'rollback', message: 'rollback must be a non-empty string without control characters' });
        });
        test('every diagnostic of a heavily hostile record is single-line', () => {
            const hostile = '"\\x1b\\n\\u2028\\u0085"';
            const r = check({
                title: `title: ${hostile}`, scope: `scope: ${hostile}`, type: `type: ${hostile}`,
                provenance: `provenance:\n  ${hostile}: 1\n  agent: ${hostile}`,
                verification: `verification:\n  commit: ${hostile}\n  overall: ${hostile}\n  sensors:\n    ${hostile}: ${hostile}\n  receipt_digest: ${hostile}\n  ${hostile}: 1`,
            });
            expect(r.diagnostics.length).toBeGreaterThan(5);
            for (const d of r.diagnostics) {
                expect(`${d.message}${d.field ?? ''}`).not.toMatch(UNSAFE);
            }
        });
    });
});
