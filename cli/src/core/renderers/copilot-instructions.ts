// src/core/renderers/copilot-instructions.ts
//
// Renders a SKILL.md source into GitHub Copilot's `.instructions.md` format.
// Copilot's instructions format is fundamentally file-glob-triggered
// (`applyTo` matches file paths against the current edit), which doesn't map
// cleanly onto AWM's trigger-phrase-based skill activation — a real format
// mismatch this task cannot fully resolve (D4: this whole tier is "context
// read, not enforced", not runtime-gated the way Claude Code's own skill
// invocation is). `applyTo: "**"` (match every file) is the practical
// default: it keeps the skill's guidance always present in Copilot's context
// rather than guessing a file-type restriction that doesn't correspond to
// anything in the skill's actual metadata. A future task revisiting this
// tier should start from this note, not rediscover the mismatch.
import { parseSkillSource } from './skill-source';

export function renderCopilotInstructions(source: string): string {
    const { body } = parseSkillSource(source);
    return [
        '---',
        'applyTo: "**"',
        '---',
        '',
        body,
        '',
    ].join('\n');
}
