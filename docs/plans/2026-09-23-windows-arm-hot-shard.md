# Windows ARM hot-suite shard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten the Windows ARM CI gate without losing tests or weakening publication.

**Architecture:** Keep the six existing matrix jobs and make their Windows ARM member omit two measured slow suites. Add one independent ARM job that runs those suites by exact path and does not upload a native artifact. The release job must need both jobs.

**Tech Stack:** GitHub Actions YAML, Jest 30, TypeScript structural tests.

**Modo de ejecución:** interactivo

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"issue-159-windows-arm-hot-shard","requirements":["RF-159.1","RF-159.2","RF-159.3","RNF-159.1","RNF-159.2"],"sources":[{"id":"SRC-DESIGN","path":"docs/plans/2026-09-23-windows-arm-hot-shard-design.md","locator":"## Requirements","fact":"Two named watch suites get a dedicated ARM64 job; the original matrix keeps the only native artifact and release depends on both test jobs."},{"id":"SRC-TEST","path":"cli/tests/structural/native-release-artifacts.test.ts","locator":"describe('native release artifacts'","fact":"Existing structural assertions protect platform coverage, native build order and artifact identity."},{"id":"SRC-CI","path":".github/workflows/ci.yml","locator":"jobs:","fact":"Six-entry matrix builds native artifacts, runs Jest in-band and performs published-consumer acceptance."},{"id":"SRC-RELEASE","path":".github/workflows/release.yml","locator":"jobs:","fact":"Release job currently needs only the matrix test job."}],"commands":[{"id":"CMD-STRUCTURAL","program":"npm","args":["--prefix","cli","test","--","tests/structural/native-release-artifacts.test.ts","--bail"],"covers":["RF-159.1","RF-159.2","RF-159.3","RNF-159.1"]},{"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["RF-159.1","RF-159.2","RF-159.3","RNF-159.1"]},{"id":"CMD-SENSORS","program":"awm","args":["sensors","run"],"covers":["RF-159.1","RF-159.2","RF-159.3","RNF-159.1"]},{"id":"CMD-PR-JOBS","program":"gh","args":["run","list","--workflow","ci.yml","--limit","2","--json","databaseId,conclusion,createdAt"],"covers":["RNF-159.2"]}],"slices":[{"id":"S1","title":"Partition Windows ARM suites without weakening release","requirements":["RF-159.1","RF-159.2","RF-159.3","RNF-159.1","RNF-159.2"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-DESIGN","SRC-TEST","SRC-CI","SRC-RELEASE"],"redCommands":["CMD-STRUCTURAL"],"greenCommands":["CMD-STRUCTURAL","CMD-TYPECHECK","CMD-SENSORS","CMD-PR-JOBS"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["If PR CI is red or slower, preserve the full six-platform gate, amend this plan, and revert or tune only the ARM partition after measuring real jobs."]}],"closureCommands":["CMD-STRUCTURAL","CMD-TYPECHECK","CMD-SENSORS","CMD-PR-JOBS"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Partition Windows ARM suites without weakening release

#### Surfaces
Own RF-159.1, RF-159.2, RF-159.3, RNF-159.1 and RNF-159.2 together because the two workflow files and their structural test form one CI gate. Change only `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `cli/tests/structural/native-release-artifacts.test.ts`. The design source fixes the two exact paths and acceptance criteria.

#### Implementation
- [ ] Extend `native-release-artifacts.test.ts` first. Assert both workflows have exactly one `windows-arm-hot` job with `runs-on: windows-11-arm`, both exact suite paths in its Jest command, an ARM-only matrix remainder that excludes exactly those paths, and no artifact upload in the hot job. Assert release has `needs: [test, windows-arm-hot]`; retain the existing six targets and `--runInBand --bail`.
- [ ] Run CMD-STRUCTURAL and observe RED on the missing hot job.
- [ ] In each workflow add a hot job with checkout, Node 22, `npm ci`, `npm run native:build && npm run build`, `npm run native:test-build`, and `npx jest --runTestsByPath tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-freeze.test.ts --runInBand --bail` from `cli`. No upload step appears in that job.
- [ ] Change only the Windows ARM matrix Jest step to exclude those paths; all other matrix members still run `npx jest --runInBand --bail`. Keep the published-consumer steps in the original CI matrix job. In release set `needs: [test, windows-arm-hot]` so publication fails closed if either shard fails.
- [ ] Run CMD-STRUCTURAL GREEN, CMD-TYPECHECK, and CMD-SENSORS from the repository root. Compare Jest `--listTests` full vs remainder+hot by normalized exact paths and assert zero overlap and zero omission. Read the PR job log before claiming any runtime gain.

#### Edge cases
An unchanged non-ARM matrix leg must still run every suite. Neither ARM shard may accept `--passWithNoTests`. A typo in either hot path must make Jest fail; a missing hot job must block the release through `needs`. The matrix alone uploads `secure-fs-win32-arm64`, avoiding duplicate artifact names. Keep both Jest invocations serial; do not change test timeouts, global config, or test internals.

#### Evidence
SRC-DESIGN defines requirements; SRC-TEST supplies the RED/GREEN structural gate; SRC-CI and SRC-RELEASE define the native and release boundary. CMD-STRUCTURAL proves static partition and dependency properties, CMD-TYPECHECK protects TypeScript, CMD-SENSORS applies the project gate. Jest list comparison proves local set coverage; the real seven-job PR run is the only wall-clock evidence for RNF-159.2. Distinct clean specification and code-quality reviews, current sensor evidence, and current plan digest remain required.

#### Fallback
If Windows CI or release behavior disagrees with Linux list evidence, inspect the exact failed job and preserve all existing tests. Record any change to suite selection or job dependencies as a plan amendment, revalidate and re-admit it, then rerun the same gates. Do not switch to parallel Jest workers as a fallback.
