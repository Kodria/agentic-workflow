import { parseCanonicalAgent } from './canonical-agent';

const DEL = String.fromCharCode(0x7f);

function tomlString(value: string): string {
    // JSON.stringify escapes backslashes, double quotes, and control characters
    // U+0000-U+001F, but TOML also requires U+007F (DEL) to be escaped.
    return JSON.stringify(value).split(DEL).join('\\u007f');
}

function tomlMultiline(value: string): string {
    // Escape every backslash and every double quote individually (not just
    // triple-quote runs) so no run of 3+ unescaped quotes can ever appear in
    // the output, regardless of how many consecutive quotes are embedded.
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"""\n${escaped}\n"""`;
}

export function renderCodexAgent(source: string): string {
    const agent = parseCanonicalAgent(source);
    return [
        `name = ${tomlString(agent.name)}`,
        `description = ${tomlString(agent.description)}`,
        `developer_instructions = ${tomlMultiline(agent.instructions)}`,
        '',
    ].join('\n');
}
