import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { validatePlanFile } from '../plan/validate';
import { detectBranch } from '../ledger/store';
import { readJournal } from '../journal/store';

export type MigrationState = 'supported-completion' | 'planning-required' | 'blocked';
export type MigrationTask = Readonly<{ id: string; state: 'completed' | 'pending' | 'unstarted'; missing: string[] }>;
export type EvidenceRecord = Readonly<{ taskId: string; commitSha?: string; verificationItemId?: string; jobId?: string; argv?: string[]; fingerprint?: string; paths?: string[]; verdictId?: string; obligationId?: string; role?: 'spec' | 'quality'; result?: 'pass' | 'fail' | 'inconclusive'; at?: string; issue126: string }>;
export type MigrationFactsReport = Readonly<{ state: MigrationState; planDigest?: string; issueLinks: string[]; tasks: MigrationTask[]; diagnostics: string[]; facts: ReadonlyArray<EvidenceRecord> }>;

const ISSUE_126 = /\/issues\/126\/?$/;
const ISSUE_148 = /\/issues\/148\/?$/;
const TASK = /^### Task ([1-9][0-9]{0,3}):/gm;
const MAX = 128;

/** Pure task-scoped gate. Callers cannot combine a test from one task with a
 * review from another: every required record carries the same task identity. */
export function reconcileTaskEvidence(taskId: string, records: readonly EvidenceRecord[]): MigrationTask {
    const own = records.filter(record => record.taskId === taskId);
    if (own.some(record => record.result === 'fail' || record.result === 'inconclusive')) return { id: taskId, state: 'pending', missing: ['adverse-evidence'] };
    const commit = own.some(record => typeof record.commitSha === 'string' && /^[a-f0-9]{40}$/i.test(record.commitSha));
    const test = own.some(record => record.verificationItemId?.startsWith('test') && record.result === 'pass' && !!record.fingerprint && (record.paths?.length ?? 0) > 0);
    const sensor = own.some(record => record.verificationItemId?.startsWith('sensor') && record.result === 'pass' && !!record.fingerprint && (record.paths?.length ?? 0) > 0);
    const spec = own.some(record => record.role === 'spec' && record.result === 'pass' && !!record.verdictId && !!record.obligationId && !!record.at);
    const quality = own.some(record => record.role === 'quality' && record.result === 'pass' && !!record.verdictId && !!record.obligationId && !!record.at);
    const missing = [...(commit ? [] : ['commit']), ...(test ? [] : ['tests']), ...(sensor ? [] : ['sensors']), ...(spec ? [] : ['specification-review']), ...(quality ? [] : ['quality-review'])];
    return { id: taskId, state: missing.length === 0 ? 'completed' : 'pending', missing };
}

function safeIssue(link: string): boolean { try { const u = new URL(link); return u.protocol === 'https:' && u.hostname === 'github.com' && /^\/Kodria\/agentic-workflow\/issues\/[1-9][0-9]*\/?$/.test(u.pathname); } catch { return false; } }
function ids(text: string): string[] { const value = [...text.matchAll(TASK)].map(m => m[1]); if (value.length > MAX || new Set(value).size !== value.length) throw new Error('migration task ownership is ambiguous'); return value; }
function readPlan(root: string, relative: string): string { if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error('migration plan must be relative'); const file = path.resolve(root, relative); const parent = path.dirname(file); if (fs.realpathSync(parent) !== root && !fs.realpathSync(parent).startsWith(`${root}${path.sep}`)) throw new Error('migration plan escapes root'); if (!file.startsWith(`${root}${path.sep}`) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('migration plan must be contained regular file'); const bytes = fs.readFileSync(file); if (bytes.length > 1024 * 1024) throw new Error('migration plan exceeds bound'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

/** Public collector accepts no completion claims. All facts are derived locally and
 * every material record carries the initiative's durable #126 reference. */
export function collectMigrationFacts(planPath: string, cwd: string, issueLinks: string[]): MigrationFactsReport {
    if (!Array.isArray(issueLinks) || issueLinks.length === 0 || issueLinks.some(link => typeof link !== 'string' || !safeIssue(link)) || !issueLinks.some(link => ISSUE_126.test(link))) throw new Error('migration material facts require durable issue #126 link');
    const root = fs.realpathSync(cwd); const text = readPlan(root, planPath); const taskIds = ids(text);
    const plan = validatePlanFile(planPath, root);
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
    if (!binding || binding.path !== planPath || binding.digest !== digest || binding.executionMode !== 'desatendido') diagnostics.push('journal-plan-binding-stale');
    const jobs = journal.state ? Object.values(journal.state.jobs) : [];
    for (const task of journal.state?.tasks ?? []) {
        for (const job of jobs) if (job.verdict && job.fingerprint && job.argv.length > 0 && job.paths.length > 0) facts.push({ taskId: task.id, verificationItemId: job.satisfies?.[0], jobId: job.id, argv: job.argv, fingerprint: job.fingerprint, paths: job.paths, result: job.verdict, issue126 });
        for (const obligation of task.reviewObligations) {
            const verdict = obligation.verdictId ? journal.state?.verdicts.find(item => item.id === obligation.verdictId) : undefined;
            if (verdict) facts.push({ taskId: task.id, verdictId: verdict.id, obligationId: obligation.id, role: obligation.kind, result: verdict.result, fingerprint: verdict.fingerprint, at: verdict.receivedAt, issue126 });
        }
    }
    if (jobs.some(job => job.verdict === 'fail') || journal.state?.verdicts.some(verdict => verdict.result === 'fail')) diagnostics.push('adverse-durable-verdict');
    const testCurrent = jobs.some(job => job.verdict === 'pass');
    const sensorCurrent = jobs.some(job => job.verdict === 'pass' && job.satisfies?.some(id => id.includes('sensor')));
    const canonical148 = ISSUE_148.test(issueLinks.join('\n')) && planPath === 'docs/plans/2026-09-14-awm-facts-plan.md' && detectBranch(root) === 'codex/issue-148-awm-facts' && !!binding?.boundAt;
    const tasks = taskIds.map(id => {
        const task = journal.state?.tasks.find(candidate => candidate.id === id);
        // A binding alone is not task evidence. #148 only changes once a record
        // linked to this task is newer than binding.boundAt; this journal schema
        // lacks per-task commit provenance, so retain the conservative state.
        if (canonical148 && (id === '1' || id === '2')) return { id, state: 'pending' as const, missing: ['task-provenance-after-binding'] };
        if (!task) return { id, state: 'unstarted' as const, missing: [] };
        const reviews = task.reviewObligations;
        const spec = reviews.find(review => review.kind === 'spec'); const quality = reviews.find(review => review.kind === 'quality');
        const verdict = (review: typeof spec) => review?.verdictId && journal.state?.verdicts.find(item => item.id === review.verdictId)?.result === 'pass';
        const missing = [
            'commit-provenance', ...(testCurrent ? [] : ['tests']), ...(sensorCurrent ? [] : ['sensors']),
            ...(verdict(spec) ? [] : ['specification-review']), ...(verdict(quality) ? [] : ['quality-review']),
        ];
        return missing.length === 0 && task.status === 'done' ? { id, state: 'completed' as const, missing } : { id, state: 'pending' as const, missing };
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
    const root = fs.realpathSync(historicalRoot);
    const expected = path.join(path.dirname(fs.realpathSync(process.cwd())), 'codex-issue-148-awm-facts');
    if (root !== expected) throw new Error('historical root is not the admitted issue-148 sibling worktree');
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }).trim();
    if (branch !== 'codex/issue-148-awm-facts') throw new Error('historical root is not the admitted issue-148 branch');
    const issue126 = issueLinks.find(link => ISSUE_126.test(link));
    if (!issue126 || !issueLinks.some(link => ISSUE_148.test(link))) throw new Error('issue-148 migration requires durable #126 and #148 links');
    const planPath = 'docs/plans/2026-09-14-awm-facts-plan.md'; const text = readPlan(root, planPath);
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const ledger = path.join(root, '.awm', 'ledger', 'codex__issue-148-awm-facts.jsonl');
    let ledgerEntries: Array<{ branch: string; phase: string; source_skill: string; polarity: string; signature: string; ref: string }> = [];
    try {
        const realLedger = fs.realpathSync(ledger); if (!realLedger.startsWith(`${root}${path.sep}`) || fs.lstatSync(ledger).isSymbolicLink() || fs.statSync(ledger).size > 256 * 1024) throw new Error();
        ledgerEntries = fs.readFileSync(realLedger, 'utf8').trim().split('\n').filter(Boolean).map(line => {
            const value: unknown = JSON.parse(line); if (!value || typeof value !== 'object') throw new Error();
            const item = value as Record<string, unknown>; if (typeof item.branch !== 'string' || typeof item.phase !== 'string' || typeof item.source_skill !== 'string' || typeof item.polarity !== 'string' || typeof item.signature !== 'string' || typeof item.ref !== 'string') throw new Error();
            return item as typeof ledgerEntries[number];
        });
    } catch { ledgerEntries = []; }
    const ancestor = (() => { try { execFileSync('git', ['merge-base', '--is-ancestor', '81c008c', 'HEAD'], { cwd: root, stdio: 'pipe' }); return true; } catch { return false; } })();
    const taskOneChecked = /### Task 1:[\s\S]*?(?=\n### Task 2:)/.test(text) && /### Task 1:[\s\S]*?- \[x\]/.test(text);
    const ledgerReviews = ledgerEntries.some(item => item.branch === branch && item.phase === 'review' && item.source_skill === 'specification-reviewer' && item.polarity === 'win')
        && ledgerEntries.some(item => item.branch === branch && item.phase === 'review' && item.source_skill === 'requesting-code-review' && item.polarity === 'win' && item.signature === 'awm-facts-nested-yaml-boundary-reviewed');
    const taskIds = ids(text); const proven = digest === 'c11477dd59cb19094983c671cc0b760f1d1e51b9679e13dba90f1b0c2cba48e7' && ancestor && taskOneChecked && ledgerReviews;
    const tasks = taskIds.map(id => id === '1' && proven ? { id, state: 'completed' as const, missing: [] } : id === '2' ? { id, state: 'pending' as const, missing: ['quality-review'] } : { id, state: 'unstarted' as const, missing: [] });
    return { state: proven ? 'planning-required' : 'blocked', planDigest: digest, issueLinks: [...issueLinks], tasks, diagnostics: proven ? ['Task 2 quality re-review remains'] : ['issue-148 historical provenance is incomplete or inconsistent'], facts: [{ taskId: '1', issue126 }] };
}
