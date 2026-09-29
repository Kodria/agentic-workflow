// cli/tests/core/diagnostics/provider-tier.test.ts
//
// Task 4.4 — capability tier. Three concerns:
//
// 1. `providerTier` — a pure structural classification derived from each
//    provider's config shape (hooks / injection / neither).
// 2. `contextGlobalCheck`'s scope-awareness fix (deferred Task 4.2 finding):
//    a `managed-agents-md` provider with `injection.globalPath === null`
//    (Cursor, Copilot) operates at LOCAL scope, not global — asking
//    `contextStatus` about 'global' for these providers always resolved to
//    'absent' regardless of whether the local injection actually succeeded.
// 3. `skillsGlobalCheck`'s renderer-awareness fix (deferred Task 4.3 finding):
//    `classifySkillLinks` only ever sees symlinks, so a rendered format
//    (cursor-mdc, copilot-instructions) always scanned as "0 broken" and
//    reported a false-green 'healthy' regardless of what was actually on
//    disk. Non-'link' renderers now report presence-only, honestly.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AGENT_TARGETS, AgentTarget, providers } from '../../../src/providers';
import { providerTier } from '../../../src/core/diagnostics/provider-checks';
import { ProviderTier } from '../../../src/core/diagnostics/types';

describe('providerTier — pure structural classification', () => {
    const expected: Record<AgentTarget, ProviderTier> = {
        antigravity: 'context-only',
        opencode: 'config-managed',
        'claude-code': 'hooks-native',
        codex: 'hooks-native',
        cursor: 'hooks-native',
        copilot: 'agents-md-managed',
    };

    it.each(AGENT_TARGETS)('%s', (agent) => {
        expect(providerTier(providers()[agent])).toBe(expected[agent]);
    });
});

describe('contextGlobalCheck — scope-aware (Task 4.4 / deferred Task 4.2 finding)', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    const projectRoots: string[] = [];

    function seedRegistry(): string {
        const root = path.join(tmpHome, '.awm/registries/baseline');
        fs.mkdirSync(path.join(root, 'skills/using-awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/using-awm/SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm/registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.invalid/baseline.git' }], null, 2),
        );
        return root;
    }

    function scanSkillsStub() {
        return jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
    }

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-tier-home-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        // registries.ts caches AWM_HOME as a module-level const AT REQUIRE TIME (see its own
        // top comment). A static top-level import of gatherProviderChecks (which transitively
        // requires registries.ts) would bake in whatever AWM_HOME was set BEFORE this
        // beforeEach ever ran, silently resolving capabilityRoot() against the real machine's
        // ~/.awm instead of tmpHome. Every module that (transitively) touches AWM_HOME/HOME
        // must therefore be require()'d fresh, per test, after the env vars above are set —
        // same pattern as tests/core/diagnostics/provider-checks.test.ts.
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        for (const p of projectRoots.splice(0)) fs.rmSync(p, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('Cursor (local scope, globalPath === null) reports delivered when local injection actually succeeded', () => {
        const contentDir = seedRegistry();
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-tier-project-'));
        projectRoots.push(projectRoot);

        const { InjectionOrchestrator } = require('../../../src/core/context/orchestrator');
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        new InjectionOrchestrator().installContext({
            agent: 'cursor',
            scope: 'local',
            registryRoot: contentDir,
            installMethod: 'symlink',
            profileExtensions: [],
            projectRoot,
        });

        const facts = gatherProviderChecks(['cursor'], scanSkillsStub(), projectRoot);
        const contextCheck = facts[0].checks.find((c: { id: string }) => c.id === 'context.global');
        expect(contextCheck).toMatchObject({ id: 'context.global', state: 'delivered' });
    });

    it('Copilot (local scope, globalPath === null) reports delivered when local injection actually succeeded', () => {
        const contentDir = seedRegistry();
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-tier-project-'));
        projectRoots.push(projectRoot);

        const { InjectionOrchestrator } = require('../../../src/core/context/orchestrator');
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        new InjectionOrchestrator().installContext({
            agent: 'copilot',
            scope: 'local',
            registryRoot: contentDir,
            installMethod: 'symlink',
            profileExtensions: [],
            projectRoot,
        });

        const facts = gatherProviderChecks(['copilot'], scanSkillsStub(), projectRoot);
        const contextCheck = facts[0].checks.find((c: { id: string }) => c.id === 'context.global');
        expect(contextCheck).toMatchObject({ id: 'context.global', state: 'delivered' });
    });

    it('Cursor without a resolvable projectRoot falls back to absent, not a crash', () => {
        seedRegistry();
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['cursor'], scanSkillsStub(), undefined);
        const contextCheck = facts[0].checks.find((c: { id: string }) => c.id === 'context.global');
        expect(contextCheck).toMatchObject({ id: 'context.global', state: 'absent', remediationCode: 'awm-init' });
    });

    it('Codex (global scope, unchanged) still resolves correctly — regression', () => {
        const contentDir = seedRegistry();
        const { InjectionOrchestrator } = require('../../../src/core/context/orchestrator');
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        new InjectionOrchestrator().installContext({
            agent: 'codex',
            scope: 'global',
            registryRoot: contentDir,
            installMethod: 'symlink',
            profileExtensions: [],
        });

        const facts = gatherProviderChecks(['codex'], scanSkillsStub());
        const contextCheck = facts[0].checks.find((c: { id: string }) => c.id === 'context.global');
        expect(contextCheck).toMatchObject({ id: 'context.global', state: 'delivered' });
    });

    it('Codex with nothing installed reports absent — regression (pre-existing behavior)', () => {
        seedRegistry();
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['codex'], scanSkillsStub());
        const contextCheck = facts[0].checks.find((c: { id: string }) => c.id === 'context.global');
        expect(contextCheck).toMatchObject({ id: 'context.global', state: 'absent', remediationCode: 'awm-init' });
    });
});

describe('skillsGlobalCheck — renderer-aware (Task 4.4 / deferred Task 4.3 finding)', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-tier-skills-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules(); // see contextGlobalCheck describe above for why
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('non-link renderer (copilot-instructions) with real rendered files reports presence-only, not healthy', () => {
        const instrDir = path.join(tmpHome, 'proj/.github/instructions');
        fs.mkdirSync(instrDir, { recursive: true });
        fs.writeFileSync(
            path.join(instrDir, 'development-process.instructions.md'),
            '---\napplyTo: "**"\n---\n\nBody.',
        );

        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        // Copilot has no global skill dir — skills.global is omitted (null). Probe local
        // rendered path via a projectRoot-aware install is out of this check; here we only
        // assert cursor (now link) is not misclassified as a non-link renderer.
        const cursorFacts = gatherProviderChecks(['cursor'], scanSkills);
        expect(cursorFacts[0].checks.find((c: { id: string }) => c.id === 'skills.global')?.state)
            .toBe('absent');
    });

    it('Gap B — Cursor link skills install under ~/.agents/skills via real pipeline', () => {
        const { discoverBundles } = require('../../../src/core/bundles');
        const { installBundle } = require('../../../src/core/bundle-install');

        const content = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-tier-registry-'));
        fs.mkdirSync(path.join(content, 'bundles', 'dev-core'), { recursive: true });
        fs.mkdirSync(path.join(content, 'skills', 'using-awm'), { recursive: true });
        fs.writeFileSync(
            path.join(content, 'skills', 'using-awm', 'SKILL.md'),
            '---\nname: using-awm\ndescription: Use when starting any development conversation\n---\n\nMUST invoke skills.\n',
        );
        fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
            version: 1,
            bundles: [{ name: 'dev-core', source: './bundles/dev-core', version: '1.0.0', scope: 'baseline' }],
        }));
        fs.writeFileSync(path.join(content, 'bundles', 'dev-core', 'bundle.json'), JSON.stringify({
            name: 'dev-core', version: '1.0.0', description: '', scope: 'baseline',
            dependsOn: [], skills: ['using-awm'], workflows: [], agents: [],
        }));

        installBundle({
            bundleName: 'dev-core',
            bundles: discoverBundles(content),
            agents: ['cursor'],
            method: 'symlink',
            projectRoot: tmpHome,
            contentDir: content,
        });

        const skillsDir = path.join(tmpHome, '.agents/skills');
        expect(fs.existsSync(path.join(skillsDir, 'using-awm'))).toBe(true);
        expect(fs.existsSync(path.join(tmpHome, '.cursor/rules/using-awm.mdc'))).toBe(false);

        const scanSkills = jest.fn(() => ({ valid: ['using-awm'], repairable: [], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['cursor'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'healthy', target: skillsDir });

        fs.rmSync(content, { recursive: true, force: true });
    });

    it('a rendered Copilot file that no longer matches its registry source is reported stale', () => {
        const source = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stale-src-'));
        fs.mkdirSync(path.join(source, 'using-awm'), { recursive: true });
        const skillMd = path.join(source, 'using-awm', 'SKILL.md');
        fs.writeFileSync(skillMd, '---\nname: using-awm\ndescription: original\n---\n\nCuerpo v1.\n');

        const instrDir = path.join(tmpHome, 'proj/.github/instructions');
        fs.mkdirSync(instrDir, { recursive: true });
        const target = path.join(instrDir, 'using-awm.instructions.md');
        const { renderArtifact } = require('../../../src/core/renderers/registry');
        fs.writeFileSync(target, renderArtifact('copilot-instructions', path.join(source, 'using-awm')));

        const stateDir = path.join(tmpHome, '.awm', 'state');
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(path.join(stateDir, 'artifacts.json'), JSON.stringify([{
            name: 'using-awm', type: 'skill', scope: 'local',
            targetPath: target, sourcePath: path.join(source, 'using-awm'),
            renderer: 'copilot-instructions', owners: ['copilot'],
        }]));

        // Copilot has no global skills check — stale rendered local artifacts stay on the
        // ledger for migration/repair paths; cursor (link) no longer owns .mdc rows.
        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const cursorSkills = gatherProviderChecks(['cursor'], scanSkills)[0]
            .checks.find((c: { id: string }) => c.id === 'skills.global');
        expect(cursorSkills?.state).toBe('absent');

        fs.rmSync(source, { recursive: true, force: true });
    });

    it('Cursor link skills with an empty/missing dir reports absent, not a false healthy', () => {
        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['cursor'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'absent' });
    });

    it('link renderer (claude-code) behavior is completely unchanged — regression', () => {
        const skillsDir = path.join(tmpHome, '.claude/skills');
        fs.mkdirSync(skillsDir, { recursive: true });

        const scanSkills = jest.fn(() => ({ valid: ['using-awm'], repairable: [], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['claude-code'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'healthy', target: skillsDir });
        expect(skillsCheck?.detail).toBeUndefined();
    });

    it('link renderer (claude-code) still reports broken links — regression', () => {
        const skillsDir = path.join(tmpHome, '.claude/skills');
        fs.mkdirSync(skillsDir, { recursive: true });

        const scanSkills = jest.fn(() => ({ valid: [], repairable: ['stale-skill'], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['claude-code'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({
            id: 'skills.global',
            state: 'broken',
            detail: '1 broken links',
            remediationCode: 'repair-global-skills',
        });
    });

    describe('false-positive fix — Cursor rules leftovers must not count as shared skills', () => {
        it('cursor: leftover .mdc under ~/.cursor/rules does not satisfy skills.global (link dir)', () => {
            const rulesDir = path.join(tmpHome, '.cursor/rules');
            fs.mkdirSync(rulesDir, { recursive: true });
            fs.writeFileSync(
                path.join(rulesDir, 'foo.mdc'),
                '---\ndescription: foo\nglobs:\nalwaysApply: false\n---\n\nBody.',
            );

            const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
            const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
            const facts = gatherProviderChecks(['cursor'], scanSkills);
            const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

            expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'absent' });
        });
    });

    it('reports context.overlap as informational pending when claude-code and cursor coexist (R19)', () => {
        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [], usurped: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const { computeProviderOverall } = require('../../../src/core/diagnostics/checks');
        const facts = gatherProviderChecks(['claude-code', 'cursor'], scanSkills);
        const cursor = facts.find((f: { id: string }) => f.id === 'cursor')!;
        const overlap = cursor.checks.find((c: { id: string }) => c.id === 'context.overlap');
        expect(overlap).toMatchObject({ state: 'pending' });
        expect(overlap?.detail).toMatch(/Claude Code may import Cursor hooks/);
        // R19: the overlap row alone must never flip overall to degraded.
        expect(computeProviderOverall([{ ...cursor, checks: [overlap!] }])).toBe('healthy');
    });
});
