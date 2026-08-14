import { clusterEntries } from '../../../core/ledger/cluster';
import type { ClusterKind } from '../../../core/ledger/cluster';
import type { LedgerEntry, Severity } from '../../../core/ledger/types';
import type { LedgerScanResult, ScannedLedgerEntry } from '../../../core/ledger/scan';
import type { CoverageClassStatus } from './evaluate';

export type EmpiricalOutcome = 'covered-by-sensor' | 'gap' | 'coverage-unverifiable' | 'applicability-contradiction' | 'unmapped-class';
export type EmpiricalStaticState = CoverageClassStatus | 'incompatible' | 'missing-tool' | 'compatible-unverified';
export type EmpiricalStaticAvailability = 'available' | 'unavailable';

export type EmpiricalCluster = {
    occurrences: number;
    recurrent: boolean;
    severity: Severity;
    kind: ClusterKind;
    /** Only signatures that satisfy the same public-reference allowlist. */
    signatures: string[];
    /** Distinct cluster signatures withheld because they are not public-safe. */
    omittedSignatures: number;
    evidenceRefs: string[];
    omittedEvidenceRefs: number;
};

export type EmpiricalClass = {
    defectClass: string;
    occurrences: number;
    recurrent: boolean;
    severity: Severity;
    outcome: EmpiricalOutcome;
    evidenceRefs: string[];
    omittedEvidenceRefs: number;
    /** Deterministic exact/convergent grouping retained without private ledger text. */
    clusters: EmpiricalCluster[];
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
        if (!scannedEntry || scannedEntry.evidenceRef === null) continue;
        const ref = safeRef(scannedEntry.evidenceRef);
        if (ref === null) omitted += 1;
        else refs.add(ref);
    }
    return { refs: [...refs].sort((a, b) => a.localeCompare(b)), omitted };
}

function signaturesFor(signatures: readonly string[]): { signatures: string[]; omitted: number } {
    const safe = new Set<string>();
    let omitted = 0;
    for (const signature of signatures) {
        const publicSignature = safeRef(signature);
        if (publicSignature === null) omitted += 1;
        else safe.add(publicSignature);
    }
    return { signatures: [...safe].sort((a, b) => a.localeCompare(b)), omitted };
}

function maxSeverity(entries: LedgerEntry[]): Severity {
    return entries.reduce<Severity>((best, entry) => severityRank[entry.severity] > severityRank[best] ? entry.severity : best, 'info');
}

export function outcomeFor(
    staticState: EmpiricalStaticState | undefined,
    hasEvidence: boolean,
    staticAvailability: EmpiricalStaticAvailability = 'available',
): EmpiricalOutcome {
    if (typeof hasEvidence !== 'boolean') throw new Error('outcomeFor: hasEvidence must be boolean');
    if (staticAvailability !== 'available' && staticAvailability !== 'unavailable') throw new Error('outcomeFor: invalid static availability');
    if (staticAvailability === 'unavailable') return 'coverage-unverifiable';
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
export function evaluateEmpiricalCoverage(
    scan: LedgerScanResult,
    staticStates: Readonly<Record<string, EmpiricalStaticState>>,
    min: number,
    staticAvailability: EmpiricalStaticAvailability = 'available',
): EmpiricalCoverage {
    if (!scan || typeof scan !== 'object' || !Array.isArray(scan.entries) || !scan.sources || typeof scan.omittedEvidenceRefs !== 'number') {
        throw new Error('evaluateEmpiricalCoverage: invalid ledger scan');
    }
    if (!Number.isSafeInteger(min) || min < 1) throw new Error('evaluateEmpiricalCoverage: min must be a positive safe integer');
    if (staticAvailability !== 'available' && staticAvailability !== 'unavailable') throw new Error('evaluateEmpiricalCoverage: invalid static availability');
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
        const evidence = refsFor(entries, scanned);
        const clusters = clusterEntries(entries, 1).map((cluster) => {
            const signatures = signaturesFor(cluster.signatures);
            const clusterEvidence = refsFor(cluster.entries, scanned);
            return {
                occurrences: cluster.count,
                recurrent: cluster.count >= min,
                severity: maxSeverity(cluster.entries),
                kind: cluster.kind,
                signatures: signatures.signatures,
                omittedSignatures: signatures.omitted,
                evidenceRefs: clusterEvidence.refs,
                omittedEvidenceRefs: clusterEvidence.omitted,
            };
        });
        classes.push({ defectClass, occurrences: entries.length, recurrent: clusters.some((cluster) => cluster.recurrent),
            severity: maxSeverity(entries), outcome: outcomeFor(staticStates[defectClass], entries.length > 0, staticAvailability),
            evidenceRefs: evidence.refs, omittedEvidenceRefs: evidence.omitted, clusters });
    }
    // Stable public order: recurrence emphasis, count, then class ID. The
    // cluster helper already supplies its own deterministic inner ordering.
    classes.sort((a, b) => Number(b.recurrent) - Number(a.recurrent) || b.occurrences - a.occurrences
        || a.defectClass.localeCompare(b.defectClass));
    const unclassifiedEvidence = refsFor(unclassified, scanned);
    const retained = classes.reduce((total, item) => total + item.occurrences, 0) + unclassified.length;
    const omittedEvidenceRefs = scan.omittedEvidenceRefs
        + classes.reduce((total, item) => total + item.omittedEvidenceRefs, 0)
        + unclassifiedEvidence.omitted;
    const skipped = scan.sources.skippedFindings > 0 || omittedEvidenceRefs > 0 || unclassified.length > 0;
    return {
        recurrenceThreshold: min,
        status: retained === 0 ? (skipped ? 'inconclusive' : 'no-evidence') : (skipped ? 'partial' : 'evidence'),
        classes,
        unclassified: { occurrences: unclassified.length, evidenceRefs: unclassifiedEvidence.refs, omittedEvidenceRefs: unclassifiedEvidence.omitted },
        sources: { ...scan.sources, skippedByReason: { ...scan.sources.skippedByReason } },
        omittedEvidenceRefs,
    };
}
