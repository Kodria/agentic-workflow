# Diseño — WS-C: Sensibilidad al SO, fase 1 (Linux duro + WSL documentado)

**Fecha:** 2026-06-22
**Estado:** DISEÑO — aprobado en sesión, listo para planificar.
**Autor de la sesión:** Nicolás (`nicolasf1402@gmail.com`)
**Workstream:** WS-C del brief [`2026-06-21-portability-and-cloud-bootstrap-design.md`](2026-06-21-portability-and-cloud-bootstrap-design.md) (§4.3, §6).
**Rama:** `feat/ws-c-os-sensitivity`

---

## 1. Contexto y encuadre

El brief de la "Era de Portabilidad" abrió WS-C para "endurecer Linux + documentar WSL", con Windows nativo diferido a WS-D (decisión D-1). La validación empírica del propio brief (§0) **probó que Linux ya funciona**: en una VM Ubuntu 24.04 (Claude Code web), `awm init --yes` + `awm doctor` dan verde, el hook SessionStart dispara y un registry privado se clona con la receta `git config url.insteadOf` + `AWM_GIT_TOKEN`.

Por lo tanto WS-C **no arregla nada roto en Linux**. Su valor es eliminar la **fragilidad que hoy queda enmascarada porque el desarrollo es en macOS**, y darle al usuario Windows un camino claro (WSL) en vez de un fallo silencioso.

### 1.1 Hallazgos del código (verificados, no asumidos)

Exploración exhaustiva de `cli/src` (2026-06-22):

| # | Hallazgo | Ubicación | Severidad |
|---|----------|-----------|-----------|
| H-1 | `process.env.HOME!` (non-null assertion) **sin fallback** a `os.homedir()` | `cli/src/commands/hooks/install.ts:32`, `cli/src/commands/hooks/uninstall.ts:16` | 🔴 Alta |
| H-2 | Resolución de home/`AWM_HOME` **duplicada en 8+ lugares**, evaluada en require-time (tests necesitan `jest.resetModules()`) | `registries.ts:11`, `providers/index.ts:35`, `update-check.ts:21`, `context/materializer.ts:10`, `utils/config.ts:26`, `diagnostics/context.ts:16`, `sensors/install.ts:13` | 🟡 Media |
| H-3 | Skill instalado **SIEMPRE como symlink**, sin try/catch | `cli/src/commands/hooks/install.ts:73` | 🟡 Media |
| H-4 | Separador `/` hardcodeado en operaciones de path | `cli/src/core/profile.ts:132`, `cli/src/commands/sensors/formatters/eslint.ts:14` | 🟡 Media |
| H-5 | **Cero detección de plataforma** (`process.platform` no se usa) → Windows nativo falla en silencio | (ausencia) | 🟡 Media |

> Nota: en la VM de nube `HOME=/root` está siempre definido, así que H-1 no muerde *hoy* en Linux; es deuda de robustez que se manifiesta en entornos sin `HOME` y prepara el terreno para WS-D.

### 1.2 Decisiones tomadas en esta sesión

| # | Decisión | Elección |
|---|----------|----------|
| WSC-1 | Alcance de código | **Centralizar + endurecer:** módulo único de resolución de paths, migrar los 8+ call-sites, cerrar la grieta `HOME!`. Refactor defensivo que prepara WS-D. |
| WSC-2 | Comportamiento en Windows nativo | **Warning + continuar best-effort:** detecta `win32`, avisa y orienta a WSL, pero no bloquea. |
| WSC-3 | Verificación de Linux en distro limpia | **Runbook documentado** (más tests unitarios por TDD). Sin introducir CI nueva (el repo hoy no tiene). |

---

## 2. Arquitectura

### 2.1 Módulo único de paths — `cli/src/core/paths.ts` (nuevo)

Fuente única de verdad para resolución de home, directorio de AWM y detección de plataforma. Expone **funciones** (call-time), no constantes (require-time):

```ts
// cli/src/core/paths.ts
import os from 'os';
import path from 'path';

export function homeDir(): string {
  return process.env.HOME || os.homedir();          // fallback robusto, nunca crudo
}

export function awmHome(): string {
  return process.env.AWM_HOME || path.join(homeDir(), '.awm');
}

export function platform(): NodeJS.Platform {
  return process.platform;                            // wrapper testeable
}

export function isWindowsNative(): boolean {
  return platform() === 'win32';                      // WSL reporta 'linux', no entra
}

export function warnIfUnsupportedPlatform(log: (msg: string) => void): void {
  if (isWindowsNative()) {
    log(/* warning claro orientando a WSL — ver §2.4 */);
  }
}
```

**Por qué funciones y no constantes:**
- Elimina la evaluación en require-time que obliga a `jest.resetModules()` en los tests.
- Lee los env vars en el momento de uso → comportamiento correcto cuando el entorno cambia.
- Deja **un solo punto** que WS-D deberá tocar (remapeo `USERPROFILE`/`APPDATA`) en vez de ocho.

**Aislamiento:** módulo puro, sin efectos secundarios salvo lectura de `process.env`. `warnIfUnsupportedPlatform` recibe el logger por parámetro (no importa el logger global) → testeable sin capturar stdout.

### 2.2 Migración de call-sites (cierra H-1, H-2)

Todos los puntos de §1.1/H-2 pasan a consumir `paths.awmHome()` / `paths.homeDir()`:

- `core/registries.ts`, `providers/index.ts`, `core/update-check.ts`, `core/context/materializer.ts`, `utils/config.ts`, `core/diagnostics/context.ts`, `commands/sensors/install.ts`.
- `commands/hooks/install.ts:32` y `commands/hooks/uninstall.ts:16`: reemplazar `process.env.HOME!` por `paths.homeDir()` → **cierra H-1**.

**Compatibilidad de la const exportada:** `registries.ts:11` exporta hoy `AWM_HOME` como constante. Antes de migrar se hace `grep -rn "AWM_HOME" cli/src` para listar importadores. Dos caminos según resultado:
- Si nadie importa la const como valor → se borra y todos llaman `paths.awmHome()`.
- Si hay importadores → se reemplazan por la llamada a función (no se deja un alias require-time que reintroduzca H-2).

### 2.3 Symlink robusto (cierra H-3)

`commands/hooks/install.ts:73` instala el skill con `fs.symlinkSync` incondicional. Se envuelve en try/catch con **fallback a copia ante fallo** (p.ej. `EPERM` en Windows sin Developer Mode):

```ts
try {
  fs.symlinkSync(sourceSkill, skillDest);
} catch (err) {
  // best-effort en plataformas sin symlink: copiar y avisar
  fs.cpSync(sourceSkill, skillDest, { recursive: true });
  log(`symlink no disponible, se copió el skill (${skillDest}); 'awm update' no propagará automáticamente`);
}
```

- En Linux/macOS el `try` tiene éxito → comportamiento idéntico al actual (symlink, `awm update` propaga).
- El `default` sigue siendo symlink; el fallback es solo red de seguridad, no cambia la política.

### 2.4 Detección de plataforma + warning (cierra H-5)

`warnIfUnsupportedPlatform()` se cablea en los dos comandos de entrada que materializan instalación:

- `awm init` (`commands/init.ts`)
- `awm sync` (resolver el comando exacto al planificar)

En `win32` imprime un warning del estilo:

```
⚠ AWM detectó Windows nativo. El soporte nativo está diferido; la vía recomendada hoy es WSL.
  Instalá WSL (https://learn.microsoft.com/windows/wsl/install) y corré AWM dentro de tu distro Linux.
  Continúo en modo best-effort, pero algunos pasos (symlinks, hooks) pueden no funcionar.
```

Y **continúa** (decisión WSC-2). WSL no dispara nada porque reporta `process.platform === 'linux'`.

`awm doctor` además reporta la plataforma detectada como línea informativa (reusa `paths.platform()`).

### 2.5 Normalización de separadores (cierra H-4)

Revisión caso por caso:
- `core/profile.ts:132` (`config.local.endsWith('/')`) y `sensors/formatters/eslint.ts:14` (`cwd + '/'`): reemplazar por `path.sep` / `path.relative` **solo si es operación real de path**.
- `core/versioning.ts:35` (`ref.split('/')`): **se deja** — es un git-ref, siempre `/`.
- `core/registries.ts:54` (`includes('/')` en validación de path traversal): **se deja** — es un guard de seguridad que debe rechazar `/` literal (ver CONSTITUTION).

---

## 3. Flujo de datos

```
comando (init/sync/doctor/hooks)
        │
        ├─► paths.homeDir() / paths.awmHome()      ── resolución de directorios
        ├─► paths.warnIfUnsupportedPlatform(log)   ── aviso WSL si win32
        │
        ▼
providers/index.ts  ── consume paths.* para armar settingsPath, scriptsDir, skills dir
        │
        ▼
executor / hooks/install ── symlink con fallback a copia (§2.3)
```

---

## 4. Manejo de errores

| Situación | Comportamiento |
|-----------|----------------|
| `HOME` ausente | `paths.homeDir()` cae a `os.homedir()`. Nunca lanza excepción por `HOME` indefinido. |
| Windows nativo (`win32`) | Warning orientando a WSL + continúa best-effort. No throw. |
| Symlink falla (EPERM u otro) | Fallback a `fs.cpSync` recursivo + nota de que `awm update` no propagará. No throw. |
| `AWM_HOME` seteado | Respetado siempre (override explícito sobre el default). |

---

## 5. Testing (TDD)

- **`cli/tests/core/paths.test.ts`** (nuevo):
  - `HOME` unset → `homeDir()` devuelve `os.homedir()`.
  - `AWM_HOME` seteado → `awmHome()` lo respeta; sin setear → `<home>/.awm`.
  - `platform()` / `isWindowsNative()` con `process.platform` stubbeado a `win32` / `linux` / `darwin`.
  - `warnIfUnsupportedPlatform` invoca el logger solo en `win32`.
  - **Sin `jest.resetModules()`** (beneficio de las funciones call-time).
- **Fallback symlink→copia:** test en el flujo de hooks/executor simulando que `fs.symlinkSync` lanza `EPERM` → verifica que copia y emite la nota.
- **Patrón de aislamiento obligatorio:** todos los tests usan tmpdirs con `process.env.HOME` / `process.env.AWM_HOME` sobreescritos (patrón de `cli/tests/commands/hooks/install.test.ts`). Ningún test toca el `~/.awm` real (regla de CLAUDE.md).
- **No regresión:** la suite existente (`jest --runInBand`) sigue verde tras la migración de call-sites.

---

## 6. Entregable de documentación — `docs/operations/cloud-and-platforms.md` (nuevo)

Tres partes:

1. **Verificación en distro limpia (runbook).** Pasos reproducibles en contenedor Ubuntu limpio o sesión Claude Code web: `npm i -g agentic-workflow-manager → awm init --yes → awm doctor` y checks esperados. El spike de §0 del brief es la primera corrida registrada de este runbook.
2. **Flujo de nube validado (receta oficial, D-7).** Los setup scripts del brief §0 con `AWM_GIT_TOKEN` + `git config url.insteadOf`, como procedimiento operativo oficial para registries privados desde la nube.
3. **Guía WSL.** WSL como única vía Windows soportada hoy; qué significa el warning de Windows nativo (§2.4) y cómo migrar a WSL.

Más un puntero desde el `README` (sección "Platform support") a este doc.

---

## 7. Alcance

### Dentro
- Módulo `core/paths.ts` + migración de call-sites + cierre de H-1.
- Detección de plataforma con warning WSL (best-effort) + línea en `awm doctor`.
- Fallback symlink→copia ante fallo.
- Normalización de separadores donde sea operación real de path.
- Tests unitarios (TDD) + runbook + guía WSL + receta de nube.

### Fuera (frontera con WS-D, diferido D-1)
- Remapeo a `USERPROFILE` / `APPDATA`.
- `run-hook.cmd` validado en cmd.exe / PowerShell.
- Forzar copia-sobre-symlink global como política en Windows.
- Soporte nativo Windows en general.

---

## 8. Componentes — resumen

| Componente | Archivo | Acción |
|------------|---------|--------|
| Módulo de paths | `cli/src/core/paths.ts` | **Nuevo** |
| Migración home/AWM_HOME | 7 archivos de §2.2 | Editar para consumir `paths.*` |
| Cierre `HOME!` | `hooks/install.ts:32`, `hooks/uninstall.ts:16` | Editar |
| Symlink robusto | `hooks/install.ts:73` | Editar (try/catch + copia) |
| Warning de plataforma | `commands/init.ts`, comando `sync`, `doctor` | Cablear `warnIfUnsupportedPlatform` |
| Separadores | `profile.ts:132`, `eslint.ts:14` | Editar donde aplique |
| Tests | `cli/tests/core/paths.test.ts` (+ test de fallback) | **Nuevo** |
| Doc operativa | `docs/operations/cloud-and-platforms.md` | **Nuevo** + puntero en README |

---

## 9. Próximo paso

Diseño aprobado. Siguiente fase del ciclo: `writing-plans` → plan de implementación en `docs/plans/2026-06-22-ws-c-os-sensitivity-plan.md`, con tareas TDD por componente.
