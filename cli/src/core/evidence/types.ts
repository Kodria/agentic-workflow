import type { PlanState } from '../dashboard/plan-state';

export const PLAN_STATES = ['active', 'blocked', 'qa_pending', 'retro_pending', 'executed', 'legacy_unverifiable'] as const;
export type CycleEvidencePlanState = typeof PLAN_STATES[number];

export interface CycleEvidenceV1 {
  schema: 1;
  cycleId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  cycleState: 'completed' | 'blocked';
  plan: { ref: string; state: PlanState };
  tasks: Array<{ id: string; attempts: number; retries: number }>;
  qa: { findings: number; fixes: number; signatures: string[] };
  gates: { required: number; firstEvaluationsPassed: boolean[]; firstPass: boolean };
  cures: Array<{ signature: string; curedAt: string }>;
  pr?: { provider: 'github' | 'gitlab' | 'other'; number: number };
}

const DIGEST = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} has unsupported fields`);
}
function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp`);
  return value;
}
function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}
function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  return value;
}
function relativePlanRef(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('plan.ref must be repo-relative');
  return value;
}

/** Strict public durable-boundary validator: accepted evidence intentionally has no prose or identities. */
export function validateCycleEvidence(input: unknown): CycleEvidenceV1 {
  const value = record(input, 'cycle evidence');
  keys(value, 'cycle evidence', ['schema', 'cycleId', 'startedAt', 'endedAt', 'durationMs', 'cycleState', 'plan', 'tasks', 'qa', 'gates', 'cures', 'pr']);
  if (value.schema !== 1) throw new Error('cycle evidence schema must be 1');
  const startedAt = timestamp(value.startedAt, 'startedAt');
  const endedAt = timestamp(value.endedAt, 'endedAt');
  const durationMs = count(value.durationMs, 'durationMs');
  if (Date.parse(endedAt) < Date.parse(startedAt) || durationMs !== Date.parse(endedAt) - Date.parse(startedAt)) throw new Error('cycle duration is invalid');
  if (value.cycleState !== 'completed' && value.cycleState !== 'blocked') throw new Error('cycleState is invalid');
  const plan = record(value.plan, 'plan'); keys(plan, 'plan', ['ref', 'state']);
  if (typeof plan.state !== 'string' || !PLAN_STATES.includes(plan.state as CycleEvidencePlanState)) throw new Error('plan state is invalid');
  if (!Array.isArray(value.tasks)) throw new Error('tasks must be an array');
  const tasks = value.tasks.map((item, index) => {
    const task = record(item, `tasks[${index}]`); keys(task, `tasks[${index}]`, ['id', 'attempts', 'retries']);
    if (typeof task.id !== 'string' || !SAFE_ID.test(task.id)) throw new Error('task id is invalid');
    const attempts = count(task.attempts, 'task attempts'); const retries = count(task.retries, 'task retries');
    if (retries !== Math.max(attempts - 1, 0)) throw new Error('task retries must derive from attempts');
    return { id: task.id, attempts, retries };
  });
  const qa = record(value.qa, 'qa'); keys(qa, 'qa', ['findings', 'fixes', 'signatures']);
  if (!Array.isArray(qa.signatures)) throw new Error('qa signatures must be an array');
  const signatures = qa.signatures.map((signature, index) => digest(signature, `qa.signatures[${index}]`));
  const findings = count(qa.findings, 'qa findings'); const fixes = count(qa.fixes, 'qa fixes');
  if (signatures.length !== findings || fixes > findings) throw new Error('qa counts are inconsistent');
  const gates = record(value.gates, 'gates'); keys(gates, 'gates', ['required', 'firstEvaluationsPassed', 'firstPass']);
  const required = count(gates.required, 'required gates');
  if (!Array.isArray(gates.firstEvaluationsPassed) || !gates.firstEvaluationsPassed.every((passed) => typeof passed === 'boolean') || gates.firstEvaluationsPassed.length !== required || typeof gates.firstPass !== 'boolean' || gates.firstPass !== gates.firstEvaluationsPassed.every(Boolean)) throw new Error('gate evaluations are inconsistent');
  if (!Array.isArray(value.cures)) throw new Error('cures must be an array');
  const cures = value.cures.map((item, index) => { const cure = record(item, `cures[${index}]`); keys(cure, `cures[${index}]`, ['signature', 'curedAt']); return { signature: digest(cure.signature, 'cure signature'), curedAt: timestamp(cure.curedAt, 'curedAt') }; });
  let pr: CycleEvidenceV1['pr'];
  if (value.pr !== undefined) { const raw = record(value.pr, 'pr'); keys(raw, 'pr', ['provider', 'number']); if (raw.provider !== 'github' && raw.provider !== 'gitlab' && raw.provider !== 'other') throw new Error('pr provider is invalid'); const number = count(raw.number, 'pr number'); if (number < 1) throw new Error('pr number is invalid'); pr = { provider: raw.provider, number }; }
  return { schema: 1, cycleId: digest(value.cycleId, 'cycleId'), startedAt, endedAt, durationMs, cycleState: value.cycleState, plan: { ref: relativePlanRef(plan.ref), state: plan.state as PlanState }, tasks, qa: { findings, fixes, signatures }, gates: { required, firstEvaluationsPassed: [...gates.firstEvaluationsPassed] as boolean[], firstPass: gates.firstPass }, cures, ...(pr ? { pr } : {}) };
}
