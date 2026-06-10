# WS-3 — Versionado real (releases + pinning + canal estable) Implementation Plan
<!-- awm-qa-complete: 2026-06-10 -->
<!-- awm-retro-complete: 2026-06-10 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El contenido AWM se versiona con tags semver: `awm update` checkoutea el último tag (canal estable) o un pin de máquina; `awm sync` verifica el pin del proyecto y falla en mismatch.

**Architecture:** Resolver sin estado (`core/versioning.ts`) — git es la única fuente de verdad (`git describe`). `syncRegistry`/`syncAdditionalRegistries` pasan de `pull` ciego a `fetch --tags` + `checkout <ref resuelto>`. Pins de máquina en `preferences.json` (comandos `awm pin`/`awm unpin`); pin de proyecto en `.awm/profile.json` campo `registries`, verificado por `awm sync` (gate duro, exit 1).

**Tech Stack:** TypeScript (CLI en `cli/`), Commander, simple-git, Jest. Spec: [2026-06-10-ws3-versioning-design.md](2026-06-10-ws3-versioning-design.md).

**Regla de testing (CONSTITUTION — no negociable):** ningún test toca el `~/.awm` real. Dual-tmpdir (`tmpHome` + `tmpWork`), `process.env.HOME` y `process.env.AWM_HOME` sobreescritos en `beforeEach`, `jest.resetModules()` + `require()` tardío de los módulos bajo test (las constantes module-level como `AWM_HOME` se evalúan al require). Fixtures git con `git init` local, sin red. Patrón de referencia: `cli/tests/commands/registry/add.test.ts`.

**Comandos:** todos los `npm test` / `npx tsc` se corren desde `cli/`.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/versioning.ts` (crear) | Resolver de refs por tags semver + versión actual + opts de máquina desde preferences |
| `cli/src/core/registry.ts` (modificar) | `syncRegistry` versionado (fetch + checkout, devuelve `ResolvedRef`) |
| `cli/src/core/registries.ts` (modificar) | `syncAdditionalRegistries` versionado, resultado con campo `version` |
| `cli/src/utils/config.ts` (modificar) | Campos opcionales `channel` y `pins` en `AwmPreferences` |
| `cli/src/commands/pin.ts` (crear) | Comandos `awm pin` / `awm unpin` (editores de preferences) |
| `cli/src/core/profile.ts` (modificar) | Campo opcional `registries` en el profile, validado |
| `cli/src/core/profile-pins.ts` (crear) | `verifyProjectPins` — gate de sync (módulo aparte para evitar ciclo registry↔versioning) |
| `cli/src/index.ts` (modificar) | Wiring de call-sites, prints de versión en update, gate en sync, registro de pin/unpin |
| `cli/src/core/init/steps.ts` (modificar) | Call-site de `syncRegistry` en `defaultActions.syncCache` |

---

### Task 1: Resolver de versiones — `core/versioning.ts`

**Files:**
- Create: `cli/src/core/versioning.ts`
- Modify: `cli/src/utils/config.ts:7-13` (interface `AwmPreferences`)
- Test: `cli/tests/core/versioning.test.ts`

- [ ] **Step 1: Agregar campos a `AwmPreferences`**

En `cli/src/utils/config.ts`, reemplazar la interface por:

```typescript
export interface AwmPreferences {
    defaultAgent: AgentTarget;
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
    /** Remote del registry base (override de DEFAULT_REMOTE). Opcional — WS-2. */
    baseRemote?: string;
    /** Canal de updates: 'stable' (último tag, default si ausente) | 'dev' (HEAD). Opcional — WS-3. */
    channel?: 'stable' | 'dev';
    /** Pins de versión por registry; clave reservada 'base'. Valores "X.Y.Z" sin prefijo v. Opcional — WS-3. */
    pins?: Record<string, string>;
}
```

- [ ] **Step 2: Escribir los tests del resolver (fallan: el módulo no existe)**

Crear `cli/tests/core/versioning.test.ts`:

```typescript
// cli/tests/core/versioning.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

/** Repo fuente con un commit inicial y un commit+tag por cada versión dada (en orden). */
function makeTaggedRepo(base: string, name: string, versions: string[]): string {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    GIT(dir, 'init -q -b main');
    fs.writeFileSync(path.join(dir, 'VERSION'), 'init');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    for (const v of versions) {
        fs.writeFileSync(path.join(dir, 'VERSION'), v);
        GIT(dir, 'add -A');
        GIT(dir, `commit -qm ${v}`);
        GIT(dir, `tag v${v}`);
    }
    return dir;
}

function cloneOf(source: string, base: string, name: string): string {
    const dir = path.join(base, name);
    GIT(base, `clone -q ${source} ${name}`);
    return dir;
}

describe('versioning core', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ver-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ver-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    describe('resolveTargetRef', () => {
        it('stable sin pin → último tag con orden semver numérico (v1.10.0 > v1.9.0)', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.9.0', '1.10.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'tag', ref: 'v1.10.0', version: '1.10.0' });
        });

        it('pin exacto gana, con y sin prefijo v', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0', '1.1.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            expect(await resolveTargetRef(clone, { pin: '1.0.0', channel: 'stable' }))
                .toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
            expect(await resolveTargetRef(clone, { pin: 'v1.0.0', channel: 'stable' }))
                .toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        });

        it('pin inexistente → error que lista las versiones disponibles', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            await expect(resolveTargetRef(clone, { pin: '9.9.9', channel: 'stable' }))
                .rejects.toThrow(/v9\.9\.9.*v1\.0\.0/s);
        });

        it('sin tags + stable → head-fallback al default branch', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', []);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'head-fallback', ref: 'main' });
        });

        it('canal dev → head del default branch aunque haya tags', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'dev' });
            expect(r).toEqual({ kind: 'head', ref: 'main' });
        });

        it('tags no semver se ignoran', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            GIT(source, 'tag latest');
            GIT(source, 'tag v2.0');
            GIT(source, 'tag release-3.0.0');
            const clone = cloneOf(source, tmpWork, 'clone');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        });

        it('hace fetch: ve tags creados en el remote después del clone', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            // tag nuevo en el remote, post-clone
            fs.writeFileSync(path.join(source, 'VERSION'), '1.1.0');
            GIT(source, 'add -A');
            GIT(source, 'commit -qm 1.1.0');
            GIT(source, 'tag v1.1.0');
            const { resolveTargetRef } = require('../../src/core/versioning');
            const r = await resolveTargetRef(clone, { channel: 'stable' });
            expect(r).toEqual({ kind: 'tag', ref: 'v1.1.0', version: '1.1.0' });
        });
    });

    describe('currentVersion', () => {
        it('en checkout exacto de un tag semver → versión sin prefijo v', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.2.0']);
            const clone = cloneOf(source, tmpWork, 'clone');
            GIT(clone, 'checkout -q v1.2.0');
            const { currentVersion } = require('../../src/core/versioning');
            expect(await currentVersion(clone)).toBe('1.2.0');
        });

        it('siguiendo un branch (sin tag exacto en HEAD) → null', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
            // commit posterior al tag para que HEAD no coincida con ningún tag
            fs.writeFileSync(path.join(source, 'VERSION'), 'post');
            GIT(source, 'add -A');
            GIT(source, 'commit -qm post');
            const clone = cloneOf(source, tmpWork, 'clone');
            const { currentVersion } = require('../../src/core/versioning');
            expect(await currentVersion(clone)).toBeNull();
        });

        it('tag exacto pero no semver → null', async () => {
            const source = makeTaggedRepo(tmpWork, 'src', []);
            GIT(source, 'tag release-1');
            const clone = cloneOf(source, tmpWork, 'clone');
            GIT(clone, 'checkout -q release-1');
            const { currentVersion } = require('../../src/core/versioning');
            expect(await currentVersion(clone)).toBeNull();
        });
    });

    describe('machineVersionOpts', () => {
        it('sin preferences → channel stable, sin pin', () => {
            const { machineVersionOpts } = require('../../src/core/versioning');
            expect(machineVersionOpts('base')).toEqual({ pin: undefined, channel: 'stable' });
        });

        it('lee channel dev y pin por nombre desde preferences', () => {
            const awmDir = path.join(tmpHome, '.awm');
            fs.mkdirSync(awmDir, { recursive: true });
            fs.writeFileSync(
                path.join(awmDir, 'preferences.json'),
                JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', channel: 'dev', pins: { base: '1.2.0', equipo: '0.3.0' } })
            );
            const { machineVersionOpts } = require('../../src/core/versioning');
            expect(machineVersionOpts('base')).toEqual({ pin: '1.2.0', channel: 'dev' });
            expect(machineVersionOpts('equipo')).toEqual({ pin: '0.3.0', channel: 'dev' });
            expect(machineVersionOpts('otro')).toEqual({ pin: undefined, channel: 'dev' });
        });

        it('preferences corruptas → defaults (stable, sin pin)', () => {
            const awmDir = path.join(tmpHome, '.awm');
            fs.mkdirSync(awmDir, { recursive: true });
            fs.writeFileSync(path.join(awmDir, 'preferences.json'), '{not json');
            const { machineVersionOpts } = require('../../src/core/versioning');
            expect(machineVersionOpts('base')).toEqual({ pin: undefined, channel: 'stable' });
        });
    });
});
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `npm test -- tests/core/versioning.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/versioning'`

- [ ] **Step 4: Implementar `cli/src/core/versioning.ts`**

```typescript
// src/core/versioning.ts
//
// Resolver de versiones por tags semver — WS-3. Sin estado propio: git es la
// única fuente de verdad (la versión vigente se deriva de `git describe`).
import simpleGit, { SimpleGit } from 'simple-git';
import { getPreferences } from '../utils/config';

export type Channel = 'stable' | 'dev';

export type ResolvedRef =
    | { kind: 'tag'; ref: string; version: string }   // ref = "vX.Y.Z", version sin prefijo
    | { kind: 'head'; ref: string }                    // canal dev — ref = default branch
    | { kind: 'head-fallback'; ref: string };          // stable sin tags — el caller avisa

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export function normalizePin(pin: string): string {
    return pin.replace(/^v/, '');
}

function semverKey(tag: string): [number, number, number] {
    const m = TAG_RE.exec(tag)!;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bySemverAsc(a: string, b: string): number {
    const [a1, a2, a3] = semverKey(a);
    const [b1, b2, b3] = semverKey(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
}

async function defaultBranch(git: SimpleGit): Promise<string> {
    try {
        const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
        const name = ref.split('/').slice(1).join('/');
        if (name) return name;
    } catch {
        // origin/HEAD puede no estar seteado — probar candidatos
    }
    for (const cand of ['main', 'master']) {
        try {
            await git.raw(['rev-parse', '--verify', `origin/${cand}`]);
            return cand;
        } catch {
            // siguiente candidato
        }
    }
    return 'main';
}

/** Tags semver vX.Y.Z del repo, orden ascendente. Hace fetch --tags --prune primero. */
async function fetchVersionTags(git: SimpleGit): Promise<string[]> {
    await git.raw(['fetch', '--tags', '--prune', 'origin']);
    const tags = (await git.tags()).all.filter((t) => TAG_RE.test(t));
    return tags.sort(bySemverAsc);
}

/**
 * Resuelve a qué ref debe quedar checkouteado un registry clonado:
 * pin declarado > último tag semver (canal stable) > HEAD (canal dev o repo sin tags).
 */
export async function resolveTargetRef(
    repoDir: string,
    opts: { pin?: string; channel: Channel }
): Promise<ResolvedRef> {
    const git = simpleGit(repoDir);
    const tags = await fetchVersionTags(git);

    if (opts.pin) {
        const want = `v${normalizePin(opts.pin)}`;
        if (!tags.includes(want)) {
            const available = tags.length > 0
                ? `available versions: ${tags.join(', ')}`
                : 'the registry has no version tags';
            throw new Error(`Pinned version ${want} not found in ${repoDir} — ${available}`);
        }
        return { kind: 'tag', ref: want, version: normalizePin(opts.pin) };
    }

    const branch = await defaultBranch(git);
    if (opts.channel === 'dev') return { kind: 'head', ref: branch };
    if (tags.length === 0) return { kind: 'head-fallback', ref: branch };

    const latest = tags[tags.length - 1];
    return { kind: 'tag', ref: latest, version: latest.slice(1) };
}

/** Versión checkouteada actual ("X.Y.Z") si HEAD coincide exactamente con un tag semver; null si sigue un branch. */
export async function currentVersion(repoDir: string): Promise<string | null> {
    try {
        const out = (await simpleGit(repoDir).raw(['describe', '--tags', '--exact-match', 'HEAD'])).trim();
        return TAG_RE.test(out) ? out.slice(1) : null;
    } catch {
        return null;
    }
}

/** Opts de versionado de la máquina para un registry ('base' reservado), desde preferences.
 *  Preferences ilegibles → defaults (stable, sin pin) — patrón de resolveBaseRemoteInfo. */
export function machineVersionOpts(registryName: string): { pin?: string; channel: Channel } {
    try {
        const prefs = getPreferences();
        const channel: Channel = prefs.channel === 'dev' ? 'dev' : 'stable';
        const pin = prefs.pins && typeof prefs.pins[registryName] === 'string'
            ? prefs.pins[registryName]
            : undefined;
        return { pin, channel };
    } catch {
        return { pin: undefined, channel: 'stable' };
    }
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npm test -- tests/core/versioning.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 6: Typecheck y commit**

```bash
npx tsc --noEmit
git add src/core/versioning.ts src/utils/config.ts tests/core/versioning.test.ts
git commit -m "feat(ws3): resolver de versiones por tags semver (resolveTargetRef, currentVersion, machineVersionOpts)"
```

---

### Task 2: `syncRegistry` versionado

**Files:**
- Modify: `cli/src/core/registry.ts:36-49` (función `syncRegistry`)
- Modify: `cli/tests/core/registry.test.ts:1-63` (eliminar describe mockeado `Registry Manager`)
- Test: `cli/tests/core/registry-versioned-sync.test.ts` (crear)

**Contexto:** el describe `Registry Manager` de `registry.test.ts` mockea simple-git con solo `clone/pull/reset` — incompatible con la nueva mecánica (fetch/checkout/tags). Se reemplaza por tests de fixture git real. El describe `buildCli` del mismo archivo se conserva intacto (sus mocks de fs/spawnSync no estorban).

- [ ] **Step 1: Escribir los tests de fixture (fallan: syncRegistry aún hace pull)**

Crear `cli/tests/core/registry-versioned-sync.test.ts`:

```typescript
// cli/tests/core/registry-versioned-sync.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

function makeTaggedRepo(base: string, name: string, versions: string[]): string {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    GIT(dir, 'init -q -b main');
    fs.writeFileSync(path.join(dir, 'VERSION'), 'init');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    for (const v of versions) {
        fs.writeFileSync(path.join(dir, 'VERSION'), v);
        GIT(dir, 'add -A');
        GIT(dir, `commit -qm ${v}`);
        GIT(dir, `tag v${v}`);
    }
    return dir;
}

function addRelease(source: string, version: string): void {
    fs.writeFileSync(path.join(source, 'VERSION'), version);
    GIT(source, 'add -A');
    GIT(source, `commit -qm ${version}`);
    GIT(source, `tag v${version}`);
}

describe('syncRegistry versionado (fixtures git locales)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regver-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regver-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    const registryVersionFile = () => path.join(tmpHome, '.awm/cli-source/VERSION');

    it('clone fresco queda checkouteado en el último tag (no en HEAD)', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        // commit post-tag: HEAD del remote va más allá del último release
        fs.writeFileSync(path.join(source, 'VERSION'), 'unreleased');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm unreleased');

        const { syncRegistry } = require('../../src/core/registry');
        const resolved = await syncRegistry(source, { channel: 'stable' });

        expect(resolved).toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.0.0');
    });

    it('clone existente transiciona al tag nuevo tras un release en el remote', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' });

        addRelease(source, '1.1.0');
        const resolved = await syncRegistry(source, { channel: 'stable' });

        expect(resolved).toEqual({ kind: 'tag', ref: 'v1.1.0', version: '1.1.0' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.1.0');
    });

    it('rollback: pin a un tag anterior vuelve el contenido a esa versión', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0', '1.1.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.1.0');

        const resolved = await syncRegistry(source, { pin: '1.0.0', channel: 'stable' });

        expect(resolved).toEqual({ kind: 'tag', ref: 'v1.0.0', version: '1.0.0' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('1.0.0');
    });

    it('canal dev sigue HEAD del branch y recibe commits nuevos', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const first = await syncRegistry(source, { channel: 'dev' });
        expect(first).toEqual({ kind: 'head', ref: 'main' });

        fs.writeFileSync(path.join(source, 'VERSION'), 'head-2');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm head-2');
        await syncRegistry(source, { channel: 'dev' });

        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('head-2');
    });

    it('repo sin tags en canal stable → head-fallback y sigue HEAD', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', []);
        const { syncRegistry } = require('../../src/core/registry');
        const resolved = await syncRegistry(source, { channel: 'stable' });

        expect(resolved).toEqual({ kind: 'head-fallback', ref: 'main' });
        expect(fs.readFileSync(registryVersionFile(), 'utf-8')).toBe('init');
    });

    it('sin opts (callers legacy) → comportamiento stable por default', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['2.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const resolved = await syncRegistry(source);
        expect(resolved).toEqual({ kind: 'tag', ref: 'v2.0.0', version: '2.0.0' });
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test -- tests/core/registry-versioned-sync.test.ts`
Expected: FAIL — el clone fresco queda en HEAD (`unreleased`), no en `v1.0.0`; `resolved` es `undefined` (syncRegistry devuelve void)

- [ ] **Step 3: Reescribir `syncRegistry` en `cli/src/core/registry.ts`**

Reemplazar la función `syncRegistry` (líneas 31-49) y actualizar el import de versioning:

```typescript
import { resolveTargetRef, type ResolvedRef, type Channel } from "./versioning";

/**
 * Sincroniza el clone local del registry base y lo deja checkouteado en el
 * ref resuelto (pin > último tag semver > HEAD según canal) — WS-3.
 * - Clone fresco si no existe; si existe, reset --hard + fetch + checkout.
 * - Tags dejan el clone en detached HEAD (esperado); head/head-fallback
 *   checkoutean el branch y pullean.
 */
export async function syncRegistry(
  remoteUrl?: string,
  opts?: { pin?: string; channel?: Channel }
): Promise<ResolvedRef> {
  const remote = remoteUrl ?? DEFAULT_REMOTE;
  const { pin, channel = 'stable' } = opts ?? {};

  if (!fs.existsSync(REGISTRY_DIR)) {
    const parentDir = path.dirname(REGISTRY_DIR);
    fs.mkdirSync(parentDir, { recursive: true });
    await simpleGit().clone(remote, REGISTRY_DIR);
  } else {
    await simpleGit(REGISTRY_DIR).reset(['--hard']);
  }

  const repoGit = simpleGit(REGISTRY_DIR);
  const resolved = await resolveTargetRef(REGISTRY_DIR, { pin, channel });
  await repoGit.checkout(resolved.ref);
  if (resolved.kind !== 'tag') {
    await repoGit.pull('origin', resolved.ref);
  }
  return resolved;
}
```

Nota: la variable `const git = simpleGit();` del cuerpo viejo desaparece (el clone usa `simpleGit()` inline). `resolveTargetRef` ya hace el `fetch --tags --prune`.

- [ ] **Step 4: Eliminar el describe mockeado `Registry Manager` de `cli/tests/core/registry.test.ts`**

Borrar las líneas 1-63 (imports de simple-git mockeado + describe `Registry Manager`) dejando solo el describe `buildCli` y sus imports necesarios. El archivo queda empezando así:

```typescript
import { spawnSync } from 'child_process';

jest.mock('child_process');

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe('buildCli', () => {
```

(El resto del describe `buildCli` queda igual — ya usa `require('../../src/core/registry')` tardío, así que no necesita los mocks de fs/simple-git.)

- [ ] **Step 5: Correr ambos archivos de test**

Run: `npm test -- tests/core/registry-versioned-sync.test.ts tests/core/registry.test.ts`
Expected: PASS (6 + 6 tests)

- [ ] **Step 6: Typecheck y commit**

```bash
npx tsc --noEmit
git add src/core/registry.ts tests/core/registry.test.ts tests/core/registry-versioned-sync.test.ts
git commit -m "feat(ws3): syncRegistry versionado — fetch + checkout del ref resuelto, devuelve ResolvedRef"
```

---

### Task 3: Wiring de los 5 call-sites + prints de versión en `awm update`

**Files:**
- Modify: `cli/src/index.ts:10` (import), `:72` (add), `:333-334` (update), `:423` (sync), `:466` (list)
- Modify: `cli/src/core/init/steps.ts:9,31`

**Regla CONSTITUTION § Implementación:** los call-sites están enumerados con grep en el spec; los CINCO deben pasar opts. Verificación al final con grep.

- [ ] **Step 1: Import en `cli/src/index.ts`**

En la línea 10-15, agregar el import de versioning:

```typescript
import { machineVersionOpts } from './core/versioning';
```

- [ ] **Step 2: Call-sites de `add` (línea 72), `sync` (línea 423) y `list` (línea 466)**

Reemplazar en los tres lugares:

```typescript
await syncRegistry(resolveBaseRemote());
```

por:

```typescript
await syncRegistry(resolveBaseRemote(), machineVersionOpts('base'));
```

- [ ] **Step 3: Call-site de `update` (línea 333) — capturar y reportar la versión**

Reemplazar:

```typescript
          await syncRegistry(resolveBaseRemote());
          s.stop('Registry updated successfully.');
```

por:

```typescript
          const resolved = await syncRegistry(resolveBaseRemote(), machineVersionOpts('base'));
          s.stop('Registry updated successfully.');
          if (resolved.kind === 'tag') {
              console.log(pc.green(`  ✓ Registry base @ v${resolved.version}`));
          } else if (resolved.kind === 'head') {
              console.log(pc.dim(`  Registry base @ ${resolved.ref} (canal dev)`));
          } else {
              console.log(pc.yellow(`  ⚠ Registry base sin tags — siguiendo HEAD (taggeá v1.0.0 para activar el canal estable)`));
          }
```

- [ ] **Step 4: Call-site de `init` — `cli/src/core/init/steps.ts`**

Línea 9, reemplazar el import:

```typescript
import { syncRegistry, resolveBaseRemote } from '../registry';
import { machineVersionOpts } from '../versioning';
```

Línea 31 (en `defaultActions`), reemplazar:

```typescript
    syncCache: async () => { await syncRegistry(resolveBaseRemote()); },
```

por:

```typescript
    syncCache: async () => { await syncRegistry(resolveBaseRemote(), machineVersionOpts('base')); },
```

- [ ] **Step 5: Verificar wiring completo con grep**

Run: `grep -rn "syncRegistry(" src/ --include="*.ts" | grep -v "export async function"`
Expected: 5 líneas, **todas** con `machineVersionOpts('base')` como segundo argumento.

- [ ] **Step 6: Typecheck + suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (la suite completa sigue verde — los handlers no tienen tests directos, pero el typecheck valida las firmas)

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/core/init/steps.ts
git commit -m "feat(ws3): wiring de versionado en los 5 call-sites de syncRegistry + reporte de versión en awm update"
```

---

### Task 4: `syncAdditionalRegistries` versionado

**Files:**
- Modify: `cli/src/core/registries.ts:89-114` (tipo + función)
- Modify: `cli/src/index.ts:348-354` (print de versión por registry adicional)
- Modify: `cli/tests/core/registries-sync.test.ts:56,76` (aserciones ganan campo `version`)
- Test: agregar 2 tests a `cli/tests/core/registries-sync.test.ts`

- [ ] **Step 1: Actualizar aserciones existentes y agregar tests de versionado (fallan)**

En `cli/tests/core/registries-sync.test.ts`:

Línea 56, reemplazar:

```typescript
        expect(results).toEqual([{ name: 'personal', action: 'recloned' }]);
```

por:

```typescript
        expect(results).toEqual([{ name: 'personal', action: 'recloned', version: 'HEAD' }]);
```

Línea 76, reemplazar:

```typescript
        expect(results[0]).toEqual({ name: 'personal', action: 'pulled' });
```

por:

```typescript
        expect(results[0]).toEqual({ name: 'personal', action: 'pulled', version: 'HEAD' });
```

Y agregar al final del describe (antes del cierre):

```typescript
    it('registry con tags queda en el último tag y reporta la versión', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        // commit post-tag: HEAD va más allá del release
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: unreleased\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm unreleased');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);

        const results = await m.syncAdditionalRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned', version: 'v1.0.0' }]);
        const synced = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(synced).toContain('test skill'); // contenido del tag, no del HEAD
    });

    it('pin por nombre en preferences gana sobre el último tag', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v2');
        GIT(source, 'tag v1.1.0');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', pins: { personal: '1.0.0' } })
        );

        const results = await m.syncAdditionalRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned', version: 'v1.0.0' }]);
    });
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test -- tests/core/registries-sync.test.ts`
Expected: FAIL — los resultados no tienen campo `version`; el registry con tags queda en HEAD

- [ ] **Step 3: Implementar en `cli/src/core/registries.ts`**

Agregar el import (línea 6):

```typescript
import { resolveTargetRef, machineVersionOpts } from './versioning';
```

Reemplazar el tipo y la función (líneas 89-114):

```typescript
export type RegistrySyncResult =
    | { name: string; action: 'pulled' | 'recloned'; version: string }  // version: 'vX.Y.Z' | 'HEAD'
    | { name: string; action: 'error'; error: string };

/** Sincroniza cada registry adicional al ref resuelto (pin > último tag > HEAD);
 *  re-clona si falta el dir. Errores por-registry NO fatales: se reportan en el resultado. */
export async function syncAdditionalRegistries(): Promise<RegistrySyncResult[]> {
    const results: RegistrySyncResult[] = [];
    for (const reg of listRegistries()) {
        try {
            let action: 'pulled' | 'recloned';
            if (!fs.existsSync(reg.contentRoot)) {
                fs.mkdirSync(REGISTRIES_DIR, { recursive: true });
                await simpleGit().clone(reg.remote, reg.contentRoot);
                action = 'recloned';
            } else {
                await simpleGit(reg.contentRoot).reset(['--hard']);
                action = 'pulled';
            }
            const git = simpleGit(reg.contentRoot);
            const resolved = await resolveTargetRef(reg.contentRoot, machineVersionOpts(reg.name));
            await git.checkout(resolved.ref);
            if (resolved.kind !== 'tag') await git.pull('origin', resolved.ref);
            results.push({
                name: reg.name,
                action,
                version: resolved.kind === 'tag' ? `v${resolved.version}` : 'HEAD',
            });
        } catch (e) {
            results.push({ name: reg.name, action: 'error', error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}
```

- [ ] **Step 4: Print de versión en el handler de update (`cli/src/index.ts:348-354`)**

Reemplazar:

```typescript
              for (const r of await syncAdditionalRegistries()) {
                  if (r.action === 'error') {
                      console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
                  } else {
                      console.log(pc.green(`  ✓ Registry ${r.name} ${r.action === 'pulled' ? 'updated' : 're-cloned'}`));
                  }
              }
```

por:

```typescript
              for (const r of await syncAdditionalRegistries()) {
                  if (r.action === 'error') {
                      console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
                  } else {
                      console.log(pc.green(`  ✓ Registry ${r.name} ${r.action === 'pulled' ? 'updated' : 're-cloned'} @ ${r.version}`));
                  }
              }
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npm test -- tests/core/registries-sync.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Typecheck, suite completa y commit**

```bash
npx tsc --noEmit && npm test
git add src/core/registries.ts src/index.ts tests/core/registries-sync.test.ts
git commit -m "feat(ws3): syncAdditionalRegistries versionado — checkout por registry con pin de preferences"
```

---

### Task 5: Comandos `awm pin` / `awm unpin`

**Files:**
- Create: `cli/src/commands/pin.ts`
- Modify: `cli/src/index.ts` (registro del comando, junto a los otros `register*Command`)
- Test: `cli/tests/commands/pin.test.ts`

- [ ] **Step 1: Escribir los tests (fallan: el módulo no existe)**

Crear `cli/tests/commands/pin.test.ts`:

```typescript
// cli/tests/commands/pin.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('pin/unpin (editores de preferences)', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pin-home-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    const readPrefs = () =>
        JSON.parse(fs.readFileSync(path.join(tmpHome, '.awm/preferences.json'), 'utf-8'));

    it('setPin escribe pins.base normalizado (acepta prefijo v)', () => {
        const { setPin } = require('../../src/commands/pin');
        setPin('base', 'v1.2.0');
        expect(readPrefs().pins).toEqual({ base: '1.2.0' });
    });

    it('setPin acepta un registry adicional configurado', () => {
        const { writeRegistriesConfig } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'equipo', remote: '/tmp/x' }]);
        const { setPin } = require('../../src/commands/pin');
        setPin('equipo', '0.3.0');
        expect(readPrefs().pins).toEqual({ equipo: '0.3.0' });
    });

    it('setPin rechaza un registry desconocido listando los válidos', () => {
        const { setPin } = require('../../src/commands/pin');
        expect(() => setPin('nope', '1.0.0')).toThrow(/nope.*base/s);
    });

    it('setPin rechaza versión malformada', () => {
        const { setPin } = require('../../src/commands/pin');
        expect(() => setPin('base', '1.2')).toThrow(/X\.Y\.Z/);
        expect(() => setPin('base', 'latest')).toThrow(/X\.Y\.Z/);
    });

    it('removePin borra la entrada y reporta si existía', () => {
        const { setPin, removePin } = require('../../src/commands/pin');
        setPin('base', '1.2.0');
        expect(removePin('base')).toBe(true);
        expect(readPrefs().pins).toEqual({});
        expect(removePin('base')).toBe(false);
    });

    it('setPin preserva las demás preferencias y pins existentes', () => {
        const { setPin } = require('../../src/commands/pin');
        setPin('base', '1.0.0');
        const { writeRegistriesConfig } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'equipo', remote: '/tmp/x' }]);
        setPin('equipo', '2.0.0');
        const prefs = readPrefs();
        expect(prefs.pins).toEqual({ base: '1.0.0', equipo: '2.0.0' });
        expect(prefs.defaultAgent).toBeDefined();
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test -- tests/commands/pin.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/pin'`

- [ ] **Step 3: Implementar `cli/src/commands/pin.ts`**

```typescript
// src/commands/pin.ts
//
// awm pin <registry|base> <version> / awm unpin <registry|base> — editores
// triviales de preferences.pins. NO hacen checkout: eso es de `awm update`.
import { Command } from 'commander';
import pc from 'picocolors';
import { getPreferences, savePreferences } from '../utils/config';
import { readRegistriesConfig } from '../core/registries';
import { normalizePin } from '../core/versioning';

const VERSION_RE = /^v?\d+\.\d+\.\d+$/;

function knownRegistryNames(): string[] {
    return ['base', ...readRegistriesConfig().map((r) => r.name)];
}

function assertKnownRegistry(name: string): void {
    const known = knownRegistryNames();
    if (!known.includes(name)) {
        throw new Error(`Unknown registry "${name}". Valid names: ${known.join(', ')}.`);
    }
}

/** Valida y persiste pins[name] = version (normalizada sin prefijo v). */
export function setPin(name: string, version: string): string {
    assertKnownRegistry(name);
    if (!VERSION_RE.test(version)) {
        throw new Error(`Invalid version "${version}" — expected X.Y.Z (e.g. 1.2.0).`);
    }
    const normalized = normalizePin(version);
    const prefs = getPreferences();
    prefs.pins = { ...(prefs.pins ?? {}), [name]: normalized };
    savePreferences(prefs);
    return normalized;
}

/** Borra pins[name]; devuelve true si existía. */
export function removePin(name: string): boolean {
    assertKnownRegistry(name);
    const prefs = getPreferences();
    if (!prefs.pins || !(name in prefs.pins)) return false;
    delete prefs.pins[name];
    savePreferences(prefs);
    return true;
}

export function registerPinCommands(program: Command): void {
    program.command('pin <registry> <version>')
        .description("Pin a registry ('base' or an additional registry name) to a version tag, e.g. awm pin base 1.2.0")
        .action((registry: string, version: string) => {
            try {
                const normalized = setPin(registry, version);
                console.log(pc.green(`✓ ${registry} pinned to v${normalized}.`) + pc.dim(' Run `awm update` to apply.'));
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });

    program.command('unpin <registry>')
        .description('Remove the version pin of a registry (it returns to the latest tag on the next update)')
        .action((registry: string) => {
            try {
                const removed = removePin(registry);
                if (removed) {
                    console.log(pc.green(`✓ ${registry} unpinned.`) + pc.dim(' Run `awm update` to move to the latest tag.'));
                } else {
                    console.log(pc.yellow(`${registry} had no pin — nothing to do.`));
                }
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });
}
```

- [ ] **Step 4: Registrar en `cli/src/index.ts`**

Junto a los otros imports de commands (línea ~29):

```typescript
import { registerPinCommands } from './commands/pin';
```

Y junto a los otros `register*Command(program)` (buscar `registerRegistryCommand(program)` cerca del final del archivo):

```typescript
registerPinCommands(program);
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `npm test -- tests/commands/pin.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Typecheck y commit**

```bash
npx tsc --noEmit
git add src/commands/pin.ts src/index.ts tests/commands/pin.test.ts
git commit -m "feat(ws3): comandos awm pin / awm unpin (pins de máquina en preferences)"
```

---

### Task 6: Campo `registries` en el profile del proyecto

**Files:**
- Modify: `cli/src/core/profile.ts:8-55` (interface + `readProfile`)
- Test: `cli/tests/core/profile-registries.test.ts` (crear)

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `cli/tests/core/profile-registries.test.ts`:

```typescript
// cli/tests/core/profile-registries.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('profile.registries (pin de proyecto)', () => {
    let tmpProj: string;

    beforeEach(() => {
        tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-prof-'));
        fs.mkdirSync(path.join(tmpProj, '.awm'), { recursive: true });
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpProj, { recursive: true, force: true });
    });

    const writeRaw = (obj: unknown) =>
        fs.writeFileSync(path.join(tmpProj, '.awm/profile.json'), JSON.stringify(obj));

    it('lee registries válido y normaliza el prefijo v', () => {
        writeRaw({ extensions: [], registries: { base: 'v1.2.0', equipo: '0.3.0' } });
        const { readProfile } = require('../../src/core/profile');
        expect(readProfile(tmpProj).registries).toEqual({ base: '1.2.0', equipo: '0.3.0' });
    });

    it('profile sin registries → campo ausente (sin verificación)', () => {
        writeRaw({ extensions: ['x'] });
        const { readProfile } = require('../../src/core/profile');
        const p = readProfile(tmpProj);
        expect(p.extensions).toEqual(['x']);
        expect(p.registries).toBeUndefined();
    });

    it('registries no-objeto → error explícito con path', () => {
        writeRaw({ extensions: [], registries: ['base'] });
        const { readProfile } = require('../../src/core/profile');
        expect(() => readProfile(tmpProj)).toThrow(/profile.*registries/s);
    });

    it('versión malformada → error explícito que nombra la clave', () => {
        writeRaw({ extensions: [], registries: { base: 'latest' } });
        const { readProfile } = require('../../src/core/profile');
        expect(() => readProfile(tmpProj)).toThrow(/base.*latest/s);
    });

    it('writeProfile + readProfile round-trip preserva registries', () => {
        const { readProfile, writeProfile } = require('../../src/core/profile');
        writeProfile(tmpProj, { extensions: ['a'], registries: { base: '1.0.0' } });
        expect(readProfile(tmpProj)).toEqual({ extensions: ['a'], registries: { base: '1.0.0' } });
    });

    it('addExtension preserva registries existente', () => {
        const { readProfile, writeProfile, addExtension } = require('../../src/core/profile');
        writeProfile(tmpProj, { extensions: [], registries: { base: '1.0.0' } });
        addExtension(tmpProj, 'nuevo');
        expect(readProfile(tmpProj)).toEqual({ extensions: ['nuevo'], registries: { base: '1.0.0' } });
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test -- tests/core/profile-registries.test.ts`
Expected: FAIL — `registries` no existe en `ProjectProfile` ni en `readProfile`

- [ ] **Step 3: Implementar en `cli/src/core/profile.ts`**

Reemplazar la interface (líneas 8-10):

```typescript
export interface ProjectProfile {
    extensions: string[];
    /** Pin de versión por registry ('base' reservado). El pin del profile ES el lock del proyecto — WS-3. */
    registries?: Record<string, string>;
}
```

Reemplazar `readProfile` (líneas 43-55):

```typescript
const PIN_VERSION_RE = /^v?\d+\.\d+\.\d+$/;

export function readProfile(root: string): ProjectProfile {
    const file = profilePath(root);
    if (!fs.existsSync(file)) return { extensions: [] };
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        // JSON corrupto: comportamiento lenient histórico (perfil vacío)
        return { extensions: [] };
    }
    const exts = Array.isArray(raw.extensions)
        ? (raw.extensions as unknown[]).filter((e): e is string => typeof e === 'string')
        : [];
    const profile: ProjectProfile = { extensions: exts };

    // El pin de proyecto es un contrato de versionado: malformado → error explícito
    // (consistente con readRegistryManifest de WS-2), nunca silenciar.
    if (raw.registries !== undefined) {
        if (typeof raw.registries !== 'object' || raw.registries === null || Array.isArray(raw.registries)) {
            throw new Error(`Invalid profile at ${file}: "registries" must be an object of name → version`);
        }
        const registries: Record<string, string> = {};
        for (const [name, version] of Object.entries(raw.registries as Record<string, unknown>)) {
            if (typeof version !== 'string' || !PIN_VERSION_RE.test(version)) {
                throw new Error(
                    `Invalid profile at ${file}: registries["${name}"] must be "X.Y.Z", got ${JSON.stringify(version)}`
                );
            }
            registries[name] = version.replace(/^v/, '');
        }
        profile.registries = registries;
    }
    return profile;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test -- tests/core/profile-registries.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck, suite completa (otros tests usan readProfile) y commit**

```bash
npx tsc --noEmit && npm test
git add src/core/profile.ts tests/core/profile-registries.test.ts
git commit -m "feat(ws3): campo registries en .awm/profile.json — pin de proyecto validado"
```

---

### Task 7: Gate de versión en `awm sync` + criterio end-to-end del roadmap

**Files:**
- Create: `cli/src/core/profile-pins.ts`
- Modify: `cli/src/index.ts:408-430` (handler de `sync`)
- Test: `cli/tests/core/profile-pins.test.ts` (crear)

- [ ] **Step 1: Escribir los tests (fallan: el módulo no existe)**

Crear `cli/tests/core/profile-pins.test.ts`. Incluye el test end-to-end del criterio del roadmap (proyecto pineado NO recibe main hasta bump; rollback funciona):

```typescript
// cli/tests/core/profile-pins.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

function makeTaggedRepo(base: string, name: string, versions: string[]): string {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    GIT(dir, 'init -q -b main');
    fs.writeFileSync(path.join(dir, 'VERSION'), 'init');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    for (const v of versions) {
        fs.writeFileSync(path.join(dir, 'VERSION'), v);
        GIT(dir, 'add -A');
        GIT(dir, `commit -qm ${v}`);
        GIT(dir, `tag v${v}`);
    }
    return dir;
}

function addRelease(source: string, version: string): void {
    fs.writeFileSync(path.join(source, 'VERSION'), version);
    GIT(source, 'add -A');
    GIT(source, `commit -qm ${version}`);
    GIT(source, `tag v${version}`);
}

describe('verifyProjectPins (gate de awm sync)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pins-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pins-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('match: máquina en la versión pineada → sin failures', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' }); // queda en v1.0.0
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([]);
    });

    it('mismatch: la máquina avanzó más allá del pin → failure con actual y required', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' });
        addRelease(source, '1.1.0');
        await syncRegistry(source, { channel: 'stable' }); // máquina avanza a v1.1.0

        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([
            { name: 'base', required: '1.0.0', actual: '1.1.0', reason: 'mismatch' },
        ]);
    });

    it('registry pineado no configurado en la máquina → missing-registry', async () => {
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ equipo: '2.0.0' })).toEqual([
            { name: 'equipo', required: '2.0.0', actual: null, reason: 'missing-registry' },
        ]);
    });

    it('máquina siguiendo HEAD (sin tag) con pin declarado → mismatch con actual null', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', []);
        const { syncRegistry } = require('../../src/core/registry');
        await syncRegistry(source, { channel: 'stable' }); // head-fallback
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([
            { name: 'base', required: '1.0.0', actual: null, reason: 'mismatch' },
        ]);
    });

    it('CRITERIO ROADMAP end-to-end: pineado no recibe main hasta bump; rollback funciona', async () => {
        const source = makeTaggedRepo(tmpWork, 'src', ['1.0.0']);
        const { syncRegistry } = require('../../src/core/registry');
        const { verifyProjectPins } = require('../../src/core/profile-pins');
        const versionFile = path.join(tmpHome, '.awm/cli-source/VERSION');

        // proyecto pineado a 1.0.0, máquina en 1.0.0 → ok
        await syncRegistry(source, { channel: 'stable' });
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([]);

        // el remote avanza (release 1.1.0) y la máquina updatea → el proyecto pineado FALLA (no recibe el cambio en silencio)
        addRelease(source, '1.1.0');
        await syncRegistry(source, { channel: 'stable' });
        expect(fs.readFileSync(versionFile, 'utf-8')).toBe('1.1.0');
        expect((await verifyProjectPins({ base: '1.0.0' }))[0]?.reason).toBe('mismatch');

        // bump explícito del profile → pasa
        expect(await verifyProjectPins({ base: '1.1.0' })).toEqual([]);

        // rollback: pin de máquina a 1.0.0 → contenido vuelve y el proyecto pineado a 1.0.0 pasa
        await syncRegistry(source, { pin: '1.0.0', channel: 'stable' });
        expect(fs.readFileSync(versionFile, 'utf-8')).toBe('1.0.0');
        expect(await verifyProjectPins({ base: '1.0.0' })).toEqual([]);
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test -- tests/core/profile-pins.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/profile-pins'`

- [ ] **Step 3: Implementar `cli/src/core/profile-pins.ts`**

Módulo aparte (no en `versioning.ts`) para no crear el ciclo `registry.ts → versioning.ts → registry.ts`:

```typescript
// src/core/profile-pins.ts
//
// Gate de versión de `awm sync` — WS-3. Compara los pins del profile del
// proyecto (.awm/profile.json → registries) contra la versión checkouteada
// real de cada registry en la máquina.
import fs from 'fs';
import { REGISTRY_DIR } from './registry';
import { registryContentRoot } from './registries';
import { currentVersion, normalizePin } from './versioning';

export interface PinFailure {
    name: string;
    required: string;            // sin prefijo v
    actual: string | null;       // null = siguiendo branch / sin tag exacto
    reason: 'mismatch' | 'missing-registry';
}

/** Dir del clone de un registry pineable: 'base' → cli-source; otro → ~/.awm/registries/<name>. */
export function pinnedRepoDir(name: string): string {
    return name === 'base' ? REGISTRY_DIR : registryContentRoot(name);
}

/** Verifica cada pin del proyecto contra la máquina. Lista vacía = todo en orden. */
export async function verifyProjectPins(pins: Record<string, string>): Promise<PinFailure[]> {
    const failures: PinFailure[] = [];
    for (const [name, requiredRaw] of Object.entries(pins)) {
        const required = normalizePin(requiredRaw);
        const dir = pinnedRepoDir(name);
        if (!fs.existsSync(dir)) {
            failures.push({ name, required, actual: null, reason: 'missing-registry' });
            continue;
        }
        const actual = await currentVersion(dir);
        if (actual !== required) {
            failures.push({ name, required, actual, reason: 'mismatch' });
        }
    }
    return failures;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npm test -- tests/core/profile-pins.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wiring del gate en el handler de `sync` (`cli/src/index.ts`)**

Import junto a los de core:

```typescript
import { verifyProjectPins } from './core/profile-pins';
```

En el handler de `sync`: (a) el `readProfile` de la línea 414 ahora puede tirar (registries malformado) — envolverlo; (b) insertar el gate después del bloque que termina en `s.stop('Registry synced.')` (línea ~424) y antes de `const prefs = getPreferences();` (línea 431).

Reemplazar la línea 414:

```typescript
      const profile = readProfile(projectRoot);
```

por:

```typescript
      let profile;
      try {
          profile = readProfile(projectRoot);
      } catch (e: any) {
          console.error(pc.red(e.message));
          process.exit(1);
      }
```

Insertar después de `s.stop('Registry synced.')` / su bloque catch (línea ~429, antes de `const prefs = getPreferences();`):

```typescript
      // Gate de versión (WS-3): el pin del profile es el lock del proyecto.
      const pins = profile.registries ?? {};
      if (Object.keys(pins).length > 0) {
          const failures = await verifyProjectPins(pins);
          if (failures.length > 0) {
              for (const f of failures) {
                  if (f.reason === 'missing-registry') {
                      console.error(pc.red(`El proyecto requiere el registry "${f.name}" @ v${f.required}, pero no está configurado en esta máquina. Corré: awm registry add <remote>`));
                  } else {
                      console.error(pc.red(`La máquina tiene ${f.name} @ ${f.actual ? `v${f.actual}` : 'HEAD (sin tag)'} pero el proyecto requiere v${f.required}.`));
                      console.error(pc.red(`  Corré: awm pin ${f.name} ${f.required} && awm update`));
                  }
              }
              process.exit(1);
          }
      }
```

Nota: `awm sync` ya checkoutea el registry base con `machineVersionOpts('base')` (Task 3), así que si el pin de máquina coincide con el del proyecto, el gate pasa naturalmente tras correr el remedio.

- [ ] **Step 6: Typecheck, suite completa y commit**

```bash
npx tsc --noEmit && npm test
git add src/core/profile-pins.ts src/index.ts tests/core/profile-pins.test.ts
git commit -m "feat(ws3): gate de versión en awm sync — verifyProjectPins con exit 1 y remedio exacto"
```

---

### Task 8: Cierre — sensores, suite completa y roadmap

**Files:**
- Modify: `docs/plans/2026-06-09-distribution-roadmap.md` (checkbox WS-3 'Plan + ejecución' + tabla de estado, columna Plan)

- [ ] **Step 1: Suite completa + sensores**

Run (desde `cli/`): `npx tsc --noEmit && npm test`
Expected: PASS — ~580+ tests (552 previos + ~31 nuevos), 0 fallos.

Run (desde la raíz del repo): `awm sensors run`
Expected: sin hallazgos **nuevos** (`newCount: 0`). Los hallazgos preexistentes de `depcheck`/`security` (configs faltantes, anteriores a WS-2) no cuentan.

- [ ] **Step 2: Actualizar el roadmap (regla #3 — mismo PR que cierra el WS)**

En `docs/plans/2026-06-09-distribution-roadmap.md`, sección WS-3, marcar:

```markdown
- [x] Brainstorming + design (esquema de versiones, canales, formato de lockfile, migración de profiles existentes) → [2026-06-10-ws3-versioning-design.md](2026-06-10-ws3-versioning-design.md)
- [x] Plan + ejecución → [2026-06-10-ws3-versioning-plan.md](2026-06-10-ws3-versioning-plan.md)
```

Y en la tabla de estado de cierre, fila WS-3, columna "Plan ejecutado":

```markdown
| WS-3 | F-1 | [2026-06-10-ws3-versioning-plan.md](2026-06-10-ws3-versioning-plan.md) | ☐ |
```

(El checkbox de QA de la tabla y el de "Verificación" del WS quedan para `post-implementation-qa`.)

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-06-09-distribution-roadmap.md
git commit -m "docs(ws3): roadmap — plan ejecutado enlazado (cierre pendiente de QA)"
```

---

## Notas para el ejecutor

- **PROHIBIDO tocar `~/.awm` real** — ni en tests ni "para probar a mano". Verificación manual solo vía el ciclo `awm update` después del merge.
- Los fixtures usan `git init -q -b main` para fijar el nombre del branch (no depender del `init.defaultBranch` de la máquina).
- `resolveTargetRef` hace el `fetch` internamente — no agregar fetches duplicados en los callers.
- Si la suite revela algún test existente que asuma el shape viejo de `RegistrySyncResult` o el `pull` de `syncRegistry` más allá de los dos archivos ya contemplados (Tasks 2 y 4), actualizar la aserción al shape nuevo en el mismo task — no revertir el código.
- Ledger: los reviewers emiten `awm ledger add` por hallazgo/win (sus prompts se construyen desde los templates de subagent-driven-development).
