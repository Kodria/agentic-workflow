import { SensorError } from '../types';

type ShellcheckMessage = {
    file: string;
    line: number;
    column: number;
    level: 'error' | 'warning' | 'info' | 'style';
    code: number;
    message: string;
};

// shellcheck's own levels, from most to least severe: error, warning, info, style.
// `info`/`style` are advisory — quoting preferences, portability nits — not genuine
// problems (mirrors eslint.ts's `severity < 2` filter, which drops eslint's "warn" the
// same way: findings should be real breakage, not 100% of the tool's advisory noise).
// Only `error`/`warning` are reported as SensorErrors.
const FAILING_LEVELS = new Set(['error', 'warning']);

export function parseShellcheckOutput(raw: string): SensorError[] {
    let parsed: ShellcheckMessage[];
    try { parsed = JSON.parse(raw); } catch { return []; }
    const errors: SensorError[] = [];
    for (const msg of parsed) {
        if (!FAILING_LEVELS.has(msg.level)) continue;
        const rule = `SC${msg.code}`;
        errors.push({
            file: msg.file,
            line: msg.line,
            column: msg.column,
            rule,
            message: `SENSOR[lint] ${msg.file}:${msg.line} — ${msg.message} Fix: see https://www.shellcheck.net/wiki/${rule}.`,
        });
    }
    return errors;
}
