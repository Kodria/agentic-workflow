# AWM — Constitution

Reglas de proceso del proyecto. Todo agente que trabaje en este repo debe leerlas y aplicarlas.

---

## Validación de entrada

- **Todo argumento CLI que espera un valor debe validar que el siguiente token no sea `undefined` ni empiece con `--`.** El patrón `argv[++i] ?? 'default'` silencia el error cuando el usuario omite el valor — el flag queda ignorado sin aviso. Lanzar error explícito: `if (val === undefined || val.startsWith('--')) throw new Error('--flag requiere un valor')`.

- **Al escribir un guard de nombre/componente de path, rechazar el conjunto completo de entradas peligrosas: string vacío, `.`, `..`, `/`, `\\`.** Nunca enumerar solo los patrones que se te ocurran. Un guard que rechaza `..` y `/` pero deja pasar `.` sigue siendo una vulnerabilidad de path traversal — `path.join('registries', '.')` resuelve al directorio padre. Usar siempre `name === '.' || name.includes('..') || /[/\\]/.test(name) || !name` como base.

- **Al copiar o archivar un árbol de directorio sourced de contenido de registry (semi-confiable — puede ser de un registry de terceros), rechazar symlinks explícitamente, nunca dereferenciarlos en silencio.** `fs.cpSync` con `dereference: false` (default) copia un symlink tal cual, pero herramientas downstream como el binario `zip -r` SÍ lo dereferencian al archivar — embebiendo el contenido real del archivo apuntado (potencialmente fuera del árbol del registry) en el artefacto producido. Vector de exfiltración confirmado: un skill con un symlink en `references/` apuntando a `~/.ssh/id_rsa` filtraría esos bytes al exportar (`awm export`, post-implementation-qa 2026-07-23). Regla: cualquier operación que copie/archive un árbol sourced de un registry DEBE hacer un walk recursivo (`fs.readdirSync(dir, {withFileTypes:true})` + `entry.isSymbolicLink()`) y lanzar error explícito ante el primer symlink encontrado, antes de copiar o comprimir — nunca copiar/comprimir primero y confiar en que "no debería haber symlinks".

## Release del CLI

- **El publish del CLI a npm es automático y exclusivo de la CI — nunca se corre `npm publish` a mano ni se crea un workflow paralelo de publish.** `.github/workflows/release.yml` dispara en cada push a `main`: buildea `cli/` y corre `cli/src/release/index.js`, que bumpea la versión por conventional commits, publica vía OIDC Trusted Publisher (`id-token: write`, sin token de npm en secrets) y commitea el bump con `[skip ci]`. Un `npm publish` manual saltea el bump y el OIDC, y desincroniza la versión publicada del historial. Corolario: el nivel de release depende del prefijo de conventional commit del merge (`feat`→minor, `fix`→patch, `!`/`BREAKING`→major) — escribí el título del PR/commit de merge en consecuencia. Antes de proponer cualquier automatización de release, verificá que `release.yml` ya la cubre.

## Implementación

- **Al conectar una función nueva que reemplaza un call directo en múltiples puntos (p.ej. un resolver que reemplaza una constante hardcodeada), buscar TODOS los call-sites con `grep` antes de marcar el task completo.** El plan puede no listar módulos secundarios. En WS-2, `init/steps.ts` quedó sin wiring porque el plan solo mencionaba `index.ts`; el spec-reviewer lo detectó pero solo después del commit. Comando de referencia: `grep -rn "syncRegistry\b" src/ --include="*.ts"`.

- **En operaciones multi-paso que crean side-effects no atómicos (p.ej. git commit + tag + npm publish), implementar rollback explícito de los pasos locales si el paso final falla.** Sin rollback, el repo queda en estado inconsistente (commit/tag locales sin paquete publicado) del que el usuario debe salir manualmente. Patrón: capturar el error del paso final en `catch`, revertir en best-effort (`git tag -d`, `git reset --hard HEAD~1`), re-lanzar el error original.

- **En handlers de comando con early-exits de conveniencia (`if (x.length === 0) return`), los gates de contrato —versión, seguridad, permisos— deben ir ANTES del early-exit.** El early-exit elimina trabajo innecesario; el gate verifica un invariante. Si el gate queda después, cualquier flujo que toma el early-exit lo saltea en silencio. Caso WS-3: `awm sync` tenía el early-exit de extensiones vacías antes del gate de versión — proyectos con `registries` pineados pero sin extensiones pasaban sin verificar el pin.
