describe('cliVersion / compareSemver', () => {
    it('cliVersion devuelve la versión del package.json del CLI', () => {
        const { cliVersion } = require('../../src/core/cli-version');
        const pkg = require('../../package.json');
        expect(cliVersion()).toBe(pkg.version);
    });

    it.each([
        ['1.0.0', '1.0.0', 0],
        ['2.0.0', '1.9.9', 1],
        ['1.9.0', '1.10.0', -1],   // orden numérico, no lexicográfico
        ['1.0.1', '1.0.0', 1],
    ])('compareSemver(%s, %s) → signo %i', (a, b, sign) => {
        const { compareSemver } = require('../../src/core/versioning');
        expect(Math.sign(compareSemver(a, b))).toBe(sign);
    });
});
