// tests/commands/add.test.ts
//
// Real, unstubbed `awm add <bundle>` end-to-end for the Task 4.3 renderers:
// runAddBundleCore → (real) addBundle → installBundle → planInstall
// (install-planner.ts) → applyInstallPlan (install-transaction.ts) →
// renderCursorMdc/renderCopilotInstructions — proving the full pipeline
// wires together at the actual CLI command entrypoint, not just at the
// bundle-install.ts layer (see tests/core/bundle-install.test.ts for the
// lower-level equivalent). Per CLAUDE.md: isolated HOME/AWM_HOME tmpdirs,
// never the real ~/.awm.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runAddBundleCore } from '../../src/commands/add';
import { discoverBundles } from '../../src/core/bundles';
import type { AwmPreferences } from '../../src/utils/config';

let tmpHome: string;
let originalHome: string | undefined;
let originalAwmHome: string | undefined;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-add-e2e-home-'));
    originalHome = process.env.HOME;
    originalAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
});

afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
});

/** A single-bundle content registry: one skill with real description+body. */
function makeContentFixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-add-e2e-registry-'));
    fs.mkdirSync(path.join(tmp, 'bundles', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, 'skills', 'demo-skill', 'SKILL.md'),
        '---\nname: demo-skill\ndescription: A demo skill for add.test.ts e2e\n---\n\nFollow the demo skill body.\n',
    );
    fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'demo', source: './bundles/demo', version: '1.0.0', scope: 'project' }],
    }));
    fs.writeFileSync(path.join(tmp, 'bundles', 'demo', 'bundle.json'), JSON.stringify({
        name: 'demo', version: '1.0.0', description: 'Demo', scope: 'project', dependsOn: [],
        skills: ['demo-skill'], workflows: [], agents: [],
    }));
    return tmp;
}

function prefsFor(agent: 'cursor' | 'copilot'): AwmPreferences {
    return { defaultAgent: agent, enabledAgents: [agent], installMethod: 'symlink', defaultScope: 'local' };
}

/** findProjectRoot (core/profile.ts) needs a recognizable project marker
 *  (.git/, package.json, or .awm/profile.json) — a bare tmpdir isn't one. */
function makeProjectRoot(): string {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-add-e2e-project-'));
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture' }));
    return projectRoot;
}

it('awm add demo materializes a real Cursor .mdc file end-to-end', () => {
    const content = makeContentFixture();
    const projectRoot = makeProjectRoot();
    const bundles = discoverBundles(content);

    const outcome = runAddBundleCore(
        { name: 'demo', agent: 'cursor', cwd: projectRoot },
        prefsFor('cursor'),
        bundles,
    );

    expect(outcome.code).toBe(0);
    const mdcPath = path.join(projectRoot, '.cursor/rules/demo-skill.mdc');
    expect(fs.existsSync(mdcPath)).toBe(true);
    const rendered = fs.readFileSync(mdcPath, 'utf8');
    expect(rendered).toContain('description: A demo skill for add.test.ts e2e');
    expect(rendered).toContain('alwaysApply: false');
    expect(rendered).toContain('Follow the demo skill body.');

    fs.rmSync(content, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
});

it('awm add demo materializes a real Copilot .instructions.md file end-to-end', () => {
    const content = makeContentFixture();
    const projectRoot = makeProjectRoot();
    const bundles = discoverBundles(content);

    const outcome = runAddBundleCore(
        { name: 'demo', agent: 'copilot', cwd: projectRoot },
        prefsFor('copilot'),
        bundles,
    );

    expect(outcome.code).toBe(0);
    const instructionsPath = path.join(projectRoot, '.github/instructions/demo-skill.instructions.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
    const rendered = fs.readFileSync(instructionsPath, 'utf8');
    expect(rendered).toContain('applyTo: "**"');
    expect(rendered).toContain('Follow the demo skill body.');

    fs.rmSync(content, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
});

// Regression for WIN-02 (issue #55 Windows playbook): `--method copy` was
// silently discarded by this exact function — `runAddBundleCore` hardcoded
// 'symlink' regardless of what the CLI parsed, so a real Windows machine got
// a Junction back no matter what `--method` asked for.
describe('runAddBundleCore --method', () => {
    const claudeCodePrefs: AwmPreferences = {
        defaultAgent: 'claude-code', enabledAgents: ['claude-code'], installMethod: 'symlink', defaultScope: 'local',
    };

    it('honours an explicit --method copy: a real directory, not a symlink', () => {
        const content = makeContentFixture();
        const projectRoot = makeProjectRoot();
        const bundles = discoverBundles(content);

        const outcome = runAddBundleCore(
            { name: 'demo', agent: 'claude-code', method: 'copy', cwd: projectRoot },
            claudeCodePrefs,
            bundles,
        );

        expect(outcome.code).toBe(0);
        const skillPath = path.join(projectRoot, '.claude/skills/demo-skill');
        expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf8')).toContain('Follow the demo skill body.');

        fs.rmSync(content, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('still defaults to symlink when --method is omitted (unchanged behavior)', () => {
        const content = makeContentFixture();
        const projectRoot = makeProjectRoot();
        const bundles = discoverBundles(content);

        const outcome = runAddBundleCore(
            { name: 'demo', agent: 'claude-code', cwd: projectRoot },
            claudeCodePrefs,
            bundles,
        );

        expect(outcome.code).toBe(0);
        const skillPath = path.join(projectRoot, '.claude/skills/demo-skill');
        expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(true);

        fs.rmSync(content, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('rejects an invalid --method value without touching the filesystem', () => {
        const content = makeContentFixture();
        const projectRoot = makeProjectRoot();
        const bundles = discoverBundles(content);

        const outcome = runAddBundleCore(
            { name: 'demo', agent: 'claude-code', method: 'bogus', cwd: projectRoot },
            claudeCodePrefs,
            bundles,
        );

        expect(outcome.code).toBe(1);
        expect(fs.existsSync(path.join(projectRoot, '.claude/skills/demo-skill'))).toBe(false);

        fs.rmSync(content, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });
});
