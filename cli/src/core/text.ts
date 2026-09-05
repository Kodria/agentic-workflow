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

/** Keeps an untrusted diagnostic field on one terminal line, without changing
 * the whitespace policy for multiline public text or composed markdown. */
export function sanitizeDiagnosticText(text: string): string {
    // eslint-disable-next-line no-control-regex -- remove all C0/C1 controls, including terminal escape bytes
    return text.replace(/\r\n|[\r\n\t\u2028\u2029]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

/**
 * Neutraliza marcado markdown (colapsa `\r?\n` a un espacio y quita
 * `` ` * _ # < > ``) de contenido no confiable antes de interpolarlo en un
 * bloque markdown. Sin esto, un registry malicioso/comprometido podria
 * inyectar saltos de linea, marcadores markdown o pseudo-tags XML/HTML para
 * forjar una seccion nueva o un bloque instruccional dentro del payload de
 * contexto que consume el proveedor de IA — un vector de prompt-injection.
 */
function sanitizeMarkdown(s: string): string {
    return s.replace(/\r?\n/g, ' ').replace(/[`*_#<>]/g, '');
}

/**
 * Saneo COMPLETO de un campo de orquestador declarado (name/appliesWhen/
 * terminatesTo) proveniente de un registry no confiable: primero
 * `sanitizeMarkdown` (colapsa saltos de linea, quita marcado markdown), y
 * DESPUES `stripControlChars` (quita bytes de control C0/DEL). Ese orden
 * importa: `sanitizeMarkdown` colapsa `\r?\n` a un espacio antes de que
 * `stripControlChars` pueda tocarlos — aunque `stripControlChars` preserva
 * `\n`/`\t` de todos modos, para cuando corre ya no queda ninguno.
 *
 * Unica fuente de verdad para este saneo: `composedOrchestrators`
 * (core/context/provider.ts) lo aplica a cada campo antes de que llegue al
 * payload de contexto materializado, y cualquier otro punto del CLI que
 * necesite el mismo nombre normalizado (p.ej. `--verify` en
 * `commands/context/index.ts`, o la deteccion de colisiones post-saneo en
 * `core/orchestrators.ts`) debe importar y reusar esta funcion en vez de
 * reimplementar el regex — ver AGENTS.md
 * `reusar-guarda-de-symlink-en-lectores-de-contenido-de-registry` para el
 * patron general de no duplicar guardas sobre contenido de registry.
 *
 * Vive en core/text.ts (hoja pura, cero dependencias) en vez de en
 * provider.ts porque `core/orchestrators.ts` tambien debe consumirla (para
 * detectar colisiones post-saneo entre nombres crudos distintos) y
 * `orchestrators.ts` no puede importar `context/provider.ts`: provider.ts ya
 * importa el tipo `DeclaredOrchestrator` DESDE orchestrators.ts, asi que
 * importar en la direccion contraria cerraria un ciclo real.
 */
export function sanitizeDeclaredField(s: string): string {
    return stripControlChars(sanitizeMarkdown(s));
}
