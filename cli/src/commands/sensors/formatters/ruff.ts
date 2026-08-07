import path from 'path';
import { SensorError } from '../types';

type RuffMessage = {
    code: string | null;
    filename: string;
    location: { row: number; column: number };
    message: string;
};

export function parseRuffOutput(raw: string): SensorError[] {
    let parsed: RuffMessage[];
    try { parsed = JSON.parse(raw); } catch { return []; }
    const cwd = process.cwd();
    const errors: SensorError[] = [];
    for (const msg of parsed) {
        const rel = msg.filename.startsWith(cwd + path.sep)
            ? path.relative(cwd, msg.filename)
            : msg.filename;
        errors.push({
            file: rel,
            line: msg.location.row,
            column: msg.location.column,
            rule: msg.code ?? 'unknown',
            message: `SENSOR[lint] ${rel}:${msg.location.row} — ${msg.message} Fix: check rule ${msg.code ?? 'unknown'}.`,
        });
    }
    return errors;
}
