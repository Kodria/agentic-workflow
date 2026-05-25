import { SensorError } from '../types';

const TSC_LINE = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

export function parseTscOutput(raw: string): SensorError[] {
    const errors: SensorError[] = [];
    for (const line of raw.split('\n')) {
        if (!line) continue;
        const m = TSC_LINE.exec(line);
        if (!m) continue;
        const [, file, lineStr, colStr, code, msg] = m;
        errors.push({
            file,
            line: parseInt(lineStr, 10),
            column: parseInt(colStr, 10),
            rule: code,
            message: `SENSOR[typecheck] ${file} line ${lineStr} — ${msg} Fix: review the type annotation. Error code: ${code}.`,
        });
    }
    return errors;
}
