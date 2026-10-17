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
const codes = (r: ReturnType<typeof validateRecordShape>) => r.diagnostics.map((d) => d.code);

describe('validateRecordShape', () => {
    test('accepts a complete valid record', () => {
        const r = validateRecordShape(NAME, doc(fm()));
        expect(r.diagnostics).toEqual([]);
        expect(r.record?.semver).toBe('minor');
    });
    test('R1.1 rejects bad file names and slugs', () => {
        expect(codes(validateRecordShape('2026-10-17-Bad_Slug.md', doc(fm())))).toContain('name-invalid');
        expect(codes(validateRecordShape('2026-13-40-x.md', doc(fm({ id: 'id: 2026-13-40-x' }))))).toContain('name-invalid');
        expect(codes(validateRecordShape(`2026-10-17-${'a'.repeat(65)}.md`, doc(fm())))).toContain('name-invalid');
    });
    test('R1.2 requires frontmatter and rejects aliases and custom tags', () => {
        expect(codes(validateRecordShape(NAME, BODY))).toContain('frontmatter-missing');
        expect(codes(validateRecordShape(NAME, doc(fm({ risks: 'risks: &r ["x"]', rollback: 'rollback: *r' }))))).toContain('yaml-alias');
        expect(codes(validateRecordShape(NAME, doc(fm({ rollback: 'rollback: !!js/function "f"' }))))).toContain('yaml-invalid');
    });
    test('R1.2 rejects every anchor and alias, including scalar and unused ones', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ title: 'title: &a T', rollback: 'rollback: *a' }))))).toContain('yaml-alias');
        expect(codes(validateRecordShape(NAME, doc(fm({ rollback: 'rollback: &a r' }))))).toContain('yaml-alias');
        expect(codes(validateRecordShape(NAME, doc(fm({ risks: 'risks:\n  - &r x\n  - *r' }))))).toContain('yaml-alias');
        expect(codes(validateRecordShape(NAME, doc(fm({ modules: 'modules: &m\n  - cli/src/core' }))))).toContain('yaml-alias');
        expect(codes(validateRecordShape(NAME, doc(fm({ risks: 'risks:\n  - &r x' }))))).toContain('yaml-alias');
    });
    test('R1.2 accepts quoted text that merely looks like an anchor or alias', () => {
        const r = validateRecordShape(NAME, doc(fm({ summary_short: 'summary_short: "uses *a and &b"', rollback: "rollback: 'revert &a *b'" })));
        expect(r.diagnostics).toEqual([]);
    });
    test('R1.3 rejects unknown fields at every level', () => {
        const r = validateRecordShape(NAME, doc(fm({ extra: 'status: merged' })));
        expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-field', field: 'status' }));
        const nested = validateRecordShape(NAME, doc(fm({ links: 'links:\n  pr: "https://x"' })));
        expect(nested.diagnostics).toContainEqual(expect.objectContaining({ code: 'unknown-field', field: 'links.pr' }));
    });
    test('R1.4 enforces field rules', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ id: 'id: other' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ summary_short: `summary_short: "${'x'.repeat(281)}"` }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ semver: 'semver: huge' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ modules: 'modules:\n  - b\n  - a' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ links: 'links:\n  issue: "http://insecure"' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ manual_validation: 'manual_validation: []' }))))).toContain('field-invalid');
        expect(validateRecordShape(NAME, doc(fm({ manual_validation: 'manual_validation:\n  none: "docs only"' }))).diagnostics).toEqual([]);
        expect(codes(validateRecordShape(NAME, doc(fm({ provenance: 'provenance:\n  started_at: "2026-10-17 10:00"' }))))).toContain('field-invalid');
    });
    test('R1.4 rejects every line-break character in summary_short', () => {
        for (const ch of ['\\u0085', '\\u2028', '\\u2029']) {
            expect(codes(validateRecordShape(NAME, doc(fm({ summary_short: `summary_short: "a${ch}b"` }))))).toContain('field-invalid');
        }
        expect(validateRecordShape(NAME, doc(fm({ summary_short: 'summary_short: "plain one-line summary"' }))).diagnostics).toEqual([]);
    });
    test('R1.4 checks links.plan existence when a root is given', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-'));
        try {
            const r = validateRecordShape(NAME, doc(fm({ links: 'links:\n  plan: docs/plans/missing.md' })), { root });
            expect(codes(r)).toContain('field-invalid');
            const escape = validateRecordShape(NAME, doc(fm({ links: 'links:\n  plan: ../outside.md' })), { root });
            expect(codes(escape)).toContain('field-invalid');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    test('R1.5 enforces the verification block', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ verification: 'verification:\n  commit: abc\n  overall: pass\n  sensors: {}\n  receipt_digest: x' }))))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, doc(fm({ verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n    lint: green\n  receipt_digest: ${DIGEST}` }))))).toContain('field-invalid');
    });
    test('R1.5 accepts free-form sensor names and rejects empty, long or control-character names', () => {
        const withSensors = (sensors: string) => doc(fm({ verification: `verification:\n  commit: ${SHA}\n  overall: pass\n  sensors:\n${sensors}\n  receipt_digest: ${DIGEST}` }));
        expect(validateRecordShape(NAME, withSensors('    "lint:ts": pass\n    "type check": skipped')).diagnostics).toEqual([]);
        expect(codes(validateRecordShape(NAME, withSensors('    "": pass')))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, withSensors(`    "${'a'.repeat(129)}": pass`)))).toContain('field-invalid');
        expect(validateRecordShape(NAME, withSensors(`    "${'a'.repeat(128)}": pass`)).diagnostics).toEqual([]);
        expect(codes(validateRecordShape(NAME, withSensors('    "a\\nb": pass')))).toContain('field-invalid');
        expect(codes(validateRecordShape(NAME, withSensors('    "a\\x07b": pass')))).toContain('field-invalid');
    });
    test('R1.6 requires the four body sections in order with content', () => {
        expect(codes(validateRecordShape(NAME, doc(fm(), '## Qué se hizo\nA\n')))).toContain('body-section-missing');
        const swapped = '## Qué se probó\nB\n## Qué se hizo\nA\n## Qué falta validar\nC\n## Riesgos y rollback\nD\n';
        expect(codes(validateRecordShape(NAME, doc(fm(), swapped)))).toContain('body-section-missing');
        const empty = BODY.replace('B\n', '\n');
        expect(codes(validateRecordShape(NAME, doc(fm(), empty)))).toContain('body-section-missing');
    });
    test('R1.7 rejects pending markers', () => {
        expect(codes(validateRecordShape(NAME, doc(fm({ rollback: `rollback: "${PENDING_MARKER}"` }))))).toContain('pending-content');
        expect(codes(validateRecordShape(NAME, doc(fm(), BODY.replace('A', PENDING_MARKER))))).toContain('pending-content');
    });
    test('R1.7 rejects a pending marker that only appears after YAML unescaping', () => {
        const escaped = '\\x3c!-- awm:pending -->';
        expect(codes(validateRecordShape(NAME, doc(fm({ rollback: `rollback: "${escaped}"` }))))).toContain('pending-content');
        expect(codes(validateRecordShape(NAME, doc(fm({ risks: `risks:\n  - "ok"\n  - "see ${escaped}"` }))))).toContain('pending-content');
        expect(codes(validateRecordShape(NAME, doc(fm({ manual_validation: `manual_validation:\n  - step: "${escaped}"\n    expected: "x"` }))))).toContain('pending-content');
    });
    test('R1.8 rejects oversize files before parsing', () => {
        const big = doc(fm()) + 'x'.repeat(MAX_RECORD_BYTES);
        expect(codes(validateRecordShape(NAME, big))).toEqual(['record-too-large']);
    });
    test('accepts CRLF line endings', () => {
        expect(validateRecordShape(NAME, doc(fm()).replace(/\n/g, '\r\n')).diagnostics).toEqual([]);
    });
});
