# Fix: default agent incorrecto (antigravity) al instalar bundles — Design

Resuelve [agentic-workflow#7](https://github.com/Kodria/agentic-workflow/issues/7).

## Problema (causa raíz, verificada en el código)

En un entorno claude-code, `awm add <bundle> --yes` (sin `-a`) instala los bundles para el agente equivocado (`antigravity`), dejando `awm doctor` en `degraded` desde la primera sesión y las skills invisibles para Claude Code.

- `DEFAULT_PREFS.defaultAgent = 'antigravity'` (`cli/src/utils/config.ts:20`), y `getPreferences()` **persiste** ese default a `~/.awm/preferences.json` la primera vez que se lo llama si el archivo no existe.
- `awm init` resuelve su agente como `opts.agent ?? 'claude-code'` (`cli/src/commands/init.ts:74`) pero **nunca llama a `getPreferences`/`savePreferences`** — no deja rastro del agente en preferences.
- Entonces `awm add` es la **primera** llamada a `getPreferences()` en el flujo del setup script → stampea `antigravity` en disco y lo usa como target de instalación.

## Requirements

- R1: THE default de `AwmPreferences.defaultAgent` SHALL ser `claude-code` (coincidiendo con el default documentado de `awm init --help`), no `antigravity`.
- R2: WHEN `awm init` corre con `-a <agent>` explícito, THE init SHALL persistir ese agente como `defaultAgent` en `preferences.json`.
- R3: WHEN `awm init` corre AND no existe `preferences.json` todavía, THE init SHALL persistir el agente resuelto (default `claude-code`) a `preferences.json`.
- R4: IF `preferences.json` YA existe AND no se pasó `-a`, THEN `awm init` SHALL NO sobrescribir el `defaultAgent` guardado (no pisar una elección explícita previa).
- R5: THE fix SHALL NO tocar el `~/.awm` real; todos los tests usan tmpdirs aislados con `AWM_HOME`/`HOME` sobreescritos (patrón del CLAUDE.md).

## Approach (A + B)

**A — default correcto** (`cli/src/utils/config.ts`): `DEFAULT_PREFS.defaultAgent: 'antigravity' → 'claude-code'`. Arregla el síntoma reportado (el add stampea claude-code) y alinea con el default que init ya documenta. (R1)

**B — init como fuente de verdad** (`cli/src/commands/init.ts`): tras resolver `agent`, persistir la preferencia — pero **sin pisar** una elección previa:

```ts
// pseudocódigo
if (opts.agent != null || !preferencesExist()) {
    savePreferences({ ...getPreferences(), defaultAgent: agent });
}
```

- `-a` explícito → persiste ese agente (R2).
- Primer init sin archivo → persiste el resuelto (default claude-code) (R3).
- Re-init sin `-a` con archivo existente → no toca nada (R4). **Esto evita la regresión** de resetear a claude-code una preferencia que el usuario fijó a opencode/antigravity.

Helper nuevo en `config.ts`: `preferencesExist(): boolean` — mantiene el conocimiento de la ruta del archivo dentro de `config.ts` (init no calcula paths de `~/.awm`).

## Descartado

- **C (detección por env)**: más frágil (nombres de env var varían entre versiones/superficies) y más código. Deja como enhancement futuro si se quiere robustez extra.
- **D (exigir `-a` en `--yes`)**: rompería la ergonomía del setup script documentado.

## Testing

`cli/tests/utils/config.test.ts` **afirma** `defaultAgent === 'antigravity'` (línea ~24) — hay que actualizarlo a `claude-code` (si no, R1 lo rompe). Tests nuevos:
- `config.test.ts`: default es `claude-code`; `preferencesExist()` false→true.
- `init` (nuevo o en el test suite de init): primer init persiste claude-code (R3); `init -a opencode` persiste opencode (R2); re-init sin `-a` no pisa una preferencia opencode existente (R4).

Todos con `AWM_HOME` tmpdir aislado (R5). Verificación: `npm test` en `cli/` en verde.
