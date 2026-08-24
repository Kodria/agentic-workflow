import { stripControlChars, sanitizeDeclaredField } from '../../src/core/text';

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

describe('sanitizeDeclaredField', () => {
    it('quita marcado markdown Y bytes de control en una sola pasada', () => {    // verifies confirmed Finding 1
        expect(sanitizeDeclaredField('a\x1bx')).toBe('ax');
        expect(sanitizeDeclaredField('a\n## Forjado *b* `c` <d>')).toBe('a  Forjado b c d');
    });

    it('no deja ESC ni otros C0 sobrevivir aunque el saneo markdown no los toque', () => {  // verifies confirmed Finding 1
        // eslint-disable-next-line no-control-regex -- verificamos la ausencia deliberada de C0
        expect(sanitizeDeclaredField('name\x1b[31mred\x07')).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    });

    it('es idempotente sobre texto ya limpio', () => {
        const clean = 'a plain name';
        expect(sanitizeDeclaredField(clean)).toBe(clean);
        expect(sanitizeDeclaredField(sanitizeDeclaredField(clean))).toBe(clean);
    });
});
