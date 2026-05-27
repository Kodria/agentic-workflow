import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SensorError } from './types';

const BASELINE_FILE = path.join('.awm', 'sensors.baseline.json');

/** Per-sensor list of accepted finding fingerprints. */
export type Baseline = Record<string, string[]>;

/**
 * Mask runs of digits so location noise embedded in messages (e.g. the tsc
 * formatter writes "... line 199 ...") doesn't change the fingerprint when code
 * shifts. Line/column fields are excluded from the fingerprint for the same reason.
 */
function maskNumbers(s: string): string {
    return s.replace(/\d+/g, '#');
}

/**
 * Identity of a finding, for matching against the accepted baseline.
 *
 * The basis deliberately EXCLUDES the human-readable message when a `rule` id is
 * present (every real sensor — eslint `ruleId`, tsc error code, semgrep
 * `check_id` — sets one). The message text is volatile: it changes with tool
 * version bumps and rule-config tweaks (e.g. adding `argsIgnorePattern` makes
 * eslint append "Allowed unused args must match ...").  When the message was
 * part of the basis, any such change re-fingerprinted every existing finding, so
 * the whole baseline silently went stale and reported hundreds of false "new"
 * findings. Keying on `sensor|file|rule` makes the baseline immune to wording
 * changes; occurrence counts (see `partition`) keep it precise.
 *
 * Findings without a rule (the generic formatter) fall back to the masked
 * message, preserving the previous behaviour for that case.
 */
export function fingerprint(sensor: string, e: SensorError): string {
    const basis = e.rule
        ? `${sensor}|${e.file ?? ''}|${e.rule}`
        : `${sensor}|${e.file ?? ''}|${maskNumbers(e.message)}`;
    return crypto.createHash('sha1').update(basis).digest('hex');
}

export function readBaseline(cwd: string): Baseline | null {
    const p = path.join(cwd, BASELINE_FILE);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

export function writeBaseline(cwd: string, baseline: Baseline): void {
    fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(cwd, BASELINE_FILE), JSON.stringify(baseline, null, 2), 'utf-8');
}

/**
 * Split a sensor's findings into new vs baseline-suppressed. With no accepted
 * set, every finding is new (backward-compatible: no baseline file → current behavior).
 */
export function partition(
    sensor: string,
    errors: SensorError[],
    accepted: string[] | undefined,
): { newErrors: SensorError[]; suppressed: number } {
    if (!accepted || accepted.length === 0) return { newErrors: errors, suppressed: 0 };
    // Count-based matching: the baseline holds one fingerprint per accepted
    // occurrence (duplicates allowed). A finding is suppressed only while there's
    // remaining "budget" for its fingerprint. This is what closes the gap left by
    // keying on `sensor|file|rule` alone — if a file had 3 accepted findings of a
    // rule and now has 5, the 2 extra are correctly reported as new.
    const remaining = new Map<string, number>();
    for (const fp of accepted) remaining.set(fp, (remaining.get(fp) ?? 0) + 1);
    const newErrors: SensorError[] = [];
    for (const e of errors) {
        const fp = fingerprint(sensor, e);
        const budget = remaining.get(fp) ?? 0;
        if (budget > 0) remaining.set(fp, budget - 1);
        else newErrors.push(e);
    }
    return { newErrors, suppressed: errors.length - newErrors.length };
}

/** Snapshot the current findings of a full run as the accepted baseline. */
export function buildBaseline(results: { name: string; errors: SensorError[] }[]): Baseline {
    const baseline: Baseline = {};
    for (const r of results) {
        baseline[r.name] = r.errors.map(e => fingerprint(r.name, e));
    }
    return baseline;
}
