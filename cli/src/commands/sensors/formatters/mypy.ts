import { SensorError } from '../types';

// mypy's plain-text output (no --output json flag in this pack's defaultCmd), one
// finding per line: `file:line: error: message  [code]`. The `[code]` suffix is
// separated from the message by two spaces and is OPTIONAL — some mypy error kinds
// omit it. No column: this pack's defaultCmd has no --show-column-numbers.
//
// Deliberately excluded, not matched by this pattern:
//   - `note:` lines (e.g. `reveal_type` output, supplementary context) — not failures.
//   - the trailing summary line (`Found N errors in M files…` / `Success: …`).
const MYPY_LINE = /^(.+):(\d+): error: (.*?)(?:  \[(\S+)\])?$/;

export function parseMypyOutput(raw: string): SensorError[] {
    const errors: SensorError[] = [];
    for (const line of raw.split('\n')) {
        if (!line) continue;
        const m = MYPY_LINE.exec(line);
        if (!m) continue;
        const [, file, lineStr, msg, code] = m;
        errors.push({
            file,
            line: parseInt(lineStr, 10),
            rule: code,
            message: `SENSOR[typecheck] ${file}:${lineStr} — ${msg} Fix: review the type annotation. Error code: ${code ?? 'n/a'}.`,
        });
    }
    return errors;
}
