# AWM — Agent Working Notes

Lecciones y patrones confirmados en este repo. Todo agente que trabaje aquí debe leerlas.

---

## Patrones de testing

- **dual-tmpdir-isolation:** cuando un test de comando escribe al home *y* clona repos, usar dos tmpdirs separados (`tmpHome` para HOME/AWM_HOME, `tmpWork` para repos fixture). Un solo tmpdir mezcla el "home falso" con los artefactos de trabajo y provoca contaminación cruzada entre tests. Patrón completo: `beforeEach` crea ambos tmpdirs + sobreescribe `process.env.HOME` y `process.env.AWM_HOME` + llama `jest.resetModules()`; `afterEach` restaura y limpia. Todos los módulos se importan con `require()` dentro del test (no al top-level del archivo). **Git fixtures con tags:** agregar `-c tag.gpgSign=false` al helper GIT (`execSync(\`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ...\`)`); en máquinas con `tag.gpgSign=true` global la creación de tags falla sin este flag. Confirmado necesario en WS-3 (×3 reviewers independientes).

- **module-level env vars / call-time preference:** las constantes derivadas de `process.env` (como `AWM_HOME`) se evalúan al momento del `require`. Al crear un módulo con este patrón, agregar el comentario `// Evaluated at require-time — tests must use jest.resetModules() + late require() to pick up env overrides.` para que futuros implementadores de tests no lo descubran a las malas. **Alternativa preferida (WS-C):** exportar funciones en vez de constantes — `export function awmHome() { return process.env.AWM_HOME || ... }` evalúa en call-time; los tests pueden sobreescribir `process.env` en `beforeEach/afterEach` sin `jest.resetModules()`.

- **stub-process-platform:** para stubbear `process.platform` en tests usar `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })`. El flag `configurable: true` es esencial — sin él, la restauración en `afterEach` falla silenciosamente. Capturar el valor real antes de los tests (`const realPlatform = process.platform`) y restaurar en `afterEach` con la misma llamada.

- **tdd-first-i18n:** para migraciones de strings (i18n, rebranding, renombrado de labels), actualizar primero los asserts de tests al nuevo valor → verificar que fallen (red) → traducir la fuente (green). Esto garantiza que no quedan asserts huérfanos silenciados y que cualquier string omitido en el sweep rompe el build en vez de pasar desapercibido. Confirmado en WS-7 F-10 (~40 strings CLI en→es): el ciclo red→green detectó un cascade en `init.test.ts` que un sweep directo habría silenciado.

## Patrones de diseño de API

- **default-arg-seam:** en funciones multi-root (`discoverSkills`, `discoverAllBundles`, etc.), pasar `roots = contentRoots()` como parámetro default en vez de llamar `contentRoots()` en el cuerpo. Esto da compatibilidad hacia atrás en todos los call-sites existentes (sin cambios) y permite inyectar roots en tests sin tocar `~/.awm`. Patrón listo para ser enriquecido por WS-2 sin modificar consumidores.

- **contentRoot stamp en discovery:** estampar `contentRoot` sobre cada artefacto en el momento del discovery, no en el momento del install/uso. Los consumidores downstream no necesitan saber de qué registry proviene el artefacto — el path absoluto ya los guía al lugar correcto.

- **injected-logger:** cuando una función necesita emitir warnings o mensajes al usuario, recibir el logger como argumento (`fn(log: (msg: string) => void)`) en vez de llamar `console.warn()` directamente. Ventaja: la función es pura (sin side effects de I/O), testeable sin capturar stdout, y reutilizable con cualquier output channel. Patrón: `warnIfUnsupportedPlatform((m) => console.warn(pc.yellow(m)))` en el call-site.

- **hoist-per-root-io:** en funciones que iteran sobre roots y dentro de cada root iteran sobre artefactos, hacer el I/O de por-root (p.ej. `readRegistryManifest(root)`) **fuera del loop interno**, no dentro. Multiplicar lecturas de disco por artifact es innecesario. Patrón: `for (const root of roots) { const overrides = readRegistryManifest(root); for (const a of artifacts(root)) { /* usa overrides */ } }`. Confirmado en dos code-quality reviews de WS-2.

- **atomic-add para directorios administrados:** el flujo correcto para un comando que agrega a un directorio gestionado es: operación costosa (clone/fetch) → validar → verificar colisiones → escribir config. Fallo en cualquier paso = limpiar el directorio creado (`rmSync(dest, {recursive:true,force:true})`) + no escribir config. Nunca escribir config antes de que la validación sea exitosa.

## Patrones de implementación

- **best-effort-catch-comment:** un bloque `catch {}` vacío es indistinguible de un olvido. Cuando el catch es deliberado (fallback silencioso, best-effort), agregar un comentario que explique el tradeoff: `// best-effort: <qué hace el fallback>; <qué se pierde respecto al happy path>`. Hace la intención explícita para reviewers y previene que refactors futuros añadan un re-throw "para limpieza" que rompa el comportamiento.

- **gate-order-annotation:** cuando el orden de ejecución de un bloque está dictado por una regla de CONSTITUTION (p.ej. "gates de contrato antes de early-exits"), agregar un comentario inline que la cite: `// CONSTITUTION: gates de contrato antes de early-exits`. Hace visible *por qué* el orden importa, previene reordenamientos accidentales en refactors futuros, y permite a reviewers verificar cumplimiento sin buscar la regla. El comentario va inmediatamente antes del primer gate del bloque. Confirmado necesario en WS-3 (B1 regression por early-exit antes del gate de pins) y WS-4 (gate minCliVersion colocado explícitamente antes del early-exit de extensions vacías).

## Patrones de documentación

- **verify-cmd-source-before-documenting:** cuando se documenta un comando AWM (storage target, keywords aceptados, flags), verificar `cli/src/commands/<cmd>.ts` antes de escribir. La narrativa puede sobrevivir spec-review y code-quality-review sin que nadie cheque el código fuente. En WS-5, `awm pin` fue documentado con keyword incorrecto (`base` vs `baseline`) y storage location incorrecta (`profile.json` vs `~/.awm/preferences.json`); ambos pasaron las dos primeras rondas de review.

- **runbook-as-script:** para workstreams que combinan documentación + verificación manual, escribir el doc como hipótesis y ejecutarlo literalmente como test. Las divergencias se corrigen en el doc (no en el tool); el entregable es un doc verificado contra realidad. Confirmado en WS-5: §4.4 (error messages), §4.5 (pin mechanics) y §4.7 (onboarding sequence) se corrigieron durante la Fase C. Tres hallazgos de QA (doctor example stale, sync footnote, onboarding incompleto) también apuntan al mismo patrón: escribir ejemplos de output de CLI sin verificar contra el binario real.

## Layout del repo y de la instalación

- **Este repo** contiene solo el CLI TypeScript (`cli/`). El contenido (skills, bundles, sensor-packs, hooks) vive en repos externos: `awm-baseline-registry` y `awm-documentation-registry`.
- **No hay `registry/` en este repo** ni `~/.awm/cli-source/`. El concepto `cli-source` fue eliminado en WS-4.
- **Layout de instalación:** `~/.awm/registries/<name>/` — cada registry configurado se clona aquí (ej. `~/.awm/registries/baseline/`). Los skills se instalan como symlinks hacia esos paths.
- **Descubrimiento de contenido:** `contentRoots()` devuelve los paths bajo `~/.awm/registries/` según la config. No hay constante fija de `baseRoot` ni de `cliSource`.
