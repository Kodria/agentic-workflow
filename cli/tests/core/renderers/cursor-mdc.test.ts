import { renderCursorMdc } from '../../../src/core/renderers/cursor-mdc';

// Real SKILL.md frontmatter shape (mirrors skills/using-awm/SKILL.md).
const skill = `---
name: using-awm
version: "1.2.3"
description: Use when starting any development conversation
---

# Using AWM

MUST invoke skills per the tiered policy.
`;

it('renders Cursor .mdc frontmatter as an Agent Requested rule (description + blank globs + alwaysApply: false)', () => {
    expect(renderCursorMdc(skill)).toBe(
`---
description: Use when starting any development conversation
globs:
alwaysApply: false
---

# Using AWM

MUST invoke skills per the tiered policy.
`);
});

it('quotes a description containing a colon so it does not break YAML parsing', () => {
    const source = `---
name: colon-skill
description: Use when starting: development conversation
---

Body content.
`;
    const rendered = renderCursorMdc(source);
    expect(rendered).toContain('description: "Use when starting: development conversation"');
    // Sanity: the naive unquoted form would be invalid YAML (parsed as a
    // nested mapping key) — this asserts we never emit it.
    expect(rendered).not.toContain('description: Use when starting: development conversation');
});

it('quotes a description starting with a YAML-special character', () => {
    const source = `---
name: special-skill
description: "*starred description"
---

Body content.
`;
    const rendered = renderCursorMdc(source);
    expect(rendered).toContain('description: "*starred description"');
});

it('leaves a plain description unquoted', () => {
    const source = `---
name: plain-skill
description: A perfectly ordinary description
---

Body content.
`;
    expect(renderCursorMdc(source)).toContain('description: A perfectly ordinary description');
});

it.each([
    ['no frontmatter at all', 'just a plain markdown body'],
    ['missing description', '---\nname: ok\n---\nBody.'],
    ['empty body', '---\nname: ok\ndescription: fine\n---\n'],
])('rejects invalid skill sources before rendering (%s)', (_label, source) => {
    expect(() => renderCursorMdc(source)).toThrow();
});
