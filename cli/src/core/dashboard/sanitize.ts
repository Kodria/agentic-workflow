const STATES = new Set(['ok', 'attention', 'missing', 'unavailable', 'not_applicable', 'active', 'blocked']);
const ALLOWED_KEYS = new Set(['findings', 'label', 'id', 'state', 'detail', 'execution', 'qa', 'retro', 'history', 'lifecycle', 'journal', 'markers', 'tasks', 'total', 'completed', 'qaComplete', 'retroComplete']);
const CANONICAL_LABELS = new Set(['Preferences', 'Registries', 'Profile', 'Optional source unavailable']);
const DANGEROUS = /(?:ghp_|sk-[A-Za-z]|<|>|\\\\[^\\\s]+\\[^\\\s]+|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Za-z]:\\|token|secret|password)/iu;

function sanitize(value: unknown, key?: string): unknown {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Dashboard source numbers must be finite');
        return value;
    }
    if (typeof value === 'string') {
        if (key === 'state' && !STATES.has(value)) throw new Error(`Dashboard source state is invalid: ${value}`);
        if (key === 'label' && !CANONICAL_LABELS.has(value)) return '[redacted]';
        return DANGEROUS.test(value) ? '[redacted]' : value;
    }
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
    if (!value || typeof value !== 'object') throw new Error('Dashboard source must contain JSON-compatible values');
    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
        if (!ALLOWED_KEYS.has(entryKey)) continue;
        out[entryKey] = sanitize(entryValue, entryKey);
    }
    return out;
}

/** Removes dynamic credentials, local paths, and hostile markup from source observations. */
export function sanitizeDashboardSource(value: unknown): unknown {
    return sanitize(value);
}
