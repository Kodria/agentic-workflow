import fs from 'fs';
import path from 'path';
import { parseLedgerEntry } from './types';
import type { LedgerEntry, LedgerParseReason } from './types';

export interface LedgerScanLimits {
    maxFiles: number;
    maxFileBytes: number;
    maxEntries: number;
    maxLineBytes: number;
    maxJsonDepth: number;
    maxRefsPerClass: number;
}

export const DEFAULT_LEDGER_SCAN_LIMITS: LedgerScanLimits = {
    maxFiles: 256,
    maxFileBytes: 4 * 1024 * 1024,
    maxEntries: 20_000,
    maxLineBytes: 64 * 1024,
    maxJsonDepth: 16,
    maxRefsPerClass: 128,
};

export type LedgerScanReason = LedgerParseReason | 'invalid-json' | 'line-too-large' | 'json-too-deep'
    | 'symlink-entry' | 'nonregular-entry' | 'path-escape' | 'file-too-large' | 'file-limit' | 'entry-limit'
    | 'evidence-ref-limit';

export interface ScannedLedgerEntry {
    entry: LedgerEntry;
    source: string;
    /** Safe relative reference available to renderers, or null once its class is bounded. */
    evidenceRef: string | null;
}

export interface LedgerScanSources {
    activeFiles: number;
    archivedFiles: number;
    validEntries: number;
    validFindings: number;
    skippedFindings: number;
    skippedByReason: Partial<Record<LedgerScanReason, number>>;
}

export interface LedgerScanResult {
    entries: ScannedLedgerEntry[];
    sources: LedgerScanSources;
    /** Number of valid findings retained for analysis but omitted from rendered evidence. */
    omittedEvidenceRefs: number;
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertDirectoryInside(root: string, directory: string): boolean {
    if (!fs.existsSync(directory)) return false;
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`ledger directory is unsafe: ${directory}`);
    return isWithin(root, fs.realpathSync(directory));
}

function isJsonDepthWithinLimit(raw: string, maxDepth: number): boolean {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (const char of raw) {
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') quoted = true;
        else if (char === '{' || char === '[') {
            depth += 1;
            if (depth > maxDepth) return false;
        } else if (char === '}' || char === ']') depth -= 1;
    }
    return true;
}

function boundedLimits(overrides: Partial<LedgerScanLimits>): LedgerScanLimits {
    if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new Error('ledger scan limits must be an object');
    }
    const limits = { ...DEFAULT_LEDGER_SCAN_LIMITS, ...overrides };
    for (const value of Object.values(limits)) {
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('ledger scan limits must be positive safe integers');
    }
    return limits;
}

function relativeSource(root: string, target: string, line: number): string {
    return `${relativePath(root, target)}:${line}`;
}

function relativePath(root: string, target: string): string {
    return path.relative(root, target).split(path.sep).join('/');
}

interface LedgerCandidate {
    isArchive: boolean;
    target: string;
    sourcePath: string;
}

function compareCandidates(a: LedgerCandidate, b: LedgerCandidate): number {
    return a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0;
}

/**
 * Reads one global bounded window across the direct ledger directories, then
 * sorts only the retained candidates. This deliberately does not claim to
 * find a globally lexical prefix in an unbounded directory: the extra
 * candidate is a truncation witness, and no later candidate is opened or
 * retained from either active or archive storage.
 */
function collectBoundedCandidates(
    root: string,
    directories: Array<{ directory: string; archive: boolean }>,
    maxFiles: number,
): { candidates: LedgerCandidate[]; truncated: boolean } {
    const candidates: LedgerCandidate[] = [];
    const capacity = maxFiles + 1;
    let truncated = false;
    for (const { directory, archive } of directories) {
        if (candidates.length >= capacity) break;
        const handle = fs.opendirSync(directory);
        try {
            let item: fs.Dirent | null;
            while ((item = handle.readSync()) !== null) {
                if (!item.name.endsWith('.jsonl')) continue;
                const target = path.join(directory, item.name);
                candidates.push({ isArchive: archive, target, sourcePath: relativePath(root, target) });
                if (candidates.length === capacity) {
                    truncated = true;
                    break;
                }
            }
        } finally {
            handle.closeSync();
        }
    }
    candidates.sort(compareCandidates);
    return { candidates, truncated: truncated || candidates.length > maxFiles };
}

/** Reads only direct .jsonl children of active/archive ledger roots; never follows links. */
export function scanProjectLedgers(projectRoot: string, overrides: Partial<LedgerScanLimits> = {}): LedgerScanResult {
    if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('projectRoot must be an absolute path');
    const limits = boundedLimits(overrides);
    const root = fs.realpathSync(projectRoot);
    const ledgerRoot = path.join(root, '.awm', 'ledger');
    const sources: LedgerScanSources = {
        activeFiles: 0, archivedFiles: 0, validEntries: 0, validFindings: 0, skippedFindings: 0, skippedByReason: {},
    };
    const entries: ScannedLedgerEntry[] = [];
    const skip = (reason: LedgerScanReason): void => {
        sources.skippedFindings += 1;
        sources.skippedByReason[reason] = (sources.skippedByReason[reason] ?? 0) + 1;
    };
    if (!fs.existsSync(ledgerRoot)) return { entries, sources, omittedEvidenceRefs: 0 };
    if (!assertDirectoryInside(root, path.join(root, '.awm')) || !assertDirectoryInside(root, ledgerRoot)) {
        throw new Error('ledger directory escapes project root');
    }
    const directories: Array<{ directory: string; archive: boolean }> = [{ directory: ledgerRoot, archive: false }];
    const archive = path.join(ledgerRoot, 'archive');
    if (fs.existsSync(archive)) {
        if (!assertDirectoryInside(root, archive)) throw new Error('ledger archive directory escapes project root');
        directories.push({ directory: archive, archive: true });
    }
    let filesSeen = 0;
    let linesSeen = 0;
    let entryLimitReached = false;
    let omittedEvidenceRefs = 0;
    const evidenceRefsByClass = new Map<string, number>();
    const collected = collectBoundedCandidates(root, directories, limits.maxFiles);
    for (const { isArchive, target } of collected.candidates.slice(0, limits.maxFiles)) {
        if (entryLimitReached) break;
        filesSeen += 1;
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink()) { skip('symlink-entry'); continue; }
        if (!stat.isFile()) { skip('nonregular-entry'); continue; }
        const real = fs.realpathSync(target);
        if (!isWithin(root, real)) { skip('path-escape'); continue; }
        if (stat.size > limits.maxFileBytes) { skip('file-too-large'); continue; }
        if (isArchive) sources.archivedFiles += 1;
        else sources.activeFiles += 1;
        const lines = fs.readFileSync(target, 'utf-8').split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const raw = lines[index];
            if (!raw.trim()) continue;
            if (linesSeen >= limits.maxEntries) {
                skip('entry-limit');
                entryLimitReached = true;
                break;
            }
            linesSeen += 1;
            if (Buffer.byteLength(raw, 'utf-8') > limits.maxLineBytes) { skip('line-too-large'); continue; }
            if (!isJsonDepthWithinLimit(raw, limits.maxJsonDepth)) { skip('json-too-deep'); continue; }
            let value: unknown;
            try { value = JSON.parse(raw); } catch { skip('invalid-json'); continue; }
            const source = relativeSource(root, target, index + 1);
            const parsed = parseLedgerEntry(value, source);
            if (!parsed.ok) { skip(parsed.reason); continue; }
            sources.validEntries += 1;
            if (parsed.entry.polarity === 'finding') {
                sources.validFindings += 1;
                const defectClass = parsed.entry.defectClass ?? 'unclassified';
                const count = evidenceRefsByClass.get(defectClass) ?? 0;
                const evidenceRef = count < limits.maxRefsPerClass ? source : null;
                if (evidenceRef === null) {
                    omittedEvidenceRefs += 1;
                    // The finding remains available for recurrence analysis, but
                    // its public evidence is deliberately omitted. Record the
                    // truncation through the same typed source contract as every
                    // other scan bound so downstream renderers cannot call it a
                    // complete report.
                    skip('evidence-ref-limit');
                }
                else evidenceRefsByClass.set(defectClass, count + 1);
                entries.push({ entry: parsed.entry, source, evidenceRef });
            }
        }
    }
    if (!entryLimitReached && collected.truncated) skip('file-limit');
    return { entries, sources, omittedEvidenceRefs };
}
