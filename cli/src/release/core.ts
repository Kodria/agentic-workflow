import { compareSemver } from '../core/versioning';

export const PKG_NAME = 'agentic-workflow-manager';
export const RS = '\x1e';
export const US = '\x1f';
export const GIT_LOG_FORMAT = `%s${US}%b${RS}`;

export type Bump = 'major' | 'minor' | 'patch';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

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

export function determineBump(commits: Commit[]): Bump | null {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  if (commits.some((c) => c.type === 'fix' || c.type === 'perf')) return 'patch';
  return null;
}

export function nextVersion(base: string, bump: Bump): string {
  const m = SEMVER_RE.exec((base ?? '').trim());
  if (!m) throw new Error(`Invalid base version: "${base}"`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

export function selectFloor(current: string, lastTagVersion: string | null): string {
  if (!SEMVER_RE.test((current ?? '').trim())) {
    throw new Error(`Invalid current version: "${current}"`);
  }
  const cur = current.trim();
  if (!lastTagVersion) return cur;
  return compareSemver(cur, lastTagVersion) >= 0 ? cur : lastTagVersion;
}
