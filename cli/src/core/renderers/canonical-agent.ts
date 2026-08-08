import { readFrontmatterDescription, isBlockScalarHeader } from '../discovery';

export type CanonicalAgent = {
    name: string;
    description: string;
    instructions: string;
};

export function parseCanonicalAgent(source: string): CanonicalAgent {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error('canonical agent requires YAML frontmatter');
    const fields = new Map<string, string>();
    // La validacion linea-por-linea sigue siendo estricta a proposito (atrapa
    // frontmatter malformado), pero debe reconocer los block scalars: sus
    // lineas de CONTENIDO estan indentadas y no son pares `clave: valor`.
    // Antes lanzaban "invalid canonical agent frontmatter line", asi que un
    // agente con `description: >-` rompia `awm add <x> -a codex`. Peor aun
    // tras unificar el discovery: el picker mostraba la descripcion bien
    // resuelta y recien despues explotaba el install — dos caminos leyendo el
    // MISMO archivo con reglas distintas.
    const lines = match[1].split(/\r?\n/);
    let inBlock = false;
    for (const line of lines) {
        if (inBlock && (line.trim() === '' || /^\s/.test(line))) continue;   // contenido del bloque
        inBlock = false;
        const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
        if (!field) throw new Error(`invalid canonical agent frontmatter line: ${line}`);
        if (fields.has(field[1])) throw new Error(`duplicate canonical agent frontmatter key: ${field[1]}`);
        if (isBlockScalarHeader(field[2])) { inBlock = true; fields.set(field[1], ''); continue; }
        fields.set(field[1], field[2].replace(/^(['"])(.*)\1$/, '$2').trim());
    }
    const name = fields.get('name') ?? '';
    // La descripcion sale de la funcion compartida (resuelve block scalars y
    // deshace el escape de los escalares entrecomillados) — nunca del mapa de
    // arriba, que solo corta comillas.
    const description = readFrontmatterDescription(match[1]);
    const instructions = match[2].trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('invalid agent name');
    if (!description) throw new Error('canonical agent requires a non-empty description');
    if (!instructions) throw new Error('canonical agent requires a non-empty instruction body');
    return { name, description, instructions };
}
