import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../src');

/** Módulos autorizados a conocer la sintaxis del modelo. Cualquier otro que la
 *  toque está reimplementando el parser, que es exactamente lo que R5.2 prohíbe. */
const PARSER_MODULES = ['core/process/model.ts', 'core/process/body.ts', 'core/process/discover.ts'];

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });
}

// Enmascara comentarios antes de escanear: el JSDoc/prosa de este mismo
// archivo (y de otros) cita literales como "process-model" o tokens de
// ejemplo tipo "SG-1" a modo ilustrativo, lo que si no se descartara
// registraría falsos positivos fantasma — "acá alguien está citando el
// contrato", no "acá alguien lo está parseando". Strip naive de
// bloque/línea (no un parser TS completo), igual que en
// exec-invocation-explicit-stdio.test.ts. A diferencia de ese helper, acá
// enmascaramos con espacios en vez de borrar: preserva la cantidad de
// saltos de línea del original, así los números de línea reportados en los
// offenders siguen apuntando al archivo real. El guard `[^:]` en `//` evita
// tratar una URL `https://` dentro de una cadena como comentario de línea.
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])(\/\/.*)$/gm, (_full, prefix: string, comment: string) => prefix + comment.replace(/[^\n]/g, ' '));
}

// El discriminador literal y los headings del contrato son la firma de "acá
// alguien está parseando el modelo". `\b` ancla SG-\d/OP-\d a límites de
// palabra para no matchear como substring dentro de tokens no relacionados
// (MSG-1, WORKSHOP-2, DROP-3 no deben disparar el guard).
const SIGNATURE_RE = /process-model|##\s+Cuándo aplica|\bSG-\d|\bOP-\d/;

/** Líneas (1-indexed) del archivo, ya sin comentarios, donde aparece la firma. */
function signatureLines(content: string): number[] {
    return stripComments(content)
        .split('\n')
        .flatMap((line, idx) => (SIGNATURE_RE.test(line) ? [idx + 1] : []));
}

describe('R5.2 — el CLI parsea el modelo una sola vez', () => {
    it('ningún módulo fuera de core/process/ conoce la sintaxis del modelo', () => {  // verifies R5.2
        const offenders = sourceFiles(SRC).flatMap((file) => {
            const relative = path.relative(SRC, file).split(path.sep).join('/');
            if (PARSER_MODULES.includes(relative)) return [];
            const content = fs.readFileSync(file, 'utf-8');
            return signatureLines(content).map((line) => `${relative}:${line}`);
        });
        expect(offenders).toEqual([]);
    });

    it('el adapter del Dashboard consume el descubridor, no el filesystem', () => {   // verifies R5.2
        const collect = fs.readFileSync(path.join(SRC, 'core/dashboard/collect.ts'), 'utf-8');
        expect(collect).toContain('discoverProcessModels');
        expect(collect).not.toMatch(/SKILL\.md/);
    });
});
