import crypto from 'crypto';
import type { PlanState } from '../dashboard/plan-state';
import { validateCycleEvidence, type CycleEvidenceV1 } from './types';

type SourceRecord = Record<string, unknown>;
const hash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const object = (value: unknown, name: string): SourceRecord => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as SourceRecord; };
const iso = (value: unknown, name: string): string => { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`); return value; };
const nonNegative = (value: unknown, name: string): number => { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative integer`); return value as number; };

export interface CaptureCycleEvidenceInput { root: string; repositoryIdentity: unknown; planPath: string; journal: unknown; gates: unknown; ledger: unknown; pr?: unknown; planState?: PlanState; }

export function captureCycleEvidence(input: CaptureCycleEvidenceInput): CycleEvidenceV1 {
  if (!input || typeof input.root !== 'string' || !input.root) throw new Error('capture root is required');
  if (typeof input.repositoryIdentity !== 'string' || input.repositoryIdentity.length === 0 || input.repositoryIdentity.length > 4096 || /[\r\n]/.test(input.repositoryIdentity)) throw new Error('repository identity is invalid');
  const repositoryIdentity = hash(input.repositoryIdentity);
  if (typeof input.planPath !== 'string' || !input.planPath) throw new Error('capture planPath is required');
  const journal = object(input.journal, 'journal'); const cycle = object(journal.cycle, 'journal cycle');
  const startedAt = iso(cycle.startedAt, 'cycle startedAt'); const endedAt = iso(cycle.completedAt ?? journal.controllerHeartbeatAt, 'cycle endedAt');
  if (cycle.status !== 'COMPLETE' && cycle.status !== 'BLOCKED') throw new Error('journal cycle must be complete or blocked');
  if (!Array.isArray(journal.tasks) || !Array.isArray(journal.verdicts) || !Array.isArray(journal.fixes) || !Array.isArray(input.gates) || !Array.isArray(input.ledger)) throw new Error('capture sources are invalid');
  const tasks = journal.tasks.map((item, index) => { const task = object(item, `task ${index}`); if (typeof task.id !== 'string') throw new Error('task id is invalid'); const attempts = nonNegative(task.attempts, 'task attempts'); return { id: task.id, attempts, retries: Math.max(attempts - 1, 0) }; });
  const adverseVerdicts = journal.verdicts.filter((item, index) => { const verdict = object(item, `verdict ${index}`); if (verdict.result !== 'pass' && verdict.result !== 'fail' && verdict.result !== 'inconclusive') throw new Error('verdict result is invalid'); iso(verdict.receivedAt, 'verdict receivedAt'); return verdict.result !== 'pass'; });
  const signatures = adverseVerdicts.map((item) => { const verdict = object(item, 'verdict'); if (typeof verdict.fingerprint !== 'string' || !verdict.fingerprint) throw new Error('verdict fingerprint is required'); return hash(`signature:${verdict.fingerprint}`); });
  const fixes = journal.fixes.filter((item, index) => { const fix = object(item, `fix ${index}`); if (typeof fix.closed !== 'boolean') throw new Error('fix closed is invalid'); return fix.closed; }).length;
  const gates = input.gates.map((item, index) => { const gate = object(item, `gate ${index}`); if (typeof gate.required !== 'boolean' || typeof gate.passed !== 'boolean') throw new Error('gate is invalid'); return gate; }).filter((gate) => gate.required === true);
  const cures = input.ledger.filter((item, index) => { const entry = object(item, `ledger ${index}`); if (typeof entry.signature !== 'string' || (entry.polarity !== 'finding' && entry.polarity !== 'win')) throw new Error('ledger entry is invalid'); iso(entry.ts, 'ledger timestamp'); return entry.polarity === 'win'; }).map((entry) => { const source = object(entry, 'ledger'); return { signature: hash(`signature:${source.signature}`), curedAt: iso(source.ts, 'ledger timestamp') }; });
  const pr = input.pr === undefined ? undefined : (() => { const raw = object(input.pr, 'pr'); return { provider: raw.provider, number: raw.number }; })();
  return validateCycleEvidence({ schema: 1, cycleId: hash(`${repositoryIdentity}\0${input.planPath}\0${startedAt}`), startedAt, endedAt, durationMs: Date.parse(endedAt) - Date.parse(startedAt), cycleState: cycle.status === 'COMPLETE' ? 'completed' : 'blocked', plan: { ref: input.planPath, state: input.planState ?? (cycle.status === 'BLOCKED' ? 'blocked' : 'executed') }, tasks, qa: { findings: signatures.length, fixes: Math.min(fixes, signatures.length), signatures }, gates: { required: gates.length, firstEvaluationsPassed: gates.map((gate) => gate.passed), firstPass: gates.every((gate) => gate.passed === true) }, cures, ...(pr ? { pr } : {}) });
}
