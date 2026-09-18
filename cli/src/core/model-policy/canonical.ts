import { createHash } from 'node:crypto';
import type { PolicyContent } from './types';
import { validatePolicyContent } from './validate';

function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') { const serialized = JSON.stringify(value); if (serialized === undefined) throw new Error('Invalid canonical value'); return serialized; }
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
export function canonicalPolicyDigest(content: PolicyContent): string { const validated = validatePolicyContent(content); return createHash('sha256').update(canonical(validated), 'utf8').digest('hex'); }
