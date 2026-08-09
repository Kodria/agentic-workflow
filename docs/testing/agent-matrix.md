# Agent acceptance matrix

Only the **deltas per agent**. Run [core-acceptance.md](core-acceptance.md) first.

Each agent gets a different amount of AWM. That is a property of the target agent's architecture, not a defect — and the single most important thing this document does is tell you **what is supposed to degrade**, so you don't file a bug against a documented limitation.

## Where artifacts land

**This table used to live here and it was wrong** — it claimed Antigravity installed to
`~/.agents/skills` and `.agents/skills` when the code says `~/.gemini/antigravity/skills`
and `.agent/skills` (singular), and it never mentioned that Antigravity is the only
provider with `global_workflows`. A hand-written copy of a fact the code already owns
drifts, and this one drifted silently for releases.

It now lives **generated from `cli/src/providers/index.ts`**, in
**[docs/support-matrix.md](../support-matrix.md)**, locked by
`tests/structural/support-matrix-is-current.test.ts` so it cannot drift again. Read the
paths there; this document only covers what to *check*.

`copilot` has no global scope on purpose: GitHub Copilot has no user-level
skill-discovery mechanism, so skills must be installed per project. `awm add -a copilot
--scope global` must fail with **that explanation**, not a generic error.

## What each tier gives you

| Tier | Agents | Skills load | Hooks fire | Phase gates enforce |
|---|---|---|---|---|
| hooks-native | `claude-code`, `codex` | yes | yes | yes |
| config-managed | `opencode` | yes | no | context only |
| agents-md-managed | `cursor`, `copilot` | yes (rendered) | no | context only |
| context-only | `antigravity` | yes | no | context only |

"Context only" means the process discipline is *read* by the agent rather than *enforced* by the harness. The deterministic part — `awm sensors run` — works identically for every agent, because it's a real command with a real exit code.

---

## Per-agent checks

Substitute `<agent>` and run in a scratch project (setup as in core-acceptance).

### Common to every agent

**AG-01 · The agent is recognised** *(run this AFTER AG-02)*
```bash
awm doctor --json -a <agent>
```
**Expect:** exit `0`; a `providers` entry for `<agent>` with the `tier` from the table above.

> **Order matters, and this check used to have it wrong.** It sat first and asked for exit
> `0` on a scratch project where nothing had been installed yet — which `awm doctor`
> cannot give you: with no hook and no skills it reports `degraded` and exits `1`, exactly
> as documented. Bootstrap first (AG-02), then ask whether the agent is healthy. A `1`
> *before* AG-02 is the correct answer, not a finding.

**AG-02 · Bootstrap for this agent**
```bash
awm init -a <agent> --yes --json > init-<agent>.json
```
**Expect:** `failed: 0`.
**Legitimate exception:** exit `2` with a message that the agent's binary is missing or below its minimum version — that is a **correct refusal**, record it as PASS with a note. `codex` requires ≥ `0.145.0`.

**AG-03 · Install a skill for this agent**
```bash
awm add dev --scope local --method symlink --agent <agent> --yes
```
**Expect:** exit `0`, and the artifact present at the project path from the table.

**AG-04 · The rendered artifact is well-formed**

Open the file that AG-03 produced:

- symlink agents → the link resolves to `$AWM_HOME/registries/baseline/skills/development-process`
- `cursor` → `.cursor/rules/development-process.mdc` starts with valid YAML frontmatter (`description`, `globs`, `alwaysApply: false`)
- `copilot` → `.github/instructions/development-process.instructions.md` starts with `applyTo: "**"`

**Expect:** no literal `>-`, `|-`, `undefined`, or empty `description:` anywhere in the frontmatter.

**AG-05 · Install the whole frontend bundle** (exercises every renderer at once)
```bash
awm add frontend --agent <agent> --yes
```
**Expect:** exit `0` and ~30 artifacts. This is the check that caught two real crashes historically — a bundle exercises far more shapes than a single skill.

**AG-06 · The agent actually sees the context** *(manual, needs the real binary)*

Start a fresh session in the agent, in the project. Ask it: *"which AWM skills do you have available, and what does the development-process skill tell you to do first?"*

**Expect by tier:**
- hooks-native → names real installed skills and describes the orchestration
- config-managed / agents-md-managed / context-only → at minimum has the project context (`AGENTS.md` / rules) and can quote from it

**FAIL** if it has no idea AWM exists at all. That means delivery didn't reach the agent, which is the whole point of the tool.

---

### `claude-code` extras

**CC-01 · The SessionStart hook is registered**
```bash
awm hooks status
```
**Expect:** the hook present in `~/.claude/settings.json` under `SessionStart` with matcher `startup|clear|compact`.

**CC-02 · The hook survives a settings edit**
Add an unrelated key to `~/.claude/settings.json` by hand, then `awm init --yes`.
**Expect:** your key is still there. AWM merges into that file; it must never clobber user content.

### `codex` extras

**CX-01 · Version gate**
```bash
codex --version && awm init -a codex --yes --json
```
**Expect:** with ≥ `0.145.0`, `failed: 0`. Below it, a clean exit `2` naming the minimum.

**CX-02 · Agent profile renders as TOML**
```bash
awm add dev --scope local --agent codex --yes
```
**Expect:** `.codex/agents/development-process.toml`, parseable as TOML, with the description intact.

### `cursor` extras

**CU-01 · No global context file is invented**
```bash
awm doctor --json -a cursor
```
**Expect:** the global-context check reports N/A or unsupported — **not** an error, and not a path AWM made up. Cursor's user rules live in app settings, not on disk.

### `copilot` extras

**CP-01 · Global scope is refused with a reason**
```bash
awm add dev --scope global --agent copilot --yes
```
**Expect:** a clear failure naming *why* (no user-level skill discovery in Copilot). A generic stack trace is a **FAIL**.

**CP-02 · Project install still works**
Re-run with `--scope local`.
**Expect:** exit `0`, file under `.github/instructions/`.

### `opencode` extras

**OC-01 · Instructions land in the config**
```bash
cat ~/.config/opencode/opencode.json
```
**Expect:** an `instructions` field referencing AWM's managed content, with any pre-existing config preserved.

### `antigravity` extras

**AN-01 · Honest tier reporting**
```bash
awm doctor --json -a antigravity
```
**Expect:** tier `context-only`, and **no** hook or injection check reported as failing — it has neither mechanism, so "missing" would be a false alarm.

---

## Result sheet

| Agent | AG-01 | AG-02 | AG-03 | AG-04 | AG-05 | AG-06 | Extras | Notes |
|---|---|---|---|---|---|---|---|---|
| claude-code | PASS | PASS | PASS | PASS | PASS | PASS | CC-01 PASS · CC-02 PASS | 2026-08-09, awm 4.0.0, Linux. AG-02 exit `1` / `failed: 0`. AG-05: 31 artefactos. AG-06 con control negativo (ver abajo). **Un hallazgo de producto**, arreglado: ver "Lo que encontró la corrida". |
| codex |  |  |  |  |  |  | CX-01 CX-02 |  |
| opencode |  |  |  |  |  |  | OC-01 |  |
| cursor |  |  |  |  |  |  | CU-01 |  |
| copilot |  |  |  |  |  |  | CP-01 CP-02 |  |
| antigravity |  |  |  |  |  |  | AN-01 |  |

Record **BLOCKED** for any agent whose binary you don't have. Do not infer a result from another agent's outcome — the bugs this suite exists to catch are precisely the ones that only appear on one provider's path.

---

## Lo que encontró la corrida de `claude-code` (2026-08-09)

Vale escribirlo porque es el argumento entero a favor de correr esto contra un binario
real: **1726 tests unitarios en verde no lo habían visto**, y la corrida lo encontró en
menos de veinte minutos.

**AG-06 se corrió con un control negativo.** Un `claude -p` anidado podría estar leyendo el
ambiente del proceso padre en lugar del `HOME` aislado, y entonces "nombró las skills" no
probaría nada. El control: la misma pregunta con un `HOME` limpio sin AWM. Respondió que no
tiene ninguna skill de AWM. Recién con eso la respuesta afirmativa vale como evidencia.

**El hallazgo:** al terminar AG-06, `~/.claude/skills/mermaid-diagrams` había dejado de ser
el symlink que `awm init` instaló. Claude Code trae su propia skill `mermaid-diagrams` y la
materializó encima — un directorio real, otra `description`, sin `version`, con un
`README.md` que la nuestra no tiene. El agente cargaba esa, no la instalada.

Lo grave no fue la colisión de nombres: fue que **nada lo reportaba**.

```
skills.global: healthy   ·   overall: healthy   ·   exit 0
```

`awm sync` tampoco lo tocaba. La causa es una línea de `classifySkillLinks`:
`if (!lst.isSymbolicLink()) continue`. Correcta para una skill que puso el usuario a mano
— AWM no debe tocarla — y equivocada cuando el ledger de artefactos dice que esa ruta
exacta es nuestra. El clasificador nunca consultaba el ledger, así que no podía distinguir
los dos casos, y la usurpación era literalmente invisible.

Hoy `doctor` reporta `broken`, nombra qué fue reemplazado y sale `1`. No se auto-repara:
borrar un directorio real de un tercero es destructivo — ver [`decisions.md`](../decisions.md) D-007.

**Si repetís la corrida, esperá esto:** después de abrir una sesión real de Claude Code
contra el `HOME` aislado, `awm doctor` reporta `mermaid-diagrams` como reemplazado. Eso es
el producto funcionando, no una regresión.
