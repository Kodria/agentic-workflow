// Direct, focused tests for planInitMutationTargets (mutation-targets.ts).
//
// Previously this module was only exercised indirectly via
// tests/commands/init.test.ts's broader init-flow tests, which happen to hit
// the hooks.settingsPath branch but not the ambient/baseline/project-extension
// branches, nor the Finding-1 fix (global skills directory) directly.
//
// registries.ts computes AWM_HOME at module-require time (not call time), so
// every test here sets HOME/AWM_HOME BEFORE requiring
// core/init/mutation-targets.ts, and calls jest.resetModules() first — the
// same pattern used throughout tests/commands/hooks/install.test.ts and
// tests/core/skill-integrity.test.ts. Per CLAUDE.md, no test may touch the
// real ~/.awm.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BundleDefinition } from '../../../src/core/bundles';
import type { AgentTarget } from '../../../src/providers';

function bundle(name: string, scope: BundleDefinition['scope'], skills: string[]): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: skills.map((s) => ({ name: s, onSignal: false })),
        workflows: [], agents: [],
    };
}

let tmpHome: string;
let originalHome: string | undefined;
let originalAwmHome: string | undefined;
let extraDirs: string[];

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mutation-targets-'));
    originalHome = process.env.HOME;
    originalAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
    jest.resetModules();
    extraDirs = [];
});

afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    for (const dir of extraDirs) fs.rmSync(dir, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = originalAwmHome;
});

/**
 * Loads a fresh copy of the module under test (and providerFor, which needs
 * the same env-var-driven paths) AFTER env vars are set for this test.
 */
function load() {
    const mutationTargets = require('../../../src/core/init/mutation-targets');
    const providers = require('../../../src/providers');
    return {
        planInitMutationTargets: mutationTargets.planInitMutationTargets as (p: {
            cwd: string; agent: AgentTarget; bundles: BundleDefinition[];
        }) => string[],
        providerFor: providers.providerFor as (a: AgentTarget) => import('../../../src/providers').ProviderConfig,
    };
}

/** A cwd guaranteed to have no project-root marker (.git/package.json/.awm) in its ancestry. */
function bareCwd(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mutation-targets-cwd-'));
    extraDirs.push(dir);
    return dir;
}

describe('planInitMutationTargets', () => {
    it('always includes preferences.json and the artifact-state file', () => {
        const { planInitMutationTargets } = load();
        const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'claude-code', bundles: [] });

        expect(targets).toContain(path.join(tmpHome, '.awm', 'preferences.json'));
        expect(targets).toContain(path.join(tmpHome, '.awm', 'state', 'artifacts.json'));
    });

    describe('hooks', () => {
        it('includes hooks.settingsPath and hooks.scriptsDir for an agent with a hook config (claude-code)', () => {
            const { planInitMutationTargets, providerFor } = load();
            const provider = providerFor('claude-code');
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'claude-code', bundles: [] });

            expect(provider.hooks).toBeDefined();
            expect(targets).toContain(provider.hooks!.settingsPath);
            expect(targets).toContain(provider.hooks!.scriptsDir);
        });

        it('includes hooks.json + scriptsDir for codex (its own hook config shape)', () => {
            const { planInitMutationTargets, providerFor } = load();
            const provider = providerFor('codex');
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'codex', bundles: [] });

            expect(targets).toContain(provider.hooks!.settingsPath);
            expect(targets).toContain(provider.hooks!.scriptsDir);
        });

        it('includes no hook paths for an agent with no hook config (antigravity)', () => {
            const { planInitMutationTargets } = load();
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'antigravity', bundles: [] });

            // antigravity has neither hooks nor injection — its only entries are
            // the two always-present machine paths.
            expect(targets).toEqual([
                path.join(tmpHome, '.awm', 'preferences.json'),
                path.join(tmpHome, '.awm', 'state', 'artifacts.json'),
                path.join(tmpHome, '.gemini', 'antigravity', 'skills'),
            ]);
        });
    });

    describe('injection', () => {
        it('includes the config-instructions path for opencode', () => {
            const { planInitMutationTargets, providerFor } = load();
            const provider = providerFor('opencode');
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'opencode', bundles: [] });

            expect(provider.injection?.type).toBe('config-instructions');
            expect(targets).toContain((provider.injection as { configPath: string }).configPath);
        });

        it('includes the managed-agents-md global path for codex', () => {
            const { planInitMutationTargets, providerFor } = load();
            const provider = providerFor('codex');
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'codex', bundles: [] });

            expect(provider.injection?.type).toBe('managed-agents-md');
            expect(targets).toContain((provider.injection as { globalPath: string }).globalPath);
        });

        it('adds no separate injection path for claude-code (cc-settings-merge is covered by the hook)', () => {
            const { planInitMutationTargets, providerFor } = load();
            const provider = providerFor('claude-code');
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'claude-code', bundles: [] });

            expect(provider.injection?.type).toBe('cc-settings-merge');
            // Every target should be explainable by preferences/state/hooks/skills-dir —
            // none of them should be a bespoke injection config file.
            expect(targets).toEqual([
                path.join(tmpHome, '.awm', 'preferences.json'),
                path.join(tmpHome, '.awm', 'state', 'artifacts.json'),
                provider.hooks!.settingsPath,
                provider.hooks!.scriptsDir,
                provider.skill.global,
            ]);
        });
    });

    describe('machine-level bundle targets (baseline + ambient)', () => {
        it('includes physical skill targets for baseline and ambient bundles, but not a project-scope bundle', () => {
            const { planInitMutationTargets, providerFor } = load();
            const bundles = [
                bundle('dev-core', 'baseline', ['using-awm']),
                bundle('ambient-pack', 'ambient', ['ambient-skill']),
                bundle('project-only', 'project', ['project-skill']),
            ];
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'claude-code', bundles });
            const skillsDir = providerFor('claude-code').skill.global;
            if (skillsDir === null) throw new Error('claude-code skill.global must not be null');

            expect(targets).toContain(path.join(skillsDir, 'using-awm'));
            expect(targets).toContain(path.join(skillsDir, 'ambient-skill'));
            // project-scope bundles are only enumerated via .awm/profile.json
            // extensions below, never from the machine-level baseline/ambient pass.
            expect(targets).not.toContain(path.join(skillsDir, 'project-skill'));
        });
    });

    describe('project-level targets', () => {
        function makeProjectRoot(): string {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mutation-targets-project-'));
            fs.mkdirSync(path.join(root, '.git')); // project-root marker for findProjectRoot
            extraDirs.push(root);
            return root;
        }

        it('includes profile.json, sensors.json, and extension bundle targets when a project root is found', () => {
            const { planInitMutationTargets, providerFor } = load();
            const projectRoot = makeProjectRoot();
            fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
            fs.writeFileSync(
                path.join(projectRoot, '.awm', 'profile.json'),
                JSON.stringify({ extensions: ['frontend'] }),
            );

            const bundles = [bundle('frontend', 'project', ['frontend-skill'])];
            const targets = planInitMutationTargets({ cwd: projectRoot, agent: 'claude-code', bundles });

            expect(targets).toContain(path.join(projectRoot, '.awm', 'profile.json'));
            expect(targets).toContain(path.join(projectRoot, '.awm', 'sensors.json'));
            // frontend is a project-scope bundle -> installs locally under the project root
            const localSkillsDir = path.join(projectRoot, providerFor('claude-code').skill.local);
            expect(targets).toContain(path.join(localSkillsDir, 'frontend-skill'));
        });

        it('includes the project injection file for config-instructions agents (opencode)', () => {
            const { planInitMutationTargets } = load();
            const projectRoot = makeProjectRoot();
            const targets = planInitMutationTargets({ cwd: projectRoot, agent: 'opencode', bundles: [] });

            expect(targets).toContain(path.join(projectRoot, 'opencode.json'));
        });

        it('includes the project injection file (AGENTS.md) for managed-agents-md agents (codex)', () => {
            const { planInitMutationTargets } = load();
            const projectRoot = makeProjectRoot();
            const targets = planInitMutationTargets({ cwd: projectRoot, agent: 'codex', bundles: [] });

            expect(targets).toContain(path.join(projectRoot, 'AGENTS.md'));
        });

        it('omits every project-level target when no project root is found', () => {
            const { planInitMutationTargets } = load();
            const cwd = bareCwd(); // no .git/package.json/.awm ancestor
            const targets = planInitMutationTargets({ cwd, agent: 'claude-code', bundles: [] });

            expect(targets.some((t) => t.endsWith(path.join('.awm', 'profile.json')))).toBe(false);
            expect(targets.some((t) => t.endsWith(path.join('.awm', 'sensors.json')))).toBe(false);
        });

        it('ignores an extension named in the profile that no longer resolves to a known bundle', () => {
            const { planInitMutationTargets, providerFor } = load();
            const projectRoot = makeProjectRoot();
            fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
            fs.writeFileSync(
                path.join(projectRoot, '.awm', 'profile.json'),
                JSON.stringify({ extensions: ['stale-bundle'] }),
            );

            const targets = planInitMutationTargets({ cwd: projectRoot, agent: 'claude-code', bundles: [] });
            const localSkillsDir = path.join(projectRoot, providerFor('claude-code').skill.local);
            // No target should be produced under the local skills dir for a bundle
            // that isn't in the (empty) known-bundles list passed in.
            expect(targets.some((t) => t.startsWith(localSkillsDir))).toBe(false);
        });
    });

    describe('Finding 1 fix — global skills directory itself', () => {
        it('includes providerFor(agent).skill.global for every agent, independent of the bundle catalog', () => {
            const { planInitMutationTargets, providerFor } = load();

            for (const agent of ['claude-code', 'codex', 'opencode', 'antigravity'] as AgentTarget[]) {
                const targets = planInitMutationTargets({ cwd: bareCwd(), agent, bundles: [] });
                expect(targets).toContain(providerFor(agent).skill.global);
            }
        });

        it('the skills-directory target covers orphaned entries repairGlobalSkills would mutate, not just bundle-derived subpaths', () => {
            // Regression guard for the logic gap: before the fix, only
            // bundle-DERIVED skill paths (e.g. .../skills/using-awm) were
            // enumerated. An orphaned symlink like .../skills/some-old-skill
            // (belonging to no currently-known bundle — the exact condition
            // that makes repairGlobalSkills classify it as repairable/dead)
            // would never appear in the bundle-driven enumeration. The parent
            // directory itself must be present so beginBackupSession snapshots
            // the whole tree.
            const { planInitMutationTargets, providerFor } = load();
            const bundles = [bundle('dev-core', 'baseline', ['using-awm'])];
            const targets = planInitMutationTargets({ cwd: bareCwd(), agent: 'claude-code', bundles });
            const skillsDir = providerFor('claude-code').skill.global;
            if (skillsDir === null) throw new Error('claude-code skill.global must not be null');

            expect(targets).toContain(skillsDir);
            // Sanity: the orphan path itself is a child of the now-covered dir,
            // even though it is never separately enumerated.
            const orphanPath = path.join(skillsDir, 'some-old-orphaned-skill');
            expect(orphanPath.startsWith(skillsDir)).toBe(true);
        });
    });
});
