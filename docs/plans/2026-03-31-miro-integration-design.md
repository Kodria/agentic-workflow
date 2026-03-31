# Design: Integración Miro — `awm miro sync`

## Propósito

Automatizar la sincronización del Story Map (markdown) al tablero de Miro, creando un frame visual que simula el componente nativo User Story Mapping usando cards estándar posicionadas via REST API.

## Contexto y validación técnica

### Por qué no el componente nativo USM de Miro
El componente nativo `type: "usm"` retorna `isSupported: false` en la REST API. No es posible crear ni organizar cards dentro de él programáticamente.

### Por qué cards estándar en un frame
Las cards del board (`type: "card"`) sí son completamente accesibles vía REST API — se pueden crear, leer, actualizar y eliminar. Un frame con cards posicionadas con coordenadas absolutas replica visualmente la estructura del USM con control total.

### Por qué no el MCP de Miro
El MCP de Miro no soporta creación de cards ni sticky notes. Solo crea tablas, diagramas y documentos — insuficiente para este caso de uso.

## Fuente de verdad

El markdown (`docs/50-projects/story-map.md`) es y sigue siendo la fuente de verdad. Miro es una capa de presentación visual. El comando sincroniza en una sola dirección: **markdown → Miro**.

## Archivos a crear/modificar

| Archivo | Cambio |
|---------|--------|
| `cli/src/core/story-map-parser.ts` | Nuevo — parsea el markdown a jerarquía |
| `cli/src/core/miro.ts` | Nuevo — cliente REST + layout engine |
| `cli/src/index.ts` | Modificar — agregar comando `miro sync` |
| `registry/skills/story-mapping/SKILL.md` | Modificar — mención en TERMINATION_PHASE |

---

## Arquitectura

### Comando

```bash
awm miro sync <path-to-story-map.md>
```

Ejemplo:
```bash
awm miro sync docs/50-projects/story-map.md
```

### Flujo

```
story-map.md
    ↓ story-map-parser.ts
StoryMapTree (Goal, Activities, Tasks, Stories, Releases)
    ↓ miro.ts (layout engine)
CardLayout[] (cada card con x, y, width, height, color, title)
    ↓ miro.ts (REST client)
Miro Board — frame creado/actualizado
    ↓
story-map.md frontmatter actualizado con miro_frame_id
```

### Configuración por proyecto

El comando lee `.env` del directorio donde se ejecuta (cwd):

```env
MIRO_TOKEN=eyJtaXJv...
MIRO_BOARD_ID=uXjVGpNZJ-g=
```

Si no encuentra las variables → error descriptivo:
```
✗ MIRO_TOKEN not found. Add .env to your project root with MIRO_TOKEN and MIRO_BOARD_ID.
```

El frame ID se persiste en el frontmatter del story-map.md tras el primer sync:

```yaml
---
project: Portal B2B
miro_frame_id: "3458764665957846182"
---
```

---

## Layout engine

### Sistema de coordenadas

El frame se construye con coordenadas absolutas. El layout se calcula dinámicamente según el contenido del mapa.

```
┌─────────────────────────────────────────────────────────────┐
│  Story Map — {project}                              y=0     │
│                                                             │
│  [🟡 Act 1]  [🟡 Act 2]  [🟡 Act 3]               y=60    │
│  [🔵 Task]   [🔵 Task]   [🔵 Task]                y=160   │
│  [🔵 Task]   [🔵 Task]                             y=240   │
│  ──────────────── MVP ──────────────────────────── y=320   │
│  [⬜ Story]  [⬜ Story]   [⬜ Story]               y=360   │
│  [⬜ Story]                                         y=440   │
│  ──────────────── R2 ───────────────────────────── y=520   │
│  [⬜ Story]  [⬜ Story]                             y=560   │
│  ──────────── Backlog ──────────────────────────── y=640   │
└─────────────────────────────────────────────────────────────┘
```

### Dimensiones de elementos

| Elemento | Ancho | Alto | cardTheme |
|----------|-------|------|-----------|
| Activity card | 220px | 60px | `#ffdc4a` (amarillo) |
| Task card | 220px | 60px | `#659df2` (azul) |
| Story card | 220px | 80px | `#ffffff` (blanco) |
| Swimlane label (text) | ancho total frame | 30px | — |
| Gap entre columnas | 20px | — | — |

**Columna:** 240px (220 card + 20 gap)

### Cálculo de dimensiones del frame

```
frame_width  = num_activities × 240
frame_height = title_height (40)
             + activity_row (80)
             + task_rows (max_tasks_per_activity × 80)
             + per_release: [separator (40) + max_stories_in_release × 100]
```

### Coordenadas por elemento

```
Activity[i].x = i × 240
Activity[i].y = 40

Task[i][j].x = i × 240  (misma columna que su Activity)
Task[i][j].y = 140 + j × 80

swimlane_separator[r].y = 140 + max_tasks × 80 + r × (max_stories_height + 40)

Story[i][r][k].x = i × 240  (misma columna que su Task/Activity)
Story[i][r][k].y = swimlane_separator[r].y + 40 + k × 100
```

---

## Estrategia de sincronización

### Primera ejecución (sin `miro_frame_id` en frontmatter)

1. Crear frame en el board con título `Story Map — {project}`
2. Crear todas las cards posicionadas (Activities, Tasks, Stories)
3. Crear swimlane separators (text items)
4. Actualizar frontmatter del story-map.md con `miro_frame_id`
5. Reportar: `✓ Frame creado: X activities, Y tasks, Z stories`

### Ejecuciones posteriores (con `miro_frame_id`)

1. Leer todas las cards del frame existente via `GET /v2/boards/{id}/items?parent_item_id={frameId}`
2. Diff contra el markdown actual:
   - Existe en ambos, título igual → no hacer nada
   - Existe en ambos, título cambió → `PATCH` título
   - Solo en markdown → `POST` nueva card en posición correcta
   - Solo en Miro → `DELETE`
3. Recalcular layout y reposicionar todas las cards (`PATCH` position)
4. Reportar: `✓ 2 actualizadas, 3 nuevas, 1 eliminada`

### Matching de cards

Las cards se identifican por **título** (stripeando HTML tags para comparar). Si el título cambia → delete + create. El título es la clave de identidad.

---

## Integración con skill story-mapping

Cambio mínimo — solo en `<TERMINATION_PHASE>` del `SKILL.md`:

```markdown
📋 Story map guardado en docs/50-projects/story-map.md

Si tienes Miro configurado (.env con MIRO_TOKEN y MIRO_BOARD_ID):
  awm miro sync docs/50-projects/story-map.md
```

La mención es opcional — el markdown sigue siendo la fuente de verdad. No cambia ningún modo ni flujo de la skill.

---

## APIs de Miro utilizadas

| Operación | Endpoint |
|-----------|---------|
| Crear frame | `POST /v2/boards/{id}/frames` |
| Crear card | `POST /v2/boards/{id}/cards` |
| Actualizar card | `PATCH /v2/boards/{id}/cards/{cardId}` |
| Eliminar item | `DELETE /v2/boards/{id}/items/{itemId}` |
| Listar items del frame | `GET /v2/boards/{id}/items?parent_item_id={frameId}` |
| Crear text (swimlane) | `POST /v2/boards/{id}/texts` |

Base URL: `https://api.miro.com`
Auth: `Authorization: Bearer {MIRO_TOKEN}`

---

## Lo que NO cambia

- La estructura del markdown y el template de story-map.md
- Los modos A, B, C de la skill
- El flujo de sesión y terminación (excepto la mención del comando)
- La ubicación del documento (`docs/50-projects/`)
- El markdown como fuente de verdad
