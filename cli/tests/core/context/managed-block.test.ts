import {
    AWM_END,
    AWM_START,
    mergeManagedBlock,
    removeManagedBlock,
} from '../../../src/core/context/managed-block';

const body = 'Use AWM through the development-process skill.';

describe('mergeManagedBlock', () => {
    it('appends exactly one block and preserves user content byte-for-byte', () => {
        const original = '# My rules\n\nKeep this.\n';
        const merged = mergeManagedBlock(original, body);

        expect(merged).toContain(original);
        expect(merged.match(/<!-- AWM:START -->/g)).toHaveLength(1);
        expect(mergeManagedBlock(merged, body)).toBe(merged);
    });

    it.each([
        ['', `${AWM_START}\n${body}\n${AWM_END}\n`],
        ['user', `user\n\n${AWM_START}\n${body}\n${AWM_END}\n`],
        ['user\n', `user\n\n${AWM_START}\n${body}\n${AWM_END}\n`],
        ['user\n\n', `user\n\n${AWM_START}\n${body}\n${AWM_END}\n`],
    ])('uses a stable separator for original %j', (original, expected) => {
        expect(mergeManagedBlock(original, body)).toBe(expected);
    });

    it('replaces a valid block while preserving every byte before and after it', () => {
        const before = 'prefix\r\n\r\n';
        const after = '\r\nsuffix\n';
        const original = `${before}${AWM_START}\nold\n${AWM_END}${after}`;

        expect(mergeManagedBlock(original, 'new\n')).toBe(
            `${before}${AWM_START}\nnew\n${AWM_END}${after}`,
        );
    });

    it('normalizes only trailing newlines in the managed body and is idempotent', () => {
        const once = mergeManagedBlock('', `${body}\n\n`);
        expect(mergeManagedBlock(once, `${body}\n`)).toBe(once);
    });

    it.each([
        [`${AWM_START}\nbody\n`, 'unmatched'],
        [`${AWM_END}\n`, 'unmatched'],
        [`${AWM_START}\na\n${AWM_END}\n${AWM_START}\nb\n${AWM_END}`, 'duplicate'],
        [`${AWM_START}\n${AWM_START}\n${AWM_END}\n${AWM_END}`, 'nested'],
        [`${AWM_END}\nbody\n${AWM_START}`, 'reversed'],
        ['<!-- AWM:STARTED -->\nuser', 'malformed'],
        ['<!-- prefix AWM:END -->\nuser', 'malformed'],
    ])('rejects ambiguous markers in %j', (input, message) => {
        expect(() => mergeManagedBlock(input, body)).toThrow(message);
    });

    it.each([
        [null, body, 'original'],
        [undefined, body, 'original'],
        [42, body, 'original'],
        ['', null, 'body'],
        ['', {}, 'body'],
    ])('rejects invalid runtime input', (original, managedBody, message) => {
        expect(() => mergeManagedBlock(original as never, managedBody as never)).toThrow(message);
    });
});

describe('removeManagedBlock', () => {
    it('removes only the valid block and preserves every surrounding byte', () => {
        const original = `before\n\n${AWM_START}\nowned\n${AWM_END}\n\nafter`;
        expect(removeManagedBlock(original)).toBe('before\n\n\n\nafter');
    });

    it('is unchanged when no block exists and rejects ambiguous markers', () => {
        expect(removeManagedBlock('user only\n')).toBe('user only\n');
        expect(() => removeManagedBlock(`${AWM_START}\nmissing end`)).toThrow('unmatched');
    });
});
