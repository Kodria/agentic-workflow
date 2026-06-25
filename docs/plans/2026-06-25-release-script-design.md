# Release Script — Design

**Fecha:** 2026-06-25
**Estado:** Aprobado (diseño)
**Topic:** Script de release: bump de versión por commits → tag → publish a npm, ejecutable desde contenedores cloud.

---

## 1. Objetivo

Un comando reproducible que, corrido desde un contenedor de CI/cloud:

1. Detecta automáticamente el bump de versión (`major`/`minor`/`patch`) leyendo los Conventional Commits.
2. Actualiza la versión en `cli/package.json` y el `CHANGELOG.md`.
3. Crea un commit y un tag anotado `vX.Y.Z`.
4. Publica el paquete `agentic-workflow-manager` al registry de npm.
5. Pushea commit + tag al remoto.

Requisito transversal: **self-contained** — sin dependencias de runtime extra más allá de las ya presentes; debe funcionar en un contenedor con Node + git.

---

## 2. Arquitectura y runtime

Implementado en **TypeScript** bajo `cli/src/release/`, compilado por `tsc` igual que el resto del CLI y testeado con el `ts-jest` existente (cero config nueva). Se ejecuta vía `npm run release` → `node dist/src/release/index.js`.

Justificación del lenguaje: el `publish` ya dispara un build (`prepublishOnly: tsc`), de modo que el contenedor **siempre** compila para poder publicar — escribir el script en TS no agrega un costo de build, y mantiene consistencia + testeo con el tooling del repo. No se introducen dependencias de runtime nuevas (solo built-ins de Node: `node:child_process`, `node:fs`, `node:path`).

Se respeta el patrón **pure/IO split** del repo:

| Módulo | Responsabilidad | I/O |
|--------|-----------------|-----|
| `cli/src/release/core.ts` | Lógica pura: parseo de commits, decisión de bump, cálculo de versión, render de changelog, builders de argv de comandos, validadores | Ninguna — 100% testeable |
| `cli/src/release/index.ts` | Orquestador: corre git/npm/fs, aplica gates, maneja flags, limpia el `.npmrc` temporal | Sí |

### Interfaces del core (pure)

- `parseCommits(raw: string): Commit[]` — parsea la salida de `git log` a `{ type, scope, breaking, subject }[]`. Commits no parseables se descartan (y se reportan), nunca rompen el flujo.
- `determineBump(commits: Commit[]): Bump | null` — `'major' | 'minor' | 'patch' | null`.
- `nextVersion(base: string, bump: Bump): string` — semver; **valida** que `base` sea semver válido, lanza error explícito si no.
- `renderChangelog(version, dateISO, commits): string` — sección markdown con commits agrupados por tipo.
- Validadores: rechazan inputs vacíos/inválidos y **fallan ruidosamente** (invariante AWM), nunca devuelven `undefined`/`NaN` silencioso.

---

## 3. Algoritmo (data flow)

```
1. Preflight (gates ANTES de cualquier early-exit de conveniencia):
   - node/npm/git disponibles
   - working tree limpio (salvo --dry-run)
   - rama esperada (default: main; configurable; --force la relaja)
   - NPM_TOKEN presente (solo si se va a publicar)

2. Detectar baseline:
   - current = package.json.version (FUENTE DE VERDAD)
   - lastTag = tag git `v*` con semver más alto (o null)
   - floor = max(current, lastTag)   → nunca produce versión <= ya usada

3. Rango de commits:
   - git log <lastTag>..HEAD -- cli/   (si no hay tag → toda la historia de cli/)

4. determineBump():
   - BREAKING CHANGE (footer) o tipo con `!`  → major
   - feat                                      → minor
   - fix | perf                                → patch
   - resto (docs/chore/refactor/test/...)      → no releasable

5. Decidir versión:
   - bump == null y sin --force  → exit 0 "nada que publicar"
   - next = applyBump(floor, bump)   (--force <level> override)
   - GATE idempotencia: tag v<next> existe        → error (exit != 0)
                        <next> ya está en npm      → error (exit != 0)

6. Aplicar (omitido en --dry-run):
   - escribir version en cli/package.json
   - prepend sección en CHANGELOG.md
   - commit  "chore(release): v<next> [skip ci]"
   - tag anotado v<next>
   - npm publish  (dispara prepublishOnly → build)
   - git push origin <branch> && git push origin v<next>

7. --dry-run: ejecuta pasos 1–5, imprime el plan completo, NO toca nada.
```

### Re-sincronización tag ↔ versión

Hoy `cli/package.json = 2.1.1` pero el tag más alto es `v1.0.0` → `floor = 2.1.1`. El primer release calcula el bump sobre `2.1.1` (p.ej. `feat` → `2.2.0`) y crea el tag de **esa versión nueva** (`v2.2.0`), no `v2.1.1`. De ahí en adelante tag y versión quedan alineados. El uso de `floor = max(current, lastTag)` garantiza monotonicidad incluso con drift, y nunca se recicla una versión ya publicada.

---

## 4. Contrato de auth en cloud

| Secret | Uso | Consumo |
|--------|-----|---------|
| `NPM_TOKEN` | publish a npm | el script escribe `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` en un `cli/.npmrc` temporal (gitignored) y lo borra en `finally` |
| credencial git | push commit+tag | usa la del contenedor (remote con `GITHUB_TOKEN` o SSH); el script **no** hardcodea credenciales |

El workflow de ejemplo (`.github/workflows/release.yml`) configura ambos.

---

## 5. Manejo de errores e idempotencia

- **Fail loud:** toda función pública del core valida inputs y lanza error explícito; nunca retorna valores degradados en silencio.
- **Orden de gates:** los gates de contrato (versión / auth / idempotencia) van **antes** de cualquier early-exit de conveniencia (regla CONSTITUTION). Un flujo que toma el early-exit no debe saltear un invariante.
- **Limpieza garantizada:** el `.npmrc` temporal se elimina siempre (`finally`), incluso si `npm publish` falla → el token no queda en disco.
- **Idempotencia:** segundo run sin commits nuevos → "nada que publicar" (exit 0); si el tag/versión ya existe → error claro (exit != 0), sin efectos parciales.
- Exit codes: `0` éxito o nada-que-hacer; `!= 0` en cualquier gate fallido o error de comando.

---

## 6. Flags / interfaz

| Flag | Efecto |
|------|--------|
| `--dry-run` | Calcula e imprime el plan; no escribe/commitea/taggea/publica/pushea |
| `--force <major\|minor\|patch>` | Fuerza el bump aunque no haya commits releasables |
| `--no-push` | Hace todo localmente pero no pushea (debug) |
| (default) | Flujo completo |

---

## 7. Testing

- **Unit tests del core** (`cli/tests/release/core.test.ts`): `parseCommits`, `determineBump`, `nextVersion`, `renderChangelog`, validadores. Edge cases de la doctrina AWM: string vacío, versión inválida (`""`, `"x.y.z"`), commits sin tipo, `BREAKING CHANGE` en footer vs `!`, rango vacío, `floor = max(...)` con drift.
- **Orquestador** (`cli/tests/release/index.test.ts`): armado de argv y aplicación de gates con git/npm **mockeados**; tmpdir aislado con `HOME`/`AWM_HOME` sobreescritos — ningún test toca npm/red/`~/.awm` reales.
- TDD estricto: test primero, falla, implementación mínima.

---

## 8. Entregables

1. `cli/src/release/core.ts` + `cli/src/release/index.ts`
2. Tests en `cli/tests/release/`
3. Script `release` en `cli/package.json`
4. Entrada `.npmrc` en `.gitignore` (si falta)
5. `CHANGELOG.md` (creado en el primer release)
6. `.github/workflows/release.yml` de ejemplo que invoca el script en el contenedor

---

## 9. Fuera de alcance

- GitHub Releases (descartado en brainstorming).
- Publicación de múltiples paquetes (solo se publica el CLI; el tag es global `vX.Y.Z`).
- Firmado de tags/commits.
