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
| [D-009](#d-009) | 2026-08-09 | Los releases se serializan, y el tag se empuja antes que la rama | Vigente |
| [D-010](#d-010) | 2026-08-09 | Un hook que nunca corrió no se reporta `HEALTHY` | Vigente |
| [D-011](#d-011) | 2026-08-09 | Cada agente resuelve su raíz de configuración por su propia variable de entorno | Vigente |
| [D-012](#d-012) | 2026-08-09 | Worktree con fallback serial, no requisito duro (cierra DA-3) | Vigente |
| [D-013](#d-013) | 2026-08-09 | El set de referencia de sensores vive en el `pack.json` del registry (cierra DA-4) | Vigente |
| [D-014](#d-014) | 2026-08-09 | La detección de cobertura **reporta**, nunca instala ni configura (cierra DA-6) | Vigente |
| [D-015](#d-015) | 2026-08-09 | Umbral empírico ≥2, y es señal, no compuerta (cierra DA-5) | Vigente |
| [D-017](#d-017) | 2026-08-14 | Compatibility is evidence, not a fallback assumption | Active |
| [D-018](#d-018) | 2026-08-14 | Coverage reports never create a false green | Active |
| [D-019](#d-019) | 2026-08-14 | Schema v2 is a deliberate, reviewable migration | Active |
| [D-020](#d-020) | 2026-08-14 | Retrospective coverage runs before ledger archive | Active |

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

---

## D-009

**Los releases corren de a uno, y despues del publish el tag se empuja antes que la rama.**

Salio de validar la v5.0.0: **`4.0.1` existe en npm y no existe en git** — sin tag `v4.0.1`,
sin entrada de CHANGELOG, sin commit de bump. Es instalable y no hay forma de decir desde
el repo que la produjo.

**Como paso:** mergeé el PR #45 mientras el release de #44 estaba en vuelo. La corrida de
#44 hizo commit, tag, **publish**, y recien despues `git push origin main` — que ya estaba
atras, y fue rechazado por non-fast-forward. El job murio ahi. npm quedo con la version;
git no se entero.

**El orden importaba y estaba al reves.** El publish es irreversible; el push no. Todo lo
que se haga despues de publicar puede fallar y dejar a npm adelantado, asi que lo unico que
se decide es cuanto alcanza a quedar registrado.

**Implica:**
- `release.yml` declara `concurrency: { group: release-<ref>, cancel-in-progress: false }`.
  Serializa. `cancel-in-progress: false` es la mitad importante: cancelar un release a
  mitad de camino es justo el modo de falla que se quiere evitar — la segunda corrida
  **espera**.
- Despues del publish se empuja **primero el tag**, que no puede entrar en conflicto (es
  una ref nueva). En el peor caso queda la identidad exacta de lo publicado, y lo unico
  que falta es el commit de bump, que una persona repone.
- El push de la rama reintenta con `pull --rebase` (3 intentos). Si igual no entra, el
  error **nombra el estado real**: `vX.Y.Z YA SE PUBLICO en npm … NO re-publicar`, con la
  instruccion de reconciliar a mano. Un `failed to push some refs` pelado no le dice a
  nadie que npm quedo adelantado.

**El sitio que faltaba era el test ausente:** el happy path afirmaba que las dos lineas de
push existen — no en que orden, y nada cubria que pasa si una falla.

**Pendiente, y no lo decide el codigo:** que hacer con la `4.0.1` publicada. Las opciones
son dejarla (es funcionalmente la 4.0.0 mas el fix de `doctor`), taggearla
retroactivamente sobre el merge de #44, o deprecarla en npm. Deprecar es visible para
cualquiera que la instale, asi que lo decide una persona.

---

## D-010

**`awm hooks status` deja de decir `HEALTHY` sobre un hook que nunca se vio correr.**

Salio de la corrida del playbook de Codex en el VPC. La salida real que leyo quien lo corrio:

```
  Trust:              … pending-trust

  Status: HEALTHY
```

Dos lineas, contradictorias. `overall` se calculaba con `sessionStartScript.ok &&
settingsEntry.ok` — **ignorando `trust` por completo**. Los archivos estan, entonces
verde. Que el hook jamas se haya ejecutado no entraba en la cuenta.

`doctor --json` decia la verdad (`hook.trust: pending-trust`). La vista humana no, y es la
que mira una persona.

**Implica:**
- `overall` gana `PENDING_TRUST`: instalado y bien formado, pero nunca confirmado
  corriendo. No es `HEALTHY` — de un hook que nunca corrio no se puede afirmar que
  entregue contexto — y no es `DEGRADED`, porque no hay nada roto que arreglar.
- `trust: 'stale'` (el script cambio desde la ultima corrida confirmada) ahora si degrada.
  Era la rotura mas clara de las tres y se reportaba en verde.
- `PENDING_TRUST` sale `0`. Salir `1` en toda instalacion recien hecha convertiria el
  comando en ruido; el texto ya no miente, que era el problema.

**El sitio que faltaba era el test ausente:** los tests de Codex afirmaban `.trust` y
**nunca** `.overall`. El campo equivocado no lo miraba nadie.

**Ademas, `hooks` acepta `-a, --agent` como alias de `-t, --target`.** `hooks` nacio con
`--target` y el resto del CLI (`add`, `remove`, `sync`, `update`, `doctor`) usa `--agent`.
La asimetria se cobro la misma corrida: `awm hooks status --agent codex` fallaba con
`unknown option`. Se agrega alias en vez de renombrar, para no romper a quien ya scriptea
`--target`.

**Cerrado después:** el código `open-hooks-trust` era un remedio inejecutable — `doctor` lo
emitía y no estaba explicado en ningún lado. `awm hooks status` ahora reproduce el prompt
exacto que Codex muestra (`Hooks need review` / `Trust all and continue`), **texto observado
en una corrida real, no parafraseado**. Para un agente cuyo prompt nadie vio, el mensaje
queda genérico: inventarlo sería peor, porque mandaría a buscar algo que quizá no existe.

**Abierto, del mismo reporte:** `~/.codex/hooks.json` **no** vive bajo `AWM_HOME`, asi que
una corrida "aislada" del playbook deja ahi una entrada permanente apuntando a un directorio
temporal. La corrida del VPC termino con DOS entradas de AWM bajo `SessionStart`, ambas con
el mismo matcher. `awm init` no la reconoce como propia porque compara contra el
`scriptsDir` actual, y agrega otra. Falta decidir si eso se deduplica, se limpia en el
teardown del playbook, o ambas.

---

## D-011

**Cada proveedor declara su variable de entorno de configuración, y TODAS sus rutas la respetan.**

`awm hooks status` decía que el hook de Codex estaba instalado. Codex nunca lo ejecutaba. Los
dos tenían razón: en esa máquina `CODEX_HOME` apuntaba fuera del home, Codex leía
`$CODEX_HOME/hooks.json`, y AWM había escrito en `~/.codex/hooks.json`. **Instalación
correcta, en el archivo que nadie mira.**

Lo peor no fue el bug: fue que `doctor` lo reportara sano. Escribía y verificaba en el
mismo lugar equivocado, así que el diagnóstico confirmaba su propia suposición. Un chequeo
que solo puede ver lo que él mismo hizo no es un chequeo.

**La asimetría de fondo:** AWM honra `AWM_HOME` para sí mismo desde siempre, y le negaba
esa misma cortesía a todos los agentes que administra. Cada ruta de proveedor salía de
`homeDir()` y punto.

**Implica:**
- `ProviderConfig` gana `configHome: { envVar, dir, resolved }`. Una sola tabla, `CONFIG_HOME`.
- `codex: { envVar: 'CODEX_HOME' }` — **confirmado contra el binario real** (0.146.0).
- Los demás quedan en `envVar: null`. Eso es *"no le conocemos override"*, no *"no tiene"*.
  **No se inventan variables:** una que no exista prometería una configurabilidad que no
  funciona, que es peor que no ofrecerla. Confirmar una es cambiar una línea.
- Una variable vacía o en blanco (`export CODEX_HOME=`) cae al default. Tomarla al pie de
  la letra dejaría las rutas colgando de la raíz.
- **Las convenciones compartidas no se mueven.** `~/.agents/skills` lo usan Codex y
  OpenCode: es del ecosistema, no de un agente. Moverlo con `CODEX_HOME` desconectaría a
  OpenCode de sus propias skills.

**El guard es una propiedad, no una lista.** `provider-paths-honor-config-home` recorre la
tabla entera: para cada proveedor que declare override, setearlo tiene que mover **todas**
sus rutas propias. Eran tres las afectadas (`hooks.json`, `agents/`, `AGENTS.md`) y
arreglar dos habría dejado el bug vivo en la tercera — el patrón que más se repitió en este
repo. Verificado por revert: devolver **una sola** ruta al hardcode pone el guard en rojo.
Un proveedor nuevo lo hereda sin que nadie se acuerde.

**Efecto lateral que vale:** el aislamiento de los playbooks ahora funciona de verdad. Antes
`AWM_HOME` no alcanzaba, porque los archivos del agente viven fuera de él y una corrida de
prueba contaminaba el `hooks.json` real — que fue justo lo que hizo dudar del resultado.

**Cerrado el mismo día.** Con el hook registrado donde Codex mira, Codex mostró su prompt
`Hooks need review`, se otorgó la confianza y el hook corrió — sin bypass. Codex pasa a ✅
en las tres columnas. La compuerta de confianza era real pero **no** era la causa: nunca se
llegaba a ella. Una hipótesis plausible que resultó falsa, y solo el diagnóstico de la ruta
la separó del síntoma.

---

## D-012

**El worktree es el camino preferido, con fallback serial. No es requisito duro.** (Cierra DA-3.)

La duda era si R5 debía exigir worktrees o degradar a ejecución serial cuando no estén
disponibles. **La respuesta ya estaba en el código:** el reducer de R5 implementa
`FALLBACK_PENDING` → `SERIAL` con `begin-fallback`, y la restricción C2 define exactamente
cuándo se permite — solo cuando todos los tracks están `REMOVED` o nunca pasaron de
`DECLARED`.

Lo importante es lo que ese diseño **no** hace: `BLOCKED` significa *"no pude probar de
quién es este recurso"* y **jamás** habilita serial. Mientras haya un track bloqueado, la
cohorte espera evidencia de una persona. Degradar a serial con worktrees ajenos vivos sería
correr encima de algo que no probamos que sea nuestro.

**Implica:** exigir worktrees habría hecho a R5 inutilizable donde no se pueden crear, y no
hay ninguna garantía que se gane con esa exigencia — el fallback ya es seguro por
construcción. Se cierra a favor de lo ya construido.

---

## D-013

**El set de referencia de cada sensor-pack vive en su `pack.json`, en `awm-baseline-registry`.** (Cierra DA-4.)

R2 necesita saber qué sensores *debería* tener un stack para reportar cuáles faltan. La
pregunta era dónde vive esa lista y quién la mantiene.

`sensor-packs/<pack>/pack.json` ya existe para `generic`, `js-ts`, `python` y `shell`. El
set de referencia es una propiedad **del pack**, no del CLI: se versiona con él, se
distribuye con él y se actualiza por el mismo flujo — editar el registry → tag → `awm update`.

**Por qué no en el CLI:** metería conocimiento de stacks concretos dentro del binario, que
es exactamente lo que se sacó al eliminar `FALLBACK_DEFAULTS`. El CLI compara; el registry
declara.

**Quién lo mantiene:** quien mantiene el pack. Un pack sin set de referencia no es un error
— es un pack que todavía no declara cobertura esperada, y R2 lo reporta como tal en vez de
inventar un default.

---

## D-014

**La detección de cobertura reporta lo que falta. No lo instala ni lo configura.** (Cierra DA-6.)

Es la misma frontera que el brief ya declara fuera de alcance (*"auto-instalar/configurar
sensores"*) y la misma disciplina de D-007: cuando la acción correctiva toca el estado del
usuario, AWM la **nombra** y la ejecuta una persona.

**Implica:** R2 emite qué sensor falta para qué clase de defecto, y **con qué comando
agregarlo**. No lo corre. Un remedio nombrado y ejecutable es el estándar que fijó D-010; un
remedio auto-aplicado sobre la configuración de calidad de un proyecto ajeno no lo es.

---

## D-015

**Umbral empírico ≥2 por defecto, y es una señal, no una compuerta.** (Cierra DA-5.)

R3 detecta clusters de defectos convergentes en el ledger que ningún sensor cubre. El
umbral por defecto es **2**, por consistencia con lo que ya existe: `awm ledger recurring
--min 2` es lo que `harness-retro` usa hoy para decidir si vale estructuralizar.

**Lo que NO significa:** que 1 ocurrencia se ignore. `harness-retro` ya documenta que la
recurrencia es *"una señal a sopesar, no un umbral que pasar"* — un hallazgo único de alta
severidad puede estructuralizarse igual. R3 hereda ese criterio: ordena y destaca, no filtra
en silencio.

Un umbral que descarta sin decirlo convierte a la herramienta en un lugar donde la evidencia
se pierde, que es lo contrario de para lo que existe el ledger.

## D-016 · La agnosticidad de providers deja de ser un acto de fe

**Decisión:** `AWM_CONTROLLER_ARGV` — un array JSON que redirige el lanzamiento del
controller a un comando propio, conservando el resto del adapter (actividad,
`safeToReplace`, fencing, custodia).

**El problema no era técnico, era epistemológico.** `adapter.ts` abre diciendo "la logica
del supervisor no conoce providers: conoce este contrato". Pero los únicos adapters
construibles eran `codex` y `claude-code`, así que esa afirmación **no se podía romper**.
Una propiedad que ningún experimento puede refutar no está verificada: está creída.

**Lo que habilita, además de testear:** certificar el contrato supervisor↔controller con un
controller determinista — procesos reales, git real, journal real, **cero tokens** — en vez
de pagar un ciclo agéntico completo por cada corrida. El plan original de R5-T16 pedía dos
corridas con LLM real; medido contra la suite ya existente (que cubre bootstrap, join y
teardown con git real, más crash/restart con procesos reales y `SIGKILL` de grupo), esas
corridas volvían a probar lo ya probado a costo abierto. Se separaron las dos afirmaciones:
el **contrato** lo certifica el controller scripteado; que **un LLM sepa ocupar el rol** es
una propiedad del agente, opcional y explícitamente marcada como no verificada.

**Array JSON, jamás una línea de shell** — misma doctrina que el argv de integración de los
tracks (C4). Validado en el borde y **fail-closed**: cualquier cosa que no sea un array no
vacío de strings no vacíos es un error explícito, nunca un fallback silencioso al provider
nativo. Un override mal escrito que "funciona igual" lanzaría el agente real, con su costo
en tokens, sin que nadie note que el override no aplicó.

**Lo que el seam encontró apenas se usó** (todos defectos del controller de prueba, no del
producto — y cada uno confirma que el mecanismo correspondiente funciona):

- Un controller que no emite heartbeat es declarado en stall y superseded en loop.
- Las requests de una generación superseded se rechazan (`request-rejected-stale`): el
  fencing es real y observable.
- Sin `register --entity track-integration`, el supervisor **fail-closea** en vez de
  inventar el comando de integración.

**Lo que quedó abierto, sin maquillar:** la cohorte no alcanza `COMPLETE` bajo supervisor
vivo con relevo. Tres fixes al controller de prueba corrigieron tres defectos reales y el
síntoma persistió — a los ~3,5 min del `SIGKILL` el token del controller vivo pasa a stale
sin causa raíz identificada. **No se intentó un cuarto fix a propósito:** tres intentos
fallidos sobre el mismo síntoma indican que el problema vive en otro nivel, y seguir
parchando produce un verde que no significa nada. Queda como `pending` nombrado en la matriz
y como hallazgo con evidencia en `docs/research/r5/README.md` — nunca como `pass`, y nunca
como test tolerado en rojo.

---

## D-017

**Compatibility is evidence, not a fallback assumption.**

The CLI resolves a version-aware pack against local project evidence only. The
registry owns variants and their certified ranges; the CLI owns parsing,
bounded probes, and the explicit result. A future or unavailable tool is not
silently run through PATH and is never treated as a compatible default.

## D-018

**Coverage reports never create a false green.**

Static coverage, empirical ledger analysis, missing evidence, legacy packs, and
unverifiable probes are distinct states. Reporting is read-only: the command
does not install a sensor, write a baseline, or alter a ledger to improve its
own result.

## D-019

**Schema v2 is a deliberate, reviewable migration.**

V2 stores selected variants, structured commands, assets, provenance, and
compatibility evidence. Legacy manifests and packs remain readable as
`compatible-unverified`; migration happens through explicit initialization and
review, never as a hidden rewrite during a diagnostic command.

## D-020

**Retrospective coverage runs before ledger archive.**

The retrospective consumes static and empirical coverage while active and
archived ledger evidence is still bounded and attributable. It may recommend a
new reusable control from repeated classified findings, but archival must not
erase the feedback signal first.
