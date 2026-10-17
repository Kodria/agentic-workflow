import { isDeepStrictEqual } from 'util';
import yaml from 'js-yaml';
import { loadFrontmatter, splitRecord } from './parse';
import { BODY_HEADINGS, DERIVED_KEYS, PENDING_MARKER, RECORD_SCHEMA, type DerivedFields, type Verification } from './types';

// CORE_SCHEMA on both sides: the validator parses with it, so what is dumped here is exactly what it will read back.
const DUMP = { lineWidth: -1, noRefs: true, sortKeys: false, schema: yaml.CORE_SCHEMA } as const;
const REPLACED: readonly string[] = [...DERIVED_KEYS, 'verification'];
const isBareKeyChar = (c: string): boolean => /^[\w.-]$/.test(c);

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const bare = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line);

export interface SkeletonInput {
    id: string;
    fields: DerivedFields;
    verification: Verification;
    links?: { plan?: string; issue?: string };
    provenance?: Record<string, string>;
}

/**
 * The record skeleton: derived fields and verification are real, every narrative field and body section holds the pending marker.
 * Returns null when the input cannot be dumped, or when the dump does not read back as the same data. Never throws.
 */
export function renderSkeleton(input: SkeletonInput): string | null {
    try {
        if (!isObj(input) || typeof input.id !== 'string' || !isObj(input.fields) || !isObj(input.verification)) return null;
        const front: Record<string, unknown> = {
            schema: RECORD_SCHEMA,
            id: input.id,
            title: PENDING_MARKER,
            summary_short: PENDING_MARKER,
            ...Object.fromEntries(DERIVED_KEYS.map((k) => [k, input.fields[k]])),
        };
        if (isObj(input.links) && Object.keys(input.links).length > 0) front.links = input.links;
        front.verification = input.verification;
        front.manual_validation = [{ step: PENDING_MARKER, expected: PENDING_MARKER }];
        front.risks = [PENDING_MARKER];
        front.rollback = PENDING_MARKER;
        if (isObj(input.provenance) && Object.keys(input.provenance).length > 0) front.provenance = input.provenance;
        const dumped = yaml.dump(front, DUMP);
        const back = loadFrontmatter(dumped.replace(/\n$/, ''));
        if (!back.ok || !isDeepStrictEqual(back.value, front)) return null;
        const body = BODY_HEADINGS.map((h) => `${h}\n\n${PENDING_MARKER}\n`).join('\n');
        return `---\n${dumped}---\n\n${body}`;
    } catch {
        return null;
    }
}

/**
 * The key of a top-level `key: ...` line, or null when the line does not start a mapping entry the scan understands. Accepted
 * spellings: bare (`type:`), double- or single-quoted on one line, each with optional spaces or tabs before the colon. A quoted
 * key that needs unescaping (`\"`, `\u0074`, `''`) returns its raw text, which never equals a derived key name: such an
 * entry is kept as it is, and a record that only spells a derived key that way fails the "every key seen" check instead.
 * A single left-to-right index scan: linear in the line, no regular expression over file text.
 */
function topKey(line: string): string | null {
    let i = 0;
    let key: string;
    const first = line.charAt(0);
    if (first === '"' || first === "'") {
        for (i = 1; ; i++) {
            if (i >= line.length) return null;
            const c = line[i];
            if (first === '"' && c === '\\') { i++; continue; }
            if (c === first) {
                if (first === "'" && line[i + 1] === "'") { i++; continue; }
                break;
            }
        }
        key = line.slice(1, i);
        i++;
    } else {
        if (!/^[A-Za-z_]$/.test(first)) return null;
        for (i = 1; i < line.length && isBareKeyChar(line[i]); i++);
        key = line.slice(0, i);
    }
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (line[i] !== ':') return null;
    const after = line[i + 1];
    if (after !== undefined && after !== ' ' && after !== '\t' && after !== '\r') return null;
    return key;
}

/** Blank lines and comments after a block's last content line belong to what follows, not to the value. */
const isFiller = (line: string): boolean => {
    const t = bare(line).trim();
    return t === '' || t.startsWith('#');
};

function splice(raw: string, fields: DerivedFields, verification: Verification): string | null {
    if (typeof raw !== 'string' || !isObj(fields) || !isObj(verification)) return null;
    const split = splitRecord(raw);
    if (!split.ok) return null;
    const loaded = loadFrontmatter(split.frontmatterText);
    if (!loaded.ok || !isObj(loaded.value)) return null;
    const before = loaded.value;
    const fresh: Record<string, unknown> = { ...Object.fromEntries(DERIVED_KEYS.map((k) => [k, fields[k]])), verification };

    // Work on the raw lines, not on the normalized text: each line keeps its own terminator (CRLF, LF or mixed).
    const lines = raw.split('\n');
    const close = lines.findIndex((l, i) => i > 0 && bare(l) === '---');
    if (bare(lines[0]) !== '---' || close < 1 || close >= lines.length - 1) return null;
    const starts: number[] = [];
    const keys: string[] = [];
    for (let i = 1; i < close; i++) {
        const key = topKey(lines[i]);
        if (key !== null) { starts.push(i); keys.push(key); }
    }
    if (starts.length === 0) return null;

    const seen = new Set<string>();
    const out: string[] = lines.slice(0, starts[0]);
    starts.forEach((start, n) => {
        const end = starts[n + 1] ?? close;
        const key = keys[n];
        if (!REPLACED.includes(key)) { out.push(...lines.slice(start, end)); return; }
        seen.add(key);
        let last = end - 1;
        while (last > start && isFiller(lines[last])) last--;
        const cr = lines[start].endsWith('\r') ? '\r' : '';
        const dumped = yaml.dump({ [key]: fresh[key] }, DUMP).replace(/\n$/, '').split('\n').map((l) => l + cr);
        out.push(...dumped, ...lines.slice(last + 1, end));
    });
    out.push(...lines.slice(close));
    if (!REPLACED.every((k) => seen.has(k))) return null;
    const next = out.join('\n');

    // Fail closed: the result must parse and hold, for every key of the original, the fresh value (replaced keys) or the old one
    // (all the others). Anything the line scan misjudged (odd YAML layouts) ends here instead of in a corrupted record.
    const reread = splitRecord(next);
    if (!reread.ok) return null;
    const after = loadFrontmatter(reread.frontmatterText);
    if (!after.ok || !isObj(after.value)) return null;
    for (const key of Object.keys(before)) {
        if (!isDeepStrictEqual(after.value[key], REPLACED.includes(key) ? fresh[key] : before[key])) return null;
    }
    return next;
}

/**
 * R3.11: replaces only the top-level blocks of the derived keys and `verification`; every other byte (comments, blank lines,
 * other keys, the body, each line's own line ending) is preserved. Null when the record is unparseable, a replaced key is
 * missing, the input is unusable, or the result would not read back as intended. Never throws.
 */
export function refreshDerived(raw: string, fields: DerivedFields, verification: Verification): string | null {
    try {
        return splice(raw, fields, verification);
    } catch {
        return null;
    }
}
