# WS-4 — Distribución npm + separación CLI/contenido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar el CLI en npm (`agentic-workflow-manager` 2.0.0), extraer el contenido a dos repos de registry (`awm-baseline-registry`, `awm-documentation-registry`) y eliminar todo el special-casing de `cli-source`/base del CLI.

**Architecture:** El baseline pasa a ser un registry más (entrada `baseline` en `registries.json`, sembrada por `awm init`); un único loop `syncRegistries()` sincroniza todo; `hooks/` y `sensor-packs/` se resuelven por capacidad (primer root que los tenga). Actualización del CLI en tres capas: aviso pasivo cacheado, self-update con confirmación en `awm update`, gate `minCliVersion` por registry. Spec: [2026-06-10-ws4-npm-distribution-design.md](2026-06-10-ws4-npm-distribution-design.md).

**Tech Stack:** TypeScript, Commander, simple-git, @clack/prompts, Jest. Tests desde `cli/` con `npm test`.

---

## Reglas transversales (aplican a TODOS los tasks)

1. **Ningún test toca el `~/.awm` real** (CONSTITUTION). Patrón dual-tmpdir: `beforeEach` crea `tmpHome`+`tmpWork`, sobreescribe `process.env.HOME` y `process.env.AWM_HOME`, llama `jest.resetModules()`; los módulos se importan con `require()` DENTRO del test; `afterEach` restaura y limpia. Ejemplo de referencia: `cli/tests/core/registries-sync.test.ts`.
2. **Helper GIT en tests con tags:** `git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ...` (sin `tag.gpgSign=false` falla en máquinas con firma global).
3. **Sin red en tests.** Fixtures `git init` locales; el fetch de update-check se inyecta.
4. **Antes de marcar un task con símbolos renombrados/eliminados:** `grep -rn "<símbolo>" src/ tests/ --include="*.ts"` debe devolver 0 hits (CONSTITUTION § Implementación).
5. Cada task termina con `npx tsc --noEmit` + tests del task + commit.

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `cli/src/core/cli-version.ts` | **Crear** — versión propia del CLI desde package.json |
| `cli/src/core/versioning.ts` | `compareSemver` exportado; docstrings sin 'base' |
| `cli/src/core/registries.ts` | `minCliVersion` en manifest, `capabilityRoot`, `seedBaselineRegistry`, `verifyMinCliVersions`, `syncRegistries` (rename), `contentRoots`/`registryNameForPath` sin base |
| `cli/src/core/registry.ts` | Queda solo `resolveBaseRemote(Info)` + `DEFAULT_REMOTE` nuevo; mueren `REGISTRY_DIR`, `syncRegistry`, `buildCli` |
| `cli/src/core/bundles.ts` | Muere `REGISTRY_CONTENT_DIR`; `readCatalog`/`discoverBundles` exigen `contentDir` |
| `cli/src/core/discovery.ts` | Mueren `SKILLS_DIR`/`WORKFLOWS_DIR`/`AGENTS_DIR` |
| `cli/src/core/profile-pins.ts` | Muere el caso `'base'` |
| `cli/src/core/bundle-install.ts` | Fallback `contentDir` obligatorio (sin `REGISTRY_CONTENT_DIR`) |
| `cli/src/commands/hooks/install.ts`, `resync.ts`, `index.ts` | Joins sin prefijo `registry/`; callers usan `capabilityRoot('hooks')` |
| `cli/src/core/context/provider.ts`, `regenerate.ts` | Join sin `registry/`; `capabilityRoot('skills')` |
| `cli/src/core/diagnostics/types.ts`, `context.ts`, `checks.ts` | `cliSource` → `registryCache` |
| `cli/src/core/init/steps.ts`, `cli/src/commands/init.ts` | Bootstrap: seed + `syncRegistries()`; roots por capacidad |
| `cli/src/commands/sensors/run.ts`, `index.ts` | Default root por capacidad |
| `cli/src/commands/registry/add.ts`, `index.ts` | Sin reserva `cli-source`; `earlier` sin `BASE_CONTENT_DIR` |
| `cli/src/index.ts` | Handlers `add`/`list`/`sync`/`update` con loop uniforme; gates; capa 1+2; muere `buildCli` |
| `cli/src/core/update-check.ts` + `update-check-worker.ts` | **Crear** — capas 1 y 2 |
| `cli/package.json` | 2.0.0, `files`, `repository`, `prepack` |
| `registry/`, `install.sh` | **Borrar** del monorepo (tras poblar los repos de contenido) |
| `README.md`, `CLAUDE.md`, `AGENTS.md` | Modelo de distribución nuevo |

---

### Task 1: `cli-version.ts` + `compareSemver`

**Files:**
- Create: `cli/src/core/cli-version.ts`
- Modify: `cli/src/core/versioning.ts` (agregar export al final)
- Test: `cli/tests/core/cli-version.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// cli/tests/core/cli-version.test.ts
describe('cliVersion / compareSemver', () => {
    it('cliVersion devuelve la versión del package.json del CLI', () => {
        const { cliVersion } = require('../../src/core/cli-version');
        const pkg = require('../../package.json');
        expect(cliVersion()).toBe(pkg.version);
    });

    it.each([
        ['1.0.0', '1.0.0', 0],
        ['2.0.0', '1.9.9', 1],
        ['1.9.0', '1.10.0', -1],   // orden numérico, no lexicográfico
        ['1.0.1', '1.0.0', 1],
    ])('compareSemver(%s, %s) → signo %i', (a, b, sign) => {
        const { compareSemver } = require('../../src/core/versioning');
        expect(Math.sign(compareSemver(a, b))).toBe(sign);
    });
});
```

- [ ] **Step 2: Verificar que falla** — Run: `npm test -- tests/core/cli-version.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementación**

```ts
// cli/src/core/cli-version.ts
//
// Versión del propio CLI. Funciona compilado (dist/src/core) y en ts-node
// (src/core): sube directorios hasta encontrar el package.json del paquete.
import fs from 'fs';
import path from 'path';

export const CLI_PACKAGE_NAME = 'agentic-workflow-manager';

export function cliVersion(): string {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        const p = path.join(dir, 'package.json');
        if (fs.existsSync(p)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
                if (pkg.name === CLI_PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
            } catch { /* package.json ajeno o ilegible — seguir subiendo */ }
        }
        dir = path.dirname(dir);
    }
    return '0.0.0';
}
```

En `cli/src/core/versioning.ts`, agregar al final:

```ts
/** Compara "X.Y.Z" vs "X.Y.Z" (sin prefijo v) numéricamente. <0, 0, >0. */
export function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return (pa[0] - pb[0]) || (pa[1] - pb[1]) || (pa[2] - pb[2]);
}
```

- [ ] **Step 4: Verificar que pasa** — Run: `npm test -- tests/core/cli-version.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/cli-version.ts cli/src/core/versioning.ts cli/tests/core/cli-version.test.ts && git commit -m "feat(ws4): cliVersion + compareSemver"`

### Task 2: `minCliVersion` en el manifest de registry

**Files:**
- Modify: `cli/src/core/registries.ts` (interfaz `RegistryManifest` + `readRegistryManifest`)
- Test: `cli/tests/core/registries-manifest.test.ts` (extender el existente; si no existe, crear)

- [ ] **Step 1: Tests que fallan**

```ts
it('minCliVersion válido se expone normalizado (acepta prefijo v)', () => {
    writeManifest({ minCliVersion: 'v2.1.0' });   // helper del archivo: escribe awm-registry.json en tmpRoot
    const { readRegistryManifest } = require('../../src/core/registries');
    expect(readRegistryManifest(tmpRoot).minCliVersion).toBe('2.1.0');
});

it('minCliVersion ausente → undefined', () => {
    writeManifest({ overrides: [] });
    const { readRegistryManifest } = require('../../src/core/registries');
    expect(readRegistryManifest(tmpRoot).minCliVersion).toBeUndefined();
});

it.each([['banana'], ['2.1'], [2], [null]])('minCliVersion malformado %p → error explícito', (bad) => {
    writeManifest({ minCliVersion: bad });
    const { readRegistryManifest } = require('../../src/core/registries');
    expect(() => readRegistryManifest(tmpRoot)).toThrow(/minCliVersion/);
});
```

- [ ] **Step 2: Verificar que fallan** — `npm test -- tests/core/registries-manifest.test.ts` → FAIL.

- [ ] **Step 3: Implementación** — en `registries.ts`:

```ts
export interface RegistryManifest {
    /** Nombres de artifacts que este registry puede sobreescribir de roots anteriores. */
    overrides: Set<string>;
    /** Versión mínima del CLI requerida por el contenido ("X.Y.Z", sin prefijo v). Opcional — WS-4. */
    minCliVersion?: string;
}
```

En `readRegistryManifest`, antes del `return` final:

```ts
    let minCliVersion: string | undefined;
    const rawMin = (raw as Record<string, unknown>)?.minCliVersion;
    if (rawMin !== undefined) {
        if (typeof rawMin !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(rawMin)) {
            throw new Error(`Invalid registry manifest at ${file}: "minCliVersion" must be "X.Y.Z", got ${JSON.stringify(rawMin)}`);
        }
        minCliVersion = rawMin.replace(/^v/, '');
    }
    return { overrides: new Set(overrides as string[]), minCliVersion };
```

(El `return { overrides: ... }` existente se reemplaza por este.)

- [ ] **Step 4: Verificar que pasa** + suite del módulo: `npm test -- tests/core/registries` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(ws4): minCliVersion en awm-registry.json"`

### Task 3: `capabilityRoot` — resolución por capacidad

**Files:**
- Modify: `cli/src/core/registries.ts`
- Test: `cli/tests/core/registries-capability.test.ts` (crear, patrón dual-tmpdir)

- [ ] **Step 1: Tests que fallan**

```ts
// cli/tests/core/registries-capability.test.ts  (beforeEach/afterEach dual-tmpdir estándar)
it('devuelve el primer root configurado que tiene el dir pedido', () => {
    const m = require('../../src/core/registries');
    // dos registries en disco: 'a' sin hooks, 'b' con hooks
    const aRoot = path.join(tmpHome, '.awm/registries/a');
    const bRoot = path.join(tmpHome, '.awm/registries/b');
    fs.mkdirSync(path.join(aRoot, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(bRoot, 'hooks'), { recursive: true });
    m.writeRegistriesConfig([{ name: 'a', remote: 'x' }, { name: 'b', remote: 'y' }]);
    expect(m.capabilityRoot('hooks')).toBe(bRoot);
    expect(m.capabilityRoot('skills')).toBe(aRoot);
});

it('ningún root tiene el dir → null', () => {
    const m = require('../../src/core/registries');
    m.writeRegistriesConfig([]);
    expect(m.capabilityRoot('hooks')).toBeNull();
});
```

- [ ] **Step 2: Verificar que fallan.**

- [ ] **Step 3: Implementación** — en `registries.ts`:

```ts
/** Primer content root configurado (en orden de registries.json) que contiene el
 *  directorio pedido ('hooks', 'sensor-packs', 'skills'…). null si ninguno. */
export function capabilityRoot(dirName: string): string | null {
    for (const root of contentRoots()) {
        if (fs.existsSync(path.join(root, dirName))) return root;
    }
    return null;
}
```

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(ws4): capabilityRoot — resolución por capacidad"`

### Task 4: siembra del baseline + muerte de base en `contentRoots`/`registryNameForPath`

**Files:**
- Modify: `cli/src/core/registries.ts`
- Test: `cli/tests/core/registries-seed.test.ts` (crear)

- [ ] **Step 1: Tests que fallan**

```ts
it('seedBaselineRegistry crea registries.json con baseline la primera vez', () => {
    const m = require('../../src/core/registries');
    expect(m.seedBaselineRegistry()).toBe(true);
    expect(m.readRegistriesConfig()).toEqual([
        { name: 'baseline', remote: require('../../src/core/registry').DEFAULT_REMOTE },
    ]);
});

it('seedBaselineRegistry respeta AWM_BASE_REMOTE', () => {
    process.env.AWM_BASE_REMOTE = '/tmp/mi-remote';
    const m = require('../../src/core/registries');
    m.seedBaselineRegistry();
    expect(m.readRegistriesConfig()[0].remote).toBe('/tmp/mi-remote');
    delete process.env.AWM_BASE_REMOTE;
});

it('seedBaselineRegistry es no-op si registries.json ya existe (idempotente, respeta ediciones)', () => {
    const m = require('../../src/core/registries');
    m.writeRegistriesConfig([{ name: 'equipo', remote: 'x' }]);
    expect(m.seedBaselineRegistry()).toBe(false);
    expect(m.readRegistriesConfig()).toEqual([{ name: 'equipo', remote: 'x' }]);
});

it('contentRoots ya no incluye un root base especial', () => {
    const m = require('../../src/core/registries');
    m.writeRegistriesConfig([]);
    expect(m.contentRoots()).toEqual([]);
});
```

- [ ] **Step 2: Verificar que fallan.**

- [ ] **Step 3: Implementación** — en `registries.ts`:

```ts
import { resolveBaseRemote } from './registry';

/** Bootstrap de máquina (awm init): si no hay registries.json, lo crea con la
 *  entrada baseline (remote por cadena WS-2: env > prefs > default).
 *  Devuelve true si sembró. Nunca toca un registries.json existente. */
export function seedBaselineRegistry(): boolean {
    if (fs.existsSync(REGISTRIES_CONFIG_PATH)) return false;
    writeRegistriesConfig([{ name: 'baseline', remote: resolveBaseRemote() }]);
    return true;
}
```

`contentRoots()` queda sin la rama base:

```ts
export function contentRoots(): string[] {
    const roots: string[] = [];
    for (const reg of listRegistries()) {
        if (fs.existsSync(reg.contentRoot)) roots.push(reg.contentRoot);
    }
    return roots;
}
```

`registryNameForPath()`: eliminar las 3 líneas del caso base (`const base = path.resolve(BASE_CONTENT_DIR); if (...) return 'base';`). Eliminar la constante `BASE_CONTENT_DIR` y el import `REGISTRY_DIR`. **Ripple inmediato** (deja compilando este task): en `cli/src/commands/registry/index.ts` reemplazar `const earlier: string[] = fs.existsSync(BASE_CONTENT_DIR) ? [BASE_CONTENT_DIR] : [];` por `const earlier: string[] = [];` y quitar `BASE_CONTENT_DIR` del import.

- [ ] **Step 4: PASS** + `npx tsc --noEmit` limpio.
- [ ] **Step 5: Commit** — `git commit -m "feat(ws4): seedBaselineRegistry; contentRoots sin base especial"`

### Task 5: `syncRegistries` uniforme + `verifyMinCliVersions`

**Files:**
- Modify: `cli/src/core/registries.ts` (rename `syncAdditionalRegistries` → `syncRegistries`; nueva `verifyMinCliVersions`)
- Modify: `cli/src/index.ts` (solo el import — el handler cambia en Task 10; mientras tanto el alias mantiene compilando: `import { syncRegistries as syncAdditionalRegistries }` NO — hacer el rename de import y call-site textual `syncAdditionalRegistries(` → `syncRegistries(` en index.ts:358)
- Test: `cli/tests/core/registries-sync.test.ts` (rename del símbolo en los 5 tests) + casos nuevos

- [ ] **Step 1: Rename mecánico** — en `registries.ts` renombrar la función y su docstring («Sincroniza cada registry configurado…»). `grep -rn "syncAdditionalRegistries" src/ tests/ --include="*.ts"` y renombrar TODOS los call-sites (index.ts y tests). Verificación: el grep devuelve 0.

- [ ] **Step 2: Tests nuevos que fallan** — en `registries-sync.test.ts`:

```ts
it('baseline sembrado se sincroniza por el mismo loop que cualquier registry', async () => {
    const m = require('../../src/core/registries');
    const source = makeSourceRepo(tmpWork, 'alpha');
    GIT(source, 'tag v1.0.0');
    process.env.AWM_BASE_REMOTE = source;
    m.seedBaselineRegistry();
    delete process.env.AWM_BASE_REMOTE;

    const results = await m.syncRegistries();

    expect(results).toEqual([{ name: 'baseline', action: 'recloned', version: 'v1.0.0' }]);
    expect(fs.existsSync(path.join(tmpHome, '.awm/registries/baseline/skills/alpha/SKILL.md'))).toBe(true);
});

it('verifyMinCliVersions reporta registries que exigen CLI más nuevo', async () => {
    const m = require('../../src/core/registries');
    const source = makeSourceRepo(tmpWork, 'alpha');
    fs.writeFileSync(path.join(source, 'awm-registry.json'), JSON.stringify({ minCliVersion: '99.0.0' }));
    GIT(source, 'add -A'); GIT(source, 'commit -qm manifest');
    m.writeRegistriesConfig([{ name: 'exigente', remote: source }]);
    await m.syncRegistries();

    const failures = m.verifyMinCliVersions();
    expect(failures).toEqual([{ name: 'exigente', min: '99.0.0' }]);
});

it('verifyMinCliVersions ignora registries sin campo o ausentes en disco', () => {
    const m = require('../../src/core/registries');
    m.writeRegistriesConfig([{ name: 'fantasma', remote: '/no/existe' }]);
    expect(m.verifyMinCliVersions()).toEqual([]);
});
```

- [ ] **Step 3: Verificar que fallan** (verifyMinCliVersions no existe).

- [ ] **Step 4: Implementación** — en `registries.ts`:

```ts
import { cliVersion } from './cli-version';
import { compareSemver } from './versioning';

export interface CliVersionFailure { name: string; min: string; }

/** Registries cuyo manifest exige un CLI más nuevo que el actual (capa 3, WS-4). */
export function verifyMinCliVersions(current: string = cliVersion()): CliVersionFailure[] {
    const failures: CliVersionFailure[] = [];
    for (const reg of listRegistries()) {
        if (!fs.existsSync(reg.contentRoot)) continue;
        let min: string | undefined;
        try { min = readRegistryManifest(reg.contentRoot).minCliVersion; } catch { continue; }
        if (min && compareSemver(current, min) < 0) failures.push({ name: reg.name, min });
    }
    return failures;
}
```

- [ ] **Step 5: PASS** — `npm test -- tests/core/registries` + `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git commit -m "feat(ws4): syncRegistries uniforme + verifyMinCliVersions"`

### Task 6: muerte del caso `'base'` en pins

**Files:**
- Modify: `cli/src/core/profile-pins.ts`, `cli/src/index.ts:451` (mensaje del gate), `cli/src/utils/config.ts:15` (comentario), `cli/src/core/versioning.ts:98-100` (docstring `machineVersionOpts`)
- Test: `cli/tests/core/profile-pins.test.ts` (adaptar)

- [ ] **Step 1: Implementación** — `profile-pins.ts`:

```ts
/** Dir del clone de un registry pineable: ~/.awm/registries/<name>. */
export function pinnedRepoDir(name: string): string {
    return registryContentRoot(name);
}
```

Quitar los imports de `REGISTRY_DIR`/`registry`. En `cli/src/index.ts` (gate de pins del handler `sync`), la línea `const isConfigured = f.name === 'base' || registriesConfig.some(...)` pierde el `f.name === 'base' ||`. En `config.ts` el comentario de `pins` pasa a: `/** Pins de versión por registry configurado (p.ej. 'baseline'). Valores "X.Y.Z" sin prefijo v. Opcional — WS-3/WS-4. */`. En `versioning.ts` el docstring de `machineVersionOpts` pierde `('base' reservado)`.

- [ ] **Step 2: Adaptar tests** — en `profile-pins.test.ts`, todo caso que pineaba `base` pasa a usar un registry configurado `baseline`: el fixture se registra con `writeRegistriesConfig([{ name: 'baseline', remote: source }])` + `syncRegistries()` en lugar de `syncRegistry(...)`, y los asserts usan `{ name: 'baseline', ... }`. El test de regresión B1 conserva su nombre y semántica (gate corre con extensions vacío) con el registry `baseline`.

- [ ] **Step 3: PASS** — `npm test -- tests/core/profile-pins.test.ts`. `grep -n "'base'" src/ -r --include="*.ts"` → 0 hits de la clave reservada.
- [ ] **Step 4: Commit** — `git commit -m "refactor(ws4): pins por nombre de registry — muere el caso reservado 'base'"`

### Task 7: hooks y contexto sobre content roots

**Files:**
- Modify: `cli/src/commands/hooks/install.ts:56-57`, `cli/src/commands/hooks/resync.ts:35-36`, `cli/src/core/context/provider.ts:22`
- Modify callers: `cli/src/commands/hooks/index.ts:9,25`, `cli/src/core/context/regenerate.ts:9,27`, `cli/src/core/diagnostics/context.ts:8,71`
- Test: los tests existentes de hooks (`cli/tests/commands/hooks/`) se adaptan: sus fixtures de registry pierden el nivel `registry/` (el contenido va en la raíz del root fixture)

- [ ] **Step 1: Joins sin prefijo** — el contrato pasa a ser «`registryRoot` = content root (dirs en la raíz)»:
  - `install.ts:56-57`: `path.join(options.registryRoot, 'hooks')` y `path.join(options.registryRoot, 'skills/using-awm/SKILL.md')`
  - `resync.ts:35-36`: ídem (`'hooks'`, `'skills/using-awm/SKILL.md'`)
  - `provider.ts:22`: `path.join(input.registryRoot, 'skills/using-awm/SKILL.md')`

- [ ] **Step 2: Callers por capacidad** — patrón en cada caller (el import de `REGISTRY_DIR` se reemplaza por `capabilityRoot` de `../../core/registries` con el path relativo correcto):

```ts
const hooksRoot = capabilityRoot('hooks');
if (!hooksRoot) {
    console.error(pc.red('No configured registry provides hooks/ — run `awm update` first.'));
    process.exit(1);
}
// ... registryRoot: hooksRoot
```

  - `commands/hooks/index.ts:25` (handler de `awm hooks install`): patrón de arriba.
  - `context/regenerate.ts:27` y `diagnostics/context.ts:71`: `registryRoot: capabilityRoot('skills') ?? ''` (el catch existente en diagnostics tolera el vacío; en regenerate, si es null, devolver `[]` temprano).

- [ ] **Step 3: Adaptar fixtures de tests de hooks** (quitar el nivel `registry/` de los paths de fixture) y correr: `npm test -- tests/commands/hooks` → PASS. `npx tsc --noEmit` limpio (quedan usos de `REGISTRY_DIR` en index.ts/init — se eliminan en Tasks 9-11; mientras compile, OK).
- [ ] **Step 4: Commit** — `git commit -m "refactor(ws4): hooks y contexto resuelven sobre content roots (capabilityRoot)"`

### Task 8: bundles/discovery/sensors sin constantes de base

**Files:**
- Modify: `cli/src/core/bundles.ts` (muere `REGISTRY_CONTENT_DIR`; `readCatalog(contentDir: string)` y `discoverBundles(contentDir: string)` pierden el default), `cli/src/core/bundle-install.ts:63` (`const fallbackContentDir = opts.contentDir ?? contentRoots()[0] ?? '';` con import de `contentRoots`), `cli/src/core/discovery.ts:7-9` (borrar `SKILLS_DIR`/`WORKFLOWS_DIR`/`AGENTS_DIR` y el import de `REGISTRY_DIR`), `cli/src/commands/sensors/run.ts:55-58` y `cli/src/commands/sensors/index.ts:42` (default → `capabilityRoot('sensor-packs')`), `cli/src/commands/registry/add.ts:29` (quitar `|| name === 'cli-source'`), `cli/src/commands/init.ts:6-7` (imports — wiring completo en Task 11)

- [ ] **Step 1:** `grep -rn "REGISTRY_CONTENT_DIR\|SKILLS_DIR\|WORKFLOWS_DIR\|AGENTS_DIR" src/ tests/ --include="*.ts"` — aplicar en cada hit:
  - `sensors/index.ts:42`: la option `--registry-root` pierde el default estático; en el handler: `registryRoot: opts.registryRoot ?? capabilityRoot('sensor-packs') ?? undefined`.
  - `sensors/run.ts`: `defaultRegistryRoot()` se reemplaza por `capabilityRoot('sensor-packs')`; `const root = registryRoot ?? capabilityRoot('sensor-packs'); if (!root || !fs.existsSync(root)) return { manifest, detection };`
  - `bundle-install.ts:63`: fallback `contentRoots()[0] ?? ''` (los bundles descubiertos traen `contentRoot` propio, el fallback es defensa).
  - `bundles.ts`: borrar la constante y el import de `REGISTRY_DIR`; firmas `readCatalog(contentDir: string)`, `discoverBundles(contentDir: string)` (sin default — `discoverAllBundles(roots = contentRoots())` sigue siendo la API multi-root).

- [ ] **Step 2:** `npx tsc --noEmit` — corregir todo caller que dependía de los defaults eliminados (el grep del Step 1 los lista todos). `npm test -- tests/core/bundles tests/commands/sensors` → PASS (adaptar fixtures que armaban `cli-source/registry/`: ahora el content root ES la raíz del fixture).
- [ ] **Step 3: Commit** — `git commit -m "refactor(ws4): mueren REGISTRY_CONTENT_DIR y los DIR de base; sensors por capacidad"`

### Task 9: diagnostics `cliSource` → `registryCache`

**Files:**
- Modify: `cli/src/core/diagnostics/types.ts:25`, `context.ts:83-95,135`, `checks.ts:11-25`, `cli/src/core/init/steps.ts:92-95` (stepCache)
- Test: adaptar los tests que referencien `cliSource` (`grep -rn "cliSource" tests/`)

- [ ] **Step 1: Tipos** — `types.ts`: `registryCache: { present: boolean; gitState?: GitState };` (se elimina `version` del shape).

- [ ] **Step 2: Gather** — en `context.ts` `gatherMachine`, reemplazar el bloque cliSource por:

```ts
    // registryCache: estado del primer registry configurado (baseline en una máquina sembrada)
    const regs = listRegistries();
    const first = regs[0];
    const cachePresent = !!first && fs.existsSync(path.join(first.contentRoot, '.git'));
    const gitState = cachePresent ? detectGitState(first.contentRoot) : undefined;
```

y en el return: `registryCache: { present: cachePresent, gitState },`. Import `listRegistries` desde `../registries`; eliminar el path `cli-source`.

- [ ] **Step 3: Checks y steps** — `checks.ts`: mensajes sin `version` (`'registry cache missing — run awm update'` / estados git como hoy). `init/steps.ts` `stepCache`: `const { registryCache } = d.ctx.machine; const needsSync = !registryCache.present || registryCache.gitState === 'behind';`

- [ ] **Step 4:** `grep -rn "cliSource" src/ tests/ --include="*.ts"` → 0. Tests adaptados → PASS. Commit: `git commit -m "refactor(ws4): diagnostics registryCache reemplaza cliSource"`

### Task 10: handlers uniformes + gates en `index.ts`

**Files:**
- Modify: `cli/src/index.ts` (handlers `add`, `list`, `sync`, `update`)
- Test: `cli/tests/core/sync-gates.test.ts` (crear — gate por unidad, no por handler)

- [ ] **Step 1: Bloque de sync compartido** — en los handlers `add` (línea ~71), `list` (~503) y `sync` (~431), reemplazar el bloque `syncRegistry(resolveBaseRemote(), machineVersionOpts('base'))` + spinner por:

```ts
      const s = spinner();
      s.start('Syncing registries...');
      const results = await syncRegistries();
      s.stop('Registries synced.');
      for (const r of results) {
          if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
      }
```

(Errores por-registry son warnings, no abort: el discovery sigue funcionando con lo que esté en disco; una máquina vacía cae en los mensajes "No artifacts found" existentes.)

- [ ] **Step 2: Gate minCliVersion en `sync`** — inmediatamente después del bloque de sync del handler `sync` y ANTES del gate de pins (gates de contrato antes de early-exits — CONSTITUTION):

```ts
      const cliFailures = verifyMinCliVersions();
      if (cliFailures.length > 0) {
          for (const f of cliFailures) {
              console.error(pc.red(`El registry ${f.name} requiere CLI ≥ ${f.min} (tenés ${cliVersion()}).`));
              console.error(pc.red('  Corré: npm i -g agentic-workflow-manager'));
          }
          process.exit(1);
      }
```

Orden final del handler `sync`: project root → profile → syncRegistries → **gate minCliVersion** → **gate pins** → early-exit extensions → install.

- [ ] **Step 3: Handler `update` completo** — reemplazar la action entera por:

```ts
program.command('update')
  .description('Sync all configured registries with their remotes')
  .action(async () => {
      intro(pc.bgCyan(pc.black(' AWM - Update Registries ')));

      const s = spinner();
      s.start('Syncing registries...');
      const results = await syncRegistries();
      s.stop('Registries synced.');

      if (results.length === 0) {
          console.log(pc.yellow('  No registries configured — run `awm init` (seeds baseline) or `awm registry add <remote>`.'));
      }
      for (const r of results) {
          if (r.action === 'error') {
              console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
          } else {
              console.log(pc.green(`  ✓ Registry ${r.name} ${r.action === 'pulled' ? 'updated' : 're-cloned'} @ ${r.version}`));
          }
      }

      for (const f of verifyMinCliVersions()) {
          console.warn(pc.yellow(`  ⚠  El registry ${f.name} requiere CLI ≥ ${f.min} (tenés ${cliVersion()}) — corré: npm i -g agentic-workflow-manager`));
      }

      try {
          const regen = regenerateGlobalContext();
          const refreshed = regen.filter((r) => r.action === 'refreshed').map((r) => r.agent);
          if (refreshed.length > 0) console.log(pc.green(`  ✓ Regenerated AWM context for: ${refreshed.join(', ')}`));
      } catch { /* no aborta */ }

      try {
          for (const { agent, result } of reconcileAllSkillLinks(contentRoots())) {
              const touched = result.relinked.length + result.pruned.length;
              if (touched > 0) console.log(pc.green(`  ✓ Reconciled ${agent} skill links: re-linked ${result.relinked.length}, pruned ${result.pruned.length}`));
          }
      } catch { /* no aborta */ }

      try {
          const hooksRoot = capabilityRoot('hooks');
          if (hooksRoot) {
              for (const r of resyncInstalledHooks(hooksRoot)) {
                  if (r.action === 'resynced') console.log(pc.green(`  ✓ Re-synced ${r.agent} hook scripts`));
                  else if (r.action === 'registry-missing') console.warn(pc.yellow(`  ⚠  ${r.agent} hook installed but registry hooks missing — run 'awm hooks install'`));
              }
          }
      } catch { /* no aborta */ }

      await offerSelfUpdate();   // capa 2 — Task 13 (hasta ese task, dejar esta línea comentada)

      outro('✅ Registries, skills y hooks actualizados.');
  });
```

Eliminar de `index.ts` los imports `syncRegistry`, `buildCli`, `REGISTRY_DIR`, `machineVersionOpts` (queda `resolveBaseRemoteInfo` solo si algún mensaje de error lo usa — el catch del update viejo desaparece; quitarlo si queda huérfano). Agregar imports `syncRegistries, verifyMinCliVersions, capabilityRoot` y `cliVersion`.

- [ ] **Step 4: Test del gate por unidad** — `cli/tests/core/sync-gates.test.ts`: replica el patrón de `profile-pins.test.ts` para `verifyMinCliVersions` con CLI inyectado: `verifyMinCliVersions('1.0.0')` contra manifest `minCliVersion: '2.0.0'` → 1 failure; `verifyMinCliVersions('2.0.0')` → 0. (El exit-1 del handler no se testea por proceso; el gate de pins B1 ya estableció el patrón de gate-por-unidad.)

- [ ] **Step 5:** `npx tsc --noEmit` + `npm test` (suite completa; adaptar los tests de handlers que esperaban el sync base). Commit: `git commit -m "feat(ws4): handlers uniformes — un solo loop de sync, gates minCliVersion, muere buildCli del update"`

### Task 11: bootstrap de `awm init`

**Files:**
- Modify: `cli/src/commands/init.ts` (handler), `cli/src/core/init/steps.ts:32` (`syncCache`)
- Test: tests de init existentes (inyectan actions — adaptar nombres si referencian syncRegistry) + caso de siembra en `cli/tests/core/registries-seed.test.ts`

- [ ] **Step 1: steps.ts** — `syncCache: async () => { await syncRegistries(); },` (imports: quitar `syncRegistry`, `resolveBaseRemote`, `machineVersionOpts`; agregar `syncRegistries` desde `../registries`).

- [ ] **Step 2: commands/init.ts** — al inicio del handler (antes de `gatherContext`):

```ts
      seedBaselineRegistry();
      if (listRegistries().some((r) => !fs.existsSync(r.contentRoot))) {
          await syncRegistries();
      }
```

y reemplazar el wiring de roots: `registryRoot: capabilityRoot('hooks') ?? ''` (línea 97), `contentDir: contentRoots()[0] ?? ''` (línea 98). Imports desde `../core/registries`; quitar `REGISTRY_DIR`/`REGISTRY_CONTENT_DIR`.

- [ ] **Step 3:** `npm test -- tests/commands/init tests/core/init` → PASS (los specs con actions espiadas no cambian de semántica). Commit: `git commit -m "feat(ws4): awm init siembra baseline y bootstrapea por syncRegistries"`

### Task 12: shrink final de `registry.ts` + grep gate global

**Files:**
- Modify: `cli/src/core/registry.ts` (archivo completo reemplazado), `cli/tests/core/registry-versioned-sync.test.ts` (eliminar — su cobertura vive en `registries-sync.test.ts`; portar allí cualquier caso único que falte: rollback a tag anterior con pin, canal dev sigue HEAD, transición tag→tag)

- [ ] **Step 1: Portar casos** — revisar `registry-versioned-sync.test.ts`; los casos «rollback a pin anterior», «canal dev (prefs channel:'dev') sigue HEAD» y «C2 cleanup post-clone» deben existir en `registries-sync.test.ts` contra `syncRegistries` + entry `baseline` (pins en `preferences.json` con clave `baseline`). Escribirlos si faltan; correrlos → PASS. Borrar el archivo viejo.

- [ ] **Step 2: registry.ts final**

```ts
// src/core/registry.ts
//
// Identidad del registry base (WS-4): el CLI no clona ni buildea nada acá —
// solo conoce el remote default que `awm init` siembra en registries.json.
import { getPreferences } from "../utils/config";

export const DEFAULT_REMOTE = "https://github.com/Kodria/awm-baseline-registry.git";

export type BaseRemoteSource = 'env' | 'prefs' | 'default';

/** Remote efectivo del registry base y su origen: env AWM_BASE_REMOTE > preferences.baseRemote > DEFAULT_REMOTE. */
export function resolveBaseRemoteInfo(): { remote: string; source: BaseRemoteSource } {
    if (process.env.AWM_BASE_REMOTE) return { remote: process.env.AWM_BASE_REMOTE, source: 'env' };
    try {
        const prefs = getPreferences();
        if (prefs.baseRemote) return { remote: prefs.baseRemote, source: 'prefs' };
    } catch {
        // preferencias ilegibles no deben bloquear — cae al default
    }
    return { remote: DEFAULT_REMOTE, source: 'default' };
}

export function resolveBaseRemote(): string {
    return resolveBaseRemoteInfo().remote;
}
```

- [ ] **Step 3: Grep gate** — los CINCO greps devuelven 0 hits en `src/` y `tests/`: `REGISTRY_DIR`, `BASE_CONTENT_DIR`, `REGISTRY_CONTENT_DIR`, `buildCli`, `cli-source`. `syncRegistry\b` (sin sufijo) → 0.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm test` (suite COMPLETA verde). Commit: `git commit -m "refactor(ws4): registry.ts reducido a identidad del remote base — muere cli-source"`

### Task 13: `update-check.ts` — capas 1 y 2

**Files:**
- Create: `cli/src/core/update-check.ts`, `cli/src/core/update-check-worker.ts`
- Modify: `cli/src/index.ts` (hook `postAction` + descomentar `offerSelfUpdate()` del update)
- Test: `cli/tests/core/update-check.test.ts`

- [ ] **Step 1: Tests que fallan**

```ts
// cli/tests/core/update-check.test.ts  (dual-tmpdir estándar)
describe('update-check', () => {
    it('fetchLatestVersion devuelve la versión del registry npm', async () => {
        const { fetchLatestVersion } = require('../../src/core/update-check');
        const fakeFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '2.3.0' }) });
        await expect(fetchLatestVersion(fakeFetch)).resolves.toBe('2.3.0');
    });

    it('fetchLatestVersion sin red → null en silencio', async () => {
        const { fetchLatestVersion } = require('../../src/core/update-check');
        const fakeFetch = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(fetchLatestVersion(fakeFetch)).resolves.toBeNull();
    });

    it('maybeNotifyUpdate avisa si el cache trae versión más nueva y NO refresca cache fresco', () => {
        const m = require('../../src/core/update-check');
        m.writeUpdateCache({ lastCheck: 1_000_000, latest: '99.0.0' });
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: 1_000_000 + 1000, spawnWorker });
        expect(log.mock.calls.flat().join('\n')).toContain('99.0.0');
        expect(spawnWorker).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it('cache viejo (>24h) dispara refresh en background', () => {
        const m = require('../../src/core/update-check');
        m.writeUpdateCache({ lastCheck: 0, latest: null });
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: 25 * 60 * 60 * 1000, spawnWorker });
        expect(spawnWorker).toHaveBeenCalledTimes(1);
    });

    it('AWM_NO_UPDATE_CHECK desactiva todo', () => {
        process.env.AWM_NO_UPDATE_CHECK = '1';
        const m = require('../../src/core/update-check');
        m.writeUpdateCache({ lastCheck: 0, latest: '99.0.0' });
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const spawnWorker = jest.fn();
        m.maybeNotifyUpdate({ now: Date.now(), spawnWorker });
        expect(log).not.toHaveBeenCalled();
        expect(spawnWorker).not.toHaveBeenCalled();
        log.mockRestore();
        delete process.env.AWM_NO_UPDATE_CHECK;
    });

    it('offerSelfUpdate corre el runner al confirmar y degrada a aviso si falla', async () => {
        const m = require('../../src/core/update-check');
        const runner = jest.fn().mockReturnValue({ status: 1 });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await m.offerSelfUpdate({ current: '2.0.0', latest: '2.1.0', confirmImpl: async () => true, runner });
        expect(runner).toHaveBeenCalled();
        expect(warn.mock.calls.flat().join('\n')).toContain('npm i -g agentic-workflow-manager');
        warn.mockRestore();
    });
});
```

- [ ] **Step 2: Verificar que fallan.**

- [ ] **Step 3: Implementación**

```ts
// cli/src/core/update-check.ts
//
// Actualización del CLI en capas (WS-4): capa 1 = aviso pasivo con cache de 24h
// refrescado por un worker detached; capa 2 = self-update con confirmación en
// `awm update`. AWM_NO_UPDATE_CHECK=1 desactiva ambas (tests, CI).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import pc from 'picocolors';
import { confirm, isCancel } from '@clack/prompts';
import { cliVersion, CLI_PACKAGE_NAME } from './cli-version';
import { compareSemver } from './versioning';

const TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/latest`;

export interface UpdateCache { lastCheck: number; latest: string | null; }

function cacheFile(): string {
    const home = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');
    return path.join(home, 'update-check.json');
}

export function readUpdateCache(): UpdateCache | null {
    try {
        const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8'));
        if (typeof raw.lastCheck === 'number') return raw as UpdateCache;
    } catch { /* ausente o corrupto → null */ }
    return null;
}

export function writeUpdateCache(c: UpdateCache): void {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(c), 'utf-8');
}

/** Última versión publicada en npm, o null ante cualquier falla (timeout 2s). */
export async function fetchLatestVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 2000);
        const res = await fetchImpl(REGISTRY_URL, { signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const body = (await res.json()) as { version?: unknown };
        return typeof body.version === 'string' ? body.version : null;
    } catch {
        return null;
    }
}

/** Worker detached que refresca el cache sin bloquear el comando actual. */
export function spawnRefreshWorker(): void {
    const worker = path.join(__dirname, 'update-check-worker.js');
    if (!fs.existsSync(worker)) return;   // ts-node / dev: sin worker compilado, skip
    spawn(process.execPath, [worker], { detached: true, stdio: 'ignore', env: process.env }).unref();
}

/** Capa 1 — llamado al final de cualquier comando (hook postAction de Commander). */
export function maybeNotifyUpdate(opts?: { now?: number; spawnWorker?: () => void }): void {
    if (process.env.AWM_NO_UPDATE_CHECK) return;
    const now = opts?.now ?? Date.now();
    const spawnWorker = opts?.spawnWorker ?? spawnRefreshWorker;
    const cache = readUpdateCache();
    if (cache?.latest && compareSemver(cache.latest, cliVersion()) > 0) {
        console.log(pc.dim(`\n⬆ awm v${cache.latest} disponible → npm i -g ${CLI_PACKAGE_NAME}`));
    }
    if (!cache || now - cache.lastCheck > TTL_MS) spawnWorker();
}

export interface SelfUpdateDeps {
    current?: string;
    latest?: string | null;
    confirmImpl?: (msg: string) => Promise<boolean>;
    runner?: (cmd: string, args: string[]) => { status: number | null };
    fetchImpl?: typeof fetch;
}

/** Capa 2 — en `awm update`: detecta, pregunta, ejecuta npm i -g; degrada a aviso. */
export async function offerSelfUpdate(deps: SelfUpdateDeps = {}): Promise<void> {
    if (process.env.AWM_NO_UPDATE_CHECK) return;
    const current = deps.current ?? cliVersion();
    const latest = deps.latest !== undefined ? deps.latest : await fetchLatestVersion(deps.fetchImpl ?? fetch);
    writeUpdateCache({ lastCheck: Date.now(), latest: latest ?? null });
    if (!latest || compareSemver(latest, current) <= 0) return;

    const confirmImpl = deps.confirmImpl ?? (async (message: string) => {
        const r = await confirm({ message });
        return !isCancel(r) && r === true;
    });
    const yes = await confirmImpl(`¿Actualizar awm v${current} → v${latest} ahora?`);
    if (!yes) {
        console.log(pc.dim(`  Para actualizar después: npm i -g ${CLI_PACKAGE_NAME}`));
        return;
    }
    const runner = deps.runner ?? ((cmd: string, args: string[]) =>
        spawnSync(cmd, args, { stdio: 'inherit', shell: true }));
    const r = runner('npm', ['i', '-g', `${CLI_PACKAGE_NAME}@latest`]);
    if (r.status === 0) {
        console.log(pc.green(`  ✓ CLI actualizado a v${latest} (aplica desde el próximo comando)`));
    } else {
        console.warn(pc.yellow(`  ⚠  No se pudo actualizar automáticamente — corré: npm i -g ${CLI_PACKAGE_NAME}`));
    }
}
```

```ts
// cli/src/core/update-check-worker.ts
//
// Proceso detached lanzado por maybeNotifyUpdate: refresca el cache y muere.
import { fetchLatestVersion, writeUpdateCache } from './update-check';

(async () => {
    const latest = await fetchLatestVersion();
    writeUpdateCache({ lastCheck: Date.now(), latest });
})();
```

- [ ] **Step 4: Wiring en `index.ts`** — después de declarar `program`:

```ts
program.hook('postAction', () => {
    try { maybeNotifyUpdate(); } catch { /* el aviso nunca rompe un comando */ }
});
```

y en el handler `update`, descomentar/agregar `await offerSelfUpdate();` (antes del `outro`).

- [ ] **Step 5: PASS** — `npm test -- tests/core/update-check.test.ts` + suite completa (los tests de handlers existentes deben setear `AWM_NO_UPDATE_CHECK=1` en su entorno si invocan comandos — agregarlo a los setups que lo necesiten). Commit: `git commit -m "feat(ws4): update-check — aviso pasivo cacheado + self-update con confirmación"`

### Task 14: `package.json` 2.0.0 + E2E del tarball

**Files:**
- Modify: `cli/package.json`
- Test: `cli/tests/integration/pack-e2e.test.ts` (crear)

- [ ] **Step 1: package.json** — cambios (el resto queda igual):

```json
{
  "version": "2.0.0",
  "files": ["dist"],
  "repository": { "type": "git", "url": "git+https://github.com/Kodria/agentic-workflow.git", "directory": "cli" },
  "scripts": { "prepack": "npm run build" }
}
```

(`prepack` se AGREGA a scripts — `npm pack`/`npm publish` buildean siempre; `prepublishOnly` existente puede quedar.)

- [ ] **Step 2: Test E2E**

```ts
// cli/tests/integration/pack-e2e.test.ts
//
// Verifica el criterio del roadmap sin publicar: el tarball de npm pack corre
// `awm update` end-to-end contra un registry fixture, sin el monorepo.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ${cmd}`, { cwd, stdio: 'pipe' });

jest.setTimeout(180_000);

it('el tarball empaquetado corre awm update sin el monorepo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-'));
    const cliDir = path.resolve(__dirname, '../..');
    try {
        execSync(`npm pack --pack-destination "${tmp}"`, { cwd: cliDir, stdio: 'pipe' });
        const tarball = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))!;
        execSync(`tar -xzf "${tarball}"`, { cwd: tmp });
        const pkgDir = path.join(tmp, 'package');

        // files whitelist: dist viaja, src no
        expect(fs.existsSync(path.join(pkgDir, 'dist/src/index.js'))).toBe(true);
        expect(fs.existsSync(path.join(pkgDir, 'src'))).toBe(false);

        // deps sin red: el node_modules del repo sirve al binario extraído
        fs.symlinkSync(path.join(cliDir, 'node_modules'), path.join(pkgDir, 'node_modules'));

        // registry fixture con un skill y tag v1.0.0
        const source = path.join(tmp, 'src-reg');
        fs.mkdirSync(path.join(source, 'skills/alpha'), { recursive: true });
        fs.writeFileSync(path.join(source, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: t\n---\n');
        GIT(source, 'init -q'); GIT(source, 'add -A'); GIT(source, 'commit -qm init'); GIT(source, 'tag v1.0.0');

        const home = path.join(tmp, 'home');
        const awmHome = path.join(home, '.awm');
        fs.mkdirSync(awmHome, { recursive: true });
        fs.writeFileSync(path.join(awmHome, 'registries.json'),
            JSON.stringify([{ name: 'baseline', remote: source }]));

        execSync(`node "${path.join(pkgDir, 'dist/src/index.js')}" update`, {
            env: { ...process.env, HOME: home, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
            stdio: 'pipe',
        });

        expect(fs.existsSync(path.join(awmHome, 'registries/baseline/skills/alpha/SKILL.md'))).toBe(true);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
```

- [ ] **Step 3: PASS** — `npm test -- tests/integration/pack-e2e.test.ts`. Commit: `git commit -m "feat(ws4): paquete npm 2.0.0 + E2E del tarball"`

### Task 15: poblar y publicar los repos de contenido

Working copies ya existentes (vacías, con remote): `/Users/cencosud/Developments/personal/awm-registry/awm-baseline-registry` y `.../awm-documentation-registry`.

- [ ] **Step 1: Poblar baseline**

```bash
SRC=/Users/cencosud/Developments/personal/agentic-workflow/registry
BASE=/Users/cencosud/Developments/personal/awm-registry/awm-baseline-registry
DOCS_SKILLS="docs-system-orchestrator docs-brainstorming docs-assistant template-manager template-wizard documenting-modules business-documenting-modules c4-architecture init-docs-repo discovery-assistant story-mapping"

mkdir -p "$BASE"/{skills,bundles,workflows,agents}
for s in "$SRC"/skills/*/; do
  name=$(basename "$s")
  case " $DOCS_SKILLS " in *" $name "*) ;; *) cp -R "$s" "$BASE/skills/$name" ;; esac
done
cp -R "$SRC/bundles/dev" "$SRC/bundles/frontend" "$SRC/bundles/authoring" "$BASE/bundles/"
cp -R "$SRC/hooks" "$SRC/sensor-packs" "$SRC/references" "$BASE/"
cp "$SRC/workflows/development-process.md" "$BASE/workflows/"
cp "$SRC/agents/development-process.md" "$BASE/agents/"

cat > "$BASE/catalog.json" <<'EOF'
{
  "version": 1,
  "bundles": [
    { "name": "dev",       "source": "./bundles/dev",       "version": "1.0.0", "scope": "baseline" },
    { "name": "frontend",  "source": "./bundles/frontend",  "version": "1.0.0", "scope": "project" },
    { "name": "authoring", "source": "./bundles/authoring", "version": "1.0.0", "scope": "project" }
  ]
}
EOF
cat > "$BASE/awm-registry.json" <<'EOF'
{ "minCliVersion": "2.0.0" }
EOF
```

- [ ] **Step 2: Poblar documentation**

```bash
DOC=/Users/cencosud/Developments/personal/awm-registry/awm-documentation-registry
mkdir -p "$DOC"/{skills,bundles,workflows,agents}
for name in $DOCS_SKILLS; do cp -R "$SRC/skills/$name" "$DOC/skills/$name"; done
cp -R "$SRC/bundles/docs" "$DOC/bundles/"
cp "$SRC/workflows/docs-system-orchestrator.md" "$DOC/workflows/"
cp "$SRC/agents/docs-system-orchestrator.md" "$DOC/agents/"

cat > "$DOC/catalog.json" <<'EOF'
{
  "version": 1,
  "bundles": [
    { "name": "docs", "source": "./bundles/docs", "version": "1.0.0", "scope": "project" }
  ]
}
EOF
cat > "$DOC/awm-registry.json" <<'EOF'
{ "minCliVersion": "2.0.0" }
EOF
```

- [ ] **Step 3: Verificación local con el CLI nuevo** (sin red, HOME aislado — nunca el `~/.awm` real):

```bash
cd /Users/cencosud/Developments/personal/agentic-workflow/cli && npm run build
TMP=$(mktemp -d)
HOME=$TMP AWM_HOME=$TMP/.awm AWM_NO_UPDATE_CHECK=1 node - <<EOF
const fs = require('fs');
fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
fs.writeFileSync(process.env.AWM_HOME + '/registries.json', JSON.stringify([
  { name: 'baseline', remote: '/Users/cencosud/Developments/personal/awm-registry/awm-baseline-registry' },
  { name: 'documentation', remote: '/Users/cencosud/Developments/personal/awm-registry/awm-documentation-registry' },
]));
EOF
HOME=$TMP AWM_HOME=$TMP/.awm AWM_NO_UPDATE_CHECK=1 node dist/src/index.js update
HOME=$TMP AWM_HOME=$TMP/.awm AWM_NO_UPDATE_CHECK=1 node dist/src/index.js list --all
rm -rf $TMP
```

Esperado: `update` clona ambos (⚠ «sin tags — siguiendo HEAD» antes del commit/tag es correcto si se corre antes del Step 4; tras taggear reporta `@ v1.0.0`); `list --all` muestra los bundles `dev`, `frontend`, `authoring`, `docs` y el bundle `docs` resuelve sus skills (dependsOn `dev` cross-registry).

- [ ] **Step 4: Commit + tag + push (acción externa — ejecutar explícitamente)**

```bash
cd "$BASE" && git add -A && git commit -m "feat: initial baseline content from agentic-workflow (WS-4)" && git tag v1.0.0 && git push -u origin main --tags
cd "$DOC"  && git add -A && git commit -m "feat: initial documentation content from agentic-workflow (WS-4)" && git tag v1.0.0 && git push -u origin main --tags
gh repo edit Kodria/awm-documentation-registry --visibility public --accept-visibility-change-consequences
```

- [ ] **Step 5: Commit en el monorepo** — nada que commitear acá (los repos de contenido son externos); registrar en el plan el SHA inicial de cada repo como nota de cierre del task.

### Task 16: limpieza del monorepo + docs

**Files:**
- Delete: `registry/` (completo), `install.sh`
- Modify: `README.md` (sección instalación), `CLAUDE.md` (sección `~/.awm`), `AGENTS.md` (nota de layout)

- [ ] **Step 1: Borrar** — `git rm -r registry/ install.sh`. Luego `grep -rn "install.sh\|registry/skills\|cli-source" README.md CLAUDE.md AGENTS.md docs/ --include="*.md" -l` para localizar referencias a actualizar (docs/plans históricos NO se tocan — son registros).

- [ ] **Step 2: README** — la sección de instalación queda:

```markdown
## Install

\`\`\`bash
npm i -g agentic-workflow-manager
awm init        # en tu proyecto: bootstrapea ~/.awm, clona el baseline registry e instala los bundles
\`\`\`

El contenido vive en registries git separados del CLI:
[awm-baseline-registry](https://github.com/Kodria/awm-baseline-registry) (sembrado por defecto) y
[awm-documentation-registry](https://github.com/Kodria/awm-documentation-registry) (opt-in:
`awm registry add https://github.com/Kodria/awm-documentation-registry.git`).
\`AWM_BASE_REMOTE\` overridea el remote del baseline en la siembra.
```

- [ ] **Step 3: CLAUDE.md** — reescribir la sección «`~/.awm` es territorio del instalador»: sigue prohibido tocar `~/.awm` desde sesiones de desarrollo, pero el flujo correcto cambia: *el contenido (skills, bundles, sensor-packs, hooks) ya no vive en este repo — se edita en `awm-baseline-registry`/`awm-documentation-registry` (editar → commit → tag vX.Y.Z → `awm update`); este repo solo desarrolla el CLI, que se distribuye vía npm (`npm publish` desde `cli/`).* La regla de tests con tmpdirs aislados queda intacta. En AGENTS.md, actualizar cualquier mención a `cli-source`/`registry/` con el layout nuevo (`~/.awm/registries/<name>`).

- [ ] **Step 4:** `npm test` (suite completa verde — nada del CLI depende ya de `registry/`). Commit: `git commit -m "feat(ws4)!: remove registry/ and install.sh — content lives in awm-*-registry repos, CLI ships via npm"`

### Task 17: roadmap + runbook manual

**Files:**
- Modify: `docs/plans/2026-06-09-distribution-roadmap.md` (checkboxes WS-4 + tabla, en el PR de cierre — regla #3)
- Este plan: sección runbook (ya incluida abajo)

- [ ] **Step 1:** Marcar en el roadmap los ítems de WS-4 que estén completos con link a este plan. La fila de la tabla pasa a ☑ recién cuando el plan tenga `awm-qa-complete` (lo hace `post-implementation-qa`).
- [ ] **Step 2: Commit** — `git commit -m "docs: WS-4 closure — roadmap update"`

---

## Runbook manual post-merge (no automatizable — lo ejecuta el autor)

1. **Publicar:** `cd cli && npm login && npm publish` (publica 2.0.0; `prepack` buildea). Verificar: `npm view agentic-workflow-manager version` → `2.0.0`.
2. **Teardown de la máquina actual:** `npm rm -g agentic-workflow-manager && rm -rf ~/.awm`.
3. **Instalación fresca:** `npm i -g agentic-workflow-manager`, luego en un proyecto: `awm init` (siembra baseline, clona a v1.0.0, instala bundles, reconcilia symlinks rotos).
4. **Registries adicionales:** `awm registry add git@github.com:Kodria/awm-documentation-registry.git` y el personal de WS-1.
5. **Proyectos pineados:** renombrar la clave `base` → `baseline` en `.awm/profile.json.registries` de cada proyecto que pinee.
6. **Criterio del roadmap:** repetir 2-4 en una segunda máquina limpia sin clone del monorepo.

## Fuera de alcance (del spec)

CI/CD de publishing, Windows (WS-7), idioma (WS-7), flujo de equipo (WS-5), Antigravity (WS-6), scope/org npm.
