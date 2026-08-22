// cli/tests/core/context/regenerate.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('regenerateGlobalContext', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regen-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    // Crea un registry falso con el skill canónico using-awm que buildContext lee.
    // Escribe registries.json apuntando al content root y crea el skill en la raíz del content root.
    function seedRegistry(body = '---\nname: using-awm\nversion: "1.0.0"\n---\nUSING-AWM-BODY') {
        const awmHome = path.join(tmpHome, '.awm');
        const contentRoot = path.join(awmHome, 'registries', 'baseline');
        const dir = path.join(contentRoot, 'skills', 'using-awm');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
        // Write registries.json so capabilityRoot('skills') resolves to contentRoot
        fs.writeFileSync(
            path.join(awmHome, 'registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.com/baseline.git' }], null, 2) + '\n',
        );
    }

    // Escribe un opencode.json con instructions[] = entries.
    function seedOpencode(entries: string[]) {
        const ocDir = path.join(tmpHome, '.config', 'opencode');
        fs.mkdirSync(ocDir, { recursive: true });
        fs.writeFileSync(path.join(ocDir, 'opencode.json'),
            JSON.stringify({ $schema: 'https://opencode.ai/config.json', instructions: entries }, null, 2));
    }

    function contextPath(): string {
        return path.join(tmpHome, '.awm', 'context', 'awm-context.md');
    }

    it('returns empty when no config-instructions agent has a config file', () => {
        seedRegistry();
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(regenerateGlobalContext(['opencode'])).toEqual([]);
    });

    it('skips an agent whose config exists but has no AWM sentinel', () => {
        seedRegistry();
        seedOpencode(['docs/rules.md']); // sin el sentinel
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(regenerateGlobalContext(['opencode'])).toEqual([{ agent: 'opencode', action: 'skipped' }]);
        expect(fs.existsSync(contextPath())).toBe(false); // no se crea el archivo
    });

    it('refreshes a stale agent (sentinel present, materialized file absent) and recreates the file', () => {
        seedRegistry();
        seedOpencode([contextPath()]); // sentinel presente, pero el archivo no existe → stale
        expect(fs.existsSync(contextPath())).toBe(false);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(regenerateGlobalContext(['opencode'])).toEqual([{ agent: 'opencode', action: 'refreshed' }]);
        expect(fs.existsSync(contextPath())).toBe(true);
        expect(fs.readFileSync(contextPath(), 'utf-8')).toContain('USING-AWM-BODY');
    });

    it('reports fresh (no rewrite) when the agent is already injected', () => {
        seedRegistry();
        seedOpencode([contextPath()]);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        regenerateGlobalContext(['opencode']);                       // 1ª pasada: stale → refreshed, crea el archivo
        const mtime1 = fs.statSync(contextPath()).mtimeMs;
        const second = regenerateGlobalContext(['opencode']);        // 2ª pasada: ya injected → fresh
        expect(second).toEqual([{ agent: 'opencode', action: 'fresh' }]);
        expect(fs.statSync(contextPath()).mtimeMs).toBe(mtime1); // archivo intacto
    });

    it('does not throw when the registry has no using-awm skill (stale but unregenerable → skipped)', () => {
        // registry con skills/ pero sin using-awm dentro; opencode stale
        const awmHome = path.join(tmpHome, '.awm');
        const contentRoot = path.join(awmHome, 'registries', 'baseline');
        // Create skills/ dir (so capabilityRoot resolves) but omit using-awm/
        fs.mkdirSync(path.join(contentRoot, 'skills'), { recursive: true });
        fs.writeFileSync(
            path.join(awmHome, 'registries.json'),
            JSON.stringify([{ name: 'baseline', remote: 'https://example.com/baseline.git' }], null, 2) + '\n',
        );
        seedOpencode([contextPath()]);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(() => regenerateGlobalContext(['opencode'])).not.toThrow();
        expect(regenerateGlobalContext(['opencode'])).toEqual([{ agent: 'opencode', action: 'skipped' }]);
    });

    it('skips agent when contextStatus throws an unexpected error', () => {
        seedRegistry();
        seedOpencode([contextPath()]);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        const { InjectionOrchestrator } = require('../../../src/core/context/orchestrator');
        const brokenOrch = new InjectionOrchestrator();
        brokenOrch.contextStatus = () => { throw new Error('unexpected orchestrator error'); };
        expect(regenerateGlobalContext(['opencode'], brokenOrch)).toEqual([{ agent: 'opencode', action: 'skipped' }]);
        expect(fs.existsSync(contextPath())).toBe(false); // installContext never called
    });

    // Regresion: el filtro exigia `type === 'config-instructions'`, o sea que
    // SOLO se regeneraba OpenCode. Para codex/cursor/copilot
    // (`managed-agents-md`) `awm update` era un no-op silencioso — ni siquiera
    // un aviso — y la unica forma de refrescar el contexto era volver a correr
    // `awm init`. Y como doctor reporta `status: healthy` / exit 0 ante un
    // contexto 'stale', un AGENTS.md desactualizado era invisible para
    // cualquier gate de CI que mirara el codigo de salida.
    it('codex (managed-agents-md con globalPath) ya no se saltea por tipo', () => {
        seedRegistry();
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        const seen: string[] = [];
        const orch = {
            contextStatus: (op: { agent: string }) => { seen.push(op.agent); return 'absent'; },
            installContext: () => undefined,
        };
        regenerateGlobalContext(['codex'], orch as never);
        expect(seen).toEqual(['codex']);
    });

    // Regresion: el if/else if no tenia rama para 'cc-settings-merge' (claude-code),
    // asi que caia sin guardia por ambos checks y llegaba a contextStatus/installContext.
    // Eso duplicaba el warning de collectAndWarn (ya disparado por el path legitimo del
    // hook, hooks/claude.ts) y escribia un ~/.awm/context/awm-context.md huerfano que
    // nada lee (el contexto real de Claude Code vive en el scriptsDir del hook). Claude
    // Code se regenera exclusivamente via resyncInstalledHooks (hooks/resync.ts).
    it('claude-code se saltea: su contexto se regenera via el hook, no aca', () => {
        seedRegistry();
        const seen: string[] = [];
        const orch = {
            contextStatus: (op: { agent: string }) => { seen.push(op.agent); return 'absent'; },
            installContext: () => undefined,
        };
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        // Igual que config-instructions sin configPath / managed-agents-md con
        // globalPath null: el salteo temprano no empuja entrada a `out` (mismo
        // patron que el test de cursor/copilot de arriba).
        expect(regenerateGlobalContext(['claude-code'], orch as never)).toEqual([]);
        expect(seen).toEqual([]); // ni contextStatus ni installContext se llaman
        expect(fs.existsSync(contextPath())).toBe(false); // no se escribe el archivo huerfano
    });

    it('cursor y copilot se saltean: no tienen archivo de contexto GLOBAL que regenerar', () => {
        seedRegistry();
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        const seen: string[] = [];
        const orch = {
            contextStatus: (op: { agent: string }) => { seen.push(op.agent); return 'absent'; },
            installContext: () => undefined,
        };
        // Su `injection.globalPath` es null — su contexto es project-local, y
        // eso no es trabajo de una regeneracion global.
        expect(regenerateGlobalContext(['cursor', 'copilot'], orch as never)).toEqual([]);
        expect(seen).toEqual([]);
    });
});
