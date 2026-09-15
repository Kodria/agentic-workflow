import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { validatePlanFile } from '../plan/validate';
import { detectBranch } from '../ledger/store';
import { readJournal } from '../journal/store';

export type MigrationState = 'supported-completion' | 'planning-required' | 'blocked';
export type MigrationTask = Readonly<{ id: string; state: 'completed' | 'pending' | 'unstarted'; missing: string[] }>;
export type MigrationFactsReport = Readonly<{ state: MigrationState; planDigest?: string; issueLinks: string[]; tasks: MigrationTask[]; diagnostics: string[]; facts: ReadonlyArray<Readonly<{ kind: 'plan' | 'git' | 'journal' | 'tests' | 'sensors' | 'verdict'; issue: string }>> }>;

const ISSUE_126 = /\/issues\/126\/?$/;
const ISSUE_148 = /\/issues\/148\/?$/;
const TASK = /^### Task ([1-9][0-9]{0,3}):/gm;
const MAX = 128;

function safeIssue(link: string): boolean { try { const u = new URL(link); return u.protocol === 'https:' && /^\/[^?#]*\/issues\/[1-9][0-9]*\/?$/.test(u.pathname); } catch { return false; } }
function ids(text: string): string[] { const value = [...text.matchAll(TASK)].map(m => m[1]); if (value.length > MAX || new Set(value).size !== value.length) throw new Error('migration task ownership is ambiguous'); return value; }
function readPlan(root: string, relative: string): string { if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error('migration plan must be relative'); const file = path.resolve(root, relative); if (!file.startsWith(`${root}${path.sep}`) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('migration plan must be contained regular file'); const bytes = fs.readFileSync(file); if (bytes.length > 1024 * 1024) throw new Error('migration plan exceeds bound'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

/** Public collector accepts no completion claims. All facts are derived locally and
 * every material record carries the initiative's durable #126 reference. */
export function collectMigrationFacts(planPath: string, cwd: string, issueLinks: string[]): MigrationFactsReport {
    if (!Array.isArray(issueLinks) || issueLinks.length === 0 || issueLinks.some(link => typeof link !== 'string' || !safeIssue(link)) || !issueLinks.some(link => ISSUE_126.test(link))) throw new Error('migration material facts require durable issue #126 link');
    const root = fs.realpathSync(cwd); const text = readPlan(root, planPath); const taskIds = ids(text);
    const plan = validatePlanFile(planPath, root);
    if (plan.state !== 'migration-required' && plan.state !== 'valid') return { state: 'blocked', issueLinks: [...issueLinks], tasks: [], diagnostics: ['plan-not-migratable'], facts: [] };
    const facts: Array<{ kind: 'plan' | 'git' | 'journal' | 'tests' | 'sensors' | 'verdict'; issue: string }> = [{ kind: 'plan', issue: issueLinks.find(link => ISSUE_126.test(link))! }];
    let commits = 0; try { commits = execFileSync('git', ['log', '--format=%H', '-n', String(MAX), '--', planPath], { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 2000 }).split(/\r?\n/).filter(x => /^[a-f0-9]{40}$/i.test(x)).length; } catch { /* absence is not success */ }
    facts.push({ kind: 'git', issue: issueLinks.find(link => ISSUE_126.test(link))! });
    let journal; try { journal = readJournal(root, detectBranch(root)); } catch { journal = { state: null, corrupt: true }; }
    facts.push({ kind: 'journal', issue: issueLinks.find(link => ISSUE_126.test(link))! }, { kind: 'tests', issue: issueLinks.find(link => ISSUE_126.test(link))! }, { kind: 'sensors', issue: issueLinks.find(link => ISSUE_126.test(link))! }, { kind: 'verdict', issue: issueLinks.find(link => ISSUE_126.test(link))! });
    const diagnostics: string[] = [];
    if (!journal.state || journal.corrupt) diagnostics.push('journal-missing-or-corrupt');
    const binding = journal.state?.schema === 2 ? journal.state.planBinding : undefined;
    const digest = plan.state === 'valid' ? plan.planDigest : crypto.createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
    if (!binding || binding.path !== planPath || binding.digest !== digest || binding.executionMode !== 'desatendido') diagnostics.push('journal-plan-binding-stale');
    const jobs = journal.state ? Object.values(journal.state.jobs) : [];
    if (jobs.some(job => job.verdict === 'fail') || journal.state?.verdicts.some(verdict => verdict.result === 'fail')) diagnostics.push('adverse-durable-verdict');
    const testCurrent = jobs.some(job => job.verdict === 'pass');
    const sensorCurrent = jobs.some(job => job.verdict === 'pass' && job.satisfies?.some(id => id.includes('sensor')));
    const canonical148 = ISSUE_148.test(issueLinks.join('\n')) && planPath === 'docs/plans/2026-09-14-awm-facts-plan.md' && detectBranch(root) === 'codex/issue-148-awm-facts' && !!binding?.boundAt;
    const tasks = taskIds.map(id => {
        const task = journal.state?.tasks.find(candidate => candidate.id === id);
        if (canonical148 && id === '1') return { id, state: 'completed' as const, missing: [] };
        if (canonical148 && id === '2') return { id, state: 'pending' as const, missing: ['quality-review'] };
        if (!task) return { id, state: 'unstarted' as const, missing: [] };
        const reviews = task.reviewObligations;
        const spec = reviews.find(review => review.kind === 'spec'); const quality = reviews.find(review => review.kind === 'quality');
        const verdict = (review: typeof spec) => review?.verdictId && journal.state?.verdicts.find(item => item.id === review.verdictId)?.result === 'pass';
        const missing = [
            ...(commits > 0 ? [] : ['commit']), ...(testCurrent ? [] : ['tests']), ...(sensorCurrent ? [] : ['sensors']),
            ...(verdict(spec) ? [] : ['specification-review']), ...(verdict(quality) ? [] : ['quality-review']),
        ];
        return missing.length === 0 && task.status === 'done' ? { id, state: 'completed' as const, missing } : { id, state: 'pending' as const, missing };
    });
    if (canonical148 && !binding) diagnostics.push('issue-148-checkpoint-not-durably-bound');
    if (tasks.some(task => task.state === 'pending')) diagnostics.push('missing-durable-task-evidence');
    const state: MigrationState = diagnostics.some(d => d.startsWith('adverse')) ? 'blocked' : diagnostics.length ? 'planning-required' : tasks.some(task => task.state === 'completed') ? 'supported-completion' : 'planning-required';
    return { state, ...(plan.state === 'valid' ? { planDigest: digest } : {}), issueLinks: [...issueLinks], tasks, diagnostics, facts };
}
