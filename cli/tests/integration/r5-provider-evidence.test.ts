// R5 Task 16 — gate de INTEGRIDAD de la evidencia, no gate de "todo certificado".
//
// La primera versión de este test exigía evidencia `pass` de dos providers reales, así que
// fallaba siempre. Un test rojo permanente no es un gate: enseña a ignorar el rojo, y el
// primero que necesite mergear lo borra. Lo que este archivo vigila ahora es lo único que
// un test PUEDE vigilar acá: que nadie convierta una ausencia en un `supported`.
//
// El estado real de la certificación vive en `docs/research/r5/README.md` y en la matriz
// generada — no en si esta suite está verde.
import fs from 'fs';
import path from 'path';

const RESEARCH = path.resolve(__dirname, '../../../docs/research/r5');
const EVIDENCE = path.join(RESEARCH, 'evidence');
const MATRIX = path.join(RESEARCH, 'provider-matrix.md');

const evidenceFiles = (): string[] =>
    (fs.existsSync(EVIDENCE) ? fs.readdirSync(EVIDENCE) : []).filter((f) => f.endsWith('.json'));

describe('R5 · integridad de la evidencia de providers', () => {
    it('la matriz existe y se generó desde la evidencia', () => {
        expect(fs.existsSync(MATRIX)).toBe(true);
        expect(fs.readFileSync(MATRIX, 'utf8')).toContain('GENERADO por provider-run.mjs');
    });

    it('ninguna capability dice `supported` sin un JSON de evidencia que la respalde', () => {
        const text = fs.readFileSync(MATRIX, 'utf8');
        // Si la matriz afirma soporte en algún lado, tiene que haber al menos una evidencia
        // en disco. Sin esto, un `supported` escrito a mano pasaría inadvertido para siempre.
        if (text.includes('supported')) expect(evidenceFiles().length).toBeGreaterThan(0);
    });

    it.each(evidenceFiles())('%s es evidencia bien formada y sanitizada', (name) => {
        const x = JSON.parse(fs.readFileSync(path.join(EVIDENCE, name), 'utf8'));
        expect(x.schema).toBe(1);
        expect(`${x.provider}-${x.environment}.json`).toBe(name);
        expect(['pass', 'partial', 'fail']).toContain(x.result);
        // `pass` es la única palabra que autoriza a la matriz a decir `supported`, así que es
        // la que más barato sale falsificar: exige los tres ejercicios en verde.
        if (x.result === 'pass') {
            expect(x.exercises).toMatchObject({ bootstrap: 'pass', recovery: 'pass', join: 'pass', finalIntegrationRuns: 1 });
        }
        expect(x.sourceHead).toMatch(/^[0-9a-f]{40}$/);
        expect(x.commands).toEqual(expect.arrayContaining([expect.stringContaining('node dist/src/index.js')]));
        // Los artefactos referenciados existen: una lista de rutas inventadas certificaría
        // una corrida que nadie puede volver a mirar.
        expect(Array.isArray(x.artifacts) && x.artifacts.length > 0).toBe(true);
        for (const p of x.artifacts) expect(fs.existsSync(path.resolve(RESEARCH, p))).toBe(true);
        // Ni secretos ni rutas de home reales viajan al repo. Se busca la ASIGNACIÓN
        // (`token=…`, `"secret": …`), no la palabra suelta: la evidencia describe en prosa
        // el fencing por token de generación, y un `/token/i` a secas convertía esa
        // descripción legítima en un rojo — la clase de check que termina relajado a nada.
        const serialized = JSON.stringify(x);
        expect(serialized).not.toMatch(/\b(?:token|secret|password|api[-_]?key)\b"?\s*[:=]\s*"?(?!<REDACTED>)[\w-]{6,}/i);
        expect(serialized).not.toMatch(/\/Users\/[^/"\s]+|\/home\/[^/"\s]+/);
    });

    it('el README declara explícitamente qué NO está certificado', () => {
        // El día que `join` se certifique, esta aserción falla y obliga a actualizar el
        // README — que es exactamente cuándo hay que actualizarlo.
        const readme = fs.readFileSync(path.join(RESEARCH, 'README.md'), 'utf8');
        const matrix = fs.readFileSync(MATRIX, 'utf8');
        const joinCertified = /\| worktree join \|[^|]*supported/.test(matrix);
        expect(joinCertified ? 'certificado' : readme.includes('No certificado por esta vía'))
            .toBe(joinCertified ? 'certificado' : true);
    });
});
