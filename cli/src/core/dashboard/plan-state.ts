export type PlanState = 'active' | 'blocked' | 'qa_pending' | 'retro_pending' | 'executed' | 'legacy_unverifiable';

export interface PlanStateInput {
    journal?: { state: 'active' | 'blocked' };
    markers: { qaComplete: boolean; retroComplete: boolean };
    tasks: { total: number; completed: number };
}

export function classifyPlanState(input: PlanStateInput): PlanState {
    if (!input || typeof input !== 'object' || !input.markers || !input.tasks) throw new Error('Plan state input must be an object');
    if (typeof input.markers.qaComplete !== 'boolean' || typeof input.markers.retroComplete !== 'boolean') throw new Error('Plan markers must be boolean');
    if (!Number.isInteger(input.tasks.total) || !Number.isInteger(input.tasks.completed) || input.tasks.total < 0 || input.tasks.completed < 0 || input.tasks.completed > input.tasks.total) throw new Error('Plan task counts are invalid');
    if (input.journal && input.journal.state !== 'active' && input.journal.state !== 'blocked') throw new Error('Plan journal state is invalid');
    if (input.journal?.state === 'blocked') return 'blocked';
    if (input.journal?.state === 'active') return 'active';
    if (input.markers.retroComplete) return 'executed';
    if (input.markers.qaComplete) return 'retro_pending';
    if (input.tasks.total > 0 && input.tasks.completed === input.tasks.total) return 'qa_pending';
    return 'legacy_unverifiable';
}
