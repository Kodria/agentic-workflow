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

    it('Gap C — gatherProviderFacts skips a null skill.global (copilot) cleanly instead of crashing', () => {
        const { gatherProviderFacts } = require('../../../src/core/init/provider-facts');
        const { providerFor } = require('../../../src/providers');
        expect(providerFor('copilot').skill.global).toBeNull();

        const { assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');
        const facts = gatherProviderFacts('copilot');

        // providerManagedPaths guards `provider.skill.global !== null` (and every
        // other managed path copilot lacks: no hooks, no global injection, no
        // workflow/agent config) before adding anything — copilot manages NOTHING
        // at the machine level, so the inspected path list is empty, and the call
        // itself must not throw.
        expect(facts.paths).toEqual([]);
        expect(typeof facts.hash).toBe('string');

        // Two snapshots of the same (empty) state are still identical/no-throw.
        expect(() => assertClaudeBaselinePreserved(facts, facts)).not.toThrow();
    });

    it('throws a distinct message when comparing facts for mismatched agents', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');
        const claude = gatherProviderFacts('claude-code');
        const codex = gatherProviderFacts('codex');
        expect(() => assertClaudeBaselinePreserved(claude, codex)).toThrow('mismatched agents');
    });

    // -----------------------------------------------------------------------
    // Nested-scriptsDir exclusion (Task 9 fix) — Codex's hook scriptsDir
    // (~/.awm/hooks/codex) is physically nested inside Claude's own hook
    // scriptsDir (~/.awm/hooks — providers/index.ts). A naive recursive hash
    // of Claude's scriptsDir would pick up every Codex hook write as a
    // "Claude baseline changed" false positive. These two tests pin that
    // exclusion directly, rather than relying only on the E2E's indirect
    // before/after tree-snapshot check.
    // -----------------------------------------------------------------------

    it('does NOT flag a write inside Codex\'s nested scriptsDir as a Claude baseline change', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');

        // Seed Claude's own scriptsDir first (mirrors a real prior Claude hook install).
        const claudeScripts = path.join(tmpHome, '.awm', 'hooks');
        fs.mkdirSync(claudeScripts, { recursive: true });
        fs.writeFileSync(path.join(claudeScripts, 'session-start'), '#!/bin/sh\n');
        fs.writeFileSync(path.join(claudeScripts, 'run-hook.cmd'), '#!/bin/sh\n');

        const before = gatherProviderFacts('claude-code');

        // Codex's own scriptsDir is nested one level inside Claude's — simulate a
        // real Codex hook install writing there for the first time.
        const codexScripts = path.join(tmpHome, '.awm', 'hooks', 'codex');
        fs.mkdirSync(codexScripts, { recursive: true });
        fs.writeFileSync(path.join(codexScripts, 'session-start'), '#!/bin/sh\necho codex\n');

        const afterAdd = gatherProviderFacts('claude-code');
        expect(afterAdd.hash).toBe(before.hash);
        expect(() => assertClaudeBaselinePreserved(before, afterAdd)).not.toThrow();

        // Modifying the Codex-owned nested file's content must also stay invisible.
        fs.writeFileSync(path.join(codexScripts, 'session-start'), '#!/bin/sh\necho codex v2\n');
        const afterModify = gatherProviderFacts('claude-code');
        expect(afterModify.hash).toBe(before.hash);
        expect(() => assertClaudeBaselinePreserved(before, afterModify)).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // Codex-only bootstrap: Claude's scriptsDir has NEVER existed.
    //
    // Every nested-exclusion test above seeds ~/.awm/hooks first, so they only
    // ever exercise the present→present transition. On a fresh Codex-only
    // machine (a cloud box, the actual rollout target) that directory does not
    // exist, and installing the Codex hook creates it as a side effect of
    // `mkdirSync(dirname, {recursive:true})` in syncExecutable — flipping
    // Claude's own scriptsDir from absent to present-but-empty. That is not a
    // change to anything Claude owns, but it moved the hash and aborted init.
    // -----------------------------------------------------------------------

    it('does NOT flag Codex creating its nested scriptsDir when Claude\'s has never existed', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');

        const claudeScripts = path.join(tmpHome, '.awm', 'hooks');
        expect(fs.existsSync(claudeScripts)).toBe(false);

        const before = gatherProviderFacts('claude-code');

        // Exactly what syncExecutable does for the Codex hook: one recursive
        // mkdir that necessarily materializes Claude's hooks/ as the parent.
        const codexScripts = path.join(claudeScripts, 'codex');
        fs.mkdirSync(codexScripts, { recursive: true });
        fs.writeFileSync(path.join(codexScripts, 'session-start'), '#!/bin/sh\necho codex\n');

        const after = gatherProviderFacts('claude-code');
        expect(after.hash).toBe(before.hash);
        expect(() => assertClaudeBaselinePreserved(before, after)).not.toThrow();
    });

    it('still flags real Claude content appearing where the directory did not exist', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');

        const before = gatherProviderFacts('claude-code');

        // The guard must not be relaxed into blindness: an absent directory
        // gaining Claude-owned content is still a genuine baseline change.
        const claudeScripts = path.join(tmpHome, '.awm', 'hooks');
        fs.mkdirSync(claudeScripts, { recursive: true });
        fs.writeFileSync(path.join(claudeScripts, 'session-start'), '#!/bin/sh\n');

        const after = gatherProviderFacts('claude-code');
        expect(after.hash).not.toBe(before.hash);
        expect(() => assertClaudeBaselinePreserved(before, after)).toThrow(/must never happen \(R19\)/);
    });

    it('still flags Claude content being emptied out of an existing directory', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');

        const claudeScripts = path.join(tmpHome, '.awm', 'hooks');
        fs.mkdirSync(claudeScripts, { recursive: true });
        fs.writeFileSync(path.join(claudeScripts, 'session-start'), '#!/bin/sh\n');

        const before = gatherProviderFacts('claude-code');
        fs.rmSync(path.join(claudeScripts, 'session-start'));

        const after = gatherProviderFacts('claude-code');
        expect(after.hash).not.toBe(before.hash);
        expect(() => assertClaudeBaselinePreserved(before, after)).toThrow(/must never happen \(R19\)/);
    });

    it('still flags a genuinely Claude-owned change alongside an untouched Codex nested dir', () => {
        const { gatherProviderFacts, assertClaudeBaselinePreserved } = require('../../../src/core/init/provider-facts');

        const claudeScripts = path.join(tmpHome, '.awm', 'hooks');
        const codexScripts = path.join(claudeScripts, 'codex');
        fs.mkdirSync(codexScripts, { recursive: true });
        fs.writeFileSync(path.join(claudeScripts, 'session-start'), '#!/bin/sh\n');
        fs.writeFileSync(path.join(codexScripts, 'session-start'), '#!/bin/sh\necho codex\n');

        const before = gatherProviderFacts('claude-code');

        // A genuinely Claude-owned file (a sibling of the codex/ subdir, not inside it)
        // changes — the exclusion must not swallow this.
        fs.writeFileSync(path.join(claudeScripts, 'session-start'), '#!/bin/sh\necho mutated claude script\n');
        const after = gatherProviderFacts('claude-code');

        expect(after.hash).not.toBe(before.hash);
        expect(() => assertClaudeBaselinePreserved(before, after)).toThrow(/must never happen \(R19\)/);
    });
});
