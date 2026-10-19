<!-- AWM:CONTEXT-KERNEL:START v1 -->
<!-- awm-context:CTX-AGENTS-001 -->
# AGENTS.md — Guía de mantenimiento de AWM

<!-- awm-context:CTX-AGENTS-002 -->
Esta es la guía de mantenimiento de este repo (el CLI de AWM) — no la función del propio CLI que genera un `AGENTS.md` para *otros* proyectos (ver `cli/src/core/context/strategies/`, `cli/src/core/renderers/`). Cada entrada es un patrón confirmado contra el código real, curado con la misma disciplina merge-and-prune que `harness-retro` aplica en cualquier proyecto: fusionar lo nuevo en la sección que corresponde, podar lo que ya no aplica, nunca apilar un log crudo. La procedencia detallada (release, fecha, commit) vive en el historial de git y en `docs/plans/`; acá va la lección accionable, no el diario de la sesión. Todo agente que trabaje en este repo debe leerlo antes de tocar código.

<!-- awm-context:CTX-AGENTS-003 -->
---

<!-- awm-context:CTX-AGENTS-058 -->
## Layout del repo y de la instalación

<!-- awm-context:CTX-AGENTS-059 -->
- **Este repo** contiene solo el CLI TypeScript (`cli/`). El contenido (skills, bundles, sensor-packs, hooks) vive en repos externos: `awm-baseline-registry` y `awm-documentation-registry`.
- **No hay `registry/` en este repo** ni `~/.awm/cli-source/`. El concepto `cli-source` fue eliminado.
- **Layout de instalación:** `~/.awm/registries/<name>/` — cada registry configurado se clona ahí. Los skills se instalan como symlinks hacia esos paths.
- **Descubrimiento de contenido:** `contentRoots()` devuelve los paths bajo `~/.awm/registries/` según la config. No hay constante fija de `baseRoot` ni de `cliSource`.

<!-- AWM:CONTEXT-KERNEL:END v1 -->

## Lessons (merge-and-prune)

- **Soft-recover / alternate parse paths must reuse the hard-path trust boundary.** When `run` soft-isolates invalid sensor entries after `resolveSensorProject` returns `invalid`, recovery MUST call the same regular-file + UTF-8 + `packageRoot` realpath-containment helpers as the configured path — never a second `path.resolve` + `existsSync` resolver. Confirmed #209 QA: soft-recover accepted a symlink `packageRoot` escape and symlink manifests that hard-parse rejected (blockers). Shared helpers live in `cli/src/commands/sensors/project.ts` (`softRecoverInvalidProject`, `resolveContainedPackageRoot`).
- **Status and run must share collision and soft-isolation semantics.** Dual readiness surfaces (`status` checks vs `run` `invalidEntries` / prepare) that disagree on pack name collisions or sibling isolation are defects, not “static vs empirical” differences. RF-1.7 collision and soft-isolate checks belong on both paths (configured and softIsolatedChecks).
- **Docs/contract asserts must scope to the body section they claim to protect.** A regex over the whole `SKILL.md` (including frontmatter `description`) is vacuous if deleting the section still passes — slice after frontmatter / extract `## Section` first. Same class as vacuous `assert.match` lessons already enforced in baseline-registry contracts.
- **A CLI command that writes into the user's repo must make that state self-ignoring and never certify partial evidence.** `awm sensors run` writes `.awm/sensors/runs/<commit>.json` (0600) plus a `.gitignore` containing `*` in the same directory, so `git add -A` can never commit local evidence in a repo that does not ignore `.awm`; and it withholds the receipt when the run was partial, dirty, not the root manifest, skipped everything or dropped invalid entries (R2.2b/R2.2c of the Change Record design). Confirmed #217 final review + QA: a receipt written for a schema-invalid manifest certified `pass` for fewer sensors than declared.
- **Untrusted text and git calls have one door each.** Anything that comes from git (subjects, branch/tag names, paths, remote URLs), YAML or flags is printed only through `esc()`/`clipMessage` (`cli/src/core/changes/text-safety.ts`, bidi included) and every git child runs through `execGit`/`runGit`/`gitState` (`cli/src/core/changes/git-env.ts`: scrubbed `GIT_*` variables, bounded time/output, `GIT_NO_LAZY_FETCH`). Enforced by `tests/structural/change-record-git-and-platform-conventions.test.ts`; the same guard keeps change-record tests on `posixOnly` (a silent `if (win32) return` reports PASS on the 3-platform release gate).
- **When self-verifying, `awm` on the PATH may predate the working tree.** `awm sensors run` with an older installed binary proves lint/typecheck/depcheck, not the new CLI behavior; exercise new commands through `cli/dist` in a throwaway repo with `HOME`/`AWM_HOME` overridden (as `post-implementation-docs` requires), and compare failing suites against a pristine `origin/main` worktree before calling failures environmental (233 failures here, 123 from the unbuilt native `secure_fs` addon, all identical on main).
- **What works for large slices (win, #217):** write cross-cutting conventions into the plan as amendments before dispatching (A3–A8 cut review rounds from ~10 to ~3 per slice), tell reviewers to report every violation in the first pass and later rounds to verify only the fixes, and settle each reviewer-found ambiguity in the design clause (amend → `awm plan validate` → `awm plan admit`, sequentially) instead of widening the code.
- **Bounds on untrusted parse must stop work, not only trim the message.** A size/problem cap that slices the joined diagnostic after `readPairs`/`match` still allocates the hostile input; stop accumulating lines/problems at the cap, and refuse alias-shaped tokens (`/[&*][A-Za-z0-9_-]+/`) before every `yaml.load` on registry content. Confirmed #225/#226 QA: emit-only caps and slug-only alias guards left full-block `loadBlock` and unbounded `lines[]` open. Regression: `cli/tests/core/frontmatter-hardening.test.ts`, `cli/tests/core/process/model.test.ts`.
- **Ledger findings belong on the execution branch.** `awm ledger add` defaults to the current git branch; findings recorded on `main` before `git checkout -b` are invisible to `awm ledger list` / harness-retro on the feature branch (empty-ledger false clean). Prefer branching before Phase-1 ledger writes, or pass `--branch` explicitly.
