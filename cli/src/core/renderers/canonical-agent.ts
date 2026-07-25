export type CanonicalAgent = {
    name: string;
    description: string;
    instructions: string;
};

export function parseCanonicalAgent(source: string): CanonicalAgent {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error('canonical agent requires YAML frontmatter');
    const fields = new Map<string, string>();
    for (const line of match[1].split(/\r?\n/)) {
        const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
        if (!field) throw new Error(`invalid canonical agent frontmatter line: ${line}`);
        if (fields.has(field[1])) throw new Error(`duplicate canonical agent frontmatter key: ${field[1]}`);
        fields.set(field[1], field[2].replace(/^(['"])(.*)\1$/, '$2').trim());
    }
    const name = fields.get('name') ?? '';
    const description = fields.get('description') ?? '';
    const instructions = match[2].trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('invalid agent name');
    if (!description) throw new Error('canonical agent requires a non-empty description');
    if (!instructions) throw new Error('canonical agent requires a non-empty instruction body');
    return { name, description, instructions };
}
