# Audit profile — Kodria/agentic-workflow (AWM CLI)

Perfil que lee la skill `auditing-pull-requests` (registry personal, bundle
`personal-engineering`) al empezar cada auditoría de PR en este repo. Verificado contra
`main@9407695` (v9.24.3).

- **Reply language:** es (comentarios en el PR y reportes al owner).
- **Default branch:** `main`. Cada push a `main` corre `.github/workflows/release.yml`: si hay
  commits releasables desde el último tag, bumpea la versión y publica en npm (OIDC Trusted
  Publisher). No hay publish manual ni workflow paralelo de publish (`CLAUDE.md`, D-005).
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
    4. regenerar la support matrix contra el registry `v2.0.1` y luego
       `git diff --exit-code docs/support-matrix.md`;
    5. Jest `--runInBand --bail` (en Windows, solo el «remainder»);
    6. `published-doctor-evidence`.
  - **`windows-shards` × 6:** `windows-2022` y `windows-11-arm`, cada uno con los shards `watch`,
    `changes-core` y `changes-commands`.
  - **Gate de release:** en `release.yml`, `release` declara `needs: [test, windows-shards]`, la
    misma matriz de 12 jobs. Si algo está rojo en cualquier plataforma o shard, no se publica.
    Después del publish corre `published-doctor-evidence`.
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
  - **Support matrix:** `npm run docs:matrix` necesita un checkout de `awm-baseline-registry` en el
    tag `v2.0.1` como hermano del repo. El CI lo clona; en local falta.
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
