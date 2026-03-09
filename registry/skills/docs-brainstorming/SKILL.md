---
name: docs-brainstorming
description: "Use before any documentation work — explores user intent, analyzes repository context, and produces a documentation plan. Routes to docs-assistant (for documents) or template-manager (for templates)."
---

# Brainstorming de Documentación

## Descripción General

Convierte necesidades de documentación en planes completamente formados a través de un diálogo colaborativo natural.

Comienza explorando el contexto del proyecto de forma autónoma, luego hace preguntas de a una para refinar la necesidad de documentación. Una vez que comprendes qué debe documentarse, presenta el plan y obtiene la aprobación del usuario.

<HARD-GATE>
NO invoques ninguna skill de ejecución, no escribas ningún documento ni tomes ninguna acción de implementación hasta haber presentado un plan de documentación y recibido la aprobación del usuario. Esto aplica a TODA solicitud de documentación, sin importar su aparente simplicidad.
</HARD-GATE>

## Checklist

DEBES crear una tarea para cada uno de estos ítems y completarlos en orden:

1. **Explorar el contexto del proyecto** — analizar estructura del repo, documentación existente y templates disponibles
2. **Hacer preguntas de clarificación** — de a una, entender qué documentar y para quién
3. **Clasificar la necesidad** — documentación (→ `docs-assistant`) o template (→ `template-manager`)
4. **Presentar el plan de documentación** — con entregables, destinos y skills de apoyo necesarias
5. **Escribir el documento del plan** — guardar en `docs/plans/YYYY-MM-DD-docs-<tema>-plan.md`
6. **Transferir el control** — invocar la skill ejecutora indicada en el plan

## Flujo del Proceso

### Paso 0: Exploración Autónoma de Contexto

Antes de preguntarle nada al usuario, recopila contexto en silencio:

1. **Lee `AGENTS.md`** en la raíz del proyecto (si existe). Parsea el frontmatter YAML (`agent_context`) para extraer:
   - `docs_path` — el directorio raíz de documentación.
   - `directories.dir_drafts` — el directorio de borradores.
2. **Escanea la documentación existente** en `{docs_path}/` para entender qué ya está documentado.
3. **Autodescubre templates** (tanto globales como locales):
   - **Templates globales:** Usa herramientas de búsqueda de archivos para encontrar `template-wizard/resources/templates` en los directorios de skills (`.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.). Son templates de referencia de solo lectura instalados por el AWM CLI.
   - **Templates locales:** Revisa `{docs_path}/templates/` o `docs/templates/` relativo a la raíz del proyecto. Son overrides específicos del proyecto.
4. **Escanea el código fuente** si la solicitud parece involucrar documentación técnica o de arquitectura — identifica módulos clave, servicios y estructura.

### Paso 1: Diálogo Colaborativo

Haz preguntas **de a una** para refinar la necesidad de documentación:

- ¿Qué quieres documentar? (módulo, arquitectura, proceso, estándar, etc.)
- ¿Quién es el público objetivo? (desarrolladores, PMs, DevOps, ejecutivos)
- ¿Es documentación nueva o mejora de algo existente?
- ¿Necesitas diagramas de arquitectura? (contexto C4, contenedores, componentes)
- ¿Qué tipo de documento? (o detectar del contexto)
- ¿Algún requisito o restricción específico?

**Principios:**
- **Una pregunta a la vez** — no abrumes al usuario
- **Prefiere opciones múltiples** cuando sea posible
- **Usa el contexto descubierto** — referencia lo que encontraste en el Paso 0 para hacer las preguntas más relevantes (ej. "Veo que ya tienes docs del módulo X pero no de Y, ¿es Y lo que quieres documentar?")

### Paso 2: Clasificar la Necesidad

Según el diálogo, determina el ejecutor:

| Necesidad | Ejecutor | Cuándo |
|-----------|----------|--------|
| Crear/mejorar/formatear documentación | `docs-assistant` | Cualquier documento que vivirá en `{docs_path}/` |
| Crear/editar un template reutilizable | `template-manager` | Trabajo sobre estándares de templates en `docs/templates/` |

### Paso 3: Generar el Plan de Documentación

Escribe un plan de documentación en `docs/plans/YYYY-MM-DD-docs-<tema>-plan.md` con este formato:

~~~markdown
# Plan de Documentación: [Título]

> **Para el ejecutor:** Este plan fue generado por `docs-brainstorming`.
> Usa la skill indicada en "Ejecutor" para implementarlo entregable por entregable.

**Objetivo:** [Una oración describiendo qué se busca]
**Ejecutor:** `docs-assistant` | `template-manager`
**Audiencia:** [Para quién es la documentación]
**Idioma:** Español

---

## Contexto Recopilado

[Todo el contexto descubierto: estructura del repo, docs existentes,
código analizado, templates disponibles, decisiones del usuario.
Este bloque debe ser suficiente para que el ejecutor trabaje sin
preguntar nada adicional sobre contexto.]

## Entregables

### Entregable 1: [Nombre del documento/template]
- **Tipo:** Documento técnico | ADR | Runbook | Template | ...
- **Destino:** `{docs_path}/architecture/c4-context.md`
- **Plantilla base:** `adr-template.md` (si aplica)
- **Requiere skill de apoyo:** `c4-architecture` | `template-wizard` | ninguna
- **Contexto específico:** [Detalle de qué debe contener este entregable,
  información relevante del código, decisiones del usuario]

### Entregable N: [Nombre]
- **Tipo:** ...
- **Destino:** ...
- **Requiere skill de apoyo:** ...
- **Contexto específico:** ...

---

## Criterios de Aceptación
- [ ] [Criterio 1]
- [ ] [Criterio 2]
~~~

**Reglas críticas para el plan:**
- La sección "Contexto Recopilado" debe ser **autocontenida** — el ejecutor debe poder trabajar sin hacer preguntas de contexto.
- Cada entregable debe especificar si requiere una skill de apoyo y cuál.
- El plan debe estar escrito en **español** (siguiendo la convención del ecosistema de documentación).

### Paso 4: Aprobación del Usuario

Presenta el plan al usuario. Espera aprobación explícita.
- Si el usuario solicita cambios → itera sobre el plan.
- Si el usuario aprueba → guarda el plan y continúa con el Paso 5.

### Paso 5: Transferir el Control

1. Guarda el documento del plan en `docs/plans/`.
2. Informa al usuario: *"Plan aprobado y guardado. Transfiriendo control a `[skill ejecutora]`."*
3. Localiza y lee el `SKILL.md` de la skill ejecutora usando autodescubrimiento dinámico.
4. Ejecuta las instrucciones de la skill ejecutora, pasando el plan como contexto.

**El estado terminal es invocar la skill ejecutora.** NO invoques ninguna otra skill. Las ÚNICAS skills a las que se transfiere el control son `docs-assistant` o `template-manager`.

## Principios Clave

- **Una pregunta a la vez** — no abrumes con múltiples preguntas
- **Preferir opciones múltiples** — más fácil de responder que preguntas abiertas cuando sea posible
- **Orientado al contexto** — usa lo que descubriste en el Paso 0 para hacer el diálogo eficiente
- **Planes autocontenidos** — el documento del plan debe tener TODO el contexto que necesita el ejecutor
- **YAGNI** — no sugieras documentación que el usuario no ha pedido
- **Sin alucinaciones** — incluye solo información explícitamente descubierta o declarada por el usuario
