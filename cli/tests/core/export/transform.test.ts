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

  it('throws on missing frontmatter block', () => {  // verifies R3.4
    expect(() => claudeAiTransform('No frontmatter here.', 'x')).toThrow(/frontmatter/);
  });

  it('throws on frontmatter without description', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'portable: true']), 'x')).toThrow(/description/);
  });

  it('throws on multi-line (block scalar) description', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'description: >', '  folded text']), 'x')).toThrow(/single-line/);
  });
});
