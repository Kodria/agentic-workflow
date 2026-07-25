import { renderCodexAgent } from '../../../src/core/renderers/codex-agent';

const canonical = `---
name: development-process
description: Orchestrates the development lifecycle
mode: primary
---

# Development Process

Invoke the \`development-process\` skill before implementation.
`;

it('renders deterministic native Codex TOML', () => {
    expect(renderCodexAgent(canonical)).toBe(
`name = "development-process"
description = "Orchestrates the development lifecycle"
developer_instructions = """
# Development Process

Invoke the \`development-process\` skill before implementation.
"""
`); // verifies R8, R9
});

it.each([
    ['---\nname: Bad Name\ndescription: x\n---\nbody', 'invalid agent name'],
    ['---\nname: ok\ndescription:\n---\nbody', 'non-empty description'],
    ['---\nname: ok\ndescription: x\n---\n', 'non-empty instruction body'],
    ['name: ok', 'frontmatter'],
])('rejects invalid canonical agents before rendering', (source, message) => {
    expect(() => renderCodexAgent(source)).toThrow(message); // verifies R17
});

it('escapes an embedded backslash and runs of double quotes of varying length in the instructions body', () => {
    const instructionsBody = [
        'Backslash: \\',
        'One quote: "',
        'Three quotes: """',
        'Four quotes: """"',
        'Five quotes: """""',
        'Seven quotes: """""""',
        'Eight quotes: """"""""',
    ].join('\n');
    const source = `---
name: quote-agent
description: Handles many quotes
---

${instructionsBody}
`;

    expect(renderCodexAgent(source)).toBe(
`name = "quote-agent"
description = "Handles many quotes"
developer_instructions = """
Backslash: \\\\
One quote: \\"
Three quotes: \\"\\"\\"
Four quotes: \\"\\"\\"\\"
Five quotes: \\"\\"\\"\\"\\"
Seven quotes: \\"\\"\\"\\"\\"\\"\\"
Eight quotes: \\"\\"\\"\\"\\"\\"\\"\\"
"""
`); // verifies R8, R9 (guards against greedy triple-quote-run escaping producing invalid TOML)
});

it('escapes U+007F (DEL) in single-line TOML string fields', () => {
    const source = `---
name: ok
description: hasdel
---

Body text.
`;

    expect(renderCodexAgent(source)).toBe(
`name = "ok"
description = "has\\u007fdel"
developer_instructions = """
Body text.
"""
`); // verifies R8, R9
});

it('escapes U+007F (DEL) embedded in the multiline instructions body', () => {
    const del = String.fromCharCode(0x7f);
    const source = `---
name: ok
description: fine
---

Body${del}text.
`;

    expect(renderCodexAgent(source)).toBe(
`name = "ok"
description = "fine"
developer_instructions = """
Body\\u007ftext.
"""
`); // verifies R8, R9
});
