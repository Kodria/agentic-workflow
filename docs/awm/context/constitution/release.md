<!-- awm-context:CTX-CONSTITUTION-011 -->
## Release del CLI

<!-- awm-context:CTX-CONSTITUTION-012 -->
- **El publish del CLI a npm es automático y exclusivo de la CI — nunca se corre `npm publish` a mano ni se crea un workflow paralelo de publish.** `.github/workflows/release.yml` dispara en cada push a `main`: buildea `cli/` y corre `cli/src/release/index.js`, que bumpea la versión por conventional commits, publica vía OIDC Trusted Publisher (`id-token: write`, sin token de npm en secrets) y commitea el bump con `[skip ci]`. Un `npm publish` manual saltea el bump y el OIDC, y desincroniza la versión publicada del historial. Corolario: el nivel de release depende del prefijo de conventional commit del merge (`feat`→minor, `fix`→patch, `!`/`BREAKING`→major) — escribí el título del PR/commit de merge en consecuencia. Antes de proponer cualquier automatización de release, verificá que `release.yml` ya la cubre.
