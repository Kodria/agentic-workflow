import { renderCopilotInstructions } from '../../../src/core/renderers/copilot-instructions';

// Real SKILL.md frontmatter shape (mirrors skills/using-awm/SKILL.md).
const skill = `---
name: using-awm
version: "1.2.3"
description: Use when starting any development conversation
---

# Using AWM

MUST invoke skills per the tiered policy.
`;

it('renders Copilot .instructions.md frontmatter with applyTo: "**" and the body verbatim', () => {
    expect(renderCopilotInstructions(skill)).toBe(
`---
applyTo: "**"
---

# Using AWM

MUST invoke skills per the tiered policy.
`);
});

it('embeds the body content even when the description contains a colon (description is not itself rendered)', () => {
    const source = `---
name: colon-skill
description: Use when starting: development conversation
---

Body content survives.
`;
    const rendered = renderCopilotInstructions(source);
    expect(rendered).toBe(
`---
applyTo: "**"
---

Body content survives.
`);
});

it.each([
    ['no frontmatter at all', 'just a plain markdown body'],
    ['missing description', '---\nname: ok\n---\nBody.'],
    ['empty body', '---\nname: ok\ndescription: fine\n---\n'],
])('rejects invalid skill sources before rendering (%s)', (_label, source) => {
    expect(() => renderCopilotInstructions(source)).toThrow();
});
