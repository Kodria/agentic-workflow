# R2 static coverage acceptance

- Hermetic fixture: `cli/tests/fixtures/sensor-coverage/js-ts-gap/`.
- Provenance: sanitized shape of `cli/.awm/sensors.json` at commit `1cbc7c8926680ae36510fc921c90b09182777f4f`; unnecessary commands were removed and no local or untracked content was copied.
- Fixture SHA-256: tracked `js-ts-gap/.awm/sensors.json` `6023378d9299308a7799f82105f308ec4147f8b7ffa1a3c6c6bc769cfe18245a`; `js-ts-gap/package.json` `aed6cf826f585223220eea36231ac1586b2dfdafd7291da7b85cd4f617b16206`. Update only after a deliberate fixture change.
- Hermetic reproduction: `cd cli && npm run build && npx jest tests/integration/sensor-coverage.e2e.test.ts --runInBand`.
- Real run: from `cli/`, use `npm run build && node dist/src/index.js sensors coverage --json`; never a global `awm`.
- Provider evidence: from two real sessions on the same source SHA, run `node docs/research/r2/provider-run.mjs claude-code cli` and `node docs/research/r2/provider-run.mjs codex cli`. The runner requires the requested executable (`claude` or `codex`) to execute `--version` before it runs coverage or writes evidence. It records the sanitized version, mapped executable, and `executable--version` attestation.
- `sourceHead` is a real repository commit at the time the binary is exercised; since evidence is committed afterwards, it identifies the tested source rather than the commit adding its JSON. Evidence includes the canonical sanitized coverage report, allowing its SHA-256 to be recomputed without credentials or local paths.
- CA-1.1: the real checkout has no `format` sensor. If it changes, a real run records the new state while the hermetic fixture remains the historical reproduction.

## Certification status

**RNF-T.2 is certified.** Both providers were genuinely attested (`claude --version` and `codex --version`) and run from real sessions against the same source (`sourceHead 618f321588dd95a1cf3005afb01bb054506b0f30`): `evidence/claude-code.json` and `evidence/codex.json`. Their `semanticContract` envelopes are identical — `overall: "inconclusive"`, `staticReason: "no_reference"`, no classes — because the real checkout's registry does not yet declare `coverage` for the `js-ts` pack (that declaration is the separate `awm-baseline-registry` deliverable). `sensor-coverage-provider-evidence.test.ts` enforces both the sanitization contract and the cross-provider parity; re-run the provider evidence whenever `sourceHead` moves so the two envelopes stay comparable.
