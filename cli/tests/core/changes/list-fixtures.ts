import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { TestRepo } from './helpers';
import { listChanges, type ListOutcome, type ListResult } from '../../../src/core/changes/list';

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

// eslint-disable-next-line no-control-regex
export const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
export const FIRST = '2026-10-16-first';

export const listIn = (repo: TestRepo, opts: Record<string, unknown> = {}): ListOutcome => listChanges(repo.root, { since: SINCE_48H, ...opts } as never);
export function ok(outcome: ListOutcome): ListResult {
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.failure.code}: ${outcome.failure.message}`);
    return outcome.result;
}
export const subjects = (r: ListResult): string[] => r.changes.map((c) => c.subject);
export const byClass = (r: ListResult): Record<string, string> => Object.fromEntries(r.changes.map((c) => [c.subject, c.classification]));

/** The commit that opens the adoption point, before the 48h window. */
export function adoptIn(repo: TestRepo, id = '2026-10-10-adopt'): string {
    return repo.commit({ [recordPath(id)]: record(id, { summary: 'Adopcion.' }) }, 'feat: adopt', '2026-10-10T00:00:00Z');
}
/** Pre-adoption, recorded, missing, exempt and invalid-record commits, tagged v1.0.0. */
export function historyIn(repo: TestRepo): void {
    repo.commit({ 'old.ts': '1' }, 'feat: before adoption', '2026-10-16T09:00:00Z');
    repo.commit({ [recordPath(FIRST)]: record(FIRST), 'a.ts': '1' }, 'feat: first (#10)', '2026-10-16T20:00:00Z');
    repo.commit({ 'b.ts': '1' }, 'fix: no record', '2026-10-16T21:00:00Z');
    repo.commit({ 'c.ts': '1' }, 'chore(release): v1.0.0 [skip ci]\n\nChange-Record: none', '2026-10-16T22:00:00Z');
    repo.commit({ [recordPath('2026-10-17-bad')]: '---\nschema: nope\n---\n' }, 'feat: bad record', '2026-10-17T01:00:00Z');
    repo.gitAt('2026-10-17T02:00:00Z', 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
}

/**
 * A digest of every file and directory under `root`, `.git` and its object database included: names and contents, never times.
 * Two equal digests mean that nothing was written, fetched or refreshed in between.
 */
export function snapshotDir(root: string): string {
    const hash = crypto.createHash('sha1');
    const walk = (dir: string, rel: string): void => {
        for (const name of fs.readdirSync(dir).sort()) {
            const abs = path.join(dir, name);
            const here = `${rel}/${name}`;
            if (fs.lstatSync(abs).isDirectory()) { hash.update(`d ${here}\n`); walk(abs, here); } else hash.update(`f ${here} ${crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex')}\n`);
        }
    };
    walk(root, '');
    return hash.digest('hex');
}
