import { claudeAiTransform, DEFERENCE_LINE, stripIntraRegistryPaths } from '../../../src/core/export/transform';

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

  it('cleans intra-registry paths in the body', () => {  // verifies R2.1, R2.4
    const md = [
      '---',
      'name: product-discovery',
      'version: "1.0.0"',
      'portable: true',
      'description: "Explores problem space."',
      '---',
      'Hand off to `product-brief` (see `skills/product-brief/SKILL.md`) at the end.',
      '',
    ].join('\n');
    const out = claudeAiTransform(md, 'product-discovery');
    expect(out).toContain('Hand off to `product-brief` at the end.');
    expect(out).not.toContain('skills/product-brief/SKILL.md');
  });

  it('leaves the frontmatter block free of body rewriting', () => {  // verifies R2.4
    const md = [
      '---',
      'name: weird',
      'description: "Mentions skills/readiness-gate/SKILL.md inside the description."',
      '---',
      'Body with no paths.',
      '',
    ].join('\n');
    const out = claudeAiTransform(md, 'weird');
    expect(out).toContain('Mentions skills/readiness-gate/SKILL.md inside the description.');
  });
});

describe('stripIntraRegistryPaths', () => {
  it('drops a parenthetical whose only content is a see-path', () => {  // verifies R2.1
    expect(stripIntraRegistryPaths(
      'crystallize into a `product-brief` (see `skills/product-brief/SKILL.md`) — the handoff.',
    )).toBe('crystallize into a `product-brief` — the handoff.');
  });

  it('drops a bare-path parenthetical without leaving a space before the comma', () => {  // verifies R2.1
    expect(stripIntraRegistryPaths(
      'Same discipline as `brainstorming` (see `skills/brainstorming/SKILL.md`), applied at the business level.',
    )).toBe('Same discipline as `brainstorming`, applied at the business level.');
  });

  it('drops a parenthetical holding only a references path', () => {  // verifies R2.1
    expect(stripIntraRegistryPaths(
      "conforming to the brief contract's frontmatter (`skills/readiness-gate/references/brief-contract.md`), using:",
    )).toBe("conforming to the brief contract's frontmatter, using:");
  });

  it('rewrites a path in place when the parenthetical carries more text', () => {  // verifies R2.2, R2.3
    expect(stripIntraRegistryPaths(
      'the literal YAML block below (see `skills/readiness-gate/references/brief-contract.md` for the full normative rules).',
    )).toBe(
      "the literal YAML block below (see the `readiness-gate` skill's brief contract reference for the full normative rules).",
    );
  });

  it('rewrites a bare unquoted path in prose', () => {  // verifies R2.2, R2.3
    expect(stripIntraRegistryPaths(
      'shape are normative — see skills/readiness-gate/references/brief-contract.md.',
    )).toBe("shape are normative — see the `readiness-gate` skill's brief contract reference.");
  });

  it('renders a SKILL.md path as a nameless skill reference', () => {  // verifies R2.3
    expect(stripIntraRegistryPaths('invoke `skills/readiness-gate/SKILL.md` to certify it.'))
      .toBe('invoke the `readiness-gate` skill to certify it.');
  });

  it('leaves a GitHub URL containing the same path untouched', () => {  // verifies R2.6
    const url = 'see https://github.com/Kodria/awm-baseline-registry/blob/main/skills/readiness-gate/SKILL.md for the source.';
    expect(stripIntraRegistryPaths(url)).toBe(url);
  });

  it('leaves a markdown link whose target is a URL untouched', () => {  // verifies R2.6
    const link = '[the gate](https://github.com/Kodria/awm-baseline-registry/blob/main/skills/readiness-gate/references/brief-contract.md)';
    expect(stripIntraRegistryPaths(link)).toBe(link);
  });

  it('leaves prose with no intra-registry path byte-identical', () => {  // verifies R2.2
    const body = '# Heading\n\nA body that cites `docs/plans/x.md` and nothing else.\n';
    expect(stripIntraRegistryPaths(body)).toBe(body);
  });

  it('handles several paths in one body', () => {  // verifies R2.1, R2.2
    expect(stripIntraRegistryPaths(
      'hand off to `product-brief` (`skills/product-brief/SKILL.md`) then invoke `skills/readiness-gate/SKILL.md`.',
    )).toBe('hand off to `product-brief` then invoke the `readiness-gate` skill.');
  });

  it('rewrites a path immediately following a dropped parenthetical, even with no separator', () => {  // verifies R2.1, R2.2, R2.6 (regression: two-pass splicing bug found in code review)
    // Regression guard: a naive two-pass implementation (drop parentheticals,
    // THEN rewrite bare paths on the already-mutated string) can splice a
    // URL's trailing "/" directly against this path with zero separator,
    // making the URL-embedding guard misfire and silently skip the rewrite.
    expect(stripIntraRegistryPaths(
      'See http://x.com/y/ (see `skills/a/SKILL.md`)skills/b/SKILL.md now.',
    )).toBe('See http://x.com/y/the `b` skill now.');
  });
});
