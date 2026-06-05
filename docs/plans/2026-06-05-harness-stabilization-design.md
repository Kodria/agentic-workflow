# Estabilización del Harness (Body A) — Diseño

**Fecha:** 2026-06-05
**Origen:** Auditoría funcional ejecutada del harness (Fases 0–3). Patrón hallado: buen código y buena arquitectura, pero **solo el camino de Claude está probado en la realidad**, y el harness da **verdes falsos** en dos frentes que minan la confianza.

**Principio rector:** El harness nunca debe afirmar más de lo que verificó. Hoy lo hace en sensores y en skills; este diseño hace el estado real **visible y honesto**, y endurece para que no recurra.

**Alcance:** Body A — Estabilización. El agnosticismo real (ConventionFileStrategy, bootstrap agnóstico, activación de Fase 3) es **Body B**, un ciclo design→plan→ejecución aparte. Secuencia acordada: **A primero, B después**.

---

## Contexto de la auditoría (evidencia ejecutada, no asumida)

| Defecto | Evidencia real |
|---|---|
| **Sensor gate da falso verde** | `awm sensors run` desde la raíz del repo → exit 0, output vacío (no hay `.awm/sensors.json` ahí). Cada "✓ sensors clean" de subagentes esta sesión fue un no-op. |
| **Sensores DEGRADED cuando sí corren** | Desde `cli/` → `awm sensors status` = DEGRADED: `eslint` y `depcruise` no instalados localmente (`npx bajaría un paquete remoto`). |
| **19 symlinks de skills rotos** | `~/.claude/skills/`: 23 válidos (apuntan a `~/.awm/cli-source/registry/`), 19 muertos (apuntan a `~/.awm/registry/` que **no existe**). Si invocas `/ui-design`, `/story-mapping`, etc. → fallan. |

---

## Componente 1 — Sensor gate honesto (modelo de 3 estados)

### Problema
`overall` es binario pass/fail, y `NOT_CONFIGURED` sale exit 0 vacío → se lee como pass. El bug no es solo del tool: los subagentes leen `exit 0` como éxito.

### Modelo de veredicto

| Estado | Significado | Exit code | Hook automático | Gate de completitud |
|--------|-------------|:---:|:---:|:---:|
| `pass` | Config existe, corrió, sin findings nuevos | 0 | silencioso | ✅ verde |
| `fail` | Config existe, corrió, hay findings nuevos **o DEGRADED** (tool faltante) | 1 | reporta | ❌ bloquea |
| `not_certified` | No se encontró config en todo el árbol | 2 | benigno, informativo | ⚠️ **no certifica** (nunca verde) |

### Auto-discovery
`awm sensors run` camina hacia arriba desde el `cwd` buscando `.awm/sensors.json` (patrón git/`.git`). Resuelve "corro desde `cli/` vs raíz".

**Comportamiento resultante en este repo (monorepo con `cli/` como proyecto Node):**
- Desde la raíz → `not_certified` (honesto: la raíz no es el proyecto Node).
- Desde `cli/` → encuentra `cli/.awm/sensors.json` y corre. Hoy daría `fail` por DEGRADED; el plan instala `eslint`/`depcruise` en devDeps de `cli/` para llevarlo a `pass`.

### Cierre del loop (skills)
Actualizar `verification-before-completion` y el `implementer-prompt` de `subagent-driven-development` para que declaren explícito:
> `not_certified` NO es un pass. Decláralo como "sin sensores configurados", nunca como verde.

### DEGRADED = fail
Un sensor cuyo tool no está instalado localmente (`eslint`/`depcruise` faltantes) cuenta como **fail**, no como "degradado tolerable". El gate no puede certificar lo que no pudo correr.

---

## Componente 2 — Integridad de symlinks de skills

Patrón existente: **doctor detecta (read-only), init/sync actúa.** Tres piezas.

### 2.1 Detectar (doctor)
`awm doctor` reporta en la sección Máquina:
```
⚠ skills globales: 19 enlaces rotos   → awm init
```
Clasifica cada symlink en `~/.claude/skills/` en tres categorías:
- **válido** → apunta a algo que existe en `cli-source`.
- **huérfano-reparable** → roto, pero la skill SÍ existe en `cli-source` (re-linkeable).
- **huérfano-muerto** → roto y la skill ya no existe en el registry (podar).

### 2.2 Reparar (init / sync)
El paso de skills globales de `awm init`:
- **re-linkea** los huérfanos-reparables → a `cli-source`.
- **poda** los huérfanos-muertos (borra el symlink colgante).
- Idempotente: lo válido se salta. Reporta `re-linked N, pruned M`.

### 2.3 Endurecer la causa raíz
El split-brain nació porque una migración cambió el root (`~/.awm/registry` → `~/.awm/cli-source`) sin reconciliar los symlinks existentes. Endurecimiento:
- `awm update` (post-pull, junto al `buildCli` y `regenerateGlobalContext` ya existentes) detecta symlinks globales que apuntan **fuera de `cli-source`** y los repara en el acto.
- Un cliente con layout viejo se auto-cura en el próximo `awm update`, sin intervención manual.

**Frontera:** cubre skills **globales** (`~/.claude/skills`). Los de **proyecto** (vía `profile.json`) ya los maneja `awm sync` y no se tocan. Solo el agente Claude (único con skills instaladas hoy); OpenCode/Antigravity skill-paths son Body B.

---

## Error handling

- **Sensor auto-discovery sin match:** no es excepción — es `not_certified` (exit 2). Nunca crashea.
- **Reparación de symlinks:** cada symlink se procesa aislado en try/catch — un enlace con permisos raros no aborta el resto. Reporta `re-linked N, pruned M, failed K`.
- **Endurecimiento en `awm update`:** reconciliación en su propio try/catch (igual que `buildCli`/`regenerateGlobalContext`) — una falla no aborta un update exitoso.
- **Idempotencia:** correr init/update dos veces no cambia nada la segunda vez.

## Testing

- **Sensor 3-estados:** unit sobre el resolver de veredicto — config-presente-limpio→`pass`, config-presente-degraded→`fail`, sin-config→`not_certified` con exit code 2. Auto-discovery: fixture con `.awm/sensors.json` en un ancestro → lo encuentra; sin ancestro → `not_certified`.
- **Symlink integrity:** temp dir con symlinks válido/huérfano-reparable/huérfano-muerto → detect clasifica las 3; repair re-linkea y poda; segunda corrida = no-op.
- **Regresión del hook:** el exit code 2 (`not_certified`) no rompe el hook automático — test de que el hook tolera exit 2 sin marcar la sesión como fallida.
- **Skills doc-update:** confirmar que `verification-before-completion` y el `implementer-prompt` mencionan `not_certified` explícitamente.

## Límite de alcance (lo que NO entra en Body A)

- Agnosticismo (ConventionFileStrategy, bootstrap agnóstico, activar/probar Fase 3) → **Body B**, ciclo aparte.
- `skills-lock.json` vestigial → decisión separada (no bloquea estabilización).
- Symlinks de proyecto vía `profile.json` → ya cubierto por `awm sync`.

## Componentes y límites (para aislamiento)

| Unidad | Propósito | Depende de |
|---|---|---|
| Resolver de veredicto de sensores | Mapea (config?, corrió?, findings?) → `pass`/`fail`/`not_certified` + exit code | lectura de `.awm/sensors.json`, resultados de sensores |
| Auto-discovery de config | Camina hacia arriba buscando `.awm/sensors.json` | filesystem |
| Detector de integridad de symlinks | Clasifica symlinks globales en válido/reparable/muerto | `~/.claude/skills`, `cli-source` registry |
| Reparador de symlinks | Re-linkea reparables, poda muertos | detector |
| Hardening en `awm update` | Reconcilia symlinks fuera de `cli-source` | reparador |
| Updates de skills (docs) | `verification-before-completion` + `implementer-prompt` reconocen `not_certified` | — |
