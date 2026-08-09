// cli/tests/core/diagnostics/provider-checks.test.ts
//
// Code-quality review follow-up on commit 8f02a00. Two real, reproduced defects:
//
// 1. CRITICAL — agentsNativeCheck/hookTrustCheck/contextGlobalCheck returned
//    `state: 'unsupported'` to mean "doesn't structurally apply to this
//    provider" (Antigravity has no agent/hooks/injection config, OpenCode has
//    no hooks, Claude Code's context.global is covered by its hook). But
//    'unsupported' is ALSO what binaryVersionCheck uses for a genuine
//    version-incompatibility failure, and both doctor's glyph logic and
//    checks.ts's DEGRADING_PROVIDER_STATES treat it as a real failure. A
//    fully-healthy claude-code-only (or opencode-only, or antigravity-only)
//    `awm doctor` run could therefore never report `overall: 'healthy'`. Fixed
//    by having those three functions return `null` (omitted entirely from
//    `checks[]`) instead of a fabricated 'unsupported' row — this file proves
//    the fix with realistic, fully-initialized single-provider fixtures, not
//    just synthetic state-literal inputs.
//
// 2. IMPORTANT — skillsGlobalCheck set `state: 'shared'` unconditionally once
//    a skills directory had more than one owner, even when it had broken/dead
//    symlinks — masking real breakage behind a green checkmark and never
//    degrading `overall`. Fixed by checking broken status BEFORE falling back
//    to 'shared'.
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('gatherProviderChecks — realistic fully-healthy single-provider fixtures', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-checks-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-checks-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    /** Seeds a registry content root with a baseline bundle carrying a skill
     *  and (optionally) a canonical agent artifact. Mirrors the fixture in
     *  tests/integration/codex-provider-isolated.test.ts. */
    function seedRegistry(root: string, opts: { withAgent: boolean; withHooks: boolean }): void {
        if (opts.withHooks) {
            fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
            fs.writeFileSync(path.join(root, 'hooks/session-start'), '#!/bin/sh\necho "{}"\n', { mode: 0o755 });
            fs.writeFileSync(path.join(root, 'hooks/run-hook.cmd'), '#!/bin/sh\nexec sh "$1"\n', { mode: 0o755 });
        }
        fs.mkdirSync(path.join(root, 'skills/using-awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/using-awm/SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
        fs.mkdirSync(path.join(root, 'skills/development-process'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/development-process/SKILL.md'), '---\nname: development-process\n---\nBody.');

        const agents: string[] = [];
        if (opts.withAgent) {
            agents.push('development-process');
            fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
            fs.writeFileSync(
                path.join(root, 'agents/development-process.md'),
                '---\nname: development-process\ndescription: Orchestrates the dev lifecycle.\n---\nBody.',
            );
        }

        fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
            version: 1,
            bundles: [{ name: 'dev-core', source: 'bundles/dev-core', version: '1.0.0', scope: 'baseline', visibility: 'public' }],
        }));
        fs.mkdirSync(path.join(root, 'bundles/dev-core'), { recursive: true });
        fs.writeFileSync(path.join(root, 'bundles/dev-core/bundle.json'), JSON.stringify({
            name: 'dev-core', description: '', version: '1.0.0', scope: 'baseline', visibility: 'public',
            dependsOn: [], skills: ['development-process'], workflows: [], agents,
        }));

        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm/registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.invalid/baseline.git' }], null, 2),
        );
    }

    it('claude-code-only, fully initialized via a real `awm init`, reports overall: healthy', async () => {
        seedRegistry(path.join(tmpHome, '.awm/registries/baseline'), { withAgent: true, withHooks: true });

        const { runInit } = require('../../../src/commands/init');
        const code = await runInit({ cwd: tmpWork, yes: true });
        expect(code).toBeLessThanOrEqual(1);

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const { computeProviderOverall } = require('../../../src/core/diagnostics/checks');
        const ctx = gatherContext({ cwd: tmpWork, agents: ['claude-code'] });

        expect(computeProviderOverall(ctx.providers)).toBe('healthy');
        const claude = ctx.providers[0];
        // Claude's context.global is deliberately omitted (covered by hook.trust),
        // not rendered as a fabricated 'unsupported' row.
        expect(claude.checks.map((c: { id: string }) => c.id)).not.toContain('context.global');
        expect(claude.checks.every((c: { state: string }) =>
            !['unsupported', 'missing', 'broken', 'absent', 'conflict'].includes(c.state))).toBe(true);
    });

    it('opencode-only, fully installed via the real install/injection pipeline, reports overall: healthy', () => {
        seedRegistry(path.join(tmpHome, '.awm/registries/baseline'), { withAgent: true, withHooks: false });

        // OpenCode has no hook config — routed directly through the same real
        // installBundle/InjectionOrchestrator functions `awm init` itself calls,
        // rather than through runInit's step orchestration (a separate,
        // pre-existing gap — stepHook unconditionally attempts a hook install
        // for every agent, including ones with no hook mechanism at all — is out
        // of scope for this fix and reported separately).
        const { installBundle } = require('../../../src/core/bundle-install');
        const { discoverAllBundles } = require('../../../src/core/bundles');
        const { contentRoots } = require('../../../src/core/registries');
        const { InjectionOrchestrator } = require('../../../src/core/context/orchestrator');

        const bundles = discoverAllBundles();
        const contentDir = contentRoots()[0];
        installBundle({ bundleName: 'dev-core', bundles, agents: ['opencode'], method: 'symlink', projectRoot: tmpWork, contentDir });
        new InjectionOrchestrator().installContext({
            agent: 'opencode', scope: 'global', registryRoot: contentDir, installMethod: 'symlink', profileExtensions: [],
        });

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const { computeProviderOverall } = require('../../../src/core/diagnostics/checks');
        const ctx = gatherContext({ cwd: tmpWork, agents: ['opencode'] });

        expect(computeProviderOverall(ctx.providers)).toBe('healthy');
        const opencode = ctx.providers[0];
        // OpenCode has no hooks — omitted, not a fabricated 'unsupported' row.
        expect(opencode.checks.map((c: { id: string }) => c.id)).not.toContain('hook.trust');
    });

    it('antigravity-only, fully installed via the real install pipeline, reports overall: healthy', () => {
        seedRegistry(path.join(tmpHome, '.awm/registries/baseline'), { withAgent: false, withHooks: false });

        const { installBundle } = require('../../../src/core/bundle-install');
        const { discoverAllBundles } = require('../../../src/core/bundles');
        const { contentRoots } = require('../../../src/core/registries');

        const bundles = discoverAllBundles();
        installBundle({ bundleName: 'dev-core', bundles, agents: ['antigravity'], method: 'symlink', projectRoot: tmpWork, contentDir: contentRoots()[0] });

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const { computeProviderOverall } = require('../../../src/core/diagnostics/checks');
        const ctx = gatherContext({ cwd: tmpWork, agents: ['antigravity'] });

        expect(computeProviderOverall(ctx.providers)).toBe('healthy');
        const antigravity = ctx.providers[0];
        // Antigravity has no agent/hooks/injection config at all — all three
        // checks omitted, not fabricated 'unsupported' rows. Only binary.version
        // and skills.global structurally apply.
        expect(antigravity.checks.map((c: { id: string }) => c.id).sort())
            .toEqual(['binary.version', 'skills.global']);
    });
});

describe('gatherProviderChecks — shared skills.global does not mask broken links', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-checks-shared-'));
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

    it('reports a degraded (not shared) skills.global state when the shared dir has broken links', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const { computeProviderOverall } = require('../../../src/core/diagnostics/checks');

        // OpenCode and Codex share ~/.agents/skills (providers/index.ts). Stub the
        // scan to report 2 broken/dead links on that shared directory.
        const scanSkills = jest.fn(() => ({ valid: ['ok-skill'], repairable: ['stale-skill'], dead: ['ghost-skill'], usurped: [] }));
        const ctx = gatherContext({ cwd: tmpHome, bundles: [], agents: ['opencode', 'codex'], scanSkills });

        expect(scanSkills).toHaveBeenCalledTimes(1);
        for (const provider of ctx.providers) {
            const skillsCheck = provider.checks.find((c: { id: string }) => c.id === 'skills.global');
            expect(skillsCheck.state).toBe('broken'); // NOT 'shared' — must not mask the breakage
            expect(skillsCheck.owners).toEqual(['opencode', 'codex']); // still reports the shared ownership
            expect(skillsCheck.detail).toContain('2 broken links');
            expect(skillsCheck.remediationCode).toBe('repair-global-skills');
        }
        expect(computeProviderOverall(ctx.providers)).toBe('degraded');
    });

    it('still reports shared (healthy, non-degrading) when the shared dir has no broken links', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const { computeProviderOverall } = require('../../../src/core/diagnostics/checks');

        const scanSkills = jest.fn(() => ({ valid: ['ok-skill'], repairable: [], dead: [], usurped: [] }));
        const ctx = gatherContext({ cwd: tmpHome, bundles: [], agents: ['opencode', 'codex'], scanSkills });

        for (const provider of ctx.providers) {
            const skillsCheck = provider.checks.find((c: { id: string }) => c.id === 'skills.global');
            expect(skillsCheck.state).toBe('shared');
        }
        // Other checks (binary.version missing codex, hook.trust absent, etc.) may
        // still degrade `overall` on a bare HOME — this test only pins that a
        // HEALTHY shared skills dir itself reports 'shared', not a false positive.
        const skillsStates = ctx.providers.map((p: { checks: { id: string; state: string }[] }) =>
            p.checks.find((c) => c.id === 'skills.global')!.state);
        expect(skillsStates).toEqual(['shared', 'shared']);
    });
});

describe('gatherProviderChecks — agents.native reports broken on a malformed Codex .toml', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-checks-broken-agent-'));
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

    it('reports state: broken and remediationCode: reinstall-native-agents for a hand-edited/truncated .toml', () => {
        // Codex's agent renderer is 'codex-agent-toml' (providers/index.ts) — its global
        // dir is ~/.codex/agents. tomlAgentsHealthy (provider-checks.ts) treats a .toml as
        // broken when it can't be read, or when it's missing the `developer_instructions = `
        // key that renderCodexAgent (Task 4) always emits — i.e. hand-edited/truncated.
        const agentsDir = path.join(tmpHome, '.codex/agents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(
            path.join(agentsDir, 'development-process.toml'),
            'name = "development-process"\n# missing the developer_instructions key entirely\n',
        );

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
        const ctx = gatherContext({ cwd: tmpHome, bundles: [], agents: ['codex'], scanSkills });

        const codex = ctx.providers.find((p: { id: string }) => p.id === 'codex');
        const agentsNative = codex.checks.find((c: { id: string }) => c.id === 'agents.native');
        expect(agentsNative).toMatchObject({
            id: 'agents.native',
            state: 'broken',
            target: agentsDir,
            detail: '1 malformed .toml',
            remediationCode: 'reinstall-native-agents',
        });
    });
});
