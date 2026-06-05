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
    function seedRegistry(body = '---\nname: using-awm\nversion: "1.0.0"\n---\nUSING-AWM-BODY') {
        const dir = path.join(tmpHome, '.awm', 'cli-source', 'registry', 'skills', 'using-awm');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
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
        expect(regenerateGlobalContext()).toEqual([]);
    });

    it('skips an agent whose config exists but has no AWM sentinel', () => {
        seedRegistry();
        seedOpencode(['docs/rules.md']); // sin el sentinel
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(regenerateGlobalContext()).toEqual([{ agent: 'opencode', action: 'skipped' }]);
        expect(fs.existsSync(contextPath())).toBe(false); // no se crea el archivo
    });

    it('refreshes a stale agent (sentinel present, materialized file absent) and recreates the file', () => {
        seedRegistry();
        seedOpencode([contextPath()]); // sentinel presente, pero el archivo no existe → stale
        expect(fs.existsSync(contextPath())).toBe(false);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(regenerateGlobalContext()).toEqual([{ agent: 'opencode', action: 'refreshed' }]);
        expect(fs.existsSync(contextPath())).toBe(true);
        expect(fs.readFileSync(contextPath(), 'utf-8')).toContain('USING-AWM-BODY');
    });

    it('reports fresh (no rewrite) when the agent is already injected', () => {
        seedRegistry();
        seedOpencode([contextPath()]);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        regenerateGlobalContext();                       // 1ª pasada: stale → refreshed, crea el archivo
        const mtime1 = fs.statSync(contextPath()).mtimeMs;
        const second = regenerateGlobalContext();        // 2ª pasada: ya injected → fresh
        expect(second).toEqual([{ agent: 'opencode', action: 'fresh' }]);
        expect(fs.statSync(contextPath()).mtimeMs).toBe(mtime1); // archivo intacto
    });

    it('does not throw when the registry has no using-awm skill (stale but unregenerable → skipped)', () => {
        // registry vacío (sin using-awm); opencode stale
        seedOpencode([contextPath()]);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        expect(() => regenerateGlobalContext()).not.toThrow();
        expect(regenerateGlobalContext()).toEqual([{ agent: 'opencode', action: 'skipped' }]);
    });

    it('skips agent when contextStatus throws an unexpected error', () => {
        seedRegistry();
        seedOpencode([contextPath()]);
        const { regenerateGlobalContext } = require('../../../src/core/context/regenerate');
        const { InjectionOrchestrator } = require('../../../src/core/context/orchestrator');
        const brokenOrch = new InjectionOrchestrator();
        brokenOrch.contextStatus = () => { throw new Error('unexpected orchestrator error'); };
        expect(regenerateGlobalContext(brokenOrch)).toEqual([{ agent: 'opencode', action: 'skipped' }]);
        expect(fs.existsSync(contextPath())).toBe(false); // installContext never called
    });
});
