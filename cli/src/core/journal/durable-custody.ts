/**
 * Durable custody = `awm watch` + journal-bound supervisor/controller relaunch.
 *
 * Suspended for every provider until routing/custody work resumes. The supported
 * unattended path is the native provider session (compact-slices/v1, no journal).
 *
 * The Jest suite sets `AWM_ALLOW_DURABLE_CUSTODY=1` so the machinery stays tested
 * for when this suspension is lifted. Operators never set that variable.
 */

export const DURABLE_CUSTODY_SUSPENDED_MESSAGE =
    'Durable custody (awm watch) is suspended for all providers until routing/custody work resumes. '
    + 'Use native provider-session unattended (compact-slices/v1, no journal).';

/** True for operators; false only when tests explicitly re-enable the machinery. */
export function isDurableCustodySuspended(): boolean {
    return process.env.AWM_ALLOW_DURABLE_CUSTODY !== '1';
}
