// src/core/renderers/registry.ts
//
// Modulo HOJA: la UNICA fuente de verdad sobre "que archivo produce cada
// renderer en disco".
//
// Por que existe. Ese hecho estaba escrito a mano en TRES lugares divergentes
// — `physicalTarget` (install-planner.ts, el escritor), `RENDERED_SKILL_EXTENSIONS`
// (diagnostics/provider-checks.ts, que ademas omitia `codex-agent-toml`), y un
// ternario suelto para agentes en diagnostics/context.ts — y estaba AUSENTE en
// el cuarto, `classifyLinks`, que es justamente el que decide si un artefacto
// "esta instalado".
//
// La consecuencia no fue teorica: el escritor dejaba `using-awm.mdc` en disco y
// el lector buscaba `using-awm`, asi que para Cursor y Copilot
//   - `awm init` NUNCA era idempotente (reinstalaba el baseline entero en cada
//     corrida, dejando 2 directorios de backup sin podar por corrida), y
//   - `awm doctor` mostraba un rojo permanente cuyo remedio no podia satisfacerlo.
// Lo mismo para los artefactos `agent` de claude-code, el provider por defecto.
//
// Regla: NINGUN modulo vuelve a derivar una extension a mano. Si aparece un
// renderer nuevo, se agrega aca y todos los consumidores quedan correctos por
// construccion — que es lo que convierte "agregar un provider" en un cambio
// localizado en vez de una caceria por seis archivos.
import type { RendererId } from '../../providers';

/** Extension que el renderer estampa sobre el nombre base, o `null` cuando el
 *  artefacto se instala con el nombre tal cual (renderer `link`). */
const RENDERER_EXTENSION: Record<RendererId, string | null> = {
    link: null,
    'codex-agent-toml': '.toml',
    'cursor-mdc': '.mdc',
    'copilot-instructions': '.instructions.md',
};

/** `.md` es la unica extension que un `installName` de artefacto puede traer.
 *  Deliberadamente NO se usa `path.parse().name`: eso corta desde el ULTIMO
 *  punto, asi que un skill llamado `v1.2-migration` se truncaria a `v1`,
 *  perdiendo `2-migration` y arriesgando colision con otro skill `v1`. */
function stripMarkdownSuffix(installName: string): string {
    return installName.endsWith('.md') ? installName.slice(0, -'.md'.length) : installName;
}

/**
 * Nombre de archivo FISICO que `renderer` produce para `installName`.
 *
 * Es la funcion que deben usar por igual el escritor (al planificar la
 * instalacion) y todo lector (al preguntar "¿esta instalado?"). Que ambos lados
 * salgan de aca es lo que hace estructuralmente imposible que vuelvan a
 * discrepar.
 */
export function renderedFilename(installName: string, renderer: RendererId): string {
    const extension = RENDERER_EXTENSION[renderer];
    return extension === null ? installName : `${stripMarkdownSuffix(installName)}${extension}`;
}

/** Extension del renderer, o `null` si instala con el nombre tal cual. Para los
 *  pocos casos que necesitan la extension suelta (p. ej. "¿hay ALGUN archivo
 *  renderizado en este directorio?") en vez de un nombre concreto. */
export function rendererExtension(renderer: RendererId): string | null {
    return RENDERER_EXTENSION[renderer];
}
