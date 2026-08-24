import { stripControlChars } from '../../src/core/text';

describe('stripControlChars', () => {
    it('elimina ESC y demas bytes de control C0', () => {                        // verifies R5.4
        expect(stripControlChars('a\x1b[31mb\x00c\x07d')).toBe('a[31mbcd');
    });

    it('preserva \\n y \\t, que son whitespace legitimo', () => {                // verifies R5.4
        expect(stripControlChars('a\nb\tc')).toBe('a\nb\tc');
    });

    it('elimina DEL (0x7F)', () => {                                            // verifies R5.4
        expect(stripControlChars('a\x7Fb')).toBe('ab');
    });
});
