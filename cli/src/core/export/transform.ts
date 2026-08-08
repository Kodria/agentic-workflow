// cli/src/core/export/transform.ts
//
// Transform mecánico claude.ai (R3.1): función pura string → string.
// Frontmatter line-based plano (los SKILL.md del baseline usan claves de una
// línea) — sin parser YAML a propósito (YAGNI, cero deps). La única forma
// multilínea soportada es el block scalar de `description:`, resuelto vía la
// función compartida de discovery.ts (ver claudeAiTransform).
import { findFrontmatterDescription, isBlockScalarHeader } from '../frontmatter';
export const DEFERENCE_LINE = (skillName: string): string =>
  `In environments with AWM installed (Claude Code), defer to the registry's ${skillName} skill — this port is for environments without filesystem access.`;

// Paths intra-registry: resuelven en Claude Code (donde el registry está en
// disco) y nunca en claude.ai, donde solo se sube la skill portable. Se limpian
// en el artefacto exportado en vez de editar el SKILL.md canónico, que en Claude
// Code sí los necesita.
const SKILL_NAME = '[a-z0-9][a-z0-9-]*';
const REF_FILE = '[A-Za-z0-9._-]+';
const PATH_SRC = '(?:skills\\/' + SKILL_NAME + '\\/references\\/' + REF_FILE + '\\.md'
  + '|skills\\/' + SKILL_NAME + '\\/SKILL\\.md)';

/** Reconoce, en una sola pasada sobre el body ORIGINAL, tanto el caso
 * "paréntesis cuyo único contenido es un path" (grupo 1) como el path suelto
 * en cualquier otra posición (grupo 2). Una sola pasada evita un bug real de
 * splicing encontrado en code review: si se borrara el paréntesis en una
 * pasada separada, un path inmediatamente siguiente podría quedar pegado a
 * texto que antes terminaba en `/` (el cierre de una URL, p. ej.), y el guard
 * de "embebido en URL" (que mira el carácter previo) confundiría eso con un
 * path genuinamente embebido. Matcheando todo en una sola pasada contra el
 * string original, cada offset que llega a `isEmbeddedInUrl` es siempre real,
 * nunca un artefacto de un borrado previo. */
const PATH_OR_DROPPED_PAREN = new RegExp(
  '([ \\t]*\\((?:see[ \\t]+)?`?' + PATH_SRC + '`?\\))' + '|' + '(`?' + PATH_SRC + '`?)',
  'g',
);

/** Un path precedido por `/` es el final de una URL o de un path más largo (un
 * enlace a GitHub, por ejemplo). Esas referencias SÍ resuelven para quien lee la
 * skill en claude.ai, así que no se tocan. */
function isEmbeddedInUrl(haystack: string, matchStart: number, matched: string): boolean {
  const pathStart = matchStart + matched.indexOf('skills/');
  return pathStart > 0 && haystack[pathStart - 1] === '/';
}

const PATH_MATCHER = new RegExp(
  '^skills\\/(' + SKILL_NAME + ')\\/references\\/(' + REF_FILE + ')\\.md$'
  + '|^skills\\/(' + SKILL_NAME + ')\\/SKILL\\.md$',
);

function pathlessForm(p: string): string {
  const m = PATH_MATCHER.exec(p);
  if (!m) throw new Error(`unreachable: "${p}" matched PATH_SRC but not PATH_MATCHER — the two must stay in sync`);
  const [, refSkill, refFile, skillOnlyName] = m;
  if (skillOnlyName !== undefined) return `the \`${skillOnlyName}\` skill`;
  return `the \`${refSkill}\` skill's ${refFile.replace(/-/g, ' ')} reference`;
}

export function stripIntraRegistryPaths(body: string): string {
  return body.replace(PATH_OR_DROPPED_PAREN, (match, parenForm, bareForm, offset) => {
    if (isEmbeddedInUrl(body, offset, match)) return match;
    if (parenForm !== undefined) return '';
    const path = bareForm.replace(/^`|`$/g, '');
    return pathlessForm(path);
  });
}

export function claudeAiTransform(skillMd: string, skillName: string): string {
  // \r?\n-tolerant, same rationale as readArtifactDescription in discovery.ts:
  // SKILL.md files may be CRLF-terminated and that's still valid frontmatter.
  const startMatch = skillMd.match(/^---\r?\n/);
  if (!startMatch) {
    throw new Error('missing frontmatter block (file must start with ---)');
  }
  const startLen = startMatch[0].length;
  const endMatch = skillMd.slice(startLen).match(/\r?\n---\r?\n/);
  if (!endMatch || endMatch.index === undefined) {
    throw new Error('unterminated frontmatter block (closing --- not found)');
  }
  const end = startLen + endMatch.index;
  const body = skillMd.slice(end + endMatch[0].length);
  const fmLines = skillMd.slice(startLen, end).split(/\r?\n/)
    .filter((l) => !/^(version|portable):/.test(l));

  // UN SOLO camino para todas las formas de `description`. Antes habia uno por
  // forma (plano / entrecomillado / bloque) y cada vez que el LECTOR aprendia
  // una forma nueva, el ESCRITOR de aca quedaba atras — la divergencia exacta
  // que este modulo dice cerrar. Casos reales que produjo esa asimetria:
  //  - escalar plano multilinea: la deference line se insertaba en la primera
  //    linea y la continuacion quedaba huerfana debajo, o sea la frase de
  //    deference terminaba enterrada en el medio de la descripcion;
  //  - escalar plano con ` # comentario` final: la deference line se anexaba
  //    DESPUES del `#`, o sea YAML se la comia entera como comentario y el
  //    artefacto exportado perdia en silencio la unica frase que este
  //    transform existe para agregar.
  // Ahora se resuelve el campo con la funcion compartida, se reemplaza su
  // extension COMPLETA (startLine..endLine) y se emite siempre un escalar
  // double-quoted via JSON.stringify — superset valido de YAML que cubre
  // comillas, `:`, `#` y los `\n` de un literal `|` sin decidir estilo.
  const field = findFrontmatterDescription(fmLines.join('\n'));
  if (field.startLine === -1) {
    throw new Error('frontmatter has no description field');
  }
  const rawValue = fmLines[field.startLine].replace(/^description\s*:/, '').trim();
  // Empieza con `>`/`|` pero no es un indicador bien formado (ej. `>-basura`):
  // YAML mismo lo rechaza. Fallar explicito en vez de publicar basura.
  if (/^[>|]/.test(rawValue) && !isBlockScalarHeader(rawValue)) {
    throw new Error(`malformed block scalar indicator in description: ${rawValue}`);
  }
  if (!field.value) {
    throw new Error(isBlockScalarHeader(rawValue) ? 'description block scalar has no content' : 'description is empty');
  }
  const merged = JSON.stringify(`${field.value} ${DEFERENCE_LINE(skillName)}`);
  fmLines.splice(field.startLine, field.endLine - field.startLine + 1, `description: ${merged}`);

  // Solo el body: el frontmatter ya se editó arriba y sus campos no son prosa
  // navegable (R2.4).
  return `---\n${fmLines.join('\n')}\n---\n${stripIntraRegistryPaths(body)}`;
}
