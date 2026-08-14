export type Polarity = 'win' | 'finding';
export type LedgerClass = 'structural' | 'logica' | 'proceso' | 'seguridad';
export type Severity = 'blocker' | 'important' | 'minor' | 'info';

export const DEFECT_CLASS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

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
}

export type LedgerParseReason =
    | 'not-object'
    | 'invalid-enum'
    | 'invalid-fields'
    | 'invalid-ref'
    | 'invalid-defect-class';

export type LedgerParseResult =
    | { ok: true; entry: LedgerEntry }
    | { ok: false; source: string; reason: LedgerParseReason };

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

/** Validates the durable JSONL boundary. Missing defectClass is deliberately legacy-valid. */
export function parseLedgerEntry(input: unknown, source: string): LedgerParseResult {
    if (typeof source !== 'string') throw new Error('ledger parse source must be a string');
    if (!isRecord(input)) return { ok: false, source, reason: 'not-object' };
    if (!isPolarity(input.polarity) || !isLedgerClass(input.class) || !isSeverity(input.severity)) {
        return { ok: false, source, reason: 'invalid-enum' };
    }
    for (const field of ['ts', 'branch', 'phase', 'source_skill', 'signature', 'desc']) {
        if (typeof input[field] !== 'string') return { ok: false, source, reason: 'invalid-fields' };
    }
    if ('ref' in input && input.ref !== undefined && typeof input.ref !== 'string') {
        return { ok: false, source, reason: 'invalid-ref' };
    }
    if ('defectClass' in input && (typeof input.defectClass !== 'string' || !DEFECT_CLASS.test(input.defectClass))) {
        return { ok: false, source, reason: 'invalid-defect-class' };
    }
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
            // entry is valid, but has no reusable classification yet.
            defectClass: typeof input.defectClass === 'string' ? input.defectClass : undefined,
        },
    };
}
