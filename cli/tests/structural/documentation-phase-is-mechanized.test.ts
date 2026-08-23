import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('la fase de documentacion esta mecanizada, no solo enunciada', () => {
    it('CONSTITUTION.md enuncia la regla y nombra el marker', () => {          // verifies R6.7
        const text = read('CONSTITUTION.md');
        expect(text).toMatch(/awm-docs-complete/);
        expect(text).toMatch(/post-implementation-docs/);
    });

    it('CONSTITUTION.md apunta al mecanismo, no lo reemplaza', () => {         // verifies R6.7
        const text = read('CONSTITUTION.md');
        // debe citar el archivo que efectivamente hace cumplir la regla
        expect(text).toMatch(/plan-state\.ts/);
        expect(text).toMatch(/development-process/);
    });

    it('el enunciado NO es el unico lugar donde la fase existe', () => {       // verifies R6.7
        // Si esto pasa solo por CONSTITUTION.md, la regla es decorativa.
        expect(read('cli/src/core/dashboard/plan-state.ts')).toMatch(/docsComplete/);
        expect(read('cli/src/core/dashboard/plan-state.ts')).toMatch(/docs_pending/);
        expect(read('cli/src/core/dashboard/sanitize.ts')).toMatch(/docsComplete/);
        expect(read('cli/src/commands/evidence/index.ts')).toMatch(/awm-docs-complete/);
    });
});
