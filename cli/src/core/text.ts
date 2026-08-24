// cli/src/core/text.ts
/** Neutraliza bytes de control C0 (incluyendo ESC `\x1b`) y DEL de texto que
 *  proviene de un registry no confiable antes de escribirlo a una terminal
 *  humana. `\n` y `\t` se preservan porque son whitespace legítimo.
 *
 *  Vive en core/ y no dentro de un comando porque tiene DOS consumidores:
 *  `awm process show` (vista de texto del modelo) y `awm context orchestrators`
 *  (campos declarados por un registry). Duplicarlo es la forma exacta que
 *  `AGENTS.md` documenta bajo `defensive-guard-consistency`: endurecer una copia
 *  y dejar la otra atrás. */
export function stripControlChars(text: string): string {
    // eslint-disable-next-line no-control-regex -- necesitamos matchear C0 deliberadamente
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
