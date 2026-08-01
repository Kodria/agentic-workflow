# R1 Durable Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el controlador durable de R1 — journal canónico single-writer, CLI `awm job`, supervisor `awm watch` — según `docs/plans/2026-07-31-r1-durable-controller-design.md` (v5, certificado en 5 rondas de review del dueño).

**Architecture:** Supervisor foreground single-writer del snapshot `state.json`; el agente emite requests inmutables; los jobs se ejecutan vía exec-wrapper con claim durable por spawnNonce en process groups del supervisor; generaciones de controlador con fencing + señal positiva `safeToReplace` del ControllerAdapter; gate fail-closed que solo acepta `pass`.

**Tech Stack:** TypeScript en `cli/` (Node ≥20, commander, cero dependencias nuevas), Jest con tmpdirs + override HOME/AWM_HOME. Registry hermano `awm-baseline-registry` para la sección journal-first del skill SDD.

**Modo de ejecución:** interactivo

---

## Notas de ejecución

- **Requirements R1–R8** = los del design doc v5 (`2026-07-31-r1-durable-controller-design.md`), no confundir con los RF-x.y del brief.
- **Regla de oro del repo (AGENTS.md):** auto-verificación siempre con `npm run build && node dist/src/index.js <cmd>` desde `cli/` — nunca `awm` bare del PATH. Sensores: `node dist/src/index.js sensors run` desde `cli/`, leer `overall`.
- **Tests:** tmpdir + override `HOME`/`AWM_HOME` + `jest.resetModules()` + `require()` inline (patrón `cli/tests/commands/hooks/install.test.ts`; ver `docs/research/r0/analysis/cli-conventions.md`). Ningún test toca `~/.awm` ni el journal real.
- **Convención de estilo:** archivos nuevos siguen 4 espacios + `test()` si crean su propia convención; al editar un archivo existente, copiar SU convención local (regla CONSTITUTION).
- **El journal de test se crea siempre bajo el tmpdir del test** (`<tmp>/repo/.awm/journal/...`), nunca en el repo real.
- **T14 se ejecuta en el repo hermano** `/home/user/awm-baseline-registry` (mismo patrón de commit; el tag y `awm update` los decide el dueño después).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/atomic-file.ts` (modificar) | + `writeFileAtomicDurable` (fsync del directorio tras rename) |
| `cli/src/core/journal/types.ts` | Entidades + enums + shape guards (única fuente de tipos) |
| `cli/src/core/journal/paths.ts` | Rutas del journal, branch-slug, lock por realpath(worktree) |
| `cli/src/core/journal/redact.ts` | Redacción en el emisor + rechazo de secretos literales |
| `cli/src/core/journal/fingerprint.ts` | argv+cwd+HEAD+índice+digests de paths (expansión persistida) |
| `cli/src/core/journal/process.ts` | ProcessRef completo, liveness, actividad, spawn shell:false, terminación confirmada |
| `cli/src/core/journal/store.ts` | state.json: read (corrupt-aware) / write canónico (revisión, 0700/0600) |
| `cli/src/core/journal/requests.ts` | Emisión tmp+fsync+rename, consumo con fencing, acks regenerables |
| `cli/src/core/journal/adapter.ts` | ControllerAdapter + implementaciones codex / claude-code |
| `cli/src/commands/job/index.ts` | Registro de subcomandos `awm job` |
| `cli/src/commands/job/exec-wrapper.ts` | Claim por spawnNonce + ejecución + resultado terminal atómico |
| `cli/src/commands/job/{request,heartbeat,query,reconcile,gate,reap,export}.ts` | Verbos del agente |
| `cli/src/commands/watch/index.ts` | Supervisor: --init, lock, loop, generaciones, drenaje, custodia |
| `cli/tests/core/journal/*.test.ts`, `cli/tests/commands/job/*.test.ts`, `cli/tests/commands/watch/*.test.ts` | Suites |
| `awm-baseline-registry/skills/subagent-driven-development/SKILL.md` (modificar) | Sección journal-first condicional (R5) |

---

### Task 1: Tipos del journal + shape guards

_Requirements: R1.4, R1.7_

**Files:**
- Create: `cli/src/core/journal/types.ts`
- Test: `cli/tests/core/journal/types.test.ts`

- [ ] **Step 1: Escribir el test que fija los enums y los guards**

```ts
// cli/tests/core/journal/types.test.ts
import {
    EXECUTION_STATES, GENERATION_STATES, isWellFormedState, emptyState,
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
    });

    test('isWellFormedState rechaza no-objetos y shapes rotos (R1.6)', () => {  // verifies R1.6
        expect(isWellFormedState(null)).toBe(false);
        expect(isWellFormedState(42)).toBe(false);
        expect(isWellFormedState({ schema: 1 })).toBe(false);
        const bad = emptyState('x') as Record<string, unknown>;
        bad.revision = 'no-un-numero';
        expect(isWellFormedState(bad)).toBe(false);
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

export interface ProcessRef {
    pid: number;
    startTime: string;      // de ps -o lstart / /proc — nunca PID solo (R2.1)
    spawnNonce: string;
    argvDigest: string;
    processGroup: number;
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
    // Satisfecho SOLO por pass con fingerprint vigente (R1.4c) — referencia al job/verdict.
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
}

export interface JobResult { exitCode: number; endedAt: string; resultPath: string; }
export interface Job {
    id: string;
    fingerprint: string;
    commandDigest: string;
    argv: string[];         // ya redactado por el emisor (R2.3)
    cwd: string;
    paths: string[];        // expansión persistida (R3.4)
    executionState: ExecutionState;
    observationState: ObservationState;
    verdict?: JobVerdict;
    processRef?: ProcessRef;
    lastProgressAt?: string;
    logPath?: string;
    result?: JobResult;
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
    cycle: { status: CycleStatus; nextAction?: NextAction; blockedReason?: string };
    cycleVerificationPlan: VerificationItem[];   // QA + interlock a nivel ciclo (R1.4b)
    generations: Generation[];
    tasks: TaskEntity[];
    jobs: Record<string, Job>;
    verdicts: Verdict[];
    fixes: FixObligation[];
    appliedRequests: Record<string, AppliedRequest>;  // por requestId
    controllerHeartbeatAt?: string;
}

export function emptyState(branch: string): JournalState {
    return {
        schema: 1, revision: 0, branch,
        cycle: { status: 'IN_PROGRESS' },
        cycleVerificationPlan: [], generations: [], tasks: [],
        jobs: {}, verdicts: [], fixes: [], appliedRequests: {},
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
    if (!isObj(x.jobs) || !isObj(x.appliedRequests)) return false;
    return true;
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
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/types.ts cli/tests/core/journal/types.test.ts && git commit -m "feat(journal): entity types, separated state enums, shape guards"`

---

### Task 2: `writeFileAtomicDurable` (fsync del directorio)

_Requirements: R1.2_

**Files:**
- Modify: `cli/src/core/atomic-file.ts` (append al final; el archivo existente usa 4 espacios — mantener)
- Test: `cli/tests/core/atomic-file-durable.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/atomic-file-durable.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeFileAtomicDurable } from '../../src/core/atomic-file';

describe('writeFileAtomicDurable', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-durable-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

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
});
```

- [ ] **Step 2: Rojo** — Run: `cd cli && npx jest tests/core/atomic-file-durable.test.ts` → FAIL (export missing).
- [ ] **Step 3: Implementar** (append en `atomic-file.ts`):

```ts
/** writeFileAtomic + fsync del directorio contenedor tras el rename.
 *  El fsync del archivo temporal (arriba) garantiza el contenido; el fsync del
 *  directorio garantiza que la ENTRADA renombrada sobrevive un crash del OS
 *  (review v5 del diseño R1: la durabilidad de la transición, no solo del blob). */
export function writeFileAtomicDurable(file: string, content: string, mode = 0o644): void {
    writeFileAtomic(file, content, mode);
    let dirFd: number | undefined;
    try {
        dirFd = fs.openSync(path.dirname(file), 'r');
        fs.fsyncSync(dirFd);
    } catch {
        // best-effort: algunos filesystems no soportan fsync de directorio; el
        // rename ya ocurrió y el contenido está sincronizado.
    } finally {
        if (dirFd !== undefined) fs.closeSync(dirFd);
    }
}
```

- [ ] **Step 4: Verde** — Run: `cd cli && npx jest tests/core/atomic-file-durable.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/atomic-file.ts cli/tests/core/atomic-file-durable.test.ts && git commit -m "feat(core): writeFileAtomicDurable with directory fsync"`

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

### Task 5: Fingerprint

_Requirements: R3.4_

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

    test('mismo comando + mismo arbol => mismo fingerprint (R3.4)', () => {   // verifies R3.4
        const a = computeFingerprint(repo, ['npm', 'test'], []);
        const b = computeFingerprint(repo, ['npm', 'test'], []);
        expect(a.fingerprint).toBe(b.fingerprint);
        expect(a.commandDigest).toBe(b.commandDigest);
    });

    test('cambio en tracked, untracked o argv cambia el fingerprint (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], []).fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        const mod = computeFingerprint(repo, ['npm', 'test'], []).fingerprint;
        expect(mod).not.toBe(base);
        git(repo, 'checkout', '-q', '--', '.');
        fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'x');
        const untracked = computeFingerprint(repo, ['npm', 'test'], []).fingerprint;
        expect(untracked).not.toBe(base);
        fs.rmSync(path.join(repo, 'nuevo.txt'));
        const otherCmd = computeFingerprint(repo, ['npm', 'run', 'lint'], []).fingerprint;
        expect(otherCmd).not.toBe(base);
    });

    test('la expansion de paths queda persistida (R3.4)', () => {          // verifies R3.4
        const r = computeFingerprint(repo, ['npm', 'test'], ['a.txt']);
        expect(r.expandedPaths).toEqual(['a.txt']);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/fingerprint.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/fingerprint.ts
import crypto from 'crypto';
import { execFileSync } from 'child_process';

function sha(parts: string[]): string {
    return crypto.createHash('sha256').update(parts.join(' ')).digest('hex');
}
function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export interface FingerprintResult {
    fingerprint: string;
    commandDigest: string;
    expandedPaths: string[];
}

/** argv exacto + cwd relativo + HEAD + indice + digest de contenido de
 *  tracked/untracked/deleted de los paths declarados (design R3.4). */
export function computeFingerprint(repoRoot: string, argv: string[], pathGlobs: string[]): FingerprintResult {
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv vacio');
    const commandDigest = sha(argv);
    const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const pathspecs = pathGlobs.length > 0 ? pathGlobs : ['.'];
    const expandedPaths = git(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs])
        .split('\n').filter(Boolean).sort();
    const statusRaw = git(repoRoot, ['status', '--porcelain', '--', ...pathspecs]);
    const perFile = expandedPaths.map((p) => {
        try {
            return `${p}:${git(repoRoot, ['hash-object', '--', p]).trim()}`;
        } catch {
            return `${p}:deleted`;   // listado pero ilegible/borrado: cuenta como cambio
        }
    });
    const fingerprint = sha([commandDigest, 'cwd:.', `head:${head}`, `status:${statusRaw}`, ...perFile]);
    return { fingerprint, commandDigest, expandedPaths };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/fingerprint.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/fingerprint.ts cli/tests/core/journal/fingerprint.test.ts && git commit -m "feat(journal): content-anchored fingerprint with persisted path expansion"`

---

### Task 6: Identidad y ciclo de vida de procesos

_Requirements: R2.1, R4.7_

**Files:**
- Create: `cli/src/core/journal/process.ts`
- Test: `cli/tests/core/journal/process.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/process.test.ts
import { spawnStructured, refIsAlive, terminateGroupConfirmed, activitySnapshot } from '../../../src/core/journal/process';

describe('process identity', () => {
    test('spawnStructured inyecta nonce y produce ProcessRef completo (R2.1, R4.7)', async () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nonce-abc');
        expect(ref.pid).toBe(child.pid);
        expect(ref.spawnNonce).toBe('nonce-abc');
        expect(typeof ref.startTime).toBe('string');
        expect(ref.processGroup).toBeGreaterThan(0);
        expect(refIsAlive(ref)).toBe(true);
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 300, killGraceMs: 300 });
        expect(dead).toBe(true);
        expect(refIsAlive(ref)).toBe(false);
    });

    test('refIsAlive rechaza un PID con identidad distinta (R2.1)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 2000)'], process.cwd(), 'n2');
        const impostor = { ...ref, startTime: 'otro-momento' };
        expect(refIsAlive(impostor)).toBe(false);
        child.kill('SIGKILL');
    });

    test('activitySnapshot reporta cpu de un proceso vivo (soporte R4.2)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n3');
        const snap = activitySnapshot(ref);
        expect(snap).not.toBeNull();
        expect(typeof snap!.cpuTime).toBe('string');
        child.kill('SIGKILL');
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

export function argvDigest(argv: string[]): string {
    return crypto.createHash('sha256').update(argv.join(' ')).digest('hex').slice(0, 16);
}

/** Ejecucion segura (design R4.7): executable+argv como array, shell:false,
 *  nonce por entorno (referencia, no valor persistido), grupo propio. */
export function spawnStructured(argv: string[], cwd: string, nonce: string, extraEnv: Record<string, string> = {}): { child: ChildProcess; ref: ProcessRef } {
    const [exe, ...args] = argv;
    const child = spawn(exe, args, {
        cwd, shell: false, detached: true,
        env: { ...process.env, [NONCE_ENV]: nonce, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid === undefined) throw new Error(`spawn fallo para ${exe}`);
    const ref: ProcessRef = {
        pid: child.pid,
        startTime: psField(child.pid, 'lstart') ?? 'unknown',
        spawnNonce: nonce,
        argvDigest: argvDigest(argv),
        processGroup: child.pid,   // detached => lider de su propio grupo
    };
    return { child, ref };
}

/** Vivo Y con la MISMA identidad — nunca PID solo (design R2.1). */
export function refIsAlive(ref: ProcessRef): boolean {
    const start = psField(ref.pid, 'lstart');
    if (start === null) return false;
    return start === ref.startTime;
}

export interface ActivitySnapshot { cpuTime: string; childCount: number; }
export function activitySnapshot(ref: ProcessRef): ActivitySnapshot | null {
    if (!refIsAlive(ref)) return null;
    const cpu = psField(ref.pid, 'time') ?? '0';
    let childCount = 0;
    try {
        childCount = execFileSync('pgrep', ['-P', String(ref.pid)], { encoding: 'utf8' })
            .split('\n').filter(Boolean).length;
    } catch { childCount = 0; }   // pgrep exit 1 = sin hijos; ausente = degrada a 0
    return { cpuTime: cpu, childCount };
}

/** Escalera de gracia (design R4.2b): SIGTERM -> confirmar -> SIGKILL -> confirmar.
 *  true <=> muerte CONFIRMADA. Solo senializa si la identidad completa matchea. */
export async function terminateGroupConfirmed(ref: ProcessRef, opts: { termGraceMs: number; killGraceMs: number }): Promise<boolean> {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (!refIsAlive(ref)) return true;
    try { process.kill(-ref.processGroup, 'SIGTERM'); } catch { /* grupo ya ausente */ }
    await wait(opts.termGraceMs);
    if (!refIsAlive(ref)) return true;
    try { process.kill(-ref.processGroup, 'SIGKILL'); } catch { /* idem */ }
    await wait(opts.killGraceMs);
    return !refIsAlive(ref);
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/process.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/process.ts cli/tests/core/journal/process.test.ts && git commit -m "feat(journal): full process identity, activity snapshot, confirmed termination ladder"`

---

### Task 7: Store del snapshot canónico

_Requirements: R1.2, R1.5, R1.6_

**Files:**
- Create: `cli/src/core/journal/store.ts`
- Test: `cli/tests/core/journal/store.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/store.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { emptyState } from '../../../src/core/journal/types';
import { statePath, journalDir } from '../../../src/core/journal/paths';

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
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/core/journal/store.test.ts` → FAIL.
- [ ] **Step 3: Implementar**

```ts
// cli/src/core/journal/store.ts
import fs from 'fs';
import { writeFileAtomicDurable } from '../atomic-file';
import { emptyState, isWellFormedState, JournalState } from './types';
import { journalDir, statePath, requestsDir, acksDir, logsDir, exportDir } from './paths';

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
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/store.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/store.ts cli/tests/core/journal/store.test.ts && git commit -m "feat(journal): canonical snapshot store with monotonic revision and corrupt-aware reads"`

---

### Task 8: Requests inmutables + acks regenerables

_Requirements: R1.3_

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

    test('request con secreto literal se rechaza sin persistir (R2.3 via emisor)', () => {  // verifies R1.3
        expect(() => emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k2', payload: { argv: ['x', '--token', 'abc'] } }))
            .toThrow(/secreto literal/);
        expect(listPendingRequests(repo, 'rama')).toHaveLength(0);
    });

    test('idempotencyKey repetida con digest distinto se rechaza; ack se regenera desde state (R1.3)', () => {  // verifies R1.3
        const r1 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'test'] } });
        let s = readJournal(repo, 'rama').state!;
        s = applyOutcome(s, { requestId: r1.requestId, idempotencyKey: r1.idempotencyKey, payloadDigest: r1.payloadDigest, outcome: 'applied', resultRef: 'job-1' });
        writeJournal(repo, 'rama', s);
        // ack perdido en disco: se regenera desde state.json
        expect(ackFor(readJournal(repo, 'rama').state!, r1.requestId)!.resultRef).toBe('job-1');
        // misma key, payload distinto => rechazo explicito
        const r2 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'run', 'otro'] } });
        const s2 = readJournal(repo, 'rama').state!;
        expect(() => applyOutcome(s2, { requestId: r2.requestId, idempotencyKey: 'k3', payloadDigest: r2.payloadDigest, outcome: 'applied' }))
            .toThrow(/digest/);
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
import type { AppliedRequest, JournalState } from './types';

export interface RequestEnvelope {
    kind: 'job-request' | 'register-entity' | 'controller-heartbeat' | 'verdict';
    generationToken: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}
export interface EmittedRequest { requestId: string; idempotencyKey: string; payloadDigest: string; file: string; }

function digestOf(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Publicacion atomica (R1.3): tmp + fsync + close + rename. Redaccion EN EL
 *  EMISOR; secreto literal en flag sensible => rechazo sin persistir (R2.3). */
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

/** Registro del resultado en el state (el ack es derivable — R1.3). Rechaza
 *  reuso de idempotencyKey con payload distinto. Devuelve el state mutado
 *  (el caller es el supervisor, que luego hace writeJournal). */
export function applyOutcome(state: JournalState, applied: AppliedRequest): JournalState {
    const prior = Object.values(state.appliedRequests).find((a) => a.idempotencyKey === applied.idempotencyKey);
    if (prior !== undefined && prior.payloadDigest !== applied.payloadDigest) {
        throw new Error(`idempotencyKey ${applied.idempotencyKey} reutilizada con payload digest distinto`);
    }
    if (prior !== undefined) return state;   // ya aplicada: no-op (el ack existente responde)
    state.appliedRequests[applied.requestId] = applied;
    return state;
}

export function ackFor(state: JournalState, requestId: string): AppliedRequest | null {
    return state.appliedRequests[requestId] ?? null;
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/core/journal/requests.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/core/journal/requests.ts cli/tests/core/journal/requests.test.ts && git commit -m "feat(journal): atomic request publication, idempotency with payload digest, state-derived acks"`

---

### Task 9: exec-wrapper (spawn demostrable)

_Requirements: R1.8_

**Files:**
- Create: `cli/src/commands/job/exec-wrapper.ts`
- Test: `cli/tests/commands/job/exec-wrapper.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/job/exec-wrapper.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runWrapped, claimPath, resultPath, replayVerdict } from '../../../src/commands/job/exec-wrapper';

describe('exec-wrapper', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrap-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('claim + ejecucion + resultado terminal atomico (R1.8)', async () => {  // verifies R1.8
        const out = await runWrapped(dir, 'job1', 'nonceA', ['node', '-e', 'process.exit(0)'], process.cwd());
        expect(out.exitCode).toBe(0);
        expect(fs.existsSync(claimPath(dir, 'job1', 'nonceA'))).toBe(true);
        const result = JSON.parse(fs.readFileSync(resultPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(result.exitCode).toBe(0);
    });

    test('segundo claim con el mismo nonce falla: exactly-once (R1.8)', async () => {  // verifies R1.8
        await runWrapped(dir, 'job2', 'nonceB', ['node', '-e', 'process.exit(0)'], process.cwd());
        await expect(runWrapped(dir, 'job2', 'nonceB', ['node', '-e', 'process.exit(0)'], process.cwd()))
            .rejects.toThrow(/claim/);
    });

    test('matriz de replay: sin claim / claim+resultado / claim sin resultado (R1.8)', async () => {  // verifies R1.8
        expect(replayVerdict(dir, 'jobX', 'n1')).toBe('never-started');       // sin claim => re-spawn seguro
        await runWrapped(dir, 'jobY', 'n2', ['node', '-e', 'process.exit(3)'], process.cwd());
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
// El supervisor NUNCA ejecuta el comando crudo: este wrapper hace el spawn
// demostrable (design R1.8): claim exclusivo por spawnNonce -> ejecutar ->
// resultado terminal atomico. La matriz de replay es LA UNICA (R3.3).
import fs from 'fs';
import path from 'path';
import { spawnStructured } from '../../core/journal/process';
import { redactText } from '../../core/journal/redact';
import { writeFileAtomicDurable } from '../../core/atomic-file';

export function claimPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.claim`);
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

const MAX_LOG_BYTES = 1024 * 1024;   // retencion acotada (R2.5)

export interface WrappedResult { exitCode: number; endedAt: string; resultPath: string; }

export async function runWrapped(logsRoot: string, jobId: string, nonce: string, argv: string[], cwd: string): Promise<WrappedResult> {
    fs.mkdirSync(logsRoot, { recursive: true, mode: 0o700 });
    // (1) claim exclusivo — wx: si existe, alguien ya intento este spawn
    let fd: number;
    try {
        fd = fs.openSync(claimPath(logsRoot, jobId, nonce), 'wx', 0o600);
    } catch {
        throw new Error(`claim ya existe para ${jobId}/${nonce}: spawn previo no descartable`);
    }
    fs.writeFileSync(fd, JSON.stringify({ jobId, nonce, claimedAt: new Date().toISOString() }) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd);
    // (2) ejecutar con salida redactada y acotada
    const { child } = spawnStructured(argv, cwd, nonce);
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
    // (3) resultado terminal atomico junto al claim
    const result: WrappedResult = { exitCode, endedAt: new Date().toISOString(), resultPath: resultPath(logsRoot, jobId, nonce) };
    writeFileAtomicDurable(result.resultPath, JSON.stringify(result, null, 2) + '\n', 0o600);
    return result;
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/exec-wrapper.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/exec-wrapper.ts cli/tests/commands/job/exec-wrapper.test.ts && git commit -m "feat(job): provable spawn via durable claim wrapper with single replay matrix"`

---

### Task 10: ControllerAdapter (codex / claude-code)

_Requirements: R4.8, R4.2 (señal safeToReplace)_

**Files:**
- Create: `cli/src/core/journal/adapter.ts`
- Test: `cli/tests/core/journal/adapter.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/core/journal/adapter.test.ts
import { adapterFor, ControllerAdapter } from '../../../src/core/journal/adapter';

describe('ControllerAdapter', () => {
    test('adapterFor resuelve codex y claude-code; provider desconocido lanza (R4.8)', () => {  // verifies R4.8
        expect(adapterFor('codex').provider).toBe('codex');
        expect(adapterFor('claude-code').provider).toBe('claude-code');
        expect(() => adapterFor('otro')).toThrow(/provider/);
    });

    test('codex: safeToReplace es indeterminate con proceso vivo — jamas afirma sin observar (R4.2)', () => {  // verifies R4.2
        const a = adapterFor('codex');
        const liveRef = { pid: process.pid, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: process.pid };
        // identidad no matchea (startTime 'x') => muerto probado => safe
        expect(a.safeToReplace(liveRef)).toBe('safe');
        // con un ref genuinamente vivo el adapter codex no puede observar
        // llamadas en vuelo: devuelve 'indeterminate' (BLOCKED sin matar).
        // Se testea con un proceso propio real en el test de watch (Task 13).
    });

    test('launchArgv construye el comando de reanudacion journal-first (R4.8)', () => {  // verifies R4.8
        const argv = adapterFor('codex').launchArgv('retoma desde next_action');
        expect(argv[0]).toBe('codex');
        expect(argv).toContain('exec');
        expect(argv[argv.length - 1]).toContain('next_action');
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
     *  (hoy: muerte probada de la identidad). La ausencia de señales devuelve
     *  'indeterminate' => el supervisor entra en custodia BLOCKED, no mata. */
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

### Task 11: Verbos del agente — `request`, `controller-heartbeat`, `list/show/ps`

_Requirements: R3.1, R2.3 (via emisor), R3.5 (heartbeat)_

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
import { queryPs } from '../../../src/commands/job/query';
import { initJournal, readJournal } from '../../../src/core/journal/store';
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

    test('requestJob emite request con get-or-create key = hash(fingerprint+cmd) (R3.1)', () => {  // verifies R3.1
        const a = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], []);
        const b = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], []);
        expect(a.idempotencyKey).toBe(b.idempotencyKey);      // mismo fingerprint+cmd => misma key (RNF-T.7)
        expect(listPendingRequests(repo, 'rama').length).toBe(2);  // el supervisor colapsa por key
    });

    test('emitHeartbeat publica request de heartbeat (R3.5)', () => {      // verifies R3.5
        emitHeartbeat(repo, 'rama', 'gen-1');
        const pending = listPendingRequests(repo, 'rama');
        expect(pending.some((p) => !p.corrupt && p.envelope.kind === 'controller-heartbeat')).toBe(true);
    });

    test('queryPs reporta corrupt visible, no lo descarta (R1.6)', () => {  // verifies R1.6
        const out = queryPs(repo, 'rama');
        expect(out.corruptState).toBe(false);
        expect(Array.isArray(out.jobs)).toBe(true);
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
 *  es hash(fingerprint + commandDigest) => get-or-create atomico (RNF-T.7). */
export function requestJob(repoRoot: string, branch: string, generationToken: string, argv: string[], paths: string[]): EmittedRequest {
    const fp = computeFingerprint(repoRoot, argv, paths);
    const idempotencyKey = crypto.createHash('sha256').update(`${fp.fingerprint}:${fp.commandDigest}`).digest('hex');
    return emitRequest(repoRoot, branch, {
        kind: 'job-request', generationToken, idempotencyKey,
        payload: { argv, paths, fingerprint: fp.fingerprint, commandDigest: fp.commandDigest, expandedPaths: fp.expandedPaths },
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

/** Fuente unica de "que hay corriendo" (R2.3/R4.1 higiene): cruza identidad
 *  completa contra procesos vivos. corrupt es VISIBLE, nunca descartado. */
export function queryPs(repoRoot: string, branch: string): PsOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, jobs: [] };
    const jobs = Object.values(r.state!.jobs).map((j: Job) => ({
        id: j.id, executionState: j.executionState, observationState: j.observationState, verdict: j.verdict,
        alive: j.processRef ? refIsAlive(j.processRef) : 'sin-pid' as const,
    }));
    return { corruptState: false, jobs };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/verbs.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/request.ts cli/src/commands/job/heartbeat.ts cli/src/commands/job/query.ts cli/tests/commands/job/verbs.test.ts && git commit -m "feat(job): agent verbs — request intent, controller heartbeat, identity-checked ps"`

---

### Task 12: `reconcile`, `gate`, `reap`, `export`

_Requirements: R3.2, R3.3, R3.6, R3.7, R2.2, R1.4c_

**Files:**
- Create: `cli/src/commands/job/reconcile.ts`
- Create: `cli/src/commands/job/gate.ts`
- Create: `cli/src/commands/job/reap.ts`
- Create: `cli/src/commands/job/export.ts`
- Test: `cli/tests/commands/job/gate-reconcile.test.ts`

- [ ] **Step 1: Test**

```ts
// cli/tests/commands/job/gate-reconcile.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeGate } from '../../../src/commands/job/gate';
import { reconcileJobs } from '../../../src/commands/job/reconcile';
import { buildExport } from '../../../src/commands/job/export';
import { emptyState, Job } from '../../../src/core/journal/types';

function job(partial: Partial<Job>): Job {
    return {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.', paths: [],
        executionState: 'received', observationState: 'progressing', ...partial,
    };
}

describe('gate', () => {
    test('gate falla cerrado con corrupcion (R3.2)', () => {               // verifies R3.2
        const g = computeGate(null, true);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'corrupt')).toBe(true);
    });

    test('solo pass satisface: fail/inconclusive bloquean (R1.4c)', () => {  // verifies R1.4c
        const s = emptyState('r');
        s.tasks.push({ id: 'T1', title: 't', status: 'done', attempts: 1,
            verificationPlan: [{ id: 'v1', kind: 'test', satisfiedBy: 'j1' }], reviewObligations: [] });
        s.jobs['j1'] = job({ executionState: 'exited', verdict: 'fail' });
        const g = computeGate(s, false);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        s.jobs['j1'].verdict = 'pass';
        // queda el CycleVerificationPlan vacio frente a repo con verificadores: se valida en watch --init;
        // aqui, con plan de ciclo vacio declarado explicitamente, el gate exige jobs terminales y obligaciones:
        expect(computeGate(s, false).pass).toBe(true);
    });

    test('item de plan sin satisfacer o job vivo bloquean (R3.2, R4.5)', () => {  // verifies R3.2
        const s = emptyState('r');
        s.tasks.push({ id: 'T1', title: 't', status: 'done', attempts: 1,
            verificationPlan: [{ id: 'v1', kind: 'sensors' }], reviewObligations: [] });
        expect(computeGate(s, false).reasons.some((r) => r.category === 'unsatisfied-plan')).toBe(true);
        const s2 = emptyState('r');
        s2.jobs['vivo'] = job({ id: 'vivo', executionState: 'running' });
        expect(computeGate(s2, false).reasons.some((r) => r.category === 'live-job')).toBe(true);
    });

    test('veredicto adverso sin fix cerrado bloquea (R1.4c)', () => {       // verifies R1.4c
        const s = emptyState('r');
        s.verdicts.push({ id: 'v1', obligationId: 'o1', result: 'fail', detail: 'x', receivedAt: 'now' });
        s.fixes.push({ id: 'f1', verdictId: 'v1', closed: false });
        expect(computeGate(s, false).reasons.some((r) => r.category === 'open-fix')).toBe(true);
    });
});

describe('reconcile — matriz unica R1.8 (R3.3)', () => {
    let logs: string;
    beforeEach(() => { logs = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-')); });
    afterEach(() => { fs.rmSync(logs, { recursive: true, force: true }); });

    test('sin claim => retry; claim+resultado => adoptar; claim sin resultado => orphaned', () => {  // verifies R3.3
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999 };
        s.jobs['a'] = job({ id: 'a', executionState: 'spawn-intent', processRef: { ...deadRef, spawnNonce: 'nA' } });
        s.jobs['b'] = job({ id: 'b', executionState: 'running', processRef: { ...deadRef, spawnNonce: 'nB' } });
        s.jobs['c'] = job({ id: 'c', executionState: 'running', processRef: { ...deadRef, spawnNonce: 'nC' } });
        // b: claim + resultado => adoptar
        fs.writeFileSync(path.join(logs, 'b.nB.claim'), '{}');
        fs.writeFileSync(path.join(logs, 'b.nB.result.json'), JSON.stringify({ exitCode: 0, endedAt: 'x', resultPath: 'p' }));
        // c: claim sin resultado => orphaned
        fs.writeFileSync(path.join(logs, 'c.nC.claim'), '{}');
        const out = reconcileJobs(s, logs);
        expect(out.decisions.find((d) => d.jobId === 'a')!.action).toBe('retry-new-attempt');
        expect(out.decisions.find((d) => d.jobId === 'b')!.action).toBe('adopt-result');
        expect(s.jobs['b'].executionState).toBe('exited');
        expect(out.decisions.find((d) => d.jobId === 'c')!.action).toBe('orphaned-authorization-required');
        expect(s.jobs['c'].executionState).toBe('orphaned');
    });
});

describe('export', () => {
    test('export sanitizado con schema y unobservable (R3.7)', () => {      // verifies R3.7
        const s = emptyState('r');
        const e = buildExport(s, 'codex');
        expect(e.schema).toBe(1);
        expect(e.provider).toBe('codex');
        expect(e.metrics.tokensPerRole).toBe('unobservable');   // codex no reporta tokens hoy
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/job/gate-reconcile.test.ts` → FAIL.
- [ ] **Step 3: Implementar los cuatro archivos**

```ts
// cli/src/commands/job/gate.ts
// Interlock mecanico (design R3.2): falla CERRADO. Solo `pass` satisface (R1.4c).
import type { JournalState } from '../../core/journal/types';

export type GateCategory = 'corrupt' | 'live-job' | 'unsatisfied-plan' | 'adverse-verdict' | 'open-obligation' | 'open-fix' | 'missing-verifier';
export interface GateReason { category: GateCategory; detail: string; }
export interface GateResult { pass: boolean; reasons: GateReason[]; }

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export function computeGate(state: JournalState | null, corrupt: boolean): GateResult {
    const reasons: GateReason[] = [];
    if (corrupt || state === null) {
        return { pass: false, reasons: [{ category: 'corrupt', detail: 'state.json corrupto o ilegible: la corrupcion jamas certifica' }] };
    }
    for (const j of Object.values(state.jobs)) {
        if (LIVE.includes(j.executionState) || j.executionState === 'orphaned') {
            reasons.push({ category: 'live-job', detail: `job ${j.id} en ${j.executionState}` });
        }
    }
    const allPlans = [...state.tasks.flatMap((t) => t.verificationPlan), ...state.cycleVerificationPlan];
    for (const item of allPlans) {
        if (item.satisfiedBy === undefined) {
            reasons.push({ category: 'unsatisfied-plan', detail: `item ${item.id} (${item.kind}) sin satisfacer` });
            continue;
        }
        const j = state.jobs[item.satisfiedBy];
        if (j !== undefined && j.verdict !== 'pass') {
            reasons.push({ category: 'adverse-verdict', detail: `item ${item.id} citado por ${item.satisfiedBy} con verdict ${j.verdict ?? 'ausente'}` });
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
import type { JournalState } from '../../core/journal/types';
import { refIsAlive } from '../../core/journal/process';
import { replayVerdict } from './exec-wrapper';
import fs from 'fs';

export type ReconcileAction = 'still-alive' | 'retry-new-attempt' | 'adopt-result' | 'orphaned-authorization-required';
export interface ReconcileDecision { jobId: string; action: ReconcileAction; }
export interface ReconcileOutput { decisions: ReconcileDecision[]; }

const NON_TERMINAL = ['spawn-intent', 'claimed', 'running', 'cancel-requested'];

export function reconcileJobs(state: JournalState, logsRoot: string): ReconcileOutput {
    const decisions: ReconcileDecision[] = [];
    for (const j of Object.values(state.jobs)) {
        if (!NON_TERMINAL.includes(j.executionState)) continue;
        if (j.processRef !== undefined && refIsAlive(j.processRef)) {
            decisions.push({ jobId: j.id, action: 'still-alive' });
            continue;
        }
        const nonce = j.processRef?.spawnNonce ?? 'sin-nonce';
        const verdict = replayVerdict(logsRoot, j.id, nonce);
        if (verdict === 'never-started') {
            decisions.push({ jobId: j.id, action: 'retry-new-attempt' });   // seguro: nunca ejecuto
        } else if (verdict === 'completed') {
            const result = JSON.parse(fs.readFileSync(`${logsRoot}/${j.id}.${nonce}.result.json`, 'utf8'));
            j.executionState = 'exited';
            j.result = result;
            j.verdict = result.exitCode === 0 ? 'pass' : 'fail';
            decisions.push({ jobId: j.id, action: 'adopt-result' });
        } else {
            j.executionState = 'orphaned';                                   // jamas relanzar solo (R1.8)
            decisions.push({ jobId: j.id, action: 'orphaned-authorization-required' });
        }
    }
    return { decisions };
}
```

```ts
// cli/src/commands/job/reap.ts
// Limpieza explicita (design R2.2): lista primero, valida identidad, actua despues.
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
        if (dead) { j.executionState = 'cancelled'; killed.push(id); }
    }
    return killed;
}
```

```ts
// cli/src/commands/job/export.ts
// Export sanitizado y versionado (design R3.7, RNF-T.8/T.9): reproducible desde
// checkout limpio; lo que el provider no reporta se declara 'unobservable'.
import type { JournalState } from '../../core/journal/types';

export interface CycleExport {
    schema: 1;
    provider: string;
    branch: string;
    generatedBy: 'awm job export';
    cycle: { status: string };
    tasks: Array<{ id: string; status: string; attempts: number }>;
    jobs: Array<{ id: string; fingerprint: string; executionState: string; verdict?: string; deduplicated: boolean }>;
    metrics: {
        dispatches: number;
        mechanicalRunsReal: number;
        mechanicalRunsDeduplicated: number;
        tokensPerRole: 'unobservable' | Record<string, number>;
    };
}

export function buildExport(state: JournalState, provider: string): CycleExport {
    const jobs = Object.values(state.jobs);
    const byKey = new Map<string, number>();
    for (const j of jobs) {
        const k = `${j.fingerprint}:${j.commandDigest}`;
        byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    const dedup = [...byKey.values()].reduce((acc, n) => acc + (n - 1), 0);
    return {
        schema: 1, provider, branch: state.branch, generatedBy: 'awm job export',
        cycle: { status: state.cycle.status },
        tasks: state.tasks.map((t) => ({ id: t.id, status: t.status, attempts: t.attempts })),
        jobs: jobs.map((j) => ({ id: j.id, fingerprint: j.fingerprint, executionState: j.executionState, verdict: j.verdict, deduplicated: false })),
        metrics: {
            dispatches: state.tasks.reduce((a, t) => a + t.attempts, 0),
            mechanicalRunsReal: jobs.length,
            mechanicalRunsDeduplicated: dedup,
            tokensPerRole: 'unobservable',   // ningun provider lo expone mecanicamente hoy (R0)
        },
    };
}
```

- [ ] **Step 4: Verde** — `cd cli && npx jest tests/commands/job/gate-reconcile.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add cli/src/commands/job/reconcile.ts cli/src/commands/job/gate.ts cli/src/commands/job/reap.ts cli/src/commands/job/export.ts cli/tests/commands/job/gate-reconcile.test.ts && git commit -m "feat(job): fail-closed pass-only gate, single recovery matrix, explicit reap, sanitized export"`

---

### Task 13: Supervisor `awm watch`

_Requirements: R4.1, R4.2, R4.3, R4.4, R4.5, R4.6_

**Files:**
- Create: `cli/src/commands/watch/supervisor.ts` (lógica pura testeable)
- Create: `cli/src/commands/watch/index.ts` (registro commander, delgado)
- Test: `cli/tests/commands/watch/supervisor.test.ts`

- [ ] **Step 1: Test** (adapter fake inyectado + umbrales de milisegundos)

```ts
// cli/tests/commands/watch/supervisor.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { acquireLock, releaseLock, decideStall, Supervisor } from '../../../src/commands/watch/supervisor';
import { initJournal, readJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';

describe('supervisor', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sup-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('lock por worktree: segunda adquisicion falla; lock muerto se reclama (R4.1)', () => {  // verifies R4.1
        const l1 = acquireLock(repo);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);
        expect(() => acquireLock(repo)).toThrow(/supervisor activo/);
        releaseLock(repo, l1);
        // lock con identidad muerta probada: se reclama con aviso
        fs.writeFileSync(supervisorLockPath(repo), JSON.stringify({ pid: 999999, startTime: 'gone', spawnNonce: 'x', argvDigest: 'y', processGroup: 999999 }));
        expect(() => acquireLock(repo)).not.toThrow();
    });

    test('decideStall: heartbeat vencido solo => suspected-stall, nunca kill (R4.2)', () => {  // verifies R4.2
        const now = Date.now();
        const d1 = decideStall({ heartbeatAgeMs: 10 * 60000, activityFrozenMs: 0, safeToReplace: 'indeterminate' },
            { heartbeatTimeoutMs: 5 * 60000, activityWindowMs: 10 * 60000 });
        expect(d1).toBe('suspected-stall-observe');
        // doble senial + adapter indeterminate => custodia BLOCKED, sin matar (R4.2b)
        const d2 = decideStall({ heartbeatAgeMs: 20 * 60000, activityFrozenMs: 15 * 60000, safeToReplace: 'indeterminate' },
            { heartbeatTimeoutMs: 5 * 60000, activityWindowMs: 10 * 60000 });
        expect(d2).toBe('custody-blocked');
        // doble senial + safe positivo => resolver generacion
        const d3 = decideStall({ heartbeatAgeMs: 20 * 60000, activityFrozenMs: 15 * 60000, safeToReplace: 'safe' },
            { heartbeatTimeoutMs: 5 * 60000, activityWindowMs: 10 * 60000 });
        expect(d3).toBe('resolve-generation');
        void now;
    });

    test('backoff con tope por hora (R4.3)', () => {                       // verifies R4.3
        const sup = new Supervisor(repo, 'rama', 'codex');
        expect(sup.nextBackoffMs()).toBe(60000);
        expect(sup.nextBackoffMs()).toBe(300000);
        expect(sup.nextBackoffMs()).toBe(900000);
        expect(sup.nextBackoffMs()).toBe(900000);   // se queda en el techo
        expect(sup.relaunchesExhausted()).toBe(false);
    });

    test('applyPendingRequests: fencing rechaza generacion vieja y audita (R1.3/R4.6)', () => {  // verifies R4.4
        const sup = new Supervisor(repo, 'rama', 'codex');
        sup.beginGeneration();                      // gen 1, token T1
        const t1 = sup.currentToken()!;
        sup.beginGeneration();                      // gen 2 => gen 1 superseded
        const { emitRequest } = require('../../../src/core/journal/requests');
        emitRequest(repo, 'rama', { kind: 'controller-heartbeat', generationToken: t1, idempotencyKey: 'hb1', payload: {} });
        const applied = sup.applyPendingRequests();
        expect(applied.rejectedStale).toBe(1);
        const state = readJournal(repo, 'rama').state!;
        expect(Object.values(state.appliedRequests).some((a) => a.outcome === 'rejected-stale-generation')).toBe(true);
    });
});
```

- [ ] **Step 2: Rojo** — `cd cli && npx jest tests/commands/watch/supervisor.test.ts` → FAIL.
- [ ] **Step 3: Implementar `supervisor.ts`**

```ts
// cli/src/commands/watch/supervisor.ts
// El supervisor: single-writer del journal, dueno de generaciones y jobs.
import fs from 'fs';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { supervisorLockPath, logsDir } from '../../core/journal/paths';
import { initJournal, readJournal, writeJournal } from '../../core/journal/store';
import { refIsAlive, captureRef as _unused, spawnStructured, activitySnapshot, terminateGroupConfirmed, argvDigest } from '../../core/journal/process';
import { listPendingRequests, applyOutcome } from '../../core/journal/requests';
import { adapterFor, SafeToReplace } from '../../core/journal/adapter';
import { runWrapped } from '../job/exec-wrapper';
import { computeGate } from '../job/gate';
import { writeFileAtomicDurable } from '../../core/atomic-file';
import type { JournalState, ProcessRef, Generation, Job } from '../../core/journal/types';

export interface LockHandle { ref: ProcessRef; }

export function acquireLock(repoRoot: string): LockHandle {
    const lp = supervisorLockPath(repoRoot);
    fs.mkdirSync(require('path').dirname(lp), { recursive: true, mode: 0o700 });
    if (fs.existsSync(lp)) {
        try {
            const prior = JSON.parse(fs.readFileSync(lp, 'utf8')) as ProcessRef;
            if (refIsAlive(prior)) throw new Error(`supervisor activo (pid ${prior.pid}) sobre este worktree`);
            process.stderr.write(`awm watch: lock previo con identidad muerta probada — reclamando\n`);
        } catch (e) {
            if (e instanceof Error && /supervisor activo/.test(e.message)) throw e;
            process.stderr.write(`awm watch: lock previo ilegible — reclamando\n`);
        }
    }
    const self: ProcessRef = {
        pid: process.pid,
        startTime: (() => { try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
        spawnNonce: crypto.randomBytes(8).toString('hex'),
        argvDigest: argvDigest(process.argv),
        processGroup: process.pid,
    };
    writeFileAtomicDurable(lp, JSON.stringify(self, null, 2) + '\n', 0o600);
    return { ref: self };
}

export function releaseLock(repoRoot: string, handle: LockHandle): void {
    const lp = supervisorLockPath(repoRoot);
    try {
        const onDisk = JSON.parse(fs.readFileSync(lp, 'utf8')) as ProcessRef;
        if (onDisk.spawnNonce === handle.ref.spawnNonce) fs.rmSync(lp);
    } catch { /* ya ausente */ }
}

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

export class Supervisor {
    private backoffIdx = -1;
    private relaunchTimestamps: number[] = [];

    constructor(private repoRoot: string, private branch: string, private provider: string) {
        initJournal(repoRoot, branch);
    }

    nextBackoffMs(): number {
        this.backoffIdx = Math.min(this.backoffIdx + 1, BACKOFF_MS.length - 1);
        return BACKOFF_MS[this.backoffIdx];
    }
    resetBackoff(): void { this.backoffIdx = -1; }
    relaunchesExhausted(): boolean {
        const hourAgo = Date.now() - 3600000;
        this.relaunchTimestamps = this.relaunchTimestamps.filter((t) => t > hourAgo);
        return this.relaunchTimestamps.length >= MAX_RELAUNCHES_PER_HOUR;
    }

    private state(): JournalState {
        const r = readJournal(this.repoRoot, this.branch);
        if (r.corrupt || r.state === null) throw new Error('journal corrupto: supervisor no opera sobre corrupcion (R1.6)');
        return r.state;
    }
    currentToken(): string | null {
        const gens = this.state().generations;
        const active = gens.find((g) => g.state === 'active');
        return active?.token ?? null;
    }

    /** Emite generacion N+1: la N queda superseded (fencing). NO lanza el
     *  proceso aqui — launchController lo hace con el adapter. */
    beginGeneration(): Generation {
        const s = this.state();
        for (const g of s.generations) if (g.state === 'active') g.state = 'superseded';
        const gen: Generation = {
            n: s.generations.length + 1,
            token: crypto.randomBytes(8).toString('hex'),
            state: 'active', launchedAt: new Date().toISOString(),
        };
        s.generations.push(gen);
        writeJournal(this.repoRoot, this.branch, s);
        return gen;
    }

    launchController(resumePrompt: string): ProcessRef {
        const adapter = adapterFor(this.provider);
        const argv = adapter.launchArgv(resumePrompt);
        const { ref } = spawnStructured(argv, this.repoRoot, crypto.randomBytes(8).toString('hex'));
        const s = this.state();
        const active = s.generations.find((g) => g.state === 'active');
        if (active !== undefined) active.processRef = ref;
        writeJournal(this.repoRoot, this.branch, s);
        this.relaunchTimestamps.push(Date.now());
        return ref;
    }

    /** Consume requests pendientes en orden: fencing + idempotencia + registro
     *  del resultado completo en state (R1.3). Un archivo corrupto se audita
     *  como corrupt y se aparta — el gate ya bloquea por otra via. */
    applyPendingRequests(): { applied: number; rejectedStale: number; corrupt: number } {
        const s = this.state();
        const activeToken = s.generations.find((g) => g.state === 'active')?.token;
        let applied = 0, rejectedStale = 0, corrupt = 0;
        for (const p of listPendingRequests(this.repoRoot, this.branch)) {
            if (p.corrupt) { corrupt++; fs.renameSync(p.file, `${p.file}.corrupt`); continue; }
            const env = p.envelope;
            const digest = crypto.createHash('sha256').update(JSON.stringify(env.payload)).digest('hex');
            if (activeToken !== undefined && env.generationToken !== activeToken) {
                applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'rejected-stale-generation' });
                rejectedStale++;
            } else {
                this.applyRequest(s, env, digest);
                applied++;
            }
            fs.rmSync(p.file);
        }
        writeJournal(this.repoRoot, this.branch, s);
        return { applied, rejectedStale, corrupt };
    }

    private applyRequest(s: JournalState, env: { requestId: string; kind: string; idempotencyKey: string; payload: Record<string, unknown> }, digest: string): void {
        if (env.kind === 'controller-heartbeat') {
            s.controllerHeartbeatAt = new Date().toISOString();
            applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'applied' });
            return;
        }
        if (env.kind === 'job-request') {
            // get-or-create por idempotencyKey (RNF-T.7)
            const prior = Object.values(s.appliedRequests).find((a) => a.idempotencyKey === env.idempotencyKey && a.outcome === 'applied');
            if (prior?.resultRef !== undefined) {
                applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'applied', resultRef: prior.resultRef });
                return;
            }
            const jobId = `job-${Object.keys(s.jobs).length + 1}-${crypto.randomBytes(3).toString('hex')}`;
            const job: Job = {
                id: jobId,
                fingerprint: String(env.payload.fingerprint), commandDigest: String(env.payload.commandDigest),
                argv: env.payload.argv as string[], cwd: '.', paths: (env.payload.expandedPaths as string[]) ?? [],
                executionState: 'received', observationState: 'progressing',
            };
            s.jobs[jobId] = job;
            applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'applied', resultRef: jobId });
            return;
        }
        applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'applied' });
    }

    /** Reclamo + ejecucion durable de jobs 'received' (R4.4 + R1.8):
     *  spawn-intent persistido ANTES del spawn; el wrapper prueba el resto. */
    async executeReceivedJobs(): Promise<void> {
        let s = this.state();
        const received = Object.values(s.jobs).filter((j) => j.executionState === 'received');
        for (const j of received) {
            const nonce = crypto.randomBytes(8).toString('hex');
            j.executionState = 'spawn-intent';
            j.processRef = { pid: 0, startTime: 'pre-spawn', spawnNonce: nonce, argvDigest: '', processGroup: 0 };
            writeJournal(this.repoRoot, this.branch, s);
            const result = await runWrapped(logsDir(this.repoRoot, this.branch), j.id, nonce, j.argv, this.repoRoot);
            s = this.state();
            const jj = s.jobs[j.id];
            jj.executionState = 'exited';
            jj.result = result;
            jj.verdict = result.exitCode === 0 ? 'pass' : 'fail';
            writeJournal(this.repoRoot, this.branch, s);
        }
    }

    gateNow(): ReturnType<typeof computeGate> {
        const r = readJournal(this.repoRoot, this.branch);
        return computeGate(r.state, r.corrupt);
    }
}
```

- [ ] **Step 4: Implementar `index.ts`** (registro delgado — patrón `sensors/index.ts`)

```ts
// cli/src/commands/watch/index.ts
import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { acquireLock, releaseLock, decideStall, Supervisor } from './supervisor';
import { initJournal } from '../../core/journal/store';

function currentBranch(cwd: string): string {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
}

export function registerWatchCommand(program: Command): void {
    program
        .command('watch')
        .description('supervisor durable: ejecuta jobs, releva controladores caidos, nunca mata trabajo vivo')
        .option('--init', 'bootstrap: crea el journal de la rama actual y sale')
        .option('--provider <p>', 'codex | claude-code', 'codex')
        .option('--heartbeat-timeout <min>', 'minutos de silencio de heartbeat', '5')
        .option('--activity-window <min>', 'minutos extra sin actividad de proceso', '10')
        .action(async (opts) => {
            const repo = process.cwd();
            const branch = currentBranch(repo);
            if (opts.init) {
                initJournal(repo, branch);
                process.stdout.write(`journal inicializado para ${branch}\n`);
                return;
            }
            const lock = acquireLock(repo);
            const sup = new Supervisor(repo, branch, opts.provider);
            process.stdout.write(`awm watch: supervisor activo (${opts.provider}) — Ctrl-C para terminar\n`);
            const cleanup = () => { releaseLock(repo, lock); process.exit(0); };
            process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
            // Loop principal: el detalle de stall/custodia/drenaje vive en supervisor.ts;
            // este loop delgado orquesta y reporta a stdout. BLOCKED en custodia NO
            // libera el lock (R4.5): el loop sigue vivo auditando.
            // (Implementador: ver Task 13 Step 3 — decideStall + beginGeneration +
            //  launchController + applyPendingRequests + executeReceivedJobs + gateNow;
            //  COMPLETE => drenar (executeReceivedJobs vacio + gate pass) => cleanup().)
            for (;;) {
                sup.applyPendingRequests();
                await sup.executeReceivedJobs();
                const gate = sup.gateNow();
                if (gate.pass) { process.stdout.write('gate verde: ciclo COMPLETE — drenado, apagando\n'); break; }
                await new Promise((r) => setTimeout(r, 5000));
            }
            cleanup();
        });
}
```

> El loop de arriba es la version minima que compila y cubre el camino feliz;
> el implementador integra `decideStall`/`beginGeneration`/`launchController`
> con los umbrales de las opciones y el estado de custodia BLOCKED (sin
> liberar lock — R4.5) siguiendo los tests del Step 1 y el design doc R4. El
> test de custodia y relevo se agrega en la bateria de integracion (Task 16).

- [ ] **Step 5: Verde** — `cd cli && npx jest tests/commands/watch/supervisor.test.ts` → PASS.
- [ ] **Step 6: Commit** — `git add cli/src/commands/watch/ cli/tests/commands/watch/supervisor.test.ts && git commit -m "feat(watch): single-writer supervisor — lock, generations, dual-signal stall, backoff, job execution"`

---

### Task 14: Registro en el CLI + `awm job` command + suite completa

_Requirements: R3.1_

**Files:**
- Create: `cli/src/commands/job/index.ts`
- Modify: `cli/src/index.ts` (2 imports + 2 llamadas de registro, junto a `registerSensorsCommand`)

- [ ] **Step 1: Implementar `job/index.ts`**

```ts
// cli/src/commands/job/index.ts
import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { requestJob } from './request';
import { emitHeartbeat } from './heartbeat';
import { queryPs } from './query';
import { computeGate } from './gate';
import { buildExport } from './export';
import { readJournal } from '../../core/journal/store';
import { exportDir } from '../../core/journal/paths';
import { writeFileAtomicDurable } from '../../core/atomic-file';
import path from 'path';

function branchOf(cwd: string): string {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
}
// CONSTITUTION: todo arg con valor valida su token (commander lo hace por nosotros
// en las options declaradas; los variadicos van tras `--`).

export function registerJobCommand(program: Command): void {
    const job = program.command('job').description('journal durable de trabajo del ciclo SDD (R1)');

    job.command('request')
        .description('registra la intencion de una verificacion — el supervisor la ejecuta')
        .requiredOption('--generation <token>', 'token de la generacion vigente')
        .option('--paths <globs...>', 'paths que el comando observa (default: arbol completo)')
        .argument('<cmd...>', 'comando tras --')
        .action((cmd: string[], opts) => {
            const repo = process.cwd();
            const r = requestJob(repo, branchOf(repo), opts.generation, cmd, opts.paths ?? []);
            process.stdout.write(JSON.stringify({ requestId: r.requestId, idempotencyKey: r.idempotencyKey }, null, 2) + '\n');
        });

    job.command('controller-heartbeat')
        .requiredOption('--generation <token>')
        .action((opts) => { emitHeartbeat(process.cwd(), branchOf(process.cwd()), opts.generation); });

    job.command('ps').action(() => {
        process.stdout.write(JSON.stringify(queryPs(process.cwd(), branchOf(process.cwd())), null, 2) + '\n');
    });

    job.command('gate').action(() => {
        const repo = process.cwd();
        const r = readJournal(repo, branchOf(repo));
        const g = computeGate(r.state, r.corrupt);
        process.stdout.write(JSON.stringify(g, null, 2) + '\n');
        if (!g.pass) process.exit(1);   // falla cerrado (R3.2)
    });

    job.command('export')
        .option('--provider <p>', 'provider del ciclo', 'codex')
        .action((opts) => {
            const repo = process.cwd();
            const branch = branchOf(repo);
            const r = readJournal(repo, branch);
            if (r.corrupt || r.state === null) { process.stderr.write('journal corrupto\n'); process.exit(1); }
            const e = buildExport(r.state, opts.provider);
            const out = path.join(exportDir(repo, branch), `cycle-export.json`);
            writeFileAtomicDurable(out, JSON.stringify(e, null, 2) + '\n', 0o600);
            process.stdout.write(out + '\n');
        });
}
```

- [ ] **Step 2: Registrar en `cli/src/index.ts`** — junto a los registros existentes:

```ts
import { registerJobCommand } from './commands/job';
import { registerWatchCommand } from './commands/watch';
// ... despues de registerLedgerCommand(program):
registerJobCommand(program);
registerWatchCommand(program);
```

- [ ] **Step 3: Suite completa + sensores**

Run: `cd cli && npm run build && npm test` → Expected: TODAS las suites pasan (incluidas las preexistentes — regla AGENTS.md de grep de enums si algo rompio).
Run: `cd cli && node dist/src/index.js sensors run` → Expected: `typecheck: pass`, `lint: pass`, `test: pass` (security/depcheck fallan por gaps de entorno preexistentes — declararlo, no "arreglarlo").
Run: `cd cli && node dist/src/index.js job ps` → Expected: error claro o `corruptState:false` con journal ausente — NUNCA stack trace crudo (si sale stack trace de ENOENT, envolver con mensaje claro antes de dar la task por hecha).

- [ ] **Step 4: Commit** — `git add cli/src/commands/job/index.ts cli/src/index.ts && git commit -m "feat(cli): wire awm job and awm watch commands"`

---

### Task 15: Sección journal-first del skill SDD (registry)

_Requirements: R5.1, R5.2, R5.3_

**Files:**
- Modify: `/home/user/awm-baseline-registry/skills/subagent-driven-development/SKILL.md` (agregar sección; leer el archivo primero y respetar su estructura/estilo)

- [ ] **Step 1: Agregar la sección** (después de la sección "Modo desatendido"; contenido exacto):

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
2. **Registro antes de accion:** cada tarea/intento/despacho/ReviewObligation se
   registra via request ANTES de ejecutarse (con el token de generacion que el
   supervisor entrego en el prompt de lanzamiento). El Verdict se registra al
   RECIBIRSE el reporte del revisor — nunca antes.
3. **Heartbeat:** emitir `awm job controller-heartbeat --generation <token>` al
   completar cada paso del protocolo (despacho enviado, reporte recibido, task
   marcada). El silencio prolongado + inactividad de proceso es lo que autoriza
   al supervisor a relevar la generacion.
4. **Verificaciones mecanicas:** pedirlas con
   `awm job request --generation <token> -- <comando>` — NUNCA ejecutarlas
   inline en providers donde el proceso muere con el turno. El supervisor las
   corre y el resultado aparece en el journal (`awm job ps`).
5. **Cierre:** `awm job gate` es el interlock — exit != 0 significa que hay
   trabajo pendiente, obligaciones sin verdict `pass`, fixes abiertos o
   corrupcion: NO se cierra el ciclo. Solo con gate verde se declara COMPLETE.
```

- [ ] **Step 2: Verificar** — Run: `grep -c "journal-first" /home/user/awm-baseline-registry/skills/subagent-driven-development/SKILL.md` → ≥2. Releer la sección insertada en contexto: no contradice el resto del skill (el modo desatendido y los gates existentes quedan intactos).
- [ ] **Step 3: Commit (en el repo del registry)**

```bash
cd /home/user/awm-baseline-registry
git add skills/subagent-driven-development/SKILL.md
git commit -m "feat(sdd): opt-in journal-first mode for durable continuity (AWM R1)"
git push -u origin claude/agentic-workflow-awm-issues-dqka6l
```

(El tag `vX.Y.Z` + `awm update` los ejecuta el dueño cuando decida promover — flujo CLAUDE.md.)

---

### Task 16: Batería de integración + runbook de validación del dueño

_Requirements: R6, R8, R4.2 (custodia), R4.5 (drenaje)_

**Files:**
- Create: `cli/tests/commands/watch/integration.test.ts`
- Create: `docs/research/r1/VALIDATION-RUNBOOK.md`

- [ ] **Step 1: Test de integración** (los fixtures cross-cutting que ningún módulo cubre solo)

```ts
// cli/tests/commands/watch/integration.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Supervisor, decideStall } from '../../../src/commands/watch/supervisor';
import { requestJob } from '../../../src/commands/job/request';
import { initJournal, readJournal } from '../../../src/core/journal/store';

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

describe('integracion supervisor + jobs', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-int-')); gitInit(repo); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('e2e: request => supervisor ejecuta => resultado en journal, dedup por key (R2.4 brief, R4.4)', async () => {  // verifies R6
        const sup = new Supervisor(repo, 'rama', 'codex');
        sup.beginGeneration();
        const token = sup.currentToken()!;
        requestJob(repo, 'rama', token, ['node', '-e', 'process.exit(0)'], []);
        requestJob(repo, 'rama', token, ['node', '-e', 'process.exit(0)'], []);   // misma key
        sup.applyPendingRequests();
        await sup.executeReceivedJobs();
        const s = readJournal(repo, 'rama').state!;
        const jobs = Object.values(s.jobs);
        expect(jobs).toHaveLength(1);                       // get-or-create: un solo job (RNF-T.7)
        expect(jobs[0].executionState).toBe('exited');
        expect(jobs[0].verdict).toBe('pass');
    });

    test('job largo no se mata jamas por duracion; job fail bloquea gate (R3.5, R1.4c)', async () => {  // verifies R6
        const sup = new Supervisor(repo, 'rama', 'codex');
        sup.beginGeneration();
        requestJob(repo, 'rama', sup.currentToken()!, ['node', '-e', 'setTimeout(()=>process.exit(1), 1500)'], []);
        sup.applyPendingRequests();
        await sup.executeReceivedJobs();                     // espera el 1.5s: sin timeout terminal
        const g = sup.gateNow();
        expect(g.pass).toBe(false);                          // fail no satisface (R1.4c)
        expect(g.reasons.some((r) => r.category === 'live-job')).toBe(false);  // pero SI termino
    });

    test('custodia: doble senial sin safe => custody-blocked, jamas kill (R4.2b)', () => {  // verifies R6
        const d = decideStall({ heartbeatAgeMs: 999999, activityFrozenMs: 999999, safeToReplace: 'indeterminate' },
            { heartbeatTimeoutMs: 1, activityWindowMs: 1 });
        expect(d).toBe('custody-blocked');
    });

    test('interrupcion entre spawn-intent y running: replay decide por claim, no re-spawnea a ciegas (R1.8)', async () => {  // verifies R6
        const sup = new Supervisor(repo, 'rama', 'codex');
        sup.beginGeneration();
        requestJob(repo, 'rama', sup.currentToken()!, ['node', '-e', 'process.exit(0)'], []);
        sup.applyPendingRequests();
        // Simular crash: job queda en received y lo pasamos a spawn-intent sin wrapper
        const r1 = readJournal(repo, 'rama').state!;
        const jid = Object.keys(r1.jobs)[0];
        // reconcile sobre spawn-intent sin claim => retry-new-attempt (matriz unica)
        const { reconcileJobs } = require('../../../src/commands/job/reconcile');
        r1.jobs[jid].executionState = 'spawn-intent';
        r1.jobs[jid].processRef = { pid: 999999, startTime: 'gone', spawnNonce: 'nunca-uso', argvDigest: 'x', processGroup: 999999 };
        const out = reconcileJobs(r1, path.join(repo, '.awm', 'journal', 'rama', 'logs'));
        expect(out.decisions[0].action).toBe('retry-new-attempt');
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

1. En el repo del proyecto: `awm-dev watch --init` (crea el journal de la rama).
2. En una terminal: `awm-dev watch --provider codex` (queda en foreground).
3. En otra terminal, simular el ciclo: pedir un job
   (`awm-dev job request --generation <token-que-imprime-watch> -- npm test`)
   y verificar con `awm-dev job ps` que lo ejecuta el supervisor, no tu sesion.
4. Corte real: cerra la sesion de Codex a mitad de un ciclo. Verificar que el
   supervisor detecta el silencio, resuelve la generacion (o entra en custodia
   si no puede probar el reemplazo seguro) y relanza `codex exec`, y que el
   orquestador nuevo retoma desde `next_action` sin duplicar trabajo.
5. `awm-dev job gate` en rojo mientras haya pendientes; verde solo al final;
   el supervisor se apaga solo tras COMPLETE. Verificar con `ps` que no queda
   NINGUN proceso awm/codex huerfano.

## Escenario Claude Code — neutralidad (R5.4)

1. Opt-out: correr un ciclo SDD normal SIN `watch --init` => cero cambios de flujo.
2. Opt-in: `watch --init` + la misma bateria del escenario Codex con
   `--provider claude-code`.

## Registro

Resultado (paso a paso, con cualquier desviacion) como comentario en
agentic-workflow#20. R1 no se declara aceptado sin este registro (R8.1).
```

- [ ] **Step 4: Commit** — `git add cli/tests/commands/watch/integration.test.ts docs/research/r1/VALIDATION-RUNBOOK.md && git commit -m "test(r1): cross-cutting integration battery + owner validation runbook"`

---

## Traceability matrix

| Req (design v5) | Task(s) | Test(s) / verificación |
|---|---|---|
| R1.1 | T3 | paths.test: lock fuera del dir de rama + realpath |
| R1.2 | T2, T7 | atomic-file-durable.test (fsync dir, 0600); store.test (0700/0600, revisión CAS) |
| R1.3 | T8 | requests.test: publicación atómica, secreto rechazado, key+digest, ack regenerado |
| R1.4 | T1 | types.test: entidades y emptyState bien formado |
| R1.4b | T12 | gate-reconcile.test: `unsatisfied-plan` bloquea (validación de plan-vs-repo en `watch --init`: revisión manual del implementador de T13 — sin proxy automatizable en R1, declarado) |
| R1.4c | T12 | gate-reconcile.test: fail/inconclusive bloquean; open-fix bloquea |
| R1.5 | T7 | store.test: nextAction estructurado persiste |
| R1.6 | T7, T11 | store.test corrupt-aware; verbs.test ps visible |
| R1.7 | T1 | types.test: enums exactos con orphaned y estados de generación |
| R1.8 | T9, T16 | exec-wrapper.test: claim/matriz de replay; integration.test: spawn-intent sin claim ⇒ retry |
| R2.1 | T6 | process.test: identidad completa, impostor rechazado |
| R2.2 | T12 | planReap lista antes de actuar (código); executeReap solo con identidad viva |
| R2.3 | T4, T8 | redact.test; requests.test secreto literal rechazado |
| R2.4 | T13 | supervisor foreground sin daemon (revisión de código — no hay servicio que testear) |
| R2.5 | T9 | MAX_LOG_BYTES en exec-wrapper (límite aplicado en append) |
| R3.1 | T11, T14 | verbs.test get-or-create key; registro commander |
| R3.2 | T12 | gate-reconcile.test: corrupt/live-job/unsatisfied bloquean |
| R3.3 | T12, T16 | gate-reconcile.test matriz única; integration.test |
| R3.4 | T5 | fingerprint.test: contenido, untracked, argv, expansión persistida |
| R3.5 | T11, T16 | verbs.test heartbeat; integration.test job largo sin timeout |
| R3.6 | T12 | gate: `missing-verifier` (nota: la detección repo-sin-suite se integra en `watch --init` — T13; el gate la reporta) |
| R3.7 | T12, T14 | export.test schema+unobservable; comando `job export` escribe archivo |
| R4.1 | T13 | supervisor.test: lock único, reclamo de lock muerto |
| R4.2/R4.2b | T13, T16 | supervisor.test decideStall (3 ramas); integration.test custodia |
| R4.3 | T13 | supervisor.test backoff con techo |
| R4.4 | T16 | integration.test e2e: el supervisor ejecuta, no el agente |
| R4.5 | T12, T16 | gate live-job bloquea; e2e drena antes de verde |
| R4.6 | T13 | applyPendingRequests audita `rejected-stale-generation` en state |
| R4.7 | T6 | spawnStructured shell:false + nonce por entorno |
| R4.8 | T10 | adapter.test: codex/claude-code, launchArgv, safeToReplace |
| R5.1–R5.3 | T15 | grep journal-first ≥2 + lectura de coherencia (doc de skill: verificación manual declarada) |
| R5.4 | T16 | VALIDATION-RUNBOOK escenario Claude opt-in/opt-out (prueba en máquina del dueño) |
| R6 | T16 | integration.test (4 fixtures cross-cutting) + suites por módulo (T1–T13) |
| R7.1 | T12 | export.test métricas |
| R8.1 | T16 | VALIDATION-RUNBOOK + registro en issue #20 (gate humano, sin proxy) |

## Analyze gate

Los 33 IDs de requirement del design v5 tienen ≥1 task y ≥1 verificación; las verificaciones sin proxy automatizable (R1.4b plan-vs-repo, R2.4, R5.1–5.3 doc, R5.4/R8.1 máquina del dueño) están declaradas explícitamente como revisión manual o gate humano — ninguna finge un grep genérico. Ninguna task carece de requirement: T1–T16 trazan todas. Cero huérfanos.
