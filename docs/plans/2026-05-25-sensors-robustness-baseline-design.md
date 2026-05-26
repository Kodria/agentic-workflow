# Sensors: robustez + baseline/ratchet — Design

- **Fecha:** 2026-05-25
- **Repo:** agentic-workflow (CLI `awm sensors`)
- **Origen:** primera aplicación de los sensors a un repo real con historia (notion-tracker). Surgieron 5 gaps; este diseño los cubre.

## Contexto

Los sensors se ejercitaron por primera vez en un proyecto legacy (no greenfield).
Salieron fricciones reales que no aparecen en proyectos nuevos. Ya se arregló el
runner (`maxBuffer` + ENOBUFS, commit 99aa177). Quedan 5 mejoras.

## Objetivos

**Parte A — Fixes de robustez (rápidos):**

1. **`status` honesto.** Hoy `checkBinary` para comandos `npx ...` solo hace
   `which npx` → CUALQUIER comando npx da ✔ aunque la tool real no esté instalada
   ni exista el config. Reportó HEALTHY mientras depcheck bajaba un placeholder
   squatter y lint no podía correr.
   - **Fix:** para comandos `npx <tool>`, resolver la tool real (¿está en
     `node_modules/.bin` o en `package.json` deps?). Verificar que el archivo de
     `--config <file>` exista. Reportar detalle distinto por modo de falla
     (`tool no instalada`, `config faltante`, `ok`).

2. **`init` escribe los config files por default.** Hoy solo los copia con
   `--configure`. El plain `awm sensors init` escribe solo el manifest → lint y
   security quedan skipped por config ausente.
   - **Fix:** `awm sensors init` copia los config files del pack por default;
     `--no-configure` para optar por no hacerlo. `registryRoot` ya tiene default.

3. **Pack adapta el layout (no asume `src/`).** `depcheck` apunta a `src` —
   inexistente en App Router (usa `app/components/lib/hooks`). El target debe
   construirse desde los dirs de fuente reales.
   - **Fix:** `detectSourceDirs(cwd)` detecta dirs comunes (`src`, `app`, `lib`,
     `components`, `hooks`, `pages`) y arma el target de depcheck con los que existen.
   - **Colateral:** `PACK_DEFAULTS` está **duplicado** en `init.ts` y en
     `pack.json`. Unificar: `pack.json` como única fuente; `init` lo lee.

4. **Guard de dependency-confusion en `npx`.** `npx <tool>` cuando la tool no es
   devDep baja un paquete squatter (pasó con `depcruise`). Atado al fix #1: si la
   tool de un comando `npx` no está en `node_modules`/deps, `status` lo marca
   (no ✔) con detalle "tool no instalada (npx bajaría un paquete remoto)".

**Parte B — Baseline / ratchet (feature):**

5. En repos con historia, un sensor con baseline grande es inútil: siempre rojo
   (ruido) o disabled (sin señal). Necesita **fallar solo ante hallazgos NUEVOS**.

   - **`.awm/sensors.baseline.json`**: por sensor, set de *fingerprints* de
     hallazgos aceptados.
   - **Fingerprint:** `sha1(sensor + "|" + file + "|" + (rule ?? "") + "|" + maskNumbers(message))`.
     - Excluye `line`/`column` (driftean con cada edición).
     - `maskNumbers` reemplaza secuencias de dígitos por `#` (el formatter de tsc
       embebe el número de línea en el `message` — sin esto, el fingerprint drift).
   - **`awm sensors run`:** tras formatear, particiona findings en
     *baseline-suppressed* vs *new*. `status: 'fail'` **solo si hay NEW**. El
     output agrega `newCount` y `baselineCount` por sensor.
   - **`awm sensors baseline`** (subcomando nuevo): corre los sensors y escribe los
     findings actuales como baseline aceptado. Mensaje claro de cuántos se snapshotearon.
   - **Backward-compatible:** si no existe el archivo baseline, comportamiento
     actual (todo finding cuenta). Baseline es opt-in por presencia del archivo.

## No-objetivos (YAGNI)

- Conteo por-fingerprint (si baseline tiene 1 de X y aparecen 2, ambos se suprimen).
  Membership de set para v1; se anota como limitación conocida (dirección segura:
  no genera falsos "new").
- Baseline por-línea o auto-expiración. Solo snapshot manual vía `awm sensors baseline`.
- Tocar los formatters salvo lo mínimo para exponer lo que el fingerprint necesita
  (ya exponen `file`/`rule`/`message`).

## Arquitectura / archivos

| Unidad | Cambio |
|--------|--------|
| `cli/src/commands/sensors/status.ts` | `checkBinary` → resolución real de tool npx + check de `--config` file (#1, #4) |
| `cli/src/commands/sensors/init.ts` | configure por default; `detectSourceDirs`; leer defaults de pack.json (#2, #3) |
| `cli/src/commands/sensors/index.ts` | `init` default configure + `--no-configure`; nuevo subcomando `baseline` |
| `cli/src/commands/sensors/run.ts` | aplicar baseline: partición new/suppressed (#5) |
| `cli/src/commands/sensors/baseline.ts` (nuevo) | fingerprint + read/write `.awm/sensors.baseline.json` (#5) |
| `cli/src/commands/sensors/types.ts` | `SensorResult` += `newCount?`/`baselineCount?`; tipo `Baseline` |
| `registry/sensor-packs/js-ts/pack.json` | depcheck target derivado de dirs reales (doc) |
| `cli/tests/commands/sensors/*` | tests nuevos: status honesto, init configure, detectSourceDirs, fingerprint, baseline partition |

## Manejo de errores

- `baseline.json` corrupto → tratar como ausente (no romper el run), warning.
- Tool npx ausente en `status` → ✘ con detalle, no crash.

## Riesgos / decisiones a confirmar

- **(A) Fingerprint sin línea + maskNumbers**: predecible y resistente a drift, a
  costa de colapsar findings idénticos en mismo archivo. Aceptable para v1.
- **(B) Baseline opt-in por presencia de archivo** (+ comando para crearlo) vs flag
  en manifest. Propuesta: por archivo (más simple, backward-compatible).
- **(C) `init` configure por default** = cambio de comportamiento. `--no-configure`
  como escape.
- **(D) Unificar `PACK_DEFAULTS`**: pack.json como única fuente (hoy duplicado en init.ts).
