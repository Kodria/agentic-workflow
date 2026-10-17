import { isRecordPath, isValidSlug, isValidRecordFileName, loadFrontmatter, splitRecord } from '../../../src/core/changes/parse';

describe('isValidSlug', () => {
    test.each(['a', 'a1', 'a-b-1', '1-2', 'a'.repeat(64)])('accepts %s', (slug) => {
        expect(isValidSlug(slug)).toBe(true);
    });
    test.each(['', 'A', 'a_b', 'a--b', '-a', 'a-', 'a b', 'a/b', 'á', 'a'.repeat(65)])('rejects %j', (slug) => {
        expect(isValidSlug(slug)).toBe(false);
    });
    test.each([undefined, null, 7, {}, ['a']])('rejects the non-string %j', (slug) => {
        expect(isValidSlug(slug)).toBe(false);
    });
});

describe('isValidRecordFileName', () => {
    test('accepts date + slug + .md', () => {
        expect(isValidRecordFileName('2026-10-17-change-record.md')).toBe(true);
    });
    test.each(['2026-10-17-x.txt', '2026-02-30-x.md', 'x.md', '2026-10-17-.md', '2026-10-17-X.md'])('rejects %s', (name) => {
        expect(isValidRecordFileName(name)).toBe(false);
    });
});

describe('splitRecord', () => {
    test('splits frontmatter from body', () => {
        expect(splitRecord('---\na: 1\n---\nbody\n')).toEqual({ ok: true, frontmatterText: 'a: 1', body: 'body\n' });
    });
    test('normalizes CRLF', () => {
        expect(splitRecord('---\r\na: 1\r\n---\r\nbody\r\n')).toEqual({ ok: true, frontmatterText: 'a: 1', body: 'body\n' });
    });
    test('an empty frontmatter block yields empty text', () => {
        expect(splitRecord('---\n---\nbody')).toEqual({ ok: true, frontmatterText: '', body: 'body' });
    });
    test.each([['empty input', ''], ['no leading delimiter', 'a: 1\n---\nbody'], ['leading blank line', '\n---\na: 1\n---\nbody']])('%s is frontmatter-missing', (_l, raw) => {
        const r = splitRecord(raw);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.diagnostic.code).toBe('frontmatter-missing');
    });
    test('an unclosed frontmatter block is frontmatter-missing', () => {
        const r = splitRecord('---\na: 1\nbody');
        expect(r.ok).toBe(false);
        expect(!r.ok && r.diagnostic.code).toBe('frontmatter-missing');
    });
    test('only the first closing delimiter ends the frontmatter', () => {
        const r = splitRecord('---\na: 1\n---\nx\n---\ny\n');
        expect(r).toEqual({ ok: true, frontmatterText: 'a: 1', body: 'x\n---\ny\n' });
    });
});

describe('loadFrontmatter', () => {
    test('parses a mapping and keeps timestamps as strings', () => {
        expect(loadFrontmatter('a: 1\nd: 2026-10-17\nt: 2026-10-17T10:00:00Z')).toEqual({ ok: true, value: { a: 1, d: '2026-10-17', t: '2026-10-17T10:00:00Z' } });
    });
    test('empty text loads as undefined and comment-only text as null (both are not mappings)', () => {
        expect(loadFrontmatter('')).toEqual({ ok: true, value: undefined });
        expect(loadFrontmatter('# only a comment')).toEqual({ ok: true, value: null });
    });
    test('more than one document is yaml-invalid', () => {
        const r = loadFrontmatter('a: 1\n---\nb: 2');
        expect(!r.ok && r.diagnostic.code).toBe('yaml-invalid');
    });
    test('custom tags are yaml-invalid', () => {
        const r = loadFrontmatter('a: !!js/function "f"');
        expect(!r.ok && r.diagnostic.code).toBe('yaml-invalid');
    });
    test('duplicate keys are yaml-invalid', () => {
        const r = loadFrontmatter('a: 1\na: 2');
        expect(!r.ok && r.diagnostic.code).toBe('yaml-invalid');
    });
    test('merge keys are not expanded (CORE_SCHEMA)', () => {
        expect(loadFrontmatter('a: 1\n<<: {b: 2}')).toEqual({ ok: true, value: { a: 1, '<<': { b: 2 } } });
    });
    test('the yaml-invalid reason is JSON-escaped and single-line', () => {
        const r = loadFrontmatter('a: *x"\\y');
        expect(r.ok).toBe(false);
        const d = !r.ok ? r.diagnostic : undefined;
        expect(d?.code).toBe('yaml-invalid');
        expect(d?.message.startsWith('frontmatter is not valid YAML:')).toBe(true);
        expect(d?.message).toContain('alias \\"x\\"\\\\y\\"');
        expect(d?.message).not.toContain('alias "x"\\y"');
        expect(d?.message).not.toMatch(/[\n\r]/);
    });
    test('an alias without an anchor is yaml-invalid', () => {
        const r = loadFrontmatter('a: *x');
        expect(!r.ok && r.diagnostic.code).toBe('yaml-invalid');
    });

    // Pins the js-yaml listener contract (`state.anchor` on `close`). If a js-yaml upgrade changes it, these fail loudly
    // instead of silently allowing anchors.
    describe('anchor detection (js-yaml listener contract)', () => {
        test.each([
            ['a scalar anchor', 'a: &x 1'],
            ['an unused anchor', 'a: &x 1\nb: 2'],
            ['a collection anchor', 'a: &x [1, 2]'],
            ['a mapping anchor', 'a: &x\n  b: 1'],
            ['a key anchor', '&k a: 1'],
            ['an anchor and its alias', 'a: &x 1\nb: *x'],
            ['an anchored top-level mapping', '&top\na: 1'],
            ['an empty anchored node', 'a: &x'],
        ])('%s is yaml-alias', (_label, text) => {
            const r = loadFrontmatter(text);
            expect(!r.ok && r.diagnostic.code).toBe('yaml-alias');
        });
        test.each([['double-quoted', 'a: "&x *x"'], ['single-quoted', "a: '&x *x'"], ['block scalar', 'a: |\n  &x *x'], ['inside a word', 'a: x&y']])('%s look-alike text is accepted', (_label, text) => {
            expect(loadFrontmatter(text).ok).toBe(true);
        });
    });
});

describe('exported helpers never throw on non-string input', () => {
    const hostile: Array<[string, unknown]> = [['undefined', undefined], ['null', null], ['a number', 42], ['an object', {}], ['a Buffer', Buffer.from('---\na: 1\n---\nb')], ['an array', []]];
    test.each(hostile)('splitRecord(%s) is input-invalid', (_label, value) => {
        let r: ReturnType<typeof splitRecord> | undefined;
        expect(() => { r = splitRecord(value as string); }).not.toThrow();
        expect(r && !r.ok && r.diagnostic.code).toBe('input-invalid');
    });
    test.each(hostile)('loadFrontmatter(%s) is input-invalid', (_label, value) => {
        let r: ReturnType<typeof loadFrontmatter> | undefined;
        expect(() => { r = loadFrontmatter(value as string); }).not.toThrow();
        expect(r && !r.ok && r.diagnostic.code).toBe('input-invalid');
    });
    test.each([['an array', ['2026-10-17-x.md']], ['a number', 20261017], ['null', null], ['undefined', undefined], ['an object', { toString: () => '2026-10-17-x.md' }]])('isValidRecordFileName(%s) is false', (_label, value) => {
        expect(isValidRecordFileName(value as string)).toBe(false);
    });
    test('loadFrontmatter bounds the message of a huge YAML error', () => {
        const r = loadFrontmatter(`a: *${'x'.repeat(60000)}`);
        expect(!r.ok && r.diagnostic.code).toBe('yaml-invalid');
        expect(!r.ok && r.diagnostic.message.length).toBeLessThanOrEqual(300);
    });
    test('loadFrontmatter keeps a surrogate pair whole when it clips', () => {
        for (const pad of ['', 'x']) {
            const r = loadFrontmatter(`a: *${pad}${'😀'.repeat(300)}`);
            const message = !r.ok ? r.diagnostic.message : '';
            expect(message.length).toBeLessThanOrEqual(300);
            expect(message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
        }
    });
});

describe('isRecordPath (the one copy, used by change validate and changes list)', () => {
    test.each(['docs/changes/2026-10-17-rec.md', 'docs/changes/2026-10-17-a-b-c.md'])('accepts %s', (rel) => expect(isRecordPath(rel)).toBe(true));
    test.each(['docs/changes/sub/2026-10-17-rec.md', 'docs/changes', 'docs/changes/notes.md', 'docs/changes/2026-10-17-Rec.md', 'other/2026-10-17-rec.md', '/docs/changes/2026-10-17-rec.md', '', 'docs/changes/2026-10-17-rec.md/x'])('rejects %j', (rel) => expect(isRecordPath(rel)).toBe(false));
    test('never throws on non-string input', () => {
        for (const v of [undefined, null, 5, {}]) expect(isRecordPath(v as never)).toBe(false);
    });
});
