# Diseño: Rediseño UX de `awm list` y `awm add`
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

**Fecha:** 2026-06-01
**Estado:** Aprobado
**Tipo:** Mejora de UX (CLI)

## Problema

El registry creció: **44 skills**, 2 workflows, 2 agents, repartidos en **5 paquetes**
(`processes`). `core-dev` agrupa 30 skills y `docs` 16. A esta escala:

- **`awm list`** vuelca todo de golpe como un muro de texto, sin paginación ni forma
  de colapsar. Cada paquete imprime su árbol completo (`index.ts:309-342`).
- **`awm add`** usa un `multiselect` de `@clack/prompts` con opciones **aplanadas**
  (`buildGroupedOptions` en `utils/grouping.ts`): el paquete y todos sus hijos son
  entradas planas en una sola lista de ~54 ítems. Navegar para seleccionar un
  paquete es incómodo y no se leen bien las skills de cada uno.
- Las **descripciones** de las skills no se muestran en ningún momento (solo la
  descripción del paquete, que vive en `processes.json`).

## Objetivo

Hacer ambos comandos legibles y navegables a esta escala: listas cortas en cada
paso, navegación jerárquica y descripciones visibles donde aportan contexto.

## Enfoque

Seguir con **`@clack/prompts`** (ya es la única dependencia de prompts) y construir
la jerarquía **secuenciando prompts** (`select`/`multiselect` encadenados) en lugar
de un único multiselect plano. Sin nuevas dependencias.

Alternativas descartadas:
- Cambiar a `inquirer`/`enquirer`: añade peso y obliga a reescribir todos los prompts.
- TUI custom (p. ej. `blessed`): sobre-ingeniería para 5 paquetes.

## Componente nuevo: modelo de vista compartido

Un único módulo **`cli/src/utils/registry-view.ts`** que ambos comandos consumen,
para eliminar la lógica de agrupación duplicada hoy entre `index.ts:286-307` y
`utils/grouping.ts`.

```
buildPackageView(skills, workflows, agents, processes) -> PackageView[]

interface PackageView {
  name: string;
  description: string;
  artifacts: ArtifactView[];
  counts: { skills: number; workflows: number; agents: number };
}

interface ArtifactView {
  name: string;          // baseName, sin extensión
  type: ArtifactType;    // 'skill' | 'workflow' | 'agent'
  sourcePath: string;    // para instalar (solo necesario en `add`)
  installName: string;   // nombre final en disco (ej. "foo.md" o "foo/")
  description: string;   // del frontmatter; '' si no existe
}
```

- Incluye un paquete sintético **`🔹 standalone`** para artefactos que no pertenecen
  a ningún proceso.
- Un mismo artefacto puede aparecer en varios paquetes (igual que hoy lo permite la
  agrupación actual).

### Resolución de descripciones

- Nueva helper **`readArtifactDescription(path: string): string`** en
  `core/discovery.ts`: lee el archivo, extrae el bloque de frontmatter YAML
  (`---\n...\n---`) y devuelve el valor del campo `description:`. Parser ligero por
  regex — **no** se añade `gray-matter`.
- `discoverSkills/discoverWorkflows/discoverAgents` pasan a incluir `description` en
  su artefacto (campo nuevo en las interfaces `SkillArtifact`, `WorkflowArtifact`,
  `AgentArtifact`).
- Para skills la descripción está en `SKILL.md`; para workflows/agents en su `.md`.
- Si no hay `description`, devuelve `''` y la UI muestra solo el nombre.

## `awm add` — flujo drill-down de 2 niveles

Se conserva el orden actual del comando: **agente → scope → artefactos → método →
confirmar**. Solo cambia el paso de selección de artefactos (hoy `index.ts:141-163`).

1. **Nivel 1 — selección de paquetes** (`multiselect`):
   - Una entrada por paquete: `📦 <nombre>` con `hint` = `N skills · <descripción>`.
   - Más `🔹 standalone` si hay artefactos sueltos.
   - ~6 entradas → lista corta y legible.

2. **Nivel 2 — skills por paquete** (un `multiselect` por cada paquete elegido,
   **en secuencia**, con cabecera de progreso `[1/2] core-dev — select skills:`):
   - Primera opción **`✨ Install entire package (N)`**, **preseleccionada**.
   - Luego cada artefacto del paquete: **nombre** en la primera línea y su
     **descripción atenuada** debajo. Si `@clack` no renderiza bien el salto de
     línea dentro del `label`, fallback a usar `hint` (descripción en la misma línea,
     atenuada). Se valida en la fase de planning.
   - Workflows/agents del paquete aparecen aquí con su icono (`⚡`/`🤖`).
   - **Semántica de selección:**
     - Si `✨ Install entire package` queda marcada → se instalan **todos** los
       artefactos del paquete, ignorando marcas individuales.
     - Si se desmarca → se respeta el cherry-pick de los artefactos marcados.

3. Se **acumulan** los artefactos resueltos de todos los paquetes y el flujo continúa
   igual que hoy: método de instalación, confirm (`--yes` lo salta) e instalación.

Los flags no interactivos (`-t`, `-a`, `-s`, `-m`, `-y`) se conservan; el drill-down
solo aplica al modo interactivo.

## `awm list` — resumen + detalle on-demand

Sigue sincronizando el registry primero (igual que hoy, `index.ts:263-272`).

- **`awm list`** (sin args) — vista compacta:
  ```
  AWM Registry — 5 packages, 44 skills

  📦 core-dev         30 skills   dev lifecycle
  📦 docs             16 skills   docs-as-code
  📦 frontend-design   5 skills   UI craft
  📦 notion-career     1 skill
  📦 notion-procesos   2 skills
  🔹 standalone        3 artifacts

  awm list <pkg>  ·  awm list --all
  ```
  Conteos alineados; descripción del paquete a la derecha.

- **`awm list <pkg>`** — expande un paquete: sus artefactos con descripción.
  Match por nombre exacto; si no existe, sugiere el más cercano y sale.

- **`awm list --all`** — imprime todos los paquetes expandidos (equivalente al
  detalle actual, pero alineado y con descripciones).

## Casos borde / manejo de errores

- Registry vacío → mensaje claro (patrón actual de `outro` amarillo).
- `awm list <pkg>` con paquete inexistente → error + sugerencia del más cercano.
- Skill sin `description` en frontmatter → solo se muestra el nombre (sin línea vacía).
- Paquete con workflows/agents → incluidos en nivel 2 con su icono; `✨ Install
  entire package` los incluye.
- Cancelación (Ctrl-C / ESC) en cualquier prompt → `handleCancel` actual.

## Testing

- **`tests/utils/registry-view.test.ts`** (nuevo): construcción del modelo, paquete
  `standalone`, conteos por tipo, resolución de descripciones (con y sin frontmatter),
  artefacto en múltiples paquetes.
- **`discovery`**: test de `readArtifactDescription` (frontmatter presente, ausente,
  malformado).
- **`awm list`**: test de la lógica pura de filtrado por `<pkg>` y del resumen
  (funciones puras que devuelven líneas, separadas del `console.log`).
- Actualizar o retirar **`tests/utils/grouping.test.ts`** según se reemplace
  `buildGroupedOptions`.
- Los flujos interactivos de `@clack` no se testean por unidad (igual que hoy); se
  aísla la lógica pura del render para poder testearla.

## Fuera de alcance

- No hay fase de UI screens (CLI, sin pantallas gráficas para Stitch).
- No se cambia la dependencia de prompts.
- No se modifica `awm remove` ni otros comandos (aunque podrían reutilizar
  `registry-view` en el futuro).
