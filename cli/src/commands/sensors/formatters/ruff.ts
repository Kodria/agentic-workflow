import path from 'path';
import { SensorError } from '../types';

type RuffMessage = {
    code: string | null;
    filename: string;
    location: { row: number; column: number };
    message: string;
};

export function parseRuffOutput(raw: string): SensorError[] {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return []; }
    // Valid JSON syntax does not guarantee the expected shape — `{}`, `null`, `42` all
    // parse successfully but are not arrays, and an array element can itself be `null`
    // or missing the fields this parser reads. Guard both, or a well-formed-but-wrong
    // shape from `ruff --output-format=json` throws instead of degrading to [].
    if (!Array.isArray(parsed)) return [];
    const cwd = process.cwd();
    const errors: SensorError[] = [];
    for (const item of parsed as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const msg = item as Partial<RuffMessage>;
        if (typeof msg.filename !== 'string') continue;
        if (!msg.location || typeof msg.location !== 'object'
            || typeof msg.location.row !== 'number' || typeof msg.location.column !== 'number') continue;
        const rel = msg.filename.startsWith(cwd + path.sep)
            ? path.relative(cwd, msg.filename)
            : msg.filename;
        errors.push({
            file: rel,
            line: msg.location.row,
            column: msg.location.column,
            rule: msg.code ?? 'unknown',
            message: `SENSOR[lint] ${rel}:${msg.location.row} — ${msg.message ?? ''} Fix: check rule ${msg.code ?? 'unknown'}.`,
        });
    }
    return errors;
}
