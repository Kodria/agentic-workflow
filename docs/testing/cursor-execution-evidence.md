# Cursor execution evidence (Plan C — native session)

- **Date:** 2026-09-29
- **Machine:** owner macOS, `agent` on `PATH` via `~/.local/bin`
- **Binary:** `agent` (alias `cursor-agent`)
- **Design:** `docs/plans/2026-09-28-cursor-full-parity-design.md` §7.1 / R26
- **Scope of this record:** native provider-session admission only. Durable custody
  (`awm watch`) remains suspended for every provider ([D-023](../decisions.md#d-023)).

## Captures

| Probe | Result |
|---|---|
| `agent --version` | `2026.09.26-dd393fe` |
| `agent --help` | Documents `-p/--print`, `-f/--force` (alias `--yolo`), `--trust`, `--resume`, `--continue`, `--model`, `--mode plan\|ask` |
| Interactive Cursor Agent session | In use for AWM Plan A/B/C work on this machine (skills/hooks from Plan B) |
| `agent -p --mode ask --force --trust …` (hermetic tmp repo) | Exit 0 path not completed: CLI reached `Authentication required. Please run 'agent login'…` — flags were accepted (no "unknown option"); full headless print session not certified here |

## Capability decisions

| Capability | Status | Why |
|---|---|---|
| `interactiveExecution` | `supported` | Real Cursor Agent sessions run interactive AWM work; binary present and version-gated |
| `unattendedController` | `supported` | Journal-less `compact-slices/v1` desatendido admits with declared `--controller-autonomy approval-free` (same operator-assertion doctrine as Codex, #168). Does **not** claim AWM can spawn a watch controller |
| `durableResume` | `unverified` | Watch/custody suspended (D-023); `--resume` not certified as AWM custody evidence |
| `modelOverride` / `effortOverride` / `observedModelEvidence` | `unverified` | R2 routing still paused |

## Version gate

- `versionCommand`: `agent --version`
- Pattern: `^(\d{4}\.\d{2}\.\d{2})-[0-9a-f]+$` (captures the date triple)
- `minimumVersion`: `2026.09.26`

## Explicit non-claims

- No `ControllerAdapter` / `WATCH_PROVIDERS` entry for Cursor in this delivery.
- Unattended default remains **in-provider session**, not AWM launching `agent -p`.
- When D-023 is lifted with routing, re-run a authenticated `-p --force --trust`
  discovery before promoting `durableResume` or adding a watch adapter.
