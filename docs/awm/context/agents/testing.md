<!-- awm-context:CTX-AGENTS-004 -->
## Patrones de testing

<!-- awm-context:CTX-AGENTS-005 -->
- **platform-property-assumed-universal:** el modo de falla más caro de este repo *(×5 en un solo ciclo; ninguno lo encontró el desarrollo en Linux)*. Un test que **simula** una plataforma (`Object.defineProperty(process,'platform',…)`) mientras corre sobre el filesystem real de otra no verifica nada en ninguna de las dos: cambia lo que hace el CÓDIGO, no lo que hace el DISCO. Clases confirmadas: bit de ejecución, separador de ruta, prefijo de home sin normalizar, fin de línea (checkout de Windows entrega CRLF), y `/var` → `/private/var` en macOS. **La contramedida no es "correr en más plataformas"** — eso los encuentra tarde y caro. Es exportar la unidad y probarla con las DOS formas del dato de entrada (posix y win32, LF y CRLF, ruta directa y vía symlink), lo que falla en cualquier sistema. Para tmpdirs usar `mkCanonicalTmpDir` de `tests/support/tmp.ts` en todo test que compare una ruta contra la del producto: el producto canonicaliza (`findProjectRoot` hace `realpathSync`). macOS se reproduce en Linux con `TMPDIR=<dir-symlinkeado> npx jest`.

<!-- awm-context:CTX-AGENTS-006 -->
- **verify-fix-by-revert-not-just-green:** después de escribir un fix + su regression test, revertir SOLO el fix (dejando el test) y confirmar que ese test falla; luego restaurar. Una suite verde es compatible con un test que nunca ejercita la línea arreglada. *(≥5 veces, siempre detectado por una revisión posterior, nunca por el autor.)* **Variante más cara: el fix aterriza en la función EQUIVOCADA cuando existen dos hermanas de propósito similar** — el test nuevo queda verde porque prueba la función equivocada directamente. Ante dos funciones de nombre o forma similar, confirmar explícitamente cuál invoca el comando real ANTES de decidir dónde aplica el fix.

<!-- awm-context:CTX-AGENTS-007 -->
- **duplicate-side-effect-across-composed-functions:** cuando la misma condición de gateo (`if (isWindowsNative()) emit(msg)`) vive en más de una función que terminan llamándose juntas, el efecto se dispara una vez POR CADA función compuesta, no una vez por comando *(`awm init` emitía el mismo caveat 3 veces; cada función se testeaba aislada, nunca el flujo completo)*. Al agregar un efecto lateral gateado por una condición global, verificar cuántas veces se ejecuta en un flujo real de punta a punta. **Variante por rama de dispatcher faltante:** un efecto nuevo en una función compartida hereda TODOS sus call-sites, incluidos los que un dispatcher debería saltear pero no saltea. Verificar el dispatcher completo, no solo el call-site que la task toca.

<!-- awm-context:CTX-AGENTS-008 -->
- **assert-call-order-not-just-existence:** cuando un orquestador debe ejecutar pasos en orden y el fake graba en `calls[]`, verificar con `expect(calls.indexOf('A')).toBeLessThan(calls.indexOf('B'))` — no con `toContain`, que pasa aunque se reordenen. Aplica a `writePackageVersion` antes de `git commit`, `WRITE_NPMRC` antes de `npm publish`, `npm publish` antes de `git push`.

<!-- awm-context:CTX-AGENTS-009 -->
- **dual-tmpdir-isolation:** cuando un test de comando escribe al home *y* clona repos, usar dos tmpdirs separados (`tmpHome` para HOME/AWM_HOME, `tmpWork` para fixtures). Uno solo contamina entre tests. Patrón: `beforeEach` crea ambos + sobreescribe `process.env.HOME`/`AWM_HOME` + `jest.resetModules()`; `afterEach` restaura y limpia; los módulos se importan con `require()` dentro del test, nunca al top-level. **Git fixtures con tags:** agregar `-c tag.gpgSign=false` al helper GIT — con `tag.gpgSign=true` global la creación de tags falla sin ese flag *(×3)*.

<!-- awm-context:CTX-AGENTS-010 -->
- **module-level env vars / call-time preference:** las constantes derivadas de `process.env` (como `AWM_HOME`) se evalúan al `require`. **Preferir funciones a constantes** — `export function awmHome() { return process.env.AWM_HOME || ... }` evalúa en call-time y los tests sobreescriben sin `jest.resetModules()`. Si la constante es inevitable, dejar el comentario `// Evaluated at require-time — tests must use jest.resetModules() + late require() to pick up env overrides.`

<!-- awm-context:CTX-AGENTS-011 -->
- **stub-process-platform:** `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })`. El `configurable: true` es esencial — sin él la restauración en `afterEach` falla en silencio. Capturar el valor real antes y restaurar con la misma llamada.

<!-- awm-context:CTX-AGENTS-012 -->
- **ansi-testing-inject-precolored:** los tests que construyen strings coloreados con `picocolors` para verificar stripping ANSI son vacuos en Jest: corre en non-TTY, devuelve texto plano, y el código de strip nunca se ejercita. Inyectar la secuencia directamente (`'\x1b[32mhello\x1b[0m'`) o forzar `FORCE_COLOR=1`.

<!-- awm-context:CTX-AGENTS-013 -->
- **eventemitter-fake-stdin:** para testear shells interactivos (raw-mode, key events) sin TTY real, usar `EventEmitter` como fake de `input`: emitir `'data'` con buffers de teclas y verificar lo escrito a `output`. Solo hace falta el contrato `{ on, removeListener, setRawMode?, pause? }`. Ver `tests/ui/picker-shell.test.ts`.

<!-- awm-context:CTX-AGENTS-014 -->
- **tdd-first-i18n:** para migraciones de strings (i18n, rebranding, renombrado de labels), actualizar primero los asserts al valor nuevo → verificar que fallen → traducir la fuente. Garantiza que no queden asserts huérfanos silenciados. *(Confirmado en una migración en→es de ~40 strings: el ciclo red→green detectó un cascade que un sweep directo habría silenciado.)*

<!-- awm-context:CTX-AGENTS-015 -->
- **windows-ci-gotchas:** patrones que solo se manifiestan contra Windows real, nunca contra `process.platform` mockeado:
  - **`ps`/`pgrep` en win32 resuelven al binario EMULADO de MSYS/Cygwin**, con su propia tabla de pids, ciega a procesos nativos de `CreateProcess`. Un `ps -p <pid>` de un proceso vivo sale con exit 1, indistinguible de una muerte real. **Usar `process.kill(pid, 0)`** (kernel vía libuv). *(Encontrado en 4 funciones; la última sobrevivió varias rondas de CI por no estar en la cadena de llamadas de las ya arregladas: auditar el archivo completo por el patrón, no solo lo que la task toca.)*
  - **Mocks que reemplazan la función ENTERA (`() => true`) rompen sondeos de existencia legítimos.** Un mock incondicional de `process.kill` también intercepta el `process.kill(pid, 0)` interno, y un pid "muerto" aparenta vivo. Inspeccionar los args (`call[1] !== 0` filtra sondeos) o condicionar por pid — nunca `() => true` sin narrowing.
  - **El modo de archivo en win32 SIEMPRE reporta `0o666`**, para archivos y directorios. No hay bit ejecutable POSIX ni `0o700`/`0o777` para directorios.
  - Ninguno se descubre mockeando `process.platform`: tratar el mock local como cobertura de sintaxis, no de comportamiento, y presupuestar al menos una ronda de CI real antes de cerrar código con ramas win32.
  - **Ampliar un mecanismo de reintento que no converge es la respuesta equivocada.** 3×50ms sobrevivió 2 corridas y falló en la 3ra; ampliar a 10×100ms falló en la corrida inmediata siguiente, mismo síntoma — señal de que el sospechoso no era latencia. Lo que convergió fue reintentar la INSTANCIA completa del spawn, no la misma consulta sobre el mismo pid. Regla: si ampliar un mismo mecanismo no converge al segundo intento, cuestionar QUÉ se reintenta antes de ampliarlo una tercera vez (`systematic-debugging`, Fase 4.5).

<!-- awm-context:CTX-AGENTS-016 -->
- **external-tool-reliability-needs-multiple-real-confirmations:** cuando una decisión de seguridad o liveness se delega a una herramienta externa nueva, una sola corrida exitosa —aunque sea contra CI real— no alcanza como evidencia. *(`refIsAlive` en win32 delegó identidad a WMI vía `powershell.exe`; la primera corrida real dio un falso negativo sobre un proceso vivo, mientras `process.kill(pid, 0)` llevaba varias corridas limpias. Se revirtió al kernel, aceptando el gap de reciclado de PID como conocido.)* Exigir ≥2-3 corridas reales limpias antes de promover una fuente nueva a gate irreversible; mientras tanto preferir la probada — un gap documentado le gana a un falso negativo no detectado.
