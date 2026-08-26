/** Parses JSON after rejecting duplicate object keys without runtime dependencies. */
export function parseJsonNoDuplicate(text: string): unknown {
    if (typeof text !== 'string') throw new Error('JSON input must be a string');
    let index = 0;
    const fail = (message: string): never => { throw new Error(`invalid JSON: ${message}`); };
    const whitespace = (): void => { while (/\s/.test(text[index] ?? '')) index++; };
    const string = (): string => {
        if (text[index++] !== '"') fail('expected string'); let out = '';
        while (index < text.length) {
            const char = text[index++];
            if (char === '"') return out;
            if (char === '\\') {
                const escape = text[index++];
                if (!escape) fail('unterminated escape');
                if (escape === 'u') { const hex = text.slice(index, index + 4); if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid unicode escape'); out += String.fromCharCode(Number.parseInt(hex, 16)); index += 4; }
                else {
                    const decoded: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
                    if (!(escape in decoded)) fail('invalid escape');
                    out += decoded[escape];
                }
            } else { if (char < ' ') fail('control character in string'); out += char; }
        }
        return fail('unterminated string');
    };
    const value = (): void => {
        whitespace(); const char = text[index];
        if (char === '"') { string(); return; }
        if (char === '{') { object(); return; }
        if (char === '[') { array(); return; }
        if (text.startsWith('true', index) || text.startsWith('false', index) || text.startsWith('null', index)) { index += text.startsWith('true', index) ? 4 : text.startsWith('false', index) ? 5 : 4; return; }
        const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (!match) return fail('expected value');
        index += match[0].length;
    };
    const array = (): void => { index++; whitespace(); if (text[index] === ']') { index++; return; } while (true) { value(); whitespace(); if (text[index] === ']') { index++; return; } if (text[index++] !== ',') fail('expected comma'); } };
    const object = (): void => { index++; const keys = new Set<string>(); whitespace(); if (text[index] === '}') { index++; return; } while (true) { whitespace(); if (text[index] !== '"') fail('expected object key'); const key = string(); if (keys.has(key)) fail(`duplicate key ${JSON.stringify(key)}`); keys.add(key); whitespace(); if (text[index++] !== ':') fail('expected colon'); value(); whitespace(); if (text[index] === '}') { index++; return; } if (text[index++] !== ',') fail('expected comma'); } };
    value(); whitespace(); if (index !== text.length) fail('trailing content');
    return JSON.parse(text) as unknown;
}
