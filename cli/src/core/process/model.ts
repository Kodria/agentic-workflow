// cli/src/core/process/model.ts
// Lector del contrato de frontmatter del modelo durable de proceso.
// Disciplina heredada literal de core/orchestrators.ts: NUNCA lanza. Un modelo
// malformado se rechaza con diagnóstico y no invalida al registry que lo
// contiene ni a los demás (R7.1).
import yaml from 'js-yaml';
import { matchFrontmatterBlock } from '../frontmatter';
import { KNOWN_PROCESS_SCHEMA, type ProcessModelFrontmatter, type ProcessParseResult, type ProcessStatus } from './types';

/** El discriminador es literal: ningún documento se reconoce como modelo por su
 *  cuerpo, sus headings ni su nombre de archivo (R1.2). */
const DISCRIMINATOR = 'process-model';

/** `description` es el único campo opcional: runtimes como Codex se niegan a
 *  cargar un `SKILL.md` sin él, y el modelo *es* el `SKILL.md` del skill. */
const ALLOWED_FIELDS = ['awm', 'schema', 'name', 'status', 'entry_point', 'terminates_to', 'created', 'updated', 'description'] as const;

/** Límite de Agent Skills que imponen los runtimes que consumen el skill.
 *  Se cuenta en code points, no en unidades UTF-16. */
const DESCRIPTION_MAX = 1024;

/** Tope del bloque de frontmatter antes de entregarlo al parser YAML: acota el
 *  costo de parsear contenido no confiable de un registry. Por encima no se
 *  parsea (para `description`, se rechaza con el mensaje del límite de 1024). */
const FRONTMATTER_MAX = 65536;

/** Lo que un runtime mostraría mal o usaría para engañar: controles C0 (salvo
 *  tab), DEL, C1, separadores U+2028/U+2029, marcas LRM/RLM/ALM, overrides e
 *  isolates bidi, y surrogates sueltos (regex en vez de `isWellFormed`: el lib
 *  de TS es ES2022). */
const FORBIDDEN_CHAR = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Discriminador indentado: un modelo cuyas claves quedaron con sangría se
 *  perdería en silencio como "no es un modelo". */
const INDENTED_DISCRIMINATOR = /^awm[ \t]*:[ \t]*process-model$/;
const STATUSES: readonly string[] = ['draft', 'active'];

/** El slug es lo único del modelo que puede viajar dentro de un id del Dashboard
 *  (ver sanitize.ts). Por eso se valida acá y no en la frontera de render: si
 *  admitiera rutas, markup o `=`, el id dejaría de ser seguro por construcción. */
export const PROCESS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Caracteres de ancho cero: un valor hecho solo de ellos se ve vacío. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Línea de continuación (indentada): su texto se guarda SOLO para detectar un
 *  discriminador indentado; nunca viaja a un diagnóstico. */
interface ContinuationLine { line: number; text: string }

/** Lector de pares `clave: valor` de un frontmatter plano. El contrato no admite
 *  anidamiento ni block scalars: cualquier línea que no sea `clave: valor` es un
 *  rechazo, no una interpretación. (El VALOR de `description` sí pasa por el
 *  parser YAML, más abajo.) */
function readPairs(block: string): { pairs: Map<string, string>; problems: string[]; continuations: ContinuationLine[] } {
    const pairs = new Map<string, string>();
    const problems: string[] = [];
    const continuations: ContinuationLine[] = [];
    // Mismo criterio que YAML, no que JS: se parte en TODO salto de línea YAML
    // (un CR suelto también; si no, `a\rclave: x` sería un par para acá y dos
    // claves para un runtime) y solo se recorta espacio y tab (`\s`/`trim()`
    // comerían NBSP o U+3000, que para YAML son contenido).
    const lines = block.split(/\r\n|\r|\n/);
    for (const [index, raw] of lines.entries()) {
        const line = raw.replace(/^[ \t]+|[ \t]+$/g, '');
        // NEL/LS/PS son saltos de línea para YAML 1.1 (PyYAML) y no para js-yaml:
        // un comentario podría esconder una clave que solo un runtime ve. Se
        // reporta en CUALQUIER línea, comentarios incluidos, y solo por posición.
        if (/[\u0085\u2028\u2029]/.test(raw)) problems.push(`frontmatter line ${index + 1} contains a YAML 1.1 line break (NEL, LS or PS)`);
        if (line === '' || line.startsWith('#')) continue;
        // El contrato es un mapa PLANO: una línea que empieza con espacio o tab
        // es continuación de un valor multilínea, diga lo que diga. Si se
        // recortara antes de mirar, `  KEY: x` pasaría por campo (y su nombre
        // terminaría en un diagnóstico).
        const indented = /^[ \t]/.test(raw);
        if (indented) continuations.push({ line: index + 1, text: line });
        // `[\s\S]` y no `.`: un U+2028/U+2029 dentro del valor no lo vuelve
        // "no-par" (la línea ya viene partida); lo rechaza el chequeo de controles.
        const m = indented ? null : /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*([\s\S]*)$/.exec(line);
        // Se reporta la POSICIÓN (1-based dentro del bloque), nunca el
        // contenido: una línea suelta suele ser la continuación de un valor
        // multilínea, y los diagnósticos no transportan valores de campos.
        if (!m) { problems.push(`frontmatter line ${index + 1} is not a "key: value" pair (multi-line values are not supported)`); continue; }
        if (pairs.has(m[1])) { problems.push(`duplicate field ${JSON.stringify(m[1])}`); continue; }
        pairs.set(m[1], m[2]);
    }
    return { pairs, problems, continuations };
}

type LoadedBlock = { kind: 'too-long' } | { kind: 'invalid' } | { kind: 'loaded'; doc: unknown };

/** Carga el bloque de frontmatter COMPLETO con js-yaml (schema por defecto),
 *  exactamente como lo lee un runtime. Por encima del tope no se parsea. NUNCA
 *  lanza: un error de js-yaml es `invalid`. */
function loadBlock(block: string): LoadedBlock {
    if (block.length > FRONTMATTER_MAX) return { kind: 'too-long' };
    try { return { kind: 'loaded', doc: yaml.load(block) }; } catch { return { kind: 'invalid' }; }
}

function isPlainObject(doc: unknown): doc is Record<string, unknown> {
    return doc !== null && typeof doc === 'object' && Object.getPrototypeOf(doc) === Object.prototype;
}

/** Valida `description` leyéndola del bloque entero con el parser YAML real, no
 *  de la salida de readPairs (ya recortada y partida en `:`, que difiere de lo
 *  que lee un runtime). Ni el valor ni el texto del error de js-yaml (que puede
 *  citar contenido) llegan al problema. */
/** ¿El valor crudo de la línea, cargado SOLO, da el mismo string que el bloque
 *  entero? Si no, YAML lo plegó con líneas siguientes (p. ej. una comilla que
 *  sigue abierta a través de una línea `# …`). NUNCA lanza. */
function readsSameAlone(raw: string, value: string): boolean {
    let alone: unknown;
    try { alone = yaml.load(`description: ${raw}`); } catch { return false; }
    return isPlainObject(alone) && alone.description === value;
}

function checkDescription(raw: string, block: string, keys: ReadonlySet<string>): { value: string } | { problem: string } {
    const singleLine = { problem: '"description" must be a single-line string (block scalars are not supported in a process model)' };
    // El prefijo alcanza: todo header de block scalar (bien o mal formado)
    // empieza con `>` o `|`.
    if (/^[>|]/.test(raw)) return singleLine;
    const tooLong = { problem: `"description" must be at most ${DESCRIPTION_MAX} characters` };
    const loaded = loadBlock(block);
    if (loaded.kind === 'too-long') return tooLong;
    if (loaded.kind === 'invalid' || !isPlainObject(loaded.doc)) return { problem: '"description" cannot be read: the frontmatter is not valid YAML' };
    const doc = loaded.doc;
    // Si YAML lee otras claves de nivel superior que readPairs (un CR suelto,
    // una comilla que se traga la línea siguiente), lo validado acá no es lo
    // que verá un runtime. Ni claves ni valores van al problema.
    const yamlKeys = Object.keys(doc);
    if (yamlKeys.length !== keys.size || yamlKeys.some((k) => !keys.has(k))) {
        return { problem: '"description" cannot be read: the frontmatter does not read the same as YAML (check quotes and line breaks)' };
    }

    const value = doc.description;
    const empty = { problem: '"description" must not be empty' };
    if (value === null || value === undefined) return empty;
    if (typeof value !== 'string') {
        return { problem: '"description" must be a string (quote values YAML reads as a boolean, a number, a date or a collection)' };
    }
    if (value.replace(ZERO_WIDTH, '').trim() === '') return empty;
    if ([...value].length > DESCRIPTION_MAX) return tooLong;
    if (FORBIDDEN_CHAR.test(value)) return { problem: '"description" must not contain control, line-break or bidirectional-override characters' };
    if (!readsSameAlone(raw, value)) return singleLine;
    // Se guarda tal cual lo devuelve YAML: sin trim, con NBSP/BOM intactos.
    return { value };
}

export function parseProcessFrontmatter(source: string, file: string): ProcessParseResult<ProcessModelFrontmatter> {
    let block: string | null;
    try { block = matchFrontmatterBlock(source); } catch { return { diagnostics: [] }; }
    if (block === null) return { diagnostics: [] };

    const { pairs, problems, continuations } = readPairs(block);

    // Un modelo con las claves indentadas no tiene `awm` de nivel superior y se
    // perdería en silencio como "otro documento". Se nombra solo la línea.
    // Dispara con el prefiltro barato y, además, si el bloque NO carga como YAML
    // (sangría parcial o con tab; por encima del tope cuenta como no cargable)
    // o carga con `awm: process-model` en su nivel superior. Si carga sin `awm`
    // arriba (mención bajo `metadata:` o dentro de un block scalar), silencio.
    if (!pairs.has('awm')) {
        const indentedAwm = continuations.find((c) => INDENTED_DISCRIMINATOR.test(c.text));
        const loaded = indentedAwm ? loadBlock(block) : undefined;
        const fires = loaded !== undefined
            && (loaded.kind !== 'loaded' || (isPlainObject(loaded.doc) && loaded.doc.awm === DISCRIMINATOR));
        if (indentedAwm && fires) {
            return { diagnostics: [`${file}: invalid process model — frontmatter keys must not be indented (frontmatter line ${indentedAwm.line})`] };
        }
    }

    // Sin discriminador NO es un modelo de proceso: no es un error, es otro
    // documento. Devolver diagnóstico acá inundaría de ruido a todo registry
    // (cada SKILL.md normal caería en esta rama).
    if (pairs.get('awm') !== DISCRIMINATOR) return { diagnostics: [] };

    for (const key of pairs.keys()) {
        if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
            problems.push(`unknown field ${JSON.stringify(key)} — the contract admits only ${ALLOWED_FIELDS.join(', ')}`);
        }
    }

    const rawSchema = pairs.get('schema');
    const schema = rawSchema !== undefined && /^\d+$/.test(rawSchema) ? Number(rawSchema) : Number.NaN;
    if (!Number.isInteger(schema) || schema < 1) {
        problems.push('"schema" must be a positive integer');
    } else if (schema > KNOWN_PROCESS_SCHEMA) {
        // R1.4: detenerse e informar. Interpretarlo como el contrato anterior es
        // exactamente lo que este branch existe para impedir.
        return { diagnostics: [`${file}: process model declares schema ${schema}, but this CLI understands up to ${KNOWN_PROCESS_SCHEMA} — install a newer agentic-workflow-manager to read it`] };
    }

    for (const field of ['name', 'status', 'entry_point', 'terminates_to', 'created', 'updated'] as const) {
        const value = pairs.get(field);
        if (value === undefined || value === '') problems.push(`"${field}" is required`);
    }

    const name = pairs.get('name') ?? '';
    if (name !== '' && !PROCESS_NAME.test(name)) problems.push('"name" must be a lowercase slug (a-z, 0-9, hyphen)');

    const status = pairs.get('status') ?? '';
    if (status !== '' && !STATUSES.includes(status)) problems.push(`"status" must be one of ${STATUSES.join(', ')}`);

    const entryPointRaw = pairs.get('entry_point') ?? '';
    if (entryPointRaw !== '' && entryPointRaw !== 'true' && entryPointRaw !== 'false') problems.push('"entry_point" must be true or false');

    const terminatesTo = pairs.get('terminates_to') ?? '';
    if (terminatesTo !== '' && terminatesTo !== 'none' && !PROCESS_NAME.test(terminatesTo)) {
        problems.push('"terminates_to" must be a lowercase slug or "none"');
    }

    for (const field of ['created', 'updated'] as const) {
        const value = pairs.get(field) ?? '';
        if (value !== '' && !DATE.test(value)) problems.push(`"${field}" must be YYYY-MM-DD`);
    }

    let description: string | undefined;
    const rawDescription = pairs.get('description');
    if (rawDescription !== undefined) {
        const checked = checkDescription(rawDescription, block, new Set(pairs.keys()));
        if ('problem' in checked) problems.push(checked.problem);
        else description = checked.value;
    }

    if (problems.length > 0) {
        return { diagnostics: [`${file}: invalid process model — ${problems.join('; ')}`] };
    }

    return {
        model: {
            schema, name, status: status as ProcessStatus, entryPoint: entryPointRaw === 'true',
            terminatesTo, created: pairs.get('created')!, updated: pairs.get('updated')!,
            ...(description !== undefined ? { description } : {}),
        },
        diagnostics: [],
    };
}
