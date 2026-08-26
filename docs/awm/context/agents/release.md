<!-- awm-context:CTX-AGENTS-047 -->
## Release / publish

<!-- awm-context:CTX-AGENTS-048 -->
- **El release del CLI es automático en `main` — no hay paso manual de `npm publish`.** `.github/workflows/release.yml` (trigger `push` a `main`) buildea `cli/` y corre `cli/src/release/index.js`: bump por conventional commits + `npm publish` vía OIDC Trusted Publisher + commit de bump con `[skip ci]`. **Antes de decir "publicá a mano" o de proponer un workflow de release paralelo, verificá que `release.yml` ya lo cubre.** El nivel de versión sale del prefijo de conventional commit del merge; regla no-negociable en `CONSTITUTION.md` → "Release del CLI".

<!-- awm-context:CTX-AGENTS-049 -->
- **El commit de bump lleva `[skip ci]`, así que `ci.yml` NUNCA corre contra el árbol con la versión ya bumpeada.** Consecuencia: un test que afirme algo sobre la versión publicada (o sobre cualquier archivo que el release reescriba) queda sin cobertura real hasta el PR siguiente, que llega roto por algo que no hizo. *(Un test estructural fijaba la mayor del CLI en `8` con un literal; el release a `9.0.0` lo dejó rojo en `main` sin que nadie lo viera, y explotó en el primer PR posterior, ajeno al cambio.)* **Al escribir un test sobre metadata que el release muta, afirmar la invariante (que `package.json`, `package-lock.json` y su entrada root coincidan), nunca un valor literal que el próximo bump invalida.**

<!-- awm-context:CTX-AGENTS-050 -->
## Auto-verificación del CLI (dogfooding)

<!-- awm-context:CTX-AGENTS-051 -->
- **`awm` en el PATH puede ser una instalación global publicada, desconectada del working tree que estás editando.** El binario que resuelve `which awm` suele venir de `npm i -g agentic-workflow-manager` con una versión anterior — no del código que acabás de cambiar. Correr `awm sensors run` contra ese binario prueba una versión vieja: un bug ya arreglado localmente puede seguir viéndose roto. **Al auto-verificar este CLI durante su propio desarrollo, siempre `npm run build && node dist/src/index.js <comando>` desde `cli/` — nunca `awm` bare del PATH.**
