import fs from 'fs';
import path from 'path';
import type { TestRepo } from './helpers';

// Shared by the tests of `awm changes list`: a valid record text and the clock every list test runs at.

export const SHA = 'a'.repeat(40);
/** The instant every list test pretends to run at. */
export const NOW = new Date('2026-10-17T12:00:00.000Z');
export const now = (): Date => NOW;
/** The start of the `48h` window at NOW. */
export const SINCE_48H = new Date('2026-10-15T12:00:00.000Z');

export interface RecordOptions {
    summary?: string;
    title?: string;
    type?: string;
    overall?: string;
    /** Steps (default two) or `{ none: reason }`. */
    manual?: Array<[string, string]> | { none: string };
    /** Text added to the frontmatter before the closing `---`. */
    extra?: string;
}

/** A valid Change Record whose id is `id` (it must equal the file name without `.md`). */
export function record(id: string, o: RecordOptions = {}): string {
    const manual = o.manual ?? [['s1', 'e1'], ['s2', 'e2']];
    const manualYaml = Array.isArray(manual)
        ? manual.map(([step, expected]) => `  - step: ${step}\n    expected: ${expected}`).join('\n')
        : `  none: ${manual.none}`;
    return `---
schema: awm.change-record/v1
id: ${id}
title: "${o.title ?? `T ${id}`}"
summary_short: "${o.summary ?? 'Primer cambio.'}"
type: ${o.type ?? 'feat'}
scope: null
semver: minor
breaking: false
modules: [cli]
verification:
  commit: ${SHA}
  overall: ${o.overall ?? 'pass'}
  sensors: { lint: pass }
  receipt_digest: sha256:${'b'.repeat(64)}
manual_validation:
${manualYaml}
risks: []
rollback: revert
${o.extra ?? ''}---
## Qué se hizo
a
## Qué se probó
b
## Qué falta validar
c
## Riesgos y rollback
d
`;
}

export const recordPath = (id: string): string => `docs/changes/${id}.md`;

let oddCommits = 0;
/**
 * A commit on top of HEAD whose committer line is `committer t <t@t> <committerDate>` verbatim (git itself would never write an
 * empty, negative or garbage date), written straight into the object store and checked out. Returns its id.
 */
export function commitLiterally(repo: TestRepo, committerDate: string, message = 'fix: odd date'): string {
    const body = [`tree ${repo.git('write-tree')}`, `parent ${repo.git('rev-parse', 'HEAD')}`, 'author t <t@t> 1700000000 +0000', `committer t <t@t> ${committerDate}`, '', message, ''].join('\n');
    const file = path.join(repo.home, `odd-commit-${oddCommits++}.txt`);
    fs.writeFileSync(file, body);
    const sha = repo.git('hash-object', '-t', 'commit', '-w', '--literally', file);
    repo.git('reset', '-q', '--hard', sha);
    return sha;
}
