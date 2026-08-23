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

describe('R5.2 — el CLI parsea el modelo una sola vez', () => {
    it('ningún módulo fuera de core/process/ conoce la sintaxis del modelo', () => {  // verifies R5.2
        const offenders = sourceFiles(SRC).filter((file) => {
            const relative = path.relative(SRC, file).split(path.sep).join('/');
            if (PARSER_MODULES.includes(relative)) return false;
            const content = fs.readFileSync(file, 'utf-8');
            // El discriminador literal y los headings del contrato son la firma
            // de "acá alguien está parseando el modelo".
            return /process-model|##\s+Cuándo aplica|SG-\d|OP-\d/.test(content);
        });
        expect(offenders).toEqual([]);
    });

    it('el adapter del Dashboard consume el descubridor, no el filesystem', () => {   // verifies R5.2
        const collect = fs.readFileSync(path.join(SRC, 'core/dashboard/collect.ts'), 'utf-8');
        expect(collect).toContain('discoverProcessModels');
        expect(collect).not.toMatch(/SKILL\.md/);
    });
});
