import fs from 'fs';
import os from 'os';
import path from 'path';

describe('gatherProviderFacts / assertClaudeBaselinePreserved', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-facts-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('two snapshots of untouched state are identical (no false positive)', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');
        const before = gatherProviderFacts('claude-code');
        const after = gatherProviderFacts('claude-code');
        expect(() => assertClaudeBaselinePreserved(before, after)).not.toThrow();
        expect(before.hash).toBe(after.hash);
    });

    it('detects a top-level file change under a managed directory', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), 'original');

        const before = gatherProviderFacts('claude-code');
        fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), 'mutated');
        const after = gatherProviderFacts('claude-code');

        expect(before.hash).not.toBe(after.hash);
        expect(() => assertClaudeBaselinePreserved(before, after)).toThrow(/must never happen \(R19\)/);
    });

    it('detects a content-only change two levels deep under a managed directory', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        // .claude/skills/some-skill/nested/deep.md — two directory levels below skills/
        const nested = path.join(skillsDir, 'some-skill', 'nested');
        fs.mkdirSync(nested, { recursive: true });
        const deepFile = path.join(nested, 'deep.md');
        fs.writeFileSync(deepFile, 'original deep content');

        const before = gatherProviderFacts('claude-code');
        // Content-only mutation — no rename, no size-preserving trick needed;
        // this alone would have been invisible to a top-level-only stat digest.
        fs.writeFileSync(deepFile, 'mutated deep content');
        const after = gatherProviderFacts('claude-code');

        expect(before.hash).not.toBe(after.hash);
        expect(() => assertClaudeBaselinePreserved(before, after)).toThrow(/must never happen \(R19\)/);
    });

    it('detects an added file three levels deep without touching any existing file', () => {
        const { gatherProviderFacts } = require('../../../src/core/init/provider-facts');
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        const nested = path.join(skillsDir, 'pkg', 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(nested, 'existing.md'), 'unchanged');

        const before = gatherProviderFacts('claude-code');
        fs.writeFileSync(path.join(nested, 'new-file.md'), 'new');
        const after = gatherProviderFacts('claude-code');

        expect(before.hash).not.toBe(after.hash);
    });

    it('throws a distinct message when comparing facts for mismatched agents', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');
        const claude = gatherProviderFacts('claude-code');
        const codex = gatherProviderFacts('codex');
        expect(() => assertClaudeBaselinePreserved(claude, codex)).toThrow('mismatched agents');
    });
});
