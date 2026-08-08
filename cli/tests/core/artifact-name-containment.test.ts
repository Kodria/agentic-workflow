// SECURITY regression: artifact names taken VERBATIM from a registry's
// `bundle.json` were joined onto the provider's install directory with no
// validation and no containment check, so `path.join(dir, name)` escaped the
// directory entirely:
//
//   path.join('~/.claude/skills', '../../.ssh/authorized_keys')
//     => '~/.ssh/authorized_keys'
//
// Impact went well past a stray write. `replaceArtifact` does
// `fs.rmSync(targetPath, {recursive:true, force:true})` before linking, so a
// name of `../../.ssh` RECURSIVELY DELETED the user's real ~/.ssh and replaced
// it with a symlink into the attacker's registry clone. Writing
// `~/.config/autostart/*.desktop` gives code execution at next login.
//
// Reachable from `awm add`, `awm sync`, `awm registry add` and `awm init` —
// and note that `awm init` auto-installs the first bundle declaring
// `scope: "baseline"` across ALL roots, so a malicious registry does not even
// need the user to pick its bundle.
//
// Every other registry-facing reader in this codebase already rejects `..` and
// separators (readRegistriesConfig, readRegistryManifest, readProfile). The
// bundle path was the one that never got the guard.
import { assertSafeArtifactName, isSafeArtifactName } from '../../src/core/artifact-name';

describe('assertSafeArtifactName: contencion de nombres provenientes del registry', () => {
    const TRAVERSAL = [
        ['padre relativo', '../evil'],
        ['padre profundo', '../../../../../../tmp/escape'],
        ['ssh del usuario', '../../.ssh/authorized_keys'],
        ['separador posix', 'sub/dir'],
        ['separador windows', 'sub\\dir'],
        ['absoluto posix', '/etc/passwd'],
        ['absoluto windows', 'C:\\Windows\\System32\\x'],
        ['unc windows', '\\\\server\\share'],
        ['componente punto', '.'],
        ['componente doble punto', '..'],
        ['punto embebido', 'a/../b'],
    ];

    it.each(TRAVERSAL)('rechaza %s', (_name, candidate) => {
        expect(isSafeArtifactName(candidate)).toBe(false);
        expect(() => assertSafeArtifactName(candidate, 'skill')).toThrow(/unsafe|invalid/i);
    });

    it.each([
        ['vacio', ''],
        ['solo espacios', '   '],
        ['byte NUL', 'evil\u0000.md'],
        ['byte de control', 'evil\u0001name'],
    ])('rechaza %s', (_name, candidate) => {
        expect(isSafeArtifactName(candidate)).toBe(false);
    });

    it.each([
        ['CON', 'CON'], ['con minuscula', 'con'], ['con extension', 'CON.md'],
        ['AUX', 'AUX'], ['NUL', 'NUL'], ['PRN', 'PRN'],
        ['COM1', 'COM1'], ['LPT1', 'LPT1'],
    ])('rechaza el nombre reservado de Windows %s', (_name, candidate) => {
        // Reservados en TODA plataforma a proposito: el registry es contenido
        // compartido entre equipos, y un nombre que rompe solo en las maquinas
        // Windows del equipo es peor que uno que se rechaza en todas.
        expect(isSafeArtifactName(candidate)).toBe(false);
    });

    it.each([
        ['punto final', 'skill.'],
        ['espacio final', 'skill '],
    ])('rechaza %s (Windows los recorta en silencio y cambia el destino)', (_name, candidate) => {
        expect(isSafeArtifactName(candidate)).toBe(false);
    });

    it.each([
        'development-process',
        'skill_con_guion_bajo',
        'v1.2-migration',
        'extract-design-md',
        'a',
        'UPPER-case-Mixed',
        'skill.md',
    ])('acepta el nombre legitimo %s', (candidate) => {
        expect(isSafeArtifactName(candidate)).toBe(true);
        expect(() => assertSafeArtifactName(candidate, 'skill')).not.toThrow();
    });

    it('el mensaje de error nombra el tipo y el valor ofensivo, para que el operador pueda ubicarlo', () => {
        expect(() => assertSafeArtifactName('../../.ssh', 'skill'))
            .toThrow(/skill/);
        expect(() => assertSafeArtifactName('../../.ssh', 'skill'))
            .toThrow(/\.\.\/\.\.\/\.ssh/);
    });
});
