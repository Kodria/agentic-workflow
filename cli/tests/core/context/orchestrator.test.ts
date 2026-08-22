// cli/tests/core/context/orchestrator.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InjectionOrchestrator } from '../../../src/core/context/orchestrator';
import { globalContextPath, projectContextPath } from '../../../src/core/context/materializer';

jest.mock('../../../src/commands/hooks/install', () => ({ installHook: jest.fn() }));
jest.mock('../../../src/commands/hooks/uninstall', () => ({ uninstallHook: jest.fn() }));
jest.mock('../../../src/commands/hooks/status', () => ({
    computeHookStatus: jest.fn().mockReturnValue({ overall: 'NOT_INSTALLED' }),
}));

import { installHook } from '../../../src/commands/hooks/install';
import { uninstallHook } from '../../../src/commands/hooks/uninstall';
import { computeHookStatus } from '../../../src/commands/hooks/status';
import { writeRegistriesConfig, registryContentRoot } from '../../../src/core/registries';

// inputFor/statusInputFor now call listRegistries() (collectDeclaredOrchestrators) on every
// install/status. Without isolating AWM_HOME here, that reads the REAL ~/.awm/registries.json
// of whatever machine runs the suite — exactly what CLAUDE.md's testing rule forbids ("ningun
// test puede tocar el ~/.awm real. Todos usan tmpdirs aislados"). An empty isolated AWM_HOME
// makes listRegistries() return [] deterministically, matching pre-change behavior everywhere.
let isolatedAwmHome: string;
let originalAwmHomeEnv: string | undefined;

beforeEach(() => {
    isolatedAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-isolated-home-'));
    originalAwmHomeEnv = process.env.AWM_HOME;
    process.env.AWM_HOME = isolatedAwmHome;
});

afterEach(() => {
    if (originalAwmHomeEnv === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = originalAwmHomeEnv;
    fs.rmSync(isolatedAwmHome, { recursive: true, force: true });
});

function tmpRegistry(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
    const dir = path.join(root, 'skills/using-awm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nversion: "1.0.0"\n---\nBODY');
    return root;
}

describe('InjectionOrchestrator (claude-code dispatch via HookMergeStrategy)', () => {
    const ccOverride = {
        label: 'Claude Code', configHome: { envVar: null, dir: '.test', resolved: '/tmp/test-config-home' }, skill: { global: '', local: '', renderer: 'link' as const }, workflow: null, agent: null,
        injection: { type: 'cc-settings-merge' as const },
        hooks: { type: 'cc-settings-merge' as const, settingsPath: '', scriptsDir: '', matcher: '', eventName: '' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('installContext delegates to installHook', () => {
        const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cc-reg-'));
        const dir = path.join(reg, 'skills/using-awm');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nversion: "1.0.0"\n---\nBODY');
        const ctxPath = path.join(reg, 'awm-context.md');
        const orch = new InjectionOrchestrator({ providerOverride: ccOverride, contextPathOverride: ctxPath });
        orch.installContext({ agent: 'claude-code', scope: 'global', registryRoot: reg, installMethod: 'symlink', profileExtensions: [] });
        expect(installHook).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
    });

    it('uninstallContext delegates to uninstallHook', () => {
        const orch = new InjectionOrchestrator({ providerOverride: ccOverride });
        orch.uninstallContext({ agent: 'claude-code', scope: 'global', registryRoot: '/any', installMethod: 'symlink', profileExtensions: [] });
        expect(uninstallHook).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
    });

    it('contextStatus delegates to computeHookStatus and returns absent when NOT_INSTALLED', () => {
        (computeHookStatus as jest.Mock).mockReturnValue({ overall: 'NOT_INSTALLED' });
        const orch = new InjectionOrchestrator({ providerOverride: ccOverride });
        const state = orch.contextStatus({ agent: 'claude-code', scope: 'global', registryRoot: '/any', installMethod: 'symlink', profileExtensions: [] });
        expect(computeHookStatus).toHaveBeenCalledWith('claude-code');
        expect(state).toBe('absent');
    });

    it('contextStatus returns injected when hook reports HEALTHY', () => {
        (computeHookStatus as jest.Mock).mockReturnValue({ overall: 'HEALTHY' });
        const orch = new InjectionOrchestrator({ providerOverride: ccOverride });
        const state = orch.contextStatus({ agent: 'claude-code', scope: 'global', registryRoot: '/any', installMethod: 'symlink', profileExtensions: [] });
        expect(state).toBe('injected');
    });

    it('throws when providerOverride has no injection (does not fall through to real agent config)', () => {
        const noInjection = {
            label: 'Test',
            configHome: { envVar: null, dir: '.test', resolved: '/tmp/test-config-home' }, skill: { global: '', local: '', renderer: 'link' as const },
            workflow: null,
            agent: null,
        };
        const orch = new InjectionOrchestrator({ providerOverride: noInjection });
        expect(() => orch.installContext({ agent: 'claude-code', scope: 'global', registryRoot: '/any', installMethod: 'symlink', profileExtensions: [] }))
            .toThrow('no injection mechanism');
    });
});

describe('InjectionOrchestrator (opencode, real strategy)', () => {
    let configPath: string;
    let absPath: string;
    let orch: InjectionOrchestrator;
    let registryRoot: string;

    beforeEach(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-oc-'));
        configPath = path.join(dir, 'opencode.json');
        absPath = path.join(dir, 'awm-context.md');
        registryRoot = tmpRegistry();
        orch = new InjectionOrchestrator({
            providerOverride: {
                label: 'OpenCode', configHome: { envVar: null, dir: '.test', resolved: '/tmp/test-config-home' }, skill: { global: '', local: '', renderer: 'link' }, workflow: null, agent: null,
                injection: { type: 'config-instructions', configPath, field: 'instructions' },
            },
            contextPathOverride: absPath,
        });
    });

    it('installContext materializes content and injects the sentinel; status reports injected', () => {
        orch.installContext({ agent: 'opencode', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] });
        expect(fs.existsSync(absPath)).toBe(true);
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(cfg.instructions).toContain(absPath);
        expect(orch.contextStatus({ agent: 'opencode', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] })).toBe('injected');
    });

    it('uninstallContext removes the sentinel; status reports absent', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        orch.uninstallContext(args);
        expect(orch.contextStatus(args)).toBe('absent');
    });

    it('throws when the agent has no injection mechanism', () => {
        const bare = new InjectionOrchestrator();
        expect(() => bare.installContext({ agent: 'antigravity', scope: 'global', registryRoot, installMethod: 'symlink', profileExtensions: [] }))
            .toThrow('no injection mechanism');
    });

    it('contextStatus returns stale when the materialized file drifts without re-materializing it', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        // Drift the materialized file content after install
        fs.writeFileSync(absPath, 'DRIFTED CONTENT');
        // contextStatus must detect stale without correcting the file
        expect(orch.contextStatus(args)).toBe('stale');
        // Confirm the drifted content is still on disk (not silently corrected)
        expect(fs.readFileSync(absPath, 'utf-8')).toBe('DRIFTED CONTENT');
    });

    it('uninstallContext succeeds even when the registry does not exist', () => {
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };
        orch.installContext(args);
        // Remove the registry to simulate a degraded state
        fs.rmSync(registryRoot, { recursive: true, force: true });
        // uninstallContext must not throw 'using-awm skill not found'
        expect(() => orch.uninstallContext(args)).not.toThrow();
        // After removal the sentinel must be gone from opencode.json
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect((cfg.instructions ?? []).includes(absPath)).toBe(false);
    });
});

describe('InjectionOrchestrator (codex, managed AGENTS.md strategy)', () => {
    let roots: string[];

    beforeEach(() => {
        roots = [];
        jest.clearAllMocks();
    });

    afterEach(() => {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    });

    it('owns only the managed block and never dispatches to Claude hooks', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-orch-'));
        const registryRoot = tmpRegistry();
        roots.push(dir, registryRoot);
        const agentsPath = path.join(dir, 'AGENTS.md');
        const contextPath = path.join(dir, 'awm-context.md');
        fs.writeFileSync(agentsPath, '# User rules\n');
        const orch = new InjectionOrchestrator({
            providerOverride: {
                label: 'Codex', configHome: { envVar: null, dir: '.test', resolved: '/tmp/test-config-home' }, skill: { global: '', local: '', renderer: 'link' }, workflow: null, agent: null,
                injection: { type: 'managed-agents-md', globalPath: agentsPath, localFile: 'AGENTS.md' },
            },
            contextPathOverride: contextPath,
        });
        const op = {
            agent: 'codex' as const,
            scope: 'global' as const,
            registryRoot,
            installMethod: 'copy' as const,
            profileExtensions: [],
        };

        orch.installContext(op);

        expect(fs.readFileSync(agentsPath, 'utf8')).toContain('# User rules\n');
        expect(fs.readFileSync(agentsPath, 'utf8')).toContain('BODY');
        expect(installHook).not.toHaveBeenCalled();
        expect(orch.contextStatus(op)).toBe('injected');

        orch.uninstallContext(op);
        expect(fs.readFileSync(agentsPath, 'utf8')).toBe('# User rules\n');
    });
});

describe('InjectionOrchestrator (local scope materializes under the project, not ~/.awm)', () => {
    let tmpHome: string;
    let projectRoot: string;
    let registryRoot: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-home-'));
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-proj-'));
        registryRoot = tmpRegistry();
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
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(registryRoot, { recursive: true, force: true });
    });

    it('materializes to projectContextPath(projectRoot) for scope local, never to globalContextPath()', () => {
        const orch = new InjectionOrchestrator({
            providerOverride: {
                label: 'Copilot', configHome: { envVar: null, dir: '.test', resolved: '/tmp/test-config-home' }, skill: { global: null, local: '.github/instructions', renderer: 'link' }, workflow: null, agent: null,
                injection: { type: 'managed-agents-md', globalPath: null, localFile: 'AGENTS.md' },
            },
        });
        const op = {
            agent: 'copilot' as const,
            scope: 'local' as const,
            registryRoot,
            installMethod: 'copy' as const,
            profileExtensions: [],
            projectRoot,
        };

        orch.installContext(op);

        expect(fs.existsSync(projectContextPath(projectRoot))).toBe(true);
        expect(fs.existsSync(globalContextPath())).toBe(false);
        expect(fs.existsSync(path.join(projectRoot, 'AGENTS.md'))).toBe(true);
        expect(orch.contextStatus(op)).toBe('injected');
    });
});

describe('InjectionOrchestrator (declared orchestrators from an installed registry reach status too)', () => {
    // Regression guard for R5.1's wiring: installContext (inputFor) and contextStatus
    // (statusInputFor) must collect the SAME declared-orchestrator set. If only inputFor
    // did, the materialized file's hash would include the declared orchestrator while
    // statusInputFor's "expected" hash would not — contextStatus would report 'stale'
    // forever, even immediately after a correct install.
    it('contextStatus reports injected (not stale) right after installing with a declared orchestrator', () => {
        // The global beforeEach already points AWM_HOME at an isolated, empty home —
        // register one real registry in it so listRegistries()/collectDeclaredOrchestrators
        // actually has something to find.
        writeRegistriesConfig([{ name: 'declaring', remote: 'unused' }]);
        const registryRoot = registryContentRoot('declaring');
        fs.mkdirSync(path.join(registryRoot, 'skills/using-awm'), { recursive: true });
        fs.writeFileSync(
            path.join(registryRoot, 'skills/using-awm/SKILL.md'),
            '---\nversion: "1.0.0"\n---\nBODY',
        );
        fs.writeFileSync(
            path.join(registryRoot, 'awm-registry.json'),
            JSON.stringify({
                orchestrator: { name: 'mi-proceso', appliesWhen: 'al arrancar', terminatesTo: 'development-process' },
            }),
        );

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-oc-declared-'));
        const configPath = path.join(dir, 'opencode.json');
        const absPath = path.join(dir, 'awm-context.md');
        const orch = new InjectionOrchestrator({
            providerOverride: {
                label: 'OpenCode', configHome: { envVar: null, dir: '.test', resolved: '/tmp/test-config-home' }, skill: { global: '', local: '', renderer: 'link' }, workflow: null, agent: null,
                injection: { type: 'config-instructions', configPath, field: 'instructions' },
            },
            contextPathOverride: absPath,
        });
        const args = { agent: 'opencode' as const, scope: 'global' as const, registryRoot, installMethod: 'symlink' as const, profileExtensions: [] };

        orch.installContext(args);

        expect(fs.readFileSync(absPath, 'utf-8')).toContain('mi-proceso');
        expect(orch.contextStatus(args)).toBe('injected');

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
