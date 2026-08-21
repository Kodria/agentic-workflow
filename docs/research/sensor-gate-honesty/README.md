# Published sensor-gate acceptance

This record is evidence from an isolated execution on 2026-08-21, not a claim
that every target-contract scenario was covered. The harness installed npm
`agentic-workflow-manager@8.1.6`, cloned `awm-baseline-registry` tag `v3.0.0`
at `3db85c92eecc449fb8f14252fe2c64bb493cfb3f`, set a fresh `AWM_HOME`, and
ran `cli/tests/integration/published-sensor-gate-matrix.e2e.test.ts` with
`AWM_RUN_PUBLISHED_SENSOR_GATE_MATRIX=1` and `AWM_PUBLISHED_MATRIX_REPORT`.
The JSON report retained the command argv (with `<registry-root>` substituted),
process exit, semantic output when available, and SHA-256 hashes of stdout and
stderr; it contains no temporary fixture paths.

Observed from the report:

| Case | Observable result |
| --- | --- |
| v2 clean / project timeout / pack timeout | `pass`, exit 0; sources `project` and `pack` were observed |
| legacy | sensor `pass` with fallback timeout, overall `not_certified`, exit 1 |
| disabled v2 sensor | `skipped`, exit 1 |
| ESLint finding | `fail`, exit 1 |
| v2 baseline | finding became baseline debt and the next run was `pass`, exit 0 |
| changed JavaScript file | changed scope with one file, `pass`, exit 0 |
| status | exit 0; its output was deliberately not treated as empirical certification |
| `preflight --verify-sensors --json` | `degraded`, exit 1; the sensor execution check itself was `pass` but project context was absent |
| v2 `timeout: 0` | `not_certified` with zero sensors, exit 1 — this is recorded as release fallback, not as an invalid-timeout rejection or pre-spawn proof |

The report did establish the published verdict-to-exit table: `pass → 0`, and
`fail`, `not_certified`, and `skipped` each → 1. It did **not** establish exit
2; the published preflight result was exit 1.

Coverage boundaries are intentional. The release harness currently has no
empirical case for changed unsupported, changed empty, changed Git-error,
mixed full/scoped sensors, timeout termination, or a parser-level
invalid-timeout-before-spawn assertion. Those requirements remain covered only
by their focused source tests or remain a release gap; this acceptance record
does not upgrade them to published evidence. The registry's ESLint 8
TS/JS/generated certification is evidenced by its native CI run, while the
local published harness exercised the JavaScript ESLint fixture only.

The persisted, sanitized report is
[`published-sensor-gate-matrix.json`](published-sensor-gate-matrix.json). It is
the Linux execution above; this is the only platform on which this opt-in
matrix was run. Native CI evidence for the CLI acceptance commit is recorded
in [`published-acceptance.json`](published-acceptance.json): Ubuntu, macOS,
and native Windows jobs all passed the general CI suite, but those jobs did not
run this opt-in matrix. The registry's v3.0.0 validation/certification run is
[also published](https://github.com/Kodria/awm-baseline-registry/actions/runs/32479729036),
including Ubuntu, macOS, and Windows certification jobs.
