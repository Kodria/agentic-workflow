import { parseCanonicalAgent } from '../../../src/core/renderers/canonical-agent';

// Real canonical agent content from the awm-baseline-registry (registries/baseline/agents/development-process.md),
// which the installer materializes at ~/.awm/registries/baseline/agents/development-process.md.
const canonicalWithModePrimary = `---
name: development-process
description: Use as agent profile to orchestrate the development lifecycle - invokes the development-process skill which contains the full orchestration logic
mode: primary
---

# Development Process Orchestrator

You are a development orchestrator. You do NOT write code directly.

## On Every Conversation Start

1. **Invoke the \`development-process\` skill.** This skill contains the complete orchestration logic: state detection, lifecycle phases, decision rules, and the full catalog of available skills.
2. Follow the skill's instructions exactly - it will guide you through identifying project state, recommending the next phase, and delegating to the correct skill.

## Rules

- NEVER start writing code without first invoking \`development-process\`
- NEVER duplicate orchestration logic here - the skill is the single source of truth
- NEVER invoke a downstream skill without user approval
`;

it('parses name, description, and instructions from valid frontmatter', () => {
    const source = `---
name: my-agent
description: Does a thing
---

Body text here.
`;
    expect(parseCanonicalAgent(source)).toEqual({
        name: 'my-agent',
        description: 'Does a thing',
        instructions: 'Body text here.',
    });
});

it('ignores provider-only mode while retaining canonical instructions', () => {
    const parsed = parseCanonicalAgent(canonicalWithModePrimary);
    expect(parsed).toEqual({
        name: 'development-process',
        description:
            'Use as agent profile to orchestrate the development lifecycle - invokes the development-process skill which contains the full orchestration logic',
        instructions: expect.stringContaining('You do NOT write code directly.'),
    }); // verifies R8, R9
});

it.each([
    ['---\nname: Bad Name\ndescription: x\n---\nbody', 'invalid agent name'],
    ['---\nname: ok\ndescription:\n---\nbody', 'non-empty description'],
    ['---\nname: ok\ndescription: x\n---\n', 'non-empty instruction body'],
    ['name: ok', 'frontmatter'],
    ['---\nname: ok\nnot a field\n---\nbody', 'invalid canonical agent frontmatter line'],
    ['---\nname: ok\ndescription: first\ndescription: second\n---\nbody', 'duplicate canonical agent frontmatter key: description'],
])('rejects invalid canonical agent sources', (source, message) => {
    expect(() => parseCanonicalAgent(source)).toThrow(message); // verifies R17
});
