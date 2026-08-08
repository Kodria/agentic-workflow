import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    preflightLinkArtifactPairs,
    scanLegacyArtifacts,
} from '../../src/core/provider-artifacts';

describe('preflightLinkArtifactPairs', () => {
    it('rejects a mixed Codex selection before any installer call', () => {
        const install = jest.fn();

        expect(() => {
            const pairs = [
                { agent: 'codex', artifact: { type: 'skill' as const, name: 'linked-skill' } },
                { agent: 'codex', artifact: { type: 'agent' as const, name: 'toml-agent' } },
            ] as const;
            preflightLinkArtifactPairs(pairs);
            for (const item of pairs) install(item);
        }).toThrow("Renderer 'codex-agent-toml' for codex agent artifacts is not implemented yet");
        expect(install).not.toHaveBeenCalled();
    });
});

describe('scanLegacyArtifacts', () => {
    const originalHome = process.env.HOME;
    const originalAwmHome = process.env.AWM_HOME;
    let tmpHome: string;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-provider-artifacts-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    /** Registra artefactos como propiedad de AWM, que es lo que ahora habilita
     *  que `awm remove` los ofrezca. */
    function own(records: Array<{ name: string; type: string; targetPath: string; renderer: string }>) {
        const file = path.join(tmpHome, '.awm', 'state', 'artifacts.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(records.map((r) => ({
            ...r, scope: 'global', sourcePath: '/tmp/src', owners: ['codex'],
        }))));
    }

    it('lista los artefactos renderizados que AWM instalo, incluidos los .toml de codex', () => {
        // Este test asertaba lo contrario: que los agents TOML de codex NUNCA
        // se listaran. Eso codificaba el bug — `scanLegacyArtifacts` se tragaba
        // `UnsupportedRendererError`, asi que `awm remove` era un no-op
        // permanente para los skills de cursor/copilot y los agents de codex
        // ("no hay artefactos instalados", con el directorio lleno).
        // Un artefacto que AWM instalo tiene que poder desinstalarse.
        const skillPath = path.join(tmpHome, '.agents/skills/linked-skill');
        const agentPath = path.join(tmpHome, '.codex/agents/rendered.toml');
        fs.mkdirSync(skillPath, { recursive: true });
        fs.mkdirSync(path.dirname(agentPath), { recursive: true });
        fs.writeFileSync(agentPath, 'name = "rendered"\n');
        own([
            { name: 'linked-skill', type: 'skill', targetPath: skillPath, renderer: 'link' },
            { name: 'rendered.toml', type: 'agent', targetPath: agentPath, renderer: 'codex-agent-toml' },
        ]);

        const listed = scanLegacyArtifacts(['codex'], 'global');
        expect(listed.map((a) => a.name).sort()).toEqual(['linked-skill', 'rendered.toml']);
    });

    it('NO lista archivos que AWM no instalo — el directorio no es suyo para ofrecerlo', () => {
        // Antes listaba el directorio entero, asi que un skill escrito a mano
        // por el usuario aparecia en el menu de borrado.
        const mine = path.join(tmpHome, '.agents/skills/awm-skill');
        const theirs = path.join(tmpHome, '.agents/skills/mi-skill-personal');
        fs.mkdirSync(mine, { recursive: true });
        fs.mkdirSync(theirs, { recursive: true });
        own([{ name: 'awm-skill', type: 'skill', targetPath: mine, renderer: 'link' }]);

        const listed = scanLegacyArtifacts(['codex'], 'global');
        expect(listed.map((a) => a.name)).toEqual(['awm-skill']);
        expect(listed.flatMap((a) => a.fullPaths)).not.toContain(theirs);
    });

    it('no colapsa dos tipos distintos que comparten nombre (borraria el equivocado)', () => {
        // Antes la clave era solo el nombre, a traves de todos los tipos: un
        // workflow `deploy.md` y un agent `deploy.md` colapsaban en UNA entrada,
        // asi que elegir "deploy.md" borraba ambos.
        const wf = path.join(tmpHome, '.gemini/antigravity/global_workflows/deploy.md');
        const ag = path.join(tmpHome, '.claude/agents/deploy.md');
        fs.mkdirSync(path.dirname(wf), { recursive: true });
        fs.mkdirSync(path.dirname(ag), { recursive: true });
        fs.writeFileSync(wf, 'wf'); fs.writeFileSync(ag, 'ag');
        own([
            { name: 'deploy.md', type: 'workflow', targetPath: wf, renderer: 'link' },
            { name: 'deploy.md', type: 'agent', targetPath: ag, renderer: 'link' },
        ]);

        const listed = scanLegacyArtifacts(['antigravity', 'claude-code'], 'global');
        expect(listed).toHaveLength(2);
        for (const a of listed) expect(a.fullPaths).toHaveLength(1);
    });

    it('scope local se resuelve contra el projectRoot dado, no contra cwd', () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-proj-'));
        const local = path.join(projectRoot, '.claude/skills/local-skill');
        fs.mkdirSync(local, { recursive: true });
        own([{ name: 'local-skill', type: 'skill', targetPath: local, renderer: 'link' }]);

        const listed = scanLegacyArtifacts(['claude-code'], 'local', projectRoot);
        expect(listed.map((a) => a.name)).toEqual(['local-skill']);
        // Y la ruta entregada es ABSOLUTA: antes era relativa, y se la pasaba
        // tal cual a fs.rmSync.
        expect(path.isAbsolute(listed[0].fullPaths[0])).toBe(true);
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });


    it('Gap C — an agent with a null global skill dir (copilot) at global scope skips cleanly instead of crashing', () => {
        // Copilot's skill.global is null (no user-level skill discovery mechanism —
        // providers/index.ts) and its skill renderer is 'copilot-instructions', not
        // 'link', so scanLegacyArtifacts's `dir === null` guard (config[scope]) is
        // the same defensive shape this task's null-skip audit covers for the other
        // 4 files. Proves the call is a clean no-op for copilot at 'global' scope —
        // no crash, nothing listed — rather than throwing on a null target dir.
        expect(() => scanLegacyArtifacts(['copilot'], 'global')).not.toThrow();
        const listed = scanLegacyArtifacts(['copilot'], 'global');
        expect(listed).toEqual([]);
    });
});
