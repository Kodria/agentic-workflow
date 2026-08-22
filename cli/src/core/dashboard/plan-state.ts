export type PlanState = 'active' | 'blocked' | 'qa_pending' | 'retro_pending' | 'executed' | 'legacy_unverifiable';

export interface PlanStateInput {
    journal?: { state: 'active' | 'blocked' };
    markers: { qaComplete: boolean; retroComplete: boolean };
    tasks: { total: number; completed: number };
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Plan ${label} must be an object`);
}

function assertKeys(value: Record<string, unknown>, label: string, keys: readonly string[]): void {
    if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Plan ${label} has unsupported fields`);
}

export function classifyPlanState(input: unknown): PlanState {
    assertRecord(input, 'state input');
    assertKeys(input, 'state input', ['journal', 'markers', 'tasks']);
    assertRecord(input.markers, 'markers');
    assertKeys(input.markers, 'markers', ['qaComplete', 'retroComplete']);
    assertRecord(input.tasks, 'tasks');
    assertKeys(input.tasks, 'tasks', ['total', 'completed']);
    const markers = input.markers;
    const tasks = input.tasks;
    if (typeof markers.qaComplete !== 'boolean' || typeof markers.retroComplete !== 'boolean') throw new Error('Plan markers must be boolean');
    if (typeof tasks.total !== 'number' || typeof tasks.completed !== 'number' || !Number.isInteger(tasks.total) || !Number.isInteger(tasks.completed) || tasks.total < 0 || tasks.completed < 0 || tasks.completed > tasks.total) throw new Error('Plan task counts are invalid');
    let journalState: 'active' | 'blocked' | undefined;
    if (input.journal !== undefined) {
        assertRecord(input.journal, 'journal');
        assertKeys(input.journal, 'journal', ['state']);
        if (input.journal.state !== 'active' && input.journal.state !== 'blocked') throw new Error('Plan journal state is invalid');
        journalState = input.journal.state;
    }
    if (journalState === 'blocked') return 'blocked';
    if (journalState === 'active') return 'active';
    if (markers.retroComplete) return 'executed';
    if (markers.qaComplete) return 'retro_pending';
    if (tasks.total > 0 && tasks.completed === tasks.total) return 'qa_pending';
    return 'legacy_unverifiable';
}
