// El bug que motiva esto costó 18 tests en Windows y NINGUNO en Linux/macOS: comparar
// `fs.realpathSync(a) !== fs.realpathSync(b)` como strings. En Windows el mismo directorio
// tiene dos grafías legítimas (8.3 `RUNNER~1` vs nombre largo, backslash vs slash) y
// `realpathSync` no las reconcilia, así que `ownedWorktreeExists` negaba un worktree propio.
//
// El caso 8.3 no se puede reproducir en Linux. Lo que SÍ se puede probar acá es el contrato
// del helper — identidad por filesystem, no por texto — que es lo que hace correcto el fix.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sameExistingPath } from '../../src/core/paths';

describe('sameExistingPath', () => {
    let root: string;
    beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-samepath-'))); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('dos grafías del mismo directorio son la misma ruta', () => {
        const real = path.join(root, 'destino');
        fs.mkdirSync(real);
        const alias = path.join(root, 'alias');
        fs.symlinkSync(real, alias, 'dir');
        // Strings distintos, mismo inode. Esta es la propiedad que el fix compra.
        expect(alias).not.toBe(real);
        expect(sameExistingPath(alias, real)).toBe(true);
    });

    it('directorios distintos NO son la misma ruta', () => {
        const a = path.join(root, 'a');
        const b = path.join(root, 'b');
        fs.mkdirSync(a); fs.mkdirSync(b);
        expect(sameExistingPath(a, b)).toBe(false);
    });

    it('una ruta inexistente nunca "coincide" — la identidad no se afirma sin prueba', () => {
        const a = path.join(root, 'a');
        fs.mkdirSync(a);
        expect(sameExistingPath(a, path.join(root, 'fantasma'))).toBe(false);
        expect(sameExistingPath(path.join(root, 'fantasma'), path.join(root, 'fantasma'))).toBe(false);
    });

    it('sobrevive a separadores y segmentos redundantes', () => {
        const a = path.join(root, 'a');
        fs.mkdirSync(a);
        expect(sameExistingPath(a, path.join(root, '.', 'a', '..', 'a'))).toBe(true);
    });
});
