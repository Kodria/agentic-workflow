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

export function fingerprint(sensor: string, e: SensorError): string {
    const basis = `${sensor}|${e.file ?? ''}|${e.rule ?? ''}|${maskNumbers(e.message)}`;
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
    const set = new Set(accepted);
    const newErrors = errors.filter(e => !set.has(fingerprint(sensor, e)));
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
