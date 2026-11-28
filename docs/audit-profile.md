# Audit profile — Kodria/agentic-workflow (AWM CLI)

Perfil que lee la skill `auditing-pull-requests` (registry personal, bundle
`personal-engineering`) al empezar cada auditoría de PR en este repo. Verificado contra
`main@9407695` (v9.24.3).

- **Reply language:** es (comentarios en el PR y reportes al owner).
- **Default branch:** `main`. Cada push a `main` corre `.github/workflows/release.yml`: si hay
  commits releasables desde el último tag, bumpea la versión y publica en npm (OIDC Trusted
  Publisher). No se corre `npm publish` a mano ni hay workflow paralelo de publish (`CLAUDE.md`,
  D-005). La única vía manual es el `workflow_dispatch` de `release.yml` (`dry_run`, y `bump` para
  forzar un release sin commits releasables, D-022). Un cambio de metadata publicada del paquete
  se titula `fix:`, no `chore:` (D-022).
- **Draft PRs run CI:** sí. `ci.yml` corre en todo `pull_request`, sin gate de draft. El veredicto
  «aprobado» exige los 12 jobs en verde sobre el SHA auditado. Con jobs pendientes, el veredicto es
  «⚠️ casi listo — CI pendiente».
- **Required checks / CI matrix** (`ci.yml`, Node 22, `fail-fast: false`):
  - **`test` × 6:**
    - `ubuntu-latest` (linux-x64) y `ubuntu-24.04-arm` (linux-arm64);
    - `macos-15-intel` (darwin-x64) y `macos-15` (darwin-arm64);
    - `windows-2022` (win32-x64) y `windows-11-arm` (win32-arm64).

    Pasos de cada job:
    1. guard `wait-npm-publication.test.cjs`;
    2. `npm ci`, `native:build`, `build` y `native:test-build`;
    3. `tsc --noEmit`;
    4. regenerar la support matrix contra el registry `v2.0.1` (`6f40632…`, `ci.yml:117`) y luego
       `git diff --exit-code docs/support-matrix.md`;
    5. Jest `--runInBand --bail` (en Windows, solo el «remainder»);
    6. consumidor R3 publicado: `npm install --prefix published-consumer
       agentic-workflow-manager@8.1.2` y luego `published-r3-acceptance.e2e.test.ts`;
    7. guard de procedencia `published-doctor-evidence.e2e.test.ts`. El doctor contra el paquete
       realmente publicado corre recién en `release.yml`, después del publish.
  - **`windows-shards` × 6:** `windows-2022` y `windows-11-arm`, cada uno con los shards `watch`,
    `changes-core` y `changes-commands`.
  - **Gate de release:** en `release.yml`, `release` declara `needs: [test, windows-shards]`, con
    las mismas 12 combinaciones de plataforma y shard. Si algo está rojo en cualquiera, no se
    publica. Ojo: el job `test` de `release.yml` corre install, build, addon y Jest, pero **no**
    `tsc`, la support matrix ni el guard de publicación; esos solo los corre `ci.yml` en el PR.
    Después del publish corre `published-doctor-evidence`.
  - **El gate de hecho son estos jobs:** según la API de GitHub, `main` no tiene branch
    protection ni rulesets (404 «Branch not protected»), y merge, squash y rebase están
    habilitados. GitHub no bloquea un merge con CI rojo; lo que impide publicar es el `needs` de
    `release.yml`. Por eso el veredicto exige los 12 jobs verdes antes del merge.
  - **Los workflows mandan sobre la prosa:** `CLAUDE.md` (CTX-CLAUDE-008, «`ubuntu-latest`,
    `windows-latest`, `macos-latest`») y CTX-CONSTITUTION-032 describen una matriz anterior. Ante
    una diferencia, vale `ci.yml` / `release.yml`.
- **Install / build** (desde `cli/`):
  `npm ci && npm run native:build && npm run build && npm run native:test-build`.
  Sin el addon nativo, la suite da unos 123 fallos de `secure_fs` (conteo de `AGENTS.md`), que no son del PR (ver la
  línea base).
- **Typecheck:** `cd cli && npx tsc --noEmit`.
- **Lint / depcheck:** `cd cli && npm run lint` y `npm run depcheck`. El CI **no** los corre. Los
  cubre `awm sensors run`, siempre **desde la raíz del repo**, nunca desde `cli/`
  (CTX-CONSTITUTION-022).
- **Full suite:** `cd cli && npx jest` para comparar por nombre de test; `npx jest --runInBand --bail`
  es lo que corre el CI. Para atribuir un fallo, reproducirlo en un worktree limpio de `origin/main`.
- **Build / runtime smoke:**
  - El comportamiento nuevo se prueba con `node cli/dist/src/index.js …`, nunca con el `awm` del
    PATH, que puede ser anterior al árbol.
  - Se usa un repo descartable con `HOME` y `AWM_HOME` apuntando a tmpdirs.
  - Planes: `node cli/dist/src/index.js plan validate <plan> --cwd . --require-dispatch-mode --json`.
- **Known baseline failures (by test name):** con el build completo, ninguna en un runner de CI.
  Fallos ambientales conocidos, que no son del PR:
  - **Corriendo como root** (contenedores cloud), porque `chmod 000` no impide leer a root.
    Verificado en `main@9407695`: 406 suites ✅ / 1 ❌ / 2 omitidas; 7113 tests ✅ / 1 ❌ / 16 omitidos.
    - `tests/commands/registry/doctor.test.ts > doctorRegistry (RF-4.4–4.8, RF-5.1) > reports unreadable SKILL.md as structural (fail closed)`
  - **Addon nativo sin buildear:** unos 123 fallos que nombran `secure_fs` (`AGENTS.md`). Se curan con el
    comando de build de arriba.
  - **Support matrix:** `npm run docs:matrix` (`cli/package.json:35`) fija el registry `v2.0.0`
    (`c35c087…`) en `../../awm-baseline-registry`, como hermano del repo, y verifica la identidad
    de ese checkout. Para reproducir el check del CI, que usa otro tag, correr desde `cli/` el
    comando de `ci.yml:117` con un checkout de `v2.0.1` (`6f40632…`):
    `npx ts-node scripts/sensor-support-matrix.ts --registry-root <checkout> --registry-tag v2.0.1
    --registry-commit 6f40632006fc65300ac633c5a54f2635cf0eb8e9`, y luego
    `git diff --exit-code -- docs/support-matrix.md`.
  - **Suites `describe.skip` sin coordenadas de publicación:**
    - `tests/integration/published-r3-acceptance.e2e.test.ts` (`AWM_PUBLISHED_CLI_ROOT`);
    - `tests/integration/published-sensor-gate-matrix.e2e.test.ts`
      (`AWM_RUN_PUBLISHED_SENSOR_GATE_MATRIX=1`).
  - **Banner de update:** `cli/jest.setup.js` fija `AWM_NO_UPDATE_CHECK=1`. Un test que necesita el
    banner tiene que pasar `AWM_NO_UPDATE_CHECK: ''` en el env del hijo
    (`tests/commands/plan/index.test.ts`, #254/#255).
- **Infra rules:**
  - `~/.awm` es del instalador: solo se toca vía `awm init` / `awm update`. Ningún test toca el
    `~/.awm` real; todos usan tmpdirs con `HOME` y `AWM_HOME` sobreescritos (`CLAUDE.md`).
  - El contenido (skills, bundles, sensor-packs, hooks) no vive acá: se edita en los repos de
    registry.
  - `.awm/` tiene un solo escritor: el bloque gestionado de `cli/src/core/awm-gitignore.ts` (D-024).
    Nunca una línea `.awm/` suelta.
  - Git y el texto no confiable tienen una sola puerta cada uno: `execGit` / `runGit` y `esc()`.
    Los tests de Change Record usan `posixOnly`; nunca un `if (win32) return` silencioso.
- **Owner rules (autoritativas; cada PR se audita contra ellas):**
  - `CONSTITUTION.md`:
    - validación de entrada de flags;
    - guards de path completos (`''`, `.`, `..`, `/`, `\`);
    - todo dato deserializado entra como `unknown`, validado en runtime y fail-closed;
    - rechazar symlinks al copiar o archivar contenido de registry;
    - default-deny en gates de seguridad;
    - lectura de archivos semi-confiables por identidad (`dev` + `ino`).
  - `AGENTS.md`, sección Lessons: patrones confirmados, por ejemplo:
    - `dev`/`ino` con `{ bigint: true }`;
    - contratos duales sobre `release.yml` `needs`;
    - un `covers` de plan no es cobertura.
  - CTX-CONSTITUTION-051: separar la preparación portable (`npm --prefix cli ci`, build solo
    cuando una prueba lo necesita) del diagnóstico de producto. Un fallo previo a la línea base es
    evidencia de preparación, no un bug. Nunca editar la instalación global, los registries ni los
    caches para hacer pasar una rama.
  - Cards selectivas de `docs/awm/context/constitution/`: `release.md`, `documentation.md`,
    `implementation.md`, `execution-boundary.md`, `sensor-floor.md` y `support-matrix.md`.
    Aplican cuando el PR toca ese tema.
  - `CLAUDE.md` y `docs/decisions.md` (D-001…).
- **Release / versioning:**
  - El release lee los conventional commits desde el último tag (`cli/src/release/core.ts:44-46`):
    `!` o `BREAKING CHANGE` → major; `feat` → minor; `fix` y `perf` → patch; el resto
    (`docs`, `chore`, `test`, …) → no publica.
  - Con squash merge, el título del PR **es** el commit: titularlo en conventional commits con el
    nivel que corresponde.
  - El commit de bump lleva `[skip ci]`.
- **Cross-repo dependencies:**
  - **Registry `minCliVersion`:** si un PR del registry sube el piso en `awm-registry.json`, hace
    falta antes el release del CLI publicado en npm.
  - **`cli-certification.json` del registry:** fija la versión, el `sourceSha` y el
    `protocolDigest` del CLI certificado. Se mueve al recertificar, no en cada patch.
  - **Contratos que consumen las skills** (`plan validate`, ledger, sensors, admission): un cambio
    de CLI que los altere necesita su PR de registry después del release del CLI.
  - **Support matrix:** el CI del CLI fija el registry `v2.0.1` (commit `6f40632…`).
- **Hardcoded-count tests to watch:**
  - Los `needs` de `release.yml` los afirman a la vez Jest (`native-release-artifacts`,
    `RELEASE_GATE`) y `.github/scripts/wait-npm-publication.test.cjs`: se actualizan juntos.
  - `tests/structural/support-matrix-is-current.test.ts` fija strings exactos de `ci.yml` y de
    `package.json` (`docs:matrix`).
- **UI conventions:** no aplica (CLI). Salida de consola por `@clack/prompts`: `log.info` va a
  stdout. Un test que exige stderr vacío no debe depender del banner de update.
- **E2E/visual harness:** no hay. El equivalente es el runtime real: `cli/dist` en un repo
  descartable, con `HOME` y `AWM_HOME` aislados.
- **Who merges:** Nicolás.
  1. El PR pasa de draft a «Ready for review» con los 12 jobs en verde.
  2. Squash merge a `main`.
  3. `release.yml` publica.
  4. Post-deploy: `npm i -g agentic-workflow-manager`, `awm --version` muestra la versión nueva y
     `awm doctor`.
- **Product decisions:** se le preguntan a Nicolás en la sesión y se registran en el PR como
  «Decisión del owner».
