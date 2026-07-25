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
