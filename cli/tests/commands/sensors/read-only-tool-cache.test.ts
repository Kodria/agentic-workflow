import { stripReadOnlyToolCacheArgs } from '../../../src/commands/sensors/read-only-tool-cache';

describe('stripReadOnlyToolCacheArgs', () => {
    it('removes --cache for eslint', () => {
        expect(stripReadOnlyToolCacheArgs('eslint', ['.', '--cache', '--format', 'json']))
            .toEqual(['.', '--format', 'json']);
    });

    it('removes --cache and --cache-location plus operand for eslint when --cache present (DD-7)', () => {
        expect(stripReadOnlyToolCacheArgs('eslint', [
            '.', '--config', 'eslint.config.awm.mjs', '--cache', '--cache-location', 'node_modules/.cache/eslint/', '--format', 'json',
        ])).toEqual(['.', '--config', 'eslint.config.awm.mjs', '--format', 'json']);
    });

    it('does not strip lone --cache-location without --cache for eslint (DD-7)', () => {
        const args = ['.', '--cache-location', '/tmp/x', '--format', 'json'];
        expect(stripReadOnlyToolCacheArgs('eslint', args)).toEqual(args);
    });

    it('does not strip for non-eslint executables even with --cache (R9 / H1)', () => {
        const args = ['--cache', 'false', 'lib/'];
        expect(stripReadOnlyToolCacheArgs('rubocop', args)).toEqual(args);
    });

    it('does not mutate the input array (R6)', () => {
        const args = Object.freeze(['.', '--cache', '--format', 'json']) as string[];
        const copy = [...args];
        const out = stripReadOnlyToolCacheArgs('eslint', args);
        expect(out).toEqual(['.', '--format', 'json']);
        expect([...args]).toEqual(copy);
        expect(out).not.toBe(args);
    });

    it('rejects non-string executable or non-array args', () => {
        expect(() => stripReadOnlyToolCacheArgs('', ['.'])).toThrow(/executable/);
        expect(() => stripReadOnlyToolCacheArgs('eslint', null as unknown as string[])).toThrow(/args/);
    });

    it('rejects whitespace-only executable', () => {
        expect(() => stripReadOnlyToolCacheArgs('   ', ['.'])).toThrow(/executable/);
    });

    it('rejects empty-string arg elements with indexed message', () => {
        expect(() => stripReadOnlyToolCacheArgs('eslint', ['.', ''])).toThrow(/args\[1\]/);
    });

    it('rejects non-string arg elements', () => {
        expect(() => stripReadOnlyToolCacheArgs('eslint', ['.', 1 as unknown as string])).toThrow(/args/);
    });

    it('skips --cache-location operand when --cache present even if location is last', () => {
        expect(stripReadOnlyToolCacheArgs('eslint', ['--cache', '--cache-location'])).toEqual([]);
    });
});
