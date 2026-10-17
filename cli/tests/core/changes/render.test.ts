import yaml from 'js-yaml';
import { expectLinearScaling } from './helpers';
import { loadFrontmatter, splitRecord } from '../../../src/core/changes/parse';
import { refreshDerived, renderSkeleton } from '../../../src/core/changes/render';
import { validateRecordShape } from '../../../src/core/changes/validate-shape';
import type { DerivedFields, Verification } from '../../../src/core/changes/types';

// Pure functions: no repository, no filesystem.
const frontmatter = (text: string): Record<string, unknown> => {
    const split = splitRecord(text);
    if (!split.ok) throw new Error('not a record');
    const loaded = loadFrontmatter(split.frontmatterText);
    if (!loaded.ok) throw new Error('bad yaml');
    return loaded.value as Record<string, unknown>;
};

describe('render: renderSkeleton', () => {
    const fields: DerivedFields = { type: 'feat', scope: null, semver: 'minor', breaking: false, modules: ['cli/src'] };
    const verification: Verification = { commit: 'a'.repeat(40), overall: 'pass', sensors: { lint: 'pass' }, receipt_digest: `sha256:${'b'.repeat(64)}` };
    test('renders frontmatter and the four body sections', () => {
        const text = renderSkeleton({ id: '2026-10-17-x', fields, verification }) as string;
        expect(text.startsWith('---\nschema: awm.change-record/v1\nid: 2026-10-17-x\n')).toBe(true);
        expect(validateRecordShape('2026-10-17-x.md', text).diagnostics.map((d) => d.code)).toEqual(['pending-content']);
    });
    test('hostile provenance and link values survive a YAML round trip as plain strings', () => {
        const nasty = 'a: b # c\n- d';
        const text = renderSkeleton({ id: '2026-10-17-x', fields, verification, provenance: { model: nasty, session: '&anchor *alias !!tag' }, links: { issue: 'https://e.com/?a=b#c' } });
        expect(text).not.toBeNull();
        const fm = frontmatter(text as string);
        expect(fm.provenance).toEqual({ model: nasty, session: '&anchor *alias !!tag' });
        expect(fm.links).toEqual({ issue: 'https://e.com/?a=b#c' });
        expect(Object.keys(fm)).toEqual(['schema', 'id', 'title', 'summary_short', 'type', 'scope', 'semver', 'breaking', 'modules', 'links', 'verification', 'manual_validation', 'risks', 'rollback', 'provenance']);
    });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    test.each<[string, () => string | null]>([
        ['a null input', () => renderSkeleton(null as never)],
        ['an undefined verification', () => renderSkeleton({ id: '2026-10-17-x', fields, verification: undefined as never })],
        ['a numeric id', () => renderSkeleton({ id: 5 as never, fields, verification })],
        ['a circular provenance', () => renderSkeleton({ id: '2026-10-17-x', fields, verification, provenance: circular as never })],
    ])('yields null for %s instead of throwing', (_name, call) => {
        expect(call()).toBeNull();
    });
});

describe('render: refreshDerived', () => {
    const FRESH: DerivedFields = { type: 'feat', scope: 'core', semver: 'minor', breaking: false, modules: ['cli/src/core'] };
    const FRESH_V: Verification = { commit: 'c'.repeat(40), overall: 'pass', sensors: { lint: 'pass' }, receipt_digest: `sha256:${'d'.repeat(64)}` };
    const OLD = [
        '---', 'schema: awm.change-record/v1', 'id: 2026-10-17-x', '# derived fields follow', 'type: fix', 'scope: null', 'semver: patch', 'breaking: false',
        'modules:', '- old/a', '- old/b', '# a comment after the list', '', 'links:', '  plan: docs/plans/p.md', 'verification:', `  commit: ${'0'.repeat(40)}`,
        '  overall: fail', '  sensors:', '    lint: fail', `  receipt_digest: sha256:${'0'.repeat(64)}`, 'title: Hello', '---', '', 'body text', '',
    ];
    const NEW_BLOCKS = [
        '---', 'schema: awm.change-record/v1', 'id: 2026-10-17-x', '# derived fields follow', 'type: feat', 'scope: core', 'semver: minor', 'breaking: false',
        'modules:', '  - cli/src/core', '# a comment after the list', '', 'links:', '  plan: docs/plans/p.md', 'verification:', `  commit: ${'c'.repeat(40)}`,
        '  overall: pass', '  sensors:', '    lint: pass', `  receipt_digest: sha256:${'d'.repeat(64)}`, 'title: Hello', '---', '', 'body text', '',
    ];
    const lf = (lines: string[]) => lines.join('\n');
    const crlf = (lines: string[]) => lines.join('\r\n');

    test('replaces exactly the derived blocks, keeping comments, blank lines, other keys and the body', () => {
        expect(refreshDerived(lf(OLD), FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS));
    });
    test('a column-0 list is replaced as one block and the key after it is untouched', () => {
        const old = ['---', 'type: fix', 'scope: x', 'semver: none', 'breaking: false', 'modules:', '- a', '- b', 'verification: {}', 'title: T', '---', 'b', ''];
        const out = refreshDerived(lf(old), FRESH, FRESH_V) as string;
        expect(out.endsWith('title: T\n---\nb\n')).toBe(true);
        expect(frontmatter(out).modules).toEqual(['cli/src/core']);
        expect(frontmatter(out).title).toBe('T');
    });
    test('CRLF files keep CRLF', () => {
        expect(refreshDerived(crlf(OLD), FRESH, FRESH_V)).toBe(crlf(NEW_BLOCKS));
    });
    test('mixed line endings keep each untouched line ending', () => {
        const old = OLD.map((l, i) => (i % 2 === 0 ? `${l}\r` : l));
        const out = refreshDerived(old.join('\n'), FRESH, FRESH_V) as string;
        expect(out.split('\n').find((l) => l.startsWith('title:'))).toBe(old.find((l) => l.startsWith('title:')));
        expect(out.endsWith(old.slice(-2).join('\n'))).toBe(true);
        expect(frontmatter(out).modules).toEqual(['cli/src/core']);
    });
    test('the body is preserved byte for byte, even when it looks like frontmatter', () => {
        const tail = '\n\n---\ntype: nope\n---\nmodules:\n- z\n';
        const out = refreshDerived(lf(OLD) + tail, FRESH, FRESH_V) as string;
        expect(out.endsWith(tail)).toBe(true);
    });
    test('trailing whitespace after the closing delimiter content and a missing final newline survive', () => {
        const out = refreshDerived(lf(OLD).replace(/\n$/, '') + '  ', FRESH, FRESH_V) as string;
        expect(out.endsWith('body text  ')).toBe(true);
    });
    test('a scalar with a trailing comment on the key line is replaced as a unit', () => {
        const old = lf(OLD).replace('type: fix', 'type: fix # why');
        expect(refreshDerived(old, FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS));
    });
    test('a null scope round-trips as null', () => {
        const out = refreshDerived(lf(OLD), { ...FRESH, scope: null }, FRESH_V) as string;
        expect(frontmatter(out).scope).toBeNull();
    });
    test('hostile sensor names and module names are quoted so they parse back unchanged', () => {
        const v: Verification = { ...FRESH_V, sensors: { 'a: b': 'pass', '# x': 'fail', 'yes': 'skipped', '-': 'pass' } };
        const out = refreshDerived(lf(OLD), { ...FRESH, modules: ['a b', 'c#d', '*x', 'y:z'] }, v) as string;
        expect(frontmatter(out).verification).toEqual(v);
        expect(frontmatter(out).modules).toEqual(['a b', 'c#d', '*x', 'y:z']);
        expect(strip2(out)).toBe(strip2(lf(NEW_BLOCKS)));
    });
    // The title/id/links/body lines, which a refresh never touches.
    const strip2 = (s: string) => s.split('\n').filter((l) => /^(schema|id|title|links|  plan|#|body)/.test(l)).join('\n');
    test.each([
        ['no frontmatter', 'type: fix\n'],
        ['unclosed frontmatter', '---\ntype: fix\n'],
        ['unparseable yaml', '---\n: : :\n---\n'],
        ['a missing derived key', lf(OLD).replace('semver: patch\n', '')],
        ['a missing verification', lf(OLD).replace(/^verification:[\s\S]*?(?=^title)/m, '')],
        ['a non-mapping frontmatter', '---\n- a\n- b\n---\n'],
        ['a duplicated key', lf(OLD).replace('title: Hello', 'type: fix\ntitle: Hello')],
        ['an anchor', lf(OLD).replace('title: Hello', 'title: &a Hello')],
        ['a key the line scan cannot recognise, right after a replaced block', lf(OLD).replace('title: Hello', 'odd key: 1\ntitle: Hello')],
        ['an escaped spelling of a derived key next to the bare one', lf(OLD).replace('title: Hello', '"\\u0074ype": x\ntitle: Hello')],
        ['an escaped spelling of a derived key instead of the bare one', lf(OLD).replace('type: fix\n', '"\\u0074ype": fix\n')],
        ['an empty string', ''],
    ])('returns null for %s', (_name, raw) => {
        expect(refreshDerived(raw, FRESH, FRESH_V)).toBeNull();
    });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    test.each<[string, () => string | null]>([
        ['raw text that is not a string', () => refreshDerived(undefined as never, FRESH, FRESH_V)],
        ['fields that are null', () => refreshDerived(lf(OLD), null as never, FRESH_V)],
        ['verification that is undefined', () => refreshDerived(lf(OLD), FRESH, undefined as never)],
        ['a derived field that is undefined', () => refreshDerived(lf(OLD), { ...FRESH, scope: undefined as never }, FRESH_V)],
        ['a circular verification', () => refreshDerived(lf(OLD), FRESH, circular as never)],
    ])('returns null for %s, never throws', (_name, call) => {
        expect(call()).toBeNull();
    });
    test('a block scalar after the derived keys is carried over byte for byte', () => {
        const raw = lf(OLD).replace('title: Hello', 'title: >\n  one\n  two\nrollback: kept');
        const out = refreshDerived(raw, FRESH, FRESH_V) as string;
        expect(frontmatter(out).title).toBe('one two\n');
        expect(frontmatter(out).rollback).toBe('kept');
        expect(out).toContain('title: >\n  one\n  two\nrollback: kept');
    });
    test('never alters a key that is not derived, whatever follows a replaced block', () => {
        const raw = lf(OLD).replace('breaking: false\n', 'breaking: false\nrisks:\n- r1\n- r2\n');
        const out = refreshDerived(raw, FRESH, FRESH_V) as string;
        expect(frontmatter(out).risks).toEqual(['r1', 'r2']);
        expect(out).toContain('risks:\n- r1\n- r2\n');
    });
    describe('recomputed keys written other than bare', () => {
        const SPELLINGS: Array<[string, (k: string) => string]> = [
            ['double-quoted', (k) => `"${k}":`],
            ['single-quoted', (k) => `'${k}':`],
            ['bare with a space before the colon', (k) => `${k} :`],
            ['bare with a tab before the colon', (k) => `${k}\t:`],
            ['double-quoted with spaces before the colon', (k) => `"${k}"  :`],
            ['single-quoted with a tab before the colon', (k) => `'${k}'\t:`],
        ];
        const spell = (lines: string[], key: string, fn: (k: string) => string) => lines.map((l) => (l.startsWith(`${key}:`) ? fn(key) + l.slice(key.length + 1) : l));
        const KEYS = ['type', 'scope', 'semver', 'breaking', 'modules', 'verification'];
        test.each(SPELLINGS.flatMap(([name, fn]) => KEYS.map((key) => [name, key, fn] as const)))('%s %s is recomputed like a bare key', (_name, key, fn) => {
            const old = spell(OLD, key, fn);
            expect(old).not.toEqual(OLD);
            expect(refreshDerived(lf(old), FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS));
        });
        test.each(SPELLINGS)('%s keys keep CRLF', (_name, fn) => {
            const old = KEYS.reduce((lines, key) => spell(lines, key, fn), OLD);
            expect(refreshDerived(crlf(old), FRESH, FRESH_V)).toBe(crlf(NEW_BLOCKS));
        });
        test('a spelled key is also found in the middle of a file next to other keys', () => {
            const old = lf(OLD).replace('title: Hello', '"title": Hello');
            expect(refreshDerived(old, FRESH, FRESH_V)).toBe(lf(NEW_BLOCKS).replace('title: Hello', '"title": Hello'));
        });
        test('a quoted key with an escaped quote is kept, never taken for a derived key', () => {
            const line = '"sem\\"ver": 1';
            const out = refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V) as string;
            expect(out).toBe(lf(NEW_BLOCKS).replace('title: Hello', `${line}\ntitle: Hello`));
            expect(frontmatter(out)['sem"ver']).toBe(1);
        });
        test('a single-quoted key with a doubled quote is kept, never taken for a derived key', () => {
            const line = "'it''s': 1";
            const out = refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V) as string;
            expect(out).toBe(lf(NEW_BLOCKS).replace('title: Hello', `${line}\ntitle: Hello`));
            expect(frontmatter(out)["it's"]).toBe(1);
        });
        test('a quoted key that merely contains a derived name is not recomputed', () => {
            const line = '"type extra": 1';
            const out = refreshDerived(lf(OLD).replace('title: Hello', `${line}\ntitle: Hello`), FRESH, FRESH_V) as string;
            expect(out).toContain(`${line}\ntitle: Hello`);
        });
        test('a hostile very long quoted line is scanned in linear time', () => {
            const hostile = (n: number): string => lf(OLD).replace('title: Hello', `"${'\\'.repeat(n)}\ntitle: Hello`);
            expect(refreshDerived(hostile(200000), FRESH, FRESH_V)).toBeNull();
            expectLinearScaling((n) => { refreshDerived(hostile(n), FRESH, FRESH_V); }, 50_000);
        });
    });
    test('the dumped blocks use the core schema (what the validator parses)', () => {
        const out = refreshDerived(lf(OLD), { ...FRESH, scope: 'null' }, FRESH_V) as string;
        expect(out).toContain("scope: 'null'");
        expect(yaml.load(out.split('\n---')[0].slice(4), { schema: yaml.CORE_SCHEMA })).toMatchObject({ scope: 'null' });
    });
});

