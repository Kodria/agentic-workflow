import { parseCanonicalAgent } from './canonical-agent';

// TOML requires control characters other than tab (U+0009) and newline
// (U+000A) to be escaped in both basic and multi-line basic strings,
// including U+007F (DEL) and the rest of the C0 range (U+0000-U+0008,
// U+000B-U+001F). JSON.stringify (used for single-line strings) already
// escapes U+0000-U+001F, but not U+007F. A plain backslash/quote replace
// (used for multi-line strings) escapes neither. escapeControlChars covers
// both: for tomlString it only ever finds a literal U+007F left over from
// JSON.stringify (the rest were already turned into escape sequences by
// JSON.stringify, so they are no longer literal control characters); for
// tomlMultiline it finds every raw control character in the value.
//
// The character class below is built from numeric code points rather than
// written as literal escape sequences in source, to avoid ambiguity between
// "the two characters backslash and u" and "the control character itself".
const CONTROL_CHAR_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x00, 0x08],
    [0x0b, 0x1f],
    [0x7f, 0x7f],
];

function buildControlCharsRegex(): RegExp {
    const classBody = CONTROL_CHAR_RANGES.map(([start, end]) => {
        const from = String.fromCharCode(start);
        const to = String.fromCharCode(end);
        return start === end ? from : `${from}-${to}`;
    }).join('');
    return new RegExp(`[${classBody}]`, 'g');
}

const CONTROL_CHARS = buildControlCharsRegex();

function escapeControlChars(value: string): string {
    return value.replace(CONTROL_CHARS, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function tomlString(value: string): string {
    // JSON.stringify escapes backslashes, double quotes, and control characters
    // U+0000-U+001F, but TOML also requires U+007F (DEL) to be escaped.
    return escapeControlChars(JSON.stringify(value));
}

function tomlMultiline(value: string): string {
    // Escape every backslash and every double quote individually (not just
    // triple-quote runs) so no run of 3+ unescaped quotes can ever appear in
    // the output, regardless of how many consecutive quotes are embedded.
    // Order matters: backslashes first (so escaping a control character does
    // not introduce a backslash that gets doubled), then control characters,
    // then quotes. Tab and newline are left raw; they're legitimately
    // allowed unescaped in a TOML multi-line basic string.
    const escaped = escapeControlChars(value.replace(/\\/g, '\\\\')).replace(/"/g, '\\"');
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
