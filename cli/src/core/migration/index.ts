import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { validatePlanSnapshot } from '../plan/validate';
import { detectBranch } from '../ledger/store';
import { readJournal } from '../journal/store';
import { computeFingerprint, type FingerprintResult } from '../journal/fingerprint';
import { secureFs } from '../secure-fs/native-bridge';
import { hasIssue148ReviewProvenance, type HistoricalReviewRecord } from './historical-provenance';
import type { VerificationItem } from '../journal/types';

export type MigrationState = 'supported-completion' | 'planning-required' | 'blocked';
export type MigrationTask = Readonly<{ id: string; state: 'completed' | 'pending' | 'unstarted'; missing: string[] }>;
export type EvidenceRecord = Readonly<{ taskId: string; commitSha?: string; verificationItemId?: string; verificationKind?: VerificationItem['kind']; jobId?: string; argv?: string[]; fingerprint?: string; paths?: string[]; verdictId?: string; obligationId?: string; role?: 'spec' | 'quality'; result?: 'pass' | 'fail' | 'inconclusive'; at?: string; issue126: string }>;
export type MigrationFactsReport = Readonly<{ state: MigrationState; planDigest?: string; issueLinks: string[]; tasks: MigrationTask[]; diagnostics: string[]; facts: ReadonlyArray<EvidenceRecord> }>;

const ISSUE_126 = /\/issues\/126\/?$/;
const ISSUE_148 = /\/issues\/148\/?$/;
const TASK = /^### Task ([1-9][0-9]{0,3}):/gm;
const MAX = 128;
const MAX_ISSUE_LINK_BYTES = 2048;

/** Pure task-scoped gate. Callers cannot combine a test from one task with a
 * review from another: every required record carries the same task identity. */
/** Local-only reconciliation. Evidence is admitted exclusively by
 * collectMigrationFacts from the schema-2 journal; callers cannot fabricate
 * records through the public migration API. */
function reconcileTaskEvidence(taskId: string, records: readonly EvidenceRecord[]): MigrationTask {
    const own = records.filter(record => record.taskId === taskId);
    if (own.some(record => !safeIssue(record.issue126) || !ISSUE_126.test(record.issue126))) return { id: taskId, state: 'pending', missing: ['issue126-provenance'] };
    if (own.some(record => record.result === 'fail' || record.result === 'inconclusive')) return { id: taskId, state: 'pending', missing: ['adverse-evidence'] };
    const commit = own.some(record => typeof record.commitSha === 'string' && /^[a-f0-9]{40}$/i.test(record.commitSha));
    const test = own.some(record => record.verificationKind === 'test' && record.result === 'pass' && !!record.fingerprint && (record.paths?.length ?? 0) > 0);
    const sensor = own.some(record => record.verificationKind === 'sensors' && record.result === 'pass' && !!record.fingerprint && (record.paths?.length ?? 0) > 0);
    const spec = own.some(record => record.role === 'spec' && record.result === 'pass' && !!record.verdictId && !!record.obligationId && !!record.at);
    const quality = own.some(record => record.role === 'quality' && record.result === 'pass' && !!record.verdictId && !!record.obligationId && !!record.at);
    const missing = [...(commit ? [] : ['commit']), ...(test ? [] : ['tests']), ...(sensor ? [] : ['sensors']), ...(spec ? [] : ['specification-review']), ...(quality ? [] : ['quality-review'])];
    return { id: taskId, state: missing.length === 0 ? 'completed' : 'pending', missing };
}

function safeIssue(link: unknown): link is string {
    // A canonical public issue URL cannot contain credentials, custom ports,
    // queries, fragments, encoded delimiters or controls. Never echo rejected
    // input: even a diagnostic could otherwise disclose URL credentials.
    return typeof link === 'string' && Buffer.byteLength(link, 'utf8') <= MAX_ISSUE_LINK_BYTES
        && /^https:\/\/github\.com\/Kodria\/agentic-workflow\/issues\/[1-9][0-9]*\/?$/.test(link)
        && !/[\u0000-\u001F\u007F-\u009F]/.test(link);
}
function validateIssueLinks(issueLinks: unknown): asserts issueLinks is string[] {
    if (!Array.isArray(issueLinks) || issueLinks.length === 0 || issueLinks.length > MAX
        || issueLinks.some(link => !safeIssue(link)) || !issueLinks.some(link => ISSUE_126.test(link))) {
        throw new Error('migration material facts require bounded canonical durable issue #126 links');
    }
}
function ids(text: string): string[] { const value = [...text.matchAll(TASK)].map(m => m[1]); if (value.length > MAX || new Set(value).size !== value.length) throw new Error('migration task ownership is ambiguous'); return value; }
function taskFiles(text: string, taskId: string): string[] {
    const start = text.search(new RegExp(`^### Task ${taskId}:`, 'm')); if (start < 0) return [];
    const end = text.indexOf('\n### Task ', start + 1); const section = text.slice(start, end < 0 ? text.length : end);
    const lines = section.split(/\r?\n/);
    const heading = lines.findIndex(line => /^\s*(?:\*\*)?Files:?(?:\*\*)?\s*$/i.test(line));
    if (heading < 0) return [];
    const files: string[] = [];
    for (const line of lines.slice(heading + 1)) {
        if (!line.trim() || /^\s*(?:#{1,6}\s|\*\*[^*]+\*\*)/.test(line)) break;
        const match = /^\s*[-*]\s*(?:(?:Create|Modify):\s*)?`?([^`\r\n]+?)`?\s*$/.exec(line);
        if (match) files.push(match[1].trim());
    }
    return files.filter(file => file && !file.includes('..') && !path.isAbsolute(file));
}
function declaredCommit(text: string, taskId: string, cwd: string): string | undefined {
    const start = text.search(new RegExp(`^### Task ${taskId}:`, 'm')); if (start < 0) return undefined;
    const end = text.indexOf('\n### Task ', start + 1); const section = text.slice(start, end < 0 ? text.length : end);
    const sha = /^Commit:\s*([a-f0-9]{7,40})\s*$/mi.exec(section)?.[1]; if (!sha) return undefined;
    const files = taskFiles(text, taskId);
    try { const full = execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }).trim(); execFileSync('git', ['merge-base', '--is-ancestor', full, 'HEAD'], { cwd, stdio: 'pipe', timeout: 2000 }); const changed = execFileSync('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', full], { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }).split(/\r?\n/).filter(Boolean); return files.length > 0 && changed.length > 0 && files.every(file => changed.includes(file)) ? full : undefined; } catch { return undefined; }
}
function readContainedRegularFile(root: string, relative: string, maximum: number, label: string): Buffer {
    if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error(`${label} must be relative`);
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes root`);
    // The native primitive walks parents through directory descriptors/handles,
    // refuses every reparse point, and reads the leaf through that anchor. Do
    // not emulate it with lstat/open: a parent can otherwise change in between.
    try { return secureFs.readRegularFile(file, maximum).bytes; }
    catch { throw new Error(`${label} must be a contained bounded regular file`); }
}
function readPlan(root: string, relative: string): string { return new TextDecoder('utf-8', { fatal: true }).decode(readContainedRegularFile(root, relative, 1024 * 1024, 'migration plan')); }

/** Public collector accepts no completion claims. All facts are derived locally and
 * every material record carries the initiative's durable #126 reference. */
export function collectMigrationFacts(planPath: string, cwd: string, issueLinks: string[]): MigrationFactsReport {
    validateIssueLinks(issueLinks);
    const root = fs.realpathSync(cwd); const text = readPlan(root, planPath); const taskIds = ids(text);
    // Validate the descriptor-anchored bytes above; never reopen planPath.
    const plan = validatePlanSnapshot(planPath, root, text);
    if (plan.state !== 'migration-required' && plan.state !== 'valid') return { state: 'blocked', issueLinks: [...issueLinks], tasks: [], diagnostics: ['plan-not-migratable'], facts: [] };
    const issue126 = issueLinks.find(link => ISSUE_126.test(link))!;
    const facts: EvidenceRecord[] = [];
    // Git can prove ancestry for a SHA only when the durable task obligation
    // names that SHA. The current journal schema has no task commit field, so
    // history is deliberately not borrowed across tasks.
    try { execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }); } catch { /* no Git fact */ }
    let journal; try { journal = readJournal(root, detectBranch(root)); } catch { journal = { state: null, corrupt: true }; }
    const diagnostics: string[] = [];
    if (!journal.state || journal.corrupt) diagnostics.push('journal-missing-or-corrupt');
    const binding = journal.state?.schema === 2 ? journal.state.planBinding : undefined;
    const digest = plan.state === 'valid' ? plan.planDigest : crypto.createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
    const bindingCurrent = !!binding && binding.path === planPath && binding.digest === digest && binding.executionMode === 'desatendido';
    if (!bindingCurrent) diagnostics.push('journal-plan-binding-stale');
    const jobs = journal.state ? Object.values(journal.state.jobs) : [];
    const observed = new Map<string, FingerprintResult | null>();
    const currentFingerprint = (record: { fingerprint: string; argv: string[]; paths: string[]; cwd: string }): FingerprintResult | null => {
        if (!bindingCurrent || !record.argv.length || !record.paths.length) return null;
        const key = JSON.stringify([record.argv, record.paths, record.cwd]);
        if (!observed.has(key)) {
            try { observed.set(key, computeFingerprint(root, record.argv, record.paths, record.cwd)); }
            catch { observed.set(key, null); }
        }
        const current = observed.get(key);
        return current && current.expandedPaths.length > 0 && current.fingerprint === record.fingerprint ? current : null;
    };
    const currentJobs = jobs.filter(job => {
        const current = currentFingerprint(job);
        return job.executionState === 'exited' && job.verdict === 'pass' && current !== null
            && current.commandDigest === job.commandDigest
            && JSON.stringify(current.expandedPaths) === JSON.stringify(job.expandedPaths);
    });
    if (currentJobs.length !== jobs.length) diagnostics.push('stale-or-nonterminal-durable-job-evidence');
    const declared = new Map((journal.state?.tasks ?? []).map(task => [task.id, declaredCommit(text, task.id, root)]));
    // A verifier identifier is an ownership boundary. A job must resolve to
    // exactly one task; otherwise it could lend the same execution evidence
    // to multiple task completions.
    const verificationOwners = new Map<string, string[]>();
    for (const task of journal.state?.tasks ?? []) for (const item of task.verificationPlan) {
        verificationOwners.set(item.id, [...(verificationOwners.get(item.id) ?? []), task.id]);
    }
    const claimedCommits = new Set<string>();
    const duplicateCommits = new Set<string>();
    for (const sha of declared.values()) if (sha) { if (claimedCommits.has(sha)) duplicateCommits.add(sha); else claimedCommits.add(sha); }
    for (const task of journal.state?.tasks ?? []) {
        const commitSha = declared.get(task.id); if (commitSha && !duplicateCommits.has(commitSha)) facts.push({ taskId: task.id, commitSha, issue126 });
        const verificationIds = new Set(task.verificationPlan.map(item => item.id).filter(id => verificationOwners.get(id)?.length === 1));
        const belongsToTask = (job: typeof jobs[number]): boolean => {
            const jobOwners = new Set((job.satisfies ?? []).flatMap(id => verificationOwners.get(id) ?? []));
            return jobOwners.size === 1 && jobOwners.has(task.id);
        };
        for (const job of currentJobs) {
            if (!belongsToTask(job)) continue;
            for (const item of task.verificationPlan) {
                if (verificationIds.has(item.id) && job.satisfies?.includes(item.id)) facts.push({ taskId: task.id, verificationItemId: item.id, verificationKind: item.kind, jobId: job.id, argv: job.argv, fingerprint: job.fingerprint, paths: job.paths, result: job.verdict, issue126 });
            }
        }
        for (const obligation of task.reviewObligations) {
            const verdict = obligation.verdictId ? journal.state?.verdicts.find(item => item.id === obligation.verdictId) : undefined;
            const fingerprintBound = verdict && currentFingerprint(verdict) !== null && currentJobs.some(job => belongsToTask(job) && job.fingerprint === verdict.fingerprint && job.satisfies?.some(id => verificationIds.has(id)));
            if (verdict && verdict.obligationId === obligation.id && obligation.taskId === task.id && fingerprintBound) facts.push({ taskId: task.id, verdictId: verdict.id, obligationId: obligation.id, role: obligation.kind, result: verdict.result, fingerprint: verdict.fingerprint, paths: verdict.paths, at: verdict.receivedAt, issue126 });
        }
    }
    if (jobs.some(job => job.verdict === 'fail') || journal.state?.verdicts.some(verdict => verdict.result === 'fail')) diagnostics.push('adverse-durable-verdict');
    const canonical148 = ISSUE_148.test(issueLinks.join('\n')) && planPath === 'docs/plans/2026-09-14-awm-facts-plan.md' && detectBranch(root) === 'codex/issue-148-awm-facts' && !!binding?.boundAt;
    const tasks = taskIds.map(id => {
        const task = journal.state?.tasks.find(candidate => candidate.id === id);
        // A binding alone is not task evidence. #148 only changes once a record
        // linked to this task is newer than binding.boundAt; this journal schema
        // lacks per-task commit provenance, so retain the conservative state.
        if (canonical148 && (id === '1' || id === '2')) return { id, state: 'pending' as const, missing: ['task-provenance-after-binding'] };
        if (!task) return { id, state: 'unstarted' as const, missing: [] };
        const reconciled = reconcileTaskEvidence(id, facts);
        return task.status === 'done' && reconciled.state === 'completed'
            ? reconciled : { ...reconciled, state: 'pending' as const };
    });
    if (canonical148 && !binding) diagnostics.push('issue-148-checkpoint-not-durably-bound');
    if (tasks.some(task => task.state === 'pending')) diagnostics.push('missing-durable-task-evidence');
    const state: MigrationState = diagnostics.some(d => d.startsWith('adverse')) ? 'blocked' : diagnostics.length ? 'planning-required' : tasks.some(task => task.state === 'completed') ? 'supported-completion' : 'planning-required';
    return { state, ...(plan.state === 'valid' ? { planDigest: digest } : {}), issueLinks: [...issueLinks], tasks, diagnostics, facts };
}

/** Bounded #148 dry-run source. Historical roots are deliberately limited to a
 * sibling worktree of this repository; arbitrary external directories are never
 * treated as durable migration evidence. */
export function collectIssue148HistoricalFacts(historicalRoot: string, issueLinks: string[]): MigrationFactsReport {
    validateIssueLinks(issueLinks);
    if (!issueLinks.some(link => ISSUE_148.test(link))) throw new Error('issue-148 migration requires durable #126 and #148 links');
    const root = fs.realpathSync(historicalRoot);
    const expected = path.join(path.dirname(fs.realpathSync(process.cwd())), 'codex-issue-148-awm-facts');
    if (root !== expected) throw new Error('historical root is not the admitted issue-148 sibling worktree');
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }).trim();
    if (branch !== 'codex/issue-148-awm-facts') throw new Error('historical root is not the admitted issue-148 branch');
    const issue126 = issueLinks.find(link => ISSUE_126.test(link));
    if (!issue126 || !safeIssue(issue126) || !issueLinks.some(link => safeIssue(link) && ISSUE_148.test(link))) throw new Error('issue-148 migration requires durable #126 and #148 links');
    const planPath = 'docs/plans/2026-09-14-awm-facts-plan.md'; const text = readPlan(root, planPath);
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const ledgerPath = '.awm/ledger/codex__issue-148-awm-facts.jsonl';
    let ledgerEntries: HistoricalReviewRecord[] = [];
    try {
        ledgerEntries = readContainedRegularFile(root, ledgerPath, 256 * 1024, 'issue-148 ledger').toString('utf8').trim().split('\n').filter(Boolean).map(line => {
            const value: unknown = JSON.parse(line); if (!value || typeof value !== 'object') throw new Error();
            const item = value as Record<string, unknown>; if (typeof item.branch !== 'string' || typeof item.phase !== 'string' || typeof item.source_skill !== 'string' || typeof item.polarity !== 'string' || typeof item.signature !== 'string' || typeof item.ref !== 'string') throw new Error();
            if (item.ts !== undefined && typeof item.ts !== 'string') throw new Error();
            return { branch: item.branch, phase: item.phase, source_skill: item.source_skill, polarity: item.polarity, signature: item.signature, ref: item.ref, ...(typeof item.ts === 'string' ? { ts: item.ts } : {}) };
        });
    } catch { ledgerEntries = []; }
    const checkpoint = '81c008c5f681e6ecfe30a3fc73bf7b79d094c094';
    const ancestor = (() => { try {
        for (const commit of ['91047f5041a447b85243ea25b91652aef41151bd', '1207e61c5b206ad8693f5c5d6b9ab5ab19cd8a6f', checkpoint]) execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'pipe', timeout: 2000 });
        return true;
    } catch { return false; } })();
    const taskOneStart = text.search(/^### Task 1:/m);
    const taskOneEnd = text.indexOf('\n### Task ', taskOneStart + 1);
    const taskOneSection = taskOneStart < 0 ? '' : text.slice(taskOneStart, taskOneEnd < 0 ? text.length : taskOneEnd);
    const taskOneChecked = /^- \[x\]/m.test(taskOneSection);
    const taskOneFiles = new Set(taskFiles(text, '1'));
    const currentTaskOneFiles = (() => {
        if (taskOneFiles.size === 0) return false;
        try {
            const checkpointFiles = execFileSync('git', ['ls-tree', '--name-only', '-r', checkpoint, '--', ...taskOneFiles], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }).trim().split('\n');
            if ([...taskOneFiles].some(file => !checkpointFiles.includes(file))) return false;
            execFileSync('git', ['diff', '--quiet', checkpoint, '--', ...taskOneFiles], { cwd: root, stdio: 'pipe', timeout: 2000 });
            execFileSync('git', ['diff', '--cached', '--quiet', checkpoint, '--', ...taskOneFiles], { cwd: root, stdio: 'pipe', timeout: 2000 });
            return true;
        } catch { return false; }
    })();
    const ledgerReviews = (() => { try { return hasIssue148ReviewProvenance(ledgerEntries); } catch { return false; } })();
    const taskIds = ids(text); const proven = digest === 'c11477dd59cb19094983c671cc0b760f1d1e51b9679e13dba90f1b0c2cba48e7' && ancestor && currentTaskOneFiles && taskOneChecked && ledgerReviews;
    // A checked historical antecedent without sufficient provenance is not
    // unstarted. Preserve it for reconciliation; never imply permission to
    // replay its implementation or borrow another task's review.
    const tasks = taskIds.map(id => id === '1' && proven ? { id, state: 'completed' as const, missing: [] } : id === '1' && taskOneChecked ? { id, state: 'pending' as const, missing: ['historical-completion-provenance'] } : id === '2' ? { id, state: 'pending' as const, missing: ['quality-review'] } : { id, state: 'unstarted' as const, missing: [] });
    return { state: proven ? 'planning-required' : 'blocked', planDigest: digest, issueLinks: [...issueLinks], tasks, diagnostics: proven ? ['Task 2 quality re-review remains'] : ['issue-148 historical provenance is incomplete or inconsistent'], facts: [{ taskId: '1', issue126 }] };
}
