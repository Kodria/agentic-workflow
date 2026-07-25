import { parseCanonicalAgent } from './canonical-agent';

const DEL = String.fromCharCode(0x7f);

// TOML requires U+007F (DEL) to be escaped in both basic and multi-line basic
// strings, but neither JSON.stringify (used for single-line strings) nor a
// plain backslash/quote replace (used for multi-line strings) escapes it.
function escapeDel(value: string): string {
    return value.split(DEL).join('\\u007f');
}

function tomlString(value: string): string {
    // JSON.stringify escapes backslashes, double quotes, and control characters
    // U+0000-U+001F, but TOML also requires U+007F (DEL) to be escaped.
    return escapeDel(JSON.stringify(value));
}

function tomlMultiline(value: string): string {
    // Escape every backslash and every double quote individually (not just
    // triple-quote runs) so no run of 3+ unescaped quotes can ever appear in
    // the output, regardless of how many consecutive quotes are embedded.
    // Order matters: backslashes first (so escaping DEL does not introduce a
    // backslash that gets doubled), then DEL, then quotes.
    const escaped = escapeDel(value.replace(/\\/g, '\\\\')).replace(/"/g, '\\"');
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
