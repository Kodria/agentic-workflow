// Regresion: `compareSemver` devolvia NaN ante una entrada malformada, y como
// `NaN > 0` y `NaN < 0` son AMBOS false, el gate de version fallaba ABIERTO:
// `verifyMinCliVersions` dejaba pasar en silencio un CLI por debajo del minimo.
// Para un gate, la direccion correcta de fallo es la contraria.
import { compareSemver } from '../../src/core/versioning';

describe('compareSemver', () => {
    it.each([
        ['1.2.3', '1.2.3', 0],
        ['1.2.4', '1.2.3', 1],
        ['1.2.3', '1.3.0', -1],
        ['2.0.0', '1.99.99', 1],
        ['v1.2.3', '1.2.3', 0],
    ])('compara %s con %s', (a, b, sign) => {
        expect(Math.sign(compareSemver(a as string, b as string))).toBe(sign);
    });

    it.each([
        ['incompleta', '1.2'],
        ['no numerica', 'x.y.z'],
        ['vacia', ''],
        ['basura', 'latest'],
    ])('lanza ante una version %s en vez de devolver NaN', (_n, bad) => {
        expect(() => compareSemver(bad as string, '1.0.0')).toThrow(/not a semver/i);
        expect(() => compareSemver('1.0.0', bad as string)).toThrow(/not a semver/i);
    });

    it('nunca devuelve NaN — el valor que hacia fallar el gate abierto', () => {
        expect(Number.isNaN(compareSemver('1.0.0', '2.0.0'))).toBe(false);
    });
});
