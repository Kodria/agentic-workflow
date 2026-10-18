// cli/src/core/process/model.ts
// Lector del contrato de frontmatter del modelo durable de proceso.
// Disciplina heredada literal de core/orchestrators.ts: NUNCA lanza. Un modelo
// malformado se rechaza con diagnóstico y no invalida al registry que lo
// contiene ni a los demás (R7.1).
import { findFrontmatterDescription, isBlockScalarHeader, matchFrontmatterBlock } from '../frontmatter';
import { KNOWN_PROCESS_SCHEMA, type ProcessModelFrontmatter, type ProcessParseResult, type ProcessStatus } from './types';

/** El discriminador es literal: ningún documento se reconoce como modelo por su
 *  cuerpo, sus headings ni su nombre de archivo (R1.2). */
const DISCRIMINATOR = 'process-model';

/** `description` es el único campo opcional: runtimes como Codex se niegan a
 *  cargar un `SKILL.md` sin él, y el modelo *es* el `SKILL.md` del skill. */
const ALLOWED_FIELDS = ['awm', 'schema', 'name', 'status', 'entry_point', 'terminates_to', 'created', 'updated', 'description'] as const;

/** Límite de Agent Skills que imponen los runtimes que consumen el skill. */
const DESCRIPTION_MAX = 1024;
const STATUSES: readonly string[] = ['draft', 'active'];

/** El slug es lo único del modelo que puede viajar dentro de un id del Dashboard
 *  (ver sanitize.ts). Por eso se valida acá y no en la frontera de render: si
 *  admitiera rutas, markup o `=`, el id dejaría de ser seguro por construcción. */
export const PROCESS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lector de pares `clave: valor` de un frontmatter plano. El contrato no admite
 *  anidamiento ni block scalars, así que no se arrastra un parser YAML: cualquier
 *  línea que no sea `clave: valor` es un rechazo, no una interpretación. */
function readPairs(block: string): { pairs: Map<string, string>; problems: string[] } {
    const pairs = new Map<string, string>();
    const problems: string[] = [];
    const lines = block.split(/\r?\n/);
    for (const [index, raw] of lines.entries()) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) continue;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        // Se reporta la POSICIÓN (1-based dentro del bloque), nunca el
        // contenido: una línea suelta suele ser la continuación de un valor
        // multilínea, y los diagnósticos no transportan valores de campos.
        if (!m) { problems.push(`line ${index + 1} is not a "key: value" pair (multi-line values are not supported)`); continue; }
        if (pairs.has(m[1])) { problems.push(`duplicate field ${JSON.stringify(m[1])}`); continue; }
        pairs.set(m[1], m[2].trim());
    }
    return { pairs, problems };
}

export function parseProcessFrontmatter(source: string, file: string): ProcessParseResult<ProcessModelFrontmatter> {
    let block: string | null;
    try { block = matchFrontmatterBlock(source); } catch { return { diagnostics: [] }; }
    if (block === null) return { diagnostics: [] };

    const { pairs, problems } = readPairs(block);

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

    // Un block scalar ya deja sus líneas de continuación rechazadas por
    // readPairs; el mensaje explícito le dice al autor por qué. Al resolver se
    // pasa SOLO la línea `description:`, para que continuaciones de otros
    // campos no se plieguen dentro del valor. El valor nunca va al diagnóstico.
    let description: string | undefined;
    const rawDescription = pairs.get('description');
    if (rawDescription !== undefined) {
        if (/^[>|]/.test(rawDescription) || isBlockScalarHeader(rawDescription)) {
            problems.push('"description" must be a single-line string (block scalars are not supported in a process model)');
        } else {
            const resolved = findFrontmatterDescription(`description: ${rawDescription}`).value.trim();
            if (resolved === '') problems.push('"description" must not be empty');
            else if (resolved.length > DESCRIPTION_MAX) problems.push(`"description" must be at most ${DESCRIPTION_MAX} characters`);
            else description = resolved;
        }
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
