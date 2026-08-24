// Núcleo compartido del patrón de salida de comandos CLI: `CommandResult` es el
// tipo de retorno que cada `run*` de comando produce (code/stdout/stderr), y
// `emit` es el único punto que lo vuelca a los streams reales del proceso.
// Extraído de `commands/process/index.ts` y `commands/context/index.ts`, que lo
// duplicaban byte a byte — ver finding `command-result-boilerplate-duplicated`.
export interface CommandResult { code: 0 | 2; stdout: string; stderr: string }

/** Formatea diagnósticos como líneas `warning: ...\n` listas para stderr.
 *  Compartido entre comandos para no divergir el formato. */
export function diagnosticsToStderr(diagnostics: string[]): string {
    return diagnostics.map((d) => `warning: ${d}\n`).join('');
}

export function emit(result: CommandResult): void {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.code !== 0) process.exitCode = result.code;
}
