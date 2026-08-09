// Un symlink gestionado por AWM que otro instalador reemplaza por un directorio real
// era INVISIBLE para todo el sistema de diagnostico.
//
// Encontrado corriendo el playbook `agent-matrix` para `claude-code` contra el binario
// publicado: `awm init` dejo `~/.claude/skills/mermaid-diagrams` como symlink al registry
// baseline y lo anoto en `state/artifacts.json`; la primera sesion real de Claude Code
// materializo su propia skill `mermaid-diagrams` (bundled, mismo nombre) encima, pisando
// el symlink con un directorio real distinto — otra `description`, sin `version`, con un
// README.md que la nuestra no tiene.
//
// Despues de eso:
//   - `awm doctor -a claude-code` reportaba `skills.global: healthy`, `overall: healthy`,
//     exit 0;
//   - `awm sync` no lo tocaba;
//   - el agente cargaba la skill del tercero, no la instalada.
//
// La causa es una sola linea de `classifySkillLinks`: `if (!lst.isSymbolicLink()) continue`.
// Correcta para una skill que el usuario puso a mano — AWM no debe tocarla — y equivocada
// cuando el ledger de artefactos dice que esa ruta exacta es nuestra. El clasificador nunca
// consultaba el ledger, asi que no podia distinguir los dos casos.
import fs from 'fs';
import path from 'path';
import { classifySkillLinks, managedLinkTargets } from '../../src/core/skill-integrity';
import { ManagedArtifactRecord } from '../../src/core/artifact-state';
import { mkCanonicalTmpDir } from '../support/tmp';

describe('a managed skill link replaced by third-party content is detected', () => {
    let registry: string;
    let skillsDir: string;
    const made: string[] = [];

    const record = (targetPath: string, renderer: ManagedArtifactRecord['renderer'] = 'link'): ManagedArtifactRecord => ({
        name: path.basename(targetPath),
        type: 'skill',
        scope: 'global',
        targetPath,
        sourcePath: path.join(registry, 'skills', path.basename(targetPath)),
        renderer,
        owners: ['claude-code'],
    });

    beforeEach(() => {
        registry = mkCanonicalTmpDir('awm-usurp-reg-');
        skillsDir = mkCanonicalTmpDir('awm-usurp-skills-');
        made.push(registry, skillsDir);
        fs.mkdirSync(path.join(registry, 'skills', 'mermaid-diagrams'), { recursive: true });
        fs.writeFileSync(path.join(registry, 'skills', 'mermaid-diagrams', 'SKILL.md'), '# awm\n');
    });

    afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

    /** Lo que hace el tercero: borra nuestro symlink y deja su propio directorio. */
    function usurp(name: string): string {
        const p = path.join(skillsDir, name);
        fs.rmSync(p, { recursive: true, force: true });
        fs.mkdirSync(p, { recursive: true });
        fs.writeFileSync(path.join(p, 'SKILL.md'), '# someone else\n');
        return p;
    }

    it('reports the replaced entry as usurped, not as healthy', () => {
        const target = path.join(skillsDir, 'mermaid-diagrams');
        fs.symlinkSync(path.join(registry, 'skills', 'mermaid-diagrams'), target);

        // Antes de la usurpacion: un link vivo y nada mas.
        const managed = managedLinkTargets([record(target)]);
        const before = classifySkillLinks(skillsDir, [registry], managed);
        expect(before.valid).toEqual(['mermaid-diagrams']);
        expect(before.usurped).toEqual([]);

        usurp('mermaid-diagrams');

        const after = classifySkillLinks(skillsDir, [registry], managed);
        expect(after.usurped).toEqual(['mermaid-diagrams']);
        // Y no se cuela por ninguna de las categorias existentes: `valid` es lo que hace
        // que `doctor` diga `healthy`, y `repairable`/`dead` mandarian a un remedio
        // (`repair-global-skills`) que solo toca symlinks y aca no cambiaria nada.
        expect(after.valid).toEqual([]);
        expect(after.repairable).toEqual([]);
        expect(after.dead).toEqual([]);
    });

    it('leaves a directory the user created alone — it is not in the ledger', () => {
        usurp('my-own-skill');
        const scan = classifySkillLinks(skillsDir, [registry], managedLinkTargets([]));
        expect(scan.usurped).toEqual([]);
        expect(scan.valid).toEqual([]);
    });

    it('does not flag a rendered artifact: a real file is what `cursor-mdc` produces', () => {
        // El ledger tambien anota artefactos renderizados (`.mdc`, `.instructions.md`).
        // Para esos, "no es un symlink" es el estado correcto — contarlos como usurpados
        // pintaria de rojo cada instalacion sana de Cursor y Copilot.
        const target = path.join(skillsDir, 'rendered.mdc');
        fs.writeFileSync(target, '---\ndescription: x\n---\n');
        const managed = managedLinkTargets([record(target, 'cursor-mdc')]);
        expect(managed.size).toBe(0);
        expect(classifySkillLinks(skillsDir, [registry], managed).usurped).toEqual([]);
    });

    it('defaults to no detection when no ledger is passed (callers without one are unchanged)', () => {
        usurp('mermaid-diagrams');
        expect(classifySkillLinks(skillsDir, [registry]).usurped).toEqual([]);
    });
});

// El hallazgo del playbook no fue "el clasificador no ve X" — fue "doctor dice healthy".
// Detectarlo en `classifySkillLinks` no sirve de nada si el check que lo consume lo
// descarta, asi que la superficie que reporto el bug se asserta por separado.
describe('awm doctor degrades on a usurped global skill', () => {
    const { gatherProviderChecks } = require('../../src/core/diagnostics/provider-checks');

    function checkFor(usurped: string[], repairable: string[] = []) {
        const scan = jest.fn(() => ({ valid: [], repairable, dead: [], usurped }));
        const facts = gatherProviderChecks(['claude-code'], scan);
        return facts[0].checks.find((c: { id: string }) => c.id === 'skills.global');
    }

    it('is broken, names what was replaced, and does not offer a remedy that cannot fix it', () => {
        const check = checkFor(['mermaid-diagrams']);
        expect(check.state).toBe('broken');
        expect(check.detail).toContain('mermaid-diagrams');
        // `repair-global-skills` solo re-linkea symlinks colgantes: mandaria al usuario a
        // un comando que corre limpio y no cambia nada.
        expect(check.remediationCode).toBe('reinstall-usurped-skills');
    });

    it('still reports plain broken links the old way when nothing was usurped', () => {
        const check = checkFor([], ['gone']);
        expect(check.state).toBe('broken');
        expect(check.detail).toBe('1 broken links');
        expect(check.remediationCode).toBe('repair-global-skills');
    });

    it('is healthy when neither happened', () => {
        expect(checkFor([]).state).not.toBe('broken');
    });
});
