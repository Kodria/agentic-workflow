// cli/src/core/export/transform.ts
//
// Transform mecánico claude.ai (R3.1): función pura string → string.
// Frontmatter line-based plano (los SKILL.md del baseline usan claves de una
// línea) — sin parser YAML a propósito (YAGNI, cero deps).
export const DEFERENCE_LINE = (skillName: string): string =>
  `In environments with AWM installed (Claude Code), defer to the registry's ${skillName} skill — this port is for environments without filesystem access.`;

export function claudeAiTransform(skillMd: string, skillName: string): string {
  if (!skillMd.startsWith('---\n')) {
    throw new Error('missing frontmatter block (file must start with ---)');
  }
  const end = skillMd.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('unterminated frontmatter block (closing --- not found)');
  }
  const body = skillMd.slice(end + '\n---\n'.length);
  const fmLines = skillMd.slice(4, end).split('\n')
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
  fmLines[descIdx] = descLine.endsWith('"')
    ? `${descLine.slice(0, -1)} ${deference}"`
    : `${descLine} ${deference}`;

  return `---\n${fmLines.join('\n')}\n---\n${body}`;
}
