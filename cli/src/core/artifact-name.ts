// src/core/artifact-name.ts
//
// Modulo HOJA (sin imports de otros modulos del proyecto): validacion de los
// nombres de artefacto que llegan desde CONTENIDO DE REGISTRY.
//
// Por que existe. Los nombres de `bundle.json` (`skills[]`, `workflows[]`,
// `agents[]`) se usaban verbatim para construir rutas de instalacion:
//
//     path.join('~/.claude/skills', '../../.ssh/authorized_keys')
//       => '~/.ssh/authorized_keys'
//
// y como `replaceArtifact` hace `fs.rmSync(targetPath, {recursive:true})` antes
// de enlazar, un nombre como `../../.ssh` BORRABA recursivamente el ~/.ssh real
// del usuario. Con `../../.config/autostart/x.desktop` se consigue ejecucion al
// siguiente login. Confirmado end-to-end contra el binario real.
//
// El registry es contenido de terceros: un registry de equipo, uno interno, o
// uno que alguien agrego con `awm registry add`. Todos los demas lectores de
// contenido de registry de este repo (readRegistriesConfig, readRegistryManifest,
// readProfile) ya rechazaban `..` y separadores — este camino era el unico sin
// la guarda.
//
// Esta validacion es la PRIMERA de dos capas. La segunda es la asercion de
// contencion en `physicalTarget` (install-planner.ts), que verifica que la ruta
// resuelta caiga realmente dentro del directorio destino. Se mantienen las dos
// a proposito: esta da un mensaje accionable que nombra el artefacto culpable;
// aquella es el ancla estructural que atrapa cualquier camino futuro que
// construya rutas sin pasar por aca.

/** Nombres reservados de Windows: no pueden ser un archivo ni un directorio.
 *  Se rechazan en TODA plataforma a proposito — el registry es contenido
 *  compartido, y un nombre que solo rompe en las maquinas Windows del equipo es
 *  peor que uno rechazado de forma consistente en todas. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** ¿Es seguro usar este nombre como UN componente de ruta dentro del directorio
 *  de instalacion? Sin `..`, sin separadores, sin rutas absolutas, sin bytes de
 *  control, sin nombres reservados. */
export function isSafeArtifactName(name: unknown): boolean {
    if (typeof name !== 'string') return false;
    const value = name.trim();
    if (value === '' || value !== name) return false;   // vacio, o con espacios al borde

    // Windows recorta en silencio el punto/espacio final, asi que `evil.` y
    // `evil` terminan en el MISMO archivo — un nombre que apunta a otro destino
    // del que aparenta.
    if (/[. ]$/.test(value)) return false;

    // Bytes de control y NUL: truncan la ruta a nivel syscall en algunos SO.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) return false;

    // Cualquier separador (de ambas plataformas) convierte esto en una ruta,
    // no en un nombre. Idem `..`/`.` como componente completo.
    if (value.includes('/') || value.includes('\\')) return false;
    if (value === '.' || value === '..') return false;

    // Absolutos de Windows (`C:\...`, `C:algo`) y de UNC ya quedan cubiertos por
    // el chequeo de separador, pero un `C:` pelado no — y sigue siendo una
    // referencia de unidad, no un nombre.
    if (/^[a-zA-Z]:/.test(value)) return false;

    if (WINDOWS_RESERVED.test(value)) return false;

    return true;
}

/** Forma asertiva: lanza con un mensaje que nombra el tipo y el valor ofensivo,
 *  para que el operador pueda ubicarlo en el `bundle.json` del registry. */
export function assertSafeArtifactName(name: unknown, type: string): string {
    if (!isSafeArtifactName(name)) {
        throw new Error(
            `unsafe ${type} name from registry content: ${JSON.stringify(name)}. ` +
            `Artifact names must be a single path component — no "..", no path separators, ` +
            `no absolute paths, no control characters, and not a Windows reserved name.`
        );
    }
    return name as string;
}
