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
| [D-007](#d-007) | 2026-08-09 | Un artefacto usurpado se **reporta**, no se auto-repara | Vigente |
| [D-008](#d-008) | 2026-08-09 | El exit code de `awm init` responde por init, no por la salud del harness | Vigente |

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

---

## D-007

**Cuando un tercero reemplaza un artefacto que AWM instaló, `doctor` lo reporta. No lo arregla solo.**

El caso apareció corriendo el playbook `agent-matrix` contra el binario real: Claude Code
trae su propia skill `mermaid-diagrams` y la materializó encima del symlink que `awm init`
había puesto en `~/.claude/skills/`. El agente cargaba la del tercero. `awm doctor` decía
`healthy`, `overall: healthy`, exit `0`; `awm sync` no lo tocaba.

**Por qué era invisible:** `classifySkillLinks` empieza con `if (!lst.isSymbolicLink()) continue`.
Eso es correcto para una skill que puso el usuario a mano — AWM no debe tocarla — y falso
cuando `state/artifacts.json` dice que esa ruta exacta es nuestra. El clasificador nunca
leía el ledger, así que no tenía cómo distinguir los dos casos. **El ledger de propiedad
existía desde siempre; ningún diagnóstico lo consultaba.**

**Implica:**
- `SkillIntegrity` gana una cuarta categoría, `usurped`, separada de `valid`/`repairable`/`dead`.
- `skills.global` pasa a `broken`, nombra qué fue reemplazado, y `overall` degrada.
- El remedio es `reinstall-usurped-skills`, **no** `repair-global-skills`: ese último solo
  re-linkea symlinks colgantes, así que correría limpio sin cambiar nada — mandar ahí al
  usuario sería peor que no ofrecer remedio.
- Solo aplica al renderer `link`. Para `cursor-mdc` / `copilot-instructions`, "no es un
  symlink" es el estado sano; contarlo pintaría de rojo toda instalación correcta.

**Por qué no se auto-repara:** restaurar el symlink exige borrar un directorio real con
contenido de un tercero. Eso es destructivo y no es reversible desde el backup de AWM, que
solo conoce lo que AWM escribió. Se reporta con nombre y remedio; la orden la da una persona.

**Efecto lateral, del mismo tipo de bug:** `MachineFacts.globalSkills` era una copia
estructural escrita a mano de `SkillIntegrity` (`{ valid; repairable; dead }`). Como era un
subconjunto exacto, TypeScript nunca se quejó, y al crecer el tipo real esta copia quedó
atrás en silencio. Ahora referencia el tipo. Es la misma clase que la tabla de renderers
duplicada de D-002: **una copia de algo que el código ya define en otro lado.**

---

## D-008

**`awm init` sale `0` cuando init hizo su trabajo, aunque el harness quede `degraded`.** (Opción 1 de las tres evaluadas.)

Salía `1` cuando el `doctor` posterior reportaba `degraded` — que en un primer run es lo
**normal**: dos pasos quedan `pending` porque `CONSTITUTION.md` y `AGENTS.md` los escribe
una sesión de agente, no el CLI. Un run donde no fallaba nada reportaba fallo.

**La evidencia de que era un bug y no una convención:**
- `awm init --yes && <siguiente>` se cortaba bajo `set -e` — en el único comando cuyo
  trabajo entero es arrancar un script de bootstrap.
- `core-acceptance.md` había crecido un recuadro **⚠️ Read this before judging any exit
  code** pidiendo ignorarlo. Cuando la doc tiene que pedir que ignores el comportamiento,
  el comportamiento es el problema.
- **Tres lectores independientes** lo reportaron como fallo: dos corridas del playbook
  `agent-matrix` marcaron AG-02 y CX-01 FAIL con `failed: 0` en su propio JSON.

**El contrato nuevo:**

| Código | Significa |
|---|---|
| `0` | Init hizo su trabajo. Puede quedar `degraded`; eso sigue siendo éxito. |
| `2` | No se completó: un gate rechazó, o un paso falló y se revirtió todo. |

`1` deja de usarse. La distinción `ok`/`degraded` no se pierde: sigue en el campo `result`
del `--json`, que es donde un consumidor que la quiera debe leerla. "¿El harness está
sano?" es la pregunta de `awm doctor`, no de `init`.

**Descartadas:**
- *Un flag `--strict`* — mantiene compatibilidad con scripts que hoy chequean el `1`, pero
  deja dos semánticas conviviendo y un flag más que explicar, para preservar un
  comportamiento que nadie quería.
- *Solo arreglar la doc* — riesgo cero, pero el próximo que escriba un script de bootstrap
  o corra un playbook vuelve a chocar. Ya se repitió tres veces.

**Costo:** es un cambio de contrato observable, así que sale como **major (v5.0.0)**. Un
script que hoy hace `awm init || echo degradado` deja de imprimir esa rama; el reemplazo es
leer `result` del `--json`.

**Cómo se detuvo:** el sitio que faltaba era el test ausente — ningún test preguntaba si un
script podía encadenar `awm init &&`. Había dos assertions de `toBe(1)`, y las dos
*documentaban* el bug en vez de detenerlo.
