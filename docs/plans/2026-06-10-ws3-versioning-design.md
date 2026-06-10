# WS-3 — Versionado real: releases + pinning + canal estable (design)

**Fecha:** 2026-06-10
**Workstream:** WS-3 del roadmap de distribución ([2026-06-09-distribution-roadmap.md](2026-06-09-distribution-roadmap.md)), hallazgo F-1.
**Rama:** `feature/ws3-versioning`
**Estado:** aprobado en brainstorming (4 decisiones estructurales + enfoque A confirmados por el usuario).

---

## Problema (F-1)

Todo el contenido vive en `1.0.0` estático; `awm update` trae HEAD de main; los symlinks propagan cambios instantáneamente a todas las máquinas sin changelog, rollback ni ventana de adopción. `skills-lock.json` (raíz del repo) es metadata de procedencia de skills importadas de repos externos — **no** es un lockfile de instalación y este WS no lo toca.

## Decisiones estructurales (confirmadas)

1. **Pin por máquina.** Los symlinks globales apuntan a un único clone por registry; el checkout de ese clone es global por máquina. El pin de máquina vive en `preferences.json`. El pin de proyecto (en `.awm/profile.json`) declara qué versión requiere el proyecto y `awm sync` lo verifica contra la máquina.
2. **Releases = tags semver `vX.Y.Z`; `awm update` va al último tag.** Canal `stable` (default) → último tag; canal `dev` → HEAD del default branch (comportamiento actual). Sin branch estable separado, sin changelog (el git log entre tags lo es). Cortar release = `git tag v1.2.0 && git push --tags`.
3. **Mecanismo uniforme base + registries adicionales (WS-2).** El mismo resolver aplica a cada registry clonado; cada uno pinea independiente. Un registry sin tags cae a HEAD con aviso (retrocompatible — es la realidad actual de todos los repos).
4. **Pin en profile + verificación dura en sync; sin lockfile separado.** El pin del profile ES el lock, versionado con el código del proyecto. Mismatch → `awm sync` falla (exit 1) con remedio exacto. YAGNI sobre `.awm/lock.json` con SHAs.

**Enfoque elegido (A):** resolver sin estado — git es la fuente de verdad. La versión vigente se deriva con `git describe --tags --exact-match`; ningún archivo de estado que pueda divergir del checkout real.

---

## Arquitectura

```
awm update
  └─ por cada registry (base + adicionales):
       resolveTargetRef(repoDir, {pin: pins[name], channel})
         pin declarado ──→ tag v<pin> (error si no existe, listando disponibles)
         canal stable  ──→ último tag semver
         sin tags      ──→ HEAD del default branch + aviso (fallback)
         canal dev     ──→ HEAD del default branch
       fetch --tags --prune → reset --hard → checkout <ref>

awm sync (en el proyecto)
  └─ por cada entrada de profile.registries:
       currentVersion(repoDir) === pin?  → ok
       difiere                           → exit 1 + remedio exacto
       registry no configurado           → exit 1
```

El checkout a tag deja el clone en **detached HEAD** — esperado y correcto; `awm update` con canal `dev` vuelve a checkout del default branch + pull.

## Componentes

### 1. `cli/src/core/versioning.ts` (nuevo)

```ts
export type ResolvedRef =
    | { kind: 'tag'; ref: string; version: string }      // ref = "vX.Y.Z"
    | { kind: 'head'; ref: string }                       // canal dev — ref = default branch
    | { kind: 'head-fallback'; ref: string };             // stable sin tags — aviso al caller

export async function resolveTargetRef(
    repoDir: string,
    opts: { pin?: string; channel: 'stable' | 'dev' }
): Promise<ResolvedRef>;

/** Versión checkouteada actual: "X.Y.Z" si HEAD coincide exactamente con un tag semver, null si sigue un branch. */
export async function currentVersion(repoDir: string): Promise<string | null>;
```

- `resolveTargetRef` hace `git fetch --tags --prune origin` antes de resolver.
- Tags válidos: `vX.Y.Z` estricto (enteros). Tags con otro formato se **ignoran** silenciosamente.
- Orden semver **numérico** por componente (v1.10.0 > v1.9.0), no lexicográfico.
- `pin` se normaliza: acepta `1.2.0` y `v1.2.0`; internamente busca el tag `v1.2.0`.
- Pin inexistente → `Error` explícito que lista las versiones disponibles (o "el registry no tiene tags").
- `currentVersion` usa `git describe --tags --exact-match HEAD`; salida no semver o error → `null`.
- Default branch detectado vía `origin/HEAD` (con fallback `main`).

### 2. `cli/src/core/registry.ts` — `syncRegistry`

Firma nueva: `syncRegistry(remoteUrl?: string, opts?: { pin?: string; channel?: 'stable' | 'dev' })`.

- Clone fresco: `git clone` + `resolveTargetRef` + `checkout`.
- Clone existente: `reset --hard` (limpia drift, comportamiento actual) → `fetch --tags --prune` → `checkout <ref>`; si `kind` es `head`/`head-fallback`, además `pull` sobre el branch.
- Devuelve el `ResolvedRef` para que el caller imprima la versión resultante.
- Se elimina el `pull()` ciego: con detached HEAD `pull` falla — esa es la razón técnica del cambio de mecánica.
- **Call-sites (CONSTITUTION § Implementación — wiring completo, verificado con grep):** `cli/src/index.ts:72` (install), `:333` (update), `:423` (sync), `:466` (list), y `cli/src/core/init/steps.ts:31` (init). Los **cinco** deben pasar `{pin: pins.base, channel}` resueltos desde preferences; ninguno puede quedar con la llamada vieja.

### 3. `cli/src/core/registries.ts` — `syncAdditionalRegistries`

Misma mecánica por registry adicional (`~/.awm/registries/<name>`), con `pin = pins[name]`. El resultado por registry gana un campo de versión para el reporte (`pulled` → `'v1.2.0'` | `'HEAD'`). Un fallo individual sigue **sin abortar** el update (invariante WS-2).

### 4. Preferences (`cli/src/utils/config.ts`)

Campos opcionales nuevos en `preferences.json`:

```jsonc
{
  "channel": "stable",            // 'stable' (default si ausente) | 'dev'
  "pins": { "base": "1.2.0", "equipo": "0.3.0" }
}
```

- `base` es la clave **reservada** para el registry base; las demás claves son nombres de registries adicionales.
- Preferences ilegibles → defaults (patrón existente de `resolveBaseRemoteInfo`): canal `stable`, sin pins.

### 5. Comandos `awm pin` / `awm unpin` (nuevos)

```
awm pin <registry|base> <version>   # valida formato X.Y.Z, escribe pins[name], sugiere `awm update`
awm unpin <registry|base>           # borra pins[name], sugiere `awm update`
```

Editores triviales de preferences — **no** hacen checkout (eso es de `awm update`). `pin` valida que `<registry>` sea `base` o un registry configurado; versión malformada → error. Rollback documentado: `awm pin base 1.1.0 && awm update`.

### 6. `awm update` (handler en `cli/src/index.ts`)

- Pasa `{pin: pins.base, channel}` a `syncRegistry` e imprime la versión resultante:
  - `✓ Registry base @ v1.3.0`
  - `✓ Registry base @ main (canal dev)`
  - `⚠ Registry base sin tags — siguiendo HEAD (taggea v1.0.0 para activar el canal estable)`
- Ídem por registry adicional vía el campo de versión del resultado.
- El resto del pipeline (buildCli, regenerate context, reconcile symlinks, hooks resync) no cambia: tras el checkout, los symlinks ya ven el contenido del tag.

### 7. Profile del proyecto (`cli/src/core/profile.ts` + `awm sync`)

`ProjectProfile` gana campo opcional:

```jsonc
{ "extensions": ["mi-bundle"], "registries": { "base": "1.2.0" } }
```

- `readProfile` valida: `registries` debe ser objeto string→string con versiones `X.Y.Z` (acepta prefijo `v`); malformado → **error explícito con path** (consistente con `readRegistryManifest` de WS-2 — no silenciar).
- `awm sync`, después de sincronizar el registry y **antes** de instalar:
  - por cada `(name, version)` de `profile.registries`: resolver el clone dir (`base` → `REGISTRY_DIR`; otro → `~/.awm/registries/<name>`), comparar `currentVersion(dir)` con `version`.
  - Mismatch o registry inexistente → **exit 1** con remedio exacto:
    `La máquina tiene base @ v1.3.0 pero el proyecto requiere v1.2.0. Corré: awm pin base 1.2.0 && awm update`
  - Sin campo `registries` o registry sin entrada → sin verificación (opt-in).
- **Bump explícito** = editar el profile (commit del proyecto). Sin comando de bump (YAGNI).

## Manejo de errores

| Caso | Comportamiento |
|---|---|
| Pin a versión inexistente | Error con lista de tags disponibles |
| Repo sin tags, canal stable | Fallback a HEAD + aviso (no error) |
| Preferences ilegibles | Defaults: stable, sin pins |
| `profile.registries` malformado | Error explícito con path del profile |
| Mismatch de versión en `awm sync` | Exit 1 + comando exacto de remedio |
| Fallo de sync de un registry adicional | Se reporta, no aborta el update (invariante WS-2) |
| `git describe` falla / tag no semver | `currentVersion` → null (tratado como "siguiendo branch") |

## Testing

Patrón obligatorio (CONSTITUTION/AGENTS): dual-tmpdir (`tmpHome` + `tmpWork`), `process.env.HOME`/`AWM_HOME` sobreescritos, `jest.resetModules()` + require tardío. Fixtures: repos `git init` locales con commits y tags creados en el test, sin red.

Casos:

- **Resolver:** último tag con orden numérico (v1.10.0 > v1.9.0); pin exacto (con y sin `v`); pin inexistente → error listando tags; sin tags → `head-fallback`; canal dev → `head`; tags no semver ignorados.
- **`currentVersion`:** en tag exacto → versión; en branch → null; tag no semver → null.
- **`syncRegistry`:** clone fresco queda en el último tag; clone existente transiciona tag→tag nuevo tras `fetch`; **rollback** a tag anterior vía pin; canal dev sigue HEAD y recibe commits nuevos.
- **`syncAdditionalRegistries`:** pin por nombre aplica; registry sin tags reporta HEAD.
- **`pin`/`unpin`:** escriben/borran `pins` en preferences; validación de nombre y versión.
- **Gate de `awm sync`:** match pasa; mismatch → exit 1 con remedio; sin pin → no verifica; registry pineado no configurado → exit 1; `registries` malformado → error.
- **Criterio del roadmap (end-to-end con fixtures):** proyecto pineado a v1.0.0 con la máquina avanzada a v1.1.0 → sync falla (no recibe cambios hasta bump); bump del profile + update → pasa. Rollback funciona.

## Fuera de alcance

- Stores versionados por proyecto (pin por máquina decidido).
- Publicación npm y separación de ciclos CLI/contenido → WS-4.
- Canales prerelease / betas, changelogs generados.
- Gap "el remote de un clone existente no se actualiza al cambiar `AWM_BASE_REMOTE`" → WS-4 (anotado).
- `skills-lock.json` de la raíz (provenance de imports externos) — no se toca.
- Actualización del roadmap: el checkbox de WS-3 se marca en el mismo PR que cierre el workstream (regla #3 del roadmap).
