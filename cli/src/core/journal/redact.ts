// Redacción EN EL EMISOR, antes de cualquier escritura (design R2.3).
// Patrones alineados con el sensor-pack de secretos del registry baseline.

const SECRET_WORD = /(password|passwd|secret|api[-_]?key|apikey|token|credential)/i;
const ASSIGNMENT = new RegExp(`([a-z0-9_-]{0,64}(?:password|passwd|secret|api[-_]?key|apikey|token|credential)[a-z0-9_-]*)(\\s*[=:]\\s*)(\\S+)`, 'gi');

// Distinto de SECRET_WORD (substring, para nombres de flag reales): aquí el
// keyword debe ser un segmento completo delimitado por -, _ o los bordes del
// string. Se usa SOLO dentro de redactArgv para decidir hasta dónde extender
// la redacción en cadena — nunca para decidir SI redactar: ver comentario en
// redactArgv sobre por qué la ambigüedad siempre se resuelve redactando de
// más, nunca de menos.
const SECRET_FLAG_SEGMENT = /(^|[-_])(password|passwd|secret|api[-_]?key|apikey|token|credential)($|[-_])/i;

function looksLikeSensitiveFlag(token: string): boolean {
    if (!token.startsWith('-')) return false;
    const eq = token.indexOf('=');
    const flag = eq === -1 ? token : token.slice(0, eq);
    return SECRET_FLAG_SEGMENT.test(flag.replace(/^-+/, ''));
}

export function redactText(text: string): string {
    return text.replace(ASSIGNMENT, (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`);
}

/** Flag sensible que porta un secreto LITERAL (no una referencia `-env`):
 *  la request se rechaza, no se persiste ni redactada (R2.3). Deliberadamente
 *  NO intenta distinguir "el siguiente token es un flag hermano" de "es el
 *  valor literal": el rechazo es todo-o-nada (emitRequest lanza antes de
 *  persistir nada), así que la ambigüedad nunca importa — cualquier token
 *  después de un flag sensible ya es motivo suficiente de rechazo.
 *
 *  LIMITACIÓN ACEPTADA (no es un bug pendiente): esta función solo reconoce
 *  secretos cuyo NOMBRE de flag contiene una palabra clave (password/token/
 *  secret/api-key/credential), sea con cualquier cantidad de guiones (-token, --token).
 *  Mnemónicos de una sola letra sin texto ninguno (ej. `-p` de mysql, `-i` de
 *  ssh, `-u` de curl) son indistinguibles de cualquier otro flag corto por
 *  texto solo — cerrar ese caso exigiría una tabla fija de convenciones por
 *  herramienta externa, que es enumeración no acotada y no pertenece a un
 *  mecanismo genérico (ver CLAUDE.md, frontera genérico/específico). Si esto
 *  resulta ser un problema real y recurrente en este proyecto, se resuelve
 *  vía harness-retro con una regla específica, no aquí. */
export function findLiteralSecretFlag(argv: string[]): string | null {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('-')) continue;
        const eq = arg.indexOf('=');
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
        if (!SECRET_WORD.test(flag)) continue;
        if (/-env$/i.test(flag)) continue;                 // referencia, permitida (R4.7)
        const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
        if (value !== undefined) return flag;
    }
    return null;
}

/** A diferencia de findLiteralSecretFlag (todo-o-nada), esta función SÍ debe
 *  devolver un array persistible — no puede simplemente rechazar. Cuando el
 *  token que sigue a un flag sensible también PARECE un flag sensible, es
 *  imposible distinguir por texto solo "es un flag hermano real" de "es el
 *  valor literal (adversario) del flag anterior disfrazado de flag" — ambas
 *  lecturas son indistinguibles sin un esquema de flags real (hallazgo de
 *  spec-review, R2.3). Ante esa ambigüedad se redacta TODA la cadena de
 *  tokens con forma de flag sensible más el token final que la cierra,
 *  nunca menos: sobre-redactar un nombre de flag es un costo cosmético,
 *  dejar pasar un secreto no lo es. */
export function redactArgv(argv: string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        const isSensitive = arg.startsWith('-') && SECRET_WORD.test(flag) && !/-env$/i.test(flag);
        if (!isSensitive) {
            out.push(redactText(arg));
            i++;
            continue;
        }
        if (eq !== -1) {
            out.push(`${flag}=[REDACTED]`);
            i++;
            continue;
        }
        out.push(arg);
        i++;
        while (i < argv.length && looksLikeSensitiveFlag(argv[i])) {
            out.push('[REDACTED]');
            i++;
        }
        if (i < argv.length) {
            out.push('[REDACTED]');
            i++;
        }
    }
    return out;
}
