// Redacción EN EL EMISOR, antes de cualquier escritura (design R2.3).
// Patrones alineados con el sensor-pack de secretos del registry baseline.

const SECRET_WORD = /(password|passwd|secret|api[-_]?key|apikey|token|credential)/i;
const ASSIGNMENT = new RegExp(`([a-z0-9_-]*(?:password|passwd|secret|api[-_]?key|apikey|token|credential)[a-z0-9_-]*)(\\s*[=:]\\s*)(\\S+)`, 'gi');

export function redactText(text: string): string {
    return text.replace(ASSIGNMENT, (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`);
}

// Distinto de SECRET_WORD (substring, para nombres de flag reales): aquí el
// keyword debe ser un segmento completo delimitado por -, _ o los bordes del
// string — así un valor literal que solo CONTIENE la palabra como substring
// (ej. "abc123secretvalue") no se confunde con un flag hermano real.
const SECRET_FLAG_SEGMENT = /(^|[-_])(password|passwd|secret|api[-_]?key|apikey|token|credential)($|[-_])/i;

function isSensitiveFlagToken(token: string | undefined): boolean {
    if (token === undefined || !token.startsWith('--')) return false;
    const eq = token.indexOf('=');
    const flag = eq === -1 ? token : token.slice(0, eq);
    return SECRET_FLAG_SEGMENT.test(flag.slice(2));
}

/** Flag sensible que porta un secreto LITERAL (no una referencia `-env`):
 *  la request se rechaza, no se persiste ni redactada (R2.3). */
export function findLiteralSecretFlag(argv: string[]): string | null {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const eq = arg.indexOf('=');
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
        if (!SECRET_WORD.test(flag)) continue;
        if (/-env$/i.test(flag)) continue;                 // referencia, permitida (R4.7)
        if (inlineValue !== undefined) return flag;
        const next = argv[i + 1];
        if (next !== undefined && !isSensitiveFlagToken(next)) return flag;
    }
    return null;
}

export function redactArgv(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        if (arg.startsWith('--') && SECRET_WORD.test(flag) && !/-env$/i.test(flag)) {
            if (eq !== -1) { out.push(`${flag}=[REDACTED]`); continue; }
            out.push(arg);
            const next = argv[i + 1];
            if (next !== undefined && !isSensitiveFlagToken(next)) { out.push('[REDACTED]'); i++; }
            continue;
        }
        out.push(redactText(arg));
    }
    return out;
}
