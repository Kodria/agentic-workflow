# Decisiones

Registro de decisiones de producto y de proceso. **Una decisión que solo vive en un hilo de conversación está perdida.** Acá quedan con su razón y su consecuencia, para que dentro de seis meses nadie tenga que reconstruirlas ni volver a discutirlas.

Formato: qué se decidió, por qué, qué implica. Sin historia larga — eso vive en el PR que la implementó.

| # | Fecha | Decisión | Estado |
|---|---|---|---|
| [D-001](#d-001) | 2026-08-09 | AWM instala bundles, no artefactos sueltos | Vigente |
| [D-002](#d-002) | 2026-08-09 | La matriz de soporte se genera del código | Vigente |
| [D-003](#d-003) | 2026-08-09 | Cuatro niveles de evidencia, y `BLOCKED` nunca es `PASS` | Vigente |
| [D-004](#d-004) | 2026-08-09 | macOS entra a la matriz de CI | Vigente |
| [D-005](#d-005) | 2026-08-09 | El gate de release corre en las tres plataformas | Vigente |
| [D-006](#d-006) | 2026-08-09 | `awm remove` tiene modo no interactivo, simétrico con `add` | Vigente |

---

## D-001

**AWM instala bundles, no artefactos sueltos.**

Las skills de AWM se apoyan unas en otras: el spine de `development-process` invoca `brainstorming`, `writing-plans`, los gates de QA. Una skill instalada sola casi nunca hace lo que el usuario espera.

**Implica:**
- `awm add <nombre>` resuelve **solo** contra bundles. Un nombre de skill devuelve `Bundle "<x>" not found in registry`.
- El flag `-t, --type` se eliminó. Existía, `add.ts` **nunca lo leía**, y la documentación lo presentaba como el camino scripteado — una invocación que siempre falló.
- Los playbooks de aceptación (`CORE-07`, `AG-03`) usaban esa invocación. **Nunca podrían haber pasado**: se escribieron contra la documentación, no contra el comportamiento.

**Si esto se revierte:** habría que implementar la instalación por artefacto de verdad, no reponer el flag. Un flag que no se lee es peor que uno ausente, porque promete.

---

## D-002

**Las rutas de instalación por proveedor se generan desde `cli/src/providers/index.ts`.**

La tabla escrita a mano afirmó durante varias releases que Antigravity instalaba en `~/.agents/skills` y `.agents/skills`; el código dice `~/.gemini/antigravity/skills` y `.agent/skills` (singular). El mismo error estaba duplicado en dos documentos.

**Implica:** `npm run docs:matrix` regenera; `tests/structural/support-matrix-is-current.test.ts` pone la CI en rojo si el documento y el código se separan. Ningún documento vuelve a escribir una ruta a mano.

---

## D-003

**Cuatro niveles: ✅ verificado · ⚠ sin verificar · ⛔ no soportado · 🔜 planeado.**

"Implementado" y "verificado" son afirmaciones distintas. La segunda exige que **una máquina lo haya ejecutado**.

**Implica:** `BLOCKED` en un playbook nunca se registra como `PASS`. Un nivel sube citando la evidencia (una corrida de CI, un playbook con resultado), no la intención.

**Evidencia de que no es burocracia:** macOS estaba en ⚠ solo porque nadie lo había agregado — "nada en el código es específico de macOS" era el argumento. Su primera corrida encontró un defecto de producto real (ver D-004).

---

## D-004

**macOS entra a la matriz de CI** (`ubuntu-latest`, `windows-latest`, `macos-latest`).

El repo es público: los runners no cuestan minutos.

**Lo que costó y lo que encontró:** cuatro rondas. Un bug de producto (la lista de backup nombraba el mismo archivo dos veces, porque `/var` es symlink a `/private/var` en macOS), un tercer archivo de tests con un problema que se había arreglado en dos, y una debilidad de timing preexistente.

**Patrón de fondo, 5 casos en un ciclo:** tomar una propiedad de la plataforma como universal — bit de ejecución, separador de ruta, prefijo del home sin normalizar, fin de línea, `/var` como directorio real. **La contramedida no es correr en más plataformas** (eso los encuentra tarde), es exportar la unidad y probarla con las dos formas del dato. Detalle en `AGENTS.md`, patrón `platform-property-assumed-universal`.

---

## D-005

**El gate del release corre en las tres plataformas.** (Opción 2 de las tres evaluadas.)

`release.yml` corría sus tests solo en `ubuntu-latest` y no dependía de la matriz `ci` — un workflow aparte, disparado por PR. Un fallo exclusivo de Windows o macOS publicaba a npm igual. **Pasó con la v3.13.7**, que salió con la matriz en rojo. `CLAUDE.md` afirmaba *"CI gates the release on the tests passing"*; era cierto para una plataforma.

`release.yml` ahora tiene su propio job `test` con la matriz de tres sistemas, y el job `release` declara `needs: test`. Rojo en cualquiera de las tres no publica.

**Descartadas:**
- *Corregir la doc a "sobre Linux"* — honesto y sin riesgo, pero aceptaba que un bug solo-Windows pudiera publicarse. Este ciclo produjo cinco bugs específicos de plataforma; no es hipotético.
- *`workflow_run`* — más limpio conceptualmente, pero es el que más riesgo tiene de dejar de publicar en silencio si queda mal configurado. La duplicación de la matriz entre `ci.yml` y `release.yml` es el precio, y es visible.

**Costo:** el release espera a las tres plataformas (~5 min, lo que tarda Windows) en vez de ~2. Se paga una vez por merge a `main`.

---

## D-006

**`awm remove` acepta `[name]`, `--scope` y `--yes`.** Simétrico con `add`: si se puede instalar scripteado, se tiene que poder desinstalar scripteado.

Era interactivo puro. Una limpieza automatizada quedaba bloqueada, y el playbook (`CORE-17`) scripteaba `awm remove dev --yes` — una invocación que nunca existió. **Tercera vez en esta sesión** que un playbook se escribió contra lo que la doc prometía y no contra el comportamiento (las otras dos: `--type` en `add`, y `AG-03`).

**Dos límites deliberados:**
- **`--yes` sin nombre se rechaza.** Borraría lo que el usuario nunca eligió — un `rm -rf` silencioso sobre todo lo instalado. Sin nombre, la remoción sigue siendo interactiva: `--yes` salta la *confirmación*, nunca la *selección*.
- **`--yes` implica cero prompts.** La primera versión seguía abriendo el multiselect de agentes sin `--agent`, así que el flag prometía no-interactivo y colgaba cualquier script. Sin `--agent`, el default son los agentes habilitados — igual que `add`, `sync`, `update` y `doctor`.

El nombre es de **bundle**, por D-001. Remover lo que no está instalado no es error: reporta que nada coincidió y sale `0`, así que un script de limpieza es seguro de re-correr.
