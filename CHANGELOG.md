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

