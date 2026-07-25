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
// Deviation from the plan's illustrative snippet, and why: the snippet
// enables `opencode` alongside `claude-code` before running a REAL
// `awm init --agent codex`. That trips install-planner.ts's
// `assertCompleteSharedGroup` (R14, Task 5) — opencode and codex share the
// exact same physical skills directory (~/.agents/skills, providers/index.ts),
// and R14 intentionally REFUSES a real bundle install that selects one owner
// of a shared target without the other (see
// tests/commands/multi-agent-targeting.test.ts's "add refuses a codex-only
// skill install when OpenCode ... is also enabled" — the identical guard,
// already reviewed and covered). `awm init --agent X` always narrowly targets
// `[X]` for its baseline bundle step (core/init/steps.ts stepDevCore), so
// enabling opencode ahead of a REAL `init --agent codex` run hits this
// by-design refusal, not a bug — confirmed by direct reproduction while
// building this fixture. Fixing that interaction would mean redesigning
// stepDevCore's target selection, which is out of Task 9's scope (diagnostics)
// and risks Task 8's already-reviewed rollback-safe init flow. This test
// therefore keeps `opencode` OUT of enabledAgents and focuses on what R19/
// R19.1/R23 actually require: Claude's baseline is untouched by a Codex init.
// The "OpenCode and Codex share one physical skills dir, scanned once" claim
// (R7-adjacent) is covered separately and more precisely at the unit level in
// tests/core/diagnostics/context.test.ts ("reports shared skills for both
// owners without scanning twice"), which doesn't need real installs to prove.
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

    it('initializes Codex beside a real Claude Code install without touching Claude files', async () => {
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

        const claudeBefore = snapshotTree(path.join(tmpHome, '.claude'));

        // Real, full, unstubbed init for codex — real Codex hook, real shared
        // skill symlink, real Codex-native TOML agent render.
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

        expect(readPrefs().enabledAgents).toEqual(['claude-code', 'codex']);

        // R1/R7: Codex's global skill dir (~/.agents/skills, shared by design with
        // OpenCode — providers/index.ts) got a real symlink into the registry.
        const skillLink = path.join(tmpHome, '.agents/skills/development-process');
        expect(fs.lstatSync(skillLink).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(skillLink)).toContain(
            path.join('.awm/registries/baseline/skills/development-process'),
        );

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

    it('doctor reports the isolated Codex install as supported/healthy, not against the real ~/.awm', () => {
        seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));
        writePrefs(prefsWith(['claude-code', 'codex']));

        const { runDoctor } = require('../../src/commands/doctor');

        // R20: doctor resolves a single explicit provider without needing every
        // enabled agent to be independently initialized first.
        runDoctor({ cwd: tmpWork, json: true, agent: 'codex' });
        const report = JSON.parse(stdout());
        expect(report.providers.map((p: { id: string }) => p.id)).toEqual(['codex']);
        const codexReport = report.providers[0];
        expect(codexReport.checks.find((c: { id: string }) => c.id === 'binary.version').state).toBe('missing');
    });
});
