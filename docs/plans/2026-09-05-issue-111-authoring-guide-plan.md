# Issue #111: Orchestrator Authoring Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the real `orchestrator` block contract and its composition verification in the registry authoring guide.

**Architecture:** Keep the change documentation-only. The guide will show the manifest declaration, explain validation and skill-directory resolution, and add a read-only CLI verification to the existing local-install flow.

**Tech Stack:** Markdown, JSON examples, AWM CLI.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

## Scope

- Update only `docs/guides/authoring-a-registry-with-an-orchestrator.md` for the user-facing fix.
- Do not change CLI behavior or add the future contract test proposed by the issue; that broader guard belongs with the related process-lifecycle work.
- Preserve the guide's existing registry layout, installation, publishing, and isolation sections.

## Task 1: Document the declaration contract and verify composition

- [x] Replace the minimal `awm-registry.json` example with the complete three-field `orchestrator` object.
- [x] State the exact parser-validated constraints: three fields only, non-empty strings, and maximum 500 characters; separately document the authoring convention to omit a final period in `appliesWhen` so the renderer does not duplicate punctuation.
- [x] Explain that `orchestrator.name` must match the `skills/<name>/SKILL.md` directory name; frontmatter `name` does not control discovery.
- [x] Add `awm context orchestrators --verify mi-proceso` to the local validation flow and explain its exit behavior.
- [x] Run `git diff --check`, validate the JSON example, build the CLI, and run the targeted context-orchestrator integration test.
- [x] Commit the guide and plan with `docs: document orchestrator registry manifest`.

## Verification

Run from the repository root:

```bash
git diff --check
node -e 'const fs=require("fs"); const text=fs.readFileSync("docs/guides/authoring-a-registry-with-an-orchestrator.md","utf8"); const heading="## 2. `awm-registry.json`"; const start=text.indexOf(heading); if(start<0) throw new Error("awm-registry.json section not found"); const tail=text.slice(start); const fence="```json\n"; const fenceStart=tail.indexOf(fence); if(fenceStart<0) throw new Error("JSON fence not found"); const jsonStart=fenceStart+fence.length; const jsonEnd=tail.indexOf("\n```", jsonStart); if(jsonEnd<0) throw new Error("JSON fence close not found"); JSON.parse(tail.slice(jsonStart,jsonEnd));'
npm --prefix cli run build
npm --prefix cli test -- --runInBand tests/integration/context-orchestrators-e2e.test.ts
```

The JSON check is expected to be run against the extracted manifest block after the guide is edited; if the guide contains other JSON examples, validate the specific `awm-registry.json` block manually as part of review.
