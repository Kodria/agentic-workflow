import fs from 'fs';
import path from 'path';

/**
 * CMD-DECISION — RF-D.1 `--slice` / `closureOnly` cycle policy in docs/decisions.md.
 *
 * Section-scoped: index-table mentions alone must not satisfy the body asserts.
 */

const repoRoot = path.resolve(__dirname, '../../..');
const decisionsPath = path.join(repoRoot, 'docs', 'decisions.md');

const DECISION_ID = 'D-025';
const DECISION_HEADING = `## ${DECISION_ID}`;
const COMPANION_PLAN = 'docs/plans/2026-10-27-sensor-execution-optimization-registry-plan.md';

function readDecisions(): string {
    return fs.readFileSync(decisionsPath, 'utf8');
}

/** Body of ## D-025 through the next ## D- or EOF. */
function decisionBody(text: string): string {
    const start = text.indexOf(DECISION_HEADING);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const next = rest.search(/\n## D-\d+/);
    return next === -1 ? rest : rest.slice(0, next);
}

describe('sensor slice decision contract (CMD-DECISION / RF-D.1)', () => {
    it('indexes D-025 in the decisions table', () => {
        const text = readDecisions();
        const tableEnd = text.indexOf('\n---\n');
        expect(tableEnd).toBeGreaterThan(0);
        const table = text.slice(0, tableEnd);

        expect(table).toMatch(
            new RegExp(`\\[D-025\\]\\(#d-025\\)[^\n]*--slice[^\n]*closureOnly|\\[D-025\\]\\(#d-025\\)[^\n]*closureOnly[^\n]*--slice`, 'i'),
        );
        expect(table).toMatch(/\| \[D-025\]\(#d-025\) \| 2026-10-27 \|/);
    });

    it('records --slice + closureOnly cycle policy and forbids partial selection as closure evidence', () => {
        const body = decisionBody(readDecisions());

        expect(body).toMatch(/--slice/);
        expect(body).toMatch(/closureOnly/);
        // DONE of a slice requires `awm sensors run --slice` + overall pass — not a loose
        // "slice…DONE" / "DONE…--slice" alternation that surviving prose elsewhere could satisfy.
        expect(body).toMatch(
            /(?:Task\s*\/\s*slice|slice)\s+DONE:\s*`awm sensors run --slice`[\s\S]{0,80}overall:\s*`?pass`?/i,
        );
        expect(body).toMatch(
            /(?:full[- ]gate|full run|no --slice)[\s\S]{0,200}(?:QA|docs|finish|Change Record)|(?:QA|docs|finish|Change Record)[\s\S]{0,200}(?:full[- ]gate|full run)/i,
        );

        // Partial flags are never closure evidence — all four must sit in that rule
        // (section-scoped to D-025 body; deleting the bullet fails).
        expect(body).toMatch(
            /`--slice`[\s\S]{0,100}`--fast`[\s\S]{0,100}`--slow`[\s\S]{0,100}`--changed`[\s\S]{0,160}(?:nunca|never)[\s\S]{0,100}closure/i,
        );
    });

    it('points to the registry companion plan for skill wording', () => {
        const body = decisionBody(readDecisions());

        expect(body).toContain(COMPANION_PLAN);
        expect(body).toMatch(/awm-baseline-registry/);
        expect(body).toMatch(/skill/i);
    });

    it('avoids incomplete-prose sentinels in the decision body', () => {
        const body = decisionBody(readDecisions());
        expect(body).not.toMatch(/\bTODO\b/);
        expect(body).not.toMatch(/\bTBD\b/);
        expect(body).not.toMatch(/\bplaceholder\b/i);
        expect(body).not.toMatch(/\bdraft\b/i);
    });
});
