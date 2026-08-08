// Regresion: `repairGlobalSkills` hacia `rmSync` del link colgante y RECIEN
// DESPUES intentaba recrearlo con `symlinkSync(..., 'dir')`. En Windows un
// symlink de directorio exige SeCreateSymbolicLinkPrivilege, denegado por
// defecto en cuentas sin privilegios — asi que el link se borraba y la
// recreacion tiraba EPERM: el usuario quedaba PEOR que antes, y con la entrada
// ya ausente el siguiente `awm init` ni siquiera podia verla como reparable.
//
// `executor.ts` documenta en extenso que en win32 hay que usar `'junction'`
// (que cualquier cuenta puede crear, y que libuv reporta igual que un symlink);
// este sitio nunca recibio ese fix.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { repairGlobalSkills } from '../../src/core/skill-integrity';

describe('repairGlobalSkills: un fallo nunca deja al usuario peor que antes', () => {
    let skillsDir: string;
    let registry: string;

    beforeEach(() => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-repair-'));
        skillsDir = path.join(base, 'skills-installed');
        registry = path.join(base, 'registry');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.mkdirSync(path.join(registry, 'skills', 'alpha'), { recursive: true });
        fs.writeFileSync(path.join(registry, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: d\n---\nb');
    });

    /** Un symlink colgante: apunta a algo que no existe, pero el registry SI
     *  tiene la skill — o sea, reparable. */
    function danglingLink(name: string) {
        fs.symlinkSync(path.join(skillsDir, '__no_existe__'), path.join(skillsDir, name), 'dir');
    }

    it('repara un link colgante apuntandolo al registry', () => {
        danglingLink('alpha');
        const result = repairGlobalSkills(skillsDir, [registry]);
        expect(result.relinked).toContain('alpha');
        expect(fs.existsSync(path.join(skillsDir, 'alpha'))).toBe(true);
        expect(fs.realpathSync(path.join(skillsDir, 'alpha')))
            .toBe(fs.realpathSync(path.join(registry, 'skills', 'alpha')));
    });

    it('si la creacion del link falla, el estado original NO se destruye', () => {
        danglingLink('alpha');
        const before = fs.readlinkSync(path.join(skillsDir, 'alpha'));

        // Simula la denegacion de privilegio de Windows.
        const spy = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {
            const err: NodeJS.ErrnoException = new Error('operation not permitted');
            err.code = 'EPERM';
            throw err;
        });
        try {
            const result = repairGlobalSkills(skillsDir, [registry]);
            expect(result.failed).toContain('alpha');
            expect(result.relinked).not.toContain('alpha');
            // Lo que importa: la entrada sigue existiendo, con su target
            // original. Antes quedaba borrada — invisible incluso para el
            // proximo intento de reparacion.
            expect(fs.lstatSync(path.join(skillsDir, 'alpha')).isSymbolicLink()).toBe(true);
            expect(fs.readlinkSync(path.join(skillsDir, 'alpha'))).toBe(before);
        } finally {
            spy.mockRestore();
        }
    });

    it('no deja archivos de staging tirados tras una reparacion exitosa', () => {
        danglingLink('alpha');
        repairGlobalSkills(skillsDir, [registry]);
        expect(fs.readdirSync(skillsDir).filter((e) => e.includes('.relink'))).toEqual([]);
    });

    it('no deja archivos de staging tirados tras un fallo', () => {
        danglingLink('alpha');
        const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('boom'); });
        try {
            repairGlobalSkills(skillsDir, [registry]);
        } finally { spy.mockRestore(); }
        // El staging puede sobrevivir a un crash duro, pero se limpia en el
        // siguiente intento — se verifica que una segunda pasada converge.
        repairGlobalSkills(skillsDir, [registry]);
        expect(fs.readdirSync(skillsDir).filter((e) => e.includes('.relink'))).toEqual([]);
    });

    it('poda un link muerto (sin contraparte en el registry)', () => {
        danglingLink('fantasma');
        const result = repairGlobalSkills(skillsDir, [registry]);
        expect(result.pruned).toContain('fantasma');
        expect(fs.existsSync(path.join(skillsDir, 'fantasma'))).toBe(false);
    });
});
