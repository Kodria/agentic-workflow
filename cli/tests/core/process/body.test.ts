import { parseProcessBody } from '../../../src/core/process/body';

const body = `
# Ejemplo

## Objetivo

G — Llevar una idea hasta una rama cerrada.

## Cuándo aplica

Cuando hay una tarea de desarrollo sin plan previo.

## Estructura

- SG-1 — Diseñar
  - OP-1.1 — Elicitar requisitos
  - OP-1.2 — Escribir el design doc
- SG-2 — Ejecutar
  - OP-2.1 — Implementar por tasks

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| No hay design doc | | OP-1.1 | SG-1 |
| Design doc aprobado | SG-1 | OP-2.1 | SG-2 |

## Terminación

finishing-a-development-branch

## Sin verificar

- Que el usuario tenga un registry propio instalado.
`;

describe('parseProcessBody', () => {
    it('extrae las seis secciones', () => {                                     // verifies R1.5
        const r = parseProcessBody(body, 'p');
        expect(r.diagnostics).toEqual([]);
        expect(r.model!.objective).toBe('G — Llevar una idea hasta una rama cerrada.');
        expect(r.model!.appliesWhen).toBe('Cuando hay una tarea de desarrollo sin plan previo.');
        expect(r.model!.termination).toBe('finishing-a-development-branch');
        expect(r.model!.unverified).toEqual(['Que el usuario tenga un registry propio instalado.']);
    });

    it('descompone Estructura en SG-# con sus OP-#', () => {                    // verifies R1.6
        expect(parseProcessBody(body, 'p').model!.structure).toEqual([
            { id: 'SG-1', text: 'Diseñar', operations: [
                { id: 'OP-1.1', text: 'Elicitar requisitos' }, { id: 'OP-1.2', text: 'Escribir el design doc' }] },
            { id: 'SG-2', text: 'Ejecutar', operations: [{ id: 'OP-2.1', text: 'Implementar por tasks' }] },
        ]);
    });

    it('lee Ruteo con sus cuatro columnas, incluida la vacía', () => {          // verifies R1.7
        expect(parseProcessBody(body, 'p').model!.routing).toEqual([
            { when: 'No hay design doc', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' },
            { when: 'Design doc aprobado', requiredState: 'SG-1', goesTo: 'OP-2.1', endsAt: 'SG-2' },
        ]);
    });

    it('conserva las filas de Ruteo como datos, sin evaluarlas ni colapsarlas', () => {  // verifies R1.8
        // WCP16 Deferred Choice: la condición se evalúa al llegar a la decisión,
        // leyendo el estado real del proyecto. El parser no puede precomputar cuál
        // fila gana — si lo hiciera, `show --json` emitiría una decisión ya tomada.
        const r = parseProcessBody(body, 'p').model!;
        expect(r.routing).toHaveLength(2);
        expect(Object.keys(r)).not.toContain('activeRoute');
        expect(JSON.stringify(r.routing)).toContain('No hay design doc');
    });

    it.each(['## Objetivo', '## Ruteo', '## Terminación'])('rechaza si falta %s', (heading) => {  // verifies R1.5
        const r = parseProcessBody(body.replace(heading, '## Otra cosa'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/missing/i);
    });

    it('rechaza una tabla de Ruteo con número de columnas equivocado', () => {  // verifies R1.7
        const r = parseProcessBody(body.replace('| No hay design doc | | OP-1.1 | SG-1 |', '| No hay design doc | OP-1.1 |'), 'p');
        expect(r.model).toBeUndefined();
    });

    it('rechaza un id de operación que no cuelga de su subobjetivo', () => {    // verifies R1.6
        const r = parseProcessBody(body.replace('OP-2.1', 'OP-9.1'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/OP-9\.1/);
    });

    it('nunca lanza ante entrada basura', () => {                               // verifies R1.5
        for (const junk of ['', '## Objetivo', '| | | |', '#'.repeat(500)]) {
            expect(() => parseProcessBody(junk, 'p')).not.toThrow();
        }
    });

    it('rechaza un heading de nivel 2 repetido en vez de fusionarlo', () => {
        // Un `## Ruteo` duplicado no debe fusionar sus líneas con la primera
        // aparición: si lo hiciera, la fila de cabecera de la segunda tabla
        // ("| Cuándo | ... |") caería en un índice no-cero del array fusionado
        // y `parseRouting` la confundiría con una fila de datos — corrupción
        // silenciosa, sin diagnóstico. Esto es especialmente grave porque este
        // parser procesa contenido no confiable de registries externos.
        const duped = `
## Objetivo

G — Llevar una idea hasta una rama cerrada.

## Cuándo aplica

Cuando hay una tarea de desarrollo sin plan previo.

## Estructura

- SG-1 — Diseñar
  - OP-1.1 — Elicitar requisitos

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| No hay design doc | | OP-1.1 | SG-1 |

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| Otra condición | | OP-1.1 | SG-1 |

## Terminación

finishing-a-development-branch

## Sin verificar

- Que el usuario tenga un registry propio instalado.
`;
        const r = parseProcessBody(duped, 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/duplicate/i);
    });

    it('parsea un heading con una racha larga de espacios finales sin colgarse (ReDoS)', () => {
        // Regresión: `splitSections` matcheaba headings con `/^##\s+(.+?)\s*$/`.
        // El grupo perezoso `(.+?)` seguido de `\s*` sobre una clase que lo
        // solapa (`.` ⊃ `\s`) es cuadrático — ver AGENTS.md
        // "regex-cuantificador-adyacente-a-clase-que-lo-solapa". Una sola línea
        // `## `-prefijada con una racha larga de espacios finales (ni siquiera
        // maliciosa, un typo alcanza) colgaba el proceso. El fix usa captura
        // greedy a fin-de-línea (`(.*)$`, sin cuantificador adyacente) y hace
        // `.trim()` en código. Este test prueba que el parseo completo del
        // documento sigue siendo lineal, no solo el regex aislado.
        const longTrailingSpace = '## Objetivo' + ' '.repeat(50000) + 'x';
        const doc = body.replace('## Objetivo', longTrailingSpace);
        const t0 = Date.now();
        const r = parseProcessBody(doc, 'p');
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThan(500);
        // El heading matcheado debe llevar el trim aplicado en código, no en el regex.
        expect(r.diagnostics.join(' ')).toMatch(/missing required section "## Objetivo"/);
    });

    it('ignora una línea "## " (solo espacio, sin nombre) como contenido ordinario, sin abrir una sección fantasma', () => {
        // Regresión del fix de ReDoS: la regex vieja `/^##\s+(.+?)\s*$/` exigía
        // al menos un carácter no-blanco capturado, así que una línea "##"
        // seguida solo de espacio NUNCA matcheaba como heading. La regex nueva
        // `/^##\s+(.*)$/` + trim() sí puede capturar "" — sin el guard de
        // finding-1, esa línea abriría una sección "" fantasma y desviaría lo
        // que sigue (aquí, una fila real de la tabla de Ruteo) hacia ella,
        // dejando `parseProcessBody` "exitoso" pero con datos perdidos y CERO
        // diagnósticos. La línea debe tratarse como contenido ordinario de la
        // sección abierta (`## Ruteo`), donde `parseRouting` ya la ignora por
        // no empezar con "|".
        const strayHeading = body.replace(
            '## Ruteo\n\n| Cuándo | Estado requerido | Va a | Termina en |',
            '## Ruteo\n\n## \n\n| Cuándo | Estado requerido | Va a | Termina en |',
        );
        expect(strayHeading).not.toBe(body); // guard: el replace debe haber encontrado el punto de inserción
        const r = parseProcessBody(strayHeading, 'p');
        expect(r.diagnostics).toEqual([]);
        expect(r.model!.routing).toEqual([
            { when: 'No hay design doc', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' },
            { when: 'Design doc aprobado', requiredState: 'SG-1', goesTo: 'OP-2.1', endsAt: 'SG-2' },
        ]);
    });

    it('reconoce un separador de tabla con colons de alineación GFM (|:---|:---:|) sin fabricar una fila', () => {
        // finding-2: el detector viejo `/^-{1,}$/.test(cells.join(''))` solo
        // reconoce separadores de dashes puros. `|:---|:---:|:---:|:---:|` es
        // sintaxis GFM estándar de alineación de columnas (muy probable si el
        // autor del registry usó cualquier formateador de tablas markdown) y
        // NO era reconocida — la fila colaba como dato fabricado con celdas
        // literales como ":---". El fix la reconoce por celda con un regex
        // anclado `^:?-+:?$` (lineal, sin riesgo ReDoS).
        const gfmAligned = body.replace('|---|---|---|---|', '|:---|:---:|:---:|:---:|');
        expect(gfmAligned).not.toBe(body);
        const r = parseProcessBody(gfmAligned, 'p');
        expect(r.diagnostics).toEqual([]);
        expect(r.model!.routing).toEqual([
            { when: 'No hay design doc', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' },
            { when: 'Design doc aprobado', requiredState: 'SG-1', goesTo: 'OP-2.1', endsAt: 'SG-2' },
        ]);
        // Ninguna fila fabricada a partir del separador (p.ej. celdas ":---").
        expect(JSON.stringify(r.model!.routing)).not.toContain(':--');
    });

    it('rechaza un SG-# duplicado en Estructura', () => {
        // finding-3: a diferencia de la validación OP-# <-> SG-# (que sí
        // rechaza una pertenencia inconsistente), un SG-# repetido pasaba en
        // silencio y producía un `structure` con dos entradas compartiendo el
        // mismo `id` — inconsistente para cualquier consumidor que indexe por
        // id. Mismo patrón `problems` que el resto del archivo.
        const dupedSg = body.replace(
            '- SG-1 — Diseñar\n  - OP-1.1 — Elicitar requisitos\n  - OP-1.2 — Escribir el design doc\n- SG-2 — Ejecutar',
            '- SG-1 — Diseñar\n  - OP-1.1 — Elicitar requisitos\n  - OP-1.2 — Escribir el design doc\n- SG-1 — Diseñar otra vez\n- SG-2 — Ejecutar',
        );
        expect(dupedSg).not.toBe(body);
        const r = parseProcessBody(dupedSg, 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/duplicate.*SG-1/i);
    });
});
