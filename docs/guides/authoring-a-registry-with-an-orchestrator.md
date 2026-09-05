# Crear un registry que aporte un orquestador

Un registry externo puede aportar un **orquestador declarado**: un proceso propio que AWM considera al inicio de la sesión, antes de `development-process` y `product-process`. Esta guía es el método reproducible; no hace falta copiar nada del registry base a mano.

## 1. Layout mínimo

Un registry es un repositorio git con al menos uno de los directorios de contenido en su raíz. Para aportar un orquestador alcanza con `skills/`:

```
mi-registry/
├── awm-registry.json
├── catalog.json
├── bundles/
│   └── mi-proceso/
│       └── bundle.json
└── skills/
    └── mi-proceso/
        └── SKILL.md
```

`awm registry add` valida este layout y **rechaza el registry si colisiona por nombre** con contenido ya instalado, revirtiendo el clon. Elegí nombres de skill específicos.

> **Nunca pongas credenciales ni tokens en ningún archivo de este registry** (`awm-registry.json`, `catalog.json`, `bundle.json`, `SKILL.md`) — todo se publica tal cual vía `git push` (Sección 7); el acceso a sistemas externos se resuelve por fuera.

## 2. `awm-registry.json`

Declara la versión mínima de CLI que tu contenido necesita y el orquestador que querés aportar:

```json
{
  "minCliVersion": "8.1.5",
  "orchestrator": {
    "name": "mi-proceso",
    "appliesWhen": "cuando una sesión debe seguir mi proceso propio",
    "terminatesTo": "development-process"
  }
}
```

El bloque `orchestrator` tiene contrato cerrado:

- Debe tener exactamente tres campos: `name`, `appliesWhen` y `terminatesTo`. Cualquier campo extra se diagnostica y esa declaración se descarta.
- Los tres valores deben ser strings no vacíos de hasta 500 caracteres cada uno.
- `appliesWhen` no debe terminar con punto: el renderer agrega el punto cuando compone el contexto.
- `name` debe coincidir con el nombre del directorio `skills/<name>/SKILL.md`. En este ejemplo, `name: "mi-proceso"` apunta a `skills/mi-proceso/SKILL.md`. El `name` del frontmatter de `SKILL.md` no controla discovery.

Si el bloque `orchestrator` es inválido, AWM emite un diagnóstico y descarta solo esa declaración; no aborta la instalación del registry ni invalida sus otros contenidos.

## 3. `catalog.json`

Enumera tus bundles. `scope` es `baseline` si querés que se instale por defecto, o `project` si es opt-in por proyecto:

```json
{
  "version": 1,
  "bundles": [
    { "name": "mi-proceso", "source": "./bundles/mi-proceso", "version": "1.0.0", "scope": "project" }
  ]
}
```

## 4. `bundles/mi-proceso/bundle.json`

```json
{
  "name": "mi-proceso",
  "version": "1.0.0",
  "description": "Mi proceso de trabajo propio.",
  "scope": "project",
  "dependsOn": [],
  "skills": ["mi-proceso"],
  "workflows": [],
  "agents": []
}
```

La versión está **duplicada** a propósito entre `catalog.json` y `bundle.json`, y las dos deben avanzar juntas en cada release.

## 5. `skills/mi-proceso/SKILL.md`

El frontmatter y las cuatro cosas que el contrato exige: identidad, cuándo aplica, qué hace, y a quién le cede el control.

```markdown
---
name: mi-proceso
version: "1.0.0"
description: Use when <la condición concreta en la que este proceso aplica>. Declared orchestrator.
---

# Mi proceso

## Cuándo aplica

<Redactalo filoso. Es lo único que el agente lee para decidir si te activa.
Un disparador vago activa de más; uno demasiado angosto no activa nunca.>

## Qué hace

<Los pasos del proceso.>

## Terminación

Este orquestador cede el control a `development-process` cuando termina.

<Nombrá exactamente uno: otro orquestador declarado, `development-process`,
`product-process`, o ninguno. Si nombrás uno que puede no estar instalado,
el agente lo informa y sigue con el ruteo normal — no aborta.>
```

## 6. Validar antes de publicar

`awm registry add` clona el path, así que primero necesita ser un repo git de verdad:

```bash
cd mi-registry
git init && git add -A && git commit -m "initial registry layout"
```

Instalalo desde la ruta local, sin publicar nada. `--name` es el nombre del *registry* en `~/.awm/registries/` — un namespace propio, independiente del nombre del bundle o del skill. `--install-all` es necesario acá: sin él, en modo no interactivo `awm registry add` deja el bundle sin instalar (solo imprime un hint) y su skill queda invisible para el agente:

```bash
awm registry add /ruta/a/mi-registry --name mi-proceso --install-all
awm registry list
awm context orchestrators --verify mi-proceso
```

`awm registry list` confirma que instaló: imprime una línea por registry con nombre, remote, y el conteo de contenido descubierto (`N skills, M bundles, K workflows, L agents`).

`awm context orchestrators --verify mi-proceso` confirma que el orquestador está compuesto en el contexto real de sesión. Sale `0` si está compuesto y `2` si no lo está; un `2` suele indicar que el `orchestrator.name` no coincide con un directorio discoverable bajo `skills/`, que la declaración fue inválida, o que el registry no quedó instalado.

Si el layout está mal o hay colisión de nombres, el comando falla y revierte el clon. Para volver atrás:

```bash
awm registry remove mi-proceso
```

## 7. Publicar

Esto asume que `mi-registry` ya tiene un remoto configurado (GitHub u otro) — a diferencia de la Sección 6, que valida desde un path local sin remoto.

```bash
git tag v1.0.0
git push origin v1.0.0
```

En las máquinas que lo usen:

```bash
awm update
```

## Aislamiento

El registry se instala bajo `~/.awm/registries/` y sus skills se enlazan a `~/.claude/skills/`. **Nada toca el árbol versionado de tu repositorio de trabajo**, así que un registry personal instalado en tu máquina es invisible para quien clone ese repositorio. Verificalo con `git status --porcelain` después de instalar: debe salir vacío.
