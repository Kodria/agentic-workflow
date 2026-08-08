import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodexAgentsStrategy } from '../../../../src/core/context/strategies/codex-agents';
import { sha256 } from '../../../../src/core/context/provider';
import type { InjectionInput } from '../../../../src/core/context/types';
import type { ProviderConfig } from '../../../../src/providers';

describe('CodexAgentsStrategy', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    it('injects global AWM bootstrap without changing user rules', () => {
        fs.mkdirSync(path.join(tmpHome, '.codex'), { recursive: true });
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.writeFileSync(file, '# Personal\n\nDo not delete.\n');

        const result = new CodexAgentsStrategy().injectGlobal(
            { markdown: '# AWM\n\nUse `development-process`.' },
            codexProvider(file),
        );

        expect(result).toBe('injected');
        const written = fs.readFileSync(file, 'utf8');
        expect(written).toContain('# Personal\n\nDo not delete.\n');
        expect(written).toContain('Use `development-process`.');
    });

    it('creates the global file and returns unchanged on an idempotent repeat', () => {
        const strategy = new CodexAgentsStrategy();
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        const provider = codexProvider(file);
        const context = { markdown: '# AWM\n\nBootstrap.' };

        expect(strategy.injectGlobal(context, provider)).toBe('injected');
        expect(strategy.injectGlobal(context, provider)).toBe('unchanged');
        expect(fs.existsSync(file)).toBe(true);
    });

    it('uses HOME at call time', () => {
        const firstHome = tmpHome;
        const secondHome = path.join(tmpWork, 'second-home');
        const strategy = new CodexAgentsStrategy();

        strategy.injectGlobal({ markdown: 'first' }, codexProvider(path.join(firstHome, '.codex/AGENTS.md')));
        process.env.HOME = secondHome;
        strategy.injectGlobal({ markdown: 'second' }, codexProvider(path.join(secondHome, '.codex/AGENTS.md')));

        expect(fs.readFileSync(path.join(firstHome, '.codex/AGENTS.md'), 'utf8')).toContain('first');
        expect(fs.readFileSync(path.join(secondHome, '.codex/AGENTS.md'), 'utf8')).toContain('second');
    });

    it('updates only its global managed block', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'before\n');
        const strategy = new CodexAgentsStrategy();
        const provider = codexProvider(file);
        strategy.injectGlobal({ markdown: 'old' }, provider);
        fs.appendFileSync(file, 'after\n');

        strategy.injectGlobal({ markdown: 'new' }, provider);

        expect(fs.readFileSync(file, 'utf8')).toBe(
            'before\n\n<!-- AWM:START -->\n<!-- AWM:BOUNDARY prefix=1 suffix=1 -->\nnew\n<!-- AWM:END -->\nafter\n',
        );
    });

    it('fails on ambiguous global markers without changing the file', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const ambiguous = '<!-- AWM:START -->\nuser';
        fs.writeFileSync(file, ambiguous);

        expect(() => new CodexAgentsStrategy().injectGlobal({ markdown: 'new' }, codexProvider(file))).toThrow('unmatched');
        expect(fs.readFileSync(file, 'utf8')).toBe(ambiguous);
    });

    it('rejects inline marker examples without changing the global file', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const ambiguous = '`<!-- AWM:START -->` example and `<!-- AWM:END -->` example';
        fs.writeFileSync(file, ambiguous);

        expect(() => new CodexAgentsStrategy().injectGlobal({ markdown: 'new' }, codexProvider(file))).toThrow('standalone');
        expect(fs.readFileSync(file, 'utf8')).toBe(ambiguous);
    });

    it.each([
        '<!-- AWM:BOUNDARY prefix=9 suffix=1 -->',
        '<!-- AWM:BOUNDARY prefix=1 suffix=2 -->',
        '<!-- AWM:BOUNDARY prefix=1 suffix=1 -->\n<!-- AWM:BOUNDARY prefix=0 suffix=1 -->',
        'owned\n<!-- AWM:BOUNDARY prefix=1 suffix=1 -->',
        '<!-- AWM:BOUNDARY prefix=1',
        'inline <!-- AWM:BOUNDARY prefix=1 suffix=1 -->',
    ])('rejects ambiguous boundary metadata without changing the file: %j', (metadata) => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        const materialized = path.join(tmpWork, 'awm-context.md');
        const markdown = '# AWM\n\nExpected.';
        const original = `<!-- AWM:START -->\n${metadata}\nowned\n<!-- AWM:END -->`;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, original);
        fs.writeFileSync(materialized, markdown);
        const provider = codexProvider(file);
        const input = injectionInput(materialized, markdown);
        const strategy = new CodexAgentsStrategy();

        expect(() => strategy.inject(input, provider)).toThrow('malformed AWM boundary metadata');
        expect(() => strategy.remove(input, provider)).toThrow('malformed AWM boundary metadata');
        expect(() => strategy.status(input, provider)).toThrow('malformed AWM boundary metadata');
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
    });

    it('injects project constitution guidance without owning the whole AGENTS.md', () => {
        const project = path.join(tmpWork, 'repo');
        fs.mkdirSync(project, { recursive: true });
        fs.writeFileSync(path.join(project, 'CONSTITUTION.md'), '# Rules\n');
        fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Repo-owned rules\n');

        const result = new CodexAgentsStrategy().injectProject(project, codexProvider(path.join(tmpHome, '.codex/AGENTS.md')));

        expect(result).toBe('injected');
        const written = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
        expect(written).toContain('# Repo-owned rules');
        expect(written).toContain('Read and obey `CONSTITUTION.md` before work');
    });

    it('creates project guidance even before CONSTITUTION.md exists and is idempotent', () => {
        const project = path.join(tmpWork, 'repo');
        fs.mkdirSync(project, { recursive: true });
        const strategy = new CodexAgentsStrategy();
        const provider = codexProvider(path.join(tmpHome, '.codex/AGENTS.md'));

        expect(strategy.injectProject(project, provider)).toBe('injected');
        expect(strategy.injectProject(project, provider)).toBe('unchanged');
        expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'))
            .toContain('when that file exists');
    });

    it('injectProject writes a redundant .cursor/rules/awm.mdc carrier (alwaysApply: true) for Cursor, and skips its own AGENTS.md write (owned by inject(), see collision regression below)', () => {
        const project = path.join(tmpWork, 'cursor-repo');
        fs.mkdirSync(project, { recursive: true });
        const strategy = new CodexAgentsStrategy();

        const result = strategy.injectProject(project, cursorProvider(), 'cursor');

        expect(result).toBe('injected');
        expect(fs.existsSync(path.join(project, 'AGENTS.md'))).toBe(false);
        const mdc = fs.readFileSync(path.join(project, '.cursor/rules/awm.mdc'), 'utf8');
        expect(mdc).toContain('alwaysApply: true');
        expect(mdc).toContain('Read and obey `CONSTITUTION.md` before work');
    });

    it('injectProject writes only AGENTS.md (no .cursor/rules) for a provider whose context injection is a SEPARATE (global) file', () => {
        const project = path.join(tmpWork, 'codex-project-repo');
        fs.mkdirSync(project, { recursive: true });
        const strategy = new CodexAgentsStrategy();

        strategy.injectProject(project, codexProvider(path.join(tmpHome, '.codex/AGENTS.md')));

        expect(fs.existsSync(path.join(project, 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(path.join(project, '.cursor'))).toBe(false);
    });

    it('injectProject writes NEITHER AGENTS.md NOR a carrier for Copilot (local-context provider, no carrier mechanism)', () => {
        const project = path.join(tmpWork, 'copilot-repo');
        fs.mkdirSync(project, { recursive: true });
        const strategy = new CodexAgentsStrategy();

        const result = strategy.injectProject(project, copilotProvider(), 'copilot');

        expect(result).toBe('unchanged');
        expect(fs.existsSync(path.join(project, 'AGENTS.md'))).toBe(false);
        expect(fs.existsSync(path.join(project, '.cursor'))).toBe(false);
    });

    it('regression: local-scope context injection + project constitution injection no longer collide on the same AGENTS.md managed block (R4 QA blocker)', () => {
        // Before the fix: inject() (context) and injectProject() (constitution) both wrote
        // the SAME single-slot managed block in <projectRoot>/AGENTS.md for a local-scope
        // provider (Cursor/Copilot) — whichever ran second silently discarded the other's
        // content. stepContextInjection runs before stepConstitutionInjection in the real
        // init orchestrator (init/orchestrator.ts), so constitution always won, and the real
        // AWM skill/context guidance never survived a real `awm init --agent cursor` run.
        const project = path.join(tmpWork, 'collision-repo');
        fs.mkdirSync(project, { recursive: true });
        const materialized = path.join(project, '.awm/context/awm-context.md');
        const contextMarkdown = '# AWM\n\nUse `development-process`. MUST invoke skills per policy.';
        fs.mkdirSync(path.dirname(materialized), { recursive: true });
        fs.writeFileSync(materialized, contextMarkdown);
        const provider = cursorProvider();
        const strategy = new CodexAgentsStrategy();
        const input: InjectionInput = {
            ref: { absPath: materialized, scope: 'local', contentHash: sha256(contextMarkdown) },
            registryRoot: '/registry',
            installMethod: 'copy',
            agent: 'cursor',
            scope: 'local',
            projectRoot: project,
        };

        expect(strategy.inject(input, provider)).toBe('injected');
        expect(strategy.injectProject(project, provider, 'cursor')).toBe('injected'); // carrier only

        const written = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
        expect(written).toContain('MUST invoke skills per policy');
        expect(written).toContain('Read and obey `CONSTITUTION.md` before work');
        expect(strategy.status(input, provider)).toBe('injected');

        // Idempotent: a second full pass (context re-inject, then constitution/carrier) changes nothing.
        expect(strategy.inject(input, provider)).toBe('unchanged');
        expect(strategy.injectProject(project, provider, 'cursor')).toBe('unchanged');
        expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toBe(written);
    });

    it('implements global status and remove while preserving user bytes', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        const materialized = path.join(tmpWork, 'awm-context.md');
        const markdown = '# AWM\n\nExpected.';
        fs.writeFileSync(materialized, markdown);
        const provider = codexProvider(file);
        const input = injectionInput(materialized, markdown);
        const strategy = new CodexAgentsStrategy();

        expect(strategy.status(input, provider)).toBe('absent');
        expect(strategy.inject(input, provider)).toBe('injected');
        expect(strategy.status(input, provider)).toBe('injected');
        const staleInput = {
            ...input,
            ref: { ...input.ref, contentHash: sha256('# AWM\n\nUpdated.') },
        };
        expect(strategy.status(staleInput, provider)).toBe('stale');

        fs.appendFileSync(file, 'user suffix\n');
        strategy.remove(input, provider);
        expect(fs.readFileSync(file, 'utf8')).toBe('user suffix\n');
        expect(strategy.status(input, provider)).toBe('absent');
    });

    it('validates public inputs and never writes outside the configured roots', () => {
        const strategy = new CodexAgentsStrategy();
        const provider = codexProvider(path.join(tmpHome, '.codex/AGENTS.md'));
        expect(() => strategy.injectGlobal({ markdown: '' }, provider)).toThrow('markdown');
        expect(() => strategy.injectGlobal(null as never, provider)).toThrow('context');
        expect(() => strategy.injectProject('', provider)).toThrow('projectRoot');

        const open = jest.spyOn(fs, 'openSync');
        strategy.injectGlobal({ markdown: 'safe' }, provider);
        strategy.injectProject(path.join(tmpWork, 'safe-project'), provider);

        const opened = open.mock.calls.map((call) => String(call[0]));
        expect(opened.every((file) => file.startsWith(tmpHome) || file.startsWith(tmpWork))).toBe(true);
    });

    it('regression: Codex (non-null globalPath) still requires global scope — unchanged behavior', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        const materialized = path.join(tmpWork, 'awm-context.md');
        const markdown = '# AWM\n\nExpected.';
        fs.writeFileSync(materialized, markdown);
        const provider = codexProvider(file);
        const strategy = new CodexAgentsStrategy();

        const localInput: InjectionInput = {
            ref: { absPath: materialized, scope: 'local', contentHash: sha256(markdown) },
            registryRoot: '/registry',
            installMethod: 'copy',
            agent: 'codex',
            scope: 'local',
            projectRoot: tmpWork,
        };

        expect(() => strategy.inject(localInput, provider)).toThrow('supports only global injection');
        expect(fs.existsSync(file)).toBe(false);
    });

    it('Copilot-shaped provider (null globalPath): inject() at scope local writes <projectRoot>/AGENTS.md, not any global path', () => {
        const project = path.join(tmpWork, 'copilot-local-repo');
        fs.mkdirSync(project, { recursive: true });
        const materialized = path.join(tmpWork, 'awm-context.md');
        const markdown = '# AWM\n\nCopilot body.';
        fs.writeFileSync(materialized, markdown);
        const provider = copilotProvider();
        const strategy = new CodexAgentsStrategy();

        const input: InjectionInput = {
            ref: { absPath: materialized, scope: 'local', contentHash: sha256(markdown) },
            registryRoot: '/registry',
            installMethod: 'copy',
            agent: 'copilot',
            scope: 'local',
            projectRoot: project,
        };

        expect(strategy.inject(input, provider)).toBe('injected');
        const written = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
        expect(written).toContain('Copilot body.');
        expect(strategy.status(input, provider)).toBe('injected');
    });

    it('Copilot-shaped provider (null globalPath): calling at scope global throws (required scope is local)', () => {
        const materialized = path.join(tmpWork, 'awm-context.md');
        const markdown = '# AWM\n\nBody.';
        fs.writeFileSync(materialized, markdown);
        const provider = copilotProvider();
        const strategy = new CodexAgentsStrategy();

        const globalInput: InjectionInput = {
            ref: { absPath: materialized, scope: 'global', contentHash: sha256(markdown) },
            registryRoot: '/registry',
            installMethod: 'copy',
            agent: 'copilot',
            scope: 'global',
        };

        expect(() => strategy.inject(globalInput, provider)).toThrow('supports only local injection');
    });
});

function codexProvider(globalPath: string): ProviderConfig {
    return {
        label: 'Codex',
        skill: { global: '', local: '', renderer: 'link' },
        workflow: null,
        agent: null,
        injection: { type: 'managed-agents-md', globalPath, localFile: 'AGENTS.md' },
    };
}

function copilotProvider(): ProviderConfig {
    return {
        label: 'Copilot',
        skill: { global: null, local: '.github/instructions', renderer: 'link' },
        workflow: null,
        agent: null,
        injection: { type: 'managed-agents-md', globalPath: null, localFile: 'AGENTS.md' },
    };
}

function cursorProvider(): ProviderConfig {
    return {
        label: 'Cursor',
        skill: { global: '', local: '.cursor/rules', renderer: 'link' },
        workflow: null,
        agent: null,
        injection: { type: 'managed-agents-md', globalPath: null, localFile: 'AGENTS.md' },
    };
}

function injectionInput(absPath: string, markdown: string): InjectionInput {
    return {
        ref: { absPath, scope: 'global', contentHash: sha256(markdown) },
        registryRoot: '/registry',
        installMethod: 'copy',
        agent: 'codex',
        scope: 'global',
    };
}
