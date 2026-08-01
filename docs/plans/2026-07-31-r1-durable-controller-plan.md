# R1 Durable Controller Implementation Plan

<!-- awm-qa-complete: 2026-08-01 -->
<!-- awm-retro-complete: 2026-08-01 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el controlador durable de R1 — journal canónico single-writer, CLI `awm job`, supervisor `awm watch` — según `docs/plans/2026-07-31-r1-durable-controller-design.md` (v5, certificado en 5 rondas de review del dueño).

**Architecture:** Supervisor foreground single-writer del snapshot `state.json`; el agente emite requests inmutables; los jobs se ejecutan vía un **exec-wrapper que es un proceso externo real** (entrypoint CLI propio, spawneado detached — sobrevive a la muerte del supervisor) con handshake durable claim → identidad → resultado por spawnNonce; el supervisor nunca espera un job: cada tick recoge resultados escaneando sidecars. Generaciones de controlador con fencing + señal positiva `safeToReplace` del ControllerAdapter; gate fail-closed que solo acepta `pass` con fingerprint vigente.

**Tech Stack:** TypeScript en `cli/` (Node ≥20, commander, cero dependencias nuevas), Jest con tmpdirs + override HOME/AWM_HOME. Registry hermano `awm-baseline-registry` para la sección journal-first del skill SDD.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

## Notas de ejecución

- **Requirements R1–R8** = los del design doc v5 (`2026-07-31-r1-durable-controller-design.md`), no confundir con los RF-x.y del brief.
- **Regla de oro del repo (AGENTS.md):** auto-verificación siempre con `npm run build && node dist/src/index.js <cmd>` desde `cli/` — nunca `awm` bare del PATH. Sensores: `node dist/src/index.js sensors run` desde `cli/`, leer `overall`.
- **Tests:** tmpdir + override `HOME`/`AWM_HOME` + `jest.resetModules()` + `require()` inline cuando el módulo lee env en import (patrón `cli/tests/commands/hooks/install.test.ts`; ver `docs/research/r0/analysis/cli-conventions.md`). Ningún test toca `~/.awm` ni el journal real.
- **Convención de estilo:** archivos nuevos siguen 4 espacios + `test()` si crean su propia convención; al editar un archivo existente, copiar SU convención local (regla CONSTITUTION).
- **El journal de test se crea siempre bajo el tmpdir del test** (`<tmp>/repo/.awm/journal/...`), nunca en el repo real.
- **Separadores en hashes:** el separador de partes en los digests es la SECUENCIA de escape `\0` escrita como texto dentro del string literal TS (`join('\0')`) — jamás un byte NUL crudo en este documento ni en los fuentes.
- **T20 (E2E real) exige `npm run build` previo** — lanza el CLI compilado como proceso real. Su primer paso lo hace explícito.
- **T21 se ejecuta en el repo hermano** `awm-baseline-registry` (su primer paso descubre/clona el checkout; el tag y `awm update` los decide el dueño después).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/atomic-file.ts` (modificar) | + `fsyncDirSync` (lanza en fallo, jamás silencioso) + `writeFileAtomicDurable` |
| `cli/src/core/journal/types.ts` | Entidades + enums + shape guards (única fuente de tipos) |
| `cli/src/core/journal/paths.ts` | Rutas del journal, branch-slug, lock por realpath(worktree) |
| `cli/src/core/journal/redact.ts` | Redacción en el emisor + rechazo de secretos literales |
| `cli/src/core/journal/fingerprint.ts` | argv + cwd real + HEAD + índice real (`ls-files --stage`) + digests por archivo |
| `cli/src/core/journal/process.ts` | ProcessRef tupla completa (incl. digest de `ps -o args=` + pgid), terminación confirmada por grupo (`pgrep -g` vacío) |
| `cli/src/core/journal/store.ts` | state.json: read (corrupt-aware) / write canónico (revisión, 0700/0600) + events.jsonl best-effort |
| `cli/src/core/journal/requests.ts` | Emisión tmp+fsync+rename+fsync-dir, acks regenerables con alias por requestId |
| `cli/src/core/journal/adapter.ts` | ControllerAdapter + implementaciones codex / claude-code |
| `cli/src/commands/job/exec-wrapper.ts` | Proceso externo: claim durable + identity sidecar + resultado terminal atómico |
| `cli/src/commands/job/{request,heartbeat,query}.ts` | Verbos del agente (request/controller-heartbeat/ps/list/show) |
| `cli/src/commands/job/{reconcile,gate,reap,export}.ts` | Matriz única, gate fail-closed con vigencia de fingerprint, reap explícito, export RNF-T.4/T.8/T.9 |
| `cli/src/commands/job/index.ts` | Registro de TODOS los subcomandos `awm job` (incl. exec-wrapper interno) |
| `cli/src/commands/watch/lock.ts` | Lock exclusivo `wx` + branch invariant |
| `cli/src/commands/watch/apply.ts` | Aplicación transaccional de requests (estado → journal → borrado) |
| `cli/src/commands/watch/runner.ts` | Runner concurrente: spawn detached de wrappers + recolección por scan + reconcile integrado |
| `cli/src/commands/watch/generations.ts` | State machine de generaciones, doble señal, custodia BLOCKED, backoff |
| `cli/src/commands/watch/init.ts` | Bootstrap `--init`: journal + validación mecánica plan-vs-repo |
| `cli/src/commands/watch/supervisor.ts` | Loop foreground: ticks, drenaje pre-COMPLETE, auto-exit, custodia con lock retenido |
| `cli/src/commands/watch/index.ts` | Registro commander de `awm watch` |
| `cli/tests/core/journal/*.test.ts`, `cli/tests/commands/job/*.test.ts`, `cli/tests/commands/watch/*.test.ts` | Suites (incl. E2E real con crash/restart) |
| `awm-baseline-registry/skills/subagent-driven-development/SKILL.md` (modificar) | Sección journal-first condicional (R5) |

---

### Task 1: Tipos del journal + shape guards

_Requirements: R1.4, R1.7, R2.1_

**Files:**
- Create: `cli/src/core/journal/types.ts`
- Test: `cli/tests/core/journal/types.test.ts`

- [ ] **Step 1: Escribir el test que fija los enums y los guards**

```ts
// cli/tests/core/journal/types.test.ts
import {
    EXECUTION_STATES, GENERATION_STATES, isWellFormedState, isWellFormedProcessRef, emptyState,
} from '../../../src/core/journal/types';

describe('journal types', () => {
    test('execution states incluyen orphaned y cancel (R1.7)', () => {   // verifies R1.7
        expect(EXECUTION_STATES).toEqual([
            'received', 'spawn-intent', 'claimed', 'running',
            'exited', 'cancel-requested', 'cancelled', 'orphaned',
        ]);
        expect(GENERATION_STATES).toEqual([
            'active', 'controller-suspected-stall', 'terminated', 'superseded',
        ]);
    });

    test('emptyState produce un estado bien formado (R1.4)', () => {     // verifies R1.4
        const s = emptyState('mi-rama');
        expect(isWellFormedState(s)).toBe(true);
        expect(s.schema).toBe(1);
        expect(s.revision).toBe(0);
        expect(s.cycle.status).toBe('IN_PROGRESS');
        expect(typeof s.cycle.startedAt).toBe('string');
        expect(s.requiredVerifiers).toEqual([]);
        expect(s.dispatches).toEqual([]);
    });

    test('isWellFormedState rechaza no-objetos y shapes rotos (R1.6)', () => {  // verifies R1.6
        expect(isWellFormedState(null)).toBe(false);
        expect(isWellFormedState(42)).toBe(false);
        expect(isWellFormedState({ schema: 1 })).toBe(false);
        const bad = emptyState('x') as Record<string, unknown>;
        bad.revision = 'no-un-numero';
        expect(isWellFormedState(bad)).toBe(false);
        const bad2 = emptyState('y') as Record<string, unknown>;
        delete bad2.requiredVerifiers;
        expect(isWellFormedState(bad2)).toBe(false);
    });

    test('isWellFormedProcessRef exige la tupla COMPLETA (R2.1)', () => {  // verifies R2.1
        const full = { pid: 1, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 1, psArgsDigest: 'p' };
        expect(isWellFormedProcessRef(full)).toBe(true);
        expect(isWellFormedProcessRef({ ...full, psArgsDigest: undefined })).toBe(false);
        expect(isWellFormedProcessRef({ ...full, processGroup: 'uno' })).toBe(false);
        expect(isWellFormedProcessRef(null)).toBe(false);
    });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd cli && npx jest tests/core/journal/types.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implementar `types.ts`**

```ts
// cli/src/core/journal/types.ts
// Única fuente de tipos del journal. CONSTITUTION: estados separados, nunca
// sobrecargados; shape validation antes de usar campos deserializados.

export const EXECUTION_STATES = [
    'received', 'spawn-intent', 'claimed', 'running',
    'exited', 'cancel-requested', 'cancelled', 'orphaned',
] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];

export type ObservationState = 'progressing' | 'suspected-stall';
export type JobVerdict = 'pass' | 'fail' | 'inconclusive';
export type CycleStatus = 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';

export const GENERATION_STATES = [
    'active', 'controller-suspected-stall', 'terminated', 'superseded',
] as const;
export type GenerationState = typeof GENERATION_STATES[number];

/** Identidad COMPLETA (R2.1): pid + startTime + nonce + digest del argv que
 *  NOSOTROS pasamos + process group + digest de `ps -o args=` capturado en el
 *  spawn. Toda validación de vida/señal compara la tupla entera. */
export interface ProcessRef {
    pid: number;
    startTime: string;      // de ps -o lstart — nunca PID solo
    spawnNonce: string;
    argvDigest: string;     // sha del argv estructurado que spawneamos
    processGroup: number;
    psArgsDigest: string;   // sha de `ps -o args=` observado tras el spawn
}

export interface NextAction {
    actionId: string;
    type: string;           // ej. 'implement-task' | 'dispatch-review' | 'run-qa'
    target: string;
    preconditions: string[];
    attempt: number;
    state: 'pending' | 'in-progress';
}

export type VerificationKind = 'test' | 'lint' | 'sensors' | 'review' | 'qa' | 'interlock';
export interface VerificationItem {
    id: string;
    kind: VerificationKind;
    // Satisfecho SOLO por pass con fingerprint vigente (R1.4c): job-id para
    // kinds mecánicos; verdict-id para kind 'review'.
    satisfiedBy?: string;
}

export interface ReviewObligation { id: string; taskId: string; kind: 'spec' | 'quality'; verdictId?: string; }
export interface Verdict { id: string; obligationId: string; result: JobVerdict; detail: string; receivedAt: string; }
export interface FixObligation { id: string; verdictId: string; closed: boolean; }

export interface TaskEntity {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done';
    attempts: number;
    verificationPlan: VerificationItem[];
    reviewObligations: ReviewObligation[];
    createdAt?: string;     // para wall time por task (RNF-T.4); ausente => 'unobservable'
    completedAt?: string;
}

export interface DispatchRecord { id: string; taskId: string; at: string; }

export interface JobResult { exitCode: number; endedAt: string; resultPath: string; }
export interface Job {
    id: string;
    fingerprint: string;
    commandDigest: string;
    argv: string[];         // ya redactado por el emisor (R2.3)
    cwd: string;            // cwd relativo REAL declarado en la request (R3.4)
    paths: string[];        // globs DECLARADOS (para recomputar vigencia, R3.4/RF-2.8)
    expandedPaths: string[];// expansión persistida al momento del fingerprint
    executionState: ExecutionState;
    observationState: ObservationState;
    verdict?: JobVerdict;
    spawnNonce?: string;    // persistido en spawn-intent ANTES del spawn (R1.8)
    processRef?: ProcessRef;   // identidad REAL del comando (del identity sidecar)
    wrapperRef?: ProcessRef;   // identidad REAL del wrapper externo
    phaseTimestamps: Partial<Record<ExecutionState, string>>;  // RNF-T.4
    lastProgressAt?: string;
    logPath?: string;
    result?: JobResult;
    satisfies?: string;     // id de VerificationItem que este job pretende satisfacer
    attemptOf?: string;     // job-id del attempt anterior (re-claim = attempt nuevo, R1.7)
}

export interface Generation {
    n: number;
    token: string;
    state: GenerationState;
    processRef?: ProcessRef;
    launchedAt: string;
}

export type RequestOutcome = 'applied' | 'rejected-stale-generation' | 'rejected-digest-mismatch' | 'rejected-secret';
export interface AppliedRequest {
    requestId: string;
    idempotencyKey: string;
    payloadDigest: string;
    outcome: RequestOutcome;
    resultRef?: string;     // ej. job-id creado — permite regenerar el ack (R1.3)
}

export interface JournalState {
    schema: 1;
    revision: number;
    branch: string;
    cycle: { status: CycleStatus; startedAt: string; completedAt?: string; nextAction?: NextAction; blockedReason?: string };
    cycleVerificationPlan: VerificationItem[];   // QA + interlock a nivel ciclo (R1.4b)
    requiredVerifiers: VerificationKind[];       // detectados mecánicamente en watch --init (R1.4b)
    generations: Generation[];
    tasks: TaskEntity[];
    dispatches: DispatchRecord[];                // despachos REALES (RNF-T.8)
    jobs: Record<string, Job>;
    verdicts: Verdict[];
    fixes: FixObligation[];
    appliedRequests: Record<string, AppliedRequest>;  // por requestId (los alias duplican entrada)
    controllerHeartbeatAt?: string;
}

export function emptyState(branch: string): JournalState {
    return {
        schema: 1, revision: 0, branch,
        cycle: { status: 'IN_PROGRESS', startedAt: new Date().toISOString() },
        cycleVerificationPlan: [], requiredVerifiers: [], generations: [], tasks: [],
        dispatches: [], jobs: {}, verdicts: [], fixes: [], appliedRequests: {},
    };
}

function isObj(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isWellFormedState(x: unknown): x is JournalState {
    if (!isObj(x)) return false;
    if (x.schema !== 1) return false;
    if (typeof x.revision !== 'number') return false;
    if (typeof x.branch !== 'string') return false;
    if (!isObj(x.cycle) || typeof (x.cycle as Record<string, unknown>).status !== 'string') return false;
    if (!Array.isArray(x.generations) || !Array.isArray(x.tasks)) return false;
    if (!Array.isArray(x.cycleVerificationPlan) || !Array.isArray(x.verdicts) || !Array.isArray(x.fixes)) return false;
    if (!Array.isArray(x.requiredVerifiers) || !Array.isArray(x.dispatches)) return false;
    if (!isObj(x.jobs) || !isObj(x.appliedRequests)) return false;
    return true;
}

export function isWellFormedProcessRef(x: unknown): x is ProcessRef {
    if (!isObj(x)) return false;
    return typeof x.pid === 'number'
        && typeof x.startTime === 'string'
        && typeof x.spawnNonce === 'string'
        && typeof x.argvDigest === 'string'
        && typeof x.processGroup === 'number'
        && typeof x.psArgsDigest === 'string';
}

export function isWellFormedJob(x: unknown): x is Job {
    if (!isObj(x)) return false;
    return typeof x.id === 'string'
        && typeof x.fingerprint === 'string'
        && typeof x.commandDigest === 'string'
        && Array.isArray(x.argv)
        && typeof x.cwd === 'string'
        && (EXECUTION_STATES as readonly string[]).includes(x.executionState as string);
}
```

- [ ] **Step 4: Verificar verde** — Run: `cd cli && npx jest tests/core/journal/types.test.ts` → Expected: PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/types.ts cli/tests/core/journal/types.test.ts && git commit -m "feat(journal): entity types, separated state enums, full-tuple ProcessRef, shape guards"`

---

### Task 2: `fsyncDirSync` + `writeFileAtomicDurable` (fsync del directorio, que LANZA)

_Requirements: R1.2_

**Files:**
- Modify: `cli/src/core/atomic-file.ts` (append al final; el archivo existente usa 4 espacios — mantener)
- Test: `cli/tests/core/atomic-file-durable.test.ts`

- [ ] **Step 1: Test** (incluye el fallo de dir-fsync: debe LANZAR, jamás continuar en silencio — bloqueador 4 de la review)

```ts
// cli/tests/core/atomic-file-durable.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeFileAtomicDurable, fsyncDirSync } from '../../src/core/atomic-file';

describe('writeFileAtomicDurable', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-durable-')); });
    afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    test('escribe contenido y respeta mode 0600 (R1.2)', () => {          // verifies R1.2
        const f = path.join(dir, 'state.json');
        writeFileAtomicDurable(f, '{"a":1}', 0o600);
        expect(fs.readFileSync(f, 'utf8')).toBe('{"a":1}');
        expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    });

    test('sobrevive a reemplazos consecutivos sin residuo tmp (R1.2)', () => {  // verifies R1.2
        const f = path.join(dir, 'state.json');
        writeFileAtomicDurable(f, 'v1', 0o600);
        writeFileAtomicDurable(f, 'v2', 0o600);
        expect(fs.readFileSync(f, 'utf8')).toBe('v2');
        expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([]);
    });

    test('fallo del fsync de directorio LANZA — sin fallback silencioso (R1.2)', () => {  // verifies R1.2
        const f = path.join(dir, 'state.json');
        const realOpen = fs.openSync;
        // writeFileAtomic abre el tmp con 'wx'; el fsync de directorio abre con 'r':
        // simulamos que el open del directorio falla (EIO/EPERM segun filesystem).
        jest.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
            if (flags === 'r') throw new Error('EIO simulado');
            return realOpen(p, flags, mode);
        }) as typeof fs.openSync);
        expect(() => writeFileAtomicDurable(f, '{"a":1}', 0o600)).toThrow(/fsync de directorio/);
    });

    test('fsyncDirSync exitoso no lanza sobre un directorio real (R1.2)', () => {  // verifies R1.2
        expect(() => fsyncDirSync(dir)).not.toThrow();
    });
});
```

- [ ] **Step 2: Rojo** — Run: `cd cli && npx jest tests/core/atomic-file-durable.test.ts` → FAIL (export missing).
- [ ] **Step 3: Implementar** (append en `atomic-file.ts`):

```ts
/** fsync del directorio contenedor: garantiza que una ENTRADA creada/renombrada
 *  sobrevive un crash del OS. Falla LANZANDO — la durabilidad de la transición
 *  es parte del contrato, nunca un best-effort silencioso (design R1.2,
 *  bloqueador 4 de la review del plan). */
export function fsyncDirSync(dir: string): void {
    let dirFd: number | undefined;
    try {
        dirFd = fs.openSync(dir, 'r');
        fs.fsyncSync(dirFd);
    } catch (error) {
        throw new Error(`fsync de directorio fallo para ${dir}: ${(error as Error).message}`);
    } finally {
        if (dirFd !== undefined) {
            try {
                fs.closeSync(dirFd);
            } catch {
                // best-effort SOLO el close: el fsync ya ocurrio o ya lanzo.
            }
        }
    }
}

/** writeFileAtomic + fsync del directorio contenedor tras el rename. */
export function writeFileAtomicDurable(file: string, content: string, mode = 0o644): void {
    writeFileAtomic(file, content, mode);
    fsyncDirSync(path.dirname(file));
}
```

- [ ] **Step 4: Verde** — Run: `cd cli && npx jest tests/core/atomic-file-durable.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/atomic-file.ts cli/tests/core/atomic-file-durable.test.ts && git commit -m "feat(core): writeFileAtomicDurable with throwing directory fsync"`

---
### Task 3: Rutas del journal + lock por worktree

_Requirements: R1.1_

**Files:**
- Create: `cli/src/core/journal/paths.ts`
- Test: `cli/tests/core/journal/paths.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/paths.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { branchSlug, journalDir, supervisorLockPath } from '../../../src/core/journal/paths';

describe('journal paths', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-jpaths-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('branchSlug sanea separadores', () => {                          // verifies R1.1
        expect(branchSlug('claude/mi-rama')).toBe('claude__mi-rama');
    });

    test('journalDir es por-rama; el lock vive FUERA del dir de rama (R1.1)', () => {  // verifies R1.1
        const jd = journalDir(repo, 'a/b');
        const lock = supervisorLockPath(repo);
        expect(jd).toBe(path.join(repo, '.awm', 'journal', 'a__b'));
        expect(lock).toBe(path.join(fs.realpathSync(repo), '.awm', 'journal', 'supervisor.lock'));
        expect(path.dirname(lock)).not.toBe(jd);
    });

    test('supervisorLockPath resuelve symlinks del worktree (R1.1)', () => {  // verifies R1.1
        const real = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-real-'));
        const link = path.join(repo, 'link');
        fs.symlinkSync(real, link);
        expect(supervisorLockPath(link)).toBe(path.join(fs.realpathSync(real), '.awm', 'journal', 'supervisor.lock'));
        fs.rmSync(real, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/paths.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/paths.ts
import fs from 'fs';
import path from 'path';

export function branchSlug(branch: string): string {
    if (!branch || branch === '.' || branch.includes('..')) {
        throw new Error(`branch inválida para slug: ${JSON.stringify(branch)}`);
    }
    return branch.replace(/[/\\]/g, '__');
}

export function journalDir(repoRoot: string, branch: string): string {
    return path.join(repoRoot, '.awm', 'journal', branchSlug(branch));
}

/** Lock único por worktree FÍSICO: clavado por realpath, fuera del dir de rama
 *  (design R1.1, bloqueante v5-5: dos ramas jamás toman locks distintos sobre
 *  el mismo árbol). */
export function supervisorLockPath(repoRoot: string): string {
    return path.join(fs.realpathSync(repoRoot), '.awm', 'journal', 'supervisor.lock');
}

export function statePath(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'state.json');
}
export function requestsDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'requests');
}
export function acksDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'acks');
}
export function logsDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'logs');
}
export function eventsPath(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'events.jsonl');
}
export function exportDir(repoRoot: string, branch: string): string {
    return path.join(journalDir(repoRoot, branch), 'export');
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/paths.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/paths.ts cli/tests/core/journal/paths.test.ts && git commit -m "feat(journal): branch-scoped paths, worktree-scoped supervisor lock"`

---

### Task 4: Redacción de secretos en el emisor

_Requirements: R2.3_

**Files:**
- Create: `cli/src/core/journal/redact.ts`
- Test: `cli/tests/core/journal/redact.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/redact.test.ts
import { redactText, redactArgv, findLiteralSecretFlag } from '../../../src/core/journal/redact';

describe('redact', () => {
    test('redactText enmascara asignaciones sospechosas (R2.3)', () => {   // verifies R2.3
        expect(redactText('export API_KEY=abc123secreto')).toContain('[REDACTED]');
        expect(redactText('password: hunter2')).toContain('[REDACTED]');
        expect(redactText('linea inocente')).toBe('linea inocente');
    });

    test('findLiteralSecretFlag detecta flags sensibles con valor literal (R2.3)', () => {  // verifies R2.3
        expect(findLiteralSecretFlag(['cmd', '--token', 'abc123'])).toBe('--token');
        expect(findLiteralSecretFlag(['cmd', '--api-key=xyz'])).toBe('--api-key');
        expect(findLiteralSecretFlag(['cmd', '--token-env', 'MY_TOKEN'])).toBeNull();
        expect(findLiteralSecretFlag(['npm', 'test'])).toBeNull();
    });

    test('redactArgv nunca deja el valor de un flag sensible (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['x', '--password', 'hunter2'])).toEqual(['x', '--password', '[REDACTED]']);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/redact.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/redact.ts
// Redacción EN EL EMISOR, antes de cualquier escritura (design R2.3).
// Patrones alineados con el sensor-pack de secretos del registry baseline.

const SECRET_WORD = /(password|passwd|secret|api[-_]?key|apikey|token|credential)/i;
const ASSIGNMENT = new RegExp(`([a-z0-9_-]*(?:password|passwd|secret|api[-_]?key|apikey|token|credential)[a-z0-9_-]*)(\\s*[=:]\\s*)(\\S+)`, 'gi');

export function redactText(text: string): string {
    return text.replace(ASSIGNMENT, (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`);
}

/** Flag sensible que porta un secreto LITERAL (no una referencia `-env`):
 *  la request se rechaza, no se persiste ni redactada (R2.3). */
export function findLiteralSecretFlag(argv: string[]): string | null {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const eq = arg.indexOf('=');
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
        if (!SECRET_WORD.test(flag)) continue;
        if (/-env$/i.test(flag)) continue;                 // referencia, permitida (R4.7)
        const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
        if (value !== undefined && !value.startsWith('--')) return flag;
    }
    return null;
}

export function redactArgv(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const flag = eq === -1 ? arg : arg.slice(0, eq);
        if (arg.startsWith('--') && SECRET_WORD.test(flag) && !/-env$/i.test(flag)) {
            if (eq !== -1) { out.push(`${flag}=[REDACTED]`); continue; }
            out.push(arg);
            if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) { out.push('[REDACTED]'); i++; }
            continue;
        }
        out.push(redactText(arg));
    }
    return out;
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/redact.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/redact.ts cli/tests/core/journal/redact.test.ts && git commit -m "feat(journal): emitter-side secret redaction and literal-secret rejection"`

---

### Task 5: Fingerprint (índice real + cwd como parámetro)

_Requirements: R3.4_

El fingerprint separa componentes reales (bloqueador 7 de la review): argv exacto,
**cwd relativo real como parámetro**, `HEAD`, **índice real** (`git ls-files --stage`
hasheado — dos blobs staged distintos con igual worktree YA NO colisionan), y
digest de contenido por archivo de tracked/untracked/deleted. El journal
(`.awm/`) se excluye SIEMPRE de la expansión — sus escrituras no pueden invalidar
evidencia.

**Files:**
- Create: `cli/src/core/journal/fingerprint.ts`
- Test: `cli/tests/core/journal/fingerprint.test.ts`

- [ ] **Step 1: Test** (fixture git real en tmpdir; helper con `-c` de identidad, patrón AGENTS.md)

```ts
// cli/tests/core/journal/fingerprint.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

describe('computeFingerprint', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-fp-'));
        git(repo, 'init', '-q');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'uno');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c1');
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('mismo comando + mismo arbol + mismo cwd => mismo fingerprint (R3.4)', () => {   // verifies R3.4
        const a = computeFingerprint(repo, ['npm', 'test'], [], '.');
        const b = computeFingerprint(repo, ['npm', 'test'], [], '.');
        expect(a.fingerprint).toBe(b.fingerprint);
        expect(a.commandDigest).toBe(b.commandDigest);
    });

    test('cambio en tracked, untracked o argv cambia el fingerprint (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        const mod = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(mod).not.toBe(base);
        git(repo, 'checkout', '-q', '--', '.');
        fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'x');
        const untracked = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(untracked).not.toBe(base);
        fs.rmSync(path.join(repo, 'nuevo.txt'));
        const otherCmd = computeFingerprint(repo, ['npm', 'run', 'lint'], [], '.').fingerprint;
        expect(otherCmd).not.toBe(base);
    });

    test('cambio staged-only altera el fingerprint — indice real hasheado (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        git(repo, 'add', 'a.txt');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'uno');   // worktree identico al base; SOLO el indice cambio
        const stagedOnly = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(stagedOnly).not.toBe(base);
    });

    test('cwd distinto altera el fingerprint; cwd fuera del repo se rechaza (R3.4)', () => {  // verifies R3.4
        fs.mkdirSync(path.join(repo, 'sub'));
        const root = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        const sub = computeFingerprint(repo, ['npm', 'test'], [], 'sub').fingerprint;
        expect(sub).not.toBe(root);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '../fuera')).toThrow(/cwd/);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '/abs')).toThrow(/cwd/);
    });

    test('la expansion de paths queda persistida y excluye .awm (R3.4)', () => {          // verifies R3.4
        fs.mkdirSync(path.join(repo, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'journal', 'state.json'), '{}');
        const r = computeFingerprint(repo, ['npm', 'test'], ['a.txt'], '.');
        expect(r.expandedPaths).toEqual(['a.txt']);
        const all = computeFingerprint(repo, ['npm', 'test'], [], '.');
        expect(all.expandedPaths.some((p) => p.startsWith('.awm/'))).toBe(false);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/fingerprint.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/fingerprint.ts
import crypto from 'crypto';
import path from 'path';
import { execFileSync } from 'child_process';

function sha(parts: string[]): string {
    return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}
function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export interface FingerprintResult {
    fingerprint: string;
    commandDigest: string;
    expandedPaths: string[];
}

/** El journal jamás invalida evidencia: .awm/ queda fuera de toda expansión. */
const EXCLUDE_JOURNAL = ':(exclude).awm';

/** Componentes SEPARADOS (design R3.4, bloqueador 7 de la review):
 *  argv exacto + cwd relativo REAL + HEAD + índice real (`ls-files --stage`
 *  hasheado) + digest de contenido por archivo tracked/untracked/deleted. */
export function computeFingerprint(repoRoot: string, argv: string[], pathGlobs: string[], cwdRel: string): FingerprintResult {
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv vacio');
    if (typeof cwdRel !== 'string' || cwdRel.length === 0) throw new Error('cwd relativo requerido');
    const cwdNorm = path.posix.normalize(cwdRel);
    if (path.isAbsolute(cwdNorm) || cwdNorm === '..' || cwdNorm.startsWith('../')) {
        throw new Error(`cwd fuera del repo: ${JSON.stringify(cwdRel)}`);
    }
    const commandDigest = sha(argv);
    const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const pathspecs = pathGlobs.length > 0 ? pathGlobs : ['.'];
    // Índice REAL: modos + blobs + stages + paths — un cambio staged-only con
    // worktree idéntico produce salida distinta aquí.
    const indexRaw = git(repoRoot, ['ls-files', '--stage', '--', ...pathspecs, EXCLUDE_JOURNAL]);
    const indexDigest = sha([indexRaw]);
    const expandedPaths = git(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs, EXCLUDE_JOURNAL])
        .split('\n').filter(Boolean).sort();
    const perFile = expandedPaths.map((p) => {
        try {
            return `${p}:${git(repoRoot, ['hash-object', '--', p]).trim()}`;
        } catch {
            return `${p}:deleted`;   // listado pero ilegible/borrado del worktree: cuenta como cambio
        }
    });
    const fingerprint = sha([commandDigest, `cwd:${cwdNorm}`, `head:${head}`, `index:${indexDigest}`, ...perFile]);
    return { fingerprint, commandDigest, expandedPaths };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/fingerprint.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/fingerprint.ts cli/tests/core/journal/fingerprint.test.ts && git commit -m "feat(journal): fingerprint with real index digest, parametric cwd, journal exclusion"`

---
### Task 6: Identidad y ciclo de vida de procesos (tupla completa + grupo confirmado)

_Requirements: R2.1, R4.7_

`refIsAlive` valida la tupla COMPLETA (bloqueador 6 de la review): pid +
startTime + pgid real (`ps -o pgid=`) + digest de `ps -o args=` capturado en el
spawn. La terminación se confirma sobre TODO el process group (`pgrep -g`
vacío), no solo el líder.

**Files:**
- Create: `cli/src/core/journal/process.ts`
- Test: `cli/tests/core/journal/process.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/process.test.ts
import { spawnStructured, refIsAlive, terminateGroupConfirmed, groupIsGone, activitySnapshot, captureSelfRef } from '../../../src/core/journal/process';

describe('process identity', () => {
    test('spawnStructured produce ProcessRef con tupla completa (R2.1, R4.7)', async () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nonce-abc');
        expect(ref.pid).toBe(child.pid);
        expect(ref.spawnNonce).toBe('nonce-abc');
        expect(typeof ref.startTime).toBe('string');
        expect(ref.processGroup).toBeGreaterThan(0);
        expect(ref.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        expect(refIsAlive(ref)).toBe(true);
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 300, killGraceMs: 300 });
        expect(dead).toBe(true);
        expect(refIsAlive(ref)).toBe(false);
    });

    test('refIsAlive rechaza identidad parcial: startTime O psArgsDigest distintos (R2.1)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n2');
        expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(false);
        expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(false);
        expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
        child.kill('SIGKILL');
    });

    test('terminateGroupConfirmed confirma el GRUPO entero, no solo el lider (R2.1)', async () => {  // verifies R2.1
        // El hijo spawnea un nieto en su mismo grupo; la confirmacion exige pgrep -g vacio.
        const spawnGrandchild = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)']); setTimeout(()=>{}, 5000)";
        const { ref } = spawnStructured(['node', '-e', spawnGrandchild], process.cwd(), 'n3');
        await new Promise((r) => setTimeout(r, 400));      // dejar nacer al nieto
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 400, killGraceMs: 400 });
        expect(dead).toBe(true);
        expect(groupIsGone(ref.processGroup)).toBe(true);
    });

    test('activitySnapshot reporta cpu y tamanio de grupo de un proceso vivo (soporte R4.2)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n4');
        const snap = activitySnapshot(ref);
        expect(snap).not.toBeNull();
        expect(typeof snap!.cpuTime).toBe('string');
        expect(snap!.groupSize).toBeGreaterThanOrEqual(1);
        child.kill('SIGKILL');
    });

    test('captureSelfRef captura la identidad del proceso actual (R2.1)', () => {  // verifies R2.1
        const self = captureSelfRef('nonce-self');
        expect(self.pid).toBe(process.pid);
        expect(refIsAlive(self)).toBe(true);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/process.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/process.ts
import crypto from 'crypto';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import type { ProcessRef } from './types';

export const NONCE_ENV = 'AWM_SPAWN_NONCE';

function psField(pid: number, field: string): string | null {
    try {
        const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
        return out.length > 0 ? out : null;
    } catch { return null; }
}

function sleepSync(seconds: string): void {
    try { execFileSync('sleep', [seconds]); } catch { /* sin sleep: seguimos */ }
}

/** ps args estable: dos lecturas consecutivas iguales (evita capturar el
 *  estado pre-exec del fork). null si el proceso ya no existe. */
function stablePsArgs(pid: number): string | null {
    for (let i = 0; i < 5; i++) {
        const a = psField(pid, 'args');
        if (a === null) return null;
        sleepSync('0.05');
        const b = psField(pid, 'args');
        if (b === a) return a;
    }
    return psField(pid, 'args');
}

export function argvDigest(argv: string[]): string {
    return crypto.createHash('sha256').update(argv.join('\0')).digest('hex').slice(0, 16);
}

export function psArgsDigestOf(pid: number): string | null {
    const args = psField(pid, 'args');
    if (args === null) return null;
    return crypto.createHash('sha256').update(args).digest('hex').slice(0, 16);
}

/** Captura la identidad COMPLETA de un pid recien spawneado (R2.1):
 *  startTime + pgid reales de ps + digest de `ps -o args=` estable. */
export function captureRefFor(pid: number, nonce: string, argv: string[]): ProcessRef {
    let start: string | null = null;
    for (let i = 0; i < 5 && start === null; i++) {
        start = psField(pid, 'lstart');
        if (start === null) sleepSync('0.05');
    }
    const pgid = psField(pid, 'pgid');
    const args = stablePsArgs(pid);
    return {
        pid,
        startTime: start ?? 'unknown',
        spawnNonce: nonce,
        argvDigest: argvDigest(argv),
        processGroup: pgid !== null ? Number(pgid) : pid,
        psArgsDigest: args !== null ? crypto.createHash('sha256').update(args).digest('hex').slice(0, 16) : 'unknown',
    };
}

/** Identidad del proceso ACTUAL (la usa el wrapper externo y el lock). */
export function captureSelfRef(nonce: string): ProcessRef {
    return captureRefFor(process.pid, nonce, process.argv);
}

/** Ejecucion segura (design R4.7): executable+argv como array, shell:false,
 *  nonce por entorno (referencia, no valor persistido), grupo propio (detached). */
export function spawnStructured(argv: string[], cwd: string, nonce: string, extraEnv: Record<string, string> = {}): { child: ChildProcess; ref: ProcessRef } {
    const [exe, ...args] = argv;
    const child = spawn(exe, args, {
        cwd, shell: false, detached: true,
        env: { ...process.env, [NONCE_ENV]: nonce, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid === undefined) throw new Error(`spawn fallo para ${exe}`);
    return { child, ref: captureRefFor(child.pid, nonce, argv) };
}

/** Vivo Y con la MISMA identidad — tupla completa, nunca PID solo (R2.1,
 *  bloqueador 6): startTime + pgid + digest de ps args. */
export function refIsAlive(ref: ProcessRef): boolean {
    const start = psField(ref.pid, 'lstart');
    if (start === null || start !== ref.startTime) return false;
    const pgid = psField(ref.pid, 'pgid');
    if (pgid === null || Number(pgid) !== ref.processGroup) return false;
    const argsDig = psArgsDigestOf(ref.pid);
    if (argsDig === null || argsDig !== ref.psArgsDigest) return false;
    return true;
}

/** true <=> pgrep -g no encuentra NINGUN proceso en el grupo. Un fallo de
 *  pgrep distinto de "sin matches" devuelve false: sin confirmacion no hay
 *  muerte declarada (R2.1). */
export function groupIsGone(pgid: number): boolean {
    try {
        const out = execFileSync('pgrep', ['-g', String(pgid)], { encoding: 'utf8' });
        return out.trim().length === 0;
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        return status === 1;   // pgrep exit 1 = cero matches; cualquier otra cosa NO confirma
    }
}

export interface ActivitySnapshot { cpuTime: string; groupSize: number; }
export function activitySnapshot(ref: ProcessRef): ActivitySnapshot | null {
    if (!refIsAlive(ref)) return null;
    const cpu = psField(ref.pid, 'time') ?? '0';
    let groupSize = 1;
    try {
        groupSize = execFileSync('pgrep', ['-g', String(ref.processGroup)], { encoding: 'utf8' })
            .split('\n').filter(Boolean).length;
    } catch { groupSize = 1; }
    return { cpuTime: cpu, groupSize };
}

/** Escalera de gracia (design R4.2b): SIGTERM -> confirmar -> SIGKILL -> confirmar.
 *  true <=> lider muerto por identidad Y grupo entero desaparecido (pgrep -g
 *  vacio) — jamas confirmar solo el lider (bloqueador 6). */
export async function terminateGroupConfirmed(ref: ProcessRef, opts: { termGraceMs: number; killGraceMs: number }): Promise<boolean> {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const confirmed = () => !refIsAlive(ref) && groupIsGone(ref.processGroup);
    if (confirmed()) return true;
    try { process.kill(-ref.processGroup, 'SIGTERM'); } catch { /* grupo ya ausente */ }
    await wait(opts.termGraceMs);
    if (confirmed()) return true;
    try { process.kill(-ref.processGroup, 'SIGKILL'); } catch { /* idem */ }
    await wait(opts.killGraceMs);
    return confirmed();
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/process.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/process.ts cli/tests/core/journal/process.test.ts && git commit -m "feat(journal): full-tuple process identity, whole-group confirmed termination"`

---

### Task 7: Store del snapshot canónico + events.jsonl

_Requirements: R1.2, R1.5, R1.6, R4.6_

**Files:**
- Create: `cli/src/core/journal/store.ts`
- Test: `cli/tests/core/journal/store.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/store.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initJournal, readJournal, writeJournal, appendEvent } from '../../../src/core/journal/store';
import { statePath, journalDir, eventsPath } from '../../../src/core/journal/paths';

describe('journal store', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-store-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('initJournal crea 0700/0600 y estado inicial valido (R1.2)', () => {  // verifies R1.2
        initJournal(repo, 'rama');
        const dir = journalDir(repo, 'rama');
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        expect(fs.statSync(statePath(repo, 'rama')).mode & 0o777).toBe(0o600);
        const r = readJournal(repo, 'rama');
        expect(r.corrupt).toBe(false);
        expect(r.state!.revision).toBe(0);
    });

    test('writeJournal incrementa revision y rechaza revision vieja (R1.2)', () => {  // verifies R1.2
        initJournal(repo, 'rama');
        const s1 = readJournal(repo, 'rama').state!;
        writeJournal(repo, 'rama', s1);                       // rev 0 -> 1
        const s2 = readJournal(repo, 'rama').state!;
        expect(s2.revision).toBe(1);
        expect(() => writeJournal(repo, 'rama', s1)).toThrow(/revision/);  // CAS: s1 quedo vieja
    });

    test('nextAction persiste estructurado (R1.5)', () => {                // verifies R1.5
        initJournal(repo, 'rama');
        const s = readJournal(repo, 'rama').state!;
        s.cycle.nextAction = { actionId: 'a1', type: 'implement-task', target: 'T1', preconditions: [], attempt: 1, state: 'pending' };
        writeJournal(repo, 'rama', s);
        expect(readJournal(repo, 'rama').state!.cycle.nextAction!.actionId).toBe('a1');
    });

    test('estado corrupto se reporta, jamas se descarta en silencio (R1.6)', () => {  // verifies R1.6
        initJournal(repo, 'rama');
        fs.writeFileSync(statePath(repo, 'rama'), 'null');    // JSON valido, shape invalido
        const r = readJournal(repo, 'rama');
        expect(r.corrupt).toBe(true);
        expect(r.state).toBeNull();
        fs.writeFileSync(statePath(repo, 'rama'), '{roto');   // sintaxis invalida
        expect(readJournal(repo, 'rama').corrupt).toBe(true);
    });

    test('appendEvent agrega lineas de auditoria best-effort (R4.6)', () => {  // verifies R4.6
        initJournal(repo, 'rama');
        appendEvent(repo, 'rama', { kind: 'generation-launched', n: 1 });
        appendEvent(repo, 'rama', { kind: 'request-rejected-stale' });
        const lines = fs.readFileSync(eventsPath(repo, 'rama'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).kind).toBe('generation-launched');
        expect(typeof JSON.parse(lines[0]).at).toBe('string');
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/store.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/store.ts
import fs from 'fs';
import { writeFileAtomicDurable } from '../atomic-file';
import { emptyState, isWellFormedState, JournalState } from './types';
import { journalDir, statePath, requestsDir, acksDir, logsDir, exportDir, eventsPath } from './paths';

export interface ReadResult { state: JournalState | null; corrupt: boolean; raw?: string; }

export function initJournal(repoRoot: string, branch: string): void {
    for (const d of [journalDir(repoRoot, branch), requestsDir(repoRoot, branch), acksDir(repoRoot, branch), logsDir(repoRoot, branch), exportDir(repoRoot, branch)]) {
        fs.mkdirSync(d, { recursive: true, mode: 0o700 });
        fs.chmodSync(d, 0o700);   // mkdirSync mode es umask-dependiente: fijar explicito (R1.2)
    }
    const sp = statePath(repoRoot, branch);
    if (!fs.existsSync(sp)) {
        writeFileAtomicDurable(sp, JSON.stringify(emptyState(branch), null, 2) + '\n', 0o600);
    }
}

/** Lectura corrupt-aware (R1.6): sintaxis invalida O shape invalido => corrupt:true.
 *  Los CONSUMIDORES deciden: consultas muestran 'corrupt'; gate/reconcile bloquean. */
export function readJournal(repoRoot: string, branch: string): ReadResult {
    const sp = statePath(repoRoot, branch);
    let raw: string;
    try { raw = fs.readFileSync(sp, 'utf8'); } catch { return { state: null, corrupt: true }; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { state: null, corrupt: true, raw }; }
    if (!isWellFormedState(parsed)) return { state: null, corrupt: true, raw };
    return { state: parsed, corrupt: false, raw };
}

/** Escritura canonica: SOLO el supervisor la invoca (single-writer). CAS por
 *  revision monotonica: el snapshot que traes debe ser el vigente. */
export function writeJournal(repoRoot: string, branch: string, state: JournalState): void {
    const current = readJournal(repoRoot, branch);
    if (current.corrupt) throw new Error('journal corrupto: no se escribe sobre corrupcion (R1.6)');
    if (current.state !== null && current.state.revision !== state.revision) {
        throw new Error(`revision desactualizada: disco=${current.state.revision} propuesta=${state.revision}`);
    }
    const next: JournalState = { ...state, revision: state.revision + 1 };
    writeFileAtomicDurable(statePath(repoRoot, branch), JSON.stringify(next, null, 2) + '\n', 0o600);
}

/** Auditoria derivada best-effort (R4.6): la escribe SOLO el supervisor, un
 *  fallo aqui jamas invalida el estado — state.json es la unica autoridad. */
export function appendEvent(repoRoot: string, branch: string, event: Record<string, unknown>): void {
    try {
        fs.appendFileSync(eventsPath(repoRoot, branch), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
    } catch {
        // best-effort: un evento perdido no se reconstruye ni bloquea (R4.6)
    }
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/store.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/store.ts cli/tests/core/journal/store.test.ts && git commit -m "feat(journal): canonical snapshot store with monotonic revision, corrupt-aware reads, best-effort events"`

---
### Task 8: Requests inmutables + acks regenerables con alias

_Requirements: R1.3, R2.3_

Cambios frente al plan v1 (bloqueador 4 de la review): la publicación hace
**fsync del directorio** tras el rename; una `idempotencyKey` duplicada con el
mismo digest registra un **alias** `AppliedRequest` para el requestId nuevo (con
el mismo `resultRef`) — ese requestId también puede regenerar su ack. El ORDEN
de consumo (estado → journal → borrado) es del supervisor (Task 15).

**Files:**
- Create: `cli/src/core/journal/requests.ts`
- Test: `cli/tests/core/journal/requests.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/requests.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { emitRequest, listPendingRequests, applyOutcome, ackFor } from '../../../src/core/journal/requests';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { requestsDir } from '../../../src/core/journal/paths';

describe('requests', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-req-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('emitRequest publica atomico: nunca hay .tmp visible como pendiente (R1.3)', () => {  // verifies R1.3
        const r = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: { argv: ['npm', 'test'] } });
        expect(r.requestId).toMatch(/^req-/);
        const files = fs.readdirSync(requestsDir(repo, 'rama'));
        expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
        expect(listPendingRequests(repo, 'rama')).toHaveLength(1);
    });

    test('request con secreto literal se rechaza sin persistir (R2.3 via emisor)', () => {  // verifies R2.3
        expect(() => emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k2', payload: { argv: ['x', '--token', 'abc'] } }))
            .toThrow(/secreto literal/);
        expect(listPendingRequests(repo, 'rama')).toHaveLength(0);
    });

    test('idempotencyKey repetida: digest distinto se rechaza; mismo digest registra ALIAS con el mismo resultRef (R1.3)', () => {  // verifies R1.3
        const r1 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'test'] } });
        let s = readJournal(repo, 'rama').state!;
        s = applyOutcome(s, { requestId: r1.requestId, idempotencyKey: r1.idempotencyKey, payloadDigest: r1.payloadDigest, outcome: 'applied', resultRef: 'job-1' });
        writeJournal(repo, 'rama', s);
        // ack perdido en disco: se regenera desde state.json
        expect(ackFor(readJournal(repo, 'rama').state!, r1.requestId)!.resultRef).toBe('job-1');
        // misma key + MISMO payload => alias: el requestId nuevo tiene SU entrada con el mismo resultRef
        const r2 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'test'] } });
        const s2 = readJournal(repo, 'rama').state!;
        applyOutcome(s2, { requestId: r2.requestId, idempotencyKey: 'k3', payloadDigest: r2.payloadDigest, outcome: 'applied' });
        expect(ackFor(s2, r2.requestId)).not.toBeNull();
        expect(ackFor(s2, r2.requestId)!.resultRef).toBe('job-1');   // alias regenerable (bloqueador 4)
        // misma key, payload distinto => rechazo explicito
        const r3 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'run', 'otro'] } });
        expect(() => applyOutcome(s2, { requestId: r3.requestId, idempotencyKey: 'k3', payloadDigest: r3.payloadDigest, outcome: 'applied' }))
            .toThrow(/digest/);
    });

    test('replay del MISMO requestId es no-op (R1.3)', () => {              // verifies R1.3
        const s = readJournal(repo, 'rama').state!;
        applyOutcome(s, { requestId: 'req-x', idempotencyKey: 'kx', payloadDigest: 'd', outcome: 'applied', resultRef: 'job-9' });
        applyOutcome(s, { requestId: 'req-x', idempotencyKey: 'kx', payloadDigest: 'd', outcome: 'applied', resultRef: 'job-9' });
        expect(Object.keys(s.appliedRequests)).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/requests.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/requests.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requestsDir } from './paths';
import { findLiteralSecretFlag, redactArgv } from './redact';
import { fsyncDirSync } from '../atomic-file';
import type { AppliedRequest, JournalState } from './types';

export interface RequestEnvelope {
    kind: 'job-request' | 'register-entity' | 'controller-heartbeat' | 'verdict';
    generationToken: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}
export interface EmittedRequest { requestId: string; idempotencyKey: string; payloadDigest: string; file: string; }

export function digestOf(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Publicacion atomica Y durable (R1.3, bloqueador 4): tmp + fsync + close +
 *  rename + fsync del DIRECTORIO. Redaccion EN EL EMISOR; secreto literal en
 *  flag sensible => rechazo sin persistir (R2.3). */
export function emitRequest(repoRoot: string, branch: string, env: RequestEnvelope): EmittedRequest {
    const payload = { ...env.payload };
    if (Array.isArray(payload.argv)) {
        const secretFlag = findLiteralSecretFlag(payload.argv as string[]);
        if (secretFlag !== null) throw new Error(`secreto literal en ${secretFlag}: pasalo por referencia (-env), no por valor`);
        payload.argv = redactArgv(payload.argv as string[]);
    }
    const requestId = `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const body = JSON.stringify({ requestId, ...env, payload }, null, 2) + '\n';
    const dir = requestsDir(repoRoot, branch);
    const tmp = path.join(dir, `.${requestId}.tmp`);
    const final = path.join(dir, `${requestId}.json`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, body);
        fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, final);
    fsyncDirSync(dir);   // la ENTRADA renombrada tambien debe sobrevivir un crash (R1.3)
    return { requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digestOf(payload), file: final };
}

export interface PendingRequest { requestId: string; envelope: RequestEnvelope & { requestId: string }; file: string; corrupt: boolean; }

export function listPendingRequests(repoRoot: string, branch: string): PendingRequest[] {
    const dir = requestsDir(repoRoot, branch);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
        const file = path.join(dir, f);
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || typeof parsed.requestId !== 'string') {
                return { requestId: f, envelope: null as never, file, corrupt: true };
            }
            return { requestId: parsed.requestId, envelope: parsed, file, corrupt: false };
        } catch {
            return { requestId: f, envelope: null as never, file, corrupt: true };
        }
    });
}

/** Registro del resultado en el state (el ack es derivable — R1.3).
 *  - mismo requestId ya registrado => no-op (replay seguro);
 *  - misma idempotencyKey con digest DISTINTO => error explicito;
 *  - misma idempotencyKey con mismo digest => ALIAS: el requestId nuevo
 *    registra SU PROPIA entrada con el mismo outcome/resultRef, para poder
 *    regenerar su ack (bloqueador 4 de la review).
 *  Devuelve el state mutado (el caller es el supervisor, que luego hace
 *  writeJournal — orden estado -> journal -> borrado de archivos). */
export function applyOutcome(state: JournalState, applied: AppliedRequest): JournalState {
    if (state.appliedRequests[applied.requestId] !== undefined) return state;
    const prior = Object.values(state.appliedRequests).find((a) => a.idempotencyKey === applied.idempotencyKey);
    if (prior !== undefined && prior.payloadDigest !== applied.payloadDigest) {
        throw new Error(`idempotencyKey ${applied.idempotencyKey} reutilizada con payload digest distinto`);
    }
    if (prior !== undefined) {
        state.appliedRequests[applied.requestId] = { ...applied, outcome: prior.outcome, resultRef: prior.resultRef };
        return state;
    }
    state.appliedRequests[applied.requestId] = applied;
    return state;
}

export function ackFor(state: JournalState, requestId: string): AppliedRequest | null {
    return state.appliedRequests[requestId] ?? null;
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/requests.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/requests.ts cli/tests/core/journal/requests.test.ts && git commit -m "feat(journal): durable request publication, idempotency aliases, state-derived acks"`

---

### Task 9: exec-wrapper — proceso EXTERNO con handshake durable

_Requirements: R1.8, R2.5, R4.7_

El wrapper NO corre dentro del supervisor (bloqueador 3 de la review): es un
entrypoint CLI propio (`awm job exec-wrapper --job <id> --nonce <n> --logs <dir>
--cwd <dir> -- <cmd...>`, registrado como interno en Task 19) que el supervisor
spawnea **detached** y jamás espera. Handshake durable:

1. **Claim** exclusivo por spawnNonce (`wx` + fsync de archivo Y directorio).
2. **Identity sidecar** `<job>.<nonce>.identity.json` — ProcessRef REAL del
   wrapper Y del comando spawneado, escrito atómicamente (nunca más PID/PGID
   cero persistidos).
3. **Ejecución independiente:** el comando corre en el grupo del wrapper; si el
   supervisor muere, wrapper y comando siguen (lo prueba el E2E de Task 20).
4. **Resultado terminal** atómico junto al claim.

La matriz de replay es LA ÚNICA (R3.3): sin claim ⇒ never-started; claim +
resultado ⇒ completed; claim sin resultado ⇒ unprovable.

**Files:**
- Create: `cli/src/commands/job/exec-wrapper.ts`
- Test: `cli/tests/commands/job/exec-wrapper.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/job/exec-wrapper.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExecWrapper, claimPath, identityPath, resultPath, replayVerdict } from '../../../src/commands/job/exec-wrapper';

describe('exec-wrapper', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrap-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('claim + identity sidecar + resultado terminal atomico (R1.8)', async () => {  // verifies R1.8
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job1', nonce: 'nonceA', argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 300)'], cwd: process.cwd() });
        expect(out.exitCode).toBe(0);
        expect(fs.existsSync(claimPath(dir, 'job1', 'nonceA'))).toBe(true);
        const identity = JSON.parse(fs.readFileSync(identityPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(identity.wrapper.pid).toBe(process.pid);            // ProcessRef REAL del wrapper
        expect(identity.command.pid).toBeGreaterThan(0);           // ProcessRef REAL del comando
        expect(identity.command.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        expect(identity.command.processGroup).toBe(identity.wrapper.processGroup);  // un grupo por job
        const result = JSON.parse(fs.readFileSync(resultPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(result.exitCode).toBe(0);
    });

    test('segundo claim con el mismo nonce falla: exactly-once (R1.8)', async () => {  // verifies R1.8
        await runExecWrapper({ logsRoot: dir, jobId: 'job2', nonce: 'nonceB', argv: ['node', '-e', 'process.exit(0)'], cwd: process.cwd() });
        await expect(runExecWrapper({ logsRoot: dir, jobId: 'job2', nonce: 'nonceB', argv: ['node', '-e', 'process.exit(0)'], cwd: process.cwd() }))
            .rejects.toThrow(/claim/);
    });

    test('comando inexistente produce resultado 127, no crash (R1.8)', async () => {  // verifies R1.8
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job3', nonce: 'nonceC', argv: ['binario-inexistente-xyz'], cwd: process.cwd() });
        expect(out.exitCode).toBe(127);
        expect(replayVerdict(dir, 'job3', 'nonceC')).toBe('completed');
    });

    test('matriz de replay: sin claim / claim+resultado / claim sin resultado (R1.8)', async () => {  // verifies R1.8
        expect(replayVerdict(dir, 'jobX', 'n1')).toBe('never-started');       // sin claim => re-spawn seguro
        await runExecWrapper({ logsRoot: dir, jobId: 'jobY', nonce: 'n2', argv: ['node', '-e', 'process.exit(3)'], cwd: process.cwd() });
        expect(replayVerdict(dir, 'jobY', 'n2')).toBe('completed');           // adoptar resultado
        fs.writeFileSync(claimPath(dir, 'jobZ', 'n3'), '{"claimed":true}');   // claim sin resultado
        expect(replayVerdict(dir, 'jobZ', 'n3')).toBe('unprovable');          // orphaned, jamas relanzar solo
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/job/exec-wrapper.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/commands/job/exec-wrapper.ts
// PROCESO EXTERNO real (bloqueador 3): el supervisor lo spawnea detached y no
// lo espera. Hace el spawn demostrable (design R1.8): claim exclusivo por
// spawnNonce -> identidad real persistida -> ejecucion independiente ->
// resultado terminal atomico. La matriz de replay es LA UNICA (R3.3).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { captureSelfRef, captureRefFor, NONCE_ENV } from '../../core/journal/process';
import { redactText } from '../../core/journal/redact';
import { writeFileAtomicDurable, fsyncDirSync } from '../../core/atomic-file';
import type { ProcessRef } from '../../core/journal/types';

export function claimPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.claim`);
}
export function identityPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.identity.json`);
}
export function resultPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.result.json`);
}
export function logPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.log`);
}

export type ReplayVerdict = 'never-started' | 'completed' | 'unprovable';
export function replayVerdict(logsRoot: string, jobId: string, nonce: string): ReplayVerdict {
    if (!fs.existsSync(claimPath(logsRoot, jobId, nonce))) return 'never-started';
    if (fs.existsSync(resultPath(logsRoot, jobId, nonce))) return 'completed';
    return 'unprovable';
}

export interface WrapperIdentity { jobId: string; nonce: string; wrapper: ProcessRef; command: ProcessRef; }
export interface WrappedResult { exitCode: number; endedAt: string; resultPath: string; }

const MAX_LOG_BYTES = 1024 * 1024;   // retencion acotada (R2.5)

export async function runExecWrapper(opts: { logsRoot: string; jobId: string; nonce: string; argv: string[]; cwd: string }): Promise<WrappedResult> {
    const { logsRoot, jobId, nonce, argv, cwd } = opts;
    if (argv.length === 0) throw new Error('argv vacio');
    fs.mkdirSync(logsRoot, { recursive: true, mode: 0o700 });
    // (1) claim exclusivo DURABLE — wx + fsync de archivo y de directorio
    let fd: number;
    try {
        fd = fs.openSync(claimPath(logsRoot, jobId, nonce), 'wx', 0o600);
    } catch {
        throw new Error(`claim ya existe para ${jobId}/${nonce}: spawn previo no descartable (R1.8)`);
    }
    try {
        fs.writeFileSync(fd, JSON.stringify({ jobId, nonce, claimedAt: new Date().toISOString(), wrapperPid: process.pid }) + '\n');
        fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fsyncDirSync(logsRoot);

    const finish = (exitCode: number): WrappedResult => {
        const result: WrappedResult = { exitCode, endedAt: new Date().toISOString(), resultPath: resultPath(logsRoot, jobId, nonce) };
        // (4) resultado terminal atomico junto al claim
        writeFileAtomicDurable(result.resultPath, JSON.stringify(result, null, 2) + '\n', 0o600);
        return result;
    };

    // (2) spawn del comando EN EL GRUPO DEL WRAPPER (detached:false): un solo
    // process group por job, independiente del supervisor (R4.7: shell:false,
    // argv como array, secretos solo por referencia de entorno).
    const [exe, ...args] = argv;
    const child = spawn(exe, args, {
        cwd, shell: false, detached: false,
        env: { ...process.env, [NONCE_ENV]: nonce },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const spawnFailed: Promise<number | null> = new Promise((resolve) => {
        child.on('error', () => resolve(127));
        child.on('spawn', () => resolve(null));
    });
    const failed = await spawnFailed;
    if (failed !== null || child.pid === undefined) return finish(127);

    // (3) identidad REAL persistida ANTES de esperar el resultado: ProcessRef
    // del wrapper Y del comando (bloqueador 3: nunca mas pid/pgid cero).
    const identity: WrapperIdentity = {
        jobId, nonce,
        wrapper: captureSelfRef(nonce),
        command: captureRefFor(child.pid, nonce, argv),
    };
    writeFileAtomicDurable(identityPath(logsRoot, jobId, nonce), JSON.stringify(identity, null, 2) + '\n', 0o600);

    // ejecucion con salida redactada y acotada (R2.3, R2.5)
    let logged = 0;
    const logFile = logPath(logsRoot, jobId, nonce);
    const append = (chunk: Buffer) => {
        if (logged >= MAX_LOG_BYTES) return;
        const text = redactText(chunk.toString('utf8'));
        logged += Buffer.byteLength(text);
        fs.appendFileSync(logFile, text, { mode: 0o600 });
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const exitCode: number = await new Promise((resolve) => {
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(127));
    });
    return finish(exitCode);
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/exec-wrapper.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/exec-wrapper.ts cli/tests/commands/job/exec-wrapper.test.ts && git commit -m "feat(job): external exec-wrapper with durable claim/identity/result handshake"`

---
### Task 10: ControllerAdapter (codex / claude-code)

_Requirements: R4.8, R4.2b (señal safeToReplace)_

**Files:**
- Create: `cli/src/core/journal/adapter.ts`
- Test: `cli/tests/core/journal/adapter.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/adapter.test.ts
import { adapterFor } from '../../../src/core/journal/adapter';
import { spawnStructured } from '../../../src/core/journal/process';

describe('ControllerAdapter', () => {
    test('adapterFor resuelve codex y claude-code; provider desconocido lanza (R4.8)', () => {  // verifies R4.8
        expect(adapterFor('codex').provider).toBe('codex');
        expect(adapterFor('claude-code').provider).toBe('claude-code');
        expect(() => adapterFor('otro')).toThrow(/provider/);
    });

    test('safeToReplace: muerto probado => safe; vivo => indeterminate, JAMAS safe sin evidencia (R4.2b)', () => {  // verifies R4.2b
        const a = adapterFor('codex');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        expect(a.safeToReplace(deadRef)).toBe('safe');            // identidad no matchea a nadie vivo => muerte probada
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'nA');
        expect(a.safeToReplace(ref)).toBe('indeterminate');        // vivo: codex no observa llamadas en vuelo => custodia
        child.kill('SIGKILL');
    });

    test('launchArgv construye el comando de reanudacion journal-first (R4.8)', () => {  // verifies R4.8
        const argv = adapterFor('codex').launchArgv('retoma desde next_action');
        expect(argv[0]).toBe('codex');
        expect(argv).toContain('exec');
        expect(argv[argv.length - 1]).toContain('next_action');
        const cl = adapterFor('claude-code').launchArgv('retoma desde next_action');
        expect(cl[0]).toBe('claude');
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/adapter.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/adapter.ts
// La logica del supervisor no conoce providers: conoce este contrato (R4.8).
import type { ProcessRef } from './types';
import { refIsAlive, activitySnapshot, ActivitySnapshot } from './process';

export type SafeToReplace = 'safe' | 'indeterminate';

export interface ControllerAdapter {
    provider: 'codex' | 'claude-code';
    /** argv estructurado para lanzar/reanudar el controlador (shell:false). */
    launchArgv(resumePrompt: string): string[];
    /** Actividad observable del process group (null = muerto). */
    activity(ref: ProcessRef): ActivitySnapshot | null;
    /** Señal POSITIVA de reemplazo seguro (R4.2b): 'safe' SOLO con evidencia
     *  (hoy: muerte probada de la identidad completa). Ningun adapter de R1
     *  puede observar llamadas de provider en vuelo, asi que con proceso vivo
     *  SIEMPRE devuelve 'indeterminate' => el supervisor entra en custodia
     *  BLOCKED, no mata. El silencio jamas es prueba. */
    safeToReplace(ref: ProcessRef): SafeToReplace;
}

const RESUME_PROMPT_PREFIX = 'Sos el orquestador SDD de este repo. Corre `awm job reconcile` y ejecuta ';

function baseSafeToReplace(ref: ProcessRef): SafeToReplace {
    return refIsAlive(ref) ? 'indeterminate' : 'safe';
}

const codexAdapter: ControllerAdapter = {
    provider: 'codex',
    launchArgv: (resumePrompt) => ['codex', 'exec', `${RESUME_PROMPT_PREFIX}${resumePrompt}`],
    activity: activitySnapshot,
    safeToReplace: baseSafeToReplace,
};

const claudeAdapter: ControllerAdapter = {
    provider: 'claude-code',
    launchArgv: (resumePrompt) => ['claude', '-p', `${RESUME_PROMPT_PREFIX}${resumePrompt}`],
    activity: activitySnapshot,
    safeToReplace: baseSafeToReplace,
};

export function adapterFor(provider: string): ControllerAdapter {
    if (provider === 'codex') return codexAdapter;
    if (provider === 'claude-code') return claudeAdapter;
    throw new Error(`provider desconocido: ${provider} (validos: codex, claude-code)`);
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/adapter.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/adapter.ts cli/tests/core/journal/adapter.test.ts && git commit -m "feat(journal): ControllerAdapter with positive-evidence safeToReplace"`

---

### Task 11: Verbos del agente — `request`, `controller-heartbeat`, `ps/list/show`

_Requirements: R3.1, R2.3 (via emisor), R3.5 (heartbeat), R1.6 (corrupt visible)_

**Files:**
- Create: `cli/src/commands/job/request.ts`
- Create: `cli/src/commands/job/heartbeat.ts`
- Create: `cli/src/commands/job/query.ts`
- Test: `cli/tests/commands/job/verbs.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/job/verbs.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { requestJob } from '../../../src/commands/job/request';
import { emitHeartbeat } from '../../../src/commands/job/heartbeat';
import { queryPs, queryList, queryShow } from '../../../src/commands/job/query';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { statePath } from '../../../src/core/journal/paths';
import { listPendingRequests } from '../../../src/core/journal/requests';

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

describe('job verbs', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-verbs-')); gitInit(repo); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('requestJob emite request con get-or-create key = hash(fingerprint+cmd) y cwd real (R3.1)', () => {  // verifies R3.1
        const a = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], [], '.');
        const b = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], [], '.');
        expect(a.idempotencyKey).toBe(b.idempotencyKey);      // mismo fingerprint+cmd => misma key (RNF-T.7)
        const c = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], [], 'otro-cwd-logico');
        expect(c.idempotencyKey).not.toBe(a.idempotencyKey);  // cwd distinto => key distinta (R3.4)
        expect(listPendingRequests(repo, 'rama').length).toBe(3);  // el supervisor colapsa por key
    });

    test('emitHeartbeat publica request de heartbeat (R3.5)', () => {      // verifies R3.5
        emitHeartbeat(repo, 'rama', 'gen-1');
        const pending = listPendingRequests(repo, 'rama');
        expect(pending.some((p) => !p.corrupt && p.envelope.kind === 'controller-heartbeat')).toBe(true);
    });

    test('queryPs/list/show reportan corrupt visible, no lo descartan (R1.6)', () => {  // verifies R1.6
        const s = readJournal(repo, 'rama').state!;
        s.jobs['j1'] = {
            id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
            paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing', phaseTimestamps: {},
        };
        writeJournal(repo, 'rama', s);
        expect(queryPs(repo, 'rama').corruptState).toBe(false);
        expect(queryList(repo, 'rama').jobs).toHaveLength(1);
        expect(queryShow(repo, 'rama', 'j1').job!.id).toBe('j1');
        expect(queryShow(repo, 'rama', 'no-existe').job).toBeNull();
        fs.writeFileSync(statePath(repo, 'rama'), '{roto');
        expect(queryPs(repo, 'rama').corruptState).toBe(true);
        expect(queryList(repo, 'rama').corruptState).toBe(true);
        expect(queryShow(repo, 'rama', 'j1').corruptState).toBe(true);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/job/verbs.test.ts` → FAIL.
- [ ] **Step 3: Implementar los tres archivos**

```ts
// cli/src/commands/job/request.ts
import crypto from 'crypto';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { emitRequest, EmittedRequest } from '../../core/journal/requests';

/** El agente NO ejecuta: registra la intencion (design R3.1). La idempotencyKey
 *  es hash(fingerprint + commandDigest) => get-or-create atomico (RNF-T.7).
 *  El cwd relativo REAL es parte del fingerprint (R3.4). `satisfies` enlaza el
 *  job con el item de VerificationPlan que pretende satisfacer (R1.4c). */
export function requestJob(repoRoot: string, branch: string, generationToken: string, argv: string[], paths: string[], cwdRel: string, opts: { satisfies?: string } = {}): EmittedRequest {
    const fp = computeFingerprint(repoRoot, argv, paths, cwdRel);
    const idempotencyKey = crypto.createHash('sha256').update(`${fp.fingerprint}:${fp.commandDigest}`).digest('hex');
    return emitRequest(repoRoot, branch, {
        kind: 'job-request', generationToken, idempotencyKey,
        payload: {
            argv, paths, cwd: cwdRel,
            fingerprint: fp.fingerprint, commandDigest: fp.commandDigest, expandedPaths: fp.expandedPaths,
            ...(opts.satisfies !== undefined ? { satisfies: opts.satisfies } : {}),
        },
    });
}
```

```ts
// cli/src/commands/job/heartbeat.ts
import crypto from 'crypto';
import { emitRequest } from '../../core/journal/requests';

export function emitHeartbeat(repoRoot: string, branch: string, generationToken: string): void {
    emitRequest(repoRoot, branch, {
        kind: 'controller-heartbeat', generationToken,
        idempotencyKey: crypto.randomBytes(8).toString('hex'),   // cada latido es unico
        payload: { at: new Date().toISOString() },
    });
}
```

```ts
// cli/src/commands/job/query.ts
import { readJournal } from '../../core/journal/store';
import { refIsAlive } from '../../core/journal/process';
import type { Job } from '../../core/journal/types';

export interface PsRow { id: string; executionState: string; observationState: string; verdict?: string; alive: boolean | 'sin-pid'; }
export interface PsOutput { corruptState: boolean; jobs: PsRow[]; }

/** Fuente unica de "que hay corriendo": cruza identidad completa contra
 *  procesos vivos. corrupt es VISIBLE, nunca descartado (R1.6). */
export function queryPs(repoRoot: string, branch: string): PsOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, jobs: [] };
    const jobs = Object.values(r.state!.jobs).map((j: Job) => ({
        id: j.id, executionState: j.executionState, observationState: j.observationState, verdict: j.verdict,
        alive: j.processRef ? refIsAlive(j.processRef) : 'sin-pid' as const,
    }));
    return { corruptState: false, jobs };
}

export interface ListRow { id: string; executionState: string; verdict?: string; argv: string[]; satisfies?: string; }
export interface ListOutput { corruptState: boolean; cycleStatus: string | null; jobs: ListRow[]; }

export function queryList(repoRoot: string, branch: string): ListOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, cycleStatus: null, jobs: [] };
    return {
        corruptState: false,
        cycleStatus: r.state!.cycle.status,
        jobs: Object.values(r.state!.jobs).map((j) => ({
            id: j.id, executionState: j.executionState, verdict: j.verdict, argv: j.argv, satisfies: j.satisfies,
        })),
    };
}

export interface ShowOutput { corruptState: boolean; job: Job | null; }

export function queryShow(repoRoot: string, branch: string, jobId: string): ShowOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, job: null };
    return { corruptState: false, job: r.state!.jobs[jobId] ?? null };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/verbs.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/request.ts cli/src/commands/job/heartbeat.ts cli/src/commands/job/query.ts cli/tests/commands/job/verbs.test.ts && git commit -m "feat(job): agent verbs — request intent with real cwd, heartbeat, ps/list/show queries"`

---
### Task 12: `gate` fail-closed completo, `reconcile` (matriz única), `reap`

_Requirements: R3.2, R3.3, R3.6, R2.2, R1.4c, R1.4b_

El gate cierra TODOS los agujeros del bloqueador 5: `CycleVerificationPlan`
vacío bloquea; `satisfiedBy` colgante bloquea; tareas pending/in-progress
bloquean; ciclo `BLOCKED` bloquea; la vigencia del fingerprint se RECOMPUTA
(inyección de `fingerprintNow` — el CLI y el supervisor pasan el
`computeFingerprint` real): evidencia con fingerprint no vigente es histórica y
no certifica (RF-2.8); `requiredVerifiers` (detectados mecánicamente en `watch
--init`, Task 18) no cubiertos bloquean.

**Files:**
- Create: `cli/src/commands/job/gate.ts`
- Create: `cli/src/commands/job/reconcile.ts`
- Create: `cli/src/commands/job/reap.ts`
- Test: `cli/tests/commands/job/gate-reconcile.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/job/gate-reconcile.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeGate, FingerprintNow } from '../../../src/commands/job/gate';
import { reconcileJobs, materializeRetry } from '../../../src/commands/job/reconcile';
import { emptyState, Job, JournalState } from '../../../src/core/journal/types';

function job(partial: Partial<Job>): Job {
    return {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing',
        phaseTimestamps: {}, ...partial,
    };
}

const fpCurrent: FingerprintNow = () => 'fp';        // recomputo == persistido => vigente
const fpStale: FingerprintNow = () => 'fp-cambiado'; // el arbol cambio => historica

/** Estado que SATISFACE el gate: task done, plan de task y de ciclo con pass
 *  vigente, verificador requerido cubierto, cero vivos, cero obligaciones. */
function passingState(): JournalState {
    const s = emptyState('r');
    s.requiredVerifiers = ['test'];
    s.cycleVerificationPlan = [{ id: 'cv1', kind: 'qa', satisfiedBy: 'j2' }];
    s.tasks.push({
        id: 'T1', title: 't', status: 'done', attempts: 1,
        verificationPlan: [{ id: 'v1', kind: 'test', satisfiedBy: 'j1' }], reviewObligations: [],
    });
    s.jobs['j1'] = job({ id: 'j1', executionState: 'exited', verdict: 'pass' });
    s.jobs['j2'] = job({ id: 'j2', executionState: 'exited', verdict: 'pass' });
    return s;
}

describe('gate', () => {
    test('el estado de referencia pasa; la corrupcion bloquea (R3.2)', () => {  // verifies R3.2
        expect(computeGate(passingState(), false, fpCurrent).pass).toBe(true);
        const g = computeGate(null, true, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'corrupt')).toBe(true);
    });

    test('CycleVerificationPlan VACIO bloquea — jamas verde por vacuidad (R1.4b)', () => {  // verifies R1.4b
        const s = passingState();
        s.cycleVerificationPlan = [];
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'empty-cycle-plan')).toBe(true);
    });

    test('satisfiedBy colgante (job inexistente) bloquea (R3.2)', () => {   // verifies R3.2
        const s = passingState();
        s.tasks[0].verificationPlan[0].satisfiedBy = 'job-fantasma';
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'dangling-reference')).toBe(true);
    });

    test('tarea pending o in-progress bloquea (R3.2)', () => {              // verifies R3.2
        const s = passingState();
        s.tasks.push({ id: 'T2', title: 'x', status: 'pending', attempts: 0, verificationPlan: [], reviewObligations: [] });
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'pending-task')).toBe(true);
        s.tasks[1].status = 'in-progress';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'pending-task')).toBe(true);
    });

    test('ciclo BLOCKED bloquea el gate (R3.2)', () => {                     // verifies R3.2
        const s = passingState();
        s.cycle.status = 'BLOCKED';
        s.cycle.blockedReason = 'custodia';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'cycle-blocked')).toBe(true);
    });

    test('fingerprint NO vigente => evidencia historica, bloquea (R1.4c, RF-2.8)', () => {  // verifies R1.4c
        const g = computeGate(passingState(), false, fpStale);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
        // recomputo imposible (null) tampoco certifica
        const g2 = computeGate(passingState(), false, () => null);
        expect(g2.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
    });

    test('solo pass satisface: fail/inconclusive bloquean; sin verdict bloquea (R1.4c)', () => {  // verifies R1.4c
        const s = passingState();
        s.jobs['j1'].verdict = 'fail';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        s.jobs['j1'].verdict = 'inconclusive';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        delete s.jobs['j1'].verdict;
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
    });

    test('item kind review se satisface con VERDICT pass, no con job (R1.4c)', () => {  // verifies R1.4c
        const s = passingState();
        s.tasks[0].verificationPlan.push({ id: 'v2', kind: 'review', satisfiedBy: 'verd-1' });
        s.verdicts.push({ id: 'verd-1', obligationId: 'o1', result: 'pass', detail: 'ok', receivedAt: 'now' });
        expect(computeGate(s, false, fpCurrent).pass).toBe(true);
        s.verdicts[0].result = 'fail';
        const g = computeGate(s, false, fpCurrent);
        expect(g.reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        expect(g.reasons.some((r) => r.category === 'open-fix')).toBe(true);  // adverso sin fix cerrado
    });

    test('item sin satisfacer, job vivo, orphaned y obligacion abierta bloquean (R3.2, R4.5)', () => {  // verifies R4.5
        const s = passingState();
        s.tasks[0].verificationPlan.push({ id: 'v3', kind: 'sensors' });
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'unsatisfied-plan')).toBe(true);
        const s2 = passingState();
        s2.jobs['vivo'] = job({ id: 'vivo', executionState: 'running' });
        expect(computeGate(s2, false, fpCurrent).reasons.some((r) => r.category === 'live-job')).toBe(true);
        s2.jobs['vivo'].executionState = 'orphaned';
        expect(computeGate(s2, false, fpCurrent).reasons.some((r) => r.category === 'live-job')).toBe(true);
        const s3 = passingState();
        s3.tasks[0].reviewObligations.push({ id: 'o9', taskId: 'T1', kind: 'spec' });
        expect(computeGate(s3, false, fpCurrent).reasons.some((r) => r.category === 'open-obligation')).toBe(true);
    });

    test('verificador requerido por el repo sin item en ningun plan bloquea (R1.4b, R3.6)', () => {  // verifies R3.6
        const s = passingState();
        s.requiredVerifiers = ['test', 'sensors'];   // el repo tiene suite Y sensors.json
        const g = computeGate(s, false, fpCurrent);  // ningun item kind 'sensors' existe
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'missing-verifier' && /sensors/.test(r.detail))).toBe(true);
    });
});

describe('reconcile — matriz unica R1.8 (R3.3)', () => {
    let logs: string;
    beforeEach(() => { logs = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-')); });
    afterEach(() => { fs.rmSync(logs, { recursive: true, force: true }); });

    test('sin claim => retry; claim+resultado => adoptar; claim sin resultado => orphaned', () => {  // verifies R3.3
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['a'] = job({ id: 'a', executionState: 'spawn-intent', spawnNonce: 'nA', processRef: { ...deadRef, spawnNonce: 'nA' } });
        s.jobs['b'] = job({ id: 'b', executionState: 'running', spawnNonce: 'nB', processRef: { ...deadRef, spawnNonce: 'nB' } });
        s.jobs['c'] = job({ id: 'c', executionState: 'running', spawnNonce: 'nC', processRef: { ...deadRef, spawnNonce: 'nC' } });
        // b: claim + resultado => adoptar
        fs.writeFileSync(path.join(logs, 'b.nB.claim'), '{}');
        fs.writeFileSync(path.join(logs, 'b.nB.result.json'), JSON.stringify({ exitCode: 0, endedAt: 'x', resultPath: 'p' }));
        // c: claim sin resultado => orphaned
        fs.writeFileSync(path.join(logs, 'c.nC.claim'), '{}');
        const out = reconcileJobs(s, logs);
        expect(out.decisions.find((d) => d.jobId === 'a')!.action).toBe('retry-new-attempt');
        expect(out.decisions.find((d) => d.jobId === 'b')!.action).toBe('adopt-result');
        expect(s.jobs['b'].executionState).toBe('exited');
        expect(s.jobs['b'].verdict).toBe('pass');
        expect(out.decisions.find((d) => d.jobId === 'c')!.action).toBe('orphaned-authorization-required');
        expect(s.jobs['c'].executionState).toBe('orphaned');
    });

    test('materializeRetry crea Attempt NUEVO enlazado, nunca reutiliza (R1.7)', () => {  // verifies R1.7
        const s = emptyState('r');
        s.jobs['a'] = job({ id: 'a', executionState: 'spawn-intent', spawnNonce: 'nA' });
        const nuevo = materializeRetry(s, 'a');
        expect(s.jobs['a'].executionState).toBe('cancelled');       // el intento viejo se retira
        expect(nuevo.attemptOf).toBe('a');
        expect(nuevo.executionState).toBe('received');
        expect(nuevo.spawnNonce).toBeUndefined();                   // nonce fresco lo asigna el runner
        expect(s.jobs[nuevo.id]).toBe(nuevo);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/job/gate-reconcile.test.ts` → FAIL.
- [ ] **Step 3: Implementar los tres archivos**

```ts
// cli/src/commands/job/gate.ts
// Interlock mecanico (design R3.2): falla CERRADO. Solo `pass` con fingerprint
// VIGENTE satisface (R1.4c, RF-2.8). Cada agujero del bloqueador 5 de la
// review tiene su categoria propia — nada aprueba por vacuidad ni por
// referencia falsa.
import type { JournalState, VerificationItem, VerificationKind } from '../../core/journal/types';

export type GateCategory =
    | 'corrupt' | 'cycle-blocked' | 'live-job' | 'pending-task'
    | 'empty-cycle-plan' | 'missing-verifier' | 'dangling-reference'
    | 'unsatisfied-plan' | 'adverse-verdict' | 'stale-fingerprint'
    | 'open-obligation' | 'open-fix';
export interface GateReason { category: GateCategory; detail: string; }
export interface GateResult { pass: boolean; reasons: GateReason[]; }

/** Recomputo de vigencia inyectado: el CLI/supervisor pasan computeFingerprint
 *  real; null = no demostrable => NO certifica. */
export type FingerprintNow = (argv: string[], paths: string[], cwd: string) => string | null;

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export function computeGate(state: JournalState | null, corrupt: boolean, fingerprintNow: FingerprintNow): GateResult {
    const reasons: GateReason[] = [];
    if (corrupt || state === null) {
        return { pass: false, reasons: [{ category: 'corrupt', detail: 'state.json corrupto o ilegible: la corrupcion jamas certifica' }] };
    }
    if (state.cycle.status === 'BLOCKED') {
        reasons.push({ category: 'cycle-blocked', detail: `ciclo BLOCKED: ${state.cycle.blockedReason ?? 'sin razon registrada'}` });
    }
    for (const j of Object.values(state.jobs)) {
        if (LIVE.includes(j.executionState) || j.executionState === 'orphaned') {
            reasons.push({ category: 'live-job', detail: `job ${j.id} en ${j.executionState}` });
        }
    }
    for (const t of state.tasks) {
        if (t.status !== 'done') {
            reasons.push({ category: 'pending-task', detail: `task ${t.id} en ${t.status}` });
        }
    }
    if (state.cycleVerificationPlan.length === 0) {
        reasons.push({ category: 'empty-cycle-plan', detail: 'CycleVerificationPlan vacio: un ciclo sin plan de cierre jamas certifica (R1.4b)' });
    }
    // Verificadores requeridos por la config REAL del repo (watch --init):
    // cada kind requerido debe existir en algun plan (R1.4b, R3.6).
    const allPlans: VerificationItem[] = [...state.tasks.flatMap((t) => t.verificationPlan), ...state.cycleVerificationPlan];
    const presentKinds = new Set<VerificationKind>(allPlans.map((i) => i.kind));
    for (const required of state.requiredVerifiers) {
        if (!presentKinds.has(required)) {
            reasons.push({ category: 'missing-verifier', detail: `el repo exige verificador '${required}' y ningun plan lo contiene` });
        }
    }
    for (const item of allPlans) {
        if (item.satisfiedBy === undefined) {
            reasons.push({ category: 'unsatisfied-plan', detail: `item ${item.id} (${item.kind}) sin satisfacer` });
            continue;
        }
        if (item.kind === 'review') {
            const v = state.verdicts.find((x) => x.id === item.satisfiedBy);
            if (v === undefined) {
                reasons.push({ category: 'dangling-reference', detail: `item ${item.id} cita verdict inexistente ${item.satisfiedBy}` });
            } else if (v.result !== 'pass') {
                reasons.push({ category: 'adverse-verdict', detail: `item ${item.id} citado por verdict ${v.id} con result ${v.result}` });
            }
            continue;
        }
        const j = state.jobs[item.satisfiedBy];
        if (j === undefined) {
            reasons.push({ category: 'dangling-reference', detail: `item ${item.id} cita job inexistente ${item.satisfiedBy}` });
            continue;
        }
        if (j.verdict !== 'pass') {
            reasons.push({ category: 'adverse-verdict', detail: `item ${item.id} citado por ${item.satisfiedBy} con verdict ${j.verdict ?? 'ausente'}` });
            continue;
        }
        // Vigencia (RF-2.8): recomputar con argv/paths/cwd del job y comparar.
        const now = fingerprintNow(j.argv, j.paths, j.cwd);
        if (now === null || now !== j.fingerprint) {
            reasons.push({ category: 'stale-fingerprint', detail: `item ${item.id}: la evidencia de ${j.id} es historica (fingerprint ${now === null ? 'no recomputable' : 'cambiado'}) — no certifica` });
        }
    }
    for (const t of state.tasks) {
        for (const o of t.reviewObligations) {
            if (o.verdictId === undefined) reasons.push({ category: 'open-obligation', detail: `obligacion ${o.id} sin verdict` });
        }
    }
    for (const v of state.verdicts) {
        if (v.result !== 'pass') {
            const fix = state.fixes.find((f) => f.verdictId === v.id);
            if (fix === undefined || !fix.closed) reasons.push({ category: 'open-fix', detail: `verdict adverso ${v.id} sin fix cerrado` });
        }
    }
    return { pass: reasons.length === 0, reasons };
}
```

```ts
// cli/src/commands/job/reconcile.ts
// LA UNICA matriz de recuperacion (design R3.3 = R1.8, sin excepciones).
import fs from 'fs';
import crypto from 'crypto';
import type { Job, JournalState } from '../../core/journal/types';
import { refIsAlive } from '../../core/journal/process';
import { replayVerdict, resultPath } from './exec-wrapper';

export type ReconcileAction = 'still-alive' | 'retry-new-attempt' | 'adopt-result' | 'orphaned-authorization-required';
export interface ReconcileDecision { jobId: string; action: ReconcileAction; }
export interface ReconcileOutput { decisions: ReconcileDecision[]; }

const NON_TERMINAL = ['spawn-intent', 'claimed', 'running', 'cancel-requested'];

export interface ReconcileOpts {
    /** El runner excluye jobs dentro de su ventana de gracia post-spawn (el
     *  wrapper puede no haber claimeado AUN); default: todos elegibles. */
    eligible?: (j: Job) => boolean;
}

export function reconcileJobs(state: JournalState, logsRoot: string, opts: ReconcileOpts = {}): ReconcileOutput {
    const eligible = opts.eligible ?? (() => true);
    const decisions: ReconcileDecision[] = [];
    for (const j of Object.values(state.jobs)) {
        if (!NON_TERMINAL.includes(j.executionState)) continue;
        if (!eligible(j)) continue;
        const anyAlive = (j.processRef !== undefined && refIsAlive(j.processRef))
            || (j.wrapperRef !== undefined && refIsAlive(j.wrapperRef));
        if (anyAlive) {
            decisions.push({ jobId: j.id, action: 'still-alive' });
            continue;
        }
        const nonce = j.spawnNonce ?? j.processRef?.spawnNonce ?? 'sin-nonce';
        const verdict = replayVerdict(logsRoot, j.id, nonce);
        if (verdict === 'never-started') {
            decisions.push({ jobId: j.id, action: 'retry-new-attempt' });   // seguro: nunca ejecuto
        } else if (verdict === 'completed') {
            const result = JSON.parse(fs.readFileSync(resultPath(logsRoot, j.id, nonce), 'utf8'));
            j.executionState = 'exited';
            j.result = result;
            j.verdict = result.exitCode === 0 ? 'pass' : 'fail';
            j.phaseTimestamps.exited = j.phaseTimestamps.exited ?? new Date().toISOString();
            decisions.push({ jobId: j.id, action: 'adopt-result' });
        } else {
            j.executionState = 'orphaned';                                   // jamas relanzar solo (R1.8)
            decisions.push({ jobId: j.id, action: 'orphaned-authorization-required' });
        }
    }
    return { decisions };
}

/** Re-reclamar = Attempt NUEVO enlazado, nunca reutilizar (R1.7). El job viejo
 *  queda 'cancelled' (su intent se retira); el nuevo nace 'received' sin nonce
 *  — el runner le asigna uno fresco en spawn-intent. */
export function materializeRetry(state: JournalState, jobId: string): Job {
    const old = state.jobs[jobId];
    if (old === undefined) throw new Error(`job desconocido: ${jobId}`);
    old.executionState = 'cancelled';
    const fresh: Job = {
        ...old,
        id: `${old.id}-a${crypto.randomBytes(3).toString('hex')}`,
        executionState: 'received',
        observationState: 'progressing',
        spawnNonce: undefined, processRef: undefined, wrapperRef: undefined,
        verdict: undefined, result: undefined,
        phaseTimestamps: { received: new Date().toISOString() },
        attemptOf: old.id,
    };
    state.jobs[fresh.id] = fresh;
    return fresh;
}
```

```ts
// cli/src/commands/job/reap.ts
// Limpieza explicita (design R2.2): lista primero, valida identidad COMPLETA,
// actua despues. No escribe estado canonico: la convergencia la observa el
// supervisor (single-writer) via reconcile.
import type { JournalState } from '../../core/journal/types';
import { refIsAlive, terminateGroupConfirmed } from '../../core/journal/process';

export interface ReapPlanEntry { jobId: string; pid: number; aliveWithIdentity: boolean; }

export function planReap(state: JournalState): ReapPlanEntry[] {
    return Object.values(state.jobs)
        .filter((j) => j.processRef !== undefined)
        .map((j) => ({ jobId: j.id, pid: j.processRef!.pid, aliveWithIdentity: refIsAlive(j.processRef!) }));
}

export async function executeReap(state: JournalState, jobIds: string[]): Promise<string[]> {
    const killed: string[] = [];
    for (const id of jobIds) {
        const j = state.jobs[id];
        if (j?.processRef === undefined) continue;
        if (!refIsAlive(j.processRef)) continue;   // identidad no confirmada => ni una senial (R2.1)
        const dead = await terminateGroupConfirmed(j.processRef, { termGraceMs: 3000, killGraceMs: 2000 });
        if (dead) killed.push(id);
    }
    return killed;
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/gate-reconcile.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/gate.ts cli/src/commands/job/reconcile.ts cli/src/commands/job/reap.ts cli/tests/commands/job/gate-reconcile.test.ts && git commit -m "feat(job): fail-closed gate with fingerprint currency, single recovery matrix, explicit reap"`

---
### Task 13: Export del ciclo (RNF-T.4/T.8/T.9 + baseline)

_Requirements: R3.7, R7.1_

Extiende el export (importante 3 de la review): timestamps por fase, wall time
por task y por ciclo, despachos REALES (entidades registradas, no proxies),
hash + comando de reproducción por evidencia, y `baselineComparison` contra el
baseline 2026-07-29 — con `'unobservable'` declarado donde el provider o el
baseline no reportan la métrica, nunca un cero inventado.

**Files:**
- Create: `cli/src/commands/job/export.ts`
- Test: `cli/tests/commands/job/export.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/job/export.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { buildExport } from '../../../src/commands/job/export';
import { emptyState, Job } from '../../../src/core/journal/types';

function job(partial: Partial<Job>): Job {
    return {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'exited', observationState: 'progressing',
        phaseTimestamps: {}, ...partial,
    };
}

describe('export', () => {
    let logs: string;
    beforeEach(() => { logs = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-exp-')); });
    afterEach(() => { fs.rmSync(logs, { recursive: true, force: true }); });

    test('schema, timestamps por fase, wall time por task y ciclo (R3.7 / RNF-T.4)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.cycle.startedAt = '2026-08-01T10:00:00.000Z';
        s.cycle.completedAt = '2026-08-01T10:30:00.000Z';
        s.tasks.push({ id: 'T1', title: 't', status: 'done', attempts: 2, verificationPlan: [], reviewObligations: [], createdAt: '2026-08-01T10:00:00.000Z', completedAt: '2026-08-01T10:10:00.000Z' });
        s.tasks.push({ id: 'T2', title: 'sin-timestamps', status: 'done', attempts: 1, verificationPlan: [], reviewObligations: [] });
        s.jobs['j1'] = job({ phaseTimestamps: { received: 'a', running: 'b', exited: 'c' } });
        const e = buildExport(s, 'codex', { logsRoot: null, baseline: null });
        expect(e.schema).toBe(2);
        expect(e.cycle.wallTimeMs).toBe(30 * 60000);
        expect(e.tasks[0].wallTimeMs).toBe(10 * 60000);
        expect(e.tasks[1].wallTimeMs).toBe('unobservable');           // sin timestamps => declarado, no cero
        expect(e.jobs[0].phaseTimestamps.running).toBe('b');
    });

    test('despachos REALES, dedup real, evidencia con hash + comando reproducible (RNF-T.8/T.9)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.dispatches.push({ id: 'd1', taskId: 'T1', at: 'x' }, { id: 'd2', taskId: 'T1', at: 'y' });
        s.jobs['j1'] = job({ id: 'j1', spawnNonce: 'n1' });
        s.jobs['j2'] = job({ id: 'j2', spawnNonce: 'n2' });           // mismo fingerprint+cmd => dedup
        const resultBody = JSON.stringify({ exitCode: 0, endedAt: 'x', resultPath: 'p' });
        fs.writeFileSync(path.join(logs, 'j1.n1.result.json'), resultBody);
        const e = buildExport(s, 'codex', { logsRoot: logs, baseline: null });
        expect(e.metrics.dispatches).toBe(2);                          // reales, no attempts-proxy
        expect(e.metrics.mechanicalRunsReal).toBe(2);
        expect(e.metrics.mechanicalRunsDeduplicated).toBe(1);
        expect(e.jobs.find((j) => j.id === 'j2')!.deduplicated).toBe(true);
        const ev1 = e.evidence.find((x) => x.jobId === 'j1')!;
        expect(ev1.resultHash).toBe(crypto.createHash('sha256').update(resultBody).digest('hex'));
        expect(ev1.reproduce).toContain('npm test');
        expect(e.evidence.find((x) => x.jobId === 'j2')!.resultHash).toBe('unobservable');  // sin result file
    });

    test('baselineComparison: con baseline compara, sin baseline declara unobservable (R3.7)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.cycle.startedAt = '2026-08-01T10:00:00.000Z';
        s.cycle.completedAt = '2026-08-01T10:20:00.000Z';
        s.dispatches.push({ id: 'd1', taskId: 'T1', at: 'x' });
        const withBase = buildExport(s, 'codex', { logsRoot: null, baseline: { source: 'docs/baseline-2026-07-29.json', wallTimeMs: 40 * 60000, dispatches: 3 } });
        expect(withBase.baselineComparison.baselineDate).toBe('2026-07-29');
        expect(withBase.baselineComparison.wallTimeMs).toEqual({ current: 20 * 60000, baseline: 40 * 60000, delta: -20 * 60000 });
        expect(withBase.baselineComparison.dispatches).toEqual({ current: 1, baseline: 3, delta: -2 });
        expect(withBase.baselineComparison.tokensPerRole).toBe('unobservable');  // ningun provider lo reporta (R0)
        const noBase = buildExport(s, 'codex', { logsRoot: null, baseline: null });
        expect(noBase.baselineComparison.wallTimeMs.baseline).toBe('unobservable');
        expect(noBase.baselineComparison.wallTimeMs.delta).toBe('unobservable');
        expect(noBase.metrics.tokensPerRole).toBe('unobservable');
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/job/export.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/commands/job/export.ts
// Export sanitizado y versionado (design R3.7, RNF-T.4/T.8/T.9): reproducible
// desde checkout limpio; lo que el provider/baseline no reporta se declara
// 'unobservable' — jamas un cero inventado.
import fs from 'fs';
import crypto from 'crypto';
import type { JournalState } from '../../core/journal/types';
import { resultPath } from './exec-wrapper';

export interface EvidenceEntry { jobId: string; resultHash: string | 'unobservable'; reproduce: string; }
export interface MetricComparison {
    current: number | 'unobservable';
    baseline: number | 'unobservable';
    delta: number | 'unobservable';
}
export interface BaselineMetrics { source: string; wallTimeMs?: number; dispatches?: number; mechanicalRuns?: number; }

export interface CycleExport {
    schema: 2;
    provider: string;
    branch: string;
    generatedBy: 'awm job export';
    cycle: { status: string; startedAt: string; completedAt: string | 'unobservable'; wallTimeMs: number | 'unobservable' };
    tasks: Array<{ id: string; status: string; attempts: number; createdAt: string | 'unobservable'; completedAt: string | 'unobservable'; wallTimeMs: number | 'unobservable' }>;
    jobs: Array<{ id: string; fingerprint: string; executionState: string; verdict?: string; phaseTimestamps: Record<string, string>; deduplicated: boolean }>;
    evidence: EvidenceEntry[];
    metrics: {
        dispatches: number;                 // DispatchRecord reales (RNF-T.8)
        mechanicalRunsReal: number;
        mechanicalRunsDeduplicated: number;
        tokensPerRole: 'unobservable' | Record<string, number>;
    };
    baselineComparison: {
        baselineDate: '2026-07-29';
        source: string | 'unobservable';
        wallTimeMs: MetricComparison;
        dispatches: MetricComparison;
        mechanicalRuns: MetricComparison;
        tokensPerRole: 'unobservable';
    };
}

function wallMs(from?: string, to?: string): number | 'unobservable' {
    if (from === undefined || to === undefined) return 'unobservable';
    const a = Date.parse(from); const b = Date.parse(to);
    if (Number.isNaN(a) || Number.isNaN(b)) return 'unobservable';
    return b - a;
}

function compare(current: number | 'unobservable', baseline: number | undefined): MetricComparison {
    const base = baseline ?? 'unobservable';
    if (current === 'unobservable' || base === 'unobservable') return { current, baseline: base, delta: 'unobservable' };
    return { current, baseline: base, delta: current - base };
}

export function buildExport(state: JournalState, provider: string, opts: { logsRoot: string | null; baseline: BaselineMetrics | null }): CycleExport {
    const jobs = Object.values(state.jobs);
    const seen = new Set<string>();
    const jobRows = jobs.map((j) => {
        const k = `${j.fingerprint}:${j.commandDigest}`;
        const deduplicated = seen.has(k);
        seen.add(k);
        return { id: j.id, fingerprint: j.fingerprint, executionState: j.executionState, verdict: j.verdict, phaseTimestamps: j.phaseTimestamps as Record<string, string>, deduplicated };
    });
    const evidence: EvidenceEntry[] = jobs.map((j) => {
        let resultHash: string | 'unobservable' = 'unobservable';
        if (opts.logsRoot !== null && j.spawnNonce !== undefined) {
            try {
                resultHash = crypto.createHash('sha256').update(fs.readFileSync(resultPath(opts.logsRoot, j.id, j.spawnNonce), 'utf8')).digest('hex');
            } catch { resultHash = 'unobservable'; }
        }
        // argv ya redactado por el emisor: reproducible sin secretos (R2.3)
        return { jobId: j.id, resultHash, reproduce: `cd ${j.cwd} && ${j.argv.join(' ')}` };
    });
    const cycleWall = wallMs(state.cycle.startedAt, state.cycle.completedAt);
    const mechanicalRuns = jobRows.filter((j) => !j.deduplicated).length;
    return {
        schema: 2, provider, branch: state.branch, generatedBy: 'awm job export',
        cycle: {
            status: state.cycle.status,
            startedAt: state.cycle.startedAt,
            completedAt: state.cycle.completedAt ?? 'unobservable',
            wallTimeMs: cycleWall,
        },
        tasks: state.tasks.map((t) => ({
            id: t.id, status: t.status, attempts: t.attempts,
            createdAt: t.createdAt ?? 'unobservable',
            completedAt: t.completedAt ?? 'unobservable',
            wallTimeMs: wallMs(t.createdAt, t.completedAt),
        })),
        jobs: jobRows,
        evidence,
        metrics: {
            dispatches: state.dispatches.length,
            mechanicalRunsReal: jobs.length,
            mechanicalRunsDeduplicated: jobs.length - mechanicalRuns,
            tokensPerRole: 'unobservable',   // ningun provider lo expone mecanicamente hoy (R0)
        },
        baselineComparison: {
            baselineDate: '2026-07-29',
            source: opts.baseline?.source ?? 'unobservable',
            wallTimeMs: compare(cycleWall, opts.baseline?.wallTimeMs),
            dispatches: compare(state.dispatches.length, opts.baseline?.dispatches),
            mechanicalRuns: compare(mechanicalRuns, opts.baseline?.mechanicalRuns),
            tokensPerRole: 'unobservable',
        },
    };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/export.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/export.ts cli/tests/commands/job/export.test.ts && git commit -m "feat(job): cycle export with phase timestamps, real dispatch counts, evidence hashes, baseline comparison"`

---

### Task 14: Lock exclusivo (`wx`) + branch invariant

_Requirements: R4.1, R1.1_

Supervisor split 1/7. La adquisición usa **creación exclusiva real** (`open wx`
— bloqueador 6: `existsSync`+write permitía la carrera). En `EEXIST`: leer +
validar identidad COMPLETA; vivo ⇒ throw; muerto PROBADO ⇒ rm + reintentar `wx`
UNA vez; ilegible/shape inválido ⇒ `LockBlockedError` (error DISTINTO — jamás
reclamar identidad indemostrable). El branch invariant (R1.1) bloquea
gate/reconcile/watch si la rama actual del worktree no coincide con la del
journal.

**Files:**
- Create: `cli/src/commands/watch/lock.ts`
- Test: `cli/tests/commands/watch/lock.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/watch/lock.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { acquireLock, releaseLock, verifyBranchInvariant, LockBlockedError } from '../../../src/commands/watch/lock';
import { supervisorLockPath } from '../../../src/core/journal/paths';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

describe('supervisor lock + branch invariant', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-lock-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('adquisicion exclusiva: la segunda falla con supervisor vivo (R4.1)', () => {  // verifies R4.1
        const l1 = acquireLock(repo);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);
        expect(() => acquireLock(repo)).toThrow(/supervisor activo/);
        releaseLock(repo, l1);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
    });

    test('lock con identidad muerta PROBADA se reclama con reintento unico (R4.1)', () => {  // verifies R4.1
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), JSON.stringify({
            pid: 999999, startTime: 'gone', spawnNonce: 'x', argvDigest: 'y', processGroup: 999999, psArgsDigest: 'z',
        }));
        const l = acquireLock(repo);
        expect(l.ref.pid).toBe(process.pid);
        releaseLock(repo, l);
    });

    test('lock ilegible o con shape invalido => LockBlockedError, JAMAS se reclama (R4.1)', () => {  // verifies R4.1
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), '{json roto');
        expect(() => acquireLock(repo)).toThrow(LockBlockedError);
        fs.writeFileSync(supervisorLockPath(repo), JSON.stringify({ pid: 1 }));   // shape parcial
        expect(() => acquireLock(repo)).toThrow(LockBlockedError);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);   // sigue ahi: nadie lo piso
    });

    test('branch invariant: discrepancia rama-journal => BLOCKED (R1.1)', () => {  // verifies R1.1
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        expect(() => verifyBranchInvariant(repo, 'main')).not.toThrow();
        git(repo, 'checkout', '-qb', 'otra');
        expect(() => verifyBranchInvariant(repo, 'main')).toThrow(/BLOCKED/);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/watch/lock.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/commands/watch/lock.ts
// Exclusion fisica de supervisores (R4.1): un solo writer por worktree FISICO.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { supervisorLockPath } from '../../core/journal/paths';
import { captureSelfRef, refIsAlive } from '../../core/journal/process';
import { isWellFormedProcessRef, ProcessRef } from '../../core/journal/types';
import { fsyncDirSync } from '../../core/atomic-file';

/** Identidad indemostrable en el lock: BLOQUEAR con error DISTINTO — el
 *  operador decide con evidencia; el codigo jamas reclama lo que no puede
 *  probar muerto (bloqueador 6 de la review). */
export class LockBlockedError extends Error {
    constructor(message: string) { super(message); this.name = 'LockBlockedError'; }
}

export interface LockHandle { ref: ProcessRef; path: string; }

export function acquireLock(repoRoot: string): LockHandle {
    const lp = supervisorLockPath(repoRoot);
    fs.mkdirSync(path.dirname(lp), { recursive: true, mode: 0o700 });
    const self = captureSelfRef(crypto.randomBytes(8).toString('hex'));
    const body = JSON.stringify(self, null, 2) + '\n';
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lp, 'wx', 0o600);   // creacion EXCLUSIVA real: sin ventana existsSync/write
            try {
                fs.writeFileSync(fd, body);
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            fsyncDirSync(path.dirname(lp));
            return { ref: self, path: lp };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        // EEXIST: leer + validar identidad COMPLETA
        let prior: unknown;
        try {
            prior = JSON.parse(fs.readFileSync(lp, 'utf8'));
        } catch {
            throw new LockBlockedError(`lock ilegible en ${lp}: identidad indemostrable — BLOQUEADO (no se reclama; intervencion manual con evidencia)`);
        }
        if (!isWellFormedProcessRef(prior)) {
            throw new LockBlockedError(`lock con shape invalido en ${lp}: identidad indemostrable — BLOQUEADO (no se reclama)`);
        }
        if (refIsAlive(prior)) {
            throw new Error(`supervisor activo (pid ${prior.pid}) sobre este worktree`);
        }
        // Muerto PROBADO (la tupla completa no matchea a ningun proceso vivo):
        // rm + reintento wx UNA sola vez — si la carrera persiste, error.
        process.stderr.write('awm watch: lock previo con identidad muerta probada — reclamando\n');
        fs.rmSync(lp, { force: true });
    }
    throw new Error('no se pudo adquirir el lock tras reintento unico (carrera persistente)');
}

export function releaseLock(repoRoot: string, handle: LockHandle): void {
    const lp = supervisorLockPath(repoRoot);
    try {
        const onDisk = JSON.parse(fs.readFileSync(lp, 'utf8')) as ProcessRef;
        if (onDisk.spawnNonce === handle.ref.spawnNonce) fs.rmSync(lp);
    } catch { /* ya ausente o ilegible: no tocar lo que no es nuestro */ }
}

/** WHILE el supervisor este activo, el cambio de rama del worktree se bloquea:
 *  gate/reconcile/watch verifican rama actual == rama del journal (R1.1). */
export function verifyBranchInvariant(repoRoot: string, journalBranch: string): void {
    const current = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (current !== journalBranch) {
        throw new Error(`BLOCKED: rama actual (${current}) != rama del journal (${journalBranch}) — cambio de rama con journal activo (R1.1)`);
    }
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/watch/lock.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/watch/lock.ts cli/tests/commands/watch/lock.test.ts && git commit -m "feat(watch): exclusive wx lock with full-identity validation and branch invariant"`

---
### Task 15: Aplicación transaccional de requests (estado → journal → borrado)

_Requirements: R1.3, R1.4, R1.4b, R1.4c, R4.6_

Supervisor split 2/7. Cierra el bloqueador 4: el archivo de request se borra
**DESPUÉS** de persistir `state.json` (orden: mutar estado → `writeJournal` →
borrar → fsync del directorio). Un crash entre journal y borrado es inocuo: el
replay ve el `requestId` ya registrado y solo borra. Cierra también parte del
bloqueador 5: `register-entity` **CREA** las entidades (Task + VerificationPlan
+ ReviewObligations; cycle-plan; dispatch; task-status) y `verdict` crea el
Verdict + FixObligation automática si es adverso — en la MISMA escritura de
estado.

**Files:**
- Create: `cli/src/commands/watch/apply.ts`
- Test: `cli/tests/commands/watch/apply.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/watch/apply.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { emitRequest } from '../../../src/core/journal/requests';
import { initJournal, readJournal } from '../../../src/core/journal/store';
import { requestsDir } from '../../../src/core/journal/paths';

function jobPayload(argv: string[]): Record<string, unknown> {
    return { argv, paths: [], cwd: '.', fingerprint: 'fp-1', commandDigest: 'cd-1', expandedPaths: [] };
}

describe('aplicacion transaccional de requests', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-apply-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('orden estado->journal->borrado; replay tras crash NO re-aplica (R1.3)', () => {  // verifies R1.3
        const r1 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: jobPayload(['npm', 'test']) });
        const file = r1.file;
        const savedBody = fs.readFileSync(file, 'utf8');       // copia para simular crash pre-borrado
        const out1 = consumePendingRequests(repo, 'rama', 'g1');
        expect(out1.applied).toBe(1);
        expect(fs.existsSync(file)).toBe(false);               // borrado DESPUES del journal
        const s1 = readJournal(repo, 'rama').state!;
        expect(Object.keys(s1.jobs)).toHaveLength(1);
        expect(s1.appliedRequests[r1.requestId].resultRef).toBe(Object.keys(s1.jobs)[0]);
        // CRASH SIMULADO: el journal persistio pero el archivo NO se borro — lo restauramos
        fs.writeFileSync(file, savedBody);
        const out2 = consumePendingRequests(repo, 'rama', 'g1');
        expect(out2.applied).toBe(0);                          // requestId ya registrado: no re-aplica
        expect(fs.existsSync(file)).toBe(false);               // solo borra
        expect(Object.keys(readJournal(repo, 'rama').state!.jobs)).toHaveLength(1);  // sin duplicados
    });

    test('register-entity CREA task con VerificationPlan y ReviewObligations; cycle-plan y dispatch (R1.4/R1.4b)', () => {  // verifies R1.4b
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: {
                entity: 'task', taskId: 'T1', title: 'implementar',
                verificationPlan: [{ id: 'v1', kind: 'test' }],
                reviewObligations: [{ id: 'o1', kind: 'spec' }],
            },
        });
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] },
        });
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e3',
            payload: { entity: 'dispatch', dispatchId: 'd1', taskId: 'T1' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        expect(s.tasks).toHaveLength(1);
        expect(s.tasks[0].verificationPlan).toEqual([{ id: 'v1', kind: 'test' }]);
        expect(s.tasks[0].reviewObligations).toEqual([{ id: 'o1', taskId: 'T1', kind: 'spec' }]);
        expect(s.tasks[0].status).toBe('pending');
        expect(typeof s.tasks[0].createdAt).toBe('string');
        expect(s.cycleVerificationPlan).toEqual([{ id: 'cv1', kind: 'qa' }]);
        expect(s.dispatches).toHaveLength(1);
        expect(s.tasks[0].attempts).toBe(1);                    // dispatch real incrementa attempts
    });

    test('verdict adverso crea Verdict + FixObligation en la MISMA escritura (R1.4c)', () => {  // verifies R1.4c
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [], reviewObligations: [{ id: 'o1', kind: 'spec' }] },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const revBefore = readJournal(repo, 'rama').state!.revision;
        emitRequest(repo, 'rama', {
            kind: 'verdict', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { verdictId: 'verd-1', obligationId: 'o1', result: 'fail', detail: 'rompe X' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        expect(s.revision).toBe(revBefore + 1);                 // UNA escritura para verdict + fix
        expect(s.verdicts).toHaveLength(1);
        expect(s.fixes).toEqual([{ id: 'fix-verd-1', verdictId: 'verd-1', closed: false }]);
        expect(s.tasks[0].reviewObligations[0].verdictId).toBe('verd-1');
    });

    test('job-request enlaza satisfies con el item del plan (R1.4c)', () => {  // verifies R1.4c
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }], reviewObligations: [] },
        });
        emitRequest(repo, 'rama', {
            kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1',
            payload: { ...jobPayload(['npm', 'test']), satisfies: 'v1' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        const jobId = Object.keys(s.jobs)[0];
        expect(s.tasks[0].verificationPlan[0].satisfiedBy).toBe(jobId);
        expect(s.jobs[jobId].satisfies).toBe('v1');
    });

    test('fencing: token de generacion vieja => rejected-stale-generation auditado (R4.6)', () => {  // verifies R4.6
        emitRequest(repo, 'rama', { kind: 'controller-heartbeat', generationToken: 'g-vieja', idempotencyKey: 'hb1', payload: {} });
        const out = consumePendingRequests(repo, 'rama', 'g-nueva');
        expect(out.rejectedStale).toBe(1);
        const s = readJournal(repo, 'rama').state!;
        expect(Object.values(s.appliedRequests).some((a) => a.outcome === 'rejected-stale-generation')).toBe(true);
        expect(s.controllerHeartbeatAt).toBeUndefined();
    });

    test('request corrupta se aparta VISIBLE como .corrupt, jamas se descarta (R1.6)', () => {  // verifies R1.6
        fs.writeFileSync(path.join(requestsDir(repo, 'rama'), 'req-roto.json'), '{no-json');
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out.corrupt).toBe(1);
        const files = fs.readdirSync(requestsDir(repo, 'rama'));
        expect(files.some((f) => f.endsWith('.corrupt'))).toBe(true);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/watch/apply.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/commands/watch/apply.ts
// Consumo transaccional de requests (bloqueador 4): mutar estado ->
// writeJournal -> RECIEN AHI borrar archivos. El replay es seguro por
// requestId + idempotencyKey + digest.
import fs from 'fs';
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { listPendingRequests, applyOutcome, digestOf, RequestEnvelope } from '../../core/journal/requests';
import { requestsDir } from '../../core/journal/paths';
import { fsyncDirSync } from '../../core/atomic-file';
import type { Job, JournalState, ReviewObligation, VerificationItem } from '../../core/journal/types';

export interface ApplySummary { applied: number; rejectedStale: number; corrupt: number; }

function now(): string { return new Date().toISOString(); }

function linkSatisfies(s: JournalState, itemId: string, jobId: string): void {
    const items: VerificationItem[] = [...s.tasks.flatMap((t) => t.verificationPlan), ...s.cycleVerificationPlan];
    const item = items.find((i) => i.id === itemId);
    if (item !== undefined) item.satisfiedBy = jobId;
}

function applyRequestToState(s: JournalState, env: RequestEnvelope & { requestId: string }, digest: string): void {
    const base = { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest };
    if (env.kind === 'controller-heartbeat') {
        s.controllerHeartbeatAt = now();
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'job-request') {
        // get-or-create por idempotencyKey (RNF-T.7); duplicado => applyOutcome
        // registra el ALIAS con el mismo resultRef (Task 8).
        const prior = Object.values(s.appliedRequests).find((a) => a.idempotencyKey === env.idempotencyKey && a.outcome === 'applied');
        if (prior !== undefined) {
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        const p = env.payload;
        const jobId = `job-${Object.keys(s.jobs).length + 1}-${crypto.randomBytes(3).toString('hex')}`;
        const job: Job = {
            id: jobId,
            fingerprint: String(p.fingerprint), commandDigest: String(p.commandDigest),
            argv: p.argv as string[],
            cwd: typeof p.cwd === 'string' ? p.cwd : '.',
            paths: Array.isArray(p.paths) ? p.paths as string[] : [],
            expandedPaths: Array.isArray(p.expandedPaths) ? p.expandedPaths as string[] : [],
            executionState: 'received', observationState: 'progressing',
            phaseTimestamps: { received: now() },
            ...(typeof p.satisfies === 'string' ? { satisfies: p.satisfies } : {}),
        };
        s.jobs[jobId] = job;
        if (typeof p.satisfies === 'string') linkSatisfies(s, p.satisfies, jobId);
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: jobId });
        return;
    }
    if (env.kind === 'register-entity') {
        const p = env.payload;
        if (p.entity === 'task') {
            const taskId = String(p.taskId);
            if (!s.tasks.some((t) => t.id === taskId)) {
                const plan = Array.isArray(p.verificationPlan) ? p.verificationPlan as VerificationItem[] : [];
                const obligations = (Array.isArray(p.reviewObligations) ? p.reviewObligations as Array<{ id: string; kind: 'spec' | 'quality' }> : [])
                    .map((o): ReviewObligation => ({ id: o.id, taskId, kind: o.kind }));
                s.tasks.push({
                    id: taskId, title: String(p.title ?? taskId), status: 'pending', attempts: 0,
                    verificationPlan: plan, reviewObligations: obligations, createdAt: now(),
                });
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: String(p.taskId) });
            return;
        }
        if (p.entity === 'cycle-plan') {
            s.cycleVerificationPlan = Array.isArray(p.items) ? p.items as VerificationItem[] : [];
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        if (p.entity === 'dispatch') {
            const dispatchId = String(p.dispatchId);
            const taskId = String(p.taskId);
            if (!s.dispatches.some((d) => d.id === dispatchId)) {
                s.dispatches.push({ id: dispatchId, taskId, at: now() });
                const task = s.tasks.find((t) => t.id === taskId);
                if (task !== undefined) task.attempts += 1;
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: dispatchId });
            return;
        }
        if (p.entity === 'task-status') {
            const task = s.tasks.find((t) => t.id === String(p.taskId));
            if (task !== undefined) {
                const status = String(p.status);
                if (status === 'pending' || status === 'in-progress' || status === 'done') {
                    task.status = status;
                    if (status === 'done') task.completedAt = now();
                }
            }
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'verdict') {
        const p = env.payload;
        const verdictId = String(p.verdictId);
        if (!s.verdicts.some((v) => v.id === verdictId)) {
            const result = p.result === 'pass' || p.result === 'fail' || p.result === 'inconclusive' ? p.result : 'inconclusive';
            s.verdicts.push({ id: verdictId, obligationId: String(p.obligationId), result, detail: String(p.detail ?? ''), receivedAt: now() });
            for (const t of s.tasks) {
                const o = t.reviewObligations.find((x) => x.id === String(p.obligationId));
                if (o !== undefined) o.verdictId = verdictId;
            }
            // Veredicto adverso => FixObligation ATOMICA: misma mutacion, misma
            // escritura de estado (R1.4c, bloqueador 5).
            if (result !== 'pass') {
                s.fixes.push({ id: `fix-${verdictId}`, verdictId, closed: false });
            }
        }
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: verdictId });
        return;
    }
}

/** Consume TODAS las requests pendientes en orden. ORDEN CRITICO (R1.3,
 *  bloqueador 4): (1) mutar estado, (2) writeJournal, (3) borrar archivos,
 *  (4) fsync del directorio. Solo el supervisor llama esto (single-writer). */
export function consumePendingRequests(repoRoot: string, branch: string, activeToken: string | null): ApplySummary {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const pending = listPendingRequests(repoRoot, branch);
    const processedFiles: string[] = [];
    let applied = 0, rejectedStale = 0, corrupt = 0;
    for (const p of pending) {
        if (p.corrupt) {
            corrupt++;
            fs.renameSync(p.file, `${p.file}.corrupt`);   // visible, jamas descartado (R1.6)
            appendEvent(repoRoot, branch, { kind: 'request-corrupt', file: p.file });
            continue;
        }
        const env = p.envelope;
        const digest = digestOf(env.payload);
        if (s.appliedRequests[env.requestId] !== undefined) {
            // replay tras crash post-journal/pre-borrado: ya aplicada, solo borrar
            processedFiles.push(p.file);
            continue;
        }
        if (activeToken !== null && env.generationToken !== activeToken) {
            applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'rejected-stale-generation' });
            appendEvent(repoRoot, branch, { kind: 'request-rejected-stale', requestId: env.requestId });
            rejectedStale++;
        } else {
            applyRequestToState(s, env, digest);
            applied++;
        }
        processedFiles.push(p.file);
    }
    if (applied + rejectedStale > 0 || processedFiles.length > 0) {
        writeJournal(repoRoot, branch, s);                 // (2) journal ANTES del borrado
    }
    for (const f of processedFiles) fs.rmSync(f, { force: true });   // (3)
    if (processedFiles.length > 0) fsyncDirSync(requestsDir(repoRoot, branch));  // (4)
    return { applied, rejectedStale, corrupt };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/watch/apply.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/watch/apply.ts cli/tests/commands/watch/apply.test.ts && git commit -m "feat(watch): transactional request application — state, journal, then delete; entity-creating handlers"`

---

### Task 16: Runner concurrente + recolección de resultados por scan

_Requirements: R4.4, R1.8, R3.3_

Supervisor split 4/7 (el 3/7 es el wrapper externo de Task 9). El supervisor
spawnea wrappers **detached y NO los espera** (bloqueador 3): cada tick avanza
los jobs escaneando sidecars — claim ⇒ `claimed`, identity ⇒ `running` con
identidad REAL, result ⇒ `exited` + verdict. La reconciliación (matriz única de
Task 12) corre integrada para jobs fuera de su ventana de gracia post-spawn.

**Files:**
- Create: `cli/src/commands/watch/runner.ts`
- Test: `cli/tests/commands/watch/runner.test.ts`

- [ ] **Step 1: Test** (spawner fake in-process: mismo contrato, sin build previo; el spawner real se ejercita en el E2E de Task 20)

```ts
// cli/tests/commands/watch/runner.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnPendingWrappers, collectAndReconcile, runnerTick, WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper, claimPath } from '../../../src/commands/job/exec-wrapper';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { logsDir } from '../../../src/core/journal/paths';
import { Job } from '../../../src/core/journal/types';

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    // Mismo contrato que el spawner real: dispara el wrapper y NO espera.
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: repoRoot }).catch(() => { /* el resultado 127 ya quedo en sidecar */ });
};

async function until(fn: () => boolean, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout esperando condicion');
        await new Promise((r) => setTimeout(r, 50));
    }
}

function seedJob(repo: string, partial: Partial<Job>): string {
    const s = readJournal(repo, 'rama').state!;
    const j: Job = {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['node', '-e', 'process.exit(0)'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing',
        phaseTimestamps: { received: new Date().toISOString() }, ...partial,
    };
    s.jobs[j.id] = j;
    writeJournal(repo, 'rama', s);
    return j.id;
}

describe('runner concurrente', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('spawnPendingWrappers persiste spawn-intent+nonce ANTES del spawn y NO bloquea (R1.8, R4.4)', async () => {  // verifies R4.4
        seedJob(repo, { argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 800)'] });
        const spawned = spawnPendingWrappers(repo, 'rama', fakeSpawner);
        expect(spawned).toBe(1);
        // Retorno INMEDIATO: el job aun no esta exited — el supervisor no espero
        const mid = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(['spawn-intent', 'claimed', 'running']).toContain(mid.executionState);
        expect(typeof mid.spawnNonce).toBe('string');           // intent durable pre-spawn
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited';
        });
        const done = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(done.verdict).toBe('pass');
        expect(done.processRef!.pid).toBeGreaterThan(0);        // identidad REAL adoptada del sidecar
        expect(done.wrapperRef!.pid).toBeGreaterThan(0);
    });

    test('job largo pasa por running con identidad real; jamas se mata por duracion (R3.5)', async () => {  // verifies R3.5
        seedJob(repo, { argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 1500)'] });
        spawnPendingWrappers(repo, 'rama', fakeSpawner);
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'running';
        });
        const running = readJournal(repo, 'rama').state!.jobs['j1'];
        expect(running.processRef!.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        await until(() => {
            collectAndReconcile(repo, 'rama');
            return readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited';
        });
    });

    test('spawn-intent sin claim fuera de gracia => retry con Attempt nuevo (matriz unica, R3.3)', () => {  // verifies R3.3
        seedJob(repo, {
            executionState: 'spawn-intent', spawnNonce: 'nunca-claimeo',
            phaseTimestamps: { 'spawn-intent': new Date(Date.now() - 60000).toISOString() },
        });
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'retry-new-attempt')).toBeDefined();
        const s = readJournal(repo, 'rama').state!;
        expect(s.jobs['j1'].executionState).toBe('cancelled');
        const fresh = Object.values(s.jobs).find((j) => j.attemptOf === 'j1')!;
        expect(fresh.executionState).toBe('received');
    });

    test('claim sin resultado con procesos muertos => orphaned, jamas relanzar (R1.8)', () => {  // verifies R1.8
        const dead = { pid: 999999, startTime: 'gone', spawnNonce: 'nZ', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        seedJob(repo, {
            executionState: 'running', spawnNonce: 'nZ', processRef: dead, wrapperRef: { ...dead, pid: 999998 },
            phaseTimestamps: { running: new Date(Date.now() - 60000).toISOString() },
        });
        fs.writeFileSync(claimPath(logsDir(repo, 'rama'), 'j1', 'nZ'), '{}');
        const out = collectAndReconcile(repo, 'rama', { reconcileGraceMs: 1000 });
        expect(out.decisions.find((d) => d.action === 'orphaned-authorization-required')).toBeDefined();
        expect(readJournal(repo, 'rama').state!.jobs['j1'].executionState).toBe('orphaned');
    });

    test('runnerTick combina recoleccion + spawn en un tick sin esperar (R4.4)', async () => {  // verifies R4.4
        seedJob(repo, {});
        const out = runnerTick(repo, 'rama', fakeSpawner, { reconcileGraceMs: 10000 });
        expect(out.spawned).toBe(1);
        await until(() => runnerTick(repo, 'rama', fakeSpawner, { reconcileGraceMs: 10000 }).advanced > 0
            || readJournal(repo, 'rama').state!.jobs['j1'].executionState === 'exited');
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/watch/runner.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/commands/watch/runner.ts
// Runner concurrente (bloqueador 3): el supervisor spawnea wrappers DETACHED y
// jamas los espera; el avance viene del scan de sidecars en cada tick.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJournal, writeJournal } from '../../core/journal/store';
import { logsDir } from '../../core/journal/paths';
import { spawnStructured } from '../../core/journal/process';
import { claimPath, identityPath, resultPath } from '../job/exec-wrapper';
import { reconcileJobs, materializeRetry, ReconcileDecision } from '../job/reconcile';
import { isWellFormedProcessRef } from '../../core/journal/types';
import type { Job } from '../../core/journal/types';

export type WrapperSpawner = (job: Job, nonce: string, logsRoot: string, repoRoot: string) => void;

/** Spawner real: `awm job exec-wrapper` como proceso EXTERNO detached via el
 *  CLI compilado. fire-and-forget: unref + stdio propio del wrapper. */
export function defaultWrapperSpawner(cliEntry = path.resolve(__dirname, '..', '..', 'index.js')): WrapperSpawner {
    return (job, nonce, logsRoot, repoRoot) => {
        const argv = [
            process.execPath, cliEntry, 'job', 'exec-wrapper',
            '--job', job.id, '--nonce', nonce, '--logs', logsRoot, '--cwd', job.cwd,
            '--', ...job.argv,
        ];
        const { child } = spawnStructured(argv, repoRoot, nonce);
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();   // el supervisor NO espera; el wrapper sobrevive incluso si el supervisor muere
    };
}

/** spawn-intent + nonce persistidos ANTES de cualquier spawn (R1.8): si el
 *  supervisor muere entre journal y spawn, el replay decide por claim. */
export function spawnPendingWrappers(repoRoot: string, branch: string, spawner: WrapperSpawner): number {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const received = Object.values(s.jobs).filter((j) => j.executionState === 'received');
    if (received.length === 0) return 0;
    for (const j of received) {
        j.spawnNonce = crypto.randomBytes(8).toString('hex');
        j.executionState = 'spawn-intent';
        j.phaseTimestamps['spawn-intent'] = new Date().toISOString();
    }
    writeJournal(repoRoot, branch, s);   // intent DURABLE antes del primer spawn
    const logs = logsDir(repoRoot, branch);
    for (const j of received) spawner(j, j.spawnNonce!, logs, repoRoot);
    return received.length;
}

export interface CollectOutput { advanced: number; decisions: ReconcileDecision[]; }

const SCANNABLE = ['spawn-intent', 'claimed', 'running'];

function lastPhaseAgeMs(j: Job): number {
    const stamps = Object.values(j.phaseTimestamps).map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n));
    if (stamps.length === 0) return Number.POSITIVE_INFINITY;
    return Date.now() - Math.max(...stamps);
}

/** Cada tick: sidecars primero (claim=>claimed, identity=>running con identidad
 *  REAL, result=>exited+verdict), reconciliacion (matriz unica) despues — solo
 *  para jobs fuera de su ventana de gracia post-spawn. */
export function collectAndReconcile(repoRoot: string, branch: string, opts: { reconcileGraceMs?: number } = {}): CollectOutput {
    const graceMs = opts.reconcileGraceMs ?? 10000;
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const logs = logsDir(repoRoot, branch);
    let advanced = 0;
    for (const j of Object.values(s.jobs)) {
        if (!SCANNABLE.includes(j.executionState)) continue;
        const nonce = j.spawnNonce ?? 'sin-nonce';
        if (fs.existsSync(resultPath(logs, j.id, nonce))) {
            try {
                const parsed = JSON.parse(fs.readFileSync(resultPath(logs, j.id, nonce), 'utf8'));
                if (typeof parsed.exitCode !== 'number') continue;   // shape invalido: lo vera reconcile como corrupt via gate
                j.executionState = 'exited';
                j.result = parsed;
                j.verdict = parsed.exitCode === 0 ? 'pass' : 'fail';
                j.phaseTimestamps.exited = j.phaseTimestamps.exited ?? new Date().toISOString();
                advanced++;
            } catch { /* resultado ilegible: la matriz decidira (unprovable) */ }
            continue;
        }
        if (fs.existsSync(identityPath(logs, j.id, nonce)) && j.executionState !== 'running') {
            try {
                const identity = JSON.parse(fs.readFileSync(identityPath(logs, j.id, nonce), 'utf8'));
                if (isWellFormedProcessRef(identity.wrapper) && isWellFormedProcessRef(identity.command)) {
                    j.wrapperRef = identity.wrapper;
                    j.processRef = identity.command;   // identidad REAL, nunca pid 0 (bloqueador 3)
                    j.executionState = 'running';
                    j.phaseTimestamps.running = new Date().toISOString();
                    j.lastProgressAt = new Date().toISOString();
                    advanced++;
                }
            } catch { /* sidecar a medio escribir: proximo tick */ }
            continue;
        }
        if (fs.existsSync(claimPath(logs, j.id, nonce)) && j.executionState === 'spawn-intent') {
            j.executionState = 'claimed';
            j.phaseTimestamps.claimed = new Date().toISOString();
            advanced++;
        }
    }
    // Matriz unica SOLO fuera de la gracia post-spawn: un wrapper recien
    // spawneado que aun no claimeo NO es un never-started.
    const out = reconcileJobs(s, logs, { eligible: (j) => lastPhaseAgeMs(j) > graceMs });
    for (const d of out.decisions) {
        if (d.action === 'retry-new-attempt') materializeRetry(s, d.jobId);
    }
    if (advanced > 0 || out.decisions.some((d) => d.action !== 'still-alive')) {
        writeJournal(repoRoot, branch, s);
    }
    return { advanced, decisions: out.decisions };
}

export interface RunnerTickOutput { spawned: number; advanced: number; decisions: ReconcileDecision[]; }

export function runnerTick(repoRoot: string, branch: string, spawner: WrapperSpawner, opts: { reconcileGraceMs?: number } = {}): RunnerTickOutput {
    const collected = collectAndReconcile(repoRoot, branch, opts);
    const spawned = spawnPendingWrappers(repoRoot, branch, spawner);
    return { spawned, advanced: collected.advanced, decisions: collected.decisions };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/watch/runner.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/watch/runner.ts cli/tests/commands/watch/runner.test.ts && git commit -m "feat(watch): concurrent runner — detached wrapper spawn, sidecar collection, integrated reconcile"`

---
### Task 17: State machine de generaciones + custodia BLOCKED

_Requirements: R4.2, R4.2b, R4.3, R1.7_

Supervisor split 5/7. `decideStall` mantiene la doble señal + `safeToReplace`;
la custodia BLOCKED **no** libera el lock ni sale (eso lo garantiza el loop de
Task 18: 'custody' sigue iterando). La escalera SIGTERM→gracia→SIGKILL usa
`terminateGroupConfirmed` (grupo entero). Nota honesta: con los adapters de R1,
`safeToReplace` solo es `'safe'` ante muerte probada — la rama "vivo + safe ⇒
escalera" queda escrita y compilable para adapters futuros, y la escalera en sí
está testeada en Task 6; con proceso vivo los adapters actuales SIEMPRE llevan
a custodia (el silencio jamás autoriza kill).

**Files:**
- Create: `cli/src/commands/watch/generations.ts`
- Test: `cli/tests/commands/watch/generations.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/watch/generations.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { decideStall, Backoff, beginGeneration, activeGeneration, resolveGeneration, enterCustody } from '../../../src/commands/watch/generations';
import { adapterFor } from '../../../src/core/journal/adapter';
import { spawnStructured } from '../../../src/core/journal/process';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';

describe('generaciones', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-gen-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('decideStall: heartbeat vencido solo => observar, nunca kill (R4.2)', () => {  // verifies R4.2
        const cfg = { heartbeatTimeoutMs: 5 * 60000, activityWindowMs: 10 * 60000 };
        expect(decideStall({ heartbeatAgeMs: 60000, activityFrozenMs: 0, safeToReplace: 'indeterminate' }, cfg)).toBe('healthy');
        expect(decideStall({ heartbeatAgeMs: 10 * 60000, activityFrozenMs: 0, safeToReplace: 'indeterminate' }, cfg)).toBe('suspected-stall-observe');
        // doble senial + adapter indeterminate => custodia BLOCKED, sin matar (R4.2b)
        expect(decideStall({ heartbeatAgeMs: 20 * 60000, activityFrozenMs: 15 * 60000, safeToReplace: 'indeterminate' }, cfg)).toBe('custody-blocked');
        // doble senial + safe positivo => recien ahi resolver la generacion
        expect(decideStall({ heartbeatAgeMs: 20 * 60000, activityFrozenMs: 15 * 60000, safeToReplace: 'safe' }, cfg)).toBe('resolve-generation');
    });

    test('backoff 1->5->15 con techo y tope por hora (R4.3)', () => {       // verifies R4.3
        const b = new Backoff();
        expect(b.nextMs()).toBe(60000);
        expect(b.nextMs()).toBe(300000);
        expect(b.nextMs()).toBe(900000);
        expect(b.nextMs()).toBe(900000);   // techo
        expect(b.exhausted()).toBe(false);
        for (let i = 0; i < 6; i++) b.recordRelaunch();
        expect(b.exhausted()).toBe(true);
    });

    test('beginGeneration hace fencing: la anterior queda superseded (R1.7)', () => {  // verifies R1.7
        const g1 = beginGeneration(repo, 'rama');
        const g2 = beginGeneration(repo, 'rama');
        expect(g2.n).toBe(2);
        expect(g2.token).not.toBe(g1.token);
        const s = readJournal(repo, 'rama').state!;
        expect(s.generations.find((g) => g.n === 1)!.state).toBe('superseded');
        expect(activeGeneration(s)!.n).toBe(2);
    });

    test('resolveGeneration: muerte probada => proven-dead; vivo+indeterminate => custodia con estado BLOCKED (R4.2b)', async () => {  // verifies R4.2b
        const adapter = adapterFor('codex');
        beginGeneration(repo, 'rama');
        let s = readJournal(repo, 'rama').state!;
        const gen = activeGeneration(s)!;
        gen.processRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        writeJournal(repo, 'rama', s);
        expect(await resolveGeneration(repo, 'rama', adapter, { termGraceMs: 100, killGraceMs: 100 })).toBe('proven-dead');
        // vivo: el adapter codex no puede afirmar safeToReplace => custodia SIN matar
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 8000)'], process.cwd(), 'nG');
        s = readJournal(repo, 'rama').state!;
        activeGeneration(s)!.processRef = ref;
        writeJournal(repo, 'rama', s);
        expect(await resolveGeneration(repo, 'rama', adapter, { termGraceMs: 100, killGraceMs: 100 })).toBe('custody-blocked');
        const after = readJournal(repo, 'rama').state!;
        expect(after.cycle.status).toBe('BLOCKED');
        expect(after.cycle.blockedReason).toMatch(/safeToReplace/);
        expect(child.killed).toBe(false);                       // JAMAS se toco al vivo
        child.kill('SIGKILL');
    });

    test('enterCustody deja razon auditada y ciclo BLOCKED (R4.5)', () => {  // verifies R4.5
        enterCustody(repo, 'rama', 'prueba de custodia');
        const s = readJournal(repo, 'rama').state!;
        expect(s.cycle.status).toBe('BLOCKED');
        expect(s.cycle.blockedReason).toBe('prueba de custodia');
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/watch/generations.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/commands/watch/generations.ts
// State machine de generaciones (R4.2/R4.2b/R4.3): el silencio NUNCA autoriza
// kill; custodia BLOCKED conserva lock y ownership (el loop de supervisor.ts
// sigue vivo auditando — jamas sale dejando un vivo sin duenio).
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { refIsAlive, groupIsGone, terminateGroupConfirmed, spawnStructured } from '../../core/journal/process';
import type { ControllerAdapter, SafeToReplace } from '../../core/journal/adapter';
import { adapterFor } from '../../core/journal/adapter';
import type { Generation, JournalState, ProcessRef } from '../../core/journal/types';

export type StallDecision = 'healthy' | 'suspected-stall-observe' | 'custody-blocked' | 'resolve-generation';
export interface StallSignals { heartbeatAgeMs: number; activityFrozenMs: number; safeToReplace: SafeToReplace; }
export interface StallConfig { heartbeatTimeoutMs: number; activityWindowMs: number; }

/** Doble senial + senial positiva del adapter (design R4.2/R4.2b):
 *  - solo heartbeat vencido => observar (suspected-stall), JAMAS matar;
 *  - doble senial sin 'safe' del adapter => custodia BLOCKED sin matar;
 *  - doble senial + 'safe' => recien ahi resolver la generacion. */
export function decideStall(signals: StallSignals, cfg: StallConfig): StallDecision {
    if (signals.heartbeatAgeMs < cfg.heartbeatTimeoutMs) return 'healthy';
    if (signals.activityFrozenMs < cfg.activityWindowMs) return 'suspected-stall-observe';
    if (signals.safeToReplace !== 'safe') return 'custody-blocked';
    return 'resolve-generation';
}

const BACKOFF_MS = [60000, 300000, 900000];
const MAX_RELAUNCHES_PER_HOUR = 6;

export class Backoff {
    private idx = -1;
    private stamps: number[] = [];
    nextMs(): number {
        this.idx = Math.min(this.idx + 1, BACKOFF_MS.length - 1);
        return BACKOFF_MS[this.idx];
    }
    reset(): void { this.idx = -1; }
    recordRelaunch(): void { this.stamps.push(Date.now()); }
    exhausted(): boolean {
        const hourAgo = Date.now() - 3600000;
        this.stamps = this.stamps.filter((t) => t > hourAgo);
        return this.stamps.length >= MAX_RELAUNCHES_PER_HOUR;
    }
}

export function activeGeneration(s: JournalState): Generation | undefined {
    return s.generations.find((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
}

/** Emite generacion N+1: toda anterior queda superseded (fencing). NO lanza el
 *  proceso aqui — launchControllerGeneration lo hace con el adapter. */
export function beginGeneration(repoRoot: string, branch: string): Generation {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    for (const g of s.generations) {
        if (g.state === 'active' || g.state === 'controller-suspected-stall') g.state = 'superseded';
    }
    const gen: Generation = {
        n: s.generations.length + 1,
        token: crypto.randomBytes(8).toString('hex'),
        state: 'active', launchedAt: new Date().toISOString(),
    };
    s.generations.push(gen);
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-begun', n: gen.n });
    return gen;
}

export function launchControllerGeneration(repoRoot: string, branch: string, provider: string, resumePrompt: string): ProcessRef {
    const adapter = adapterFor(provider);
    const argv = adapter.launchArgv(resumePrompt);
    const { ref } = spawnStructured(argv, repoRoot, crypto.randomBytes(8).toString('hex'));
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const gen = activeGeneration(s);
    if (gen !== undefined) gen.processRef = ref;
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-launched', provider, pid: ref.pid });
    return ref;
}

/** Custodia (R4.5): ciclo BLOCKED con razon auditada. QUIEN NO HACE NADA:
 *  no mata, no relanza, no libera lock — el loop sigue vivo auditando. */
export function enterCustody(repoRoot: string, branch: string, reason: string): void {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    if (s.cycle.status !== 'BLOCKED' || s.cycle.blockedReason !== reason) {
        s.cycle.status = 'BLOCKED';
        s.cycle.blockedReason = reason;
        writeJournal(repoRoot, branch, s);
        appendEvent(repoRoot, branch, { kind: 'custody-blocked', reason });
    }
}

export type ResolveOutcome = 'proven-dead' | 'terminated-confirmed' | 'custody-blocked';

/** Resolucion de la generacion vigente (R4.2b). Con los adapters de R1,
 *  'safe' solo ocurre con muerte probada; la escalera queda para adapters
 *  que puedan observar llamadas en vuelo. */
export async function resolveGeneration(repoRoot: string, branch: string, adapter: ControllerAdapter, grace: { termGraceMs: number; killGraceMs: number }): Promise<ResolveOutcome> {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const gen = activeGeneration(r.state);
    if (gen?.processRef === undefined) return 'proven-dead';   // nunca se lanzo: relanzar es seguro
    const ref = gen.processRef;
    if (adapter.safeToReplace(ref) !== 'safe') {
        enterCustody(repoRoot, branch, 'stall confirmado pero el adapter no afirma safeToReplace: custodia sin matar (R4.2b)');
        return 'custody-blocked';
    }
    if (!refIsAlive(ref) && groupIsGone(ref.processGroup)) {
        const s = readJournal(repoRoot, branch).state!;
        const g = activeGeneration(s);
        if (g !== undefined) g.state = 'terminated';
        writeJournal(repoRoot, branch, s);
        return 'proven-dead';
    }
    // vivo + safe positivo (adapters futuros): SIGTERM -> gracia -> SIGKILL, confirmando
    const confirmed = await terminateGroupConfirmed(ref, grace);
    if (!confirmed) {
        enterCustody(repoRoot, branch, 'terminacion inconfirmable: custodia (R4.2b caso c)');
        return 'custody-blocked';
    }
    const s = readJournal(repoRoot, branch).state!;
    const g = activeGeneration(s);
    if (g !== undefined) g.state = 'terminated';
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-terminated-confirmed', n: g?.n });
    return 'terminated-confirmed';
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/watch/generations.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/watch/generations.ts cli/tests/commands/watch/generations.test.ts && git commit -m "feat(watch): generation state machine, dual-signal stall, custody BLOCKED, confirmed ladder"`

---

### Task 18: Loop foreground + cierre + `watch --init` (plan-vs-repo mecánico)

_Requirements: R4.1, R4.4, R4.5, R1.4b, R2.4_

Supervisor split 6/7. El loop cablea los ticks completos (apply → collect →
spawn → decisión de stall → gate); `COMPLETE` exige gate verde, que a su vez
exige cero jobs vivos (drenaje ANTES de declarar); custodia retorna al loop SIN
liberar lock; al completar, auto-exit liberando lock y terminando la generación
propia (cero huérfanos). `watch --init` valida plan-vs-repo **mecánicamente**
(bloqueador 5): `package.json` con script `test` ⇒ verificador `test` requerido;
`.awm/sensors.json` ⇒ verificador `sensors` requerido — persistidos en
`state.requiredVerifiers`, que el gate exige cubiertos. Ningún símbolo
importado aquí queda sin definir en tasks previas.

**Files:**
- Create: `cli/src/commands/watch/init.ts`
- Create: `cli/src/commands/watch/supervisor.ts`
- Create: `cli/src/commands/watch/index.ts`
- Test: `cli/tests/commands/watch/watch-init.test.ts`
- Test: `cli/tests/commands/watch/supervisor-loop.test.ts`

- [ ] **Step 1: Test de `--init` (validación plan-vs-repo con test propio, como exige la review)**

```ts
// cli/tests/commands/watch/watch-init.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectRequiredVerifiers, initWatch } from '../../../src/commands/watch/init';
import { readJournal } from '../../../src/core/journal/store';

describe('watch --init: plan-vs-repo mecanico', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('package.json con script test => verificador test requerido (R1.4b)', () => {  // verifies R1.4b
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        expect(detectRequiredVerifiers(repo)).toEqual(['test']);
    });

    test('sensors.json => verificador sensors requerido; ambos => ambos (R1.4b)', () => {  // verifies R1.4b
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
        expect(detectRequiredVerifiers(repo)).toEqual(['test', 'sensors']);
    });

    test('repo sin verificadores => lista vacia (el gate degrada por empty-cycle-plan igualmente, R3.6)', () => {  // verifies R3.6
        expect(detectRequiredVerifiers(repo)).toEqual([]);
    });

    test('initWatch persiste requiredVerifiers y gitignorea el journal (R1.1/R1.4b)', () => {  // verifies R1.4b
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        const out = initWatch(repo, 'rama');
        expect(out.requiredVerifiers).toEqual(['test']);
        expect(readJournal(repo, 'rama').state!.requiredVerifiers).toEqual(['test']);
        expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toContain('.awm/');
        expect(() => initWatch(repo, 'rama')).not.toThrow();   // idempotente
    });
});
```

- [ ] **Step 2: Test del loop** (in-process, spawner fake + stub `codex` en PATH)

```ts
// cli/tests/commands/watch/supervisor-loop.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Supervisor, runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import { WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { beginGeneration, activeGeneration } from '../../../src/commands/watch/generations';
import { initWatch } from '../../../src/commands/watch/init';
import { requestJob } from '../../../src/commands/job/request';
import { emitRequest } from '../../../src/core/journal/requests';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { spawnStructured } from '../../../src/core/journal/process';

jest.setTimeout(60000);

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: repoRoot }).catch(() => {});
};

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function setupRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-loop-'));
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
    return repo;
}

async function until(fn: () => boolean, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('supervisor loop', () => {
    let repo: string;
    let stubBin: string;
    let oldPath: string | undefined;
    beforeEach(() => {
        repo = setupRepo();
        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stub-'));
        fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        oldPath = process.env.PATH;
        process.env.PATH = `${stubBin}:${process.env.PATH}`;
    });
    afterEach(() => {
        process.env.PATH = oldPath;
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    test('ticks drenan y declaran COMPLETE solo con gate verde + cero vivos (R4.5)', async () => {  // verifies R4.5
        initWatch(repo, 'main');    // sin package.json => requiredVerifiers []
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, reconcileGraceMs: 10000 };
        const sup = new Supervisor(repo, 'main', cfg, fakeSpawner);
        // el controlador (aqui: el test) registra plan de ciclo + task + jobs enlazados
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }], reviewObligations: [] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'setTimeout(()=>process.exit(0), 400)'], [], '.', { satisfies: 'v1' });
        requestJob(repo, 'main', 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e3',
            payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });
        let sawContinueWithLiveJob = false;
        let outcome = 'continue';
        for (let i = 0; i < 400 && outcome !== 'complete'; i++) {
            outcome = await sup.tick();
            const s = readJournal(repo, 'main').state!;
            const live = Object.values(s.jobs).some((j) => ['received', 'spawn-intent', 'claimed', 'running'].includes(j.executionState));
            if (outcome === 'continue' && live) sawContinueWithLiveJob = true;   // drenaje ANTES de COMPLETE
            await new Promise((r) => setTimeout(r, 50));
        }
        expect(outcome).toBe('complete');
        expect(sawContinueWithLiveJob).toBe(true);
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        expect(typeof final.cycle.completedAt).toBe('string');
        expect(Object.values(final.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass')).toBe(true);
    });

    test('custodia: doble senial + indeterminate => tick custody, lock retenido, proceso intacto (R4.2b/R4.5)', async () => {  // verifies R4.2b
        initJournal(repo, 'main');
        beginGeneration(repo, 'main');
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 20000)'], process.cwd(), 'nCtl');
        let s = readJournal(repo, 'main').state!;
        activeGeneration(s)!.processRef = ref;
        s.controllerHeartbeatAt = new Date(Date.now() - 3600000).toISOString();   // heartbeat vencido hace 1h
        writeJournal(repo, 'main', s);
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), 'lock-del-loop');              // el loop lo tendria: NO debe borrarse
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', heartbeatTimeoutMs: 1, activityWindowMs: 50, tickMs: 20 };
        const sup = new Supervisor(repo, 'main', cfg, fakeSpawner);
        await sup.tick();                                       // primer tick: arranca el tracking de actividad
        await new Promise((r) => setTimeout(r, 150));           // actividad congelada > ventana
        const out = await sup.tick();
        expect(out).toBe('custody');
        const after = readJournal(repo, 'main').state!;
        expect(after.cycle.status).toBe('BLOCKED');
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);   // custodia NO libera el lock
        expect(child.killed).toBe(false);                              // y NO mato al controlador
        child.kill('SIGKILL');
    });

    test('runSupervisorLoop: bootstrap gen-1 con stub codex, COMPLETE => libera lock y termina su generacion (R4.1/R4.5/R2.4)', async () => {  // verifies R4.1
        initWatch(repo, 'main');
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, termGraceMs: 300, killGraceMs: 300 };
        const loop = runSupervisorLoop(repo, 'main', cfg, fakeSpawner);
        await until(() => {
            const r = readJournal(repo, 'main');
            return r.state !== null && activeGeneration(r.state) !== undefined && fs.existsSync(supervisorLockPath(repo));
        });
        const token = activeGeneration(readJournal(repo, 'main').state!)!.token;
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: token, idempotencyKey: 'e1',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        await loop;                                             // auto-exit tras COMPLETE
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);   // lock liberado
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        const gen = final.generations[0];
        // generacion propia terminada: cero procesos codex huerfanos (R2.4)
        const { refIsAlive } = require('../../../src/core/journal/process');
        expect(gen.processRef === undefined || !refIsAlive(gen.processRef)).toBe(true);
    });
});
```

- [ ] **Step 3: Rojo** — `cd cli && npx jest tests/commands/watch/watch-init.test.ts tests/commands/watch/supervisor-loop.test.ts` → FAIL.
- [ ] **Step 4: Implementar `init.ts`**

```ts
// cli/src/commands/watch/init.ts
// Bootstrap unico writer (R4.1) + validacion MECANICA plan-vs-repo (R1.4b,
// bloqueador 5): la config real del repo determina los verificadores exigidos.
import fs from 'fs';
import path from 'path';
import { initJournal, readJournal, writeJournal } from '../../core/journal/store';
import type { VerificationKind } from '../../core/journal/types';

export function detectRequiredVerifiers(repoRoot: string): VerificationKind[] {
    const kinds: VerificationKind[] = [];
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        if (typeof pkg === 'object' && pkg !== null && typeof pkg.scripts === 'object' && pkg.scripts !== null && typeof pkg.scripts.test === 'string') {
            kinds.push('test');
        }
    } catch { /* sin package.json legible: no se exige suite */ }
    if (fs.existsSync(path.join(repoRoot, '.awm', 'sensors.json'))) kinds.push('sensors');
    return kinds;
}

/** El journal es gitignoreado (R1.1): sus escrituras jamas alteran fingerprints. */
export function ensureJournalGitignored(repoRoot: string): void {
    const gi = path.join(repoRoot, '.gitignore');
    let current = '';
    try { current = fs.readFileSync(gi, 'utf8'); } catch { current = ''; }
    if (!current.split('\n').some((l) => l.trim() === '.awm/' || l.trim() === '.awm')) {
        fs.writeFileSync(gi, current.length > 0 && !current.endsWith('\n') ? `${current}\n.awm/\n` : `${current}.awm/\n`);
    }
}

export function initWatch(repoRoot: string, branch: string): { requiredVerifiers: VerificationKind[] } {
    ensureJournalGitignored(repoRoot);
    initJournal(repoRoot, branch);
    const required = detectRequiredVerifiers(repoRoot);
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto tras init: no se continua (R1.6)');
    const s = r.state;
    if (JSON.stringify(s.requiredVerifiers) !== JSON.stringify(required)) {
        s.requiredVerifiers = required;
        writeJournal(repoRoot, branch, s);
    }
    return { requiredVerifiers: required };
}
```

- [ ] **Step 5: Implementar `supervisor.ts`**

```ts
// cli/src/commands/watch/supervisor.ts
// Loop foreground (R4.4/R4.5): tick = apply -> collect/spawn -> stall -> gate.
// COMPLETE exige gate verde (que exige cero vivos): drenaje ANTES de declarar.
// Custodia BLOCKED: el loop sigue, el lock NO se libera, nada se mata.
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { adapterFor } from '../../core/journal/adapter';
import { refIsAlive, terminateGroupConfirmed } from '../../core/journal/process';
import { computeGate, FingerprintNow } from '../job/gate';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';
import { consumePendingRequests } from './apply';
import { runnerTick, WrapperSpawner, defaultWrapperSpawner } from './runner';
import { decideStall, Backoff, beginGeneration, activeGeneration, launchControllerGeneration, resolveGeneration, enterCustody } from './generations';

export interface SupervisorConfig {
    provider: string;
    heartbeatTimeoutMs: number;
    activityWindowMs: number;
    tickMs: number;
    termGraceMs: number;
    killGraceMs: number;
    reconcileGraceMs: number;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
    provider: 'codex',
    heartbeatTimeoutMs: 5 * 60000,      // R4.2 default 5 min
    activityWindowMs: 10 * 60000,       // R4.2 ventana propia adicional
    tickMs: 5000,
    termGraceMs: 30000,                  // R4.2b flush 30 s
    killGraceMs: 5000,
    reconcileGraceMs: 10000,
};

export type TickOutcome = 'continue' | 'custody' | 'complete';

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export class Supervisor {
    private backoff = new Backoff();
    private relaunchNotBefore = 0;
    private lastActivity: { key: string; changedAt: number } | null = null;

    constructor(
        private repoRoot: string,
        private branch: string,
        private cfg: SupervisorConfig,
        private spawner: WrapperSpawner,
    ) {}

    private fingerprintNow: FingerprintNow = (argv, paths, cwd) => {
        try { return computeFingerprint(this.repoRoot, argv, paths, cwd).fingerprint; }
        catch { return null; }   // no recomputable => el gate NO certifica (fail-closed)
    };

    async tick(): Promise<TickOutcome> {
        const r0 = readJournal(this.repoRoot, this.branch);
        if (r0.corrupt || r0.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        verifyBranchInvariant(this.repoRoot, r0.state.branch);   // R1.1: rama clavada
        const gen = activeGeneration(r0.state);
        consumePendingRequests(this.repoRoot, this.branch, gen?.token ?? null);
        runnerTick(this.repoRoot, this.branch, this.spawner, { reconcileGraceMs: this.cfg.reconcileGraceMs });
        const custody = await this.superviseController();
        if (custody) return 'custody';
        const r = readJournal(this.repoRoot, this.branch);
        const gate = computeGate(r.state, r.corrupt, this.fingerprintNow);
        const liveJobs = r.state === null ? 1 : Object.values(r.state.jobs).filter((j) => LIVE.includes(j.executionState)).length;
        if (gate.pass && liveJobs === 0) {   // gate verde YA implica cero vivos; doble cinturon (R4.5)
            const s = r.state!;
            s.cycle.status = 'COMPLETE';
            s.cycle.completedAt = new Date().toISOString();
            writeJournal(this.repoRoot, this.branch, s);
            appendEvent(this.repoRoot, this.branch, { kind: 'cycle-complete' });
            return 'complete';
        }
        return 'continue';
    }

    /** true => custodia (el caller NO libera lock ni sale). */
    private async superviseController(): Promise<boolean> {
        const r = readJournal(this.repoRoot, this.branch);
        if (r.corrupt || r.state === null) throw new Error('journal corrupto (R1.6)');
        const s = r.state;
        const gen = activeGeneration(s);
        if (gen?.processRef === undefined) return false;         // sin controlador propio: nada que supervisar
        const adapter = adapterFor(this.cfg.provider);
        const heartbeatAgeMs = Date.now() - Date.parse(s.controllerHeartbeatAt ?? gen.launchedAt);
        const snap = adapter.activity(gen.processRef);
        const key = JSON.stringify(snap);
        if (this.lastActivity === null || this.lastActivity.key !== key) {
            this.lastActivity = { key, changedAt: Date.now() };
        }
        const activityFrozenMs = Date.now() - this.lastActivity.changedAt;
        const decision = decideStall(
            { heartbeatAgeMs, activityFrozenMs, safeToReplace: adapter.safeToReplace(gen.processRef) },
            { heartbeatTimeoutMs: this.cfg.heartbeatTimeoutMs, activityWindowMs: this.cfg.activityWindowMs },
        );
        if (decision === 'healthy') { this.backoff.reset(); return false; }
        if (decision === 'suspected-stall-observe') {
            if (gen.state !== 'controller-suspected-stall') {
                gen.state = 'controller-suspected-stall';        // SOLO observacion (R4.2)
                writeJournal(this.repoRoot, this.branch, s);
                appendEvent(this.repoRoot, this.branch, { kind: 'controller-suspected-stall', n: gen.n });
            }
            return false;
        }
        if (decision === 'custody-blocked') {
            enterCustody(this.repoRoot, this.branch, 'doble senial de stall sin safeToReplace positivo del adapter (R4.2b)');
            return true;
        }
        // resolve-generation
        const resolved = await resolveGeneration(this.repoRoot, this.branch, adapter, { termGraceMs: this.cfg.termGraceMs, killGraceMs: this.cfg.killGraceMs });
        if (resolved === 'custody-blocked') return true;
        if (this.backoff.exhausted()) {
            enterCustody(this.repoRoot, this.branch, 'tope de relanzamientos por hora alcanzado (R4.3)');
            return true;
        }
        if (Date.now() < this.relaunchNotBefore) return false;   // esperando backoff, auditando
        beginGeneration(this.repoRoot, this.branch);
        const nextAction = readJournal(this.repoRoot, this.branch).state!.cycle.nextAction;
        const prompt = nextAction !== undefined ? `el next_action ${nextAction.actionId} del journal` : 'el plan del ciclo desde el journal';
        launchControllerGeneration(this.repoRoot, this.branch, this.cfg.provider, prompt);
        this.backoff.recordRelaunch();
        this.relaunchNotBefore = Date.now() + this.backoff.nextMs();
        return false;
    }
}

/** Foreground, visible, terminable (R2.4): sin daemons. SIGINT/SIGTERM libera
 *  el lock y sale; COMPLETE => auto-exit liberando lock y terminando la
 *  generacion propia (cero huerfanos). */
export async function runSupervisorLoop(repoRoot: string, branch: string, cfg: SupervisorConfig, spawner: WrapperSpawner = defaultWrapperSpawner()): Promise<void> {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal ausente o corrupto: corre `awm watch --init` primero');
    verifyBranchInvariant(repoRoot, r.state.branch);
    const handle = acquireLock(repoRoot);
    const onSignal = () => { releaseLock(repoRoot, handle); process.exit(130); };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const sup = new Supervisor(repoRoot, branch, cfg, spawner);
    try {
        const s0 = readJournal(repoRoot, branch).state!;
        if (activeGeneration(s0) === undefined) {
            beginGeneration(repoRoot, branch);
            const prompt = s0.cycle.nextAction !== undefined ? `el next_action ${s0.cycle.nextAction.actionId} del journal` : 'el plan del ciclo desde el journal';
            launchControllerGeneration(repoRoot, branch, cfg.provider, prompt);
        }
        for (;;) {
            const out = await sup.tick();
            if (out === 'complete') break;
            // 'custody': NO liberar lock, NO salir — seguir auditando (R4.5)
            await new Promise((res) => setTimeout(res, cfg.tickMs));
        }
        // gate verde: terminar la generacion PROPIA antes de salir (es hija
        // nuestra y el ciclo cerro — cero procesos huerfanos).
        const sEnd = readJournal(repoRoot, branch).state!;
        for (const g of sEnd.generations) {
            if (g.processRef !== undefined && refIsAlive(g.processRef)) {
                await terminateGroupConfirmed(g.processRef, { termGraceMs: cfg.termGraceMs, killGraceMs: cfg.killGraceMs });
            }
        }
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        releaseLock(repoRoot, handle);
    }
}
```

- [ ] **Step 6: Implementar `index.ts`** (registro delgado, patrón `sensors/index.ts`; validación de flags numéricos fail-fast — regla CONSTITUTION)

```ts
// cli/src/commands/watch/index.ts
import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { initWatch } from './init';
import { runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG } from './supervisor';

function currentBranch(cwd: string): string {
    const b = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
    if (b.length === 0) throw new Error('no hay rama actual (HEAD detached): el journal es por rama');
    return b;
}

function minutes(flag: string, raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} requiere un numero de minutos > 0`);
    return n * 60000;
}

export function registerWatchCommand(program: Command): void {
    program
        .command('watch')
        .description('supervisor durable: ejecuta jobs, releva controladores caidos, nunca mata trabajo vivo')
        .option('--init', 'bootstrap: crea el journal de la rama actual, detecta verificadores y sale')
        .option('--provider <p>', 'codex | claude-code', 'codex')
        .option('--heartbeat-timeout <min>', 'minutos de silencio de heartbeat', '5')
        .option('--activity-window <min>', 'minutos extra sin actividad de proceso', '10')
        .action(async (opts) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            if (opts.init) {
                const out = initWatch(repo, branch);
                process.stdout.write(`journal inicializado para ${branch}; verificadores requeridos: ${JSON.stringify(out.requiredVerifiers)}\n`);
                return;
            }
            const cfg = {
                ...DEFAULT_SUPERVISOR_CONFIG,
                provider: opts.provider,
                heartbeatTimeoutMs: minutes('--heartbeat-timeout', opts.heartbeatTimeout),
                activityWindowMs: minutes('--activity-window', opts.activityWindow),
            };
            process.stdout.write(`awm watch: supervisor activo (${cfg.provider}) — Ctrl-C para terminar\n`);
            await runSupervisorLoop(repo, branch, cfg);
            process.stdout.write('gate verde: ciclo COMPLETE — drenado, lock liberado, apagando\n');
        });
}
```

- [ ] **Step 7: Verde** — `cd cli && npx jest tests/commands/watch/watch-init.test.ts tests/commands/watch/supervisor-loop.test.ts` → PASS.
- [ ] **Step 8: Commit** — `git add cli/src/commands/watch/init.ts cli/src/commands/watch/supervisor.ts cli/src/commands/watch/index.ts cli/tests/commands/watch/watch-init.test.ts cli/tests/commands/watch/supervisor-loop.test.ts && git commit -m "feat(watch): foreground loop with drain-before-complete, custody retains lock, mechanical plan-vs-repo init"`

---
### Task 19: Registro CLI completo (`awm job` + `awm watch`)

_Requirements: R3.1, R3.2, R3.3, R2.2, R3.7_

Registra **TODOS** los comandos que el skill y el plan referencian (importante 1
de la review — al plan v1 le faltaban `list`, `show`, `reconcile`, `reap` y el
entrypoint externo de `exec-wrapper`; el skill llama `awm job reconcile`, tiene
que existir): `request`, `register`, `verdict`, `controller-heartbeat`, `list`,
`show`, `ps`, `reconcile`, `gate`, `reap`, `export`, `exec-wrapper` (interno/oculto), y
`watch` (`--init/--provider/--heartbeat-timeout/--activity-window`).
`awm job` **nunca** escribe estado canónico (R3.1): `reconcile` es informe
read-only de la matriz + `next_action` (la mutación la hace el supervisor,
single-writer); `reap` señaliza procesos con identidad confirmada pero no toca
`state.json`.

**Files:**
- Create: `cli/src/commands/job/index.ts`
- Modify: `cli/src/index.ts` (2 imports + 2 llamadas de registro, junto a `registerSensorsCommand`)

- [ ] **Step 1: Implementar `job/index.ts`**

```ts
// cli/src/commands/job/index.ts
import { Command } from 'commander';
import { execFileSync } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { requestJob } from './request';
import { emitHeartbeat } from './heartbeat';
import { queryPs, queryList, queryShow } from './query';
import { computeGate, FingerprintNow } from './gate';
import { reconcileJobs } from './reconcile';
import { planReap, executeReap } from './reap';
import { buildExport, BaselineMetrics } from './export';
import { runExecWrapper } from './exec-wrapper';
import { emitRequest } from '../../core/journal/requests';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { readJournal } from '../../core/journal/store';
import { exportDir, logsDir } from '../../core/journal/paths';
import { verifyBranchInvariant } from '../watch/lock';
import { writeFileAtomicDurable } from '../../core/atomic-file';
import fs from 'fs';

function branchOf(cwd: string): string {
    const b = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
    if (b.length === 0) throw new Error('no hay rama actual (HEAD detached): el journal es por rama');
    return b;
}

function realFingerprintNow(repo: string): FingerprintNow {
    return (argv, paths, cwd) => {
        try { return computeFingerprint(repo, argv, paths, cwd).fingerprint; }
        catch { return null; }
    };
}

// CONSTITUTION: commander valida los tokens de las options declaradas; los
// variadicos van tras `--`. Los flags numericos/JSON se validan fail-fast.

export function registerJobCommand(program: Command): void {
    const job = program.command('job').description('journal durable de trabajo del ciclo SDD (R1)');

    job.command('request')
        .description('registra la intencion de una verificacion — el supervisor la ejecuta')
        .requiredOption('--generation <token>', 'token de la generacion vigente')
        .option('--paths <globs...>', 'paths que el comando observa (default: arbol completo)')
        .option('--cwd <dir>', 'cwd relativo del comando dentro del repo', '.')
        .option('--satisfies <itemId>', 'id del item de VerificationPlan que este job satisface')
        .argument('<cmd...>', 'comando tras --')
        .action((cmd: string[], opts) => {
            const repo = process.cwd();
            const r = requestJob(repo, branchOf(repo), opts.generation, cmd, opts.paths ?? [], opts.cwd, { satisfies: opts.satisfies });
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    job.command('register')
        .description('registra una entidad del ciclo (task | cycle-plan | dispatch | task-status) ANTES de actuar')
        .requiredOption('--generation <token>')
        .requiredOption('--entity <kind>', 'task | cycle-plan | dispatch | task-status')
        .requiredOption('--json <payload>', 'payload JSON de la entidad')
        .action((opts) => {
            let payload: unknown;
            try { payload = JSON.parse(opts.json); } catch { throw new Error('--json requiere un objeto JSON valido'); }
            if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('--json requiere un objeto JSON');
            const repo = process.cwd();
            const r = emitRequest(repo, branchOf(repo), {
                kind: 'register-entity', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`${opts.entity}:${opts.json}`).digest('hex'),
                payload: { entity: opts.entity, ...(payload as Record<string, unknown>) },
            });
            process.stdout.write(JSON.stringify({ requestId: r.requestId }, null, 2) + '\n');
        });

    job.command('verdict')
        .description('registra el veredicto de una ReviewObligation AL RECIBIRSE')
        .requiredOption('--generation <token>')
        .requiredOption('--obligation <id>')
        .requiredOption('--result <r>', 'pass | fail | inconclusive')
        .option('--detail <texto>', 'detalle del veredicto', '')
        .action((opts) => {
            if (!['pass', 'fail', 'inconclusive'].includes(opts.result)) throw new Error('--result debe ser pass | fail | inconclusive');
            const repo = process.cwd();
            const verdictId = `verd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
            emitRequest(repo, branchOf(repo), {
                kind: 'verdict', generationToken: opts.generation,
                idempotencyKey: crypto.createHash('sha256').update(`verdict:${opts.obligation}:${opts.result}:${opts.detail}`).digest('hex'),
                payload: { verdictId, obligationId: opts.obligation, result: opts.result, detail: opts.detail },
            });
            process.stdout.write(JSON.stringify({ verdictId }, null, 2) + '\n');
        });

    job.command('controller-heartbeat')
        .requiredOption('--generation <token>')
        .action((opts) => { emitHeartbeat(process.cwd(), branchOf(process.cwd()), opts.generation); });

    job.command('ps').action(() => {
        process.stdout.write(JSON.stringify(queryPs(process.cwd(), branchOf(process.cwd())), null, 2) + '\n');
    });

    job.command('list').action(() => {
        process.stdout.write(JSON.stringify(queryList(process.cwd(), branchOf(process.cwd())), null, 2) + '\n');
    });

    job.command('show')
        .argument('<jobId>')
        .action((jobId: string) => {
            const out = queryShow(process.cwd(), branchOf(process.cwd()), jobId);
            process.stdout.write(JSON.stringify(out, null, 2) + '\n');
            if (out.corruptState || out.job === null) process.exit(1);
        });

    job.command('reconcile')
        .description('informe read-only de la matriz unica R1.8 + next_action (la mutacion es del supervisor)')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) {
                process.stdout.write(JSON.stringify({ corruptState: true }, null, 2) + '\n');
                process.exit(1);
            }
            try { verifyBranchInvariant(repo, r.state.branch); }
            catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }
            // copia en memoria: reconcileJobs muta SU copia, jamas el disco (R3.1)
            const clone = JSON.parse(JSON.stringify(r.state));
            const out = reconcileJobs(clone, logsDir(repo, branch));
            process.stdout.write(JSON.stringify({ decisions: out.decisions, nextAction: r.state.cycle.nextAction ?? null, cycleStatus: r.state.cycle.status }, null, 2) + '\n');
        });

    job.command('gate')
        .description('interlock fail-closed: exit != 0 si CUALQUIER cosa impide certificar')
        .action(() => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.state !== null) {
                try { verifyBranchInvariant(repo, r.state.branch); }
                catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }
            }
            const g = computeGate(r.state, r.corrupt, realFingerprintNow(repo));
            process.stdout.write(JSON.stringify(g, null, 2) + '\n');
            if (!g.pass) process.exit(1);   // falla cerrado (R3.2)
        });

    job.command('reap')
        .description('lista procesos de jobs (identidad completa); --execute --jobs <ids...> para terminar confirmando')
        .option('--execute', 'ejecutar la terminacion de los jobs listados en --jobs')
        .option('--jobs <ids...>', 'ids de jobs a terminar (obligatorio con --execute)')
        .action(async (opts) => {
            const repo = process.cwd();
            const r = readJournal(repo, branchOf(repo));
            if (r.corrupt || r.state === null) { process.stderr.write('journal corrupto o ausente\n'); process.exit(1); }
            const plan = planReap(r.state);
            process.stdout.write(JSON.stringify(plan, null, 2) + '\n');   // R2.2: listar SIEMPRE primero
            if (opts.execute) {
                if (!Array.isArray(opts.jobs) || opts.jobs.length === 0) throw new Error('--execute requiere --jobs <ids...>');
                const killed = await executeReap(r.state, opts.jobs);
                process.stdout.write(JSON.stringify({ killed }, null, 2) + '\n');
            }
        });

    job.command('export')
        .option('--provider <p>', 'provider del ciclo', 'codex')
        .option('--baseline <file>', 'JSON con metricas del baseline 2026-07-29 (source/wallTimeMs/dispatches/mechanicalRuns)')
        .action((opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) { process.stderr.write('journal corrupto\n'); process.exit(1); }
            let baseline: BaselineMetrics | null = null;
            if (opts.baseline !== undefined) {
                const parsed = JSON.parse(fs.readFileSync(opts.baseline, 'utf8'));
                if (typeof parsed !== 'object' || parsed === null || typeof parsed.source !== 'string') {
                    throw new Error('--baseline requiere un JSON con al menos {source: string}');
                }
                baseline = parsed as BaselineMetrics;
            }
            const e = buildExport(r.state, opts.provider, { logsRoot: logsDir(repo, branch), baseline });
            const out = path.join(exportDir(repo, branch), 'cycle-export.json');
            writeFileAtomicDurable(out, JSON.stringify(e, null, 2) + '\n', 0o600);
            process.stdout.write(out + '\n');
        });

    // Entrypoint INTERNO del wrapper externo (Task 9). Oculto del help: lo
    // invoca el supervisor, no un humano — pero DEBE ser un comando real para
    // que el wrapper sea un proceso independiente (bloqueador 3).
    job.command('exec-wrapper', { hidden: true })
        .requiredOption('--job <id>')
        .requiredOption('--nonce <n>')
        .requiredOption('--logs <dir>')
        .option('--cwd <dir>', 'cwd del comando', '.')
        .argument('<cmd...>')
        .action(async (cmd: string[], opts) => {
            // El exit code del WRAPPER es 0 si registro el resultado (su exito
            // propio); el exit code del COMANDO viaja en el result sidecar.
            await runExecWrapper({ logsRoot: opts.logs, jobId: opts.job, nonce: opts.nonce, argv: cmd, cwd: opts.cwd });
        });
}
```

- [ ] **Step 2: Registrar en `cli/src/index.ts`** — junto a los registros existentes:

```ts
import { registerJobCommand } from './commands/job';
import { registerWatchCommand } from './commands/watch';
// ... despues de registerAgentCommand(program):
registerJobCommand(program);
registerWatchCommand(program);
```

- [ ] **Step 3: Suite completa + sensores + smoke**

Run: `cd cli && npm run build && npm test` → Expected: TODAS las suites pasan (incluidas las preexistentes — regla AGENTS.md de grep de enums si algo rompió).
Run: `cd cli && node dist/src/index.js job ps` → Expected: JSON con `corruptState:true` (journal ausente reportado visible) o error claro — NUNCA stack trace crudo (si sale stack trace de ENOENT, envolver con mensaje claro antes de dar la task por hecha).
Run: `cd cli && node dist/src/index.js job reconcile` → Expected: exit 1 con `corruptState:true` (sin journal) — el comando EXISTE (el skill lo invoca).
Run: `cd cli && node dist/src/index.js watch --init` → SOLO en un repo tmpdir de prueba, jamás en el repo real; verificar que imprime los verificadores detectados.
Run: `cd cli && node dist/src/index.js sensors run` → Expected: `typecheck: pass`, `lint: pass`, `test: pass` (security/depcheck fallan por gaps de entorno preexistentes — declararlo, no "arreglarlo").

- [ ] **Step 4: Commit** — `git add cli/src/commands/job/index.ts cli/src/index.ts && git commit -m "feat(cli): wire all awm job verbs (incl. list/show/reconcile/reap/exec-wrapper) and awm watch"`

---

### Task 20: E2E real — crash del supervisor, wrapper superviviente, adopción sin duplicar

_Requirements: R1.8, R4.1, R4.4, R6_

Supervisor split 7/7 (importante 4 de la review): batería con procesos REALES.
Lanza el supervisor como proceso `node dist/src/index.js watch` en un repo git
tmpdir, con binarios stub `codex` y `claude` en el PATH; lo mata con SIGKILL a
mitad de un job; verifica que el wrapper externo sobrevive y deja el resultado;
reinicia el supervisor y verifica adopción sin duplicación. **Requiere build
previo** — el primer paso lo garantiza.

**Files:**
- Test: `cli/tests/commands/watch/e2e-crash.test.ts`

- [ ] **Step 1: Build previo** — Run: `cd cli && npm run build` → Expected: sin errores; existe `cli/dist/src/index.js`.

- [ ] **Step 2: Test E2E**

```ts
// cli/tests/commands/watch/e2e-crash.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFileSync, ChildProcess } from 'child_process';

jest.setTimeout(180000);

const CLI = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'index.js');

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function readState(repo: string): Record<string, unknown> | null {
    try { return JSON.parse(fs.readFileSync(path.join(repo, '.awm', 'journal', 'main', 'state.json'), 'utf8')); }
    catch { return null; }
}

async function until(fn: () => boolean, ms = 60000, label = 'condicion'): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${label}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

describe('E2E real: crash/restart del supervisor', () => {
    let repo: string;
    let stubBin: string;
    let env: NodeJS.ProcessEnv;
    const children: ChildProcess[] = [];

    beforeAll(() => {
        if (!fs.existsSync(CLI)) throw new Error('dist ausente: corre `cd cli && npm run build` antes de esta suite (Task 20 Step 1)');
    });

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-'));
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node -e "process.exit(0)"' } }));
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-bin-'));
        for (const name of ['codex', 'claude']) {
            fs.writeFileSync(path.join(stubBin, name), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        }
        env = { ...process.env, PATH: `${stubBin}:${process.env.PATH}` };
        execFileSync(process.execPath, [CLI, 'watch', '--init'], { cwd: repo, env });
    });

    afterEach(() => {
        // higiene: terminar TODO grupo que hayamos originado (supervisores,
        // stubs de controlador, wrappers) — cero huerfanos entre tests
        const s = readState(repo);
        const groups = new Set<number>();
        for (const c of children) { if (c.pid !== undefined) groups.add(c.pid); }
        if (s !== null) {
            for (const g of (s.generations as Array<{ processRef?: { processGroup: number } }>) ?? []) {
                if (g.processRef !== undefined) groups.add(g.processRef.processGroup);
            }
            for (const j of Object.values((s.jobs as Record<string, { processRef?: { processGroup: number } }>) ?? {})) {
                if (j.processRef !== undefined) groups.add(j.processRef.processGroup);
            }
        }
        for (const pgid of groups) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* ya muerto */ } }
        children.length = 0;
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    function startSupervisor(provider: string): ChildProcess {
        const out = fs.openSync(path.join(repo, `sup-${children.length}.log`), 'a');
        const child = spawn(process.execPath, [CLI, 'watch', '--provider', provider], {
            cwd: repo, env, detached: true, stdio: ['ignore', out, out],
        });
        children.push(child);
        child.unref();
        return child;
    }

    test('SIGKILL a mitad de job: el wrapper sobrevive, el resultado llega, el restart adopta sin duplicar (R1.8/R4.1/R4.4)', async () => {  // verifies R1.8
        const sup1 = startSupervisor('codex');
        const lockPath = path.join(fs.realpathSync(repo), '.awm', 'journal', 'supervisor.lock');
        await until(() => fs.existsSync(lockPath), 30000, 'lock del supervisor 1');
        await until(() => {
            const s = readState(repo);
            return s !== null && (s.generations as Array<{ state: string; token: string }>).some((g) => g.state === 'active');
        }, 30000, 'generacion activa');
        const token = (readState(repo)!.generations as Array<{ state: string; token: string }>).find((g) => g.state === 'active')!.token;
        // job largo: sobrevive de sobra al SIGKILL del supervisor
        execFileSync(process.execPath, [CLI, 'job', 'request', '--generation', token, '--',
            'node', '-e', 'setTimeout(()=>process.exit(0), 8000)'], { cwd: repo, env });
        await until(() => {
            const s = readState(repo);
            if (s === null) return false;
            return Object.values(s.jobs as Record<string, { executionState: string }>).some((j) => j.executionState === 'running');
        }, 60000, 'job running con identidad real');
        // CRASH REAL a mitad del job
        process.kill(sup1.pid!, 'SIGKILL');
        const jobs = readState(repo)!.jobs as Record<string, { spawnNonce: string }>;
        const jobId = Object.keys(jobs)[0];
        const nonce = jobs[jobId].spawnNonce;
        const resultFile = path.join(repo, '.awm', 'journal', 'main', 'logs', `${jobId}.${nonce}.result.json`);
        // (c) el wrapper EXTERNO sobrevive al supervisor muerto y deja el resultado
        await until(() => fs.existsSync(resultFile), 60000, 'result sidecar con supervisor muerto');
        expect(JSON.parse(fs.readFileSync(resultFile, 'utf8')).exitCode).toBe(0);
        // (d) restart: reclama lock muerto y ADOPTA el resultado sin duplicar
        startSupervisor('codex');
        await until(() => {
            const s = readState(repo);
            if (s === null) return false;
            const j = (s.jobs as Record<string, { executionState: string; verdict?: string }>)[jobId];
            return j !== undefined && j.executionState === 'exited' && j.verdict === 'pass';
        }, 60000, 'adopcion del resultado');
        const finalJobs = readState(repo)!.jobs as Record<string, { executionState: string; attemptOf?: string }>;
        expect(Object.keys(finalJobs)).toHaveLength(1);                       // sin duplicacion
        expect(Object.values(finalJobs).some((j) => j.attemptOf !== undefined)).toBe(false);  // sin attempt fantasma
    });

    test('adapter claude-code lanza el stub claude; SIGTERM limpia y libera el lock (R4.8/R2.4)', async () => {  // verifies R4.8
        const sup = startSupervisor('claude-code');
        const lockPath = path.join(fs.realpathSync(repo), '.awm', 'journal', 'supervisor.lock');
        await until(() => fs.existsSync(lockPath), 30000, 'lock');
        await until(() => {
            const s = readState(repo);
            if (s === null) return false;
            const gen = (s.generations as Array<{ state: string; processRef?: { pid: number } }>).find((g) => g.state === 'active');
            if (gen?.processRef === undefined) return false;
            try {
                const args = execFileSync('ps', ['-o', 'args=', '-p', String(gen.processRef.pid)], { encoding: 'utf8' });
                return args.includes('claude');
            } catch { return false; }
        }, 30000, 'stub claude lanzado por el adapter');
        process.kill(sup.pid!, 'SIGTERM');                     // handler de senial: libera lock y sale
        await until(() => !fs.existsSync(lockPath), 30000, 'lock liberado tras SIGTERM');
    });
});
```

- [ ] **Step 3: Verde** — Run: `cd cli && npm run build && npx jest tests/commands/watch/e2e-crash.test.ts` → PASS (esta suite tarda ~30-60 s: procesos reales).
- [ ] **Step 4: Commit** — `git add cli/tests/commands/watch/e2e-crash.test.ts && git commit -m "test(watch): real-process E2E — SIGKILL mid-job, surviving wrapper, adoption without duplication"`

---
### Task 21: Sección journal-first del skill SDD (repo hermano `awm-baseline-registry`)

_Requirements: R5.1, R5.2, R5.3_

**Esta task se ejecuta en OTRO repo** (`awm-baseline-registry`), no en este. El
primer paso descubre el checkout y lo clona si falta — nada se asume del
sandbox. El texto del skill dice EXPLÍCITAMENTE que el supervisor releva solo
con la señal positiva `safeToReplace` del adapter — el silencio + inactividad
NUNCA autorizan por sí solos (importante 2 de la review).

**Files:**
- Modify: `<checkout>/skills/subagent-driven-development/SKILL.md` (agregar sección; leer el archivo primero y respetar su estructura/estilo)

- [ ] **Step 1: Descubrir el checkout del registry**

```bash
test -d /home/user/awm-baseline-registry \
  || git clone https://github.com/Kodria/awm-baseline-registry /home/user/awm-baseline-registry
cd /home/user/awm-baseline-registry && git status --short && git log -1 --oneline
```

Expected: checkout limpio y actualizado (si hay cambios locales ajenos, PARAR y reportar antes de tocar nada).

- [ ] **Step 2: Agregar la sección** (después de la sección "Modo desatendido"; contenido exacto):

```markdown
## Modo journal-first (continuidad durable — opt-in)

<!-- AWM-INTEGRATION: subagent-journal-gate -->

WHEN el proyecto tiene journal inicializado (`<repo>/.awm/journal/<rama>/state.json`
existe — se crea con `awm watch --init`), el controlador opera journal-first.
IF el journal NO esta inicializado, THEN este modo entero NO aplica: el skill se
comporta exactamente como esta descrito en el resto del documento, sin cambios
(el flujo default de Claude Code es intocable).

Con journal inicializado:

1. **Apertura de turno:** correr `awm job reconcile` y leer `next_action` del
   journal ANTES de cualquier otra cosa. El journal es la autoridad del punto
   de continuacion — nunca la memoria conversacional.
2. **Registro antes de accion:** cada tarea/despacho/ReviewObligation se
   registra via `awm job register --generation <token> --entity <kind> --json
   <payload>` ANTES de ejecutarse (el token de generacion lo entrega el
   supervisor en el prompt de lanzamiento). El plan de ciclo se registra con
   `--entity cycle-plan`. El Verdict se registra con `awm job verdict` al
   RECIBIRSE el reporte del revisor — nunca antes.
3. **Heartbeat:** emitir `awm job controller-heartbeat --generation <token>` al
   completar cada paso del protocolo (despacho enviado, reporte recibido, task
   marcada). Importante: el silencio de heartbeat + inactividad de proceso
   NUNCA autorizan el relevo por si solos — el supervisor solo releva cuando
   ademas su adapter emite la señal POSITIVA `safeToReplace`; sin esa señal el
   ciclo queda BLOCKED en custodia, sin matar nada.
4. **Verificaciones mecanicas:** pedirlas con
   `awm job request --generation <token> --satisfies <itemId> -- <comando>` —
   NUNCA ejecutarlas inline en providers donde el proceso muere con el turno.
   El supervisor las corre via exec-wrapper (claim durable) y el resultado
   aparece en el journal (`awm job ps`).
5. **Cierre:** `awm job gate` es el interlock — exit != 0 significa que hay
   trabajo pendiente, obligaciones sin verdict `pass`, evidencia con
   fingerprint no vigente, fixes abiertos o corrupcion: NO se cierra el ciclo.
   Solo con gate verde se declara COMPLETE.
```

- [ ] **Step 3: Verificar** — Run: `grep -c "journal-first" /home/user/awm-baseline-registry/skills/subagent-driven-development/SKILL.md` → ≥2. Run: `grep -c "safeToReplace" /home/user/awm-baseline-registry/skills/subagent-driven-development/SKILL.md` → ≥1. Releer la sección insertada en contexto: no contradice el resto del skill (el modo desatendido y los gates existentes quedan intactos).
- [ ] **Step 4: Commit (en el repo del registry)**

```bash
cd /home/user/awm-baseline-registry
git add skills/subagent-driven-development/SKILL.md
git commit -m "feat(sdd): opt-in journal-first mode for durable continuity (AWM R1)"
git push -u origin claude/agentic-workflow-awm-issues-dqka6l
```

(El tag `vX.Y.Z` + `awm update` los ejecuta el dueño cuando decida promover — flujo CLAUDE.md.)

---

### Task 22: Batería de integración in-process + runbook de validación del dueño

_Requirements: R6, R8, R4.2b (custodia), R1.4c (job fallido enlazado)_

El test de gate con job `fail` ahora SÍ enlaza el job al plan (bloqueador 5,
último punto): el fallo bloquea por `adverse-verdict` sobre un item real, no por
accidente. El E2E de procesos reales vive en Task 20; esta batería cubre los
fixtures cross-cutting in-process.

**Files:**
- Create: `cli/tests/commands/watch/integration.test.ts`
- Create: `docs/research/r1/VALIDATION-RUNBOOK.md`

- [ ] **Step 1: Test de integración**

```ts
// cli/tests/commands/watch/integration.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { runnerTick, WrapperSpawner } from '../../../src/commands/watch/runner';
import { decideStall } from '../../../src/commands/watch/generations';
import { initWatch } from '../../../src/commands/watch/init';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { computeGate, FingerprintNow } from '../../../src/commands/job/gate';
import { reconcileJobs } from '../../../src/commands/job/reconcile';
import { requestJob } from '../../../src/commands/job/request';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import { emitRequest } from '../../../src/core/journal/requests';
import { readJournal } from '../../../src/core/journal/store';
import { logsDir } from '../../../src/core/journal/paths';

jest.setTimeout(30000);

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: repoRoot }).catch(() => {});
};

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

async function until(fn: () => boolean, ms = 15000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('integracion supervisor + jobs', () => {
    let repo: string;
    let fpNow: FingerprintNow;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-int-'));
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        initWatch(repo, 'main');   // gitignorea .awm ANTES del primer fingerprint
        fpNow = (argv, paths, cwd) => {
            try { return computeFingerprint(repo, argv, paths, cwd).fingerprint; } catch { return null; }
        };
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    async function drainJobs(): Promise<void> {
        await until(() => {
            runnerTick(repo, 'main', fakeSpawner, { reconcileGraceMs: 10000 });
            const s = readJournal(repo, 'main').state!;
            return Object.values(s.jobs).every((j) => !['received', 'spawn-intent', 'claimed', 'running'].includes(j.executionState));
        });
    }

    test('e2e in-process: request => supervisor ejecuta => resultado en journal, dedup por key (RNF-T.7, R4.4)', async () => {  // verifies R6
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.');
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.');   // misma key
        consumePendingRequests(repo, 'main', 'g1');
        await drainJobs();
        const s = readJournal(repo, 'main').state!;
        const jobs = Object.values(s.jobs);
        expect(jobs).toHaveLength(1);                       // get-or-create: un solo job (RNF-T.7)
        expect(jobs[0].executionState).toBe('exited');
        expect(jobs[0].verdict).toBe('pass');
    });

    test('job fallido ENLAZADO al plan bloquea el gate por adverse-verdict (R1.4c)', async () => {  // verifies R1.4c
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }], reviewObligations: [] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        // job largo que FALLA, enlazado a v1 (bloqueador 5: el test v1 no enlazaba)
        requestJob(repo, 'main', 'g1', ['node', '-e', 'setTimeout(()=>process.exit(1), 1200)'], [], '.', { satisfies: 'v1' });
        consumePendingRequests(repo, 'main', 'g1');
        await drainJobs();                                   // sin timeout terminal: espera lo que dure (R3.5)
        const s = readJournal(repo, 'main').state!;
        const g = computeGate(s, false, fpNow);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'adverse-verdict' && /v1/.test(r.detail))).toBe(true);
        expect(g.reasons.some((r) => r.category === 'live-job')).toBe(false);   // pero SI termino
    });

    test('evidencia pass con arbol cambiado despues => stale-fingerprint, historica (RF-2.8)', async () => {  // verifies R6
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }], reviewObligations: [] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e3',
            payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v1' });
        requestJob(repo, 'main', 'g1', ['node', '-e', 'setTimeout(()=>process.exit(0),100)'], [], '.', { satisfies: 'cv1' });
        consumePendingRequests(repo, 'main', 'g1');
        await drainJobs();
        expect(computeGate(readJournal(repo, 'main').state!, false, fpNow).pass).toBe(true);
        fs.writeFileSync(path.join(repo, 'f.txt'), 'CAMBIO');   // el arbol cambio tras la evidencia
        const g = computeGate(readJournal(repo, 'main').state!, false, fpNow);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
    });

    test('custodia: doble senial sin safe => custody-blocked, jamas kill (R4.2b)', () => {  // verifies R4.2b
        const d = decideStall({ heartbeatAgeMs: 999999, activityFrozenMs: 999999, safeToReplace: 'indeterminate' },
            { heartbeatTimeoutMs: 1, activityWindowMs: 1 });
        expect(d).toBe('custody-blocked');
    });

    test('interrupcion entre spawn-intent y claim: la matriz decide por claim, no re-spawnea a ciegas (R1.8)', () => {  // verifies R1.8
        requestJob(repo, 'main', 'g1', ['node', '-e', 'process.exit(0)'], [], '.');
        consumePendingRequests(repo, 'main', 'g1');
        const s = readJournal(repo, 'main').state!;
        const jid = Object.keys(s.jobs)[0];
        s.jobs[jid].executionState = 'spawn-intent';         // crash simulado: intent persistido, spawn jamas ocurrio
        s.jobs[jid].spawnNonce = 'nunca-uso';
        const out = reconcileJobs(s, logsDir(repo, 'main'));
        expect(out.decisions[0].action).toBe('retry-new-attempt');   // sin claim => nunca ejecuto => seguro
    });
});
```

- [ ] **Step 2: Verde** — `cd cli && npx jest tests/commands/watch/integration.test.ts` → PASS.
- [ ] **Step 3: Crear `docs/research/r1/VALIDATION-RUNBOOK.md`** (validación del dueño, R8):

```markdown
# R1 — Runbook de validacion en maquina real (dueño)

Requiere: rama actualizada, `cd cli && npm run build`, y el binario local
(`node cli/dist/src/index.js`, alias abajo como `awm-dev`).

## Escenario Codex (Mac y/o VPS) — el dolor #2 curado

1. En el repo del proyecto: `awm-dev watch --init` (crea el journal de la rama
   e imprime los verificadores requeridos detectados — verificar que coinciden
   con la config real del repo).
2. En una terminal: `awm-dev watch --provider codex` (queda en foreground).
3. En otra terminal, simular el ciclo: pedir un job
   (`awm-dev job request --generation <token-de-la-generacion-activa> -- npm test`)
   y verificar con `awm-dev job ps` que lo ejecuta el supervisor via
   exec-wrapper, no tu sesion.
4. Corte real: cerra la sesion de Codex a mitad de un ciclo. Verificar que el
   supervisor detecta el silencio (suspected-stall, solo observacion), y que
   SOLO releva cuando ademas la actividad del process group esta congelada Y el
   adapter afirma `safeToReplace` (muerte probada); si no puede probarlo, entra
   en custodia BLOCKED conservando el lock — verificar que NO mata nada en ese
   caso. Tras el relevo, el orquestador nuevo retoma desde `next_action` sin
   duplicar trabajo (`awm job list`: cero jobs duplicados).
5. `awm-dev job gate` en rojo mientras haya pendientes; verde solo al final;
   el supervisor se apaga solo tras COMPLETE liberando el lock. Verificar con
   `ps` que no queda NINGUN proceso awm/codex huerfano.
6. `awm-dev job export --provider codex` deja el artefacto sanitizado en
   `.awm/journal/<rama>/export/` — revisar timestamps por fase, despachos
   reales y campos `unobservable` declarados.

## Escenario Claude Code — neutralidad (R5.4)

1. Opt-out: correr un ciclo SDD normal SIN `watch --init` => cero cambios de flujo.
2. Opt-in: `watch --init` + la misma bateria del escenario Codex con
   `--provider claude-code`.

## Registro

Resultado (paso a paso, con cualquier desviacion) como comentario en
agentic-workflow#20. R1 no se declara aceptado sin este registro (R8.1).
```

- [ ] **Step 4: Commit** — `git add cli/tests/commands/watch/integration.test.ts docs/research/r1/VALIDATION-RUNBOOK.md && git commit -m "test(r1): cross-cutting integration battery with plan-linked failing job + owner validation runbook"`

---

## Traceability matrix

| Req (design v5) | Task(s) | Test(s) / verificación que ancla el claim ESPECÍFICO |
|---|---|---|
| R1.1 | T3, T14, T18 | paths.test: lock fuera del dir de rama + realpath; lock.test: branch invariant BLOCKED; watch-init.test: journal gitignoreado |
| R1.2 | T2, T7 | atomic-file-durable.test: fsync de directorio LANZA en fallo (mock de openSync), 0600; store.test: 0700/0600, revisión CAS |
| R1.3 | T8, T15 | requests.test: publicación atómica + fsync dir, alias por requestId, ack regenerado; apply.test: orden estado→journal→borrado con replay sin doble aplicación |
| R1.4 | T1, T15 | types.test: entidades y emptyState; apply.test: register-entity CREA task/dispatch/cycle-plan |
| R1.4b | T12, T15, T18 | gate-reconcile.test: `empty-cycle-plan` y `missing-verifier` bloquean; apply.test: cycle-plan handler; watch-init.test: detección mecánica package.json/sensors.json (test propio) |
| R1.4c | T12, T15, T22 | gate-reconcile.test: solo pass satisface + stale-fingerprint; apply.test: verdict adverso ⇒ FixObligation en la MISMA escritura; integration.test: job fallido ENLAZADO bloquea |
| R1.5 | T7 | store.test: nextAction estructurado persiste |
| R1.6 | T7, T11, T15 | store.test corrupt-aware; verbs.test ps/list/show visibles; apply.test request corrupta apartada `.corrupt` |
| R1.7 | T1, T12, T17 | types.test: enums exactos; gate-reconcile.test: materializeRetry Attempt nuevo enlazado; generations.test: fencing superseded |
| R1.8 | T9, T16, T20 | exec-wrapper.test: claim wx + identity + resultado + matriz de replay; runner.test: intent durable pre-spawn, orphaned sin relanzar; e2e-crash.test: wrapper sobrevive SIGKILL y el restart adopta sin duplicar |
| R2.1 | T6, T14 | process.test: tupla completa (startTime+pgid+psArgsDigest), grupo confirmado con `pgrep -g` vacío; lock.test: identidad indemostrable ⇒ LockBlockedError |
| R2.2 | T12, T19 | gate-reconcile/reap: planReap lista antes de actuar; CLI reap imprime plan SIEMPRE y exige `--jobs` explícitos |
| R2.3 | T4, T8 | redact.test; requests.test secreto literal rechazado sin persistir |
| R2.4 | T18, T20 | supervisor foreground sin daemon (revisión de código — no hay servicio que testear, declarado manual); e2e-crash.test: SIGTERM limpia y libera lock |
| R2.5 | T9 | MAX_LOG_BYTES en exec-wrapper (límite aplicado en append) |
| R3.1 | T11, T19 | verbs.test get-or-create key con cwd real; registro commander COMPLETO (list/show/reconcile/reap/exec-wrapper incluidos); reconcile CLI read-only (single-writer) |
| R3.2 | T12, T19 | gate-reconcile.test: 12 categorías fail-closed; CLI gate exit 1 |
| R3.3 | T12, T16, T22 | gate-reconcile.test matriz única; runner.test reconcile integrado con gracia; integration.test spawn-intent sin claim ⇒ retry |
| R3.4 | T5 | fingerprint.test: staged-only altera (índice real), cwd distinto altera, expansión persistida, `.awm` excluido |
| R3.5 | T11, T16, T22 | verbs.test heartbeat; runner.test job largo pasa por running y nunca muere por duración; integration.test job fail de 1.2 s espera completa |
| R3.6 | T12, T18 | gate: `missing-verifier` con detalle del verificador faltante; watch-init.test repo sin verificadores |
| R3.7 | T13, T19 | export.test: timestamps por fase, wall time, despachos reales, evidencia con hash+reproduce, baselineComparison con unobservable; CLI `job export --baseline` |
| R4.1 | T14, T18, T20 | lock.test: wx exclusivo, EEXIST valida tupla, muerto probado rm+retry único, ilegible BLOQUEADO; supervisor-loop.test: lock liberado tras COMPLETE; e2e: lock muerto reclamado en restart |
| R4.2 / R4.2b | T17, T18, T22 | generations.test decideStall (4 ramas) + resolveGeneration custodia sin matar; supervisor-loop.test custodia retiene lock y no mata; integration.test custodia |
| R4.3 | T17 | generations.test: backoff 1→5→15 con techo y tope por hora |
| R4.4 | T16, T18, T20 | runner.test: spawn detached sin espera + recolección por scan; supervisor-loop.test ticks; e2e real |
| R4.5 | T12, T17, T18 | gate live-job/orphaned bloquean; enterCustody BLOCKED auditado; supervisor-loop.test: drenaje ANTES de COMPLETE observado + custodia sin liberar lock |
| R4.6 | T7, T15 | store.test appendEvent best-effort; apply.test rejected-stale auditado en state |
| R4.7 | T6, T9 | process.test spawnStructured shell:false + nonce por entorno; wrapper spawnea estructurado en su grupo |
| R4.8 | T10, T20 | adapter.test: codex/claude-code, launchArgv, safeToReplace con evidencia; e2e: ambos stubs lanzados por su adapter |
| R5.1–R5.3 | T21 | grep journal-first ≥2 + grep safeToReplace ≥1 + lectura de coherencia (doc de skill: verificación manual declarada) |
| R5.4 | T20, T22 | e2e ejercita ambos adapters con binarios fake; VALIDATION-RUNBOOK escenario Claude opt-in/opt-out (gate del dueño) |
| R6 | T22 + suites por módulo (T1–T20) | integration.test (5 fixtures cross-cutting) + e2e-crash.test |
| R7.1 | T13 | export.test métricas (cubierto por R3.7) |
| R8.1 | T22 | VALIDATION-RUNBOOK + registro en issue #20 (gate humano, sin proxy) |

## Analyze gate

Las 35 filas de requirement del design v5 tienen ≥1 task y ≥1 verificación, y
cada verificación citada ancla el claim ESPECÍFICO (no un grep genérico): p.ej.
R1.3 se ancla en el test de replay-sin-doble-aplicación, no en "hay tests de
requests". Las verificaciones sin proxy automatizable quedan declaradas como
gates manuales o del dueño, sin fingir cobertura:

- **R2.4** (sin daemons): revisión de código — no existe servicio que testear;
  el E2E cubre solo la terminación limpia.
- **R1.2** (durabilidad ante corte de energía real): no automatizable en CI; lo
  testeado es el CONTRATO (fsync de directorio que lanza en fallo).
- **R5.1–R5.3** (texto del skill): greps + lectura de coherencia manual del
  implementador.
- **R5.4 / R8.1** (neutralidad y smoke en máquina real): gate del dueño vía
  VALIDATION-RUNBOOK + issue #20.

Ninguna task carece de requirement (T1–T22 trazan todas; T19 traza a R3.1/R3.2
como registro CLI; T20 es la materialización E2E de R1.8/R4.x). Ningún test
citado referencia símbolos que ninguna task defina; los símbolos compartidos
(`ProcessRef` con `psArgsDigest`, `fsyncDirSync`, `runExecWrapper`,
`consumePendingRequests`, `FingerprintNow`) nacen en T1/T2/T9/T15/T12
respectivamente y se importan después.
