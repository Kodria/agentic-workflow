---
schema: awm.change-record/v1
id: 2026-10-29-issue-238-simple-git-4
title: Upgrade simple-git to 4.0.2 with honest non-interactive registry git
summary_short: Pin simple-git 4.0.2 via a registry-git factory that forces non-interactive prompts, ignores ambient GIT_*, classifies sync failures, and redacts URL credentials.
type: fix
scope: changes
semver: patch
breaking: false
modules:
  - .
  - .github/workflows
  - cli
  - cli/src
  - cli/src/commands
  - cli/src/core
  - cli/tests/commands
  - cli/tests/core
  - cli/tests/structural
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-10-29-issue-238-simple-git-4-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/238
verification:
  commit: c6a98c4ff2bfc2896f26b924cec730879b36307b
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:4444135e58a693b8b9fdf3faac3ad905f061dd4e0e5fb8a29b6a2164290694b1
manual_validation:
  - step: Tras publicar la CLI, escanear una imagen que instale agentic-workflow-manager
    expected: Inspector/ECR ya no reporta CVE-2026-102826/102827/102828/102829 sobre simple-git / @simple-git/argv-parser
  - step: Con GIT_SSL_CAINFO (u otra GIT_* guarded) en el entorno, correr awm update / sync
    expected: Aviso one-shot con el nombre de la variable (sin valor) y remedio en git config
  - step: Probar remote inexistente/privado y awm add/list con sync fallido pero caché usable
    expected: Fallo rápido sin hang; add/list anuncian versión en caché + causa; update/sync/init/registry add salen ≠ 0
risks:
  - Ambientes que dependían de ambient GIT_SSH_COMMAND / GIT_ASKPASS / GIT_SSL_* para registries privados deben migrar a ~/.ssh/config, credential.helper o http.sslCAInfo
  - simple-git timeout.block es idle (se reinicia con stdout/stderr), no un wall-clock hard cap
rollback: Revertir el merge del PR o pinear de nuevo simple-git@3.36.0 (reintroduce las CVEs). Consumidores vuelven a la CLI publicada anterior con npm i -g agentic-workflow-manager@<prev>.
---

## Qué se hizo

- Pin de producción `simple-git@4.0.2` y fábrica única `cli/src/core/registry-git.ts` (named import, `GIT_TERMINAL_PROMPT=0`, timeout idle 60s, sin `allowUnsafe*`).
- Avisos SG-5 de `GIT_*` ignoradas; clasificación SG-6 de fallos de sync/clone con remedios en git config; SG-7 soft en `awm add`/`list` y hard-fail en `init`/`update`/`sync`/`registry add`.
- Redacción de userinfo en remotes/fatal lines; runbook + lección en `AGENTS.md`.

## Qué se probó

- Suites estructurales / factory / honesty / registries-sync / registry add / versioning (PASS).
- `awm sensors run` overall `pass` en `c6a98c4f` (lint, typecheck, depcheck).
- Reviews S1/S2 + Track A PASS; Track B B1 (credenciales en URL) corregido y re-verificado.

## Qué falta validar

- Escaneo Inspector/ECR post-publish de una imagen con la CLI nueva.
- Smoke en entorno Cencosud/corporativo con registry privado (HTTPS token o SSH via `~/.ssh/config`).

## Riesgos y rollback

Ver `risks` y `rollback` del frontmatter. No re-habilitar ambient `GIT_*` sin enmendar el diseño.
