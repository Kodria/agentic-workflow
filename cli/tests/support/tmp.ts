// Directorios temporales en forma canonica, para tests que comparan rutas.
//
// En macOS `os.tmpdir()` devuelve `/var/folders/…`, que es un SYMLINK a
// `/private/var/folders/…`. El producto resuelve el root del proyecto con `realpathSync`
// (`findProjectRoot`, `core/profile.ts`), asi que devuelve la forma canonica. Un test que
// arma su expectativa con el `mkdtemp` crudo compara `/var/…` contra `/private/var/…` y
// falla sobre un producto que se comporta bien. En Linux y Windows las dos formas
// coinciden, asi que el problema es invisible hasta que corre en macOS — paso tres veces
// en la primera corrida de macOS en CI.
//
// Usar esto en cualquier test que:
//   - compare una ruta contra la que devuelve el producto, o
//   - le pase el tmpdir al producto y despues afirme sobre lo que salio.
//
// Un test que solo escribe y lee archivos bajo su tmpdir no lo necesita: las dos formas
// llegan al mismo inodo. Por eso esto es un helper y no una migracion masiva — envolver
// los 113 archivos que crean tmpdirs seria ruido, no rigor.
import fs from 'fs';
import os from 'os';
import path from 'path';

/** `fs.mkdtempSync` + `realpathSync`: el mismo directorio, en la forma que el producto
 *  va a usar. El `realpathSync` no puede fallar — el directorio acaba de crearse. */
export function mkCanonicalTmpDir(prefix: string): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
