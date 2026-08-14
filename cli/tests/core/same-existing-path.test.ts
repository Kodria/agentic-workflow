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

const itPosix = process.platform !== 'win32' ? it : it.skip;

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

    it('does not treat colliding inode metadata as identity when native realpaths differ', () => {
        const a = path.join(root, 'inode-collision-a');
        const b = path.join(root, 'inode-collision-b');
        fs.mkdirSync(a); fs.mkdirSync(b);
        const stat = jest.spyOn(fs, 'statSync').mockImplementation((() => ({ dev: 1, ino: 1 } as fs.Stats)) as unknown as typeof fs.statSync);
        const platform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });

        try {
            expect(sameExistingPath(a, b)).toBe(false);
        } finally {
            Object.defineProperty(process, 'platform', platform!);
            stat.mockRestore();
        }
    });

    itPosix('conserva la identidad de un archivo con hard links POSIX', () => {
        const original = path.join(root, 'original');
        const alias = path.join(root, 'alias');
        fs.writeFileSync(original, 'contenido');
        fs.linkSync(original, alias);

        expect(sameExistingPath(alias, original)).toBe(true);
    });

    it('una ruta inexistente nunca "coincide" — la identidad no se afirma sin prueba', () => {
        const a = path.join(root, 'a');
        fs.mkdirSync(a);
        expect(sameExistingPath(a, path.join(root, 'fantasma'))).toBe(false);
        expect(sameExistingPath(path.join(root, 'fantasma'), path.join(root, 'fantasma'))).toBe(false);
    });

    it('falla cerrado si la canonicalización nativa no está disponible', () => {
        const a = path.join(root, 'a');
        fs.mkdirSync(a);
        const realpath = jest.spyOn(fs.realpathSync, 'native').mockImplementation(() => { throw new Error('canonicalización no disponible'); });

        try {
            expect(sameExistingPath(a, a)).toBe(false);
        } finally {
            realpath.mockRestore();
        }
    });

    it('sobrevive a separadores y segmentos redundantes', () => {
        const a = path.join(root, 'a');
        fs.mkdirSync(a);
        expect(sameExistingPath(a, path.join(root, '.', 'a', '..', 'a'))).toBe(true);
    });
});
