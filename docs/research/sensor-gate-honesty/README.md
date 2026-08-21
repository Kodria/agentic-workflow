# Published sensor gate acceptance

This record verifies the released CLI `8.1.5` with the released baseline
registry `v3.0.0` at `3db85c92eecc449fb8f14252fe2c64bb493cfb3f`. The tag contains
the coordinated registry merge and declares `minCliVersion: 8.1.5`.

The acceptance installed only `agentic-workflow-manager@8.1.5` into a temporary
prefix and extracted the exact registry tag into a separate temporary
directory. No real AWM home or checkout was used as the consumer fixture.

## Semantic outcomes

- A bare project with ESLint `10.8.1` selected the admitted `eslint-10-flat`
  variant, but had no compatible project configuration for the
  `eslint-print-config` probe. `sensors run --fast` therefore returned
  `not_certified` with `probe-not-matched`, zero elapsed execution time, and a
  nonzero exit. This is the expected pre-spawn non-pass, not a timeout.
- The registry's published ESLint 8 fixture used the admitted `eslint-8-eslintrc`
  variant. Static `sensors status` returned `READY`; the empirical run executed
  lint and typecheck with pack timeouts. Lint returned the fixture's intentional
  JavaScript `no-undef` and `no-unused-vars` findings, while typecheck passed.
  Its process exit is correctly nonzero because the semantic verdict is `fail`.
- `preflight --verify-sensors` on the bare case remained read-only: the project
  hash was unchanged. Its degraded report preserved the bounded non-pass
  evidence rather than claiming an execution succeeded.

The overall acceptance verdict is `pass` because each observed non-pass is the
specified fail-closed outcome, not because every sample project was green.

## Native CI evidence

The CLI CI run passed its test matrix on
[Ubuntu](https://github.com/Kodria/agentic-workflow/actions/runs/32470501705/job/96736079227),
[macOS](https://github.com/Kodria/agentic-workflow/actions/runs/32470501705/job/96736079120),
and [native Windows](https://github.com/Kodria/agentic-workflow/actions/runs/32470501705/job/96736079350).
The registry validation and sensor certification run for the release tag also
passed, including its Ubuntu, macOS, and native Windows pack jobs:
[registry workflow](https://github.com/Kodria/awm-baseline-registry/actions/runs/32479729036).

The machine-readable identities and case evidence are in
[`published-acceptance.json`](published-acceptance.json).

## Matriz reproducible

La matriz se ejecutó con el binario instalado desde npm y un árbol extraído del
tag, en directorios temporales hermanos (el home nunca queda bajo el proyecto).
Cada entrada de `cases` registra argv, resultado semántico, exit del proceso y
un hash sanitizado del fixture, sin rutas temporales ni salida de herramientas.

| Grupo | Casos | Resultado exigido |
| --- | --- | --- |
| Compatibilidad | legacy/v2 baseline | `pass`, exit 0 |
| Timeout | project, pack, fallback, inválido antes de spawn | precedencia acotada; inválido es non-pass |
| Changed | literal, unsupported, empty, Git error, mixed | argv literal o fallback explícito; mixed conserva `fail` |
| Veredictos | pass, fail, not_certified, skipped | sólo `pass` usa exit 0 |
| Readiness | `status` READY; preflight con sensor exit 2 | status no ejecuta; preflight es read-only y degrada |
| ESLint 8 | TypeScript, JavaScript y outputs generados | TS limpio, JS intencional reportado, outputs ignorados |
