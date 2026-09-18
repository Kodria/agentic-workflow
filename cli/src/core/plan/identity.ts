import crypto from 'crypto';

export const MAX_PLAN_SNAPSHOT_BYTES = 1024 * 1024;
export const EXECUTION_IDENTITY_SCHEMA = 'awm-plan-execution/v1' as const;
const START = '<!-- AWM:COMPACT-SLICES:START v1 -->';
const END = '<!-- AWM:COMPACT-SLICES:END v1 -->';
const START_V2 = '<!-- AWM:COMPACT-SLICES:START v2 -->';
const END_V2 = '<!-- AWM:COMPACT-SLICES:END v2 -->';

/** Only lifecycle syntax actually emitted by the skills is non-executable.
 * Unknown metadata, prose, inline comments and code remain identity-bearing. */
function lifecycleMarker(line: string): string | undefined {
    const match = /^ {0,3}<!-- (awm-(?:qa|docs|retro)-complete)(?:: (\d{4}-\d{2}-\d{2}|Release [A-Za-z0-9][A-Za-z0-9_-]*))? -->$/.exec(line);
    if (!match) return undefined;
    const metadata = match[2];
    if (metadata && !metadata.startsWith('Release ')) {
        const parsed = new Date(`${metadata}T00:00:00.000Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== metadata) return undefined;
    }
    return `${match[1]}:${metadata?.startsWith('Release ') ? metadata : ''}`;
}

export function normalizedPlanSnapshot(text: string): string {
    if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_PLAN_SNAPSHOT_BYTES || text.includes('\0')) {
        throw new Error('plan snapshot must be nonempty bounded text without NUL');
    }
    return text.replace(/\r\n?/g, '\n');
}

export function fullPlanDigest(text: string): string {
    return crypto.createHash('sha256').update(normalizedPlanSnapshot(text), 'utf8').digest('hex');
}

/** This versioned identity preserves ALL plan bytes except recognized progress
 * status bytes and unique standalone lifecycle marker lines outside code/JSON.
 * It is never a replacement for the full validated-plan digest. */
export function executionPlanDigest(text: string): string {
    const lines = normalizedPlanSnapshot(text).split('\n');
    let fence: { character: string; length: number } | undefined;
    let manifest = false;
    const candidates = lines.map(line => {
        const matched = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
        const marker = matched?.[1];
        if (marker && (fence
            ? marker[0] === fence.character && marker.length >= fence.length && /^[ \t]*$/.test(matched![2])
            : marker[0] !== '`' || !matched![2].includes('`'))) {
            fence = fence ? undefined : { character: marker[0], length: marker.length };
            return { line };
        }
        if (fence) return { line };
        if (line === START || line === START_V2) { manifest = true; return { line }; }
        if (line === END || line === END_V2) { manifest = false; return { line }; }
        if (manifest) return { line };
        const lifecycle = lifecycleMarker(line);
        return { line: line.replace(/^( {0,3}[-*+] +)\[[ xX]\]( +\S.*)$/, '$1[ ]$2'), lifecycle };
    });
    const counts = new Map<string, number>();
    for (const { lifecycle } of candidates) if (lifecycle) counts.set(lifecycle, (counts.get(lifecycle) ?? 0) + 1);
    const canonical = candidates.filter(({ lifecycle }) => !lifecycle || counts.get(lifecycle) !== 1).map(({ line }) => line).join('\n');
    return crypto.createHash('sha256').update(`${EXECUTION_IDENTITY_SCHEMA}\0`).update(canonical, 'utf8').digest('hex');
}
