import { bad } from './helpers';
import { renderJson, renderText, renderVoice } from '../../../src/core/changes/render-list';
import type { ListedChange, ListedRecord, ListResult } from '../../../src/core/changes/list';

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

const change = (o: Partial<ListedChange> = {}): ListedChange => ({
    sha: 'abcdef0123456789abcdef0123456789abcdef01', subject: 'feat: x', classification: 'missing', merged_at: '2026-10-16T20:00:00.000Z', pr: null, release: null, records: [], ...o,
});
const result = (o: Partial<ListResult> = {}): ListResult => ({
    repo: 'github.com/Kodria/belanz', base: 'main', since: '2026-10-15T12:00:00.000Z', adopted: true, truncated: false, omitted: 0, changes: [], ...o,
});
const rec = (o: Record<string, unknown> = {}): ListedRecord => ({
    path: 'docs/changes/2026-10-16-first.md', schema: 'awm.change-record/v1', id: '2026-10-16-first', title: 'Primer', summary_short: 'Primer cambio.', type: 'feat',
    scope: null, semver: 'minor', breaking: false, modules: ['cli'], verification: { commit: 'a'.repeat(40), overall: 'pass', sensors: { lint: 'pass' }, receipt_digest: `sha256:${'b'.repeat(64)}` },
    manual_validation: [{ step: 's1', expected: 'e1' }, { step: 's2', expected: 'e2' }], risks: [], rollback: 'revert', ...o,
} as unknown as ListedRecord);
const recorded = (o: Record<string, unknown> = {}, c: Partial<ListedChange> = {}): ListedChange => change({ classification: 'recorded', records: [rec(o)], ...c });
const lines = (text: string): string[] => text.split('\n').slice(0, -1);

describe('renderJson (R5.6)', () => {
    test('is one line ending in a newline', () => {
        const out = renderJson(result({ changes: [recorded()] }));
        expect(out.endsWith('\n')).toBe(true);
        expect(lines(out)).toHaveLength(1);
    });
    test('has exactly the documented keys, in order', () => {
        expect(Object.keys(JSON.parse(renderJson(result())))).toEqual(['schema', 'repo', 'base', 'since', 'adopted', 'truncated', 'omitted', 'changes']);
        expect(JSON.parse(renderJson(result())).schema).toBe('awm.changes-list/v1');
    });
    test('each change has exactly the documented keys, in order', () => {
        const out = JSON.parse(renderJson(result({ changes: [change()] })));
        expect(Object.keys(out.changes[0])).toEqual(['sha', 'subject', 'classification', 'merged_at', 'pr', 'release', 'records']);
    });
    test('carries the values through', () => {
        const out = JSON.parse(renderJson(result({ truncated: true, omitted: 4, changes: [change({ pr: 10, release: 'v1.0.0', classification: 'exempt' })] })));
        expect(out).toMatchObject({ repo: 'github.com/Kodria/belanz', base: 'main', since: '2026-10-15T12:00:00.000Z', truncated: true, omitted: 4 });
        expect(out.changes[0]).toMatchObject({ classification: 'exempt', merged_at: '2026-10-16T20:00:00.000Z', pr: 10, release: 'v1.0.0', records: [] });
    });
    test('a recorded entry holds the path and the full frontmatter', () => {
        const out = JSON.parse(renderJson(result({ changes: [recorded()] })));
        expect(out.changes[0].records[0]).toMatchObject({ path: 'docs/changes/2026-10-16-first.md', summary_short: 'Primer cambio.', verification: { overall: 'pass' } });
    });
    test('an invalid-record entry holds the path and the diagnostics', () => {
        const diagnostics = [{ code: 'name-invalid', message: 'm' }];
        const out = JSON.parse(renderJson(result({ changes: [change({ classification: 'invalid-record', records: [{ path: 'docs/changes/x.md', diagnostics }] })] })));
        expect(out.changes[0].records).toEqual([{ path: 'docs/changes/x.md', diagnostics }]);
    });
    test('a repository that has not adopted records is still a valid document with no changes', () => {
        const out = JSON.parse(renderJson(result({ adopted: false })));
        expect(out).toMatchObject({ adopted: false, changes: [], truncated: false, omitted: 0 });
    });
    test('an adopted repository says so, with or without changes', () => {
        expect(JSON.parse(renderJson(result())).adopted).toBe(true);
        expect(JSON.parse(renderJson(result({ changes: [change()] }))).adopted).toBe(true);
    });
    test('a change whose date is unusable keeps merged_at null', () => {
        expect(JSON.parse(renderJson(result({ changes: [change({ merged_at: null })] }))).changes[0].merged_at).toBeNull();
    });
    test('an invalid-record entry lists every added record, the valid ones with empty diagnostics', () => {
        const records = [{ path: 'docs/changes/a.md', diagnostics: [] }, { path: 'docs/changes/z.md', diagnostics: [{ code: 'name-invalid', message: 'm' }] }];
        expect(JSON.parse(renderJson(result({ changes: [change({ classification: 'invalid-record', records })] }))).changes[0].records).toEqual(records);
    });
    test('a null repo stays null', () => {
        expect(JSON.parse(renderJson(result({ repo: null }))).repo).toBeNull();
    });
    test.each([undefined, null, 5, 'x', [], {}, { changes: 'x' }])('an unusable result %j yields an error document, not a throw', (value) => {
        const out = renderJson(bad(value));
        expect(lines(out)).toHaveLength(1);
        expect(JSON.parse(out)).toEqual({ error: 'invalid-input' });
    });
});

describe('renderText (R5.6)', () => {
    test('a repository without records says so in one line, naming the repo and the base', () => {
        expect(renderText(result({ adopted: false }), 'fallback')).toBe('belanz has not adopted Change Records (no file under docs/changes/ on main).\n');
    });
    test('without a remote the fallback name is used', () => {
        expect(renderText(result({ adopted: false, repo: null }), 'my-dir')).toBe('my-dir has not adopted Change Records (no file under docs/changes/ on main).\n');
    });
    test('an empty window says so', () => {
        expect(renderText(result(), 'f')).toBe('No changes on main since 2026-10-15T12:00:00.000Z.\n');
    });
    test('has a header and one row per change', () => {
        const out = lines(renderText(result({ changes: [recorded({}, { pr: 10, release: 'v1.0.0' }), change({ subject: 'fix: no record' })] }), 'f'));
        expect(out).toHaveLength(3);
        expect(out[0]).toMatch(/^WHEN\s+CLASSIFICATION\s+SHA\s+PR\s+CHANGE/);
    });
    test('a row has the time, classification, short sha, PR, title and release', () => {
        const out = lines(renderText(result({ changes: [recorded({}, { pr: 10, release: 'v1.0.0' })] }), 'f'))[1];
        expect(out).toBe('2026-10-16 20:00  recorded        abcdef01  #10     Primer  [v1.0.0]');
    });
    test('a change without a record shows its subject; a missing PR and release show a dash and nothing', () => {
        const out = lines(renderText(result({ changes: [change({ subject: 'fix: no record' })] }), 'f'))[1];
        expect(out).toBe('2026-10-16 20:00  missing         abcdef01  -       fix: no record');
    });
    test('an invalid record shows the code of its first diagnostic', () => {
        const entry = change({ classification: 'invalid-record', subject: 'feat: bad', records: [{ path: 'docs/changes/x.md', diagnostics: [{ code: 'name-invalid', message: 'm' }, { code: 'other', message: 'm' }] }] });
        expect(lines(renderText(result({ changes: [entry] }), 'f'))[1]).toBe('2026-10-16 20:00  invalid-record  abcdef01  -       feat: bad  (name-invalid)');
    });
    test('a mixed invalid-record commit shows the first FAILING record, not the first record', () => {
        const entry = change({ classification: 'invalid-record', subject: 'feat: mixed', records: [{ path: 'docs/changes/a.md', diagnostics: [] }, { path: 'docs/changes/z.md', diagnostics: [{ code: 'name-invalid', message: 'm' }, { code: 'other', message: 'm' }] }] });
        expect(lines(renderText(result({ changes: [entry] }), 'f'))[1]).toBe('2026-10-16 20:00  invalid-record  abcdef01  -       feat: mixed  (name-invalid)');
    });
    test('a change whose date is unusable shows unknown in place of the time', () => {
        expect(lines(renderText(result({ changes: [change({ merged_at: null })] }), 'f'))[1]).toBe('unknown           missing         abcdef01  -       feat: x');
    });
    test('a truncated list ends with a notice naming how many were left out', () => {
        const out = lines(renderText(result({ truncated: true, omitted: 7, changes: [change()] }), 'f'));
        expect(out[out.length - 1]).toBe('... 7 older change(s) not shown; narrow --since to see them.');
    });
    test('a list that is not truncated has no notice', () => {
        expect(renderText(result({ changes: [change()] }), 'f')).not.toMatch(/not shown/);
    });
    test('hostile text in every field stays on its own clean, bounded line', () => {
        const hostile = `\u001b[31mred\u001b[0m\nsecond \u202eevil\u2028${'x'.repeat(1000)}`;
        const entry = recorded({ title: hostile }, { release: hostile, pr: 3 });
        const out = renderText(result({ base: hostile, repo: hostile, changes: [entry, change({ subject: hostile, classification: 'invalid-record', records: [{ path: hostile, diagnostics: [{ code: hostile, message: hostile }] }] })] }), hostile);
        for (const line of lines(out)) { expect(line).not.toMatch(UNSAFE); expect(line.length).toBeLessThanOrEqual(300); }
        expect(lines(out)).toHaveLength(3);
        expect(lines(renderText(result({ adopted: false, base: hostile, repo: hostile }), hostile))).toHaveLength(1);
        expect(lines(renderText(result({ base: hostile }), hostile))).toHaveLength(1);
        for (const line of lines(renderText(result({ adopted: false, base: hostile, repo: hostile }), hostile))) { expect(line).not.toMatch(UNSAFE); expect(line.length).toBeLessThanOrEqual(300); }
    });
    test.each([undefined, null, 5, 'x', [], {}, { changes: 'x' }])('an unusable result %j yields one line, not a throw', (value) => {
        expect(lines(renderText(bad(value), 'f'))).toHaveLength(1);
    });
    test('an unusable fallback name does not throw', () => {
        expect(lines(renderText(result({ adopted: false, repo: null }), bad(undefined)))).toHaveLength(1);
    });
});

describe('renderVoice (R5.6)', () => {
    test('one sentence per recorded change, then the closing count', () => {
        const out = renderVoice(result({ changes: [recorded(), change({ subject: 'fix: no record' }), change({ classification: 'invalid-record' })] }), 'f');
        expect(lines(out)).toEqual([
            'belanz: Primer cambio. feat, verificado, 2 validaciones manuales pendientes.',
            'Además: 1 cambio(s) sin record y 1 con record inválido.',
        ]);
    });
    test('the closing count is always given when there are changes', () => {
        expect(lines(renderVoice(result({ changes: [recorded()] }), 'f'))[1]).toBe('Además: 0 cambio(s) sin record y 0 con record inválido.');
    });
    test.each(['fail', 'skipped', 'not_certified'])('overall %s is sin verificar', (overall) => {
        const out = renderVoice(result({ changes: [recorded({ verification: { overall } })] }), 'f');
        expect(lines(out)[0]).toBe('belanz: Primer cambio. feat, sin verificar, 2 validaciones manuales pendientes.');
    });
    test('a record with no manual validation reports zero pending', () => {
        const out = renderVoice(result({ changes: [recorded({ manual_validation: { none: 'nothing to check' } })] }), 'f');
        expect(lines(out)[0]).toBe('belanz: Primer cambio. feat, verificado, 0 validaciones manuales pendientes.');
    });
    test('one pending validation is reported with the same wording', () => {
        const out = renderVoice(result({ changes: [recorded({ manual_validation: [{ step: 'a', expected: 'b' }] })] }), 'f');
        expect(lines(out)[0]).toContain('1 validaciones manuales pendientes.');
    });
    test.each([
        ['Primer cambio.', 'Primer cambio.'],
        ['Primer cambio', 'Primer cambio.'],
        ['Funciona!', 'Funciona!'],
        ['¿Funciona?', '¿Funciona?'],
    ])('the summary %j is spoken as %j followed by the type', (summary, spoken) => {
        const out = renderVoice(result({ changes: [recorded({ summary_short: summary, type: 'fix' })] }), 'f');
        expect(lines(out)[0]).toBe(`belanz: ${spoken} fix, verificado, 2 validaciones manuales pendientes.`);
    });
    test('a mixed invalid-record commit is counted, not spoken', () => {
        const entry = change({ classification: 'invalid-record', records: [{ path: 'docs/changes/a.md', diagnostics: [] }, { path: 'docs/changes/z.md', diagnostics: [{ code: 'x', message: 'm' }] }] });
        expect(lines(renderVoice(result({ changes: [entry] }), 'f'))).toEqual(['Además: 0 cambio(s) sin record y 1 con record inválido.']);
    });
    test('a change whose date is unusable is spoken like any other', () => {
        expect(lines(renderVoice(result({ changes: [recorded({}, { merged_at: null })] }), 'f'))[0]).toBe('belanz: Primer cambio. feat, verificado, 2 validaciones manuales pendientes.');
    });
    test('only recorded changes get a sentence; exempt ones are silent', () => {
        const out = renderVoice(result({ changes: [change({ classification: 'exempt' }), recorded()] }), 'f');
        expect(lines(out)).toHaveLength(2);
    });
    test('a change with two records gets one sentence for each', () => {
        const entry = change({ classification: 'recorded', records: [rec({ summary_short: 'Uno.' }), rec({ summary_short: 'Dos.' })] });
        const out = lines(renderVoice(result({ changes: [entry] }), 'f'));
        expect(out.slice(0, 2).map((l) => l.split(' ')[1])).toEqual(['Uno.', 'Dos.']);
    });
    test('the name falls back to the directory name without a remote', () => {
        expect(lines(renderVoice(result({ repo: null, changes: [recorded()] }), 'my-dir'))[0].startsWith('my-dir: ')).toBe(true);
    });
    test('a repository without records is told in one sentence', () => {
        expect(renderVoice(result({ adopted: false }), 'f')).toBe('belanz: todavía no usa Change Records.\n');
    });
    test('an empty window is told in one sentence', () => {
        expect(renderVoice(result(), 'f')).toBe('belanz: sin cambios desde 2026-10-15.\n');
    });
    test('a truncated list ends with a notice', () => {
        const out = lines(renderVoice(result({ truncated: true, omitted: 3, changes: [recorded()] }), 'f'));
        expect(out[out.length - 1]).toBe('Hay 3 cambio(s) más antiguo(s) sin mostrar; acota el período.');
    });
    test('a list that is not truncated has no notice', () => {
        expect(renderVoice(result({ changes: [recorded()] }), 'f')).not.toMatch(/acota/);
    });
    test('hostile text stays on clean, bounded lines', () => {
        const hostile = `\u001b[31mred\u001b[0m\nsecond \u202eevil\u2028${'x'.repeat(1000)}`;
        const out = renderVoice(result({ repo: hostile, changes: [recorded({ summary_short: hostile, type: hostile })] }), hostile);
        expect(lines(out)).toHaveLength(2);
        for (const line of lines(out)) { expect(line).not.toMatch(UNSAFE); expect(line.length).toBeLessThanOrEqual(600); }
        expect(lines(renderVoice(result({ adopted: false, repo: hostile }), hostile))).toHaveLength(1);
    });
    test.each([undefined, null, 5, 'x', [], {}, { changes: 'x' }])('an unusable result %j yields one line, not a throw', (value) => {
        expect(lines(renderVoice(bad(value), 'f'))).toHaveLength(1);
    });
});
