// `planInitMutationTargets` mezclaba dos formas de la misma ruta.
//
// Deriva algunos destinos de `cwd` tal como lo recibe, y otros de
// `findProjectRoot(cwd)` — que hace `realpathSync`. Mientras las dos coincidan, el `Set`
// deduplica y nadie lo nota. En macOS NO coinciden: `/var/folders/…` es un symlink a
// `/private/var/folders/…`, asi que la CI de macOS mostro `AGENTS.md` y
// `.awm/context/awm-context.md` DOS VECES en la lista de destinos, una por cada forma:
//
//     /var/folders/…/AGENTS.md              ← derivado de cwd
//     /private/var/folders/…/AGENTS.md      ← derivado de findProjectRoot(cwd)
//
// Esa lista es lo que `beginBackupSession` respalda y lo que el rollback restaura. Un
// mismo archivo entrando dos veces significa dos entradas de backup para un solo
// archivo, y un rollback que lo restaura dos veces — sobre un mecanismo cuyo unico
// trabajo es dejar el disco exactamente como estaba.
//
// El bug no necesita macOS: cualquier `cwd` que pase por un symlink lo reproduce. Este
// test arma esa situacion a mano, asi que corre igual en los tres sistemas.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { planInitMutationTargets } from '../../../src/core/init/mutation-targets';

describe('los destinos de mutacion son canonicos: un archivo, una entrada', () => {
    let real: string;
    let linkDir: string;

    beforeEach(() => {
        // `real` es el directorio de verdad; `linkDir` es un symlink que apunta ahi.
        // Pasar `linkDir` como cwd es exactamente lo que hace macOS con /var → /private/var.
        const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-canon-')));
        real = path.join(base, 'real');
        linkDir = path.join(base, 'link');
        fs.mkdirSync(path.join(real, '.git'), { recursive: true });  // marcador de proyecto
        fs.symlinkSync(real, linkDir, 'dir');
    });

    afterEach(() => {
        fs.rmSync(path.dirname(real), { recursive: true, force: true });
    });

    /** Todo destino resuelto a su forma canonica: dos entradas que resuelven al mismo
     *  archivo son la misma entrada, sin importar como se escribieron. */
    const canonical = (p: string): string => {
        try { return fs.realpathSync(p); } catch { /* aun no existe */ }
        const parent = path.dirname(p);
        try { return path.join(fs.realpathSync(parent), path.basename(p)); } catch { return p; }
    };

    it.each(['copilot', 'cursor'] as const)(
        '%s: no enumera el mismo archivo dos veces cuando cwd pasa por un symlink',
        (agent) => {
            const targets = planInitMutationTargets({ cwd: linkDir, agent, bundles: [] });

            const seen = new Map<string, string[]>();
            for (const t of targets) {
                const key = canonical(t);
                seen.set(key, [...(seen.get(key) ?? []), t]);
            }
            const duplicados = [...seen.entries()].filter(([, forms]) => forms.length > 1);

            expect(duplicados).toEqual([]);
        },
    );

    it('sigue enumerando AGENTS.md y el contexto materializado — deduplicar no es perder', () => {
        // La correccion es colapsar formas equivalentes, NO dejar de cubrir el archivo:
        // sub-enumerar es el unico modo de falla que derrota el rollback en silencio.
        const targets = planInitMutationTargets({ cwd: linkDir, agent: 'copilot', bundles: [] })
            .map(canonical);

        expect(targets).toContain(path.join(real, 'AGENTS.md'));
        expect(targets).toContain(path.join(real, '.awm', 'context', 'awm-context.md'));
    });

    it('no depende del symlink: con un cwd ya canonico da el mismo resultado', () => {
        const viaLink = planInitMutationTargets({ cwd: linkDir, agent: 'copilot', bundles: [] }).map(canonical).sort();
        const viaReal = planInitMutationTargets({ cwd: real, agent: 'copilot', bundles: [] }).map(canonical).sort();

        expect(viaLink).toEqual(viaReal);
    });
});
