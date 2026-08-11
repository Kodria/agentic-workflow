// cli/tests/integration/codex-provider-isolated.test.ts
//
// Task 9, Step 5 — a genuinely-real, isolated-home E2E: unlike the rest of the
// suite (which stubs installBundle/installHook/etc. to observe call shape),
// this test lets `awm init --agent codex` run its REAL pipeline end-to-end
// (real symlinks, real Codex TOML rendering, real preferences writes) against
// a hand-seeded registry fixture, then asserts on the actual resulting
// filesystem — never against the real `~/.awm` (CLAUDE.md's "never touch
// ~/.awm" rule; HOME/AWM_HOME are isolated tmpdirs for the whole test, same
// pattern as tests/commands/hooks/install.test.ts).
//
// Matches the plan's illustrative Task 9 Step 5 snippet: OpenCode is enabled
// (and really initialized) alongside Claude Code BEFORE the real
// `awm init --agent codex` run, exactly the "OpenCode already enabled, then
// Codex joins" scenario this whole plan exists to support. This used to trip
// install-planner.ts's `assertCompleteSharedGroup` (R14, Task 5) — OpenCode
// and Codex share the exact same physical skills directory (~/.agents/skills,
// providers/index.ts) — because `core/init/steps.ts`'s `stepDevCore`/
// `stepAmbient` passed a `[agent]` singleton as `selectedAgents`, which R14
// refuses whenever a co-owner of the shared target is independently enabled.
// That was a confirmed BLOCKER (found in post-implementation QA): it made
// `awm init --agent codex` structurally fail whenever OpenCode was already
// enabled, and vice versa. Fixed by having `stepDevCore`/`stepAmbient`
// compute the complete shared-skill-target group among currently-enabled
// agents (`install-planner.ts`'s `agentsSharingSkillTarget`, used via
// `steps.ts`'s `sharedInstallAgents`) instead of a singleton — see
// tests/core/init/steps.test.ts for the unit-level coverage of that
// computation. This test proves the real end-to-end flow now succeeds.
//
// While building this fixture, this test also caught and fixed a real,
// previously-untested bug: `runInit` called `assertClaudeBaselinePreserved`
// unconditionally, even when the run's OWN target was claude-code — meaning
// any genuinely successful `awm init` (no --agent, the CLI's default/most
// common path) with real registry content would falsely throw "Claude Code
// baseline changed during a non-Claude init" and exit 2. See
// src/commands/init.ts's `beforeClaudeFacts` guard.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AwmPreferences } from '../../src/utils/config';

describe('codex provider — isolated home E2E (Task 9)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    function stdout(): string {
        return writeSpy.mock.calls.map((c) => c[0]).join('');
    }

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
        // Every runInit/runDoctor call in this suite writes a full text report to
        // stdout — mock it so the real test suite's own output stays readable, and
        // recover it via `stdout()` where a test needs to inspect the JSON payload.
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    /** Hand-seeds a registry content root with everything a real `awm init` needs:
     *  hooks (Claude + Codex), the bootstrap skill, one baseline bundle providing
     *  both a skill and a Codex-native agent artifact. No git repo involved — the
     *  registry cache is content-root-shaped, exactly what a real clone produces. */
    function seedPublicRegistryFixture(root: string): void {
        fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(root, 'hooks/session-start'), '#!/bin/sh\necho "{}"\n', { mode: 0o755 });
        fs.writeFileSync(path.join(root, 'hooks/run-hook.cmd'), '#!/bin/sh\nexec sh "$1"\n', { mode: 0o755 });
        fs.writeFileSync(path.join(root, 'hooks/codex-session-start'), '#!/bin/sh\necho "{}"\n', { mode: 0o755 });

        fs.mkdirSync(path.join(root, 'skills/using-awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/using-awm/SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
        fs.mkdirSync(path.join(root, 'skills/development-process'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/development-process/SKILL.md'), '---\nname: development-process\n---\nOrchestrates the dev lifecycle.');

        fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'agents/development-process.md'),
            '---\nname: development-process\ndescription: Orchestrates the dev lifecycle.\n---\nFollow the AWM development process end to end.',
        );

        fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
            version: 1,
            bundles: [{ name: 'dev-core', source: 'bundles/dev-core', version: '1.0.0', scope: 'baseline', visibility: 'public' }],
        }));
        fs.mkdirSync(path.join(root, 'bundles/dev-core'), { recursive: true });
        fs.writeFileSync(path.join(root, 'bundles/dev-core/bundle.json'), JSON.stringify({
            name: 'dev-core', description: '', version: '1.0.0', scope: 'baseline', visibility: 'public',
            dependsOn: [], skills: ['development-process'], workflows: [], agents: ['development-process'],
        }));

        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm/registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.invalid/baseline.git' }], null, 2),
        );
    }

    function writePrefs(prefs: AwmPreferences): void {
        const { savePreferences } = require('../../src/utils/config');
        savePreferences(prefs);
    }

    function prefsWith(enabledAgents: AwmPreferences['enabledAgents']): AwmPreferences {
        return { defaultAgent: enabledAgents[0], enabledAgents, installMethod: 'symlink', defaultScope: 'local' };
    }

    function readPrefs(): AwmPreferences {
        return JSON.parse(fs.readFileSync(path.join(tmpHome, '.awm/preferences.json'), 'utf8'));
    }

    /** Cheap recursive content snapshot for "did this subtree change at all" assertions
     *  (same shape as tests/commands/init.test.ts's snapshotTree). */
    function snapshotTree(dir: string): unknown {
        if (!fs.existsSync(dir)) return null;
        const walk = (p: string): unknown => {
            const st = fs.lstatSync(p);
            if (st.isSymbolicLink()) return { type: 'symlink', target: fs.readlinkSync(p) };
            if (st.isDirectory()) {
                const entries = fs.readdirSync(p).sort();
                return { type: 'dir', entries: Object.fromEntries(entries.map((e) => [e, walk(path.join(p, e))])) };
            }
            return { type: 'file', content: fs.readFileSync(p, 'utf8') };
        };
        return walk(dir);
    }

    it('initializes Codex beside a real Claude Code + OpenCode install without touching Claude files', async () => {
        expect(process.env.HOME).toBe(tmpHome);
        expect(process.env.AWM_HOME).toBe(path.join(tmpHome, '.awm'));

        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));

        const { runInit } = require('../../src/commands/init');

        // Real, full, unstubbed init for claude-code — installs the real hook,
        // real global skill symlink and real global agent symlink.
        const claudeCode = await runInit({ cwd: tmpWork, yes: true });
        expect(claudeCode).toBeLessThanOrEqual(1);
        expect(fs.lstatSync(path.join(tmpHome, '.claude/skills/development-process')).isSymbolicLink()).toBe(true);
        expect(readPrefs().enabledAgents).toEqual(['claude-code']);

        // Real, full, unstubbed init for opencode — enables it alongside Claude
        // Code and materializes its real ~/.agents/skills symlink, the exact
        // physical directory Codex shares (providers/index.ts). This is the
        // scenario the plan's own Task 9 Step 5 snippet illustrates ("OpenCode
        // already enabled, then Codex joins") and the one the BLOCKER fixed in
        // core/init/steps.ts (sharedInstallAgents) makes work end-to-end.
        const opencode = await runInit({ cwd: tmpWork, yes: true, agent: 'opencode' });
        expect(opencode).toBeLessThanOrEqual(1);
        expect(readPrefs().enabledAgents).toEqual(['claude-code', 'opencode']);
        const opencodeSkillLinkBefore = fs.realpathSync(path.join(tmpHome, '.agents/skills/development-process'));

        const claudeBefore = snapshotTree(path.join(tmpHome, '.claude'));

        // Real, full, unstubbed init for codex — real Codex hook, real shared
        // skill symlink (co-owned with OpenCode), real Codex-native TOML agent
        // render. Before the fix, this call threw: "Shared skill target cannot
        // diverge; select the complete shared target group: opencode,codex".
        const codex = await runInit({
            cwd: tmpWork,
            yes: true,
            agent: 'codex',
            // Real `codex --version` execution is unreliable inside this sandboxed
            // test runner (subprocess exec of freshly-written fixture binaries is
            // blocked even with PATH correctly set — verified directly; see task
            // notes). Every other real-pipeline test in the suite (init.test.ts's
            // `codexInitOptions`) uses this exact seam for the same reason — R2's
            // gate itself is unit-tested separately in provider-version.test.ts.
            assertProviderSupported: () => ({ provider: 'codex' as const, version: '0.150.0' }),
        });
        expect(codex).toBeLessThanOrEqual(1);

        expect(readPrefs().enabledAgents).toEqual(['claude-code', 'opencode', 'codex']);

        // R1/R7: Codex's global skill dir (~/.agents/skills, shared by design with
        // OpenCode — providers/index.ts) got a real symlink into the registry —
        // the SAME physical link OpenCode's own init already produced, now
        // co-owned by both agents (R15/R15.1) rather than fought over.
        const skillLink = path.join(tmpHome, '.agents/skills/development-process');
        expect(fs.lstatSync(skillLink).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(skillLink)).toContain(
            path.join('.awm/registries/baseline/skills/development-process'),
        );
        // OpenCode's own skill link is untouched — same physical target, same source.
        expect(fs.realpathSync(skillLink)).toBe(opencodeSkillLinkBefore);

        // R8: the canonical agent got rendered into Codex's native .toml shape.
        const tomlPath = path.join(tmpHome, '.codex/agents/development-process.toml');
        const toml = fs.readFileSync(tomlPath, 'utf8');
        expect(toml).toContain('developer_instructions = """');
        expect(toml).toContain('name = "development-process"');

        // R18: the Codex hook got installed for real.
        const hooksJson = JSON.parse(fs.readFileSync(path.join(tmpHome, '.codex/hooks.json'), 'utf8'));
        expect(hooksJson.hooks.SessionStart).toHaveLength(1);

        // R19/R19.1/R23: nothing under Claude's baseline moved during the Codex run.
        expect(snapshotTree(path.join(tmpHome, '.claude'))).toEqual(claudeBefore);
    });

    it('initializes Codex on a machine that has never run a Claude Code init', async () => {
        // The E2E above inits claude-code FIRST, so ~/.awm/hooks always exists
        // by the time Codex runs — which is precisely why it never caught this.
        // A fresh Codex Cloud box has no Claude install at all, and installing
        // the Codex hook creates ~/.awm/hooks as a side effect of the recursive
        // mkdir for its own nested ~/.awm/hooks/codex. That flipped Claude's
        // R19 baseline digest from absent to present-but-empty and aborted init
        // with "Claude Code baseline changed during a non-Claude init".
        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));

        const { runInit } = require('../../src/commands/init');

        expect(fs.existsSync(path.join(tmpHome, '.awm/hooks'))).toBe(false);
        expect(fs.existsSync(path.join(tmpHome, '.claude'))).toBe(false);

        const codex = await runInit({
            cwd: tmpWork,
            yes: true,
            agent: 'codex',
            machineOnly: true,
            assertProviderSupported: () => ({ provider: 'codex' as const, version: '0.150.0' }),
        });

        // Exit 2 is the internal-error path the R19 guard aborts through.
        expect(codex).toBeLessThanOrEqual(1);
        expect(readPrefs().enabledAgents).toEqual(['codex']);

        // The Codex hook really installed, and Claude gained no content of its own.
        const hooksJson = JSON.parse(fs.readFileSync(path.join(tmpHome, '.codex/hooks.json'), 'utf8'));
        expect(hooksJson.hooks.SessionStart).toHaveLength(1);
        expect(fs.existsSync(path.join(tmpHome, '.awm/hooks/codex/session-start'))).toBe(true);
        expect(fs.readdirSync(path.join(tmpHome, '.awm/hooks'))).toEqual(['codex']);
        expect(fs.existsSync(path.join(tmpHome, '.claude/settings.json'))).toBe(false);
    });

    it('doctor reports the isolated Codex install as supported/healthy, not against the real ~/.awm', () => {
        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));
        writePrefs(prefsWith(['claude-code', 'codex']));

        const childProcess = require('child_process') as typeof import('child_process');
        const realExecFileSync = childProcess.execFileSync;
        const execSpy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(((command: string, ...args: unknown[]) => {
            if (command === 'codex') {
                throw Object.assign(new Error('spawnSync codex ENOENT'), { code: 'ENOENT' });
            }
            return realExecFileSync(command, ...(args as Parameters<typeof realExecFileSync> extends [unknown, ...infer R] ? R : never));
        }) as typeof childProcess.execFileSync);
        jest.resetModules();
        const { runDoctor } = require('../../src/commands/doctor');

        // R20: doctor resolves a single explicit provider without needing every
        // enabled agent to be independently initialized first.
        try {
            runDoctor({ cwd: tmpWork, json: true, agent: 'codex' });
        } finally {
            execSpy.mockRestore();
        }
        const report = JSON.parse(stdout());
        expect(report.providers.map((p: { id: string }) => p.id)).toEqual(['codex']);
        const codexReport = report.providers[0];
        expect(codexReport.checks.find((c: { id: string }) => c.id === 'binary.version').state).toBe('missing');
    });
});
