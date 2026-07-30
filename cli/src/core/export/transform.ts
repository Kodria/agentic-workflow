// cli/src/core/export/transform.ts
//
// Transform mecánico claude.ai (R3.1): función pura string → string.
// Frontmatter line-based plano (los SKILL.md del baseline usan claves de una
// línea) — sin parser YAML a propósito (YAGNI, cero deps).
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
  if (value === '' || value === '>' || value === '|' || value.startsWith('>') || value.startsWith('|')) {
    throw new Error('description must be single-line (block scalars are not supported by the export transform)');
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
