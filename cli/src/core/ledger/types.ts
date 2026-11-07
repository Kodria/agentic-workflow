export type Polarity = 'win' | 'finding';
export type LedgerClass = 'structural' | 'logica' | 'proceso' | 'seguridad';
export type Severity = 'blocker' | 'important' | 'minor' | 'info';
export type DeferredReason = 'round-ceiling' | 're-review-defer';
export type ResolvedHow = 'fixed' | 'accepted';

export const DEFECT_CLASS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const DEFERRED_REASONS: readonly DeferredReason[] = ['round-ceiling', 're-review-defer'];
export const RESOLVED_HOWS: readonly ResolvedHow[] = ['fixed', 'accepted'];

export interface LedgerDeferred {
    at: string;
    reason: DeferredReason;
}

export interface LedgerResolved {
    at: string;
    how: ResolvedHow;
}

export interface LedgerEntry {
    ts: string;
    branch: string;
    phase: string;
    source_skill: string;
    polarity: Polarity;
    class: LedgerClass;
    signature: string;
    severity: Severity;
    desc: string;
    ref?: string;
    defectClass?: string;
    /** Stable unique id assigned at add time. Absent on legacy pre-RF-4.7 lines. */
    id?: string;
    deferred?: LedgerDeferred;
    resolved?: LedgerResolved;
}

export type LedgerParseReason =
    | 'not-object'
    | 'invalid-enum'
    | 'invalid-fields'
    | 'invalid-ref'
    | 'invalid-defect-class'
    | 'invalid-deferred'
    | 'invalid-resolved';

export type LedgerParseResult =
    | { ok: true; entry: LedgerEntry }
    | { ok: false; source: string; reason: LedgerParseReason };

/** Append-only resolution line folded onto the matching entry by id (CQ-S5-2). */
export const LEDGER_RESOLVE_KIND = 'ledger-resolve' as const;

export interface LedgerResolveRecord {
    kind: typeof LEDGER_RESOLVE_KIND;
    id: string;
    resolved: LedgerResolved;
}

export type LedgerResolveParseResult =
    | { ok: true; record: LedgerResolveRecord }
    | { ok: false; reason: 'not-resolve' | 'invalid-resolve' };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPolarity(value: unknown): value is Polarity {
    return value === 'win' || value === 'finding';
}

function isLedgerClass(value: unknown): value is LedgerClass {
    return value === 'structural' || value === 'logica' || value === 'proceso' || value === 'seguridad';
}

function isSeverity(value: unknown): value is Severity {
    return value === 'blocker' || value === 'important' || value === 'minor' || value === 'info';
}

function isDeferredReason(value: unknown): value is DeferredReason {
    return value === 'round-ceiling' || value === 're-review-defer';
}

function isResolvedHow(value: unknown): value is ResolvedHow {
    return value === 'fixed' || value === 'accepted';
}

function parseDeferred(value: unknown): LedgerDeferred | 'invalid' | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return 'invalid';
    if (typeof value.at !== 'string' || value.at.length === 0) return 'invalid';
    if (!isDeferredReason(value.reason)) return 'invalid';
    return { at: value.at, reason: value.reason };
}

function parseResolved(value: unknown): LedgerResolved | 'invalid' | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return 'invalid';
    if (typeof value.at !== 'string' || value.at.length === 0) return 'invalid';
    if (!isResolvedHow(value.how)) return 'invalid';
    return { at: value.at, how: value.how };
}

/** Parses an append-only resolve line. Non-resolve objects return not-resolve (caller may try entry parse). */
export function parseLedgerResolveRecord(input: unknown): LedgerResolveParseResult {
    if (!isRecord(input) || input.kind !== LEDGER_RESOLVE_KIND) {
        return { ok: false, reason: 'not-resolve' };
    }
    if (typeof input.id !== 'string' || input.id.length === 0) {
        return { ok: false, reason: 'invalid-resolve' };
    }
    const resolved = parseResolved(input.resolved);
    if (resolved === undefined || resolved === 'invalid') {
        return { ok: false, reason: 'invalid-resolve' };
    }
    return { ok: true, record: { kind: LEDGER_RESOLVE_KIND, id: input.id, resolved } };
}

/** Validates the durable JSONL boundary. Missing defectClass/id/deferred/resolved is deliberately legacy-valid. */
export function parseLedgerEntry(input: unknown, source: string): LedgerParseResult {
    if (typeof source !== 'string') throw new Error('ledger parse source must be a string');
    if (!isRecord(input)) return { ok: false, source, reason: 'not-object' };
    if (!isPolarity(input.polarity) || !isLedgerClass(input.class) || !isSeverity(input.severity)) {
        return { ok: false, source, reason: 'invalid-enum' };
    }
    for (const field of ['ts', 'branch', 'phase', 'source_skill', 'signature', 'desc']) {
        if (typeof input[field] !== 'string') return { ok: false, source, reason: 'invalid-fields' };
    }
    if ('id' in input && input.id !== undefined
        && (typeof input.id !== 'string' || input.id.length === 0)) {
        return { ok: false, source, reason: 'invalid-fields' };
    }
    if ('ref' in input && input.ref !== undefined && typeof input.ref !== 'string') {
        return { ok: false, source, reason: 'invalid-ref' };
    }
    if ('defectClass' in input && input.defectClass !== undefined
        && (typeof input.defectClass !== 'string' || !DEFECT_CLASS.test(input.defectClass))) {
        return { ok: false, source, reason: 'invalid-defect-class' };
    }
    const deferred = parseDeferred(input.deferred);
    if (deferred === 'invalid') return { ok: false, source, reason: 'invalid-deferred' };
    const resolved = parseResolved(input.resolved);
    if (resolved === 'invalid') return { ok: false, source, reason: 'invalid-resolved' };
    return {
        ok: true,
        entry: {
            ts: input.ts as string,
            branch: input.branch as string,
            phase: input.phase as string,
            source_skill: input.source_skill as string,
            polarity: input.polarity,
            class: input.class,
            signature: input.signature as string,
            severity: input.severity,
            desc: input.desc as string,
            ...(typeof input.ref === 'string' ? { ref: input.ref } : {}),
            // Keep the durable legacy distinction visible to consumers: an older
            // entry is valid, but has no reusable classification / deferred state yet.
            defectClass: typeof input.defectClass === 'string' ? input.defectClass : undefined,
            id: typeof input.id === 'string' ? input.id : undefined,
            deferred,
            resolved,
        },
    };
}
