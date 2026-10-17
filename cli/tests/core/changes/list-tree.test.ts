// The pure parser of `git ls-tree -l -z` used by `changes list` (R5.1, R5.7). No repository: the output of git is a string.
import { parseTreeEntries } from '../../../src/core/changes/list';

const OID = 'a'.repeat(40);
const OID256 = 'b'.repeat(64);
const row = (mode: string, type: string, oid: string, size: string, name: string): string => `${mode} ${type} ${oid} ${size.padStart(7)}\t${name}`;
const parse = (...rows: string[]) => parseTreeEntries(rows.join('\0') + '\0');

describe('parseTreeEntries (R5.7)', () => {
    test('a regular blob keeps its mode, object id and numeric size', () => {
        expect(parse(row('100644', 'blob', OID, '123', 'docs/changes/a.md')).get('docs/changes/a.md')).toEqual({ mode: '100644', type: 'blob', oid: OID, size: 123 });
    });
    test('a 64-hex (SHA-256) object id is accepted', () => {
        expect(parse(row('100755', 'blob', OID256, '5', 'x')).get('x')).toEqual({ mode: '100755', type: 'blob', oid: OID256, size: 5 });
    });
    test('a blob whose size is "BAD" (the object is not there: a partial clone with lazy fetch off, git 2.55) is unreadable: negative size, still a blob', () => {
        expect(parse(row('100644', 'blob', OID, 'BAD', 'docs/changes/a.md')).get('docs/changes/a.md')).toEqual({ mode: '100644', type: 'blob', oid: OID, size: -1 });
    });
    test('a blob whose size is "-" is unreadable as well (no valid blob shows it)', () => {
        expect(parse(row('100644', 'blob', OID, '-', 'x')).get('x')).toEqual({ mode: '100644', type: 'blob', oid: OID, size: -1 });
    });
    test('"BAD" on something that is not a blob stays "unknown" (it is not a missing record)', () => {
        expect(parse(row('040000', 'tree', OID, 'BAD', 'x')).get('x')).toMatchObject({ type: 'unknown', size: 0 });
    });
    test('a gitlink (submodule) shows "-" too, but it is not a blob: it stays "unknown", never unreadable', () => {
        expect(parse(row('160000', 'commit', OID, '-', 'docs/changes/a.md')).get('docs/changes/a.md')).toEqual({ mode: '160000', type: 'unknown', oid: OID, size: 0 });
    });
    test('a blob with an unreadable size and an object id that is not an id is "unknown" (nothing about it is trusted)', () => {
        expect(parse(row('100644', 'blob', 'zz', 'BAD', 'x')).get('x')).toEqual({ mode: '100644', type: 'unknown', oid: 'zz', size: 0 });
    });
    test.each(['abc', '1e3', '-5', '99999999999999999'])('a size of %j that is not 1 to 15 digits is "unknown"', (size) => {
        expect(parse(row('100644', 'blob', OID, size, 'x')).get('x')).toMatchObject({ type: 'unknown', size: 0 });
    });
    test('rows without a tab or with missing columns are skipped', () => {
        expect(parseTreeEntries('100644 blob\0no tab here\0').size).toBe(0);
    });
    test('a name that contains a tab or a newline is kept whole', () => {
        const name = 'a\tb\nc.md';
        expect(parse(row('100644', 'blob', OID, '1', name)).get(name)).toMatchObject({ size: 1 });
    });
    test.each([undefined, null, 5, {}])('non-string input %j gives an empty map and never throws', (input) => {
        expect(parseTreeEntries(input as never).size).toBe(0);
    });
});
