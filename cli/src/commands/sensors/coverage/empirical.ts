import { clusterEntries } from '../../../core/ledger/cluster';
import type { LedgerEntry, Severity } from '../../../core/ledger/types';
import type { LedgerScanResult, ScannedLedgerEntry } from '../../../core/ledger/scan';
import type { CoverageClassStatus } from './evaluate';

export type EmpiricalOutcome = 'covered-by-sensor' | 'gap' | 'coverage-unverifiable' | 'applicability-contradiction' | 'unmapped-class';
export type EmpiricalStaticState = CoverageClassStatus | 'incompatible' | 'missing-tool' | 'compatible-unverified';

export type EmpiricalClass = {
    defectClass: string;
    occurrences: number;
    recurrent: boolean;
    severity: Severity;
    outcome: EmpiricalOutcome;
    evidenceRefs: string[];
    omittedEvidenceRefs: number;
};

export type EmpiricalCoverage = {
    /** The threshold used to classify each aggregate as recurrent. */
    recurrenceThreshold: number;
    status: 'no-evidence' | 'evidence' | 'partial' | 'inconclusive';
    classes: EmpiricalClass[];
    unclassified: { occurrences: number; evidenceRefs: string[]; omittedEvidenceRefs: number };
    sources: LedgerScanResult['sources'];
    omittedEvidenceRefs: number;
};

const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
const severityRank: Readonly<Record<Severity, number>> = { blocker: 4, important: 3, minor: 2, info: 1 };
const relativeLine = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9._@+~=-]+(?:\/[A-Za-z0-9._@+~=-]+)*:[1-9][0-9]*$/;
const prRef = /^PR #[1-9][0-9]*$/;
const hashRef = /^[a-f0-9]{7,64}$/i;

function safeRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(OSC, '').replace(ANSI, '').replace(CONTROLS, '').trim().slice(0, 256);
    return relativeLine.test(cleaned) || prRef.test(cleaned) || hashRef.test(cleaned) ? cleaned : null;
}

function refsFor(entries: LedgerEntry[], scanned: Map<LedgerEntry, ScannedLedgerEntry>): { refs: string[]; omitted: number } {
    const refs = new Set<string>();
    let omitted = 0;
    for (const entry of entries) {
        const scannedEntry = scanned.get(entry);
        if (!scannedEntry || scannedEntry.evidenceRef === null) { omitted += 1; continue; }
        const ref = safeRef(scannedEntry.evidenceRef);
        if (ref === null) omitted += 1;
        else refs.add(ref);
    }
    return { refs: [...refs].sort((a, b) => a.localeCompare(b)), omitted };
}

function maxSeverity(entries: LedgerEntry[]): Severity {
    return entries.reduce<Severity>((best, entry) => severityRank[entry.severity] > severityRank[best] ? entry.severity : best, 'info');
}

export function outcomeFor(staticState: EmpiricalStaticState | undefined, hasEvidence: boolean): EmpiricalOutcome {
    if (typeof hasEvidence !== 'boolean') throw new Error('outcomeFor: hasEvidence must be boolean');
    if (!hasEvidence || staticState === 'unverifiable' || staticState === 'compatible-unverified') return 'coverage-unverifiable';
    if (staticState === undefined) return 'unmapped-class';
    if (staticState === 'covered') return 'covered-by-sensor';
    if (staticState === 'not-applicable') return 'applicability-contradiction';
    if (staticState === 'missing' || staticState === 'incompatible' || staticState === 'missing-tool') return 'gap';
    throw new Error('outcomeFor: invalid static state');
}

/**
 * Converts bounded ledger findings into a public aggregate. Defect classes are
 * the sole grouping boundary: no description or signature is used to classify
 * an entry, and those private fields never cross this module's output.
 */
export function evaluateEmpiricalCoverage(scan: LedgerScanResult, staticStates: Readonly<Record<string, EmpiricalStaticState>>, min: number): EmpiricalCoverage {
    if (!scan || typeof scan !== 'object' || !Array.isArray(scan.entries) || !scan.sources || typeof scan.omittedEvidenceRefs !== 'number') {
        throw new Error('evaluateEmpiricalCoverage: invalid ledger scan');
    }
    if (!Number.isSafeInteger(min) || min < 1) throw new Error('evaluateEmpiricalCoverage: min must be a positive safe integer');
    const scanned = new Map<LedgerEntry, ScannedLedgerEntry>(scan.entries.map(item => [item.entry, item]));
    const typed = new Map<string, LedgerEntry[]>();
    const unclassified: LedgerEntry[] = [];
    for (const item of scan.entries) {
        if (item.entry.polarity !== 'finding') continue;
        if (item.entry.defectClass === undefined) unclassified.push(item.entry);
        else typed.set(item.entry.defectClass, [...(typed.get(item.entry.defectClass) ?? []), item.entry]);
    }
    const classes: EmpiricalClass[] = [];
    for (const [defectClass, entries] of [...typed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        for (const cluster of clusterEntries(entries, 1)) {
            const evidence = refsFor(cluster.entries, scanned);
            classes.push({ defectClass, occurrences: cluster.count, recurrent: cluster.count >= min,
                severity: maxSeverity(cluster.entries), outcome: outcomeFor(staticStates[defectClass], cluster.count > 0),
                evidenceRefs: evidence.refs, omittedEvidenceRefs: evidence.omitted });
        }
    }
    // Stable public order: class first, then items meeting the supplied recurrence
    // threshold, then count and evidence. This makes --min observable without
    // changing the static verdict or leaking private cluster signatures.
    classes.sort((a, b) => a.defectClass.localeCompare(b.defectClass) || Number(b.recurrent) - Number(a.recurrent) || b.occurrences - a.occurrences
        || a.evidenceRefs.join('\u0000').localeCompare(b.evidenceRefs.join('\u0000')));
    const unclassifiedEvidence = refsFor(unclassified, scanned);
    const retained = classes.reduce((total, item) => total + item.occurrences, 0) + unclassified.length;
    const skipped = scan.sources.skippedFindings > 0 || scan.omittedEvidenceRefs > 0 || unclassified.length > 0;
    return {
        recurrenceThreshold: min,
        status: retained === 0 ? (skipped ? 'inconclusive' : 'no-evidence') : (skipped ? 'partial' : 'evidence'),
        classes,
        unclassified: { occurrences: unclassified.length, evidenceRefs: unclassifiedEvidence.refs, omittedEvidenceRefs: unclassifiedEvidence.omitted },
        sources: { ...scan.sources, skippedByReason: { ...scan.sources.skippedByReason } },
        omittedEvidenceRefs: classes.reduce((total, item) => total + item.omittedEvidenceRefs, 0) + unclassifiedEvidence.omitted,
    };
}
