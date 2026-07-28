// src/core/init/failure.ts
//
// Failure evidence for `awm init`.
//
// `awm init` is transactional: any failure rolls every write back. That part
// was always right — what was missing is the EVIDENCE. `runInitSteps` already
// records, per step, `{ id, action: 'failed', error }` (orchestrator.ts's
// `wrapStep`), but commands/init.ts used to collapse the whole outcome into a
// bare `new Error('one or more init steps failed')`, so `--json` — whose only
// job is to emit that outcome — printed nothing at all on the exact path an
// operator needs it: a headless cloud bootstrap that just aborted.
//
// `InitStepsFailedError` carries the outcome across the rollback boundary, and
// `buildInitFailureOutput` shapes it into the JSON envelope the CLI emits.
// The envelope is deliberately self-describing (`result`, `failedSteps`,
// `transaction`) so a bootstrap script can branch on it without re-deriving
// anything from prose on stderr.

import type { CheckReport } from '../diagnostics/types';
import type { InitOutcome, StepResult } from './types';

/** Only the steps that actually failed — the subset an operator needs first. */
export function failedSteps(outcome: InitOutcome): StepResult[] {
    return outcome.steps.filter((s) => s.action === 'failed');
}

/**
 * Thrown when the step pipeline ran to completion but ≥1 step failed. Carries
 * the full `InitOutcome` so the rollback path can still emit it, and builds a
 * message that names every failed step instead of the old generic sentence.
 */
export class InitStepsFailedError extends Error {
    readonly outcome: InitOutcome;

    constructor(outcome: InitOutcome) {
        const detail = failedSteps(outcome)
            .map((s) => `${s.id}: ${s.error ?? 'no error recorded'}`)
            .join('; ');
        super(`one or more init steps failed — ${detail || 'no failed step recorded'}`);
        this.name = 'InitStepsFailedError';
        this.outcome = outcome;
    }
}

/** Transaction evidence for a failed run. Init is all-or-nothing: never committed. */
export interface InitFailureTransaction {
    /** Always false — a failed init never commits its backup session. */
    committed: false;
    /** True when every path in `restoredFiles` was restored to its pre-run state. */
    rolledBack: boolean;
    /** Backup-session id under ~/.awm/backups, or null when the run failed before one opened. */
    transactionId: string | null;
    /** Every path the backup session covered. Restored when `rolledBack` is true. */
    restoredFiles: string[];
    /** Set only when the rollback itself failed; the backup directory stays for manual recovery. */
    rollbackError?: string;
    /** Plain-language statement of what the two flags above mean for the machine's state. */
    note: string;
}

/** The JSON document `awm init --json` writes to stdout when the run fails. */
export interface InitFailureOutput {
    result: 'failed';
    /** Top-level message — names the failed steps when the pipeline produced an outcome. */
    error: string;
    /** Every step the pipeline recorded; empty when it failed before the pipeline ran. */
    steps: StepResult[];
    /** `steps` filtered to `action: 'failed'`, so callers need no client-side filtering. */
    failedSteps: StepResult[];
    applied: number;
    pending: number;
    failed: number;
    /** Pre-run harness snapshot. Null when the run failed before the pipeline ran. */
    before: CheckReport | null;
    /**
     * State observed at the END of the step pipeline — that is, BEFORE the
     * rollback restored anything. Null when the pipeline never ran.
     */
    after: CheckReport | null;
    transaction: InitFailureTransaction;
}

const NO_TRANSACTION_NOTE =
    'init failed before a backup session was opened — nothing was written, so there was nothing to roll back.';

/** The note explaining what a given rollback outcome means for the machine. */
export function transactionNote(rolledBack: boolean): string {
    return rolledBack
        ? 'the transaction was NOT committed: every path in restoredFiles was restored to its pre-init state. '
          + '`after` reflects the state observed at the end of the step pipeline, BEFORE this rollback ran.'
        : 'the transaction was NOT committed and the rollback did not complete — see rollbackError and '
          + 'restore manually with `awm backup restore <transactionId>`.';
}

export function buildInitFailureOutput(o: {
    error: Error;
    /** Present whenever the step pipeline produced an outcome before the failure. */
    outcome?: InitOutcome;
    /** Present whenever a backup session was opened before the failure. */
    transaction?: InitFailureTransaction;
}): InitFailureOutput {
    const steps = o.outcome?.steps ?? [];
    return {
        result: 'failed',
        error: o.error.message,
        steps,
        failedSteps: steps.filter((s) => s.action === 'failed'),
        applied: o.outcome?.applied ?? 0,
        pending: o.outcome?.pending ?? 0,
        failed: o.outcome?.failed ?? 0,
        before: o.outcome?.before ?? null,
        after: o.outcome?.after ?? null,
        transaction: o.transaction ?? {
            committed: false,
            rolledBack: false,
            transactionId: null,
            restoredFiles: [],
            note: NO_TRANSACTION_NOTE,
        },
    };
}
