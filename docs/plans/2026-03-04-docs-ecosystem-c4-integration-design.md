# Integración de c4-architecture al Ecosistema de Documentación — Design Doc

> **Para Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans para crear el plan de implementación basado en este diseño.

**Goal:** Integrar la skill `c4-architecture` al ecosistema de documentación mediante la creación de una nueva skill `docs-brainstorming`, la evolución de `docs-assistant` y `template-manager` con capacidad de subdelegación, y la actualización del orquestador.

**Enfoque elegido:** Enfoque C — Brainstorming + Ejecutores Autónomos con Protocolo de Apoyo Compartido.

---

## 1. Problema

La skill `c4-architecture` existe en el registry pero no está conectada al flujo de documentación. Además, `docs-assistant` es una state machine rígida de 6 pasos que no puede componer documentos con bloques generados por skills especializadas. No hay fase de descubrimiento colaborativo previa a la ejecución de documentación.

## 2. Arquitectura General

### Pipeline completo

```
docs-system-orchestrator (router, actualiza catálogo)
        │
        ▼
docs-brainstorming (NUEVA — exploración + plan)
        │
        ├── Documentación → docs-assistant (evoluciona)
        └── Templates → template-manager (evoluciona)
                              │
                              ▼
                    Protocolo de Subdelegación (compartido)
                              │
                              ▼
                    [c4-architecture | template-wizard | futuras...]
```

### Cambios por componente

| Componente | Tipo de cambio |
|------------|---------------|
| `docs-brainstorming` | **Skill nueva** |
| `docs-assistant` | Evolución — Modo Plan + Protocolo de Subdelegación |
| `template-manager` | Evolución — Modo Plan + Protocolo de Subdelegación |
| `docs-system-orchestrator` | Modificación menor — actualizar catálogo |
| `processes.json` | Modificación menor — agregar skills al proceso `docs` |
| `c4-architecture` | Sin cambios — solo se instala y registra |

### Lo que NO cambia

- `c4-architecture/SKILL.md` — ya sabe generar diagramas C4
- `template-wizard` — sigue igual, ya funciona como skill de apoyo
- `documenting-modules` y `business-documenting-modules` — no participan en este flujo
- El workflow y agent `.md` del orchestrator — ya delegan a la skill

## 3. `docs-brainstorming` — Skill Nueva

### Identidad

Equivalente de `brainstorming` pero especializado para el dominio de documentación. Descubre qué documentación necesita el usuario y produce un plan de documentación ejecutable.

### Flujo

```
1. Exploración autónoma de contexto
   ├── Lee AGENTS.md del proyecto destino (docs_path, dir_drafts, estructura)
   ├── Lee {docs_path}/ existente (qué ya hay documentado)
   ├── Autodescubrimiento de templates:
   │   ├── Globales: busca template-wizard/resources/templates en paths de skills
   │   │   (.agents/skills/, .agent/skills/, ~/.agents/skills/, etc.)
   │   └── Locales: busca {docs_path}/templates/ o docs/templates/
   │   (misma lógica de autodescubrimiento que template-wizard y template-manager)
   └── Lee código fuente si es relevante (para docs técnicas)
        │
        ▼
2. Diálogo colaborativo (una pregunta a la vez)
   ├── ¿Qué quieres documentar?
   ├── ¿Para qué audiencia?
   ├── ¿Es documentación nueva o mejora de existente?
   ├── ¿Necesitas diagramas de arquitectura?
   ├── ¿Qué tipo de documento? (o detectarlo del contexto)
   └── ... hasta tener claridad completa
        │
        ▼
3. Clasificación de la necesidad
   ├── Documentación → ejecutor: docs-assistant
   └── Templates → ejecutor: template-manager
        │
        ▼
4. Generación del plan de documentación
   └── Escribe docs/plans/YYYY-MM-DD-docs-<topic>-plan.md
        │
        ▼
5. Aprobación del usuario
   ├── NO → iterar sobre el plan
   └── SÍ → transferir control al ejecutor
```

### Formato del plan de documentación

```markdown
# Plan de Documentación: [Título]

> **Para el ejecutor:** Este plan fue generado por `docs-brainstorming`.
> Usa la skill indicada en "Ejecutor" para implementarlo tarea por tarea.

**Objetivo:** [Una oración describiendo qué se busca]
**Ejecutor:** `docs-assistant` | `template-manager`
**Audiencia:** [Para quién es la documentación]
**Idioma:** Español

---

## Contexto Recopilado

[Todo el contexto descubierto: estructura del repo, docs existentes,
código analizado, decisiones del usuario. Este bloque debe ser
suficiente para que el ejecutor trabaje sin preguntar nada más]

## Entregables

### Entregable 1: [Nombre del documento/template]
- **Tipo:** Documento técnico | ADR | Runbook | Template | ...
- **Destino:** `docs/architecture/c4-context.md`
- **Plantilla base:** `adr-template.md` (si aplica)
- **Requiere skill de apoyo:** `c4-architecture` (diagramas de contexto y contenedores)
- **Contexto específico:** [Detalle de qué debe contener este entregable]

### Entregable 2: [Nombre]
- **Tipo:** ...
- **Destino:** ...
- **Requiere skill de apoyo:** ninguna
- **Contexto específico:** ...

---

## Criterios de Aceptación
- [ ] [Criterio 1]
- [ ] [Criterio 2]
```

### Diferencias clave con `brainstorming` de desarrollo

| Aspecto | `brainstorming` (dev) | `docs-brainstorming` |
|---------|----------------------|---------------------|
| Dominio | Features, código, arquitectura | Documentación, templates, diagramas |
| Output | Design doc → invoca `writing-plans` | Plan de documentación → invoca ejecutor |
| Exploración | Código, tests, commits | AGENTS.md, docs/, templates/, código (si doc técnica) |
| Clasificación | No aplica | Determina si es documentación o template |

### Casuísticas que cubre

1. **"Quiero documentar la arquitectura"** → Explora código, pregunta alcance → Plan con entregables tipo diagrama C4 + doc narrativa → `docs-assistant` con apoyo de `c4-architecture`
2. **"Necesito crear un template de runbook"** → Explora templates existentes, pregunta formato → Plan con entregable tipo template → `template-manager`
3. **"Documenta este módulo de autenticación"** → Analiza código, pregunta audiencia → Plan con doc técnica + posiblemente diagrama C4 → `docs-assistant` con apoyo de `c4-architecture`
4. **"Quiero mejorar este borrador"** → Lee borrador, detecta gaps → Plan con tareas de refinamiento → `docs-assistant`

## 4. Protocolo de Subdelegación a Skills de Apoyo

Mecanismo compartido que se incluye inline (Opción 3) tanto en `docs-assistant` como en `template-manager`.

### El protocolo

**Paso 1: Detección.** Identifica la necesidad de apoyo por una de estas vías:
- **Explícita:** El plan indica "Requiere skill de apoyo: `<nombre>`" en el entregable.
- **Implícita:** Durante la ejecución se detecta que un bloque requiere capacidades especializadas.

**Paso 2: Consulta del Registro.** Busca en la tabla de Skills de Apoyo si existe una skill que cubra la necesidad.
- Si existe → Paso 3.
- Si NO existe → Informa al usuario. Ofrece: (a) generar el contenido con mejor criterio, o (b) dejar la sección marcada como pendiente.

**Paso 3: Confirmación con el usuario.** Informa qué skill va a invocar, por qué, y qué contexto le pasará. Espera aprobación explícita.

**Paso 4: Invocación.**
1. Localiza el SKILL.md usando autodescubrimiento dinámico.
2. Lee el SKILL.md para cargar instrucciones.
3. Pasa el contexto relevante del plan.
4. Ejecuta los pasos de la skill de apoyo.

**Paso 5: Incorporación.** Toma el output, incorpóralo en el documento/template en la ubicación correcta, continúa con el siguiente bloque.

### Registro de Skills de Apoyo

| Tipo de Bloque | Skill | Detectar cuando... |
|----------------|-------|--------------------|
| Diagramas de arquitectura C4 | `c4-architecture` | El entregable requiere diagramas de contexto, contenedores, componentes, despliegue o flujos dinámicos |
| Documento desde plantilla existente | `template-wizard` | Un entregable necesita instanciar un documento nuevo basado en una plantilla oficial |

> **Extensibilidad:** Para agregar una nueva skill de apoyo, agregar una fila a esta tabla.

## 5. Evolución de `docs-assistant`

### Nuevo flujo con detección de modo

```
0. Read Repository Contract (sin cambios)

1. Detección de Modo de Operación (NUEVO)
   ├── Plan de documentación recibido → Modo Plan
   └── Sin plan → Modo Directo (flujo actual, sin cambios)

MODO PLAN:
  2. Lectura del Plan — parsea el .md, extrae contexto y entregables
  3. Ejecución por Entregable:
     a. Evalúa si requiere skill de apoyo → Protocolo de Subdelegación
     b. Genera/compone el documento
     c. Aplica formato Docs-as-Code (template, idioma, tono, estructura)
     d. Presenta al usuario
     e. Itera hasta aprobación
  4. Finalización — mueve a destino final, actualiza índices

MODO DIRECTO:
  Flujo actual de 6 pasos preservado íntegramente.
```

### Qué conserva

- Paso 0 (Read Repository Contract)
- Validación Docs-as-Code (templates, kebab-case, formato)
- Tono profesional, español, no inventar contenido
- Finalización e indexado
- Regla "CRITICAL: Do NOT hallucinate"

### Qué agrega

- Detección de modo de operación
- Parseo de plan de documentación
- Loop de ejecución por entregable con subdelegación
- Protocolo de Subdelegación (inline, con tabla de skills de apoyo)
- Iteración con usuario por entregable

## 6. Evolución de `template-manager`

### Mismo patrón que `docs-assistant`

```
0. Autodescubrimiento Contextual (sin cambios)

1. Detección de Modo de Operación (NUEVO)
   ├── Plan recibido → Modo Plan
   └── Sin plan → Modo Directo (flujo actual, sin cambios)

MODO PLAN:
  2. Lectura del Plan
  3. Ejecución por Entregable:
     a. Evalúa skill de apoyo → Protocolo de Subdelegación
     b. Ejecuta flujo correspondiente (Creación / Edición / Override)
     c. Presenta al usuario
     d. Itera hasta aprobación
  4. Guardado en LOCAL_TEMPLATES_DIR

MODO DIRECTO:
  Flujo actual de 5 pasos preservado íntegramente.
```

### Lo que conserva

- Paso 0 (Autodescubrimiento de templates globales y locales)
- Los 3 flujos internos (Creación / Edición / Override)
- Regla de solo escritura en LOCAL_TEMPLATES_DIR
- Protección de templates globales (solo lectura)

### Lo que agrega

- Detección de modo, parseo de plan, protocolo de subdelegación, iteración con usuario

## 7. Cambios en `docs-system-orchestrator`

### Catálogo actualizado

| Necesidad / Estado | Skill Destino | Cuándo usar |
|--------------------|---------------|-------------|
| **Crear/Mejorar Documentación** | `docs-brainstorming` | Cualquier necesidad de documentación nueva, mejora o diagramas. Punto de entrada principal. |
| **Crear Diagramas de Arquitectura (solo)** | `c4-architecture` | Cuando el usuario pide EXCLUSIVAMENTE diagramas C4, sin documentación narrativa adicional. |
| **Inicializar Documentación Base** | `project-context-init` | Iniciar proyectos, crear o actualizar el AGENTS.md. |
| **Documentar Código Desarrollado** | `documenting-modules` | Documentación técnica post-desarrollo. |
| **Documentar Funcionalidad / Negocio** | `business-documenting-modules` | Documentación funcional orientada a PMs/Negocio. |
| **Mejorar/Oficializar Borrador (directo)** | `docs-assistant` | Formatear un borrador existente sin brainstorming. Uso rápido. |
| **Crear Documento desde Plantilla (directo)** | `template-wizard` | Instanciar documento desde plantilla sin brainstorming. Uso rápido. |
| **Crear/Editar Plantilla (directo)** | `template-manager` | Crear o editar plantilla sin brainstorming. Uso rápido. |

## 8. Cambios en `processes.json`

Agregar `docs-brainstorming` y `c4-architecture` al proceso `docs`:

```json
{
  "docs": {
    "description": "Herramientas de documentacion con estandar Docs-as-Code",
    "skills": [
      "docs-system-orchestrator",
      "docs-brainstorming",
      "docs-assistant",
      "template-manager",
      "template-wizard",
      "documenting-modules",
      "business-documenting-modules",
      "c4-architecture"
    ]
  }
}
```

## 9. Nota sobre contexto de ejecución

Este diseño se implementa en el repositorio `agentic-workflow` que es el **source code del framework**. Las skills en `registry/skills/` son las que el CLI distribuye e instala en máquinas de usuarios finales. Por tanto:

- Las skills NO deben hardcodear rutas de este repositorio.
- Deben usar autodescubrimiento dinámico (buscar en `.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.).
- El comportamiento se valida en el contexto de un proyecto destino, no dentro de `agentic-workflow`.
