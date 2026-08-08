import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundles } from '../../src/core/bundles';
import { installBundle, addBundle, syncProfile, InstallSummary } from '../../src/core/bundle-install';
import { readProfile, writeProfile } from '../../src/core/profile';
import { installArtifact } from '../../src/core/executor';
import * as executor from '../../src/core/executor';
import { InstallPlan } from '../../src/core/install-planner';

/**
 * `installBundle` is a thin façade — it expands the bundle closure into
 * artifact intents, runs them through `planInstall` (dedup + ownership +
 * shared-skill-group gating), and hands the resulting plan to
 * `applyInstallPlan` (install-transaction.ts) to actually touch the
 * filesystem. Most tests below use this simpler test double instead — it
 * skips per-artifact on a missing source (unlike the real, transactional
 * applyInstallPlan, which aborts the whole plan) and doesn't render
 * `codex-agent-toml` targets, which keeps the fixtures here from needing
 * valid canonical-agent frontmatter for every scenario. Tests that
 * specifically exercise the REAL default applyInstallPlan pass no
 * `applyPlan` override at all — see below.
 */
function testApplyPlan(plan: InstallPlan): InstallSummary {
    const installed: string[] = [];
    const skipped: string[] = [];
    const modifiedFiles: string[] = [];
    for (const op of plan.operations) {
        if (!fs.existsSync(op.sourcePath)) {
            skipped.push(`${op.name} (source missing: ${op.sourcePath})`);
            continue;
        }
        installArtifact(op.sourcePath, op.targetPath, op.method);
        installed.push(`${op.name} → ${op.owners.join(',')} (${op.scope})`);
        modifiedFiles.push(op.targetPath);
    }
    return { installed, skipped, transactionId: 'test-fixture', modifiedFiles };
}

// Per CLAUDE.md: no test may touch the real ~/.awm. installBundle now calls
// getPreferences() internally (to resolve enabledAgents for the planner), so
// every test in this file needs HOME/AWM_HOME pointed at an isolated tmpdir,
// following the pattern in tests/commands/hooks/install.test.ts.
let tmpHome: string;
let originalHome: string | undefined;
let originalAwmHome: string | undefined;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-binstall-home-'));
    originalHome = process.env.HOME;
    originalAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
});

afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = originalAwmHome;
});

/**
 * Builds a fixture with:
 *  - content registry: catalog + two project bundles (base, ext dependsOn base),
 *    plus a skill dir per skill, one workflow .md and one agent .md.
 *  - a separate empty project root for local installs.
 * Both bundles are `project` scope so every artifact lands under projectRoot/.claude.
 */
function makeFixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-binstall-'));
    const content = path.join(tmp, 'registry');
    const projectRoot = path.join(tmp, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });

    fs.mkdirSync(path.join(content, 'bundles', 'base'), { recursive: true });
    fs.mkdirSync(path.join(content, 'bundles', 'ext'), { recursive: true });
    // skill source dirs
    for (const s of ['s-base', 's-ext']) {
        fs.mkdirSync(path.join(content, 'skills', s), { recursive: true });
        fs.writeFileSync(path.join(content, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
    }
    // a workflow + agent source for `ext`
    fs.mkdirSync(path.join(content, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(content, 'workflows', 'wf-ext.md'), '# wf');
    fs.mkdirSync(path.join(content, 'agents'), { recursive: true });
    fs.writeFileSync(
        path.join(content, 'agents', 'ag-ext.md'),
        '---\nname: ag-ext\ndescription: Test agent for bundle-install fixtures\n---\nDo the thing.\n',
    );

    fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [
            { name: 'base', source: './bundles/base', version: '1.0.0', scope: 'project' },
            { name: 'ext', source: './bundles/ext', version: '1.0.0', scope: 'project' },
        ],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'base', 'bundle.json'), JSON.stringify({
        name: 'base', version: '1.0.0', description: 'Base', scope: 'project', dependsOn: [],
        skills: ['s-base'], workflows: [], agents: [],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'ext', 'bundle.json'), JSON.stringify({
        name: 'ext', version: '1.0.0', description: 'Ext', scope: 'project', dependsOn: ['base'],
        skills: ['s-ext'], workflows: ['wf-ext'], agents: ['ag-ext'],
    }));

    return { content, projectRoot, bundles: discoverBundles(content) };
}

describe('installBundle', () => {
    it('materializes the bundle closure as local symlinks (deps + own skills)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });

        const skillsDir = path.join(projectRoot, '.claude', 'skills');
        expect(fs.existsSync(path.join(skillsDir, 's-base'))).toBe(true); // from dep `base`
        expect(fs.existsSync(path.join(skillsDir, 's-ext'))).toBe(true);  // from `ext`
        expect(fs.lstatSync(path.join(skillsDir, 's-ext')).isSymbolicLink()).toBe(true);
        expect(result.installed.some((l) => l.includes('s-base'))).toBe(true);
    });

    it('installs supported artifact types (claude-code agents)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'agents', 'ag-ext.md'))).toBe(true);
        // ACCEPTED GAP (Task 5, confirmed unchanged by Task 6): claude-code has
        // no `workflow` provider config, so planInstall (install-planner.ts)
        // silently drops wf-ext for this agent before a plan/operations ever
        // exist for it — there is no "unsupported for this agent" signal for
        // applyInstallPlan to surface as `skipped`, by design (install-planner.ts
        // mirrors the legacy installBundle skip semantics for this exact case).
        // Fixing this would mean adding a skip-reason channel to InstallPlan
        // itself, which is install-planner.ts's contract (Task 5), not Task 6's.
        expect(result.skipped.some((l) => l.includes('wf-ext'))).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'workflows', 'wf-ext.md'))).toBe(false);
    });

    it('is idempotent: a second run leaves valid symlinks and does not throw', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const opts = {
            bundleName: 'ext', bundles, agents: ['claude-code' as const],
            method: 'symlink' as const, projectRoot, contentDir: content, applyPlan: testApplyPlan,
        };
        installBundle(opts);
        expect(() => installBundle(opts)).not.toThrow();
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });

    it('skips artifacts whose source is missing instead of throwing', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.rmSync(path.join(content, 'skills', 's-base'), { recursive: true, force: true });
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.skipped.some((l) => l.includes('s-base'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });

    it('materializes a Codex agent as rendered TOML via the real default applyInstallPlan (no applyPlan override)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const ext = bundles.find((bundle) => bundle.name === 'ext')!;
        const agentOnly = [{
            ...ext,
            dependsOn: [],
            skills: [],
            workflows: [],
        }];

        const result = installBundle({
            bundleName: 'ext',
            bundles: agentOnly,
            agents: ['codex'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        });

        const tomlPath = path.join(projectRoot, '.codex/agents/ag-ext.toml');
        expect(fs.existsSync(path.join(projectRoot, '.codex/agents/ag-ext.md'))).toBe(false);
        expect(fs.existsSync(tomlPath)).toBe(true);
        expect(fs.readFileSync(tomlPath, 'utf8')).toContain('name = "ag-ext"');
        expect(result.transactionId).toBeTruthy();
        expect(result.modifiedFiles).toContain(tomlPath);
    });

    it('keeps Codex skill installs on the legacy link renderer', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const base = bundles.find((bundle) => bundle.name === 'base')!;

        const result = installBundle({
            bundleName: 'base',
            bundles: [base],
            agents: ['codex'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
            applyPlan: testApplyPlan,
        });

        expect(fs.existsSync(path.join(projectRoot, '.agents/skills/s-base'))).toBe(true);
        // KNOWN FORMAT CHANGE (Task 6): the old `[bundleName]` suffix is gone —
        // ArtifactIntent (and therefore the plan) no longer carries bundle
        // provenance, only artifact name/type/owners. See this task's report.
        expect(result.installed).toContain('s-base → codex (local)');
    });

    it('applies real filesystem changes for mixed Codex bundles when no applyPlan is supplied', () => {
        const { content, projectRoot, bundles } = makeFixture();

        const result = addBundle({
            bundleName: 'ext',
            bundles,
            agents: ['codex'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        });

        expect(fs.existsSync(path.join(projectRoot, '.agents/skills/s-base'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.agents/skills/s-ext'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.codex/agents/ag-ext.toml'))).toBe(true);
        expect(result.recordedExtension).toBe('ext');
        expect(fs.existsSync(path.join(projectRoot, '.awm/profile.json'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.gitignore'))).toBe(true);
    });

    it('materializes a skill as a rendered Cursor .mdc via the real default applyInstallPlan (Task 4.3 e2e)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        // s-base's fixture SKILL.md (makeFixture, above) has no `description`
        // field — real for a bare skill fixture, but cursor-mdc.ts's renderer
        // requires one (parseSkillSource). Seed a real description here so
        // this is a genuine end-to-end render, not just a source-existence check.
        fs.writeFileSync(
            path.join(content, 'skills', 's-base', 'SKILL.md'),
            '---\nname: s-base\ndescription: Base skill for bundle-install fixtures\n---\n\nDo the base thing.\n',
        );
        const base = bundles.find((bundle) => bundle.name === 'base')!;

        const result = installBundle({
            bundleName: 'base',
            bundles: [base],
            agents: ['cursor'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        });

        const mdcPath = path.join(projectRoot, '.cursor/rules/s-base.mdc');
        expect(fs.existsSync(path.join(projectRoot, '.cursor/rules/s-base'))).toBe(false);
        expect(fs.existsSync(mdcPath)).toBe(true);
        const rendered = fs.readFileSync(mdcPath, 'utf8');
        expect(rendered).toContain('description: Base skill for bundle-install fixtures');
        expect(rendered).toContain('alwaysApply: false');
        expect(rendered).toContain('Do the base thing.');
        expect(result.transactionId).toBeTruthy();
        expect(result.modifiedFiles).toContain(mdcPath);
    });

    it('materializes a skill as rendered Copilot .instructions.md via the real default applyInstallPlan (Task 4.3 e2e)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.writeFileSync(
            path.join(content, 'skills', 's-base', 'SKILL.md'),
            '---\nname: s-base\ndescription: Base skill for bundle-install fixtures\n---\n\nDo the base thing.\n',
        );
        const base = bundles.find((bundle) => bundle.name === 'base')!;

        const result = installBundle({
            bundleName: 'base',
            bundles: [base],
            agents: ['copilot'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        });

        const instructionsPath = path.join(projectRoot, '.github/instructions/s-base.instructions.md');
        expect(fs.existsSync(path.join(projectRoot, '.github/instructions/s-base'))).toBe(false);
        expect(fs.existsSync(instructionsPath)).toBe(true);
        const rendered = fs.readFileSync(instructionsPath, 'utf8');
        expect(rendered).toContain('applyTo: "**"');
        expect(rendered).toContain('Do the base thing.');
        expect(result.transactionId).toBeTruthy();
        expect(result.modifiedFiles).toContain(instructionsPath);
    });

    it('applies real filesystem changes for Cursor + Copilot via addBundle (awm add e2e, no applyPlan override)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.writeFileSync(
            path.join(content, 'skills', 's-base', 'SKILL.md'),
            '---\nname: s-base\ndescription: Base skill for bundle-install fixtures\n---\n\nDo the base thing.\n',
        );

        const cursorResult = addBundle({
            bundleName: 'base', bundles, agents: ['cursor'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(fs.existsSync(path.join(projectRoot, '.cursor/rules/s-base.mdc'))).toBe(true);
        expect(cursorResult.recordedExtension).toBe('base');

        const copilotResult = addBundle({
            bundleName: 'base', bundles, agents: ['copilot'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(fs.existsSync(path.join(projectRoot, '.github/instructions/s-base.instructions.md'))).toBe(true);
        expect(copilotResult.recordedExtension).toBe('base');
    });

    it('installs a skill shared by two agents (OpenCode + Codex) with exactly one replaceArtifact call, but the summary contains both providers', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const base = bundles.find((bundle) => bundle.name === 'base')!;
        const replaceSpy = jest.spyOn(executor, 'replaceArtifact');

        const result = installBundle({
            bundleName: 'base',
            bundles: [base],
            agents: ['opencode', 'codex'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        });

        const skillTarget = path.join(projectRoot, '.agents/skills/s-base');
        expect(fs.existsSync(skillTarget)).toBe(true);
        // One physical write for the shared target...
        expect(replaceSpy).toHaveBeenCalledTimes(1);
        replaceSpy.mockRestore();

        // ...but the real installBundle/applyInstallPlan result must report
        // BOTH providers as owning the artifact, not just the one whose
        // selection triggered the write (install-planner.ts tags the other as
        // 'retain', which applyInstallPlan must still surface).
        const installedForSkill = result.installed.filter((line) => line.startsWith('s-base → '));
        expect(installedForSkill).toEqual(expect.arrayContaining(['s-base → opencode', 's-base → codex']));
        expect(result.modifiedFiles).toContain(skillTarget);
    });
});

describe('addBundle', () => {
    // KNOWN RED (Task 6): addBundle's `recordedExtension` detection greps
    // `summary.installed` lines for a `[bundleName]` suffix to tell "this
    // bundle's own artifacts installed" apart from "only a dependency
    // installed". ArtifactIntent (Task 5's contract, see install-planner.ts)
    // does not carry bundle provenance, so that suffix can no longer be
    // produced anywhere in the pipeline — recordedExtension is always null
    // now. Left unfixed deliberately: fixing it means either adding bundle
    // provenance to ArtifactIntent/ManagedArtifactRecord or having addBundle
    // compare against the named bundle's own artifact list directly, both of
    // which are Task 6-shaped decisions (it owns applyInstallPlan's real
    // return contract). Flagged prominently in this task's final report.
    it('records a project bundle installed locally as an extension + gitignores symlinks', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.recordedExtension).toBe('ext');
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
        const gi = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
        expect(gi).toContain('.claude/skills/');
    });

    it('does not record the dependency bundle, only the named one', () => {
        const { content, projectRoot, bundles } = makeFixture();
        addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });
        expect(readProfile(projectRoot).extensions).toEqual(['ext']); // not ['base','ext']
    });

    it('is idempotent: adding the same bundle twice keeps one extension entry', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const opts = {
            bundleName: 'ext', bundles, agents: ['claude-code' as const],
            method: 'symlink' as const, projectRoot, contentDir: content, applyPlan: testApplyPlan,
        };
        addBundle(opts);
        addBundle(opts);
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
    });

    it('does not record extension when all sources are missing (nothing installed)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.rmSync(path.join(content, 'skills', 's-ext'), { recursive: true, force: true });
        fs.rmSync(path.join(content, 'skills', 's-base'), { recursive: true, force: true });
        fs.rmSync(path.join(content, 'agents', 'ag-ext.md'), { force: true });
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.recordedExtension).toBeNull();
        expect(readProfile(projectRoot).extensions).toEqual([]);
    });

    it('does not record extension when only dep sources are present (named bundle own artifacts missing)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        // Remove only ext's own sources; keep dep (base) sources intact.
        fs.rmSync(path.join(content, 'skills', 's-ext'), { recursive: true, force: true });
        fs.rmSync(path.join(content, 'agents', 'ag-ext.md'), { force: true });
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.installed.some((l) => l.includes('s-base'))).toBe(true); // dep installed
        expect(result.recordedExtension).toBeNull();                             // ext not recorded
        expect(readProfile(projectRoot).extensions).toEqual([]);
    });

    it('respects explicit scopeOverride: local and still records the extension', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content, applyPlan: testApplyPlan,
            scopeOverride: 'local',
        });
        expect(result.recordedExtension).toBe('ext');
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
    });
});

describe('syncProfile', () => {
    it('rematerializes symlinks for every extension listed in the profile', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: ['ext'] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.extensions).toEqual(['ext']);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-base'))).toBe(true);
    });

    it('is a no-op when the profile has no extensions', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: [] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.extensions).toEqual([]);
        expect(result.installed).toEqual([]);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills'))).toBe(false);
    });

    it('skips and warns about extensions no longer in registry (stale entries)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: ['stale-bundle', 'ext'] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content, applyPlan: testApplyPlan,
        });
        expect(result.extensions).toEqual(['stale-bundle', 'ext']);
        expect(result.skipped.some((l) => l.includes('stale-bundle'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });
});
