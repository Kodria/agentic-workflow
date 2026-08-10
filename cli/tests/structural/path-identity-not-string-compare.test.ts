// Guard estructural — la lección más cara de esta rama, convertida en regla.
//
// Tres sitios distintos comparaban rutas como STRINGS (`realpathSync(a) !== realpathSync(b)`).
// En Linux y macOS los tres pasaban; en Windows los tres mentían, porque el mismo directorio
// tiene más de una grafía. Arreglar uno solo habría dejado el bug vivo en los otros dos —
// exactamente el patrón "N hermanos, uno nunca recibió el tratamiento" que se repitió toda
// la iteración.
//
// La regla no enumera los tres sitios: prohíbe la FORMA. Un cuarto sitio escrito el mes que
// viene la hereda sin que nadie se acuerde de este incidente.
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');

function tsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return tsFiles(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
    });
}

/** `realpathSync(...)` a cada lado de una comparación — la forma exacta del bug. Se ignoran
 *  los comentarios: este archivo y los tres arreglados EXPLICAN el patrón en prosa, y un
 *  guard que se dispara con su propia documentación termina desactivado. */
const STRING_COMPARE = /realpath[^\n]*\)\s*(?:===|!==)|(?:===|!==)\s*fs\.realpath/;

describe('identidad de rutas: filesystem, no strings', () => {
    it('ningún módulo compara dos realpath con === / !==', () => {
        const offenders: string[] = [];
        for (const file of tsFiles(SRC)) {
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
                if (STRING_COMPARE.test(code)) offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
            });
        }
        // El mensaje dice qué usar, no solo qué está mal: un guard que solo prohíbe se
        // sortea con un `// eslint-disable` mental.
        expect(offenders.join('\n') || 'sin ofensores').toBe('sin ofensores');
    });
});
