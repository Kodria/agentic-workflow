# Diseño — `inconclusive`: separar "no aplica" de "no pude certificar" en los sensores

**Fecha:** 2026-07-27
**Rama:** `claude/agentic-workflow-issue-1a31ru`
**Repos afectados:** `Kodria/agentic-workflow` (CLI), `Kodria/awm-baseline-registry` (una línea de doc)

## Problema

`SensorResult.status` usa `'skipped'` para dos cosas incompatibles:

- **No aplica** — el operador puso `enabled: false`. Es una decisión deliberada, informativa, y no debe degradar nada.
- **No pude certificar** — el sensor se cortó por timeout, su salida se truncó, o salió con un código que no supimos interpretar. El gate no analizó nada, y no lo dice.

Y la agregación las trata igual: `overall` solo cae a `skipped`/`not_certified` cuando **todos** los sensores están skipped. Con un solo sensor sano al lado, uno que no corrió queda invisible:

```
pass     typecheck
skipped  security — timeout after 120000ms
overall: pass          ← nada analizó seguridad
```

Es la regla que el repo ya se escribió, incumplida en su propio módulo de gateo:

> **`CONSTITUTION.md:29`** — Un valor de estado/enum nunca debe significar dos cosas distintas ("no aplica estructuralmente" vs "está roto") — son estados separados, siempre.

El defecto ya está documentado como hazard conocido desde el otro lado del sistema, en `sensor-packs/js-ts/eslint.config.awm.mjs:19` del registry: *"aquí no produce un sensor en rojo: produce `status: "skipped"`, que no rompe el `overall`. Matar el sensor es la forma más callada de fallar."*

Antecedente directo: el fix de exit 127 (commit `7655b66`) cerró **un** productor de falso verde —la herramienta ausente— dejando la clase entera abierta. Este diseño cierra la clase.

## Requirements

**Modelo de estados**

- **R1** — THE sensor run SHALL clasificar cada resultado en exactamente uno de `pass`, `fail`, `inconclusive`, `skipped`, donde `inconclusive` significa "no se pudo emitir veredicto" y `skipped` significa "no aplica por decisión deliberada".
- **R2** — WHEN un sensor excede su timeout configurado, THE sensor run SHALL reportar ese sensor con `status: "inconclusive"`.
- **R3** — WHEN la salida de un sensor excede `MAX_BUFFER`, THE sensor run SHALL reportar ese sensor con `status: "inconclusive"`.
- **R4** — IF un sensor sale con código distinto de cero, no se le puede parsear ningún hallazgo, no es un sensor de exit-code, y su herramienta no está ausente, THEN THE sensor run SHALL reportar `status: "inconclusive"`.
- **R5** — IF un sensor no está deshabilitado y no tiene `cmd` configurado, THEN THE sensor run SHALL reportar `status: "inconclusive"`.
- **R6** — WHERE un sensor tiene `enabled: false`, THE sensor run SHALL reportar `status: "skipped"`.
- **R7** — THE sensor run SHALL preservar el motivo legible de cada `inconclusive` en `skipReason`.

**Agregación**

- **R8** — WHEN al menos un sensor es `inconclusive` y ninguno es `fail`, THE sensor run SHALL reportar `overall: "not_certified"`.
- **R9** — WHEN al menos un sensor es `fail`, THE sensor run SHALL reportar `overall: "fail"`, haya o no sensores `inconclusive`.
- **R10** — WHILE todos los sensores ejecutados son `skipped` sobre un árbol con stack detectado, THE sensor run SHALL seguir reportando `overall: "not_certified"` (honest floor actual, sin cambios).
- **R11** — THE sensor run SHALL mantener el dominio de `overall` en `pass | fail | skipped | not_certified`, sin agregar valores nuevos.

**Invariantes que NO cambian**

- **R12** — IF la herramienta de un sensor está ausente, THEN THE sensor run SHALL seguir reportando `status: "fail"`.
- **R13** — THE mapeo a exit code SHALL seguir siendo `fail → 1`, todo lo demás → `0`.
- **R14** — WHEN se aplica un baseline, THE sensor run SHALL devolver los resultados `inconclusive` sin modificar, igual que hace hoy con `skipped`.

**Documentación**

- **R15** — THE prompt del implementador en el registry SHALL describir `not_certified` cubriendo sus dos causas: ausencia de `.awm/sensors.json`, y un sensor que no pudo certificar.

## Diseño

### La frontera entre `fail` e `inconclusive`

No es "¿corrió o no?" sino **"¿sé qué pasó?"**:

| Estado | Significa | Casos |
|---|---|---|
| `pass` | Corrió, sin hallazgos | — |
| `fail` | Problema definido, atribuible y accionable | Hallazgos en el código; binario ausente (sabés exactamente qué instalar); sensor de exit-code que salió no-cero |
| `inconclusive` | Se intentó, el resultado es desconocido | Timeout, salida truncada, exit no interpretable, sensor sin `cmd` |
| `skipped` | No aplica, por decisión deliberada | `enabled: false` |

Una herramienta ausente se queda en `fail` (R12) por dos razones: es tan definida y accionable como un hallazgo, y moverla a `inconclusive` bajaría su exit code de 1 a 0 — debilitando justo el caso que `7655b66` acaba de cerrar.

### Agregación

```
overall = any(fail)         → 'fail'
        : any(inconclusive) → 'not_certified'
        : todos skipped     → 'skipped' → honest floor → 'not_certified' si hay stack
        : sin resultados    → 'skipped' → honest floor
        : otro              → 'pass'
```

`fail` precede a `inconclusive` porque es el veredicto más accionable: si hay algo roto y además algo que no se pudo medir, lo primero que hay que atender es lo roto.

### Compatibilidad — por qué esto no rompe a nadie

El valor nuevo vive **solo** en `status`, por sensor. El dominio de `overall` no cambia (R11).

Los consumidores externos son los skills de `awm-baseline-registry`, y leen `overall`, no `status` — `implementer-prompt.md:71` es explícito: *"Lee `overall`, no el exit code"*, y cierra con *"Only `overall: "pass"` counts as green"*. Esa última frase es la que hace el cambio seguro por construcción: los skills ya tratan cualquier veredicto que no sea `pass` como no-verde, así que un `not_certified` por una causa nueva ya cae bien sin tocarlos.

Lo único que queda desactualizado es la explicación entre paréntesis de `not_certified` como *"(sin `.awm/sensors.json`)"*, que ahora es incompleta (R15).

Dentro del CLI, los consumidores son tres y están todos en el módulo: `exitCodeFor` (sin cambios, R13), `applyBaseline` (suma `inconclusive` a su early-return, R14) y la agregación en `runSensors`.

### Componentes tocados

| Archivo | Cambio |
|---|---|
| `cli/src/commands/sensors/types.ts` | `status` suma `'inconclusive'`; documentar la frontera en el tipo |
| `cli/src/commands/sensors/run.ts` | `runSensor`: timeout/ENOBUFS/exit-no-parseable → `inconclusive`. `runSensors`: sensor sin `cmd` → `inconclusive`; nueva rama de agregación. `applyBaseline`: early-return |
| `awm-baseline-registry` → `skills/subagent-driven-development/implementer-prompt.md` | R15, una línea |

## Testing

TDD, rojo primero. El test que ancla el diseño entero es el escenario del issue con el hueco que quedó abierto:

- **Ancla (R8):** `typecheck` sano + `security` con timeout → hoy `overall: pass`; debe dar `not_certified`. Nace en rojo.
- Un test por productor de `inconclusive`: timeout (R2), ENOBUFS (R3), exit no parseable (R4), sensor sin `cmd` (R5).
- **Regresión de lo benigno (R6, R10):** `enabled: false` sigue `skipped` y no arrastra el `overall` a `not_certified` por sí solo.
- **Precedencia (R9):** un `fail` junto a un `inconclusive` da `fail`.
- **No regresión (R12, R13):** los tests de herramienta ausente contra `/bin/sh` real siguen verdes; `exitCodeFor` sin cambios.

Los tests de `inconclusive` van con `execSync` mockeado (timeout y ENOBUFS no se provocan de forma barata contra un shell real); los de herramienta ausente ya existen contra `/bin/sh` real y se quedan como están.

## Fuera de alcance

- **Subir el exit code de `not_certified` a 1.** Decisión de política de gate distinta, con costo observable para terceros (un timeout de tsc empezaría a romper builds que hoy pasan, y el hook PostToolUse mostraría error). Merece su propia evidencia y su propio release major.
- **Un flag `--strict`.** Nadie lo pide todavía.
- **`cli/package-lock.json` desincronizado** (dice `3.1.0`, `package.json` dice `3.2.2`): `release/orchestrator.ts:98` solo stagea `cli/package.json` y `CHANGELOG.md`. Defecto real, aparte.
