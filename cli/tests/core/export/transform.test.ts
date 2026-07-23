import { claudeAiTransform, DEFERENCE_LINE } from '../../../src/core/export/transform';

const FM = (lines: string[]) => `---\n${lines.join('\n')}\n---\nBody line.\n`;

describe('claudeAiTransform', () => {
  it('strips version and portable, keeps other keys and body intact', () => {  // verifies R3.1
    const input = FM(['name: mermaid-diagrams', 'version: "1.0.0"', 'portable: true', 'description: "Guide."']);
    const out = claudeAiTransform(input, 'mermaid-diagrams');
    expect(out).not.toMatch(/^version:/m);
    expect(out).not.toMatch(/^portable:/m);
    expect(out).toMatch(/^name: mermaid-diagrams$/m);
    expect(out).toContain('Body line.\n');
  });

  it('appends the deference line inside a quoted description', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', 'description: "Does things."']);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
  });

  it('appends the deference line to an unquoted description', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', 'description: Does things.']);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: Does things. ${DEFERENCE_LINE('x')}`);
  });

  it('appends the deference line inside a single-quoted description', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', "description: 'Does things.'"]);
    const out = claudeAiTransform(input, 'x');
    // DEFERENCE_LINE itself always contains an apostrophe ("registry's"), so
    // even a fixture with no apostrophe of its own must see it doubled ('')
    // per YAML single-quote escaping once spliced into a single-quoted scalar.
    expect(out).toContain(`description: 'Does things. ${DEFERENCE_LINE('x').replace(/'/g, "''")}'`);
  });

  it('appends the deference line inside a double-quoted description with trailing whitespace', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', 'description: "Does things."   ']);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
  });

  it('accepts CRLF-terminated frontmatter', () => {  // verifies R3.4
    const input = '---\r\nname: x\r\nportable: true\r\ndescription: "Does things."\r\n---\r\nBody line.\r\n';
    const out = claudeAiTransform(input, 'x');
    expect(out).not.toMatch(/^portable:/m);
    expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
    expect(out).toContain('Body line.\r\n');
  });

  it('throws on missing frontmatter block', () => {  // verifies R3.4
    expect(() => claudeAiTransform('No frontmatter here.', 'x')).toThrow(/frontmatter/);
  });

  it('throws on unterminated frontmatter block', () => {  // verifies R3.4
    expect(() => claudeAiTransform('---\nname: x\ndescription: "D."\n', 'x')).toThrow(/unterminated/);
  });

  it('throws on frontmatter without description', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'portable: true']), 'x')).toThrow(/description/);
  });

  it('throws on multi-line (block scalar) description', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'description: >', '  folded text']), 'x')).toThrow(/single-line/);
  });

  it('escapes an apostrophe in the deference line when appending to a single-quoted description', () => {  // verifies R3.4 (BLOCKER fix)
    const input = FM(['name: mermaid', 'portable: true', "description: 'Diagrams and flowcharts.'"]);
    const out = claudeAiTransform(input, 'mermaid');
    // The apostrophe in "registry's" must be doubled ('') per YAML single-quote escaping.
    expect(out).toContain("registry''s mermaid skill");
    expect(out).not.toContain("registry's mermaid skill");
    const descLine = out.split('\n').find((l) => l.startsWith('description:'));
    expect(descLine).toBe(
      `description: 'Diagrams and flowcharts. ${DEFERENCE_LINE('mermaid').replace(/'/g, "''")}'`
    );
    // Sanity check the result is well-formed: single-quoted scalar body has no
    // lone (unescaped) apostrophes — every ' is either the opening/closing
    // quote or part of a doubled '' pair.
    const body = descLine!.slice('description: \''.length, -1);
    expect(body.replace(/''/g, '')).not.toMatch(/'/);
  });

  it('throws when a quoted description has trailing content after its closing quote (e.g. inline comment)', () => {  // verifies R3.4 (MINOR fix)
    const input = FM(['name: x', 'portable: true', 'description: "Does things." # a comment']);
    expect(() => claudeAiTransform(input, 'x')).toThrow(/trailing content|comment/i);
  });
});
