import { cleanLine, type ListedChange, type ListedRecord, type ListResult } from './list';
import { clipMessage, isObj, sliceNoSplit } from './text-safety';

// The three renderings of `awm changes list` (R5.6). The result already holds clean values (list.ts escapes what git printed);
// the text and voice lines are cleaned again here, so each stays one line whatever a caller hands in. Nothing here throws.

const INVALID_TEXT = 'invalid-input: not a list result\n';
const MAX_VOICE_LINE = 600;
const MAX_TITLE = 200;

const usable = (r: unknown): r is ListResult => isObj(r) && Array.isArray(r.changes) && typeof r.base === 'string' && typeof r.since === 'string';
const count = (n: unknown): number => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);
const isValid = (r: ListedRecord): r is Extract<ListedRecord, { schema: string }> => isObj(r) && !('diagnostics' in r);
const clipVoice = (line: string): string => (line.length <= MAX_VOICE_LINE ? line : `${sliceNoSplit(line, MAX_VOICE_LINE - 1)}…`);

/** The repository name: the last segment of host/owner/name, else the fallback (the directory name). */
function repoName(result: ListResult, fallback: string): string {
    const last = typeof result.repo === 'string' ? result.repo.split('/').pop() : '';
    return cleanLine(last || fallback, 100);
}

export function renderJson(result: ListResult): string {
    try {
        if (!usable(result)) return '{"error":"invalid-input"}\n';
        const changes = result.changes.map((c: ListedChange) => ({ sha: c.sha, subject: c.subject, classification: c.classification, merged_at: c.merged_at, pr: c.pr, release: c.release, records: c.records }));
        return `${JSON.stringify({ repo: result.repo, base: result.base, since: result.since, adopted: result.adopted, truncated: result.truncated, omitted: result.omitted, changes })}\n`;
    } catch {
        return '{"error":"invalid-input"}\n';
    }
}

const header = ['WHEN'.padEnd(16), 'CLASSIFICATION'.padEnd(14), 'SHA'.padEnd(8), 'PR'.padEnd(6), 'CHANGE'].join('  ');

function textRow(c: ListedChange): string {
    const first = c.records[0];
    const title = first !== undefined && isValid(first) ? first.title : c.subject;
    // The first FAILING record of an invalid-record commit (the valid ones carry an empty diagnostics list).
    const failing = c.records.find((r) => Array.isArray((r as { diagnostics?: unknown }).diagnostics) && (r as { diagnostics: unknown[] }).diagnostics.length > 0);
    const diagnostic = failing !== undefined && !isValid(failing) ? failing.diagnostics[0] : undefined;
    const when = c.merged_at === null ? 'unknown' : String(c.merged_at).slice(0, 16).replace('T', ' ');
    const cells = [
        cleanLine(when, 16).padEnd(16),
        cleanLine(c.classification, 14).padEnd(14),
        cleanLine(String(c.sha).slice(0, 8), 8).padEnd(8),
        (c.pr === null ? '-' : cleanLine(`#${c.pr}`, 12)).padEnd(6),
        `${cleanLine(title, MAX_TITLE)}${c.release ? `  [${cleanLine(c.release, 255)}]` : ''}${diagnostic ? `  (${cleanLine(diagnostic.code, 64)})` : ''}`,
    ];
    return clipMessage(cells.join('  '));
}

export function renderText(result: ListResult, fallbackName: string): string {
    try {
        if (!usable(result)) return INVALID_TEXT;
        const name = repoName(result, fallbackName);
        const base = cleanLine(result.base, 255);
        if (result.adopted === false) return `${clipMessage(`${name} has not adopted Change Records (no file under docs/changes/ on ${base}).`)}\n`;
        if (result.changes.length === 0) return `${clipMessage(`No changes on ${base} since ${cleanLine(result.since, 40)}.`)}\n`;
        const lines = [clipMessage(header), ...result.changes.map(textRow)];
        if (result.truncated) lines.push(`... ${count(result.omitted)} older change(s) not shown; narrow --since to see them.`);
        return `${lines.join('\n')}\n`;
    } catch {
        return INVALID_TEXT;
    }
}

/** The summary as a sentence: it ends in one of . ! ? … (a period is added when it does not). */
function spoken(summary: string): string {
    const s = cleanLine(summary, 280);
    return s !== '' && '.!?…'.includes(s[s.length - 1]) ? s : `${s}.`;
}

function sentence(name: string, r: Extract<ListedRecord, { schema: string }>): string {
    const pending = Array.isArray(r.manual_validation) ? r.manual_validation.length : 0;
    const verified = isObj(r.verification) && r.verification.overall === 'pass' ? 'verificado' : 'sin verificar';
    return clipVoice(`${name}: ${spoken(r.summary_short)} ${cleanLine(r.type, 64)}, ${verified}, ${pending} validaciones manuales pendientes.`);
}

export function renderVoice(result: ListResult, fallbackName: string): string {
    try {
        if (!usable(result)) return INVALID_TEXT;
        const name = repoName(result, fallbackName);
        if (result.adopted === false) return `${clipVoice(`${name}: todavía no usa Change Records.`)}\n`;
        if (result.changes.length === 0) return `${clipVoice(`${name}: sin cambios desde ${cleanLine(result.since.slice(0, 10), 10)}.`)}\n`;
        const lines: string[] = [];
        for (const c of result.changes) {
            if (c.classification !== 'recorded') continue;
            for (const r of c.records) if (isValid(r)) lines.push(sentence(name, r));
        }
        const missing = result.changes.filter((c) => c.classification === 'missing').length;
        const invalid = result.changes.filter((c) => c.classification === 'invalid-record').length;
        lines.push(`Además: ${missing} cambio(s) sin record y ${invalid} con record inválido.`);
        if (result.truncated) lines.push(`Hay ${count(result.omitted)} cambio(s) más antiguo(s) sin mostrar; acota el período.`);
        return `${lines.join('\n')}\n`;
    } catch {
        return INVALID_TEXT;
    }
}
