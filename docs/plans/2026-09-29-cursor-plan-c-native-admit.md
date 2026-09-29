# Cursor Plan C — native-session admission (reduced)

**Goal:** Admit Cursor for interactive and journal-less unattended `compact-slices/v1` work once execution capabilities are evidence-backed. No durable custody / `awm watch` adapter (D-023).

**Architecture:** Flip only the Plan C native-session row in `PROVIDER_EXECUTION_CAPABILITIES`, add Cursor `versionCommand`/`minimumVersion`, keep routing and `durableResume` unverified. Watch remains fail-closed for all providers.

**Tech Stack:** TypeScript CLI admission + providers tables, Jest.

**Modo de ejecución:** interactivo  
**Modo de despacho:** proveedor-nativo  
**Design:** `docs/plans/2026-09-28-cursor-full-parity-design.md` §7.1 (R21–R22.1, R25–R26.1). R23–R24 (watch adapter) deferred with D-023.

## Requirements owned

- R21 — interactive admit for Cursor
- R22 / R22.1 — journal-less unattended v1 + autonomy posture
- R25 — routing capabilities stay unverified
- R26 / R26.1 — evidence playbook; no invented flags

## Out of scope

- `cursorAdapter`, `WATCH_PROVIDERS`, `durableResume: supported`
- compact-slices/v2 / model routing (R2 pause)
- Cloud Agents

## Checklist

- [x] Evidence playbook `docs/testing/cursor-execution-evidence.md`
- [x] `PROVIDER_EXECUTION_CAPABILITIES.cursor`: `interactiveExecution` + `unattendedController` → `supported`
- [x] Cursor `versionCommand` / `minimumVersion`
- [x] Admission + autonomy + provider-version tests
- [x] Docs / CHANGELOG / design status note
