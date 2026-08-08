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

it('throws rather than embedding a literal block-scalar indicator as the description', () => {
    // Regression: a YAML block scalar (`description: >-` / `|-`) means the
    // real text lives on the FOLLOWING indented lines, not on this line —
    // the original code took the bare indicator itself as the description,
    // which would have rendered the literal string ">-" into the .mdc file.
    const source = `---
name: block-skill
description: >-
  This description spans
  multiple lines.
---

Body content.
`;
    expect(() => renderCursorMdc(source)).toThrow('non-empty description');
});

it('quotes a description containing a mid-string " #" (starts a YAML comment, truncating the rest)', () => {
    // Regression: the original YAML_UNSAFE regex only caught `#` at the START
    // of the string — a `#` preceded by whitespace ANYWHERE in a plain scalar
    // also starts a comment. Unquoted, "Use this #important skill" would
    // render as YAML that silently truncates to "Use this".
    const source = `---
name: hash-skill
description: Use this #important skill
---

Body content.
`;
    const rendered = renderCursorMdc(source);
    expect(rendered).toContain('description: "Use this #important skill"');
    expect(rendered).not.toContain('description: Use this #important skill');
});

it('quotes a description containing an embedded null byte / control character instead of emitting it raw', () => {
    // Regression: an embedded control/null byte is invalid in a YAML plain
    // scalar regardless of position — the original code's YAML_UNSAFE regex
    // needed the [\x00-\x1f\x7f] class to catch this; without it, a null byte
    // would have been emitted unquoted straight into the frontmatter.
    const nul = String.fromCharCode(0);
    const source = `---
name: nul-skill
description: Use this${nul}description
---

Body content.
`;
    const rendered = renderCursorMdc(source);
    // JSON.stringify \u-escapes control bytes — the rendered frontmatter must
    // carry the escaped, quoted form, never the literal raw byte.
    expect(rendered).toContain(`description: ${JSON.stringify(`Use this${nul}description`)}`);
    expect(rendered).not.toContain(`description: Use this${nul}description\n`);
});

it('escapes an embedded DEL (0x7F) byte, which JSON.stringify alone does not escape', () => {
    // Regression: JSON.stringify \u-escapes \x00-\x1F but NOT \x7F (DEL isn't in
    // JSON's own required-escape set), so quoting via JSON.stringify alone would
    // leave a raw, non-conformant DEL byte inside the YAML double-quoted scalar.
    // yamlString must escape it itself after JSON.stringify runs.
    const del = String.fromCharCode(0x7f);
    const source = `---
name: del-skill
description: Use this${del}description
---

Body content.
`;
    const rendered = renderCursorMdc(source);
    expect(rendered).toContain('description: "Use this\\u007fdescription"');
    expect(rendered).not.toContain(`description: Use this${del}description\n`);
    expect(rendered).not.toMatch(new RegExp(`description: "[^"]*${del}`));
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
