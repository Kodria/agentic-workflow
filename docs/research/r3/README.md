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
`agentic-workflow-manager@8.1.2` downloaded from npm and a temporary clone of
the public `v2.0.1` registry release. It did not use `~/.awm`; the sanitized
command results, package integrity, pack hashes, and ledger/archive evidence
are in [`published-acceptance.json`](published-acceptance.json).

This is the R3 closure gate: it exercises the published CLI through new,
legacy, and future-version compatibility paths, plus the ledger-to-coverage-to-
archive sequence. The native CI matrix for the merged CLI release is green on
Ubuntu, macOS, and Windows. The consumer execution itself is recorded as Linux
evidence only; it does not claim that a separate npm consumer run occurred on
the other two hosts.

The release reference was rechecked from a fresh public shallow clone: the
public tag `v2.0.1` resolves to annotated tag `81449efa…` and target commit
`6f406320…`. The support-matrix generator is pinned to that immutable release
and regeneration passed its freshness guard.
