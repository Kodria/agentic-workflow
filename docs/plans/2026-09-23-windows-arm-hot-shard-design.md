# Windows ARM hot-suite shard — design

## Requirements

- **RF-159.1:** WHEN CI or release tests run on Windows ARM64, THE workflows SHALL execute `track-finalize.test.ts` and `track-freeze.test.ts` in a dedicated job and exclude them from the ARM64 matrix job, so the union equals the unsharded suite with no duplicates.
- **RF-159.2:** IF either Windows ARM64 shard fails, THEN THE release workflow SHALL not publish; all other platform gates SHALL remain required.
- **RF-159.3:** WHEN the ARM64 hot-suite job runs, THE workflows SHALL build the production and test-only native addons but SHALL NOT upload a second `win32-arm64` release artifact.
- **RNF-159.1:** WHEN the new jobs run, THE workflows SHALL retain `--runInBand --bail` and shall not introduce Jest worker parallelism.
- **RNF-159.2:** AFTER a PR run, THE team SHALL compare the slowest successful job with the 20m53s post-merge baseline before deciding whether #159 is complete.

## Decision

Add a seventh, dedicated `windows-arm-hot` job to each workflow. The existing six-entry matrix remains responsible for typecheck, sensor-matrix validation, published-consumer acceptance, and exactly one native artifact per target. On ARM64 only, its main Jest command excludes the two named suites; the new job installs, builds both native addons, and runs those two suites by exact path. The release job depends on both the matrix and the new hot job.

This preserves process isolation and does not require an audit for concurrent Jest workers. It does consume one additional ARM64 runner per workflow. The alternative of `--maxWorkers` was rejected for this slice because tests change process-global and filesystem state; broad deterministic sharding was rejected because it may not separate the measured bottlenecks. The jobs remain independently revertible if the PR measurement shows no useful wall-clock gain.

## Verification

1. A structural regression test checks both workflows' hot-job commands, one artifact upload per target, and `release.needs: [test, windows-arm-hot]`.
2. Jest `--listTests` compares full-suite paths against the union of the ARM remainder and hot paths, with no intersection.
3. PR CI must pass all seven jobs; compare job and Jest durations with [run 35798322319](https://github.com/Kodria/agentic-workflow/actions/runs/35798322319). Do not claim a speedup from local Linux timing.

## Scope

No production CLI behavior, test semantics, registry, or global AWM installation changes. Issue #159 stays open until the real Windows ARM measurement supports closure.
