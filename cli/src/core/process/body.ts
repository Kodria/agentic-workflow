// cli/src/core/process/body.ts
// Contrato del cuerpo del modelo (R1.5–R1.8). Igual que model.ts: nunca lanza.
//
// R1.8 (WCP16 Deferred Choice) es una restricción sobre lo que este módulo NO
// hace: las filas de `## Ruteo` se conservan verbatim como datos. Precomputar
// cuál aplica emitiría por `show --json` una decisión ya tomada, cuando la
// condición debe evaluarse al llegar a la decisión contra el estado real.
import type { ProcessModelBody, ProcessParseResult, ProcessSubgoal } from './types';

const REQUIRED = ['Objetivo', 'Cuándo aplica', 'Estructura', 'Ruteo', 'Terminación', 'Sin verificar'] as const;
const SG = /^-\s+(SG-\d+)\s+—\s+(.+)$/;
const OP = /^\s+-\s+(OP-(\d+)\.\d+)\s+—\s+(.+)$/;

/** Corta el documento en secciones de nivel 2. Las de nivel 1 (`# Titulo`) y el
 *  contenido previo al primer `##` se descartan: el contrato vive en los `##`.
 *  Un heading repetido NO se fusiona con el anterior — eso corrompería en
 *  silencio los parsers posicionales (p.ej. `parseRouting` tomaría la fila de
 *  cabecera de la segunda sección como una fila de datos). En su lugar se
 *  registra como problema y el llamador debe abortar. */
function splitSections(source: string, problems: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const seen = new Set<string>();
    let current: string | null = null;
    for (const line of source.split(/\r?\n/)) {
        // Greedy capture a fin-de-línea + trim en código, no en el regex: un
        // `(.+?)` perezoso seguido de `\s*` sobre una clase que lo solapa
        // (`.` incluye `\s`) es ReDoS cuadrático — ver AGENTS.md
        // "regex-cuantificador-adyacente-a-clase-que-lo-solapa" y el mismo
        // patrón ya corregido en cli/src/commands/evidence/index.ts marker().
        const m = /^##\s+(.*)$/.exec(line);
        // Un `##` seguido solo de espacio (grupo capturado vacío tras el trim)
        // NO es un heading real: la regex vieja `(.+?)\s*$` exigía al menos un
        // carácter no-blanco antes del `\s*$` final, así que una línea así
        // nunca matcheaba como sección. `(.*)` sí puede capturar cero
        // caracteres — sin este guard, una línea "## " perdida dentro de p.ej.
        // `## Ruteo` abriría una sección fantasma "" y desviaría las filas de
        // tabla reales hacia ella en silencio (ver finding-1 del reviewer).
        if (m && m[1].trim() !== '') {
            const heading = m[1].trim();
            if (seen.has(heading)) {
                problems.push(`duplicate section heading "## ${heading}"`);
                current = null; // deja de recolectar: no fusionar con la primera aparición
                continue;
            }
            seen.add(heading);
            out.set(heading, []);
            current = heading;
            continue;
        }
        if (current !== null) out.get(current)!.push(line);
    }
    return out;
}

function paragraph(lines: string[]): string {
    return lines.map((l) => l.trim()).filter((l) => l !== '').join(' ');
}

function parseStructure(lines: string[], problems: string[]): ProcessSubgoal[] {
    const subgoals: ProcessSubgoal[] = [];
    const seenSg = new Set<string>();
    for (const raw of lines) {
        if (raw.trim() === '') continue;
        const sg = SG.exec(raw);
        if (sg) {
            // Un SG-# repetido produciría dos entradas con el mismo `id` en
            // `structure` — inconsistente para cualquier consumidor que
            // indexe por id. Mismo patrón `problems` que el resto del archivo.
            if (seenSg.has(sg[1])) { problems.push(`duplicate "Estructura" id ${sg[1]}`); continue; }
            seenSg.add(sg[1]);
            subgoals.push({ id: sg[1], text: sg[2].trim(), operations: [] }); continue;
        }
        const op = OP.exec(raw);
        if (!op) { problems.push(`"Estructura" line is neither an SG-# nor an OP-#: ${JSON.stringify(raw.trim().slice(0, 80))}`); continue; }
        const owner = subgoals[subgoals.length - 1];
        // El prefijo numérico de la operación DEBE coincidir con su subobjetivo:
        // sin esto, OP-9.1 colgando de SG-2 pasaría y la jerarquía HTA sería una
        // ilusión tipográfica.
        if (!owner) { problems.push(`${op[1]} appears before any SG-#`); continue; }
        if (`SG-${op[2]}` !== owner.id) { problems.push(`${op[1]} does not belong to ${owner.id}`); continue; }
        owner.operations.push({ id: op[1], text: op[3].trim() });
    }
    if (subgoals.length === 0) problems.push('"Estructura" declares no SG-#');
    return subgoals;
}

function parseRouting(lines: string[], problems: string[]): ProcessModelBody['routing'] {
    const rows: ProcessModelBody['routing'] = [];
    const tableLines = lines.map((l) => l.trim()).filter((l) => l.startsWith('|'));
    for (const [index, line] of tableLines.entries()) {
        // `| a | b |` -> ['a','b']: se descartan los extremos vacíos que deja el
        // split, no las celdas internas vacías — la columna "Estado requerido"
        // vacía es WCP18 "sin hito", un valor con significado.
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (index === 0) {
            if (cells.length !== 4) problems.push('"Ruteo" header must have exactly 4 columns');
            continue;
        }
        // Separador GFM: dashes puros (`|---|`) o con colons de alineación
        // (`|:---|:---:|`). Se prueba celda por celda con un regex anclado y
        // sin cuantificadores anidados (`^:?-+:?$`) — lineal, sin riesgo ReDoS
        // — y se exige que cada celda tenga al menos un `-` real para no
        // aceptar una fila de solo colons/vacíos como falso separador.
        if (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))) continue; // separador
        if (cells.length !== 4) { problems.push(`"Ruteo" row ${index} must have exactly 4 columns, found ${cells.length}`); continue; }
        if (cells[0] === '' || cells[2] === '' || cells[3] === '') { problems.push(`"Ruteo" row ${index} needs Cuándo, Va a and Termina en`); continue; }
        rows.push({ when: cells[0], requiredState: cells[1], goesTo: cells[2], endsAt: cells[3] });
    }
    if (rows.length === 0) problems.push('"Ruteo" declares no transitions');
    return rows;
}

export function parseProcessBody(source: string, file: string): ProcessParseResult<ProcessModelBody> {
    const problems: string[] = [];
    const sections = splitSections(source, problems);
    for (const heading of REQUIRED) {
        if (!sections.has(heading)) problems.push(`missing required section "## ${heading}"`);
    }
    if (problems.length > 0) return { diagnostics: [`${file}: invalid process model body — ${problems.join('; ')}`] };

    const structure = parseStructure(sections.get('Estructura')!, problems);
    const routing = parseRouting(sections.get('Ruteo')!, problems);
    const objective = paragraph(sections.get('Objetivo')!);
    const appliesWhen = paragraph(sections.get('Cuándo aplica')!);
    const termination = paragraph(sections.get('Terminación')!);
    const unverified = sections.get('Sin verificar')!
        .map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());

    for (const [label, value] of [['Objetivo', objective], ['Cuándo aplica', appliesWhen], ['Terminación', termination]] as const) {
        if (value === '') problems.push(`"${label}" is empty`);
    }

    if (problems.length > 0) return { diagnostics: [`${file}: invalid process model body — ${problems.join('; ')}`] };
    return { model: { objective, appliesWhen, structure, routing, termination, unverified }, diagnostics: [] };
}
