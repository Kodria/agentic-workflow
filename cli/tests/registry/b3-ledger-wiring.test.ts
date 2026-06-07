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

describe('B-3 capture wiring — phases append to the ledger', () => {
    test('SDD spec reviewer emits findings AND wins to the ledger', () => {
        const p = read('subagent-driven-development/spec-reviewer-prompt.md');
        expect(p).toMatch(/awm ledger add/);
        expect(p).toMatch(/--polarity finding/);
        expect(p).toMatch(/--polarity win/);
    });

    test('SDD code-quality reviewer emits findings AND wins to the ledger', () => {
        const p = read('subagent-driven-development/code-quality-reviewer-prompt.md');
        expect(p).toMatch(/awm ledger add/);
        expect(p).toMatch(/--polarity win/);
    });

    test('post-qa deep-review emits findings AND wins to the ledger', () => {
        const p = read('post-implementation-qa/deep-review-prompt.md');
        expect(p).toMatch(/awm ledger add/);
        expect(p).toMatch(/--polarity win/);
    });

    test('verification-before-completion logs recurring sensor failures', () => {
        const p = read('verification-before-completion/SKILL.md');
        expect(p).toMatch(/awm ledger add/);
    });

    test('systematic-debugging logs the confirmed root cause', () => {
        const p = read('systematic-debugging/SKILL.md');
        expect(p).toMatch(/awm ledger add/);
    });
});

describe('B-3 development-process routes harness-retro as a terminal phase', () => {
    const skill = read('development-process/SKILL.md');

    test('harness-retro appears as a pipeline phase between QA and finishing', () => {
        const qaIdx = skill.indexOf('post-implementation-qa');
        const retroIdx = skill.indexOf('harness-retro');
        const finishIdx = skill.indexOf('finishing-a-development-branch');
        expect(retroIdx).toBeGreaterThan(-1);
        expect(qaIdx).toBeLessThan(retroIdx);
        expect(retroIdx).toBeLessThan(finishIdx);
        // Also assert the routing edge exists (not just node declarations)
        expect(skill).toMatch(/post-implementation-qa.*harness-retro|harness-retro.*post-implementation-qa/s);
        expect(skill).toMatch(/harness-retro.*finishing-a-development-branch|finishing-a-development-branch.*harness-retro/s);
    });

    test('routing keys on the awm-retro-complete marker', () => {
        expect(skill).toMatch(/awm-retro-complete/);
    });
});
