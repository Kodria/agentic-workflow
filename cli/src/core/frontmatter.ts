// src/core/frontmatter.ts
//
// Modulo HOJA: sin imports. Es la unica fuente de verdad para leer el
// frontmatter YAML de un artefacto (SKILL.md, agents/*.md, workflows/*.md).
//
// Por que hoja: sus consumidores incluyen `core/export/transform.ts`, que se
// documenta como funcion pura string -> string sin dependencias. Si esto
// viviera en `discovery.ts` (que importa `registries.ts`, y este a su vez
// resuelve `awmHome()` y carga `simple-git` en tiempo de import), un modulo
// puro terminaria arrastrando la capa de fs/git por transitividad.
//
// Por que existe: el frontmatter se parseaba a mano en CUATRO lugares, cada
// uno con su propia copia incompleta. Un block scalar YAML valido
// (`description: >-`, con el texto en las lineas indentadas siguientes)
// degradaba en silencio en discovery, crasheaba `awm add -a cursor|copilot`,
// abortaba `awm export <bundle>` entero y rompia `awm add -a codex`. La
// semantica de aca se verifica contra js-yaml (parser real) en
// tests/core/frontmatter-description-vs-yaml.test.ts — no contra valores
// esperados escritos a mano, que pueden envejecer hacia la expectativa
// equivocada.

/** Texto crudo del frontmatter (entre los delimitadores `---`), o null si el
 *  bloque falta o esta mal formado. Tolera CRLF. */
export function matchFrontmatterBlock(raw: string): string | null {
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return fmMatch ? fmMatch[1] : null;
}

/** Indicador de block scalar en la linea de la clave: estilo (`>` folded /
 *  `|` literal) + chomping opcional (`-`/`+`) + indentacion explicita opcional
 *  + comentario final opcional. Detalles verificados contra js-yaml:
 *   - la indentacion explicita es UN digito 1-9 (ni `0` ni `10`);
 *   - `>- # nota` es valido y su bloque se lee normal;
 *   - `>-basura` NO es valido y aca tampoco matchea. */
const BLOCK_SCALAR_HEADER = /^([>|])(?:([+-])?([1-9])?|([1-9])?([+-])?)(?:\s+#.*)?$/;

/** ¿El valor de la linea de la clave es un indicador de block scalar?
 *  Cualquier caller que RAMIFIQUE sobre "esto es un bloque" debe usar esta
 *  funcion, nunca una aproximacion propia: una guarda por prefijo (`/^[>|]/`)
 *  y un resolver por match completo se desincronizan, y en ese hueco el
 *  escritor borro contenido real creyendo que resolvia un bloque. */
export function isBlockScalarHeader(value: string): boolean {
    return BLOCK_SCALAR_HEADER.test(value.trim());
}

/** Resultado de localizar `description:` dentro de un frontmatter. */
export interface DescriptionField {
    /** Valor ya resuelto (bloque plegado, comillas desescapadas, comentario removido). */
    value: string;
    /** Indice de la linea de la clave, o -1 si no hay `description:`. */
    startLine: number;
    /** Indice de la ULTIMA linea que ocupa el campo (== startLine si es de una sola linea).
     *  Un escritor que reemplace el campo debe reemplazar startLine..endLine COMPLETO:
     *  tocar solo la linea de la clave deja huerfanas las lineas de continuacion. */
    endLine: number;
}

/** Indice de la comilla que CIERRA el escalar que empieza en la posicion 0, o
 *  -1 si no cierra. Cada estilo escapa distinto: en single-quoted un `''` es
 *  un apostrofe literal (no un cierre); en double-quoted un `\"` es una
 *  comilla literal. */
function findClosingQuote(value: string, quote: string): number {
    for (let i = 1; i < value.length; i++) {
        if (quote === '"' && value[i] === '\\') { i++; continue; }
        if (value[i] !== quote) continue;
        if (quote === "'" && value[i + 1] === "'") { i++; continue; }
        return i;
    }
    return -1;
}

function foldBlock(stripped: string[], isLiteral: boolean): string {
    if (isLiteral) return stripped.join('\n').trim();
    // Folded (`>`): las lineas al nivel base del bloque se pliegan entre si con
    // UN espacio; una linea MAS indentada no se pliega (conserva su salto y su
    // sangria — la regla que permite incrustar una lista dentro de un folded);
    // y k lineas en blanco consecutivas producen k saltos de linea.
    // Ojo: NO se hace trim por linea — YAML conserva los espacios finales de
    // cada linea y el plegado agrega el suyo encima.
    let out = '';
    let prevLiteral = false;
    let started = false;
    let blanks = 0;
    for (const line of stripped) {
        if (line === '') { blanks++; continue; }
        const literal = /^[ \t]/.test(line);
        if (!started) { out = line; started = true; prevLiteral = literal; blanks = 0; continue; }
        if (blanks > 0) { out += '\n'.repeat(blanks); blanks = 0; }
        else if (literal || prevLiteral) out += '\n';
        else out += ' ';
        out += line;
        prevLiteral = literal;
    }
    return out.trim();
}

/**
 * Localiza y RESUELVE el campo `description` de un bloque de frontmatter,
 * devolviendo tambien la extension exacta que ocupa (para que un escritor
 * pueda reemplazarlo entero).
 *
 * Formas soportadas, todas contrastadas contra js-yaml: escalar plano (de una
 * o varias lineas), escalar entrecomillado (simple y doble, con su escape
 * propio deshecho), y block scalar folded/literal con chomping e indentacion
 * explicita.
 */
export function findFrontmatterDescription(frontmatter: string): DescriptionField {
    const lines = frontmatter.split(/\r?\n/);
    // Ancla en COLUMNA 0 a proposito: `description` en un frontmatter es
    // siempre clave de nivel superior. Un `^\s*` haria ganar a un
    // `description:` INDENTADO — anidado en otro mapa, o una linea de
    // CONTENIDO de otro block scalar que casualmente empiece asi.
    const startLine = lines.findIndex((l) => /^description\s*:/.test(l));
    if (startLine === -1) return { value: '', startLine: -1, endLine: -1 };

    const raw = lines[startLine].replace(/^description\s*:/, '').trim();

    if (isBlockScalarHeader(raw)) {
        const isLiteral = raw.trim().startsWith('|');
        // El bloque son las lineas ESTRICTAMENTE indentadas respecto de la
        // clave (columna 0). Las lineas en blanco no lo cortan: pertenecen a el.
        const block: string[] = [];
        let last = startLine;
        for (let i = startLine + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') { block.push(lines[i]); continue; }
            if (!/^[ \t]/.test(lines[i])) break;
            block.push(lines[i]);
            last = i;
        }
        while (block.length > 0 && block[block.length - 1].trim() === '') block.pop();
        const first = block.find((l) => l.trim() !== '');
        if (first === undefined) return { value: '', startLine, endLine: startLine };

        const declared = raw.match(/[1-9]/);
        const blockIndent = declared !== null ? Number(declared[0]) : first.match(/^[ \t]*/)![0].length;
        // Una linea con MENOS indentacion que el bloque es YAML invalido
        // (js-yaml lanza "bad indentation"). Cortar a ciegas con slice()
        // comeria caracteres reales: preferimos no inventar un valor.
        if (block.some((l) => l.trim() !== '' && l.match(/^[ \t]*/)![0].length < blockIndent)) {
            return { value: '', startLine, endLine: last };
        }
        const stripped = block.map((l) => l.slice(blockIndent));
        return { value: foldBlock(stripped, isLiteral), startLine, endLine: last };
    }

    // Empieza con `>`/`|` pero NO es un indicador bien formado (`>0`, `>12`,
    // `>-basura`): YAML lo rechaza. Devolver '' hace que los consumidores
    // fallen fuerte (throw en parseSkillSource / claudeAiTransform) en vez de
    // caer al camino de escalar plano de abajo, que publicaria el indicador
    // mismo como si fuera la descripcion.
    if (/^[>|]/.test(raw)) return { value: '', startLine, endLine: startLine };

    // Continuacion multilinea. Aplica a DOS formas, y ambas la necesitan:
    //  - escalar plano (`description: primera` + lineas indentadas), que YAML
    //    pliega con espacios igual que un `>`;
    //  - escalar ENTRECOMILLADO cuya comilla de cierre esta en una linea
    //    posterior (`description: "hola` / `  mundo"`), que sin esto devolvia
    //    `"hola` — con la comilla de apertura pegada — como descripcion.
    // Sin juntar las lineas primero, del lado escritor ademas quedaban
    // huerfanas en la salida exportada.
    let endLine = startLine;
    let value = raw;
    const opensUnclosedQuote = /^['"]/.test(raw) && findClosingQuote(raw, raw[0]) === -1;
    if (raw !== '' && (!/^['"]/.test(raw) || opensUnclosedQuote)) {
        const cont: string[] = [];
        for (let i = startLine + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') break;
            if (!/^[ \t]/.test(lines[i])) break;
            cont.push(lines[i].trim());
            endLine = i;
        }
        if (cont.length > 0) value = [raw, ...cont].join(' ');
    }

    // Escalares entrecomillados. Dos cosas que no alcanzan por separado:
    //  1. Hay que ENCONTRAR la comilla de cierre real antes de mirar el resto:
    //     lo que sigue a esa comilla es un comentario, no parte del valor.
    //     Comparar con `endsWith` fallaba justo cuando habia comentario
    //     (`description: "x" # nota` devolvia `"x"` CON las comillas literales,
    //     mientras js-yaml devuelve `x`).
    //  2. Hay que deshacer el escape propio de cada estilo: single-quoted
    //     duplica el apostrofe (`''`); double-quoted es superset de la string
    //     JSON, asi que JSON.parse resuelve \n, \t, \", \\ y \uXXXX.
    const quote = value[0];
    if (quote === "'" || quote === '"') {
        const close = findClosingQuote(value, quote);
        if (close !== -1) {
            const scalar = value.slice(0, close + 1);
            if (quote === "'") {
                return { value: scalar.slice(1, -1).replace(/''/g, "'").trim(), startLine, endLine };
            }
            try { return { value: String(JSON.parse(scalar)).trim(), startLine, endLine }; }
            catch { return { value: scalar.slice(1, -1).trim(), startLine, endLine }; }
        }
    }
    // Escalar plano: un `#` PRECEDIDO DE ESPACIO abre un comentario y no forma
    // parte del valor (un `#` pegado a texto, como en `C#`, si). Dentro de
    // comillas el `#` es literal, y esas ramas ya retornaron.
    return { value: value.replace(/\s+#.*$/, '').trim(), startLine, endLine };
}

/** Azucar para el caso comun: solo el valor resuelto de `description`. */
export function readFrontmatterDescription(frontmatter: string): string {
    return findFrontmatterDescription(frontmatter).value;
}
