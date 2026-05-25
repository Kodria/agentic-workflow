import { SensorError } from '../types';

type EslintMessage = { ruleId: string | null; severity: number; message: string; line: number; column: number; };
type EslintFile = { filePath: string; messages: EslintMessage[]; };

export function parseEslintOutput(raw: string): SensorError[] {
    let parsed: EslintFile[];
    try { parsed = JSON.parse(raw); } catch { return []; }
    const errors: SensorError[] = [];
    const cwd = process.cwd();
    for (const file of parsed) {
        for (const msg of file.messages) {
            if (msg.severity < 2 || msg.line == null || msg.column == null) continue;
            const rel = file.filePath.startsWith(cwd + '/') ? file.filePath.slice(cwd.length + 1) : file.filePath;
            errors.push({
                file: rel,
                line: msg.line,
                column: msg.column,
                rule: msg.ruleId ?? 'unknown',
                message: `SENSOR[lint] ${rel}:${msg.line} — ${msg.message} Fix: check rule ${msg.ruleId ?? 'unknown'}.`,
            });
        }
    }
    return errors;
}
