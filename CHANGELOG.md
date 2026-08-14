## Unreleased

### Breaking changes
- **sensors:** schema v2 materializes version-aware variants and reports
  compatibility explicitly. Legacy manifests and packs remain readable as
  `compatible-unverified`; re-run `awm sensors init` and review the generated
  migration before relying on certified coverage.

### Features
- **sensors:** add empirical coverage from bounded, sanitized ledger evidence
  and `awm sensors coverage --min <count>`.
- **ledger:** accept an optional reusable `--defect-class <id>` for coverage
  analysis.

## v6.5.2 - 2026-08-11

### Fixes
- **sensors:** allowlist coverage evidence paths (#74)

## v6.5.1 - 2026-08-11

### Fixes
- **sensors:** restrict dotfile coverage evidence

## v6.5.0 - 2026-08-11

### Features
- **sensors:** expose static coverage report
- **sensors:** resolve static coverage inputs
- **sensors:** inspect coverage evidence safely
- **sensors:** evaluate static coverage states
- **sensors:** validate coverage contract v1

### Fixes
- **sensors:** attest provider coverage evidence
- **sensors:** validate derived coverage status
- **sensors:** enforce coverage envelope invariants
- **sensors:** validate coverage report envelope
- **sensors:** harden coverage report rendering
- **sensors:** reject dangling coverage manifest links
- **sensors:** bound coverage evidence reads
- **sensors:** close coverage evidence symlink race
- **sensors:** harden coverage contract strings
- **test:** isolate harness verification environment

## v6.4.2 - 2026-08-10

### Fixes
- **provider-version:** distinguish shell "not found" from other failures on Windows
- **provider-version:** resolve codex's .cmd shim on Windows via shell:true
- **add:** honor --method on the bundle-activation path (was hardcoded to symlink)
- **remove:** --yes must also skip the scope prompt, not just the agent one
- **init:** keep --json stdout pure JSON on native Windows

## v6.4.1 - 2026-08-10

### Fixes
- **gate:** un track no podía congelarse NUNCA — R3.6 se evaluaba fuera de su scope
- **tracks:** el supervisor de un track no arrancaba si el plan cruzaba ACTIVE entre dos polls
- **tracks:** la descripción de `awm track remove` prometía un teardown que no ocurre
- **tracks:** un join pedido antes de la activación esperaba que lo descartaran
- **tracks:** awm track join no hacía nada, y el supervisor lo contaba como aplicado
- **update:** stop reporting success for work awm update did not do, and stop hanging on a prompt nobody can answer

## v6.4.0 - 2026-08-10

### Features
- **sensors:** give this repo a working security gate, and stop hiding sensor configs

## v6.3.0 - 2026-08-10

### Features
- **watch:** make provider agnosticism falsifiable via AWM_CONTROLLER_ARGV
- **tracks:** reconcile ownership-proven teardown after crashes
- **tracks:** validate final head once before global interlock
- **tracks:** reconcile durable joins across merge crashes
- **tracks:** freeze track and plan mutations before join
- **tracks:** bootstrap supervisors behind an armed cohort barrier
- **cli:** add request-only track commands and aggregate status
- **tracks:** authenticate track context and isolate local gates
- **tracks:** verify declared and actual independence fail-closed
- **tracks:** parse strict ownership and integration contract
- **journal:** add stable identities and track protocol entities
- **tracks:** prove durable cohort protocol with state exploration

### Fixes
- **tracks:** scope teardown convergence to POSIX and document the win32 gap
- **tests:** stop racing the bystander's lifetime against the slowest platform
- **tests:** make the canonical integration fixture runnable on Windows
- **process:** give win32 the identity guard POSIX already had before killing
- **tracks:** compare paths by filesystem identity, not by string
- **tracks:** close PGID-reuse identity gap in terminatePreviouslyOwnedGroup
- **tracks:** exclude JOINED from canCompleteCohort pendingTracks; isolate pause/request boundary split with fake-runtime test
- **tracks:** re-derive LIVE_COHORT_PHASES from traced causal chain; strengthen crash-point tests
- **tracks:** guard cycle-complete by live cohort phase, not tracks.length
- **tracks:** split integration-lock acquisition from merge attempt; trace merge/abort errors
- **watch:** keep retry-same-intent alive during track freeze
- **tracks:** correct duplicate-supervisor claim in comment, add crash-window test
- **tracks:** wire decidePrepare into the exploration harness, fix vacuous assertion
- **tracks:** check gitignore against created worktree, not stale HEAD
- **tracks:** thread supervisor nonce and enforce single-effect boundary
- **tracks:** derive concurrency cap from fingerprint benchmark
- **cli:** verify-independence catches ownership-assessment throws too
- **cli:** verify-independence structured errors on parser failures
- **tracks:** case-fold resource values and close coverage gaps

## v6.2.1 - 2026-08-10

### Fixes
- **sync,doctor,update-check:** close the last two open items

## v6.2.0 - 2026-08-10

### Features
- **doctor:** detect rendered artifacts that no longer match the registry

## v6.1.2 - 2026-08-10

### Fixes
- **doctor:** verify the CONTENT of rendered artifacts, not just their extension

## v6.1.1 - 2026-08-10

### Fixes
- **context-budget,hooks:** stop pinning at zero, and prune dead hook entries

## v6.1.0 - 2026-08-09

### Features
- **hooks:** make the pending-trust remedy executable, and close Codex at verified

## v6.0.0 - 2026-08-09

### Breaking Changes
- **providers:** resolve each agent's config root from its own env var

## v5.0.2 - 2026-08-09

### Fixes
- **hooks:** stop reporting HEALTHY for a hook that was never seen running

## v5.0.1 - 2026-08-09

### Fixes
- **release,doctor:** serialize releases, and give the sibling checks the ledger

## v5.0.0 - 2026-08-09

### Breaking Changes
- **init:** exit 0 when init did its job, even if the harness stays degraded

## v4.1.1 - 2026-08-09

### Fixes
- **doctor:** detect an AWM skill link replaced by third-party content

## v4.1.0 - 2026-08-09

### Features
- **remove:** non-interactive mode, symmetric with add (D-006) (#45)

### Fixes
- **doctor:** stop writing, and document the JSON shape it actually emits (#44)

## v4.0.0 - 2026-08-09

### Breaking Changes
- awm add installs bundles only, and record decisions where they last

## v3.13.7 - 2026-08-09

### Fixes
- **init:** canonicalise cwd so the backup list never names one file twice

## v3.13.6 - 2026-08-08

### Fixes
- close every remaining production-readiness finding (#39)

## v3.13.5 - 2026-08-08

### Fixes
- **frontmatter:** close the reader/writer gap a review exposed
- **frontmatter:** resolve YAML block-scalar descriptions in all four parsers

## v3.13.4 - 2026-08-08

### Fixes
- **tests:** retry the whole spawn, not just the liveness query, on windows-latest
- **journal:** widen pidExistsNative retry budget — 3x50ms wasn't enough
- **tests:** sync-gates.test.ts hit the same real-git-clone timeout+EBUSY gap
- **init:** stop awm init -a copilot from crashing on the ambient step too
- **init:** stop awm init -a copilot from crashing on the devCore step

## v3.13.3 - 2026-08-08

### Fixes
- **windows:** bounded retry for pidExistsNative's ESRCH — real CI flake

## v3.13.2 - 2026-08-08

### Fixes
- **cli:** make awm doctor actually show the Windows caveat, stop init tripling it

## v3.13.1 - 2026-08-08

### Fixes
- **windows:** revert spawnStructured detached hypothesis, scope SIGKILL-survival test to POSIX (R6 round 5)
- **windows:** spawnStructured survives parent death on win32, degrade activitySnapshot, harden remaining gaps (R6 round 4)
- **windows:** revert refIsAlive win32 to proven pid+group check, fix 3 remaining CI gaps (R6 round 3)
- **tests:** make stub-controller scripts and PATH construction cross-platform (R6)
- **tests:** correct win32 psArgsDigest expectations + adapter test mock scope
- **windows:** close remaining R6 CI round-2 gaps (identity check, symlink fallback, misc)
- **tests:** sweep remaining POSIX mode-bit assertions for Windows (R6)
- **windows:** resolve remaining real portability bugs found by R6 CI (windows-latest)
- **ci:** resolve the two dominant Windows/CI test-failure root causes (R6)

## v3.13.0 - 2026-08-08

### Features
- **preflight:** legacy-adoption ratchet discoverability (R5) (#31)

## v3.12.0 - 2026-08-08

### Features
- **providers:** add Cursor and GitHub Copilot support (R4) (#30)

## v3.11.0 - 2026-08-08

### Features
- **sensors:** remove FALLBACK_DEFAULTS, shell detection, --pack override (R3) (#29)

## v3.10.0 - 2026-08-07

### Features
- **preflight:** advisory host check for gh/glab availability (#28)

## v3.9.1 - 2026-08-07

### Fixes
- **sensors:** win32-safe backslash quoting + refuse-not-escape for cmd.exe metachars
- **sensors:** match CommandLineToArgvW quote-escaping on win32
- **sensors:** quote --changed file args for cmd.exe, not just POSIX shells
- **sensors:** reuse isWindowsNative, add POSIX success-path test
- **sensors:** resolve PATH portably in status checks (Windows hotfix)

## v3.9.0 - 2026-08-07

### Features
- **preflight:** verify the harness can gate before development starts

## v3.8.0 - 2026-08-07

### Features
- **context-budget:** make the budget check a command so it can run where a human is

## v3.7.0 - 2026-08-07

### Features
- **sensors:** add --changed to scope opted-in sensors to the diff

## v3.6.0 - 2026-08-07

### Features
- **sensors:** kill the process tree on timeout, keep partial findings, run sensors in parallel

## v3.5.0 - 2026-08-02

### Features
- **watch:** implement job observationState suspected-stall via log staleness (R3.5)
- **cli:** wire all awm job verbs (incl. list/show/reconcile/reap/exec-wrapper) and awm watch
- **watch:** foreground loop with drain-before-complete, custody retains lock, mechanical plan-vs-repo init
- **watch:** generation state machine, dual-signal stall, custody BLOCKED, confirmed ladder
- **watch:** concurrent runner — detached wrapper spawn, sidecar collection, integrated reconcile
- **watch:** transactional request application — state, journal, then delete; entity-creating handlers
- **watch:** exclusive wx lock with full-identity validation and branch invariant
- **job:** cycle export with phase timestamps, real dispatch counts, evidence hashes, baseline comparison
- **job:** fail-closed gate with fingerprint currency, single recovery matrix, explicit reap
- **job:** agent verbs — request intent with real cwd, heartbeat, ps/list/show queries
- **journal:** ControllerAdapter with positive-evidence safeToReplace
- **job:** external exec-wrapper with durable claim/identity/result handshake
- **journal:** durable request publication, idempotency aliases, state-derived acks
- **journal:** canonical snapshot store with monotonic revision, corrupt-aware reads, best-effort events
- **journal:** full-tuple process identity, whole-group confirmed termination
- **journal:** fingerprint with real index digest, parametric cwd, journal exclusion
- **journal:** emitter-side secret redaction and literal-secret rejection
- **journal:** branch-scoped paths, worktree-scoped supervisor lock
- **core:** writeFileAtomicDurable with throwing directory fsync
- **journal:** entity types, separated state enums, full-tuple ProcessRef, shape guards

### Fixes
- **watch:** harden durable controller recovery
- **watch:** retain ownership through process shutdown
- **watch:** close fail-open verification gaps
- **job:** align verdict idempotencyKey scope with generation-scoped verdictId; drop taskId from unredacted rejection message
- **job:** deterministic verdictId + next-action in register help text (Fix3, Fix8)
- **journal:** post-implementation-qa cluster fixes 1,2,4,5,6,7,8 in apply.ts/requests.ts
- **process:** harden remaining execFileSync git calls against EPIPE relay (lock.ts, job/index.ts, watch/index.ts, fingerprint.ts)
- **process:** explicit stdio on execFileSync calls prevents inheritStderr EPIPE relay to caller
- **process:** spawnStructured uses stdio:ignore — pipe+destroy caused silent EPIPE crash in detached wrapper
- **cli:** job export --baseline guards unreadable/malformed JSON with a clear error
- **watch:** guard reconcile's result-sidecar shape before adopting completion; test malformed sidecar reads in runner
- **watch:** reject unrecognized request kind as corrupt instead of silently discarding; fsync dir on corrupt-only batches
- **journal:** emitRequest uses directory-scan sequence, not in-process counter, to preserve causal order across separate CLI processes
- **journal:** emitRequest uses monotonic counter to guarantee emission-order sorting under timestamp collisions
- **watch:** releaseLock uses handle.path instead of recomputing it
- **job:** reconcile backfills spawnNonce for adopted results; export declares unobservable for reversed timestamps
- **job:** gate validates reviewObligation verdictId referential integrity; add reap.ts test coverage
- **journal:** capture-time psField calls degrade to unknown, never propagate ps execution failures
- **journal:** activitySnapshot degrades gracefully if ps fails reading cpu time
- **journal:** refIsAlive never treats a ps execution failure as proof of death
- **journal:** only bound the prefix ASSIGNMENT quantifier, unbounded suffix caused long-identifier secret leak
- **journal:** bound ASSIGNMENT regex quantifiers to prevent ReDoS; clear stdio grace timer on close
- **job:** exec-wrapper uses exit + bounded stdio grace window, not unbounded close, to avoid hang on inherited descendant fds
- **job:** exec-wrapper waits for stdio close, not exit, before finalizing result
- **journal:** writeJournal rejects state.branch mismatched with target branch
- **journal:** writeJournal validates outgoing state shape before persisting
- **journal:** fingerprint uses -z for unquoted paths (fixes non-ASCII collision), removes maxBuffer ceiling
- **journal:** recognize single-dash keyword flags; document single-letter-mnemonic limitation
- **journal:** redesign redactArgv as fail-closed chain redaction, revert findLiteralSecretFlag to simple all-or-nothing reject
- **journal:** anchor sibling-flag detection to word boundaries, not substring match
- **journal:** redact.ts value-token heuristic no longer bypassed by -- prefixed secrets
- **journal:** branchSlug uses collision-free bijective encoding
- **journal:** isWellFormedJob validates all required fields, not a subset

## v3.4.0 - 2026-07-30

### Features
- **export:** add pathless rewriting of intra-registry references
- **ledger:** cluster by ref and lexical affinity, labelling convergence
- **ledger:** add pure similarity primitives for recurrence clustering

### Fixes
- **export:** derive pathlessForm from PATH_SRC's own fragments, closing the desync risk
- **ledger:** stop crashing on shape-invalid-but-valid-JSON ledger entries
- **export:** strip dead intra-registry paths from mechanically exported bodies
- **export:** make path stripping a single pass, closing a splicing bug
- **ledger:** recurring groups by similarity, not exact signature only

## v3.3.1 - 2026-07-28

### Fixes
- **init:** preserve and emit failed-step evidence on `awm init --json`

## v3.3.0 - 2026-07-27

### Features
- **sensors:** an enabled sensor with no cmd is inconclusive, not skipped
- **sensors:** an uninterpretable sensor exit is inconclusive
- **sensors:** truncated sensor output is inconclusive, not a benign skip
- **sensors:** add inconclusive status so a sensor that could not certify is never green

### Fixes
- **sensors:** keep the baseline away from results with no verdict
- treat exit 127 as a missing sensor tool so dash hosts stop reading absent tools as green

## v3.2.2 - 2026-07-25

### Fixes
- don't let unrelated project degradation fail a --machine-only init

## v3.2.1 - 2026-07-25

### Fixes
- allow a Codex-only bootstrap to pass the R19 Claude-baseline guard

## v3.2.0 - 2026-07-25

### Features
- diagnose Codex coexistence
- converge all enabled agents
- install and diagnose Codex hooks
- apply artifact plans transactionally
- plan shared multi-agent artifacts
- render canonical agents for Codex
- inject managed Codex guidance
- add call-time Codex provider
- track enabled agent targets

### Fixes
- stepActivation trips the same shared-group refusal as stepDevCore
- don't refuse init when a co-owner agent shares the skill target
- escape full C0 control-character range in TOML multiline strings
- enumerate the global skills directory in planInitMutationTargets
- wrap sync.ts's syncProfile call in try/catch
- merge artifact-state records instead of wholesale overwrite
- break circular type import in hooks dispatcher/adapter split
- share physicalTarget between install-planner and mutation-targets
- distinguish not-applicable from unsupported; don't mask broken shared skills
- add hash-exclusion unit test, deconflict gatherProviderFacts naming
- recursive baseline hashing, reconciliation test coverage, and CLI polish
- Codex hook idempotence, trust gating, and label display
- harden rollback test, manifest hashes, and timestamp sanitization
- report all owners of a shared-target install
- prevent target-path collisions and document init gap
- use escaped NUL separator in planner group key
- escape control characters in multiline TOML strings
- correct TOML escaping and validation in Codex agent renderer
- validate managed boundary metadata
- harden managed Codex guidance writes
- report provider preflight failures
- preflight legacy provider operations
- gate unsupported Codex provider mechanics
- validate complete preferences

## v3.1.0 - 2026-07-23

### Features
- **export:** awm export command wired into the CLI (#9)
- **export:** engine orchestration — resolve, adapt, pack, offline-only (#9)
- **export:** deterministic artifact writer with layered system-zip (#9)
- **export:** bundle/skill resolution with portability gate and override consistency (#9)
- **export:** claude-ai mechanical transform — pure function, line-based frontmatter (#9)

### Fixes
- **export:** escape apostrophe in single-quoted YAML description, throw on trailing inline comment
- **export:** refuse symlinks in skill references/ (BLOCKER security fix)
- document --out subfolder and surface export kind in summary
- **export:** strengthen R1.4 test and narrow transform try/catch
- **export:** resolve skills via discoverSkills to respect registry overrides
- **export:** tolerate CRLF frontmatter and single-quoted descriptions

## v3.0.1 - 2026-07-22

### Fixes
- **cli:** default agent to claude-code + persist agent on init (#7)

## v3.0.0 - 2026-06-25

### Breaking Changes
- **ws4:** remove registry/ and install.sh — content lives in awm-*-registry repos, CLI ships via npm

### Features
- **release:** bin index.ts, npm script release y gitignore de .npmrc
- **release:** gates de preflight con orden de contrato (CONSTITUTION)
- **release:** orquestador release() con IO inyectable (happy path + dry-run)
- **release:** renderChangelog agrupado por tipo
- **release:** selectFloor reusa compareSemver para monotonicidad
- **release:** nextVersion con validación semver fail-loud
- **release:** determineBump por Conventional Commits
- **release:** parseCommits + tipos del core
- **add:** --all flag installs all artifacts from all packages headlessly
- **add,list:** wire two-pane picker and width-aware list with non-interactive fallback
- **list:** width-aware static renderers + picker-item builders; drop clack option builders
- **ui:** interactive multiselect shell with inline redraw and guaranteed restore
- **ui:** pure key parser and picker state reducer
- **ui:** pure picker renderer (two-pane / one-pane, scroll, filter)
- **ui:** terminal probes (isInteractive, terminalSize)
- **ui:** width-aware text utilities (stripAnsi, displayWidth, truncate, wrap)
- **doctor:** show detected platform with WSL hint on native Windows
- **cli:** warn native-Windows users toward WSL on init/sync (best-effort)
- **hooks:** fall back to copy when skill symlink fails (best-effort cross-platform)
- **paths:** add core/paths.ts single source of truth for home/platform
- **ws4:** paquete npm 2.0.0 + E2E del tarball
- **ws4:** update-check — aviso pasivo cacheado + self-update con confirmación
- **ws4:** awm init siembra baseline y bootstrapea por syncRegistries
- **ws4:** handlers uniformes — un solo loop de sync, gates minCliVersion, muere buildCli del update
- **ws4:** syncRegistries uniforme + verifyMinCliVersions
- **ws4:** seedBaselineRegistry; contentRoots sin base especial
- **ws4:** capabilityRoot — resolución por capacidad
- **ws4:** minCliVersion en awm-registry.json
- **ws4:** cliVersion + compareSemver

### Fixes
- **release:** remove registry-url to fix OIDC 404, detect via ACTIONS_ID_TOKEN_REQUEST_URL
- **release:** OIDC trusted publisher + auto-trigger on push to main
- **release:** add prerelease build hook so npm run release auto-builds dist/
- **release:** --branch without value throws instead of silently defaulting
- **release:** rollback commit+tag if npm publish fails
- **ui:** add CJK, Hangul Syllables, and Full-width ranges to isWide()
- **ui:** toggleAll operates on visible items only (respects active filter)
- **ui:** add SIGINT handler to multiselectPicker for terminal restoration invariant
- **ui:** toggleAll syncs ALL_SENTINEL; clear error for unknown bundle in non-TTY
- **ui:** sync ALL_SENTINEL when toggling individual items (stale-sentinel bug)
- **list:** empty-string fallback in artifactPickerItems; mark index.ts scaffolding for Task 7
- **ui:** account for wide cursor glyph (❯ = 2 cells) in label width calc
- **qa:** remove redundant wrapper in diagnostics/context; restore outside-cwd fallback in eslint formatter
- **sensors:** use path.relative for cwd-relative eslint paths (cross-platform)
- **ws7:** QA B1-B3 — translate missed Spanish strings + clarify mutation --slow doc
- **ws4:** post-qa fixes — B1 version hardcode, B2 sensor root, B3 TTL test
- **ws4:** address code-quality review findings — stale paths + dead scripts
- **ws4:** update-check timer .unref() — eliminates Jest open handle warning
- **ws4:** checks.ts — registry cache missing remedy is awm init not update
