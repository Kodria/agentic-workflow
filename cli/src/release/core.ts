export const PKG_NAME = 'agentic-workflow-manager';
export const RS = '\x1e';
export const US = '\x1f';
export const GIT_LOG_FORMAT = `%s${US}%b${RS}`;

export type Bump = 'major' | 'minor' | 'patch';

export interface Commit {
  type: string;
  scope: string | null;
  breaking: boolean;
  subject: string;
}

const HEADER_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

function parseOne(record: string): Commit | null {
  const [header, ...rest] = record.split(US);
  const body = rest.join(US);
  const m = HEADER_RE.exec(header.trim());
  if (!m) return null;
  return {
    type: m[1],
    scope: m[2] ?? null,
    breaking: Boolean(m[3]) || /^BREAKING CHANGE:/m.test(body),
    subject: m[4].trim(),
  };
}

export function parseCommits(raw: string): Commit[] {
  return raw
    .split(RS)
    .map((r) => r.trim())
    .filter(Boolean)
    .map(parseOne)
    .filter((c): c is Commit => c !== null);
}
