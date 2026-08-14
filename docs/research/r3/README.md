# R3 CLI compatibility acceptance

This directory records the reproducible, sanitized consumer-side acceptance
contract for version-aware sensor coverage. It is deliberately not a raw run
archive: it contains neither home paths, ledger descriptions, raw JSONL lines,
credentials, nor output from a local project.

## Hermetic fixture

`cli/tests/fixtures/sensor-compatibility/` contains a v2 `js-ts` pack, a local
project with an installed fake package metadata version, and a legacy manifest.
The integration test copies them to a temporary directory. It uses a controlled
probe executor for the Linux, macOS, and Windows resolver matrix, so no global
binary, PATH entry, download, or host-specific tool affects the result.

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
cd cli && npm ci
cd cli && npm run typecheck
cd cli && npm test -- --runInBand
cd cli && npm run build
node cli/dist/src/index.js sensors run
node cli/dist/src/index.js sensors coverage --json --min 2
```

`cli-contract.json` is the machine-readable companion. Its fixture hashes are
relative names only and can be reproduced with `sha256sum`; its listed commands
are commands, not captured output. Update it only with an intentional fixture
or contract change.

## Certification boundary

This is **partial** certification. It validates the CLI consumer contract and
the portable synthetic resolver matrix. Official pack certification remains
pending until the dependent `awm-baseline-registry` v2.0.0 tag is published
after the CLI 7.0.0 release. The registry must not be elevated first: a pack
v2 declaration needs a released CLI capable of parsing, probing, and reporting
its structured contract.
