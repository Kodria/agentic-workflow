// cli/src/core/export/transform.ts
//
// Transform mecánico claude.ai (R3.1): función pura string → string.
// Frontmatter line-based plano (los SKILL.md del baseline usan claves de una
// línea) — sin parser YAML a propósito (YAGNI, cero deps). La única forma
// multilínea soportada es el block scalar de `description:`, resuelto vía la
// función compartida de discovery.ts (ver claudeAiTransform).
import { readFrontmatterDescription, isBlockScalarHeader } from '../discovery';
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

  const descIdx = fmLines.findIndex((l) => /^description:/.test(l));
  if (descIdx === -1) {
    throw new Error('frontmatter has no description field');
  }
  const descLine = fmLines[descIdx];
  const value = descLine.slice('description:'.length).trim();

  // Block scalar (`description: >-` + lineas indentadas): forma YAML valida y
  // usada por skills REALES del registry baseline (extract-design-md). Antes
  // esto lanzaba, y como runExport propaga el throw, UN solo skill con esta
  // forma abortaba el export del bundle ENTERO (`awm export frontend`).
  // Se resuelve con readFrontmatterDescription — la misma funcion compartida
  // que usan discovery y los renderers de cursor/copilot — y se normaliza a
  // un escalar de una linea entrecomillado: el transform ya reescribe el
  // frontmatter de todas formas, y la salida de una linea es la unica forma
  // en que el splice de la deference line tiene sentido.
  // La guarda usa la MISMA funcion que el resolver (isBlockScalarHeader), no
  // un prefijo laxo tipo /^[>|]/. Con un prefijo, un valor como
  // `>- # comentario` entraba a esta rama pero el resolver — que exige match
  // COMPLETO del indicador — caia a su camino de escalar plano y devolvia el
  // indicador mismo: truthy, asi que la guarda de `!resolved` no disparaba, y
  // el splice de abajo borraba las lineas de contenido reales. Resultado:
  // el indicador publicado como descripcion y el texto real perdido en
  // silencio, justo en el artefacto que una persona sube a claude.ai.
  // Atrapado en review; las dos condiciones deben venir de la misma fuente.
  if (isBlockScalarHeader(value)) {
    const resolved = readFrontmatterDescription(fmLines.slice(descIdx).join('\n'));
    if (!resolved) {
      throw new Error('description block scalar has no content');
    }
    // Extension del bloque: las lineas siguientes ESTRICTAMENTE mas indentadas
    // que la clave (que esta en columna 0 aca). Se eliminan junto con la linea
    // de la clave, que se reemplaza por la forma de una sola linea.
    // Las lineas en blanco solo cuentan como parte del bloque si DESPUES sigue
    // habiendo contenido indentado: una linea en blanco que separa el bloque
    // de la clave siguiente pertenece al frontmatter, no al bloque, y comersela
    // en el splice la borraria del artefacto exportado.
    let end = descIdx + 1;
    let lastContent = descIdx;
    for (; end < fmLines.length; end++) {
      if (fmLines[end].trim() === '') continue;
      if (!/^\s/.test(fmLines[end])) break;
      lastContent = end;
    }
    end = lastContent + 1;
    // JSON.stringify produce un escalar YAML double-quoted valido (superset de
    // JSON string), asi que cubre comillas, `:`, `#` y los `\n` que puede
    // dejar un literal `|` — sin necesidad de decidir el estilo de comilla.
    const merged = JSON.stringify(`${resolved} ${DEFERENCE_LINE(skillName)}`);
    fmLines.splice(descIdx, end - descIdx, `description: ${merged}`);
    return `---\n${fmLines.join('\n')}\n---\n${stripIntraRegistryPaths(body)}`;
  }

  // Llegar aca con `value` vacio significa `description:` sin NADA a la
  // derecha y sin bloque indentado debajo (el caso block scalar ya se
  // resolvio arriba): no hay descripcion que exportar.
  if (value === '') {
    throw new Error('description is empty');
  }
  // Empieza con `>`/`|` pero NO es un indicador de bloque bien formado (ej.
  // `>-basura`): YAML mismo lo rechaza. Fallar explicito en vez de tratarlo
  // como escalar plano, que emitiria un `description: >-basura ...` — invalido
  // como YAML, porque `>` y `|` son indicadores reservados al inicio de un
  // escalar plano.
  if (/^[>|]/.test(value)) {
    throw new Error(`malformed block scalar indicator in description: ${value}`);
  }
  const deference = DEFERENCE_LINE(skillName);
  // Quote-style detection mirrors readArtifactDescription in discovery.ts: both
  // single- and double-quoted scalars are first-class, and we work off the
  // trimmed value so trailing whitespace after a closing quote doesn't fool us.
  const isDoubleQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  const isSingleQuoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  if ((value.startsWith('"') || value.startsWith("'")) && !isDoubleQuoted && !isSingleQuoted) {
    throw new Error('description has trailing content after its closing quote (e.g. an inline comment) — not supported by the export transform; remove the comment or use a port.claude-ai.md override');
  }
  // YAML single-quoted scalars escape a literal ' by doubling it (''); the
  // deference text ("...registry's..." — see DEFERENCE_LINE) contains an
  // apostrophe, so it must be escaped before splicing into a single-quoted
  // description or it would prematurely close the YAML string.
  const newValue = isDoubleQuoted
    ? `${value.slice(0, -1)} ${deference}"`
    : isSingleQuoted
      ? `${value.slice(0, -1)} ${deference.replace(/'/g, "''")}'`
      : `${value} ${deference}`;
  fmLines[descIdx] = `description: ${newValue}`;

  // Solo el body: el frontmatter ya se editó arriba y sus campos no son prosa
  // navegable (R2.4).
  return `---\n${fmLines.join('\n')}\n---\n${stripIntraRegistryPaths(body)}`;
}
