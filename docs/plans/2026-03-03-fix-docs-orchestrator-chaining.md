# Plan de Corrección: Auto-Chaining en Ecosistema docs-system-orchestrator

## Análisis de Skills

### Skills auditadas (6 downstream + 1 orquestador)

| Skill | Auto-chaining detectado? | Severidad | Acción |
|-------|--------------------------|-----------|--------|
| `docs-system-orchestrator` (skill) | ✅ SÍ — Step 4 instruye ejecutar la skill delegada inmediatamente | 🔴 Alta | **CORREGIR** |
| `template-wizard` | ✅ SÍ — Paso 6 "sugiere invocar `docs-assistant` posteriormente" | 🟡 Media | **CORREGIR** |
| `documenting-modules` | ❌ No — termina después de actualizar el índice | ✅ OK | Sin cambios |
| `business-documenting-modules` | ❌ No — termina después de actualizar el índice | ✅ OK | Sin cambios |
| `docs-assistant` | ❌ No — termina indicando al usuario hacer `git commit` | ✅ OK | Sin cambios |
| `template-manager` | ❌ No — termina confirmando el guardado de la plantilla | ✅ OK | Sin cambios |
| `project-context-init` | ❌ No — termina después de la limpieza de temporales | ✅ OK | Sin cambios |

---

## Problema 1: `docs-system-orchestrator` Skill — Step 4

### Comportamiento actual (problemático)
```
Step 4, punto 4: "Empieza a ejecutar los pasos de la skill delegada inmediatamente asumiendo ese rol."
```
Esto significa que el orquestador asume el rol de la skill secundaria sin crear un punto de parada claro después de su delegación. Si la skill secundaria a su vez tiene encadenamiento, el flujo nunca regresa.

### Corrección propuesta
Cambiar Step 4 para que:
1. Lea e inyecte el SKILL.md en contexto.
2. Informe al usuario de la transferencia.
3. **Añada una nota explícita**: al terminar la skill delegada, retornar control al usuario y no encadenar más skills.

---

## Problema 2: `template-wizard` — Paso 6 ("Guardado")

### Comportamiento actual (problemático)
```
"El agente finaliza confirmando la ruta al usuario y sugiriéndole invocar 
posteriormente la skill docs-assistant para perfeccionar y oficializar el documento."
```
Aunque dice "sugiriéndole" (no lo ejecuta directamente), el patrón confunde los límites y puede llevar al agente a ofrecer ejecutarlo sin aprobación explícita.

### Corrección propuesta
Reemplazar el Paso 6 con `<TERMINATION_PHASE>` estándar que:
1. Confirme la ruta del borrador generado.
2. Pregunte si el usuario desea invocar `docs-system-orchestrator` para continuar, en lugar de sugerir `docs-assistant` directamente.

---

## Proposed Changes

### [MODIFY] docs-system-orchestrator/SKILL.md
**Step 4**: Cambiar punto 4 de "empieza a ejecutar inmediatamente" a "carga el skill e informa la transferencia, luego espera que el usuario inicie la interacción con la skill".

### [MODIFY] template-wizard/SKILL.md  
**Paso 6**: Reemplazar la sugerencia de `docs-assistant` con `<TERMINATION_PHASE>` estándar.

---

## Verification Plan

### Manual Verification
1. Invocar `docs-system-orchestrator` con una petición de documentación.
2. Validar que en Step 3 pausa y espera aprobación.
3. Aprobar. Validar que Step 4 carga la skill y transfiere el control sin ejecutar pasos automáticamente.
4. Completar la skill delegada y validar que pregunta antes de encadenar otra.
