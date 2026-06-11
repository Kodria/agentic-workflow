# AWM — Agent Working Notes

Lecciones y patrones confirmados en este repo. Todo agente que trabaje aquí debe leerlas.

---

## Patrones de testing

- **dual-tmpdir-isolation:** cuando un test de comando escribe al home *y* clona repos, usar dos tmpdirs separados (`tmpHome` para HOME/AWM_HOME, `tmpWork` para repos fixture). Un solo tmpdir mezcla el "home falso" con los artefactos de trabajo y provoca contaminación cruzada entre tests. Patrón completo: `beforeEach` crea ambos tmpdirs + sobreescribe `process.env.HOME` y `process.env.AWM_HOME` + llama `jest.resetModules()`; `afterEach` restaura y limpia. Todos los módulos se importan con `require()` dentro del test (no al top-level del archivo). **Git fixtures con tags:** agregar `-c tag.gpgSign=false` al helper GIT (`execSync(\`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ...\`)`); en máquinas con `tag.gpgSign=true` global la creación de tags falla sin este flag. Confirmado necesario en WS-3 (×3 reviewers independientes).

- **module-level env vars:** las constantes derivadas de `process.env` (como `AWM_HOME`) se evalúan al momento del `require`. Al crear un módulo con este patrón, agregar el comentario `// Evaluated at require-time — tests must use jest.resetModules() + late require() to pick up env overrides.` para que futuros implementadores de tests no lo descubran a las malas.

## Patrones de diseño de API

- **default-arg-seam:** en funciones multi-root (`discoverSkills`, `discoverAllBundles`, etc.), pasar `roots = contentRoots()` como parámetro default en vez de llamar `contentRoots()` en el cuerpo. Esto da compatibilidad hacia atrás en todos los call-sites existentes (sin cambios) y permite inyectar roots en tests sin tocar `~/.awm`. Patrón listo para ser enriquecido por WS-2 sin modificar consumidores.

- **contentRoot stamp en discovery:** estampar `contentRoot` sobre cada artefacto en el momento del discovery, no en el momento del install/uso. Los consumidores downstream no necesitan saber de qué registry proviene el artefacto — el path absoluto ya los guía al lugar correcto.

- **hoist-per-root-io:** en funciones que iteran sobre roots y dentro de cada root iteran sobre artefactos, hacer el I/O de por-root (p.ej. `readRegistryManifest(root)`) **fuera del loop interno**, no dentro. Multiplicar lecturas de disco por artifact es innecesario. Patrón: `for (const root of roots) { const overrides = readRegistryManifest(root); for (const a of artifacts(root)) { /* usa overrides */ } }`. Confirmado en dos code-quality reviews de WS-2.

- **atomic-add para directorios administrados:** el flujo correcto para un comando que agrega a un directorio gestionado es: operación costosa (clone/fetch) → validar → verificar colisiones → escribir config. Fallo en cualquier paso = limpiar el directorio creado (`rmSync(dest, {recursive:true,force:true})`) + no escribir config. Nunca escribir config antes de que la validación sea exitosa.

## Layout del repo y de la instalación

- **Este repo** contiene solo el CLI TypeScript (`cli/`). El contenido (skills, bundles, sensor-packs, hooks) vive en repos externos: `awm-baseline-registry` y `awm-documentation-registry`.
- **No hay `registry/` en este repo** ni `~/.awm/cli-source/`. El concepto `cli-source` fue eliminado en WS-4.
- **Layout de instalación:** `~/.awm/registries/<name>/` — cada registry configurado se clona aquí (ej. `~/.awm/registries/baseline/`). Los skills se instalan como symlinks hacia esos paths.
- **Descubrimiento de contenido:** `contentRoots()` devuelve los paths bajo `~/.awm/registries/` según la config. No hay constante fija de `baseRoot` ni de `cliSource`.
