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
        cursor: 'agents-md-managed',
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
        return jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
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

    it('non-link renderer (cursor-mdc) with real rendered files reports presence-only, not healthy', () => {
        const rulesDir = path.join(tmpHome, '.cursor/rules');
        fs.mkdirSync(rulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(rulesDir, 'development-process.mdc'),
            '---\ndescription: dev process\nalwaysApply: true\n---\n\nBody.',
        );

        // classifySkillLinks only ever sees symlinks (`if (!lst.isSymbolicLink()) continue;`)
        // — a real scan over rulesDir would find nothing here either. Stubbed explicitly so the
        // test proves the FIX (renderer-gating), not an accident of what classifySkillLinks does.
        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['cursor'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck?.state).not.toBe('healthy');
        expect(skillsCheck?.state).toBe('supported');
        expect(skillsCheck?.detail).toContain('not verified');
    });

    it('Gap B — non-link renderer (cursor-mdc) against REAL renderer/pipeline output, not a hand-written approximation', () => {
        // The test above hand-writes a `.mdc` file whose frontmatter shape is only an
        // approximation of what the real cursor-mdc renderer emits. This drives the
        // REAL default `installBundle`/`applyInstallPlan` pipeline (core/bundle-install.ts,
        // the same one `awm init`/`awm add` use) end-to-end for a global-scope Cursor
        // skill, so the file skillsGlobalCheck inspects here is exactly what the
        // renderer actually produces — not a fixture that merely resembles it.
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
            projectRoot: tmpHome, // irrelevant for a global-scope install
            contentDir: content,
        });

        const rulesDir = path.join(tmpHome, '.cursor/rules');
        expect(fs.existsSync(path.join(rulesDir, 'using-awm.mdc'))).toBe(true);

        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['cursor'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'supported', target: rulesDir });
        expect(skillsCheck?.detail).toContain('not verified');

        fs.rmSync(content, { recursive: true, force: true });
    });

    it('non-link renderer with an empty/missing dir reports absent, not a false healthy', () => {
        const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['cursor'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'absent', remediationCode: 'awm-init' });
    });

    it('link renderer (claude-code) behavior is completely unchanged — regression', () => {
        const skillsDir = path.join(tmpHome, '.claude/skills');
        fs.mkdirSync(skillsDir, { recursive: true });

        const scanSkills = jest.fn(() => ({ valid: ['using-awm'], repairable: [], dead: [] }));
        const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
        const facts = gatherProviderChecks(['claude-code'], scanSkills);
        const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

        expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'healthy', target: skillsDir });
        expect(skillsCheck?.detail).toBeUndefined();
    });

    it('link renderer (claude-code) still reports broken links — regression', () => {
        const skillsDir = path.join(tmpHome, '.claude/skills');
        fs.mkdirSync(skillsDir, { recursive: true });

        const scanSkills = jest.fn(() => ({ valid: [], repairable: ['stale-skill'], dead: [] }));
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

    describe('false-positive fix — an unrelated file must not read as an AWM install', () => {
        it('cursor: a dir containing ONLY an unrelated non-.mdc file reports absent, not supported', () => {
            const rulesDir = path.join(tmpHome, '.cursor/rules');
            fs.mkdirSync(rulesDir, { recursive: true });
            // A user's own pre-existing file, or a directory they created themselves —
            // neither ends in `.mdc`, so neither is AWM-shaped evidence.
            fs.writeFileSync(path.join(rulesDir, 'notes.txt'), 'my own notes, not an AWM rule');
            fs.mkdirSync(path.join(rulesDir, 'some-user-dir'));

            const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
            const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
            const facts = gatherProviderChecks(['cursor'], scanSkills);
            const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

            expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'absent', remediationCode: 'awm-init' });
        });

        it('cursor: a dir containing a real *.mdc file reports supported', () => {
            const rulesDir = path.join(tmpHome, '.cursor/rules');
            fs.mkdirSync(rulesDir, { recursive: true });
            fs.writeFileSync(path.join(rulesDir, 'notes.txt'), 'my own notes, not an AWM rule');
            fs.writeFileSync(
                path.join(rulesDir, 'foo.mdc'),
                '---\ndescription: foo\nglobs:\nalwaysApply: false\n---\n\nBody.',
            );

            const scanSkills = jest.fn(() => ({ valid: [], repairable: [], dead: [] }));
            const { gatherProviderChecks } = require('../../../src/core/diagnostics/provider-checks');
            const facts = gatherProviderChecks(['cursor'], scanSkills);
            const skillsCheck = facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');

            expect(skillsCheck).toMatchObject({ id: 'skills.global', state: 'supported' });
        });

        // NOTE: no copilot companion case here — copilot's `skill.global` is `null`
        // (no user-level skill discovery mechanism at all, providers/index.ts), so
        // `skillsGlobalCheck` returns `null` for it and `gatherProviderChecks` drops
        // the `skills.global` row entirely before the renderer-extension gate this
        // describe block exercises is ever reached. There is no real directory for
        // a copilot-shaped false positive to occur against. The null-global-dir
        // branch itself (the guard that makes this row vanish for copilot) is
        // covered separately as part of Gap C's null-skip coverage.
    });
});
