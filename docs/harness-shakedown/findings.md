# Harness Shakedown — Findings (bug log)

Bugs encontrados corriendo el arnés de verdad. Se arreglan DESPUÉS de que el lab mapee el cuadro completo (ambas herramientas), salvo que un bug bloquee el avance. Cada hallazgo tiene lo necesario para retomarlo sin perder contexto.

---

## Hallazgo #1 — `awm init` crashea en el step `project.profile`

- **Encontrado:** 2026-06-05, Fase 1 (Claude), corriendo `awm init --agent claude-code` en `~/awm-lab/tip-splitter-claude`
- **Síntoma:** `✖ project.profile [Cannot read properties of undefined (reading 'disabled')]`
- **Efecto:** `.awm/profile.json` NO se crea (el step crasheó a mitad). El profile del proyecto queda ausente; `awm doctor`/`init` reportan `degradado`.
- **Severidad:** media. NO bloquea el flujo de desarrollo (las skills de la espina están a nivel máquina-global, `✔ skills globales`), pero la activación project-scoped basada en profile está rota.
- **Clase (sospechada):** lógica / runtime — un `.disabled` leído sobre un objeto `undefined`.
- **Pista de investigación:** `grep "disabled" cli/src/` **NO** muestra ninguna lectura literal de `.disabled` en `profile.ts` ni en `init/`. Las únicas coincidencias son `config.enabled === false` (sensors/status.ts:72) y un `skipReason: 'disabled'` (sensors/run.ts:140) — ninguna es la culpable. Conclusión: el `.disabled` se lee en la cadena que `stepProfile` dispara al **activar bundles/skills** (acción `syncProfile`), probablemente sobre una entrada de bundle/skill `undefined` (mismatch de forma entre el registry y lo que el profile espera). Puede ser acceso dinámico (`obj['disabled']`) o en el path de instalación de bundles.
- **Repro:** `awm init --agent claude-code` en un dir git fresco sin `.awm/profile.json` previo.
- **Archivos a inspeccionar al debuggear:** `cli/src/core/init/steps.ts` (`stepProfile`), la acción `syncProfile` y su cadena de activación de bundles, `cli/src/core/profile.ts`, `cli/src/core/bundles.ts`.
- **Estado:** ABIERTO — debuggear con `systematic-debugging` después del lab.
