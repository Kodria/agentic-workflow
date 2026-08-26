<!-- awm-context:CTX-AGENTS-017 -->
## Patrones de diseño de API

<!-- awm-context:CTX-AGENTS-018 -->
- **default-arg-seam:** en funciones multi-root (`discoverSkills`, `discoverAllBundles`), pasar `roots = contentRoots()` como parámetro default en vez de llamar `contentRoots()` en el cuerpo. Da compatibilidad hacia atrás en todos los call-sites y permite inyectar roots en tests sin tocar `~/.awm`.

<!-- awm-context:CTX-AGENTS-019 -->
- **contentRoot stamp en discovery:** estampar `contentRoot` sobre cada artefacto en el discovery, no en el install/uso. Los consumidores downstream no necesitan saber de qué registry viene — el path absoluto ya los guía.

<!-- awm-context:CTX-AGENTS-020 -->
- **injected-logger:** cuando una función necesita emitir warnings, recibir el logger como argumento (`fn(log: (msg: string) => void)`) en vez de llamar `console.warn()`. La función queda pura, testeable sin capturar stdout, y reutilizable con cualquier canal.

<!-- awm-context:CTX-AGENTS-021 -->
- **pure-render-io-split:** al construir un selector/picker interactivo, separar el render puro (`(state, width) → string[]`) del shell I/O (`onData → dispatch → redraw`). El render puro es 100% testeable sin terminal. Patrón: `defaultIO = () => ({ input: process.stdin, output: process.stdout })` como función lazy (no en import-time) + seam de default argument. Ver `src/ui/picker-view.ts` + `picker.ts`.

<!-- awm-context:CTX-AGENTS-022 -->
- **hoist-per-root-io:** en funciones que iteran roots y dentro de cada uno iteran artefactos, hacer el I/O por-root (`readRegistryManifest(root)`) **fuera del loop interno**. Multiplicar lecturas de disco por artefacto es innecesario.

<!-- awm-context:CTX-AGENTS-023 -->
- **atomic-add para directorios administrados:** operación costosa (clone/fetch) → validar → verificar colisiones → escribir config. Fallo en cualquier paso = limpiar el directorio creado (`rmSync(dest, {recursive:true,force:true})`) + no escribir config. Nunca escribir config antes de que la validación sea exitosa.

<!-- awm-context:CTX-AGENTS-024 -->
- **reuse-discovery-not-hand-rolled-scan:** al resolver un artefacto por nombre a través de múltiples content roots, delegar SIEMPRE a las funciones de discovery existentes en vez de reimplementar un scan "primer root que matchea". Esas funciones ya encapsulan la semántica de colisión/override de `awm-registry.json` (`mergeEntry`); un scan manual la ignora en silencio y resuelve al root incorrecto en instalaciones multi-registry. *(Confirmado en `cli/src/core/export/resolve.ts`.)*

<!-- awm-context:CTX-AGENTS-025 -->
- **grep-before-you-write-a-helper:** antes de escribir una función local que compute algo que otro módulo probablemente ya calcula (un path físico, una sanitización, un try/catch de resolución), correr `grep -rn "<nombre-candidato>\|<lógica equivalente>" src/`. *(Confirmado en planes distintos: `physicalTarget` duplicado byte-idéntico en dos módulos; `sanitizeTransactionTimestamp` duplicado con reglas DIVERGENTES entre dos call-sites; boilerplate de `resolveAgentTargets` repetido en 6 sitios.)* El costo no es estético: cuando diverge es un bug latente invisible hasta que alguien edita una sola copia. **La duplicación no necesita cruzar archivos para calificar** — `checkSensorsBaseline` copió la fórmula de `checkManifest` en el MISMO archivo, 100 líneas más abajo, propagando una mina (`sensors: null` crashea) lista para explotar el día que alguien blindara una copia y no la otra. Curado extrayendo `countEnabledSensors()`.
