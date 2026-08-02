import fs from 'fs';
import path from 'path';
import { parseTrackPlan } from '../../../src/core/tracks/plan-parser';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../../fixtures/tracks', name), 'utf8');

/** Narrowing explícito: el retorno es una unión discriminada y `strict` no deja acceder sin estrecharla. */
const parallel = (source: string) => {
    const parsed = parseTrackPlan(source, () => true);
    if (parsed.mode !== 'parallel-candidate') throw new Error(`esperaba parallel-candidate, obtuve ${parsed.mode}`);
    return parsed;
};

describe('parseTrackPlan', () => {
    test('parsea membresía, ownership y argv sin shell (R1.1, R1.4, C4)', () => {
        const p = parallel(fixture('two-independent.md'));
        expect(p.integration).toEqual({
            argv: ['npm', 'test', '--', '--runInBand'],
            paths: ['cli/src/**', 'cli/tests/**'],
        });
        expect(p.tracks.cli.taskIds).toEqual(['1']);
        expect(p.tracks.cli.ownership).toEqual(['cli/src/a.ts']);
    });

    test('ausencia completa conserva serial legacy (R1.2)', () => {
        expect(parseTrackPlan(fixture('legacy-serial.md'), () => true)).toEqual({ mode: 'serial', reason: 'no-tracks' });
    });

    test.each(['', '.', '..', '-x', 'a/b', 'a\\b'])(
        'rechaza id peligroso %p aunque git lo aceptara parcialmente (R1.3)', (id) => {
            const src = fixture('two-independent.md').replaceAll('cli', id);
            expect(() => parseTrackPlan(src, () => true)).toThrow(/track id inválido/);
        },
    );

    test('rechaza membresía sin fila y fila sin membresía (R1.6)', () => {
        const src = fixture('two-independent.md').replace('| docs | none | [] |', '| extra | none | [] |');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/coincidencia exacta/);
    });

    test('degrada a serial si shared resources falta o Depends on no es none (R1.7, R1.8)', () => {
        expect(parseTrackPlan(fixture('two-independent.md').replace('[] |', ' |'), () => true)).toMatchObject({ mode: 'serial' });
        expect(parseTrackPlan(fixture('two-independent.md').replace('| docs | none |', '| docs | cli |'), () => true)).toMatchObject({ mode: 'serial' });
    });

    test('integration argv debe ser JSON string[] no vacío (C4)', () => {
        const src = fixture('two-independent.md').replace('["npm","test","--","--runInBand"]', 'npm test');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/Integration argv/);
    });

    test('la ÚLTIMA task con Files y sin Track también se rechaza (R1.6)', () => {
        // El chequeo del loop solo dispara al ver el siguiente `### Task`; sin este caso
        // la última task del documento entra a paralelo con sus archivos sin dueño.
        const src = fixture('two-independent.md').replace('**Track:** docs\n', '');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/tiene Files pero no Track/);
    });

    // --- Step 5: casos adicionales bajo-especificados por el plan ---

    test('rechaza track id duplicado en la tabla ## Tracks', () => {
        const src = fixture('two-independent.md').replace('| docs | none | [] |', '| cli | none | [] |');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/track duplicado/);
    });

    test('rechaza una segunda línea **Track:** para la misma task', () => {
        const src = fixture('two-independent.md').replace('**Track:** cli\n', '**Track:** cli\n**Track:** cli\n');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/exactamente un Track/);
    });

    test('rechaza path absoluto en - Modify: (fuera del repo)', () => {
        const src = fixture('two-independent.md').replace('`cli/src/a.ts`', '`/etc/passwd`');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/Files path fuera del repo/);
    });

    test('rechaza escape de repo vía ../ en - Modify:', () => {
        const src = fixture('two-independent.md').replace('`cli/src/a.ts`', '`../../etc/passwd`');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/Files path fuera del repo/);
    });

    test('Integration argv/paths con elemento no-string (número) es rechazado (C4)', () => {
        const src = fixture('two-independent.md').replace('["npm","test","--","--runInBand"]', '["npm",1]');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/Integration argv/);
    });

    test('Integration paths con elemento no-string (número) es rechazado (C4)', () => {
        const src = fixture('two-independent.md').replace('["cli/src/**","cli/tests/**"]', '["cli/src/**",2]');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/Integration paths/);
    });

    test('un segundo encabezado ## Tracks hace que sus filas se ignoren silenciosamente; ' +
        'la membresía a la fila "perdida" sigue fallando por coincidencia exacta (documenta comportamiento real, no deseado idealmente)', () => {
        // El parser de tabla solo usa el PRIMER `## Tracks` (findIndex) y corta en la
        // primera línea que empieza con `## ` tras ese punto — incluida una segunda
        // `## Tracks`. Por eso la fila de `docs` colocada después del segundo encabezado
        // nunca entra a `declared`, y la membresía posterior de Task 2 a `docs` revienta
        // por "coincidencia exacta" en vez de por un error específico de tabla duplicada.
        const src = fixture('two-independent.md').replace(
            '| docs | none | [] |',
            '\n## Tracks\n\n| Track | Depends on | Shared resources |\n|---|---|---|\n| docs | none | [] |',
        );
        expect(() => parseTrackPlan(src, () => true)).toThrow(/coincidencia exacta/);
    });
});
