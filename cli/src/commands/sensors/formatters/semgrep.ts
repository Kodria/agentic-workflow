import { SensorError } from '../types';

type SemgrepResult = { check_id: string; path: string; start: { line: number }; extra: { message: string } };
type SemgrepOutput = { results: SemgrepResult[] };

export function parseSemgrepOutput(raw: string): SensorError[] {
    let parsed: SemgrepOutput;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    return (parsed.results ?? []).map(r => ({
        file: r.path,
        line: r.start?.line ?? 0,
        rule: r.check_id,
        message: `SENSOR[security] ${r.path}:${r.start?.line ?? '?'} — ${r.extra?.message ?? 'unknown'} Fix: review rule ${r.check_id}.`,
    }));
}
