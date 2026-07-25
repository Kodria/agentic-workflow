import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundles } from '../../src/core/bundles';
import { installBundle, addBundle, syncProfile, InstallSummary } from '../../src/core/bundle-install';
import { readProfile, writeProfile } from '../../src/core/profile';
import { installArtifact } from '../../src/core/executor';
import { InstallPlan } from '../../src/core/install-planner';

/**
 * Task 5 note: `installBundle` is now a thin façade — it expands the bundle
 * closure into artifact intents, runs them through `planInstall` (dedup +
 * ownership + shared-skill-group gating), and hands the resulting plan to
 * `applyInstallPlan` to actually touch the filesystem. The real,
 * transactional `applyInstallPlan` (backups/rollback, artifact-state
 * persistence) is Task 6's job — until it lands, `installBundle` throws
 * unless a caller injects `applyPlan`. This fixture supplies a minimal test
 * double so most of these tests keep exercising real behavior; a handful
 * that specifically depended on the *previous* installBundle's line-format
 * or on the pre-Task-4 Codex-agent-renderer gate are noted inline as
 * expected-red pending Task 6 (see this task's final report for the full list).
 */
function testApplyPlan(plan: InstallPlan): InstallSummary {
    const installed: string[] = [];
    const skipped: string[] = [];
    for (const op of plan.operations) {
        if (!fs.existsSync(op.sourcePath)) {
            skipped.push(`${op.name} (source missing: ${op.sourcePath})`);
            continue;
        }
        installArtifact(op.sourcePath, op.targetPath, op.method);
        installed.push(`${op.name} → ${op.owners.join(',')} (${op.scope})`);
    }
    return { installed, skipped };
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
    fs.writeFileSync(path.join(content, 'agents', 'ag-ext.md'), '# agent');

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
        // KNOWN RED (Task 6): claude-code has no `workflow` provider config, so
        // planInstall silently drops wf-ext for this agent — InstallPlan has no
        // field to surface "artifact type unsupported by this agent" the way the
        // old per-artifact `skipped` list did. Left here as a documented gap
        // rather than deleted, so Task 6 can decide whether to reintroduce it.
        expect(result.skipped.some((l) => l.includes('wf-ext'))).toBe(true);
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

    it('does not materialize anything until applyInstallPlan (Task 6) is supplied', () => {
        // Pre-Task-5 this threw UnsupportedRendererError for the codex-agent-toml
        // renderer (that renderer didn't exist yet). Task 4 has since implemented
        // it (src/core/renderers/codex-agent.ts) and planInstall no longer gates
        // on renderer support — but nothing wires the real renderer into the
        // apply step until Task 6 lands `applyInstallPlan`, so calling
        // installBundle without an injected `applyPlan` still throws before any
        // write happens, just with a different (interim) message.
        const { content, projectRoot, bundles } = makeFixture();
        const ext = bundles.find((bundle) => bundle.name === 'ext')!;
        const agentOnly = [{
            ...ext,
            dependsOn: [],
            skills: [],
            workflows: [],
        }];

        expect(() => installBundle({
            bundleName: 'ext',
            bundles: agentOnly,
            agents: ['codex'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        })).toThrow('applyInstallPlan is not implemented yet (Task 6)');
        expect(fs.existsSync(path.join(projectRoot, '.codex/agents/ag-ext.md'))).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, '.codex/agents/ag-ext.toml'))).toBe(false);
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

    it('does not apply before an applyPlan is supplied, even for mixed Codex bundles', () => {
        const { content, projectRoot, bundles } = makeFixture();

        expect(() => addBundle({
            bundleName: 'ext',
            bundles,
            agents: ['codex'],
            method: 'symlink',
            projectRoot,
            contentDir: content,
        })).toThrow('applyInstallPlan is not implemented yet (Task 6)');
        expect(fs.existsSync(path.join(projectRoot, '.agents/skills/s-base'))).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, '.agents/skills/s-ext'))).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, '.codex/agents/ag-ext.md'))).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, '.awm/profile.json'))).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, '.gitignore'))).toBe(false);
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
