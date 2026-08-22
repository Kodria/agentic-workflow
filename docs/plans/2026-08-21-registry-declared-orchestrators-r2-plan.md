# Orquestadores declarados — Release 2 (capa de CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que AWM lea, valide y componga las declaraciones de orquestador de todos los registries instalados, y que eso llegue a los tres proveedores — incluido Claude Code, que hoy no lo recibe.

**Architecture:** Se extiende `awm-registry.json` con un bloque `orchestrator` opcional, leído por un parser **tolerante** que colecta diagnósticos en vez de lanzar (un orquestador mal declarado no puede invalidar el registry ni a los demás). `buildContext` deja de emitir solo nombres de extensión y pasa a componer los descriptores declarados. Finalmente se cierra el bypass: `hooks/claude.ts` deja de symlinkear el `SKILL.md` crudo y pasa a materializar el payload de `buildContext`, que es lo que hace que la composición efectivamente llegue a Claude Code.

**Tech Stack:** TypeScript, jest + ts-jest (`npm test` → `jest --runInBand`), sin dependencias nuevas (la restricción de costo del brief lo prohíbe).

**Modo de ejecución:** desatendido

---

## Contexto imprescindible para quien ejecute

1. **Repo y rama.** Todo ocurre en `agentic-workflow`, rama `claude/notion-task-capture-integration-ymltjd`. Directorio de trabajo del CLI: `cli/`.
2. **Release 1 debe estar entregado antes.** Este plan compone descripciones que solo tienen sentido si `using-awm` ya sabe qué hacer con ellas. Ver `2026-08-21-registry-declared-orchestrators-r1-plan.md`.
3. **El bypass es el cambio de mayor riesgo del repo.** `cli/src/commands/hooks/claude.ts:42-49` es el camino de instalación de hooks. Romperlo deja a los usuarios sin AWM en sesiones nuevas. Por eso la no-regresión se testea **antes** de tocarlo (Task 6), no después.
4. **Tolerancia, no excepción.** `readRegistryManifest` (`cli/src/core/registries.ts:323`) lanza ante manifiesto inválido, y eso está bien para el manifiesto. Pero `R1.2` exige que una **declaración de orquestador** malformada se rechace sin invalidar las demás. Por eso el parser nuevo colecciona diagnósticos y nunca lanza.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/orchestrators.ts` | **Crear.** Tipo `DeclaredOrchestrator`, parser tolerante y diagnósticos. Módulo propio y no dentro de `registries.ts`, que ya carga demasiadas responsabilidades |
| `cli/tests/core/orchestrators.test.ts` | **Crear.** Parser: válido, malformado, ausente, aislamiento entre declaraciones |
| `cli/src/core/context/provider.ts` | **Modificar.** `buildContext` compone descriptores en vez de emitir solo nombres |
| `cli/tests/core/context/provider.test.ts` | **Crear o extender.** Composición y degradación |
| `cli/src/commands/registry/add.ts` | **Modificar.** Informar declaraciones inválidas sin abortar la instalación por ellas |
| `cli/src/commands/hooks/claude.ts` | **Modificar.** Materializar el payload de `buildContext` en vez de symlinkear `SKILL.md` crudo |

---

### Task 1: Parser tolerante de declaraciones

_Requirements: R1.1, R1.2, R1.3_

**Files:**
- Create: `cli/src/core/orchestrators.ts`
- Test: `cli/tests/core/orchestrators.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `cli/tests/core/orchestrators.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readDeclaredOrchestrators } from '../../src/core/orchestrators';

function registryWith(manifest: unknown): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify(manifest));
    return root;
}

describe('readDeclaredOrchestrators', () => {
    const created: string[] = [];
    afterEach(() => {
        for (const r of created.splice(0)) fs.rmSync(r, { recursive: true, force: true });
    });

    it('lee una declaracion valida', () => {           // verifies R1.1
        const root = registryWith({
            minCliVersion: '8.1.5',
            orchestrator: { name: 'mi-proceso', appliesWhen: 'cuando arranco una tarea', terminatesTo: 'development-process' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics).toEqual([]);
        expect(orchestrators).toHaveLength(1);
        expect(orchestrators[0]).toEqual({
            name: 'mi-proceso',
            appliesWhen: 'cuando arranco una tarea',
            terminatesTo: 'development-process',
        });
    });

    it('un registry sin bloque orchestrator no declara nada y no es un error', () => {  // verifies R1.4
        const root = registryWith({ minCliVersion: '8.1.5' });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('un registry sin manifiesto no declara nada y no es un error', () => {           // verifies R1.4
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('rechaza una declaracion malformada SIN lanzar, reportandola', () => {           // verifies R1.2
        const root = registryWith({ orchestrator: { name: 'mi-proceso' } });            // falta appliesWhen y terminatesTo
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/appliesWhen/);
    });

    it('un manifiesto con JSON invalido se reporta, no explota', () => {                // verifies R1.2
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        created.push(root);
        fs.writeFileSync(path.join(root, 'awm-registry.json'), '{ no es json');
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
    });

    it('una declaracion invalida no invalida las validas de otros registries', () => {  // verifies R1.2
        const bad = registryWith({ orchestrator: { name: 'roto' } });
        const good = registryWith({
            orchestrator: { name: 'sano', appliesWhen: 'siempre', terminatesTo: 'none' },
        });
        created.push(bad, good);
        const all = [bad, good].map(readDeclaredOrchestrators);
        expect(all[0].orchestrators).toEqual([]);
        expect(all[1].orchestrators).toHaveLength(1);
        expect(all[1].diagnostics).toEqual([]);
    });

    it('rechaza campos de precedencia: no son vocabulario del framework', () => {       // verifies R1.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', precedence: 1 },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics[0]).toMatch(/unknown field "precedence"/i);
    });

    it('rechaza una declaracion que traiga secretos', () => {                            // verifies R5.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', token: 'ghp_abc' },
        });
        created.push(root);
        const { diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics[0]).toMatch(/unknown field "token"/i);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/core/orchestrators.test.ts --runInBand
```

Esperado: FAIL con `Cannot find module '../../src/core/orchestrators'`.

- [ ] **Step 3: Escribir la implementacion minima**

Crear `cli/src/core/orchestrators.ts`:

```typescript
// cli/src/core/orchestrators.ts
// Lector de declaraciones de orquestador. A diferencia de readRegistryManifest
// (registries.ts), este parser NUNCA lanza: una declaracion malformada se
// rechaza y se reporta, sin invalidar el registry que la contiene ni a los
// demas (R1.2). El contrato admite exactamente cuatro campos — identidad,
// cuando aplica, y a quien cede el control — y rechaza cualquier otro, que
// es como se impide que vocabulario de un proceso concreto (o un secreto)
// entre al framework (R1.3, R5.3).
import fs from 'fs';
import path from 'path';
import { REGISTRY_MANIFEST_NAME } from './registries';

export interface DeclaredOrchestrator {
    name: string;
    appliesWhen: string;
    terminatesTo: string;
}

export interface DeclaredOrchestratorsResult {
    orchestrators: DeclaredOrchestrator[];
    diagnostics: string[];
}

const ALLOWED_FIELDS = ['name', 'appliesWhen', 'terminatesTo'] as const;

export function readDeclaredOrchestrators(root: string): DeclaredOrchestratorsResult {
    const file = path.join(root, REGISTRY_MANIFEST_NAME);
    if (!fs.existsSync(file)) return { orchestrators: [], diagnostics: [] };

    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        return { orchestrators: [], diagnostics: [`${file}: manifest is not valid JSON (${e instanceof Error ? e.message : String(e)})`] };
    }

    const decl = (raw as Record<string, unknown>)?.orchestrator;
    if (decl === undefined) return { orchestrators: [], diagnostics: [] };

    if (typeof decl !== 'object' || decl === null || Array.isArray(decl)) {
        return { orchestrators: [], diagnostics: [`${file}: "orchestrator" must be an object`] };
    }

    const diagnostics: string[] = [];
    const entries = decl as Record<string, unknown>;

    for (const key of Object.keys(entries)) {
        if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
            diagnostics.push(`${file}: unknown field "${key}" in "orchestrator" — the contract admits only ${ALLOWED_FIELDS.join(', ')}`);
        }
    }
    for (const field of ALLOWED_FIELDS) {
        const value = entries[field];
        if (typeof value !== 'string' || value.trim() === '') {
            diagnostics.push(`${file}: "orchestrator.${field}" must be a non-empty string`);
        }
    }

    if (diagnostics.length > 0) return { orchestrators: [], diagnostics };

    return {
        orchestrators: [{
            name: entries.name as string,
            appliesWhen: entries.appliesWhen as string,
            terminatesTo: entries.terminatesTo as string,
        }],
        diagnostics: [],
    };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/core/orchestrators.test.ts --runInBand
```

Esperado: PASS los ocho casos.

- [ ] **Step 5: Typecheck y lint**

```bash
cd /home/user/agentic-workflow/cli
npm run typecheck
npm run lint
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /home/user/agentic-workflow
git add cli/src/core/orchestrators.ts cli/tests/core/orchestrators.test.ts
git commit -m "feat(cli): parser tolerante de declaraciones de orquestador"
```

---

### Task 2: `awm registry add` informa declaraciones invalidas

_Requirements: R1.2, R1.4_

**Files:**
- Modify: `cli/src/commands/registry/add.ts`
- Test: `cli/tests/commands/registry/add.test.ts` (crear o extender)

- [ ] **Step 1: Escribir el test que falla**

Agregar a `cli/tests/commands/registry/add.test.ts`:

```typescript
it('reporta una declaracion de orquestador invalida sin abortar la instalacion', async () => {  // verifies R1.2
    // Registry local con layout valido y declaracion rota
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-src-'));
    fs.mkdirSync(path.join(src, 'skills/mi-proceso'), { recursive: true });
    fs.writeFileSync(path.join(src, 'skills/mi-proceso/SKILL.md'), '---\nname: mi-proceso\n---\nx');
    fs.writeFileSync(path.join(src, 'awm-registry.json'), JSON.stringify({ orchestrator: { name: 'roto' } }));
    await simpleGit(src).init().add('.').commit('init');

    const result = await addRegistry(src, 'roto-reg');

    expect(result.ok).toBe(true);                       // la instalacion NO se aborta por esto
    expect(result.ok && result.orchestratorDiagnostics).toBeDefined();
    expect(result.ok && result.orchestratorDiagnostics!.join('\n')).toMatch(/appliesWhen/);
});

it('un registry sin declaracion se instala sin diagnosticos', async () => {                     // verifies R1.4
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-src-'));
    fs.mkdirSync(path.join(src, 'skills/otro'), { recursive: true });
    fs.writeFileSync(path.join(src, 'skills/otro/SKILL.md'), '---\nname: otro\n---\nx');
    await simpleGit(src).init().add('.').commit('init');

    const result = await addRegistry(src, 'sin-decl');

    expect(result.ok).toBe(true);
    expect(result.ok && (result.orchestratorDiagnostics ?? [])).toEqual([]);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/commands/registry/add.test.ts --runInBand
```

Esperado: FAIL — `orchestratorDiagnostics` no existe en el tipo de retorno.

- [ ] **Step 3: Implementar**

En `cli/src/commands/registry/add.ts`, extender el tipo de resultado:

```typescript
export type AddRegistryResult =
    | { ok: true; name: string; contentRoot: string; orchestratorDiagnostics: string[] }
    | { ok: false; name?: string; error: string };
```

Importar el lector:

```typescript
import { readDeclaredOrchestrators } from '../../core/orchestrators';
```

Y en el retorno de éxito, justo antes de `writeRegistriesConfig`, leer los diagnósticos y devolverlos:

```typescript
    // Una declaracion de orquestador malformada se REPORTA, no aborta: el
    // registry puede aportar skills utiles aunque su declaracion este rota,
    // y abortar por eso invalidaria contenido sano (R1.2).
    const { diagnostics: orchestratorDiagnostics } = readDeclaredOrchestrators(dest);

    writeRegistriesConfig([...existing, { name, remote }]);
    return { ok: true, name, contentRoot: dest, orchestratorDiagnostics };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/commands/registry/add.test.ts --runInBand
```

Esperado: PASS, incluidos los tests preexistentes de este archivo.

- [ ] **Step 5: Verificar que el comando imprime los diagnosticos**

En el wiring de commander de `awm registry add`, tras un resultado `ok`, imprimir cada diagnóstico como advertencia. Buscar dónde se imprime el mensaje de éxito y agregar:

```typescript
for (const d of result.orchestratorDiagnostics) {
    console.warn(`warning: ${d}`);
}
```

- [ ] **Step 6: Typecheck, lint y commit**

```bash
cd /home/user/agentic-workflow/cli
npm run typecheck && npm run lint
cd /home/user/agentic-workflow
git add cli/src/commands/registry/add.ts cli/tests/commands/registry/add.test.ts cli/src/commands/registry/index.ts
git commit -m "feat(cli): reportar declaraciones de orquestador invalidas en registry add"
```

---

### Task 3: `buildContext` compone los descriptores declarados

_Requirements: R1.1_

**Files:**
- Modify: `cli/src/core/context/provider.ts`
- Test: `cli/tests/core/context/provider.test.ts`

- [x] **Step 1: Escribir el test que falla**

Crear `cli/tests/core/context/provider.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildContext } from '../../../src/core/context/provider';

function registryRootWithSkill(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-'));
    fs.mkdirSync(path.join(root, 'skills/using-awm'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'skills/using-awm/SKILL.md'),
        '---\nname: using-awm\nversion: "1.3.0"\n---\n\n# Using Skills\n',
    );
    return root;
}

describe('buildContext', () => {
    const created: string[] = [];
    afterEach(() => { for (const r of created.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

    it('compone los descriptores declarados en el payload', () => {          // verifies R1.1
        const root = registryRootWithSkill();
        created.push(root);
        const ctx = buildContext({
            registryRoot: root,
            profileExtensions: [],
            declaredOrchestrators: [
                { name: 'mi-proceso', appliesWhen: 'cuando arranco una tarea', terminatesTo: 'development-process' },
            ],
        });
        expect(ctx.markdown).toContain('mi-proceso');
        expect(ctx.markdown).toContain('cuando arranco una tarea');
        expect(ctx.markdown).toContain('development-process');
        expect(ctx.markdown).toContain('# Using Skills');   // el skill sigue entero
    });

    it('sin declarados, el payload es identico al de antes del cambio', () => {  // verifies R6.1
        const root = registryRootWithSkill();
        created.push(root);
        const withEmpty = buildContext({ registryRoot: root, profileExtensions: [], declaredOrchestrators: [] });
        const withNone = buildContext({ registryRoot: root, profileExtensions: [] });
        expect(withEmpty.markdown).toEqual(withNone.markdown);
        expect(withEmpty.markdown).not.toContain('Declared orchestrators');
        expect(withEmpty.contentHash).toEqual(withNone.contentHash);
    });

    it('el hash cambia cuando cambian los declarados', () => {                    // verifies R1.1
        const root = registryRootWithSkill();
        created.push(root);
        const a = buildContext({ registryRoot: root, profileExtensions: [], declaredOrchestrators: [] });
        const b = buildContext({
            registryRoot: root, profileExtensions: [],
            declaredOrchestrators: [{ name: 'x', appliesWhen: 'y', terminatesTo: 'none' }],
        });
        expect(a.contentHash).not.toEqual(b.contentHash);
    });
});
```

- [x] **Step 2: Correr el test para verificar que falla**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/core/context/provider.test.ts --runInBand
```

Esperado: FAIL — `declaredOrchestrators` no existe en `ContextInput`.

- [x] **Step 3: Implementar**

En `cli/src/core/context/provider.ts`, extender el input y la composición:

```typescript
import { DeclaredOrchestrator } from '../orchestrators';

export type ContextInput = {
    registryRoot: string;
    profileExtensions: string[];
    /** Declaraciones recolectadas de todos los registries instalados. Ausente o
     *  vacio => payload byte-identico al previo a este cambio (R6.1). */
    declaredOrchestrators?: DeclaredOrchestrator[];
};

function renderDeclared(list: DeclaredOrchestrator[]): string {
    if (list.length === 0) return '';
    const rows = list
        .map(o => `- **${o.name}** — applies when: ${o.appliesWhen}. Terminates to: \`${o.terminatesTo}\`.`)
        .join('\n');
    return `## Declared orchestrators\n\nConsider these before the built-in pair:\n\n${rows}\n\n`;
}

export function buildContext(input: ContextInput): AwmContext {
    const skillPath = path.join(input.registryRoot, 'skills/using-awm/SKILL.md');
    if (!fs.existsSync(skillPath)) {
        throw new Error(`using-awm skill not found at ${skillPath}. Run 'awm update' first.`);
    }
    const skill = fs.readFileSync(skillPath, 'utf-8');
    const exts = input.profileExtensions.length ? input.profileExtensions.join(', ') : 'none';
    const header = `<!-- AWM context (generated) -->\n# AWM\n\nActive extensions: ${exts}\n\n`;
    const declared = renderDeclared(input.declaredOrchestrators ?? []);
    const markdown = header + declared + skill;
    return { markdown, sourceVersion: parseVersion(skill), contentHash: sha256(markdown) };
}
```

- [x] **Step 4: Correr el test para verificar que pasa**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/core/context/provider.test.ts --runInBand
```

Esperado: PASS los tres.

- [x] **Step 5: Commit**

```bash
cd /home/user/agentic-workflow/cli && npm run typecheck && npm run lint
cd /home/user/agentic-workflow
git add cli/src/core/context/provider.ts cli/tests/core/context/provider.test.ts
git commit -m "feat(cli): componer orquestadores declarados en buildContext"
```

---

### Task 4: Degradacion sin excepcion (fail-safe)

_Requirements: R5.1_

**Files:**
- Modify: `cli/src/core/context/orchestrator.ts`
- Test: `cli/tests/core/context/provider.test.ts` (extender)

- [x] **Step 1: Escribir el test que falla**

Agregar a `cli/tests/core/context/provider.test.ts`:

```typescript
it('un registry con declaracion rota no impide construir el contexto', () => {   // verifies R5.1
    const root = registryRootWithSkill();
    created.push(root);
    fs.writeFileSync(path.join(root, 'awm-registry.json'), '{ roto');
    // El contexto se construye igual: la declaracion rota se omite, no se propaga.
    const ctx = buildContext({ registryRoot: root, profileExtensions: [], declaredOrchestrators: [] });
    expect(ctx.markdown).toContain('# Using Skills');
});
```

- [ ] **Step 2: Correr el test**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/core/context/provider.test.ts --runInBand
```

Esperado: PASS ya en verde — `readDeclaredOrchestrators` de la Task 1 nunca lanza, así que la garantía se hereda. **Si falla, hay una ruta que sí propaga la excepción: encontrarla antes de seguir.**

- [x] **Step 3: Cablear la recoleccion en el orquestador de inyeccion**

En `cli/src/core/context/orchestrator.ts`, dentro de `inputFor`, recolectar de todos los registries instalados y pasar el resultado a `buildContext`:

```typescript
import { listRegistries } from '../registries';
import { readDeclaredOrchestrators, DeclaredOrchestrator } from '../orchestrators';

function collectDeclared(): { declared: DeclaredOrchestrator[]; diagnostics: string[] } {
    const declared: DeclaredOrchestrator[] = [];
    const diagnostics: string[] = [];
    for (const reg of listRegistries()) {
        const r = readDeclaredOrchestrators(reg.contentRoot);
        declared.push(...r.orchestrators);
        diagnostics.push(...r.diagnostics);
    }
    return { declared, diagnostics };
}
```

Y en `inputFor`:

```typescript
        const { declared, diagnostics } = collectDeclared();
        for (const d of diagnostics) console.warn(`warning: ${d}`);
        const ctx = buildContext({
            registryRoot: op.registryRoot,
            profileExtensions: op.profileExtensions,
            declaredOrchestrators: declared,
        });
```

- [x] **Step 4: Correr la suite completa de context**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/core/context --runInBand
```

Esperado: PASS.

- [x] **Step 5: Commit**

```bash
cd /home/user/agentic-workflow/cli && npm run typecheck && npm run lint
cd /home/user/agentic-workflow
git add cli/src/core/context/orchestrator.ts cli/tests/core/context/provider.test.ts
git commit -m "feat(cli): recolectar declaraciones de todos los registries, degradando ante error"
```

**Desviación del plan (verificada, no scope creep):** `orchestrator.ts` tiene un segundo call site de `buildContext` — `statusInputFor` (usado por `contextStatus`/`awm hooks status`) — que el texto literal del plan no mencionaba. Cablear la recolección solo en `inputFor` habría hecho que el hash "esperado" de `statusInputFor` divergiera del hash realmente materializado en cuanto algún registry declarara un orquestador, reportando `stale` de forma permanente incluso justo después de un install correcto (afecta `ConfigInstructionsStrategy` y `CodexAgentsStrategy`; `HookMergeStrategy`/Claude Code no usa `contentHash`). Se cableó también ahí, con test de regresión que falla sin el fix y pasa con él (verificado por el spec reviewer revirtiendo el fix manualmente). Post-review se extrajo `collectAndWarn()` como punto único compartido entre ambos call sites, precisamente para que esta clase de divergencia no pueda reintroducirse en silencio.

---

### Task 5: Red de no-regresion ANTES de tocar el bypass

_Requirements: R6.1_

Esta task no cambia comportamiento: fija el comportamiento actual para que la Task 6 no pueda romperlo en silencio.

**Files:**
- Modify: `cli/tests/commands/hooks/install.test.ts`

- [x] **Step 1: Agregar un test que fije el contrato observable del hook**

```typescript
it('el hook queda apuntando a un archivo legible con el contenido de using-awm', () => {  // verifies R6.1
    installHook({ agent: 'claude', registryRoot: tmpRegistry, installMethod: 'symlink' });

    const skillDest = path.join(tmpHome, '.awm', 'hooks', 'using-awm.md');
    expect(fs.existsSync(skillDest)).toBe(true);
    const content = fs.readFileSync(skillDest, 'utf-8');
    expect(content).toContain('MUST invoke skills.');   // el cuerpo del skill llega al hook
});
```

Este test pasa **hoy** (con symlink) y debe seguir pasando **después** (con payload materializado). Es exactamente la garantía que protege a los usuarios.

- [ ] **Step 2: Correr para verificar que pasa en el codigo actual**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/commands/hooks/install.test.ts --runInBand
```

Esperado: PASS. **Si falla acá, el test está mal escrito** — corregirlo antes de seguir, porque no sirve como red si no refleja el comportamiento actual.

- [x] **Step 3: Commit**

```bash
cd /home/user/agentic-workflow
git add cli/tests/commands/hooks/install.test.ts
git commit -m "test(cli): fijar el contrato observable del hook antes de cerrar el bypass"
```

---

### Task 6: Cerrar el bypass de Claude Code

_Requirements: R1.1, R6.1_

El cambio de mayor riesgo. La red de la Task 5 ya está puesta.

**Files:**
- Modify: `cli/src/commands/hooks/claude.ts:42-49`

- [x] **Step 1: Escribir el test que falla**

Agregar a `cli/tests/commands/hooks/install.test.ts`:

```typescript
it('el hook recibe los orquestadores declarados, no el SKILL.md crudo', () => {   // verifies R1.1
    fs.writeFileSync(
        path.join(tmpRegistry, 'awm-registry.json'),
        JSON.stringify({ orchestrator: { name: 'mi-proceso', appliesWhen: 'al arrancar', terminatesTo: 'development-process' } }),
    );
    installHook({ agent: 'claude', registryRoot: tmpRegistry, installMethod: 'symlink' });

    const content = fs.readFileSync(path.join(tmpHome, '.awm', 'hooks', 'using-awm.md'), 'utf-8');
    expect(content).toContain('mi-proceso');            // la composicion LLEGA a Claude Code
    expect(content).toContain('MUST invoke skills.');   // y el skill sigue entero
});
```

- [x] **Step 2: Correr para verificar que falla**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/commands/hooks/install.test.ts --runInBand
```

Esperado: FAIL en el assert de `mi-proceso` — hoy el hook lee el `SKILL.md` crudo y la composición nunca llega.

- [x] **Step 3: Reemplazar el symlink por el payload materializado**

En `cli/src/commands/hooks/claude.ts`, reemplazar el bloque del paso 3 (`// 3. Link the skill ...`, líneas 42-49) por:

```typescript
    // 3. Materializar el payload compuesto (using-awm + orquestadores declarados).
    //    Antes esto era un symlink al SKILL.md crudo, con la consecuencia de que
    //    todo lo que buildContext compone NUNCA llegaba a Claude Code — el
    //    proveedor principal. Se escribe el archivo en vez de enlazarlo porque
    //    el contenido ya no es un archivo del registry sino un derivado suyo.
    const skillDest = path.join(config.scriptsDir, 'using-awm.md');
    const { declared, diagnostics } = collectDeclaredOrchestrators();
    for (const d of diagnostics) console.warn(`warning: ${d}`);
    const ctx = buildContext({
        registryRoot: options.registryRoot,
        profileExtensions: [],
        declaredOrchestrators: declared,
    });
    try { fs.unlinkSync(skillDest); } catch { /* not exists */ }
    fs.writeFileSync(skillDest, ctx.markdown, 'utf-8');
```

Importar arriba lo necesario, y exportar `collectDeclaredOrchestrators` desde `core/context/orchestrator.ts` (era privada en la Task 4 — promoverla).

- [x] **Step 4: Correr los dos tests**

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/commands/hooks/install.test.ts --runInBand
```

Esperado: PASS ambos — el nuevo **y** la red de no-regresión de la Task 5. Si la red se rompe, se rompió el contrato observable para usuarios existentes: revertir y replantear.

- [x] **Step 5: Verificar que `awm update` sigue propagando**

Antes el symlink hacía que `awm update` propagara solo. Ahora el archivo es un derivado, así que hay que confirmar que el camino de resync lo regenera:

```bash
cd /home/user/agentic-workflow/cli
npx jest tests/commands/hooks --runInBand
```

Esperado: PASS. **Si algún test de resync falla, es el hallazgo más importante de este plan:** el archivo materializado quedaría rancio tras `awm update`. Arreglarlo cableando la regeneración en el mismo lugar que hoy resuelve el symlink.

- [x] **Step 6: Commit**

```bash
cd /home/user/agentic-workflow/cli && npm run typecheck && npm run lint
cd /home/user/agentic-workflow
git add cli/src/commands/hooks/claude.ts cli/src/core/context/orchestrator.ts
git commit -m "fix(cli): rutear Claude Code por buildContext, cerrando el bypass del SKILL.md crudo"
```

**Desviaciones verificadas (no scope creep):**
1. **Ciclo de imports real.** `claude.ts -> core/context/orchestrator.ts -> strategies/hook-merge.ts -> commands/hooks/install.ts -> claude.ts` es un ciclo genuino si `collectDeclaredOrchestrators`/`collectAndWarn` se exportan desde `orchestrator.ts` como el plan indicaba literalmente. Resuelto reubicando ambas funciones a `core/orchestrators.ts` (módulo hoja, solo depende de `./registries`) — confirmado por el spec reviewer leyendo el grafo de imports real.
2. **`resyncClaudeHookFiles` también arreglado**, no solo `installClaudeHook` — ambos ahora comparten un `writeMaterializedSkill()` único (evita que un `awm update` posterior reabra el bypass, exactamente el riesgo que este Step 5 señala). Test de regresión dedicado en `resync.test.ts`.
3. **Migración de instalaciones existentes verificada y fijada con test:** un `using-awm.md` symlink pre-Task-6 se migra correctamente a archivo materializado sin tocar el `SKILL.md` del registry (`fs.unlinkSync` remueve solo la entrada de directorio, nunca el destino del symlink) — verificado a mano por el code reviewer y luego regression-locked con un test dedicado tras su hallazgo.
4. **Mensajes/comentarios obsoletos corregidos:** `hooks/index.ts` (mensaje post-install), `hooks/shared.ts` (dos ubicaciones: comentario de `HookStatus.checks` y wording de `checkFile`'s catch branch), y `install-symlink-fallback.test.ts` (un test cuyo mock de EPERM había quedado inerte para `using-awm.md` — reescrito para probar y documentar esa irrelevancia explícitamente en vez de pasar en silencio por la razón equivocada).

---

### Task 7: Suite completa y tres plataformas

_Requirements: R6.1, R6.2, R6.3_

- [ ] **Step 1: Suite entera local**

```bash
cd /home/user/agentic-workflow/cli
npm run typecheck
npm run lint
npm run depcheck
npm test
```

Esperado: todo verde. Cualquier fallo se arregla acá.

- [ ] **Step 2: Verificar aislamiento de tests (R6.3)**

```bash
cd /home/user/agentic-workflow/cli
grep -rLn "process.env.AWM_HOME" tests/core/orchestrators.test.ts tests/core/context/provider.test.ts || echo "revisar: tests que no fijan AWM_HOME"
ls -la ~/.awm 2>/dev/null && echo "--- ~/.awm debe estar intacto tras la suite"
```

Los tests nuevos de `orchestrators` y `provider` operan sobre tmpdirs explícitos y no leen `awmHome()`, así que no necesitan sobreescribir `AWM_HOME`. Los que sí lo tocan (`hooks/install.test.ts`) ya siguen el patrón. **Confirmar que `~/.awm` quedó sin modificar.**

- [ ] **Step 3: Push y verificar CI en las tres plataformas**

```bash
cd /home/user/agentic-workflow
git push -u origin claude/notion-task-capture-integration-ymltjd
```

Esperado: el job `test` verde en `ubuntu-latest`, `windows-latest` y `macos-latest`. **Rojo en cualquiera bloquea la publicación** (D-005): el job `release` declara `needs: test`.

Prestar atención especial a Windows: la Task 6 cambia un symlink por un `writeFileSync`, lo que en principio **mejora** el comportamiento en Windows sin Developer Mode (donde el symlink caía al fallback de copia). Confirmarlo en el log, no asumirlo.

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|---|---|---|
| R1.1 | T1, T3, T6 | `lee una declaracion valida` · `compone los descriptores declarados en el payload` · `el hook recibe los orquestadores declarados, no el SKILL.md crudo` |
| R1.2 | T1, T2 | `rechaza una declaracion malformada SIN lanzar` · `un manifiesto con JSON invalido se reporta` · `una declaracion invalida no invalida las validas de otros registries` · `reporta una declaracion de orquestador invalida sin abortar la instalacion` |
| R1.3 | T1 | `rechaza campos de precedencia: no son vocabulario del framework` — verifica la **ausencia** de campos fuera del contrato, no la presencia de un marcador |
| R1.4 | T1, T2 | `un registry sin bloque orchestrator no declara nada` · `un registry sin manifiesto no declara nada` · `un registry sin declaracion se instala sin diagnosticos` |
| R5.1 | T4 | `un registry con declaracion rota no impide construir el contexto` |
| R5.3 | T1 | `rechaza una declaracion que traiga secretos` |
| R6.1 | T3, T5, T6 | `sin declarados, el payload es identico al de antes del cambio` (incluye igualdad de `contentHash`) · `el hook queda apuntando a un archivo legible con el contenido de using-awm` |
| R6.2 | T7 | T7 Step 3 — job `test` verde en las tres plataformas de CI |
| R6.3 | T7 | T7 Step 2 — `~/.awm` intacto tras la suite |

**Precisión de la matriz.** `R1.3` y `R5.3` se verifican por **rechazo** de campos fuera del contrato, que es la forma que prueba la clausura del contrato; un grep por un campo permitido probaría lo contrario de lo que hace falta. `R6.1` se ancla en igualdad de `contentHash`, no en que "el texto contenga algo".

## Analyze gate

- Todo requisito con ≥1 task y ≥1 test: **sí** (9/9 — los 8 del design doc más `R5.3`, que el diseño asignaba a Release 1 y acá se refuerza mecánicamente).
- Ninguna task o test sin requisito anclado: **sí**.

## Riesgos especificos de este plan

| Riesgo | Mitigación |
|---|---|
| El archivo materializado queda rancio tras `awm update`, donde antes el symlink lo resolvía solo | T6 Step 5 lo verifica explícitamente y lo declara como el hallazgo más importante si falla |
| Romper la instalación de hooks deja a usuarios existentes sin AWM | T5 pone la red **antes** de T6, y T6 Step 4 exige que siga verde |
| Windows se comporta distinto con symlinks vs escritura | T7 Step 3 exige leer el log de Windows, no asumir |
