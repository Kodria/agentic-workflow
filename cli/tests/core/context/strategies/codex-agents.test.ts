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

        const result = new CodexAgentsStrategy().injectGlobal({
            markdown: '# AWM\n\nUse `development-process`.',
        });

        expect(result).toBe('injected');
        const written = fs.readFileSync(file, 'utf8');
        expect(written).toContain('# Personal\n\nDo not delete.\n');
        expect(written).toContain('Use `development-process`.');
    });

    it('creates the global file and returns unchanged on an idempotent repeat', () => {
        const strategy = new CodexAgentsStrategy();
        const context = { markdown: '# AWM\n\nBootstrap.' };

        expect(strategy.injectGlobal(context)).toBe('injected');
        expect(strategy.injectGlobal(context)).toBe('unchanged');
        expect(fs.existsSync(path.join(tmpHome, '.codex/AGENTS.md'))).toBe(true);
    });

    it('uses HOME at call time', () => {
        const firstHome = tmpHome;
        const secondHome = path.join(tmpWork, 'second-home');
        const strategy = new CodexAgentsStrategy();

        strategy.injectGlobal({ markdown: 'first' });
        process.env.HOME = secondHome;
        strategy.injectGlobal({ markdown: 'second' });

        expect(fs.readFileSync(path.join(firstHome, '.codex/AGENTS.md'), 'utf8')).toContain('first');
        expect(fs.readFileSync(path.join(secondHome, '.codex/AGENTS.md'), 'utf8')).toContain('second');
    });

    it('updates only its global managed block', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'before\n');
        const strategy = new CodexAgentsStrategy();
        strategy.injectGlobal({ markdown: 'old' });
        fs.appendFileSync(file, 'after\n');

        strategy.injectGlobal({ markdown: 'new' });

        expect(fs.readFileSync(file, 'utf8')).toBe(
            'before\n\n<!-- AWM:START -->\n<!-- AWM:BOUNDARY prefix=1 suffix=1 -->\nnew\n<!-- AWM:END -->\nafter\n',
        );
    });

    it('fails on ambiguous global markers without changing the file', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const ambiguous = '<!-- AWM:START -->\nuser';
        fs.writeFileSync(file, ambiguous);

        expect(() => new CodexAgentsStrategy().injectGlobal({ markdown: 'new' })).toThrow('unmatched');
        expect(fs.readFileSync(file, 'utf8')).toBe(ambiguous);
    });

    it('rejects inline marker examples without changing the global file', () => {
        const file = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const ambiguous = '`<!-- AWM:START -->` example and `<!-- AWM:END -->` example';
        fs.writeFileSync(file, ambiguous);

        expect(() => new CodexAgentsStrategy().injectGlobal({ markdown: 'new' })).toThrow('standalone');
        expect(fs.readFileSync(file, 'utf8')).toBe(ambiguous);
    });

    it('injects project constitution guidance without owning the whole AGENTS.md', () => {
        const project = path.join(tmpWork, 'repo');
        fs.mkdirSync(project, { recursive: true });
        fs.writeFileSync(path.join(project, 'CONSTITUTION.md'), '# Rules\n');
        fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Repo-owned rules\n');

        const result = new CodexAgentsStrategy().injectProject(project);

        expect(result).toBe('injected');
        const written = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
        expect(written).toContain('# Repo-owned rules');
        expect(written).toContain('Read and obey `CONSTITUTION.md` before work');
    });

    it('creates project guidance even before CONSTITUTION.md exists and is idempotent', () => {
        const project = path.join(tmpWork, 'repo');
        fs.mkdirSync(project, { recursive: true });
        const strategy = new CodexAgentsStrategy();

        expect(strategy.injectProject(project)).toBe('injected');
        expect(strategy.injectProject(project)).toBe('unchanged');
        expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'))
            .toContain('when that file exists');
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
        expect(() => strategy.injectGlobal({ markdown: '' })).toThrow('markdown');
        expect(() => strategy.injectGlobal(null as never)).toThrow('context');
        expect(() => strategy.injectProject('')).toThrow('projectRoot');

        const open = jest.spyOn(fs, 'openSync');
        strategy.injectGlobal({ markdown: 'safe' });
        strategy.injectProject(path.join(tmpWork, 'safe-project'));

        const opened = open.mock.calls.map((call) => String(call[0]));
        expect(opened.every((file) => file.startsWith(tmpHome) || file.startsWith(tmpWork))).toBe(true);
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

function injectionInput(absPath: string, markdown: string): InjectionInput {
    return {
        ref: { absPath, scope: 'global', contentHash: sha256(markdown) },
        registryRoot: '/registry',
        installMethod: 'copy',
        agent: 'codex',
        scope: 'global',
    };
}
