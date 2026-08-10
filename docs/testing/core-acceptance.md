# Core acceptance suite

The checks that must pass **identically on every OS and every agent**. Run this first; the OS and agent playbooks only cover the deltas on top of it.

Estimated time: 15–20 minutes.

## Setup

```bash
# Linux / macOS
export AWM_HOME="$HOME/.awm-e2e"
WORK=$(mktemp -d) && cd "$WORK" && git init -q -b main . && git commit -q --allow-empty -m init
```

```powershell
# Windows PowerShell
$env:AWM_HOME = "$HOME\.awm-e2e"
$WORK = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid()))
Set-Location $WORK; git init -q -b main .; git commit -q --allow-empty -m init
```

Teardown when you're done: delete `$AWM_HOME` and `$WORK`.

---

## Los exit codes de `awm init`

| Código | Significa | Qué hacer |
|---|---|---|
| `0` | **Init hizo su trabajo.** Puede quedar `degraded` — normalmente dos pasos `pending` que escribe una sesión de agente (`CONSTITUTION.md`, `AGENTS.md`) — y eso sigue siendo un éxito. | Seguir. `awm init --yes && <siguiente>` es seguro. |
| `2` | **No se completó.** O un gate rechazó (binario del agente ausente o por debajo del mínimo), o algún paso falló y el run se revirtió entero. | Leer el mensaje. Un `2` con causa clara es un rechazo *correcto*, no un bug. |

`awm init` **no usa exit `1`.**

> **Esto cambió en la v5.0.0.** Antes, un run donde no fallaba nada salía `1` solo porque
> el harness quedaba `degraded` — y este documento tenía un recuadro pidiendo *ignorá el
> exit code*. Tres lectores independientes lo reportaron como fallo antes de que lo fuera,
> y `awm init --yes && …` moría bajo `set -e`, en el único comando cuyo trabajo entero es
> arrancar un script. Ver [`decisions.md`](../decisions.md) D-008.

La salud del harness la responde `awm doctor`, y el JSON de `init` la sigue trayendo:

```bash
awm init --yes --json > init.json; echo "exit=$?"
```

```json
{ "result": "degraded", "applied": 4, "pending": 2, "failed": 0 }
```

- `failed: 0` → **no se rompió nada.** `pending` cuenta pasos que necesitan una sesión de agente.
- `failed: > 0` → falla real. `awm init` es transaccional: revierte todo lo que tocó, y `modifiedFiles` lo lista.

Para un script, `$?` alcanza. Para saber si además quedó algo pendiente, mirar `result`.

---

## CORE-01 · The CLI installs and reports its version

```bash
npm i -g agentic-workflow-manager
awm --version
```

**Expect:** a semver string; exit `0`. Compare it against the latest on [npm](https://www.npmjs.com/package/agentic-workflow-manager).

## CORE-02 · Help lists every command

```bash
awm --help
```

**Expect:** exit `0`, and these commands present: `add`, `update`, `sync`, `list`, `remove`, `hooks`, `sensors`, `ledger`, `context-budget`, `preflight`, `doctor`, `backup`, `init`, `registry`, `pin`, `unpin`, `export`, `agent`, `job`, `watch`.

## CORE-03 · Bootstrap a project

```bash
awm init --yes --json > init.json; echo "exit=$?"
```

**Expect:** `failed: 0`. `result` is `degraded` (typical) or `ok`. On a first run `applied` ≥ 1.

**Also expect on disk:** `$AWM_HOME/registries/baseline/` exists and contains `skills/`.

> If `registries/` is empty, the baseline clone failed — usually network or auth. That is a **FAIL**; capture the output of `awm update` for the real error.

## CORE-04 · Bootstrap is idempotent

```bash
awm init --yes --json > init2.json; echo "exit=$?"
```

**Expect:** `failed: 0`, and `applied` is `0` or lower than the first run — the second pass finds the work already done. **Any new failure on a second identical run is a FAIL.**

## CORE-05 · Read the state

```bash
awm doctor --json > doctor.json; echo "exit=$?"
```

**Expect:** exit `0`. JSON has a `providers` array; each entry has `id`, `label`, `tier`, and a `checks` array whose entries carry `id` and `state`. No check should be in an error state that contradicts what you just installed.

## CORE-06 · List available content

```bash
awm list
```

**Expect:** exit `0` and a non-empty package summary. Empty output here means the registry didn't seed — cross-check CORE-03.

## CORE-07 · Install one artifact non-interactively

```bash
awm add dev --scope global --method symlink --agent claude-code --yes
```

**Expect:** exit `0` and a line naming the installed artifact. Where it lands depends on the agent — see [agent-matrix.md](agent-matrix.md). For `claude-code`/global that is `~/.claude/skills/development-process`.

## CORE-08 · Installing twice is safe

Run CORE-07 again verbatim.

**Expect:** exit `0`, no duplicate entry, no crash. Re-installing an already-installed artifact must be a no-op or a clean replace.

## CORE-09 · The project profile records local installs

```bash
awm add dev --scope local --method symlink --agent claude-code --yes
cat .awm/profile.json
```

**Expect:** valid JSON whose `extensions` includes `dev`. This file is meant to be **committed** — it is how a teammate reproduces your setup with `awm sync`. The global install in CORE-07 is deliberately absent: machine-scope artifacts are not project extensions.

## CORE-10 · Rebuild from the profile

```bash
awm sync; echo "exit=$?"
```

**Expect:** exit `0`. This is the "fresh clone on a new machine" path: it rebuilds links from `profile.json` alone.

## CORE-11 · Sensors initialise for the detected stack

```bash
awm sensors init
cat .awm/sensors.json
```

**Expect:** exit `0` and a manifest. On an empty repo the stack is `generic` and the manifest may legitimately be **empty** — AWM does not invent defaults. To exercise a real stack, `npm init -y` first and re-run; expect the `js-ts` pack.

If your registry ships no pack for the detected stack, the command must **say so** — a
`No '<stack>' sensor-pack in the registry` warning naming the pack it wrote instead. An
empty or fallback manifest written silently is a FAIL: the whole point is that you learn
the gate is thin at the moment it is created, not from an unrelated command days later.

## CORE-12 · Sensors run and report honestly

```bash
awm sensors run; echo "exit=$?"
```

**Expect:** each configured sensor reported with a real state. A sensor whose tool isn't installed must report a clear `fail` explaining that the gate could not run it — **never silently `pass`**. A non-zero exit from `awm sensors run` is correct when the output reports findings or a missing tool.

## CORE-12b · `sensors run` changes nothing

`awm sensors run` measures the tree; it must not edit it. This check exists because it
once did — it rewrote the committed manifest and copied pack config files into the repo,
so merely running the gate produced a dirty working tree.

```bash
git status --porcelain > before.txt
awm sensors run > /dev/null 2>&1
git status --porcelain > after.txt
diff before.txt after.txt && echo "OK: working tree unchanged"
```

**Expect:** no difference. Any new, modified, or untracked file is a FAIL — including a
rewritten `.awm/sensors.json`.

To see the drift report instead of a silent rewrite, put the manifest on `generic` over a
real stack (`npm init -y` with `"pack": "generic"` in `.awm/sensors.json`) and run again:
the output must carry a `packDrift` field naming the detected pack and pointing at
`awm sensors init`, and the manifest must still be byte-identical.

## CORE-12c · `awm sync` repairs project links and names its transaction

```bash
ln -s /nonexistent/gone .claude/skills/gone      # an orphan nothing can serve
awm sync; echo "exit=$?"
```

**Expect:** exit `0`, a `✂  Pruned dangling gone` line, and a final `transaction <id> —
undo with awm backup restore <id>` line. A dangling link left in place is a FAIL, and so
is a sync that installs without telling you how to undo it. Your own real files and
directories under `.claude/skills/` must be untouched.

## CORE-13 · Preflight tells you whether the harness can gate

```bash
awm preflight --json > pre.json; echo "exit=$?"
```

**Expect:** a JSON report with per-check results. Advisory checks (e.g. git-host detection for PR automation) must never flip the overall status on their own.

## CORE-14 · Context budget is measurable

```bash
awm context-budget
```

**Expect:** exit `0` and either a size report for the files injected into every agent session, or `unmeasurable` when none of those files exists yet. In the latter case the command must not pin a 0KB budget. This is the guard against context bloat as a team's registry grows.

## CORE-15 · Export produces an uploadable artifact

```bash
awm export mermaid-diagrams
```

**Expect:** exit `0` and a folder (plus a zip, if zip is available) under `awm-export/`. Open the exported `SKILL.md`: its frontmatter must be valid YAML and its description must end with the "defer to the registry" deference sentence.

> A missing zip with an explicit "zip unavailable" note is **not** a failure — the folder is the real deliverable.

## CORE-16 · Update is safe to run repeatedly

```bash
awm update; echo "exit=$?"
awm update; echo "exit=$?"
```

**Expect:** both runs complete without error. The second is effectively a no-op. `awm update` moves *content*; the CLI itself updates separately via `npm i -g agentic-workflow-manager@latest`.

## CORE-17 · Removal is clean

```bash
awm remove
```

**Expect:** an interactive picker; removing an artifact deletes its link/rendered file and drops it from `profile.json`. Re-running `awm doctor` afterwards must not report the removed artifact as broken or missing.

## CORE-18 · Backups exist and are inspectable

```bash
awm backup list
```

**Expect:** exit `0`; AWM's filesystem backups under `$AWM_HOME/backups` are listed. Any command that rewrote a user-owned file (`AGENTS.md`, agent settings) should have left a restorable copy.

## CORE-19 · The ledger records and reads back

```bash
awm ledger add --phase debugging --source-skill systematic-debugging \
  --polarity finding --class logica --signature e2e-smoke \
  --severity minor --desc "e2e smoke entry" --ref README.md:1
awm ledger list
```

**Expect:** exit `0` and the entry present with the fields you passed. The ledger is per-branch and is what the retro phase learns from.

## CORE-20 · Nothing leaked outside the sandbox

```bash
ls ~/.awm 2>/dev/null && echo "⚠ real ~/.awm exists — confirm this run did not write to it"
```

**Expect:** with `AWM_HOME` overridden, this run must have written only under `$AWM_HOME`. If your real `~/.awm` changed timestamps during this suite, that is a **FAIL** and a serious one.

---

## Result sheet

| ID | Result | Notes |
|----|--------|-------|
| CORE-01 | PASS | 2026-08-10, macOS 15.6 arm64, Node 24.18.0, AWM 6.4.1 matched the npm latest version. |
| CORE-02 | PASS | All documented commands present. |
| CORE-03 | PASS | Isolated bootstrap: `failed: 0`, `applied: 2`, `pending: 2`. |
| CORE-04 | PASS | Second bootstrap: `failed: 0`, `applied: 0`. |
| CORE-05 | PASS | `doctor` exit 0, `overall: healthy`. |
| CORE-06 | PASS | Non-empty package summary. |
| CORE-07 | PASS | Global symlink install completed. |
| CORE-08 | PASS | Reinstall completed without duplicate or error. |
| CORE-09 | PASS | Local `dev` install recorded in `profile.json`; global install stayed absent by design. |
| CORE-10 | PASS | `sync` rebuilt profile artifacts and named its transaction. |
| CORE-11 | PASS | Detected `js-ts` and wrote a manifest. |
| CORE-12 | PASS | Each sensor reported a concrete state; missing local tools were explicit failures, never passes. |
| CORE-12b | PASS | Re-run left the working tree byte-for-byte unchanged. |
| CORE-12c | PASS | Removed the dangling link and named the backup transaction. |
| CORE-13 | PASS | Returned the complete JSON preflight report; missing context and tools were explicit. |
| CORE-14 | PASS | Reported `unmeasurable` rather than pinning an empty context budget. |
| CORE-15 | PASS | Exported portable `mermaid-diagrams` as a zip. |
| CORE-16 | PASS | Two consecutive updates completed successfully. |
| CORE-17 | PASS | Interactive picker opened; the non-interactive removal path removed the local artifact and `doctor` remained healthy. |
| CORE-18 | PASS | `backup list` showed restorable transactions. |
| CORE-19 | PASS | Added and read back a ledger finding. |
| CORE-20 | PASS | Isolated registry and artifacts stayed under the sandbox; source checkout unchanged. |

Next: **[os-matrix.md](os-matrix.md)** for your OS, then **[agent-matrix.md](agent-matrix.md)** for each agent you use.
