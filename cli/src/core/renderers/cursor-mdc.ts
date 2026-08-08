// src/core/renderers/cursor-mdc.ts
//
// Renders a SKILL.md source into Cursor's `.mdc` rule format. Per this
// session's D4 correction note (docs/plans/2026-08-07-team-rollout-hardening-design.md),
// Cursor's current rule frontmatter has three keys: `description`, `globs`,
// `alwaysApply`. For an individual skill rule (not the Task 4.2 always-on
// `awm.mdc` context carrier), the correct activation mode is "Agent
// Requested": `description` set to the skill's own description (so Cursor
// can decide relevance), `globs` left blank, `alwaysApply: false` — letting
// Cursor pull the skill in contextually instead of force-loading every
// installed skill's full content into every request.
import { parseSkillSource } from './skill-source';

// YAML plain scalars break on a bare colon-followed-by-space (parsed as a
// mapping), a `#` preceded by whitespace ANYWHERE in the string — not just
// at the start — (starts a comment, silently truncating everything after
// it), a leading YAML-special indicator character, or an embedded double
// quote — the same class of problem tomlString/escapeControlChars
// (codex-agent.ts) guard against for TOML, adapted to YAML's own rules.
// JSON.stringify produces a YAML-1.1/1.2-compatible double-quoted scalar
// (YAML's double-quoted flow scalar is a superset of JSON string syntax),
// so it doubles as the escaping/quoting mechanism once quoting is needed.
const YAML_UNSAFE = /:(\s|$)|(?:^|\s)#|^[\s\-?:,[\]{}#&*!|>'"%@`]|"/;

function yamlString(value: string): string {
    if (value !== value.trim() || value === '' || YAML_UNSAFE.test(value)) {
        return JSON.stringify(value);
    }
    return value;
}

export function renderCursorMdc(source: string): string {
    const { description, body } = parseSkillSource(source);
    return [
        '---',
        `description: ${yamlString(description)}`,
        'globs:',
        'alwaysApply: false',
        '---',
        '',
        body,
        '',
    ].join('\n');
}
