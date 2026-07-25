// Structural regression guard for the recurring class of bug found across
// multiple review rounds in this repo's history (harness-retro,
// 2026-07-25 — codex-cli-provider-plan): the Codex TOML renderer's
// character-escaping was fixed piecemeal, one control character at a time
// (quote runs, then DEL, then the rest of the C0 range), because each fix
// only tested the specific character it addressed rather than the full
// class. This test exercises the ENTIRE character class the renderer must
// escape in one pass, so a future partial regression (e.g. someone "fixing"
// tomlMultiline for a new case and narrowing the character class by
// accident) fails immediately instead of waiting for another review round
// to notice one more missed code point.
//
// Deliberately does not import the renderer's private helpers (tomlString/
// tomlMultiline aren't exported) — it drives the same public entry point
// (`renderCodexAgent`) real callers use, and inspects the actual TOML text.

import { renderCodexAgent } from '../../src/core/renderers/codex-agent';

// Every C0 control character other than tab (0x09) and newline (0x0A), plus
// DEL (0x7F) — the full set TOML requires escaping in both single-line and
// multi-line basic strings.
const REQUIRES_ESCAPE: number[] = [
    ...Array.from({ length: 0x09 }, (_, i) => i),      // 0x00-0x08
    ...Array.from({ length: 0x1f - 0x0b + 1 }, (_, i) => 0x0b + i), // 0x0B-0x1F
    0x7f,
];

function canonicalAgentWith(instructions: string, description = 'd'): string {
    return `---\nname: test-agent\ndescription: ${description}\n---\n\n${instructions}\n`;
}

// A run of embedded quotes long enough to exercise the original critical bug
// (a naive `/"""/g` replace mis-escaped runs whose length was >3 and not a
// multiple of 3 — e.g. 4, 5, 7, 8 consecutive quotes).
const QUOTE_RUN_LENGTHS = [1, 3, 4, 5, 7, 8];

describe('codex-agent renderer — escaping completeness (structural)', () => {
    it('escapes every C0-minus-tab/newline control character and DEL as \\uXXXX in developer_instructions', () => {
        const body = REQUIRES_ESCAPE.map((code) => `x${String.fromCharCode(code)}y`).join('|');
        const toml = renderCodexAgent(canonicalAgentWith(body));

        for (const code of REQUIRES_ESCAPE) {
            const raw = String.fromCharCode(code);
            expect(toml).not.toContain(raw); // no literal control byte survives
            const escape = `\\u${code.toString(16).padStart(4, '0')}`;
            expect(toml).toContain(escape);
        }
    });

    it('never leaves a run of 3+ unescaped double quotes for any embedded quote-run length', () => {
        for (const length of QUOTE_RUN_LENGTHS) {
            const body = `before ${'"'.repeat(length)} after`;
            const toml = renderCodexAgent(canonicalAgentWith(body));

            // Strip the legitimate opening/closing """ delimiters, then confirm
            // no 3-consecutive-unescaped-quote run remains inside the body —
            // that would prematurely close a TOML multi-line basic string.
            const startMarker = 'developer_instructions = """\n';
            const start = toml.indexOf(startMarker) + startMarker.length;
            const end = toml.lastIndexOf('\n"""');
            const rendered = toml.slice(start, end);
            expect(rendered).not.toMatch(/(?<!\\)"""/);
        }
    });

    it('tab and newline stay raw (legitimately unescaped in a TOML multi-line basic string)', () => {
        const toml = renderCodexAgent(canonicalAgentWith('line one\twith tab\nline two'));
        expect(toml).toContain('line one\twith tab\nline two');
    });

    it('produces output parseable as a TOML multi-line basic string boundary (no stray raw quote runs at all)', () => {
        // Combine control chars + quotes + backslashes in one body — the
        // realistic worst case, not just each hazard in isolation.
        const body = `a\\b"""c${String.fromCharCode(0x00)}d${String.fromCharCode(0x1f)}e${String.fromCharCode(0x7f)}f`;
        const toml = renderCodexAgent(canonicalAgentWith(body));
        const startMarker = 'developer_instructions = """\n';
        const start = toml.indexOf(startMarker) + startMarker.length;
        const end = toml.lastIndexOf('\n"""');
        const rendered = toml.slice(start, end);
        expect(rendered).not.toMatch(/(?<!\\)"""/);
        expect(rendered).not.toContain(String.fromCharCode(0x00));
        expect(rendered).not.toContain(String.fromCharCode(0x1f));
        expect(rendered).not.toContain(String.fromCharCode(0x7f));
    });
});
