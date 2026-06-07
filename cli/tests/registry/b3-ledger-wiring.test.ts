import fs from 'fs';
import path from 'path';

const REG = path.join(__dirname, '../../../registry/skills');
const read = (p: string) => fs.readFileSync(path.join(REG, p), 'utf-8');

describe('B-3 harness-retro is ledger-driven', () => {
    const skill = read('harness-retro/SKILL.md');

    test('reads the ledger via awm ledger list + recurring', () => {
        expect(skill).toMatch(/awm ledger list/);
        expect(skill).toMatch(/awm ledger recurring/);
    });

    test('archives the ledger when done', () => {
        expect(skill).toMatch(/awm ledger archive/);
    });

    test('no longer relies on the human "where did this fail before?" memory step', () => {
        expect(skill).not.toMatch(/Where did this pattern fail before\?/);
    });

    test('cures into AGENTS.md (agnostic) for agent-style lessons + wins, not CLAUDE.md', () => {
        expect(skill).toMatch(/AGENTS\.md/);
    });

    test('writes the awm-retro-complete marker', () => {
        expect(skill).toMatch(/awm-retro-complete/);
    });

    test('treats recurrence as a signal, not a hard >=2 gate (interactive decision)', () => {
        expect(skill).toMatch(/se(ñ|n)al|signal/i);
    });
});
