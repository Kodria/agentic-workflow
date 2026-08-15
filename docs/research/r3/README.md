# R3 CLI compatibility acceptance

This directory records the reproducible, sanitized consumer-side acceptance
contract for version-aware sensor coverage. It is deliberately not a raw run
archive: it contains neither home paths, ledger descriptions, raw JSONL lines,
credentials, nor output from a local project.

## Hermetic fixture

`cli/tests/fixtures/sensor-compatibility/` contains a v2 `js-ts` pack, a local
project with an installed fake package metadata version, and a legacy manifest.
The integration test copies them to a temporary directory. Its Linux, macOS,
and Windows resolver matrix injects the platform and a controlled probe
executor, so it proves portable resolver semantics without claiming that one
host has executed another OS natively. The separately named compiled-binary E2E
runs on the current native CI host; the required Ubuntu, macOS, and Windows CI
matrix supplies the native execution evidence for each platform. No global
binary, PATH entry, download, or host-specific tool affects either fixture.

The compiled CLI path then proves the separate end-to-end contract:

1. A legacy manifest produces `compatible-unverified` coverage, never a
   certification.
2. `awm sensors init --registry-root <fixture> --pack js-ts --no-configure`
   writes a schema-v2 manifest explicitly.
3. The local ESLint 10 fixture is certified; changing only its local metadata
   to ESLint 11 exposes `compatible-unverified` drift rather than a false
   green.
4. Coverage is read-only before migration: the project and fixture registry
   trees are SHA-256 checked before and after the command.

Reproduce the E2E gate with:

```bash
cd cli
npm run build
npx jest tests/integration/sensor-compatibility.e2e.test.ts --runInBand
```

Run the complete consumer gate from the repository root with:

```bash
(cd cli && npm ci)
(cd cli && npm run typecheck)
(cd cli && npm test -- --runInBand)
(cd cli && npm run build)
node cli/dist/src/index.js sensors run
node cli/dist/src/index.js sensors coverage --json --min 2
```

`cli-contract.json` is the machine-readable companion. Its fixture hashes are
relative names only and can be reproduced with `sha256sum`; its listed commands
are commands, not captured output. Regenerate `sourceHead` from the checked-out
source snapshot whenever this evidence changes; it identifies the snapshot used
to create the artifact and is intentionally not a claim about a future merge
commit. Update it only with an intentional fixture or contract change.

## Published-acceptance boundary

The published consumer check ran on 2026-08-15 with
`agentic-workflow-manager@8.1.0` downloaded from npm and a temporary clone of
the public `v2.0.0` registry release. It did not use `~/.awm`; the sanitized
command results, package integrity, pack hashes, and ledger/archive evidence
are in [`published-acceptance.json`](published-acceptance.json).

This remains **partial acceptance**, not a cross-platform certification claim.
The native Linux run exercised init, status, preflight, run, coverage, and a
real ledger-to-coverage-to-archive sequence. The installed certified ESLint
8.57.1, 9.39.5, and 10.8.1 fixtures each initialized successfully, but their
published-CLI status was `unverifiable` with `probe-not-matched`; they are not
reported as certified. Native macOS and Windows execution is not represented by
this host run.

The release reference was rechecked from a fresh public shallow clone: both it
and the configured origin resolve `v2.0.0` to annotated tag `7d20924f…` and
target commit `c35c087…`. The pack hashes below are from that checked-out public
release target. The support-matrix generator is now pinned to that exact tag,
and regeneration produced no documentation drift. Native macOS and Windows
published-consumer execution remains outside this host run, so the record stays
partial rather than claiming cross-platform certification.
