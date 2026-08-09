// `classifySkillLinks` sin el ledger no puede ver una usurpacion. Ese tercer
// argumento es opcional a proposito — hay llamadores legitimos que no tienen ledger a
// mano — y por eso mismo es facil de omitir sin que nada se queje.
//
// Ya paso: cuando se agrego la deteccion (D-007) se cableo en el seam `scanSkills`,
// que alimenta `skills.global`, y los otros dos checks del mismo archivo que llaman al
// clasificador directo — `workflows.global` y `agents.native` — quedaron afuera. Tres
// hermanos, uno tratado. Es el patron que mas se repitio en este repo, y la unica
// contramedida que funciona es que el compilador o un test lo cuenten por vos.
//
// Este guard es deliberadamente estrecho: solo mira `core/diagnostics/`, que es donde
// vive el reporte de salud. Un llamador de otro modulo puede omitir el ledger sin que
// esto se queje; lo que no puede pasar es que un CHECK diga `healthy` sobre un
// directorio gestionado que nunca comparo contra el ledger.
import fs from 'fs';
import path from 'path';

const DIAGNOSTICS = path.join(__dirname, '..', '..', 'src', 'core', 'diagnostics');

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => path.join(dir, f));
}

/** Cada `classifySkillLinks(...)` del archivo, con su lista de argumentos en crudo.
 *  Contar comas de nivel superior alcanza: los argumentos reales son identificadores y
 *  llamadas simples, sin literales de objeto ni genericos con coma. */
function classifyCalls(source: string): { args: string; line: number }[] {
    const out: { args: string; line: number }[] = [];
    const needle = 'classifySkillLinks(';
    let from = 0;
    for (;;) {
        const at = source.indexOf(needle, from);
        if (at === -1) return out;
        from = at + needle.length;
        let depth = 1;
        let i = from;
        while (i < source.length && depth > 0) {
            if (source[i] === '(') depth++;
            else if (source[i] === ')') depth--;
            i++;
        }
        out.push({
            args: source.slice(from, i - 1),
            line: source.slice(0, at).split('\n').length,
        });
    }
}

function topLevelArgCount(args: string): number {
    if (args.trim() === '') return 0;
    let depth = 0;
    let count = 1;
    for (const ch of args) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) count++;
    }
    return count;
}

describe('every diagnostics scan of a managed directory consults the ownership ledger', () => {
    it('no classifySkillLinks call under core/diagnostics/ omits the managed-targets argument', () => {
        const offenders: string[] = [];

        for (const file of sourceFiles(DIAGNOSTICS)) {
            const source = fs.readFileSync(file, 'utf8');
            for (const call of classifyCalls(source)) {
                // La definicion importada no es una llamada; el parser solo ve `nombre(`.
                if (topLevelArgCount(call.args) < 3) {
                    offenders.push(`${path.basename(file)}:${call.line} — ${call.args.trim()}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('the guard can actually see a violation (it is not vacuously green)', () => {
        // Si el parser se rompiera, el test de arriba pasaria para siempre sin mirar nada.
        expect(topLevelArgCount('dir, contentRoots()')).toBe(2);
        expect(topLevelArgCount('dir, contentRoots(), managedLinkTargets(state())')).toBe(3);
    });

    it('there is at least one call to guard, so the sweep is not scanning an empty set', () => {
        const total = sourceFiles(DIAGNOSTICS)
            .reduce((n, f) => n + classifyCalls(fs.readFileSync(f, 'utf8')).length, 0);
        expect(total).toBeGreaterThan(0);
    });
});
