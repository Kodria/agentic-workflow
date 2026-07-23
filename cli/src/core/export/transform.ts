// cli/src/core/export/transform.ts
//
// Transform mecánico claude.ai (R3.1): función pura string → string.
// Frontmatter line-based plano (los SKILL.md del baseline usan claves de una
// línea) — sin parser YAML a propósito (YAGNI, cero deps).
export const DEFERENCE_LINE = (skillName: string): string =>
  `In environments with AWM installed (Claude Code), defer to the registry's ${skillName} skill — this port is for environments without filesystem access.`;

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
  const newValue = isDoubleQuoted
    ? `${value.slice(0, -1)} ${deference}"`
    : isSingleQuoted
      ? `${value.slice(0, -1)} ${deference}'`
      : `${value} ${deference}`;
  fmLines[descIdx] = `description: ${newValue}`;

  return `---\n${fmLines.join('\n')}\n---\n${body}`;
}
