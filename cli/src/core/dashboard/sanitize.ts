import { createHash } from 'crypto';

const STATES = new Set(['ok', 'attention', 'missing', 'unavailable', 'not_applicable', 'active', 'blocked']);
const ALLOWED_KEYS = new Set(['findings', 'label', 'id', 'state', 'detail', 'remediation', 'remediationVerified', 'execution', 'qa', 'retro', 'history', 'lifecycle', 'journal', 'markers', 'tasks', 'total', 'completed', 'qaComplete', 'retroComplete']);
const CANONICAL_LABELS = new Set([
    'Preferences', 'Registries', 'Profile', 'Sensors', 'Optional source unavailable',
    'Extensions', 'Registry pins', 'Active bundles', 'Project context', 'Constitution', 'Static preflight',
]);
const CANONICAL_FINDING_IDS = new Set([
    'machine.preferences.missing', 'machine.registries.stale', 'project.profile.missing',
    'project.sensors.unavailable', 'project.preflight.degraded', 'planning.source.unavailable', 'execution.source.unavailable',
]);
const PROVIDER_FINDING_ID = /^machine\.provider\.(?:claude-code|codex|opencode|cursor|copilot|antigravity)\.(?:binary\.version|skills\.global|agents\.native|workflows\.global|context\.global|hook\.trust|guidance\.project|constitution\.delivery)$/;
const PROJECT_FINDING_ID = /^project\.(?:profile\.present|extensions\.configured|registry-pins\.present|bundles\.coherent|context\.present|constitution\.present|sensors\.present|preflight\.not_collected)$/;
const PROVIDER_LABEL = /^Provider (?:claude-code|codex|opencode|cursor|copilot|antigravity): (?:binary\.version|skills\.global|agents\.native|workflows\.global|context\.global|hook\.trust|guidance\.project|constitution\.delivery)$/;
const DANGEROUS = /(?:ghp_|sk-[A-Za-z]|<|>|\\\\[^\\\s]+\\[^\\\s]+|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Za-z]:\\|\b[A-Za-z_][A-Za-z0-9_]*=|token|secret|password)/iu;

function sanitize(value: unknown, key?: string): unknown {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Dashboard source numbers must be finite');
        return value;
    }
    if (typeof value === 'string') {
        if (key === 'state' && !STATES.has(value)) throw new Error(`Dashboard source state is invalid: ${value}`);
        // IDs are source-controlled and are rendered into snapshots. Preserve only
        // the small canonical vocabulary; opaque IDs retain deterministic ordering
        // without exporting repository names, emails, IPs, or local identifiers.
        if (key === 'id') {
            if (value.trim() === '') throw new Error('Dashboard finding id is invalid');
            return CANONICAL_FINDING_IDS.has(value) || PROVIDER_FINDING_ID.test(value) || PROJECT_FINDING_ID.test(value)
                ? value : `item-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
        }
        if (key === 'label' && !CANONICAL_LABELS.has(value) && !PROVIDER_LABEL.test(value)) return '[redacted]';
        return DANGEROUS.test(value) ? '[redacted]' : value;
    }
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
    if (!value || typeof value !== 'object') throw new Error('Dashboard source must contain JSON-compatible values');
    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
        if (!ALLOWED_KEYS.has(entryKey)) continue;
        // Source details are untrusted command/error output. Renderers only receive
        // canonical details produced after collection (for example lifecycle state).
        if (entryKey === 'detail') continue;
        out[entryKey] = sanitize(entryValue, entryKey);
    }
    return out;
}

/** Removes dynamic credentials, local paths, and hostile markup from source observations. */
export function sanitizeDashboardSource(value: unknown): unknown {
    return sanitize(value);
}
