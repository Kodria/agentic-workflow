---
schema: awm.change-record/v1
id: 2026-11-11-probe-timeout-honesty
title: Raise compatibility probe deadline to 30s and surface probe-timeout honestly
summary_short: Bound probes at 30s and propagate probe-timeout (and siblings) instead of collapsing to probe-inconclusive under load (#242).
type: fix
scope: sensors
semver: patch
breaking: false
modules:
  - cli/src/commands
  - cli/tests/commands
  - docs/plans
links:
  plan: docs/plans/2026-11-11-probe-timeout-honesty-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/242
verification:
  commit: a26f0df4c76aebb50f7794a8bdb64063ee939cf3
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:4b26e3e2904d3780f4ee7bca6b2108dba034609a0b51fbb0e4a18f866e415847
manual_validation:
  - step: "Con Semgrep instalado y maquina bajo carga moderada, correr awm sensors run"
    expected: "security no marca unverifiable: probe-inconclusive solo por arranque lento (<30 s); si el plazo vence, el skipReason nombra probe-timeout"
  - step: "Forzar un probe timedOut (test/fake)"
    expected: "resolve reporta reason probe-timeout (no probe-inconclusive)"
  - step: "Un probe unverifiable sin reason especifico"
    expected: "sigue probe-inconclusive"
risks:
  - "Una herramienta realmente colgada espera hasta 30 s por sonda (antes 5 s) antes de fallar; sin reintento."
rollback: "Revertir el commit de fix en compatibility timeout/probe/live/resolve y tests asociados; republicar patch."
---

## Qué se hizo

Se exportó `COMPATIBILITY_PROBE_TIMEOUT_MS = 30_000` y se usó en el executor de la sonda y en `pathPackageManagerVersion`. `resolve.ts` propaga `probe-timeout` | `probe-output-limit` | `probe-spawn-error` | `probe-exception` en lugar de aplastarlos a `probe-inconclusive`. Tests kill-RED para RF-1..5, mock de spawn con `shell: false`, y expectativa adyacente en `live.test.ts` actualizada a `probe-exception`.

## Qué se probó

- `npm --prefix cli test -- --runInBand` sobre `probe.test.ts`, `resolve.test.ts`, `live.test.ts` (64 pass)
- `awm sensors run` → `overall: pass` (receipt en verification)
- Spec + quality reviews de S1 PASS; Track A F1 y Track B B1/B2 corregidos en el commit de tests

## Qué falta validar

Validación manual bajo carga real (criterios de aceptación del plan): confirmar que Semgrep bajo CPU ocupada ya no produce el falso `probe-inconclusive` de #242.

## Riesgos y rollback

Peor caso más lento (30 s) si la herramienta cuelga. Rollback: revert del fix + tests y patch release.
