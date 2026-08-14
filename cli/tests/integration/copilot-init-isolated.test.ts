// cli/tests/integration/copilot-init-isolated.test.ts
//
// Regression E2E for a confirmed, 100%-reproducible production bug:
// `awm init --agent copilot` crashed deterministically with
// "machine.devCore: skill global scope is not supported by Copilot..." and
// rolled back the ENTIRE init transaction (even project-local artifacts like
// AGENTS.md).
//
// Root cause: Copilot has no global skill directory
// (providers/index.ts's `skill.global === null`), so
// diagnostics/context.ts's `gatherMachine` computed `devCore.present` as
// permanently `false` for Copilot (no way to ever satisfy it). That made
// `stepDevCore` (init/steps.ts) fall through on every run and call
// `installBundle` at GLOBAL scope, which throws for a provider with no
// global skill mechanism — an install that was always guaranteed to fail.
//
// Fixed in diagnostics/context.ts: when `skillsDir === null`, there is no
// global-scope devCore/baseline-bundle concept to satisfy for this agent at
// all, so `devCorePresent` is now reported `true` (N/A treated as
// satisfied) — mirroring how `globalSkills` already treats the same
// null-skillsDir case as trivially healthy. `stepDevCore`'s existing
// `present && brokenLinks.length === 0 -> skip` guard then naturally never
// falls through to the doomed install, with no redundant guard needed in
// steps.ts itself.
//
// This test lets `awm init --agent copilot` run its REAL, unstubbed
// pipeline end-to-end against a hand-seeded registry fixture (same pattern
// as codex-provider-isolated.test.ts) — never against the real `~/.awm`
// (CLAUDE.md's "never touch ~/.awm" rule; HOME/AWM_HOME are isolated
// tmpdirs for the whole test).
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('copilot provider — isolated home E2E (devCore global-scope guard regression)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-copilot-e2e-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-copilot-e2e-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        fs.writeFileSync(path.join(tmpWork, 'package.json'), JSON.stringify({ name: 'copilot-e2e-fixture' }));
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

    /** Same fixture shape as codex-provider-isolated.test.ts's seedPublicRegistryFixture:
     *  a real content-root registry (no git repo needed) with the bootstrap skill and one
     *  baseline bundle. Copilot needs no hooks (providers/index.ts has no `hooks` config
     *  for it) and no native agent renderer (`agent: null`), so the fixture is intentionally
     *  smaller than Codex's. */
    function seedPublicRegistryFixture(root: string): void {
        fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(root, 'hooks/session-start'), '#!/bin/sh\necho "{}"\n', { mode: 0o755 });
        fs.writeFileSync(path.join(root, 'hooks/run-hook.cmd'), '#!/bin/sh\nexec sh "$1"\n', { mode: 0o755 });

        fs.mkdirSync(path.join(root, 'skills/using-awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/using-awm/SKILL.md'), '---\nname: using-awm\ndescription: Entry point for AWM skills.\n---\nMUST invoke skills.');
        fs.mkdirSync(path.join(root, 'skills/development-process'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/development-process/SKILL.md'), '---\nname: development-process\ndescription: Orchestrates the development lifecycle.\n---\nOrchestrates the dev lifecycle.');

        fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
            version: 1,
            bundles: [{ name: 'dev-core', source: 'bundles/dev-core', version: '1.0.0', scope: 'baseline', visibility: 'public' }],
        }));
        fs.mkdirSync(path.join(root, 'bundles/dev-core'), { recursive: true });
        fs.writeFileSync(path.join(root, 'bundles/dev-core/bundle.json'), JSON.stringify({
            name: 'dev-core', description: '', version: '1.0.0', scope: 'baseline', visibility: 'public',
            dependsOn: [], skills: ['development-process'], workflows: [], agents: [],
        }));

        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm/registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.invalid/baseline.git' }], null, 2),
        );
    }

    function readPrefs(): { enabledAgents: string[] } {
        return JSON.parse(fs.readFileSync(path.join(tmpHome, '.awm/preferences.json'), 'utf8'));
    }

    it('machine-only enables Copilot without writing project artifacts (R7, R15)', async () => {
        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));
        fs.rmSync(path.join(tmpWork, 'package.json'));
        const before = fs.readdirSync(tmpWork).sort();
        const { runInit } = require('../../src/commands/init');

        const code = await runInit({
            cwd: tmpWork,
            yes: true,
            agent: 'copilot',
            machineOnly: true,
        });

        expect(code).toBe(0);
        expect(readPrefs().enabledAgents).toEqual(['copilot']);
        expect(fs.readdirSync(tmpWork).sort()).toEqual(before);
        expect(fs.existsSync(path.join(tmpWork, 'AGENTS.md'))).toBe(false);
        expect(fs.existsSync(path.join(tmpWork, '.github'))).toBe(false);
        expect(fs.existsSync(path.join(tmpWork, '.awm'))).toBe(false);
    });

    it('completes without crashing/rolling back (real bug repro) and delivers content via AGENTS.md, not a doomed global-scope install', async () => {
        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));

        const { runInit } = require('../../src/commands/init');

        // Real, full, unstubbed init for copilot. Before the fix, this threw
        // "machine.devCore: skill global scope is not supported by Copilot: GitHub
        // Copilot has no user-level skill discovery mechanism — skills must be
        // installed per-project." and rolled back the whole transaction (exit 2,
        // AGENTS.md reverted, preferences never committed).
        const code = await runInit({ cwd: tmpWork, yes: true, agent: 'copilot' });

        // 0 (healthy) or 1 (degraded-but-completed) — NOT 2 (failed/rolled back).
        expect(code).toBeLessThanOrEqual(1);

        // The transaction actually committed: copilot is now a real enabled agent.
        expect(readPrefs().enabledAgents).toEqual(['copilot']);

        // Copilot has no global skill directory at all — confirm nothing was
        // (wrongly) written there, and no ~/.github tree was invented.
        expect(fs.existsSync(path.join(tmpHome, '.github'))).toBe(false);

        // Content delivery for Copilot happens via its managed-agents-md injection
        // mechanism at PROJECT scope (stepContextInjection, globalPath === null ->
        // scope 'local') — confirm that path is unaffected by this fix and still
        // really delivers the using-awm skill content into the project AGENTS.md.
        const agentsMd = fs.readFileSync(path.join(tmpWork, 'AGENTS.md'), 'utf8');
        expect(agentsMd).toContain('MUST invoke skills.');
    });

    // Regression for the SAME structural bug as the devCore one above, in the
    // sibling `ambient` computation (diagnostics/context.ts's `gatherMachine`,
    // a few lines below devCorePresent): before the fix, `installed` was
    // forced to `[]` unconditionally whenever `skillsDir === null` (Copilot),
    // regardless of what `~/.awm/config.json`'s `ambient` array wanted. That
    // made stepAmbient (init/steps.ts) treat every wanted ambient bundle as
    // permanently missing and call installBundle at GLOBAL scope for
    // Copilot — throwing "skill global scope is not supported by Copilot"
    // and rolling back the whole init transaction, exactly like the devCore
    // bug. Nothing in the current CLI writes `ambient` into
    // `~/.awm/config.json` automatically, but it IS read unconditionally by
    // production code and is a real, documented mechanism a user/script can
    // populate — so this hand-seeds it, same as a real machine config would.
    it('with a machine-level ambient bundle configured, completes without crashing/rolling back (ambient sibling of the devCore bug)', async () => {
        const registryRoot = path.join(tmpHome, '.awm/registries/baseline');
        seedPublicRegistryFixture(registryRoot);

        // Add an ambient-scope bundle to the registry fixture so `wanted`
        // resolves to real skills (resolveBundleSkills needs the bundle to
        // actually exist in `bundles`, discovered via discoverAllBundles()).
        fs.mkdirSync(path.join(registryRoot, 'skills/ambient-skill'), { recursive: true });
        fs.writeFileSync(
            path.join(registryRoot, 'skills/ambient-skill/SKILL.md'),
            '---\nname: ambient-skill\ndescription: An ambient bundle skill.\n---\nAmbient.',
        );
        const catalog = JSON.parse(fs.readFileSync(path.join(registryRoot, 'catalog.json'), 'utf8'));
        catalog.bundles.push({ name: 'personal-notion', source: 'bundles/personal-notion', version: '1.0.0', scope: 'ambient', visibility: 'public' });
        fs.writeFileSync(path.join(registryRoot, 'catalog.json'), JSON.stringify(catalog));
        fs.mkdirSync(path.join(registryRoot, 'bundles/personal-notion'), { recursive: true });
        fs.writeFileSync(path.join(registryRoot, 'bundles/personal-notion/bundle.json'), JSON.stringify({
            name: 'personal-notion', description: '', version: '1.0.0', scope: 'ambient', visibility: 'public',
            dependsOn: [], skills: ['ambient-skill'], workflows: [], agents: [],
        }));

        // Seed the machine-level ambient config exactly as a user/script would.
        fs.writeFileSync(path.join(tmpHome, '.awm/config.json'), JSON.stringify({ ambient: ['personal-notion'] }));

        const { runInit } = require('../../src/commands/init');

        // Before the fix, this threw "machine.ambient: skill global scope is
        // not supported by Copilot..." (same class as the devCore crash) and
        // rolled back the whole transaction (exit 2, AGENTS.md reverted,
        // preferences never committed).
        const code = await runInit({ cwd: tmpWork, yes: true, agent: 'copilot' });

        // 0 (healthy) or 1 (degraded-but-completed) — NOT 2 (failed/rolled back).
        expect(code).toBeLessThanOrEqual(1);

        // The transaction actually committed.
        expect(readPrefs().enabledAgents).toEqual(['copilot']);

        // Copilot has no global skill directory at all — confirm the ambient
        // bundle was NOT (wrongly) installed at global scope either.
        expect(fs.existsSync(path.join(tmpHome, '.github'))).toBe(false);
    });

    it('a subsequent `awm add <bundle> -a copilot` works once init has actually committed', async () => {
        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));

        // Add a second, non-baseline bundle the project can explicitly activate
        // locally (Copilot only supports local-scope skill delivery — providers/
        // index.ts's `skill.local: '.github/instructions'`).
        const registryRoot = path.join(tmpHome, '.awm/registries/baseline');
        fs.mkdirSync(path.join(registryRoot, 'skills/extra-skill'), { recursive: true });
        fs.writeFileSync(
            path.join(registryRoot, 'skills/extra-skill/SKILL.md'),
            '---\nname: extra-skill\ndescription: An extra project skill.\n---\nExtra.',
        );
        fs.mkdirSync(path.join(registryRoot, 'bundles/extra'), { recursive: true });
        fs.writeFileSync(path.join(registryRoot, 'bundles/extra/bundle.json'), JSON.stringify({
            name: 'extra', description: '', version: '1.0.0', scope: 'project', visibility: 'public',
            dependsOn: [], skills: ['extra-skill'], workflows: [], agents: [],
        }));
        const catalog = JSON.parse(fs.readFileSync(path.join(registryRoot, 'catalog.json'), 'utf8'));
        catalog.bundles.push({ name: 'extra', source: 'bundles/extra', version: '1.0.0', scope: 'project', visibility: 'public' });
        fs.writeFileSync(path.join(registryRoot, 'catalog.json'), JSON.stringify(catalog));

        // findProjectRoot needs a real project marker (.git/, package.json, or
        // .awm/profile.json) — a bare tmpdir isn't one (same pattern as
        // tests/commands/add.test.ts).
        fs.writeFileSync(path.join(tmpWork, 'package.json'), JSON.stringify({ name: 'fixture' }));

        const { runInit } = require('../../src/commands/init');
        const initCode = await runInit({ cwd: tmpWork, yes: true, agent: 'copilot' });
        expect(initCode).toBeLessThanOrEqual(1);
        expect(readPrefs().enabledAgents).toEqual(['copilot']);

        // This was "permanently blocked" per the bug report — it requires a prior
        // COMMITTED `awm init --agent copilot` (resolveAgentTargetsOrError rejects
        // any agent not in enabledAgents), which never happened before the fix
        // because every copilot init rolled back before saving preferences.
        const { runAddBundleCore } = require('../../src/commands/add');
        const { loadPreferences } = require('../../src/utils/config');
        const { discoverAllBundles } = require('../../src/core/bundles');
        const { prefs } = loadPreferences('copilot');
        const bundles = discoverAllBundles();

        const result = runAddBundleCore(
            { name: 'extra', agent: 'copilot', cwd: tmpWork },
            prefs,
            bundles,
        );
        expect(result.code).toBe(0);
        expect(result.result?.installed.length).toBeGreaterThan(0);

        const instructionsDir = path.join(tmpWork, '.github/instructions');
        expect(fs.existsSync(instructionsDir)).toBe(true);
    });
});
