import { createHash } from 'crypto';
import type { PolicyMapping, Selection } from './types';
import { validatePolicyContent } from './validate';

function same(left: Selection, right: Selection): boolean {
    return left.selector.kind === right.selector.kind && left.selector.id === right.selector.id
        && left.effort.kind === right.effort.kind
        && (left.effort.kind !== 'explicit' || left.effort.value === (right.effort as { kind: 'explicit'; value: string }).value);
}

/** This digest binds what native work proved: the selected model and effort.
 * Degradation permission is evaluated at dispatch and may be approved later
 * without forcing a second native run for the same selection. */
export function selectionPolicyDigest(mapping: PolicyMapping, selection: Selection): string {
    const validated = validatePolicyContent({ schema: 'model-policy/v1', mappings: [mapping],
        implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } }).mappings[0];
    const requested = [validated.profiles.mechanical, validated.profiles.integration, validated.profiles.judgment, validated.fullCapability];
    const found = requested.find(item => same(item, selection));
    if (!found) throw new Error('selection is not approved in this mapping');
    return createHash('sha256').update(JSON.stringify({ target: validated.target, runtimeKind: validated.runtimeKind, selection: found })).digest('hex');
}
