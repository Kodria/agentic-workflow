import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BundleDefinition } from '../../../src/core/bundles';

function bundle(name: string, scope: BundleDefinition['scope'], skills: string[]): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: skills.map((s) => ({ name: s, onSignal: false })),
        workflows: [], agents: [],
    };
}

describe('gatherContext', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-'));
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

    // Crea un symlink "vivo" <claudeSkills>/<skill> → un target real.
    function linkGlobalSkill(skill: string) {
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const target = path.join(tmpHome, 'targets', skill);
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(skillsDir, skill), 'dir');
    }

    it('machine: cli/hook/devCore absent on a bare HOME', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.registryCache.present).toBe(false);
        expect(ctx.machine.hook.present).toBe(false);
        expect(ctx.machine.devCore.present).toBe(false);
        expect(ctx.machine.ambient.wanted).toEqual([]);
    });

    it('machine: devCore present when baseline skills are linked globally', () => {
        linkGlobalSkill('brainstorming');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.devCore.present).toBe(true);
        expect(ctx.machine.devCore.brokenLinks).toEqual([]);
    });

    it('machine: partial install (some absent, not dangling) surfaces absent skills in brokenLinks', () => {
        linkGlobalSkill('brainstorming'); // only 1 of 2 skills linked
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming', 'another-skill'])] });
        expect(ctx.machine.devCore.present).toBe(true);
        expect(ctx.machine.devCore.brokenLinks).toContain('another-skill');
    });

    it('machine: reports a broken dev-core symlink', () => {
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.symlinkSync(path.join(tmpHome, 'targets', 'gone'), path.join(skillsDir, 'brainstorming'), 'dir');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.devCore.present).toBe(true);
        expect(ctx.machine.devCore.brokenLinks).toContain('brainstorming');
    });

    // Regression coverage for the second BLOCKER-adjacent bug found while
    // building the real Codex+OpenCode coexistence E2E test: OpenCode and
    // Codex share ~/.agents/skills, but agent-type artifacts are per-agent
    // (never shared, R12/R13). Before this fix, devCorePresent only looked
    // at the skill link, so once OpenCode's own init had already linked the
    // shared skill, Codex's gatherContext wrongly reported devCore as fully
    // present/no-broken-links even though Codex's own native .toml had never
    // been rendered — causing stepDevCore to skip forever.
    it('machine: devCore surfaces a missing per-agent artifact even when the shared skill link is already present', () => {
        const bundleWithAgent = (): BundleDefinition => ({
            name: 'dev-core', description: '', version: '1.0.0', scope: 'baseline', visibility: 'public',
            dependsOn: [], skills: [{ name: 'development-process', onSignal: false }],
            workflows: [], agents: ['development-process'],
        });
        // Simulate OpenCode having already linked the shared ~/.agents/skills dir.
        const sharedSkillsDir = path.join(tmpHome, '.agents', 'skills');
        fs.mkdirSync(sharedSkillsDir, { recursive: true });
        const target = path.join(tmpHome, 'targets', 'development-process');
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(sharedSkillsDir, 'development-process'), 'dir');

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundleWithAgent()], agent: 'codex' });
        // The skill itself is linked (shared with OpenCode)...
        expect(ctx.machine.devCore.present).toBe(true);
        // ...but Codex's own native agent artifact was never installed, so it
        // must surface as a broken/missing link — NOT a clean, skippable state.
        expect(ctx.machine.devCore.brokenLinks).toContain('development-process.toml');
    });

    // Regression for the confirmed production bug: `awm init -a copilot` crashed
    // 100% of the time with "machine.devCore: skill global scope is not
    // supported by Copilot...", rolling back the whole init transaction.
    // Copilot has no global skill directory (providers/index.ts's
    // `skill.global === null`) — before this fix, devCorePresent was
    // unconditionally false in that case (linked/broken forced to empty
    // arrays), so `machine.devCore` could never be satisfied and stepDevCore
    // (init/steps.ts) fell through to a global-scope installBundle call every
    // single run, which throws for Copilot. Now it's reported as trivially
    // satisfied ("N/A" == "nothing to do"), matching how `globalSkills`
    // already treats the same null-skillsDir case.
    it('machine: devCore is trivially satisfied (present, no broken links) for an agent with no global skill directory (copilot)', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({
            cwd: tmpHome,
            bundles: [bundle('dev-core', 'baseline', ['brainstorming'])],
            agent: 'copilot',
        });
        expect(ctx.machine.devCore.present).toBe(true);
        expect(ctx.machine.devCore.brokenLinks).toEqual([]);
    });

    it('machine: ambient wanted read from ~/.awm/config.json, installed reflects links', () => {
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'config.json'), JSON.stringify({ ambient: ['personal-notion'] }));
        linkGlobalSkill('notion-skill');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const bundles = [
            bundle('dev-core', 'baseline', ['brainstorming']),
            bundle('personal-notion', 'ambient', ['notion-skill']),
        ];
        const ctx = gatherContext({ cwd: tmpHome, bundles });
        expect(ctx.machine.ambient.wanted).toEqual(['personal-notion']);
        expect(ctx.machine.ambient.installed).toEqual(['personal-notion']);
    });

    // Regression for the SAME structural bug as the devCore fix above, just in
    // the `ambient` computation a few lines below it: Copilot has no global
    // skill directory (skill.global === null), so before this fix `installed`
    // was forced to `[]` unconditionally regardless of `wanted`. That made
    // `stepAmbient` (init/steps.ts) treat every entry in a machine-level
    // `~/.awm/config.json`'s `ambient` array as permanently missing and call
    // installBundle at GLOBAL scope for Copilot — which throws with the exact
    // same "skill global scope is not supported by Copilot" error the devCore
    // bug had, and rolls back the whole init transaction. Now `installed`
    // mirrors `wanted` when skillsDir is null (N/A treated as satisfied,
    // nothing to install), matching devCore's treatment above.
    it('machine: ambient is trivially satisfied (installed mirrors wanted) for an agent with no global skill directory (copilot)', () => {
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'config.json'), JSON.stringify({ ambient: ['personal-notion'] }));
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const bundles = [
            bundle('dev-core', 'baseline', ['brainstorming']),
            bundle('personal-notion', 'ambient', ['notion-skill']),
        ];
        const ctx = gatherContext({ cwd: tmpHome, bundles, agent: 'copilot' });
        expect(ctx.machine.ambient.wanted).toEqual(['personal-notion']);
        expect(ctx.machine.ambient.installed).toEqual(['personal-notion']);
    });

    it('machine: contextInjection empty when opencode config is absent', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [] });
        // sin ~/.config/opencode/opencode.json no se reporta ninguna fila de contexto
        expect(ctx.machine.contextInjection).toEqual([]);
    });

    it('machine: contextInjection reports opencode absent when config exists without the sentinel', () => {
        const ocDir = path.join(tmpHome, '.config', 'opencode');
        fs.mkdirSync(ocDir, { recursive: true });
        fs.writeFileSync(path.join(ocDir, 'opencode.json'),
            JSON.stringify({ $schema: 'https://opencode.ai/config.json', instructions: [] }));
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [] });
        expect(ctx.machine.contextInjection).toEqual([{ agent: 'opencode', state: 'absent' }]);
    });

    it('project: null when cwd has no project root', () => {
        // tmpHome is bare (no .git / package.json / .awm/profile.json)
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [] });
        expect(ctx.project).toBeNull();
    });

    it('project: maps profile, activation, sensors, constitution and context', () => {
        const root = path.join(tmpHome, 'repo');
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}'); // project root marker
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), JSON.stringify({ extensions: ['frontend'] }));
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{}');
        fs.writeFileSync(path.join(root, 'CONSTITUTION.md'), '# rules');
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents');
        // link the expected project skill locally
        const localSkills = path.join(root, '.claude', 'skills');
        fs.mkdirSync(localSkills, { recursive: true });
        const target = path.join(root, 'targets', 'frontend-craft');
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(localSkills, 'frontend-craft'), 'dir');

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: root, bundles: [bundle('frontend', 'project', ['frontend-craft'])] });

        expect(ctx.project).not.toBeNull();
        expect(ctx.project.profile).toEqual({ present: true, extensions: ['frontend'] });
        expect(ctx.project.activeBundles.expected).toEqual(['frontend-craft']);
        expect(ctx.project.activeBundles.linked).toEqual(['frontend-craft']);
        expect(ctx.project.activeBundles.broken).toEqual([]);
        expect(ctx.project.sensors.present).toBe(true);
        expect(ctx.project.constitution.present).toBe(true);
        expect(ctx.project.context).toEqual({ present: true, file: 'AGENTS.md' });
    });

    it('project: context prefers CLAUDE.md over AGENTS.md', () => {
        const root = path.join(tmpHome, 'repo2');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# claude');
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: root, bundles: [] });
        expect(ctx.project.context).toEqual({ present: true, file: 'CLAUDE.md' });
    });
});

describe('gatherContext — providers matrix (Task 9)', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-providers-'));
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

    function healthySharedSkills() {
        return { valid: ['development-process'], repairable: [], dead: [] };
    }

    it('reports shared skills for both owners without scanning twice', () => {
        // OpenCode and Codex both read/write ~/.agents/skills (providers/index.ts) —
        // the physical directory must be scanned once and attributed to both owners.
        const scan = jest.fn(() => healthySharedSkills());
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const report = gatherContext({ cwd: tmpHome, bundles: [], agents: ['opencode', 'codex'], scanSkills: scan });
        expect(scan).toHaveBeenCalledTimes(1);
        expect(report.providers.every((provider: { checks: { state: string }[] }) =>
            provider.checks.some((check) => check.state === 'shared'))).toBe(true);
    });

    it('marks skills.global healthy (not shared) for a single unshared provider', () => {
        const scan = jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const report = gatherContext({ cwd: tmpHome, bundles: [], agents: ['claude-code'], scanSkills: scan });
        expect(scan).toHaveBeenCalledTimes(1);
        const claude = report.providers.find((p: { id: string }) => p.id === 'claude-code');
        const skillsCheck = claude.checks.find((c: { id: string }) => c.id === 'skills.global');
        expect(skillsCheck.state).not.toBe('shared');
        expect(skillsCheck.owners).toBeUndefined();
    });
});

describe('gatherMachine — agnostic skill health (#4)', () => {
    it('classifies the target agent skills dir, not always Claude', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = home;
        try {
            jest.resetModules();
            const { gatherContext } = require('../../../src/core/diagnostics/context');

            // OpenCode skills dir gets a dangling symlink (not in the registry) → 'dead'.
            const ocSkills = path.join(home, '.agents/skills');
            fs.mkdirSync(ocSkills, { recursive: true });
            fs.symlinkSync(path.join(home, 'no-such-target'), path.join(ocSkills, 'ghost'), 'dir');

            const oc = gatherContext({ cwd: home, bundles: [], agent: 'opencode' });
            expect(oc.machine.globalSkills.dead).toContain('ghost');

            // Claude's dir is empty → its 'dead' list must NOT pick up OpenCode's orphan.
            const cc = gatherContext({ cwd: home, bundles: [], agent: 'claude-code' });
            expect(cc.machine.globalSkills.dead).not.toContain('ghost');
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
