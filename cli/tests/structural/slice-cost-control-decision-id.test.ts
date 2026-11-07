import fs from 'fs';
import path from 'path';

/**
 * Objective gate for RF-6.4 / S6: D-026 must exist as a decision heading and
 * appear in the index table. Phrase matching of policy prose is intentionally
 * out of scope (P2 / #239).
 */
const ROOT = path.resolve(__dirname, '../../..');
const DECISIONS = path.join(ROOT, 'docs/decisions.md');

describe('slice-cost-control decision id (D-026)', () => {
    const text = fs.readFileSync(DECISIONS, 'utf8');

    it('has heading ## D-026', () => {
        expect(text).toMatch(/^## D-026\s*$/m);
    });

    it('has table link [D-026](#d-026)', () => {
        expect(text).toContain('[D-026](#d-026)');
    });
});
