# R5 Parallel Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar paralelismo durable entre tracks realmente independientes, con fallback serial seguro, integración final verificable y comportamiento equivalente en Claude Code y Codex.

**Architecture:** El journal del plan conserva la autoridad single-writer y coordina journals independientes por worktree. Antes de tocar Git, un reducer puro modela bootstrap, activación, freeze, join, validación final y teardown; la implementación productiva traduce cada efecto aprobado por el reducer a operaciones idempotentes con intent persistido. Todos los tracks quedan `MERGED_UNVERIFIED` antes de ejecutar QA global, un único comando canónico de integración sobre el HEAD final y el interlock de cierre.

**Tech Stack:** TypeScript 5.9 en `cli/` (Node ≥20, commander, `execFileSync`/`spawn` con argv estructurado, cero dependencias runtime nuevas), Jest 30 con repos Git y tmpdirs aislados; Markdown + tests Node del repo hermano `awm-baseline-registry` para las skills.

**Modo de ejecución:** interactivo

---

## Fuentes y autoridad

- Diseño fuente: `docs/plans/2026-08-02-r5-parallel-tracks-design.md` v3, commit `bc6fdfc`.
- Brief fuente: `docs/plans/2026-07-30-sdd-cycle-optimization-brief.md`, especialmente RF-4.1–RF-4.3, RNF-T.2, RNF-T.5, CA-4.1–CA-4.3 y CA-T.5.
- Base ya entregada: R1 durable controller, CLI v3.5.0.
- Los IDs `R1.1`–`R10.4` de este plan nombran requisitos del diseño R5, no los requisitos homónimos del diseño R1.
- Las restricciones `C1`–`C11` de la siguiente sección resuelven los hallazgos abiertos de la última review. Para la implementación R5 son normativas cuando precisan o restringen la v3; no amplían el valor de producto.
- Este plan cubre CLI + registry en una sola unidad porque las skills consumen el contrato exacto del CLI y no producen software útil de forma independiente. Los commits y PRs siguen siendo separados por repositorio.

## Resoluciones normativas de convergencia

- **C1 — Barrera ARMED:** preparar un track no lo activa. El supervisor del plan genera el `readinessNonce`, lanza cada wrapper con ese nonce y espera que todos los journals lo acrediten como `ARMED`; solo entonces persiste `cohortState: ACTIVE`. Después promueve de `ARMED` a track `ACTIVE` hasta el tope configurado; los excedentes permanecen armados pero sin loop de fingerprint ni despachos. No hay ejecución parcial antes de que la cohorte completa esté preparada.
- **C2 — Fallback tras bootstrap parcial:** si cualquier preparación falla antes de `ACTIVE`, el supervisor persiste `fallback-intent`, congela nuevos spawns, ejecuta el teardown durable de todos los recursos demostrablemente propios y solo después retorna a ejecución serial. Nunca corre serial mientras quedan supervisores o worktrees de la cohorte activos.
- **C3 — Orden final único:** `todos frozen → todos MERGED_UNVERIFIED → QA global y fixes → commit limpio → un job canónico track-integration → interlock → COMPLETE`. No se produce evidencia global entre merges y ninguna mutación puede ocurrir después del fingerprint final.
- **C4 — Comando canónico mecánico:** el plan declara una única `Integration argv:` como array JSON de strings y `Integration paths:` como array JSON de strings. El parser persiste ambos; el supervisor los pasa sin shell a `requestJob`; el job resultante satisface todos los items `track-integration:*`. Prosa libre no puede seleccionar el comando.
- **C5 — Clasificadores globales fail-closed:** tocar una clase global observable (lockfile, manifest, migración, snapshot o generado) en cualquier track invalida el paralelismo de toda la cohorte, aunque solo un track la toque. Esta es la interpretación que hace verdadero CA-4.3.
- **C6 — Gate local separado:** `computeTrackGate` no hereda la exigencia global de `qa` + `interlock`; verifica tareas asignadas, revisiones, fixes y verificadores locales declarados. `computeGate` conserva el contrato global de R1.
- **C7 — Freeze y leases:** aceptar join primero congela el track en un SHA, termina su supervisor con identidad confirmada y libera su lock. Antes de mutar la rama del plan, el supervisor pausa su controller generation y adquiere `integration.lock`; valida `expectedPlanHeadSha` antes y después de cada side effect. Cambios concurrentes producen `blocked`, nunca una rebase o merge implícito.
- **C8 — Tokens y generaciones:** el supervisor del plan genera `journalId` al init, `fencingToken` al declarar track, `supervisorIntent.nonce` al armar el spawn y `readinessNonce` al comenzar la preparación. El supervisor del track solo refleja el readiness recibido. Ningún token se regenera durante reconciliación del mismo intent.
- **C9 — Teardown durable:** remove recorre `teardown-requested → teardown-intent → supervisor-stopped → worktree-removed → branch-removed → removed`; cada paso tiene evidencia y reconciliación. Solo elimina paths/branch registrados en el intent y bloquea ante identidad o contenido ajenos.
- **C10 — Límite de recursos externos:** RF-4.3 se certifica mecánicamente para archivos reales y para recursos previamente declarados. Puertos, bases o servicios usados sin declaración no son observables de forma portable; el CLI no afirma detectarlos y el E2E demuestra el fallback por declaración ausente/intersectada.
- **C11 — Spawn exactamente una vez observable:** el spawn del supervisor usa `supervisorIntent` persistido antes del side effect y un wrapper con claim `wx` por nonce. Tras crash, claim/identity/readiness distinguen “no arrancó”, “arrancó” e “indemostrable”; el último caso bloquea y nunca duplica.

## Gate de convergencia

La Task 1 es un gate duro. Las Tasks 2–4 pueden preparar contratos puros, pero **ninguna Task 5 o posterior puede comenzar** hasta que:

```bash
cd cli
npx jest tests/core/tracks/protocol.test.ts --runInBand
```

termine en PASS, incluidos el recorrido acotado de estados y la inyección de crash en cada frontera `intent → effect → observation → result`. Si aparece una combinación no representable, se corrige el reducer y esta sección del plan antes de escribir adaptadores Git.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/tracks/types.ts` | Tipos de cohorte, tracks, intents, efectos y contratos del plan |
| `cli/src/core/tracks/protocol.ts` | Reducer puro, reconciliación y chequeo de invariantes |
| `cli/src/core/tracks/plan-parser.ts` | Parser de `## Tracks`, `**Track:**`, Files e Integration argv/paths |
| `cli/src/core/tracks/ownership.ts` | Normalización, globs/directorios, recursos y clasificadores globales |
| `cli/src/core/tracks/descriptor.ts` | `.awm/track.json`, realpaths, autenticación y fencing |
| `cli/src/core/tracks/context.ts` | Resolución plan/track y validación del cwd para `awm job/watch/track` |
| `cli/src/core/tracks/git.ts` | Único adaptador Git; argv estructurado, freeze, diff, merge y cleanup |
| `cli/src/core/tracks/teardown.ts` | Observaciones y efectos idempotentes del state machine de remove |
| `cli/src/commands/job/gate.ts` | `computeTrackGate` además del gate global existente |
| `cli/src/core/journal/{types,store,requests}.ts` | Esquema aditivo, migración, nuevos request kinds y guards |
| `cli/src/commands/watch/{init,apply,supervisor,runner}.ts` | Registro de cohorte y ejecución single-writer de P1/P2/finalización |
| `cli/src/commands/track/{index,emit,status}.ts` | Superficie `awm track`; mutadores solo emiten, consultas son read-only |
| `cli/src/commands/track/supervisor-wrapper.ts` | Claim/identity/readiness durable del supervisor detached de un track |
| `cli/src/commands/job/{index,request}.ts` | Contexto autenticado y guard del job de integración final |
| `cli/src/commands/watch/index.ts`, `cli/src/index.ts` | Opciones de concurrencia y registro del comando `track` |
| `cli/tests/core/tracks/*.test.ts` | Pruebas puras de protocolo, parser, ownership, descriptor y Git |
| `cli/tests/commands/track/*.test.ts` | CLI, requests, status agregado y guards |
| `cli/tests/commands/watch/track-*.test.ts` | Bootstrap, crash/restart, join, finalización y teardown |
| `cli/tests/integration/parallel-tracks.e2e.test.ts` | CA-4.1–CA-4.3 con procesos y repos Git reales |
| `docs/research/r5/benchmark-fingerprint.mjs` | Medición reproducible para derivar el tope default |
| `docs/research/r5/provider-run.mjs` | Runner de aceptación real por provider/entorno |
| `docs/research/r5/evidence/*.json` | Evidencia sanitizada y versionada de Claude Code y Codex |
| `awm-baseline-registry/skills/writing-plans/SKILL.md` | Gramática de tracks y comando canónico en planes futuros |
| `awm-baseline-registry/skills/subagent-driven-development/SKILL.md` | Detección y conducta del modo track |
| `awm-baseline-registry/skills/post-implementation-qa/SKILL.md` | Rechazo explícito en track y QA solo sobre HEAD final del plan |
| `awm-baseline-registry/tests/r5-track-contract.test.mjs` | Contrato mecánico de las tres skills |

## Orden de ejecución

```text
T1 protocol proof
 ├─ T2 schema ─┬─ T5 authenticated context ─┬─ T6 CLI requests/status
 ├─ T3 parser ─┤                            └─ T8 bootstrap
 └─ T4 ownership ┘                              ├─ T9 crash/fallback
T7 benchmark/cap ───────────────────────────────┘
T8/T9 → T10 freeze → T11 join matrix → T12 final validation → T13 teardown
T3/T5/T12 → T14 registry contract
T6–T14 → T15 acceptance E2E → T16 real providers → T17 regression/handoff
```

### Task 1: Modelo ejecutable del protocolo y exploración de estados

_Requirements: R4.1, R4.2, R4.4, R6.2, R6.3, R6.8, R6.9, R7.7, R8.1, R8.2, C1, C2, C3, C7, C9, C11_

**Files:**
- Create: `cli/src/core/tracks/types.ts`
- Create: `cli/src/core/tracks/protocol.ts`
- Create: `cli/tests/core/tracks/protocol.test.ts`

- [ ] **Step 1: Escribir los tests rojos de invariantes y reconciliación**

```ts
// cli/tests/core/tracks/protocol.test.ts
import {
    assertProtocolInvariants, initialCohort, nextProtocolEffect,
    observeProtocolEffect, reconcileProtocol,
} from '../../../src/core/tracks/protocol';
import type { CohortProtocol, ProtocolObservation } from '../../../src/core/tracks/types';

const ids = ['cli', 'docs'];

describe('parallel-track protocol model', () => {
    test('no activa parcialmente: todos deben estar ARMED (R4.4, C1)', () => {
        let s = initialCohort('journal-1', ids);
        s.tracks.cli.phase = 'ARMED';
        expect(nextProtocolEffect(s)).not.toEqual({ kind: 'activate-cohort' });
        s.tracks.docs.phase = 'ARMED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'activate-cohort' });
    });

    test('un fallo pre-ACTIVE entra a teardown y solo luego a serial (R4.5, C2)', () => {
        let s = initialCohort('journal-1', ids);
        s.tracks.cli.phase = 'WORKTREE_CREATED';
        s.tracks.docs.phase = 'BLOCKED';
        s = reconcileProtocol(s, { kind: 'prepare-failed', trackId: 'docs', detail: 'disk full' });
        expect(s.cohortPhase).toBe('FALLBACK_PENDING');
        expect(nextProtocolEffect(s)).toEqual({ kind: 'begin-teardown', trackId: 'cli' });
        s.tracks.cli.phase = 'REMOVED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'enter-serial', reason: 'prepare-failed:docs' });
    });

    test('el orden final no produce evidencia antes del HEAD final (R7.7, C3)', () => {
        const s = initialCohort('journal-1', ids);
        s.cohortPhase = 'ACTIVE';
        s.tracks.cli.phase = 'MERGED_UNVERIFIED';
        s.tracks.docs.phase = 'FROZEN';
        expect(nextProtocolEffect(s)).not.toMatchObject({ kind: 'request-global-qa' });
        s.tracks.docs.phase = 'MERGED_UNVERIFIED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'request-global-qa' });
    });

    test('una observación indemostrable bloquea sin efecto destructivo (R6.9, C11)', () => {
        const s = initialCohort('journal-1', ['cli']);
        s.cohortPhase = 'JOINING';
        s.tracks.cli.phase = 'JOIN_INTENT';
        const out = reconcileProtocol(s, { kind: 'join-observation', trackId: 'cli', mergeHead: 'other', planHead: 'other' });
        expect(out.tracks.cli.phase).toBe('BLOCKED');
        expect(nextProtocolEffect(out)).toBeNull();
    });

    test('ningún estado alcanzable viola invariantes al crashear entre fronteras (R4.2, R6.8, C9, C11)', () => {
        const queue: CohortProtocol[] = [initialCohort('journal-1', ids)];
        const seen = new Set<string>();
        while (queue.length > 0 && seen.size < 5000) {
            const state = queue.shift()!;
            const key = JSON.stringify(state);
            if (seen.has(key)) continue;
            seen.add(key);
            expect(() => assertProtocolInvariants(state)).not.toThrow();
            const effect = nextProtocolEffect(state);
            if (effect === null) continue;
            for (const observation of observationsFor(effect)) {
                queue.push(observeProtocolEffect(structuredClone(state), effect, observation));
                queue.push(reconcileProtocol(structuredClone(state), observation)); // crash antes de result
            }
        }
        expect(seen.size).toBeGreaterThan(50);
    });
});

function observationsFor(effect: ReturnType<typeof nextProtocolEffect>): ProtocolObservation[] {
    if (effect === null) return [];
    switch (effect.kind) {
        case 'create-worktree': return [
            { kind: 'worktree-observed', trackId: effect.trackId, owned: true },
            { kind: 'effect-failed', trackId: effect.trackId, effect: effect.kind, detail: 'injected' },
        ];
        case 'merge-track': return [
            { kind: 'join-observation', trackId: effect.trackId, mergeHead: null, planHead: 'merged', trackIsAncestor: true },
            { kind: 'join-observation', trackId: effect.trackId, mergeHead: effect.expectedTrackHeadSha, planHead: effect.expectedPlanHeadSha },
        ];
        default: return [{ kind: 'effect-applied', effect }];
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar RED**

Run: `cd cli && npx jest tests/core/tracks/protocol.test.ts --runInBand`

Expected: FAIL con `Cannot find module '../../../src/core/tracks/protocol'`.

- [ ] **Step 3: Definir tipos cerrados para estados, intents, efectos y observaciones**

```ts
// cli/src/core/tracks/types.ts
export const TRACK_PHASES = [
    'DECLARED', 'PREPARE_INTENT', 'WORKTREE_CREATED', 'JOURNAL_CREATED',
    'SUPERVISOR_STARTING', 'ARMED', 'ACTIVE', 'FREEZE_REQUESTED', 'FROZEN',
    'JOIN_REQUESTED', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED',
    'TEARDOWN_REQUESTED', 'TEARDOWN_INTENT', 'SUPERVISOR_STOPPED',
    'WORKTREE_REMOVED', 'BRANCH_REMOVED', 'REMOVED', 'BLOCKED',
] as const;
export type TrackPhase = typeof TRACK_PHASES[number];

export type CohortPhase =
    | 'PREPARING' | 'ACTIVE' | 'JOINING' | 'FINAL_QA'
    | 'FINAL_INTEGRATION' | 'FINAL_INTERLOCK' | 'COMPLETE'
    | 'FALLBACK_PENDING' | 'SERIAL' | 'BLOCKED';

export interface TrackProtocolState {
    trackId: string;
    phase: TrackPhase;
    fencingToken: string;
    readinessNonce: string;
    expectedPlanHeadSha?: string;
    expectedTrackHeadSha?: string;
    joinedCommitSha?: string;
    blockedReason?: string;
}

export interface CohortProtocol {
    planJournalId: string;
    cohortPhase: CohortPhase;
    maxParallel: number;
    fallbackReason?: string;
    tracks: Record<string, TrackProtocolState>;
    globalQaHeadSha?: string;
    finalIntegrationJobId?: string;
}

export type ProtocolEffect =
    | { kind: 'persist-prepare-intent'; trackId: string }
    | { kind: 'create-worktree'; trackId: string }
    | { kind: 'create-track-journal'; trackId: string }
    | { kind: 'spawn-track-supervisor'; trackId: string; readinessNonce: string }
    | { kind: 'activate-cohort' }
    | { kind: 'activate-track'; trackId: string }
    | { kind: 'freeze-track'; trackId: string }
    | { kind: 'persist-join-intent'; trackId: string; expectedPlanHeadSha: string; expectedTrackHeadSha: string }
    | { kind: 'merge-track'; trackId: string; expectedPlanHeadSha: string; expectedTrackHeadSha: string }
    | { kind: 'request-global-qa' }
    | { kind: 'request-final-integration' }
    | { kind: 'run-final-interlock' }
    | { kind: 'begin-teardown'; trackId: string }
    | { kind: 'enter-serial'; reason: string };

export type ProtocolObservation =
    | { kind: 'effect-applied'; effect: ProtocolEffect }
    | { kind: 'effect-failed'; trackId?: string; effect: ProtocolEffect['kind']; detail: string }
    | { kind: 'prepare-failed'; trackId: string; detail: string }
    | { kind: 'worktree-observed'; trackId: string; owned: boolean }
    | { kind: 'supervisor-observed'; trackId: string; identity: 'expected' | 'other' | 'absent'; readinessNonce?: string }
    | { kind: 'join-observation'; trackId: string; mergeHead: string | null; planHead: string; trackIsAncestor?: boolean }
    | { kind: 'global-qa-pass'; headSha: string; clean: boolean }
    | { kind: 'integration-pass'; jobId: string; headSha: string }
    | { kind: 'interlock-pass'; headSha: string };
```

- [ ] **Step 4: Implementar el reducer total y sus invariantes**

```ts
// cli/src/core/tracks/protocol.ts
import crypto from 'crypto';
import type {
    CohortProtocol, ProtocolEffect, ProtocolObservation, TrackPhase,
} from './types';

const terminal = new Set<TrackPhase>(['JOINED', 'REMOVED', 'BLOCKED']);
const token = (journalId: string, trackId: string, purpose: string): string =>
    crypto.createHash('sha256').update(`${journalId}\0${trackId}\0${purpose}`).digest('hex').slice(0, 32);

export function initialCohort(planJournalId: string, trackIds: string[], maxParallel = trackIds.length): CohortProtocol {
    if (planJournalId.length === 0 || trackIds.length < 2 || new Set(trackIds).size !== trackIds.length
        || !Number.isInteger(maxParallel) || maxParallel < 1) {
        throw new Error('initialCohort requiere journalId y al menos dos trackIds únicos');
    }
    return {
        planJournalId, cohortPhase: 'PREPARING', maxParallel,
        tracks: Object.fromEntries(trackIds.map((trackId) => [trackId, {
            trackId, phase: 'DECLARED',
            fencingToken: token(planJournalId, trackId, 'fence'),
            readinessNonce: token(planJournalId, trackId, 'readiness'),
        }])),
    };
}

export function assertProtocolInvariants(s: CohortProtocol): void {
    const tracks = Object.values(s.tracks);
    if (tracks.length < 2) throw new Error('cohorte paralela requiere al menos dos tracks');
    if (s.cohortPhase === 'ACTIVE' && tracks.some((t) => !['ARMED', 'ACTIVE', 'FREEZE_REQUESTED', 'FROZEN', 'JOIN_REQUESTED', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED'].includes(t.phase))) {
        throw new Error('ACTIVE prohíbe tracks sin armar');
    }
    if (tracks.filter((t) => t.phase === 'ACTIVE').length > s.maxParallel) throw new Error('tracks ACTIVE exceden maxParallel');
    if (s.cohortPhase === 'SERIAL' && tracks.some((t) => !['REMOVED', 'DECLARED'].includes(t.phase))) {
        throw new Error('SERIAL prohíbe recursos paralelos activos');
    }
    if (s.finalIntegrationJobId !== undefined && tracks.some((t) => !['MERGED_UNVERIFIED', 'JOINED'].includes(t.phase))) {
        throw new Error('integración final exige todos los tracks mergeados');
    }
    if (s.cohortPhase === 'COMPLETE' && tracks.some((t) => t.phase !== 'JOINED')) {
        throw new Error('COMPLETE exige todos los tracks JOINED');
    }
}

export function nextProtocolEffect(s: CohortProtocol): ProtocolEffect | null {
    assertProtocolInvariants(s);
    const tracks = Object.values(s.tracks).sort((a, b) => a.trackId.localeCompare(b.trackId));
    if (s.cohortPhase === 'FALLBACK_PENDING') {
        const owned = tracks.find((t) => !['DECLARED', 'REMOVED', 'BLOCKED'].includes(t.phase));
        return owned !== undefined
            ? { kind: 'begin-teardown', trackId: owned.trackId }
            : { kind: 'enter-serial', reason: s.fallbackReason ?? 'prepare-failed' };
    }
    if (s.cohortPhase === 'PREPARING') {
        const t = tracks.find((x) => x.phase !== 'ARMED' && x.phase !== 'BLOCKED');
        if (t === undefined) return tracks.every((x) => x.phase === 'ARMED') ? { kind: 'activate-cohort' } : null;
        if (t.phase === 'DECLARED') return { kind: 'persist-prepare-intent', trackId: t.trackId };
        if (t.phase === 'PREPARE_INTENT') return { kind: 'create-worktree', trackId: t.trackId };
        if (t.phase === 'WORKTREE_CREATED') return { kind: 'create-track-journal', trackId: t.trackId };
        if (t.phase === 'JOURNAL_CREATED' || t.phase === 'SUPERVISOR_STARTING') {
            return { kind: 'spawn-track-supervisor', trackId: t.trackId, readinessNonce: t.readinessNonce };
        }
    }
    if (s.cohortPhase === 'ACTIVE') {
        const active = tracks.filter((t) => t.phase === 'ACTIVE').length;
        const waiting = tracks.find((t) => t.phase === 'ARMED');
        if (waiting !== undefined && active < s.maxParallel) return { kind: 'activate-track', trackId: waiting.trackId };
    }
    if (tracks.every((t) => t.phase === 'MERGED_UNVERIFIED') && s.globalQaHeadSha === undefined) return { kind: 'request-global-qa' };
    if (s.globalQaHeadSha !== undefined && s.finalIntegrationJobId === undefined) return { kind: 'request-final-integration' };
    if (s.finalIntegrationJobId !== undefined && s.cohortPhase === 'FINAL_INTERLOCK') return { kind: 'run-final-interlock' };
    return null;
}

export function reconcileProtocol(s: CohortProtocol, observation: ProtocolObservation): CohortProtocol {
    const out = structuredClone(s);
    if (observation.kind === 'prepare-failed' || (observation.kind === 'effect-failed' && out.cohortPhase === 'PREPARING')) {
        out.cohortPhase = 'FALLBACK_PENDING';
        out.fallbackReason = observation.kind === 'prepare-failed'
            ? `prepare-failed:${observation.trackId}` : `effect-failed:${observation.effect}`;
    } else if (observation.kind === 'join-observation') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        if (observation.mergeHead === null && observation.trackIsAncestor === true) {
            t.phase = 'MERGED_UNVERIFIED';
            t.joinedCommitSha = observation.planHead;
        } else if (observation.mergeHead !== t.expectedTrackHeadSha || observation.planHead !== t.expectedPlanHeadSha) {
            t.phase = 'BLOCKED';
            t.blockedReason = 'join observation indemostrable';
            out.cohortPhase = 'BLOCKED';
        }
    } else if (observation.kind === 'global-qa-pass') {
        if (!observation.clean) throw new Error('QA global no puede cerrar con worktree sucio');
        out.globalQaHeadSha = observation.headSha;
        out.cohortPhase = 'FINAL_INTEGRATION';
    } else if (observation.kind === 'integration-pass') {
        if (out.globalQaHeadSha !== observation.headSha) throw new Error('integración no corresponde al HEAD de QA');
        out.finalIntegrationJobId = observation.jobId;
        out.cohortPhase = 'FINAL_INTERLOCK';
    } else if (observation.kind === 'interlock-pass') {
        if (out.globalQaHeadSha !== observation.headSha) throw new Error('interlock stale');
        for (const t of Object.values(out.tracks)) t.phase = 'JOINED';
        out.cohortPhase = 'COMPLETE';
    }
    assertProtocolInvariants(out);
    return out;
}

export function observeProtocolEffect(s: CohortProtocol, effect: ProtocolEffect, observation: ProtocolObservation): CohortProtocol {
    const out = structuredClone(s);
    if (observation.kind === 'effect-failed' || observation.kind === 'prepare-failed' || observation.kind === 'join-observation'
        || observation.kind === 'global-qa-pass' || observation.kind === 'integration-pass' || observation.kind === 'interlock-pass') {
        return reconcileProtocol(out, observation);
    }
    if (observation.kind !== 'effect-applied') return out;
    const e = effect;
    if ('trackId' in e) {
        const t = out.tracks[e.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${e.trackId}`);
        const map: Partial<Record<ProtocolEffect['kind'], TrackPhase>> = {
            'persist-prepare-intent': 'PREPARE_INTENT', 'create-worktree': 'WORKTREE_CREATED',
            'create-track-journal': 'JOURNAL_CREATED', 'spawn-track-supervisor': 'SUPERVISOR_STARTING',
            'activate-track': 'ACTIVE',
            'freeze-track': 'FREEZE_REQUESTED', 'persist-join-intent': 'JOIN_INTENT',
            'begin-teardown': 'TEARDOWN_INTENT',
        };
        const phase = map[e.kind];
        if (phase !== undefined) t.phase = phase;
    }
    if (e.kind === 'activate-cohort') {
        out.cohortPhase = 'ACTIVE';
    }
    if (e.kind === 'enter-serial') out.cohortPhase = 'SERIAL';
    assertProtocolInvariants(out);
    return out;
}
```

- [ ] **Step 5: Completar el generador de observaciones hasta cubrir cada effect y corregir el reducer hasta GREEN**

Run: `cd cli && npx jest tests/core/tracks/protocol.test.ts --runInBand --coverage=false`

Expected: PASS, `seen.size > 50`, sin estado alcanzable que viole las cuatro invariantes.

- [ ] **Step 6: Verificar que cada frontera realmente participa del recorrido**

Agregar al test un `Set<ProtocolEffect['kind']>` y estas aserciones exactas:

```ts
expect([...effectsSeen].sort()).toEqual([
    'activate-cohort', 'activate-track', 'begin-teardown', 'create-track-journal', 'create-worktree',
    'enter-serial', 'freeze-track', 'merge-track', 'persist-join-intent',
    'persist-prepare-intent', 'request-final-integration', 'request-global-qa',
    'run-final-interlock', 'spawn-track-supervisor',
].sort());
```

Run: `cd cli && npx jest tests/core/tracks/protocol.test.ts --runInBand`

Expected: PASS. Si falta un effect, el recorrido no se considera completo aunque los demás asserts estén verdes.

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/tracks/types.ts cli/src/core/tracks/protocol.ts cli/tests/core/tracks/protocol.test.ts
git commit -m "feat(tracks): prove durable cohort protocol with state exploration"
```

### Task 2: Esquema aditivo, identidad estable y entidades de track

_Requirements: R2.1, R7.1, R9.1, R9.2, R9.3, R9.7, C8_

**Files:**
- Modify: `cli/src/core/journal/types.ts`
- Modify: `cli/src/core/journal/store.ts`
- Modify: `cli/src/core/journal/requests.ts`
- Modify: `cli/tests/core/journal/types.test.ts`
- Modify: `cli/tests/core/journal/store.test.ts`
- Modify: `cli/tests/core/journal/requests.test.ts`

- [ ] **Step 1: Escribir tests rojos de migración e identidad**

```ts
test('emptyState genera journalId estable y único (R9.1)', () => {
    const a = emptyState('main');
    const b = emptyState('main');
    expect(a.journalId).toMatch(/^j-[0-9a-f-]{36}$/);
    expect(b.journalId).not.toBe(a.journalId);
});

test('schema 1 legacy recibe journalId determinista sin perder evidencia (R9.3)', () => {
    const legacy = emptyState('legacy') as Record<string, unknown>;
    delete legacy.journalId;
    fs.writeFileSync(statePath(repo, 'legacy'), JSON.stringify(legacy));
    const first = readJournal(repo, 'legacy').state!;
    const second = readJournal(repo, 'legacy').state!;
    expect(first.journalId).toBe(second.journalId);
    expect(first.journalId).toMatch(/^legacy-[0-9a-f]{32}$/);
});

test('TrackRef exige intents y nonces con shape completa (R9.2, R9.7)', () => {
    const state = emptyState('main');
    state.tracks = [{
        trackId: 'cli', worktreePath: '/tmp/wt', branch: 'awm-track/cli', ownership: ['cli/'],
        sharedResources: [], dependsOn: [], fencingToken: 'f'.repeat(32), phase: 'DECLARED',
        readinessNonce: 'r'.repeat(32),
    }];
    expect(isWellFormedState(state)).toBe(true);
    state.tracks[0].fencingToken = '';
    expect(isWellFormedState(state)).toBe(false);
});
```

Run: `cd cli && npx jest tests/core/journal/{types,store,requests}.test.ts --runInBand`

Expected: FAIL porque `journalId`, `tracks` y los nuevos request kinds no existen.

- [ ] **Step 2: Agregar los tipos de journal reutilizando `TrackPhase`**

```ts
// imports en cli/src/core/journal/types.ts
import crypto from 'crypto';
import type { CohortPhase, TrackPhase } from '../tracks/types';

export interface TrackContext {
    trackId: string;
    taskIds: string[];
    planDigest: string;
    baseSha: string;
    planJournalId: string;
}

export interface TrackRef {
    trackId: string;
    worktreePath: string;
    branch: string;
    ownership: string[];
    sharedResources: string[];
    dependsOn: string[];
    fencingToken: string;
    phase: TrackPhase;
    readinessNonce: string;
    readinessAt?: string;
    frozenHeadSha?: string;
    supervisorIntent?: { nonce: string; argv: string[]; claimPath: string };
    supervisorProcessRef?: ProcessRef;
    joinIntent?: {
        expectedPlanHeadSha: string;
        expectedTrackHeadSha: string;
        strategy: 'no-ff';
    };
    teardownIntent?: {
        worktreePath: string;
        branch: string;
        supervisorNonce?: string;
    };
    joinedCommitSha?: string;
    blockedReason?: string;
}

// campos nuevos de JournalState
journalId: string;
tracks?: TrackRef[];
trackContext?: TrackContext;
cohortPhase?: CohortPhase;
cohortBaseSha?: string;
trackIntegration?: { argv: string[]; paths: string[]; planDigest: string };
```

Cambiar `VerificationKind` y sus guards para incluir exactamente `'track-integration'`. En `emptyState` usar:

```ts
journalId: `j-${crypto.randomUUID()}`,
```

- [ ] **Step 3: Normalizar journals legacy de forma determinista**

En `normalizeSchemaOne`, después de validar `schema`, agregar:

```ts
if (parsed.journalId === undefined) {
    const branch = typeof parsed.branch === 'string' ? parsed.branch : '';
    const cycle = typeof parsed.cycle === 'object' && parsed.cycle !== null
        ? parsed.cycle as Record<string, unknown> : {};
    const startedAt = typeof cycle.startedAt === 'string' ? cycle.startedAt : '';
    parsed.journalId = `legacy-${crypto.createHash('sha256')
        .update(`${branch}\0${startedAt}`).digest('hex').slice(0, 32)}`;
}
```

Importar `crypto` en `store.ts`. Normalizar `tracks` y `trackContext` solo por ausencia; no inventar tracks para un journal legacy. Persistir el `journalId` materializado en la siguiente escritura CAS normal; la lectura por sí sola continúa read-only.

- [ ] **Step 4: Extender el envelope con requests de track y guards exhaustivos**

```ts
export type RequestKind =
    | 'job-request' | 'register-entity' | 'controller-heartbeat' | 'verdict'
    | 'track-prepare-request' | 'track-freeze-request' | 'track-join-request'
    | 'track-teardown-request' | 'track-finalize-request';

export interface RequestEnvelope {
    kind: RequestKind;
    generationToken: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}

const KNOWN_KINDS: readonly RequestKind[] = [
    'job-request', 'register-entity', 'controller-heartbeat', 'verdict',
    'track-prepare-request', 'track-freeze-request', 'track-join-request',
    'track-teardown-request', 'track-finalize-request',
];
```

Agregar tests que emitan cada kind, relean el JSON y prueben que un kind desconocido queda `.corrupt` al consumirlo.

- [ ] **Step 5: Ejecutar suites y build**

Run: `cd cli && npx jest tests/core/journal/{types,store,requests}.test.ts --runInBand && npm run build`

Expected: PASS y build sin casts `any` nuevos.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/journal cli/tests/core/journal
git commit -m "feat(journal): add stable identities and track protocol entities"
```

### Task 3: Parser estricto del contrato de tracks

_Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R1.8, R7.4, R7.5, C4_

**Files:**
- Create: `cli/src/core/tracks/plan-parser.ts`
- Create: `cli/tests/core/tracks/plan-parser.test.ts`
- Create: `cli/tests/fixtures/tracks/two-independent.md`
- Create: `cli/tests/fixtures/tracks/legacy-serial.md`

- [ ] **Step 1: Crear fixtures canónicos**

```markdown
<!-- cli/tests/fixtures/tracks/two-independent.md -->
# Fixture

## Tracks

**Integration argv:** ["npm","test","--","--runInBand"]
**Integration paths:** ["cli/src/**","cli/tests/**"]

| Track | Depends on | Shared resources |
|---|---|---|
| cli | none | [] |
| docs | none | [] |

### Task 1: CLI

**Track:** cli
**Files:**
- Modify: `cli/src/a.ts`

### Task 2: Docs

**Track:** docs
**Files:**
- Modify: `docs/a.md`
```

`legacy-serial.md` contiene una tarea normal con `**Files:**`, sin `## Tracks` ni `**Track:**`.

- [ ] **Step 2: Escribir los tests rojos del parser**

```ts
import fs from 'fs';
import path from 'path';
import { parseTrackPlan } from '../../../src/core/tracks/plan-parser';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../../fixtures/tracks', name), 'utf8');

describe('parseTrackPlan', () => {
    test('parsea membresía, ownership y argv sin shell (R1.1, R1.4, C4)', () => {
        const p = parseTrackPlan(fixture('two-independent.md'), () => true);
        expect(p.mode).toBe('parallel-candidate');
        expect(p.integration).toEqual({
            argv: ['npm', 'test', '--', '--runInBand'],
            paths: ['cli/src/**', 'cli/tests/**'],
        });
        expect(p.tracks.cli.taskIds).toEqual(['1']);
        expect(p.tracks.cli.ownership).toEqual(['cli/src/a.ts']);
    });

    test('ausencia completa conserva serial legacy (R1.2)', () => {
        expect(parseTrackPlan(fixture('legacy-serial.md'), () => true)).toEqual({ mode: 'serial', reason: 'no-tracks' });
    });

    test.each(['', '.', '..', '-x', 'a/b', 'a\\b'])(
        'rechaza id peligroso %p aunque git lo aceptara parcialmente (R1.3)', (id) => {
            const src = fixture('two-independent.md').replaceAll('cli', id);
            expect(() => parseTrackPlan(src, () => true)).toThrow(/track id inválido/);
        },
    );

    test('rechaza membresía sin fila y fila sin membresía (R1.6)', () => {
        const src = fixture('two-independent.md').replace('| docs | none | [] |', '| extra | none | [] |');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/coincidencia exacta/);
    });

    test('degrada a serial si shared resources falta o Depends on no es none (R1.7, R1.8)', () => {
        expect(parseTrackPlan(fixture('two-independent.md').replace('[] |', ' |'), () => true)).toMatchObject({ mode: 'serial' });
        expect(parseTrackPlan(fixture('two-independent.md').replace('| docs | none |', '| docs | cli |'), () => true)).toMatchObject({ mode: 'serial' });
    });

    test('integration argv debe ser JSON string[] no vacío (C4)', () => {
        const src = fixture('two-independent.md').replace('["npm","test","--","--runInBand"]', 'npm test');
        expect(() => parseTrackPlan(src, () => true)).toThrow(/Integration argv/);
    });
});
```

Inyectar `checkRef: (id) => boolean` en tests; producción lo conecta a `git check-ref-format --branch` en Task 4.

- [ ] **Step 3: Verificar RED**

Run: `cd cli && npx jest tests/core/tracks/plan-parser.test.ts --runInBand`

Expected: FAIL por módulo ausente.

- [ ] **Step 4: Implementar parser lineal con retorno discriminado**

```ts
// cli/src/core/tracks/plan-parser.ts
import path from 'path';

export interface ParsedTrack {
    trackId: string;
    taskIds: string[];
    ownership: string[];
    dependsOn: string[];
    sharedResources: string[];
}
export type ParsedTrackPlan =
    | { mode: 'serial'; reason: string }
    | { mode: 'parallel-candidate'; tracks: Record<string, ParsedTrack>; integration: { argv: string[]; paths: string[] } };

const taskHeading = /^### Task ([^:]+):/;
const trackLine = /^\*\*Track:\*\*\s*(.*)$/;
const fileLine = /^- (?:Create|Modify|Test|Delete):\s+`([^`]+)`/;

function jsonStrings(label: string, raw: string | undefined): string[] {
    if (raw === undefined) throw new Error(`${label} es obligatorio para paralelismo`);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error(`${label} debe ser JSON string[]`); }
    if (!Array.isArray(value) || value.length === 0 || value.some((x) => typeof x !== 'string' || x.length === 0)) {
        throw new Error(`${label} debe ser JSON string[] no vacío`);
    }
    return value;
}

function canonicalFile(raw: string): string {
    const withoutLines = raw.replace(/:\d+(?:-\d+)?$/, '');
    const posix = withoutLines.replaceAll('\\', '/');
    const normalized = path.posix.normalize(posix);
    if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
        throw new Error(`Files path fuera del repo: ${raw}`);
    }
    return normalized.replace(/^\.\//, '');
}

export function parseTrackPlan(source: string, checkRef: (id: string) => boolean): ParsedTrackPlan {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const hasMembership = lines.some((line) => trackLine.test(line));
    const tracksHeading = lines.findIndex((line) => line.trim() === '## Tracks');
    if (!hasMembership && tracksHeading < 0) return { mode: 'serial', reason: 'no-tracks' };
    if (!hasMembership || tracksHeading < 0) throw new Error('Track membership y ## Tracks deben coexistir');

    const argvRaw = lines.find((l) => l.startsWith('**Integration argv:**'))?.slice('**Integration argv:**'.length).trim();
    const pathsRaw = lines.find((l) => l.startsWith('**Integration paths:**'))?.slice('**Integration paths:**'.length).trim();
    const integration = { argv: jsonStrings('Integration argv', argvRaw), paths: jsonStrings('Integration paths', pathsRaw) };
    const declared = new Map<string, ParsedTrack>();
    for (const line of lines.slice(tracksHeading + 1)) {
        if (line.startsWith('## ')) break;
        const cells = line.split('|').slice(1, -1).map((x) => x.trim());
        if (cells.length !== 3 || cells[0] === 'Track' || /^[-:]+$/.test(cells[0])) continue;
        const [id, dependsRaw, resourcesRaw] = cells;
        if (!id || id === '.' || id === '..' || id.startsWith('-') || id.includes('/') || id.includes('\\') || !checkRef(id)) {
            throw new Error(`track id inválido: ${JSON.stringify(id)}`);
        }
        if (declared.has(id)) throw new Error(`track duplicado: ${id}`);
        const resources = resourcesRaw === '[]' ? [] : resourcesRaw.length === 0 ? null : resourcesRaw.split(',').map((x) => x.trim());
        const dependsOn = dependsRaw === 'none' ? [] : dependsRaw.split(',').map((x) => x.trim());
        declared.set(id, { trackId: id, taskIds: [], ownership: [], dependsOn, sharedResources: resources ?? [] });
        if (resources === null) return { mode: 'serial', reason: `shared-resources-missing:${id}` };
    }
    let taskId: string | null = null;
    let member: string | null = null;
    let pendingFiles: string[] = [];
    for (const line of lines) {
        const heading = line.match(taskHeading);
        if (heading !== null) {
            if (taskId !== null && pendingFiles.length > 0 && member === null) throw new Error(`task ${taskId} tiene Files pero no Track`);
            taskId = heading[1].trim(); member = null; pendingFiles = []; continue;
        }
        const membership = line.match(trackLine);
        if (membership !== null) {
            if (taskId === null || member !== null) throw new Error('cada task admite exactamente un Track');
            member = membership[1].trim();
            const track = declared.get(member);
            if (track === undefined) throw new Error('membresía y filas de ## Tracks requieren coincidencia exacta');
            track.taskIds.push(taskId);
            track.ownership.push(...pendingFiles);
        }
        const file = line.match(fileLine);
        if (file !== null) {
            const canonical = canonicalFile(file[1]);
            if (member === null) pendingFiles.push(canonical);
            else declared.get(member)!.ownership.push(canonical);
        }
    }
    const members = new Set([...declared.values()].flatMap((t) => t.taskIds.length > 0 ? [t.trackId] : []));
    if (members.size !== declared.size) throw new Error('membresía y filas de ## Tracks requieren coincidencia exacta');
    if ([...declared.values()].some((t) => t.dependsOn.length > 0)) return { mode: 'serial', reason: 'track-dependency' };
    return { mode: 'parallel-candidate', tracks: Object.fromEntries(declared), integration };
}
```

- [ ] **Step 5: Agregar casos de duplicate Track, path absoluto, `../`, JSON con números y bloque Tracks duplicado**

Run: `cd cli && npx jest tests/core/tracks/plan-parser.test.ts --runInBand`

Expected: PASS con al menos 14 casos.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/tracks/plan-parser.ts cli/tests/core/tracks/plan-parser.test.ts cli/tests/fixtures/tracks
git commit -m "feat(tracks): parse strict ownership and integration contract"
```

### Task 4: Ownership real, recursos y adaptador Git read-only

_Requirements: R1.3, R1.4, R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.10, C5, C10_

**Files:**
- Create: `cli/src/core/tracks/ownership.ts`
- Create: `cli/src/core/tracks/git.ts`
- Create: `cli/tests/core/tracks/ownership.test.ts`
- Create: `cli/tests/core/tracks/git.test.ts`

- [ ] **Step 1: Escribir tests rojos para ownership y clases globales**

```ts
// cli/tests/core/tracks/ownership.test.ts
import {
    assessDeclaredIndependence, assessActualOwnership, canonicalResource,
} from '../../../src/core/tracks/ownership';

test('colisiona exacto, case-insensitive y por descendiente (R5.1, R5.3, R5.4)', () => {
    expect(assessDeclaredIndependence([
        track('a', ['src/api/']), track('b', ['SRC/API/user.ts']),
    ])).toMatchObject({ parallel: false, reasons: ['path:SRC/API/user.ts'] });
});

test('rename cuenta path viejo y nuevo (R5.4)', () => {
    const out = assessActualOwnership(track('a', ['src/new.ts']), [
        { status: 'R100', oldPath: 'src/old.ts', path: 'src/new.ts' },
    ]);
    expect(out.outsideOwnership).toEqual(['src/old.ts']);
});

test('un solo lockfile invalida toda la cohorte (R5.7, C5, CA-4.3)', () => {
    expect(assessDeclaredIndependence([
        track('a', ['src/a.ts']), track('b', ['package-lock.json']),
    ])).toMatchObject({ parallel: false, reasons: ['global:lockfile:package-lock.json'] });
});

test('recursos usan clase:valor canónico y colisionan por igualdad (R5.5, R5.6)', () => {
    expect(canonicalResource('port:5432')).toBe('port:5432');
    expect(() => canonicalResource('5432')).toThrow(/<clase>:<valor>/);
    expect(assessDeclaredIndependence([
        track('a', ['a'], ['db:dev']), track('b', ['b'], ['db:dev']),
    ])).toMatchObject({ parallel: false, reasons: ['resource:db:dev'] });
});

function track(trackId: string, ownership: string[], sharedResources: string[] = []) {
    return { trackId, taskIds: [trackId], ownership, sharedResources, dependsOn: [] };
}
```

```ts
// cli/tests/core/tracks/git.test.ts
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { changedPaths, gitCheckTrackId, mergeBase } from '../../../src/core/tracks/git';

test('changedPaths usa commits y conserva ambos lados de rename (R5.2, R5.4)', () => {
    const repo = initRepo();
    const base = commitFile(repo, 'old.ts', 'one');
    fs.renameSync(path.join(repo, 'old.ts'), path.join(repo, 'new.ts'));
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'rename'], { cwd: repo });
    expect(changedPaths(repo, base, 'HEAD')).toEqual([
        { status: 'R100', oldPath: 'old.ts', path: 'new.ts' },
    ]);
});

test.each(['valid-track', '..', '-x', 'a/b'])('git check-ref-format participa para %p (R1.3)', (id) => {
    expect(gitCheckTrackId(id)).toBe(id === 'valid-track');
});
```

- [ ] **Step 2: Ejecutar RED**

Run: `cd cli && npx jest tests/core/tracks/{ownership,git}.test.ts --runInBand`

Expected: FAIL por módulos ausentes.

- [ ] **Step 3: Implementar el adaptador Git con argv estructurado**

```ts
// cli/src/core/tracks/git.ts
import { execFileSync } from 'child_process';
import { EXEC_STDIO } from '../journal/process';

const git = (repo: string, args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: EXEC_STDIO });

export function gitCheckTrackId(id: string): boolean {
    if (!id || id === '.' || id === '..' || id.startsWith('-') || id.includes('/') || id.includes('\\')) return false;
    try { git(process.cwd(), ['check-ref-format', '--branch', id]); return true; }
    catch { return false; }
}

export function mergeBase(repo: string, left: string, right: string): string {
    return git(repo, ['merge-base', left, right]).trim();
}

export interface ChangedPath { status: string; path: string; oldPath?: string }

export function changedPaths(repo: string, base: string, head: string): ChangedPath[] {
    const fields = git(repo, ['diff', '--name-status', '-z', '--find-renames', base, head]).split('\0');
    const out: ChangedPath[] = [];
    for (let i = 0; i < fields.length && fields[i] !== ''; ) {
        const status = fields[i++];
        if (status.startsWith('R') || status.startsWith('C')) {
            out.push({ status, oldPath: fields[i++], path: fields[i++] });
        } else {
            out.push({ status, path: fields[i++] });
        }
    }
    return out;
}
```

Mover cualquier llamada Git nueva de tareas posteriores a este archivo; no usar `execSync` ni strings de shell.

- [ ] **Step 4: Implementar normalización y decisión fail-closed**

```ts
// cli/src/core/tracks/ownership.ts
import path from 'path';
import type { ParsedTrack } from './plan-parser';
import type { ChangedPath } from './git';

const GLOBAL = [
    { kind: 'lockfile', re: /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/i },
    { kind: 'manifest', re: /(^|\/)(?:package\.json|Cargo\.toml|pyproject\.toml)$/i },
    { kind: 'migration', re: /(^|\/)(?:migrations?|schema)\//i },
    { kind: 'snapshot', re: /(?:^|\/)(__snapshots__\/|[^/]+\.snap$)/i },
    { kind: 'generated', re: /(^|\/)(?:dist|generated|coverage)\//i },
] as const;

const canon = (p: string): string => path.posix.normalize(p.replaceAll('\\', '/')).replace(/^\.\//, '');
const key = (p: string): string => canon(p).toLocaleLowerCase('en-US');
const covers = (owner: string, actual: string): boolean => {
    const o = key(owner).replace(/\*\*?[^/]*$/g, '');
    const a = key(actual);
    return a === o || a.startsWith(o.endsWith('/') ? o : `${o}/`);
};

export function canonicalResource(raw: string): string {
    const match = raw.match(/^([a-z][a-z0-9-]*):(.+)$/i);
    if (match === null || match[2].trim().length === 0) throw new Error(`recurso debe usar <clase>:<valor>: ${raw}`);
    return `${match[1].toLowerCase()}:${match[2].trim()}`;
}

export function assessDeclaredIndependence(tracks: ParsedTrack[]): { parallel: boolean; reasons: string[] } {
    const reasons = new Set<string>();
    for (const t of tracks) {
        for (const owner of t.ownership) {
            const global = GLOBAL.find((g) => g.re.test(canon(owner)));
            if (global !== undefined) reasons.add(`global:${global.kind}:${canon(owner)}`);
        }
    }
    for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
        for (const left of tracks[i].ownership) for (const right of tracks[j].ownership) {
            if (covers(left, right) || covers(right, left)) reasons.add(`path:${canon(right)}`);
        }
        const rightResources = new Set(tracks[j].sharedResources.map(canonicalResource));
        for (const resource of tracks[i].sharedResources.map(canonicalResource)) {
            if (rightResources.has(resource)) reasons.add(`resource:${resource}`);
        }
    }
    return { parallel: reasons.size === 0, reasons: [...reasons].sort() };
}

export function assessActualOwnership(track: ParsedTrack, changes: ChangedPath[]): { outsideOwnership: string[]; globalClasses: string[] } {
    const actual = changes.flatMap((c) => c.oldPath === undefined ? [c.path] : [c.oldPath, c.path]);
    return {
        outsideOwnership: actual.filter((p) => !track.ownership.some((o) => covers(o, p))).sort(),
        globalClasses: actual.flatMap((p) => GLOBAL.filter((g) => g.re.test(canon(p))).map((g) => `${g.kind}:${canon(p)}`)).sort(),
    };
}
```

- [ ] **Step 5: Agregar casos Windows/case, globs, manifests y recursos no declarados**

El test de recursos no declarados fija C10 así:

```ts
test('no afirma observar recursos runtime no declarados (C10)', () => {
    const out = assessDeclaredIndependence([track('a', ['a']), track('b', ['b'])]);
    expect(out).toEqual({ parallel: true, reasons: [] });
    // La garantía es sobre declaraciones + archivos; no existe probe de puertos/bases.
});
```

Run: `cd cli && npx jest tests/core/tracks/{ownership,git}.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/tracks cli/tests/core/tracks
git commit -m "feat(tracks): verify declared and actual independence fail-closed"
```

### Task 5: Descriptor autenticado, resolución de contexto y gate local

_Requirements: R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R3.1, R3.2, R3.3, R3.4, R3.5, R9.4, R9.5, C6, C8_

**Files:**
- Create: `cli/src/core/tracks/descriptor.ts`
- Create: `cli/src/core/tracks/context.ts`
- Modify: `cli/src/commands/job/gate.ts`
- Modify: `cli/src/commands/job/index.ts`
- Modify: `cli/src/commands/watch/index.ts`
- Create: `cli/tests/core/tracks/descriptor.test.ts`
- Create: `cli/tests/core/tracks/context.test.ts`
- Modify: `cli/tests/commands/job/gate-reconcile.test.ts`

- [ ] **Step 1: Escribir tests rojos de autenticación y scope**

```ts
test('descriptor debe coincidir por realpath, journalId y fencing (R2.5, R2.6, R9.4)', () => {
    writeDescriptor(trackRoot, descriptor({ planRoot, planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }));
    const local = trackStateWith({ planJournalId: 'j-1', trackId: 'cli' });
    expect(resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'f'.repeat(32)))).toMatchObject({ mode: 'track' });
    expect(() => resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'x'.repeat(32)))).toThrow(/fencingToken/);
    writeDescriptor(otherRoot, descriptor({ planRoot, planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }));
    expect(() => resolveAuthenticatedContext(otherRoot, local, planStateWith('j-1', 'f'.repeat(32)))).toThrow(/realpath/);
});

test('planDigest divergente bloquea y task ajena se rechaza (R2.3, R2.4)', () => {
    const ctx = trackContext({ taskIds: ['1', '2'], planDigest: 'expected' });
    expect(() => assertTrackTask(ctx, '3', 'expected')).toThrow(/fuera de la asignación/);
    expect(() => assertTrackTask(ctx, '1', 'actual')).toThrow(/planDigest/);
});

test('computeTrackGate no exige qa/interlock global (R3.5, C6)', () => {
    const s = stateWithCompletedTrackTask();
    expect(computeTrackGate(s, false, () => 'same')).toEqual({ pass: true, reasons: [] });
    expect(computeGate(s, false, () => 'same').pass).toBe(false);
});
```

- [ ] **Step 2: Ejecutar RED**

Run: `cd cli && npx jest tests/core/tracks/{descriptor,context}.test.ts tests/commands/job/gate-reconcile.test.ts --runInBand`

Expected: FAIL por exports ausentes.

- [ ] **Step 3: Implementar descriptor 0600 con escritura durable**

```ts
// cli/src/core/tracks/descriptor.ts
import fs from 'fs';
import path from 'path';
import { writeFileAtomicDurable } from '../atomic-file';

export interface TrackDescriptor {
    schema: 1;
    planRoot: string;
    planBranch: string;
    trackId: string;
    planJournalId: string;
    fencingToken: string;
}

export const descriptorPath = (trackRoot: string): string => path.join(trackRoot, '.awm', 'track.json');

export function writeDescriptor(trackRoot: string, value: TrackDescriptor): void {
    if (value.schema !== 1 || !path.isAbsolute(value.planRoot) || value.trackId.length === 0
        || value.planJournalId.length === 0 || value.fencingToken.length < 32) {
        throw new Error('descriptor de track inválido');
    }
    fs.mkdirSync(path.dirname(descriptorPath(trackRoot)), { recursive: true, mode: 0o700 });
    writeFileAtomicDurable(descriptorPath(trackRoot), JSON.stringify({ ...value, planRoot: fs.realpathSync(value.planRoot) }, null, 2) + '\n', 0o600);
}

export function readDescriptor(trackRoot: string): TrackDescriptor | null {
    const file = descriptorPath(trackRoot);
    if (!fs.existsSync(file)) return null;
    const x = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (x.schema !== 1 || typeof x.planRoot !== 'string' || typeof x.planBranch !== 'string'
        || typeof x.trackId !== 'string' || typeof x.planJournalId !== 'string'
        || typeof x.fencingToken !== 'string') throw new Error('track.json corrupto');
    return x as unknown as TrackDescriptor;
}
```

- [ ] **Step 4: Resolver contexto sin leer progreso de otros tracks**

```ts
// cli/src/core/tracks/context.ts
import fs from 'fs';
import crypto from 'crypto';
import type { JournalState, TrackContext } from '../journal/types';
import { readDescriptor } from './descriptor';

export type AuthenticatedContext =
    | { mode: 'plan'; repoRoot: string; journal: JournalState }
    | { mode: 'track'; repoRoot: string; descriptor: NonNullable<ReturnType<typeof readDescriptor>>; trackContext: TrackContext };

export function planDigest(source: string): string {
    return crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

export function assertTrackTask(ctx: TrackContext, taskId: string, currentPlanDigest: string): void {
    if (ctx.planDigest !== currentPlanDigest) throw new Error('BLOCKED: planDigest divergente');
    if (!ctx.taskIds.includes(taskId)) throw new Error(`task ${taskId} fuera de la asignación ${ctx.trackId}`);
}

export function resolveAuthenticatedContext(cwd: string, localState: JournalState, planState: JournalState = localState): AuthenticatedContext {
    const root = fs.realpathSync(cwd);
    const descriptor = readDescriptor(root);
    if (descriptor === null) return { mode: 'plan', repoRoot: root, journal: localState };
    if (localState.trackContext === undefined) throw new Error('descriptor presente sin trackContext');
    const planRoot = fs.realpathSync(descriptor.planRoot);
    const ref = planState.tracks?.find((candidate) => candidate.trackId === descriptor.trackId);
    if (planState.journalId !== descriptor.planJournalId || localState.trackContext.planJournalId !== descriptor.planJournalId) {
        throw new Error('planJournalId no coincide');
    }
    if (ref === undefined) throw new Error('TrackRef ausente en journal del plan');
    if (ref.fencingToken !== descriptor.fencingToken) throw new Error('fencingToken no coincide');
    if (fs.realpathSync(ref.worktreePath) !== root || planRoot === root) throw new Error('realpath de track no coincide');
    if (localState.trackContext.trackId !== descriptor.trackId) throw new Error('trackId no coincide');
    return { mode: 'track', repoRoot: root, descriptor, trackContext: localState.trackContext };
}
```

La autenticación contra `TrackRef` se realiza leyendo **solo** el journal del plan indicado por el descriptor; un track nunca enumera ni abre journals hermanos.

- [ ] **Step 5: Extraer un evaluador común y definir `computeTrackGate`**

En `gate.ts`, extraer la validación de items/tareas/reviews/fixes a `evaluateEvidence(state, fingerprintNow, scope)`. Mantener `computeGate` byte-compatible en conducta y agregar:

```ts
export function computeTrackGate(state: JournalState | null, corruptState: boolean, fingerprintNow: FingerprintNow): GateResult {
    if (corruptState || state === null) return { pass: false, reasons: [{ category: 'corrupt-state', detail: 'journal ausente o corrupto' }] };
    if (state.trackContext === undefined) return { pass: false, reasons: [{ category: 'wrong-context', detail: 'gate local requiere trackContext' }] };
    const assigned = new Set(state.trackContext.taskIds);
    const foreign = state.tasks.filter((task) => !assigned.has(task.id));
    if (foreign.length > 0) return { pass: false, reasons: foreign.map((task) => ({ category: 'foreign-task', detail: `task ${task.id} fuera del track` })) };
    return evaluateEvidence(state, fingerprintNow, { requireGlobalKinds: false, taskIds: assigned });
}
```

Agregar asserts de orden/compatibilidad a los tests existentes de `computeGate` para demostrar que R1 no regresiona.

- [ ] **Step 6: Aplicar el guard de contexto al inicio de cada verbo `job` y `watch`**

Crear un helper `resolveCommandContext(process.cwd())` que localice la raíz Git, journal y descriptor antes de emitir o consultar. Tests de commander deben probar:

```ts
expect(runCli(otherDirectory, ['job', 'gate'])).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('cwd no autenticado') });
expect(runCli(trackRoot, ['watch'])).toMatchObject({ exitCode: 0 });
```

Run: `cd cli && npx jest tests/core/tracks/{descriptor,context}.test.ts tests/commands/job/gate-reconcile.test.ts tests/commands/job/verbs.test.ts tests/commands/watch/watch-init.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/core/tracks cli/src/commands/job cli/src/commands/watch cli/tests/core/tracks cli/tests/commands/job cli/tests/commands/watch
git commit -m "feat(tracks): authenticate track context and isolate local gates"
```

### Task 6: Superficie `awm track` y status agregado read-only

_Requirements: R5.10, R6.1, R9.5, R9.6_

**Files:**
- Create: `cli/src/commands/track/emit.ts`
- Create: `cli/src/commands/track/status.ts`
- Create: `cli/src/commands/track/index.ts`
- Modify: `cli/src/index.ts`
- Create: `cli/tests/commands/track/verbs.test.ts`
- Create: `cli/tests/commands/track/status.test.ts`

- [ ] **Step 1: Escribir tests rojos de verbos y no-mutación**

```ts
test.each([
    ['add', 'track-prepare-request'], ['join', 'track-join-request'], ['remove', 'track-teardown-request'],
])('%s emite %s y no muta Git/state (R6.1)', async (verb, kind) => {
    const beforeHead = git(repo, ['rev-parse', 'HEAD']);
    const beforeState = fs.readFileSync(statePath(repo, branch), 'utf8');
    const out = await runCli(repo, ['track', verb, 'cli', '--generation', 'g1']);
    expect(out.exitCode).toBe(0);
    expect(readPendingKinds(repo, branch)).toContain(kind);
    expect(git(repo, ['rev-parse', 'HEAD'])).toBe(beforeHead);
    expect(fs.readFileSync(statePath(repo, branch), 'utf8')).toBe(beforeState);
});

test('status compone journals al leer y no los espeja (R9.5, R9.6)', () => {
    const out = aggregateTrackStatus(planRoot, planState);
    expect(out.tracks.cli.gate.pass).toBe(true);
    expect(planState.tracks![0]).not.toHaveProperty('gate');
    expect(fs.readFileSync(statePath(planRoot, branch), 'utf8')).toBe(planBefore);
});
```

- [ ] **Step 2: Verificar RED**

Run: `cd cli && npx jest tests/commands/track/{verbs,status}.test.ts --runInBand`

Expected: FAIL porque `track` no está registrado.

- [ ] **Step 3: Implementar emisores con idempotency key ligada al journal/track/intent**

```ts
// cli/src/commands/track/emit.ts
import crypto from 'crypto';
import { emitRequest, type EmittedRequest, type RequestKind } from '../../core/journal/requests';

export function emitTrackRequest(
    repoRoot: string, branch: string, generationToken: string,
    kind: Extract<RequestKind, `track-${string}`>, trackId: string,
): EmittedRequest {
    if (trackId.length === 0) throw new Error('trackId obligatorio');
    const payload = { trackId };
    return emitRequest(repoRoot, branch, {
        kind, generationToken,
        idempotencyKey: crypto.createHash('sha256')
            .update(`${kind}\0${branch}\0${trackId}`).digest('hex'),
        payload,
    });
}
```

`add`, `join` y `remove` llaman este helper. `verify-independence`, `list` y `status` no aceptan generation y no emiten requests.

- [ ] **Step 4: Implementar agregado read-only**

```ts
// cli/src/commands/track/status.ts
export interface AggregatedTrackStatus {
    cohort: string;
    tracks: Record<string, { phase: string; gate: ReturnType<typeof computeTrackGate> }>;
}

export function aggregateTrackStatus(planRoot: string, plan: JournalState): AggregatedTrackStatus {
    const tracks: AggregatedTrackStatus['tracks'] = {};
    for (const ref of plan.tracks ?? []) {
        const observed = readJournal(ref.worktreePath, ref.branch);
        tracks[ref.trackId] = {
            phase: ref.phase,
            gate: computeTrackGate(observed.state, observed.corrupt, fingerprintFor(ref.worktreePath)),
        };
    }
    return { cohort: deriveCohortPhase(plan.tracks ?? []), tracks };
}
```

`fingerprintFor` usa `computeFingerprint` contra el worktree observado. Si un journal no puede leerse, su gate es rojo; nunca se copia el resultado al plan journal.

- [ ] **Step 5: Registrar commander y verificar exit codes**

`verify-independence` imprime JSON `{parallel,reasons}` y sale 1 si `parallel:false`. `status` sale 1 si algún journal es corrupto/bloqueado, aunque imprime todo el agregado.

Run: `cd cli && npx jest tests/commands/track/{verbs,status}.test.ts --runInBand && npm run build && node dist/src/index.js track --help`

Expected: PASS; help lista `add`, `list`, `status`, `verify-independence`, `join`, `remove`.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/track cli/src/index.ts cli/tests/commands/track
git commit -m "feat(cli): add request-only track commands and aggregate status"
```

### Task 7: Benchmark reproducible y tope de concurrencia derivado

_Requirements: R10.2, R10.3_

**Files:**
- Create: `docs/research/r5/benchmark-fingerprint.mjs`
- Create: `docs/research/r5/fingerprint-budget.json`
- Create: `cli/src/core/tracks/concurrency.ts`
- Create: `cli/tests/core/tracks/concurrency.test.ts`

- [ ] **Step 1: Escribir el algoritmo y su test antes de medir**

```ts
// cli/tests/core/tracks/concurrency.test.ts
import { deriveDefaultParallelism } from '../../../src/core/tracks/concurrency';

test('elige el mayor N con p95 <= 1.5x y costo <=20% del tick (R10.3)', () => {
    expect(deriveDefaultParallelism({
        cpuCount: 8, tickMs: 5000,
        samples: [
            { supervisors: 1, p95Ms: 100 }, { supervisors: 2, p95Ms: 130 },
            { supervisors: 3, p95Ms: 149 }, { supervisors: 4, p95Ms: 170 },
        ],
    })).toBe(3);
});

test('si ninguna medición habilita N>1 queda serial (R10.2)', () => {
    expect(deriveDefaultParallelism({ cpuCount: 2, tickMs: 100, samples: [{ supervisors: 1, p95Ms: 90 }, { supervisors: 2, p95Ms: 180 }] })).toBe(1);
});
```

```ts
// cli/src/core/tracks/concurrency.ts
export interface FingerprintBudget {
    cpuCount: number;
    tickMs: number;
    samples: Array<{ supervisors: number; p95Ms: number }>;
}

export function deriveDefaultParallelism(budget: FingerprintBudget): number {
    if (!Number.isInteger(budget.cpuCount) || budget.cpuCount < 1 || budget.samples.length === 0) throw new Error('budget inválido');
    const baseline = budget.samples.find((s) => s.supervisors === 1);
    if (baseline === undefined || baseline.p95Ms <= 0) throw new Error('budget sin baseline N=1');
    return budget.samples
        .filter((s) => Number.isInteger(s.supervisors) && s.supervisors <= budget.cpuCount
            && s.p95Ms <= baseline.p95Ms * 1.5 && s.p95Ms <= budget.tickMs * 0.2)
        .reduce((max, s) => Math.max(max, s.supervisors), 1);
}
```

- [ ] **Step 2: Ejecutar RED, implementar y dejar GREEN**

Run: `cd cli && npx jest tests/core/tracks/concurrency.test.ts --runInBand`

Expected antes del source: FAIL. Expected después: PASS.

- [ ] **Step 3: Crear el benchmark que invoca el build local**

`benchmark-fingerprint.mjs` debe:

1. ejecutar `npm run build` en `cli/`;
2. medir 30 repeticiones de `computeFingerprint` para N=1..`min(8, cpus)` sobre el repo actual, usando workers separados;
3. descartar las primeras 5 muestras por warm-up;
4. escribir `fingerprint-budget.json` con `sourceHead`, `node`, `platform`, `cpuCount`, `tickMs:5000`, samples `{supervisors,p50Ms,p95Ms}` y `derivedDefault`;
5. no incluir hostname, username, paths absolutos ni variables de entorno.

La función que escribe el JSON usa `writeFileSync` porque este script produce un artefacto deliberado; el código runtime continúa usando helpers durables.

- [ ] **Step 4: Ejecutar la medición real y validar su hash**

Run: `node docs/research/r5/benchmark-fingerprint.mjs`

Expected: crea `docs/research/r5/fingerprint-budget.json`; `derivedDefault` es un entero entre 1 y `cpuCount`, no un valor escrito a mano.

Run: `node -e "const x=require('./docs/research/r5/fingerprint-budget.json');if(!x.sourceHead||!Number.isInteger(x.derivedDefault))process.exit(1)"`

Expected: exit 0.

- [ ] **Step 5: Conectar config y queue**

Agregar `maxParallelTracks` a `SupervisorConfig`; la CLI acepta `awm watch --max-parallel <n>`. Si se omite, carga `derivedDefault` del artefacto empaquetado. Validar `n` como entero `>=1`; todos los tracks alcanzan `ARMED`, pero solo hasta N pasan a `ACTIVE`. Los wrappers excedentes esperan sin arrancar el loop de watch/fingerprint hasta que un slot queda libre.

Test de scheduler:

```ts
expect(scheduleTracks(['a', 'b', 'c'], new Set(['a']), 2)).toEqual({ start: ['b'], waiting: ['c'] });
expect(() => parseMaxParallel('0')).toThrow(/entero >= 1/);
```

- [ ] **Step 6: Tests y commit**

Run: `cd cli && npx jest tests/core/tracks/concurrency.test.ts tests/commands/watch/supervisor-loop.test.ts --runInBand && npm run build`

Expected: PASS.

```bash
git add docs/research/r5 cli/src/core/tracks/concurrency.ts cli/src/commands/watch cli/tests/core/tracks/concurrency.test.ts cli/tests/commands/watch
git commit -m "perf(tracks): derive concurrency cap from fingerprint benchmark"
```

### Task 8: Bootstrap durable, ARMED barrier y supervisor detached

_Requirements: R4.1, R4.2, R4.4, R4.5, R4.6, R4.7, R4.8, R4.9, R4.10, C1, C2, C8, C11_

**Files:**
- Create: `cli/src/commands/watch/tracks.ts`
- Create: `cli/src/commands/track/supervisor-wrapper.ts`
- Modify: `cli/src/commands/watch/apply.ts`
- Modify: `cli/src/commands/watch/supervisor.ts`
- Modify: `cli/src/core/tracks/git.ts`
- Modify: `cli/src/commands/track/index.ts`
- Create: `cli/tests/commands/watch/track-bootstrap.test.ts`
- Create: `cli/tests/commands/track/supervisor-wrapper.test.ts`

- [ ] **Step 1: Escribir tests rojos del happy path y barrera**

```ts
test('P1 persiste cada fase antes del side effect y activa solo con todos ARMED (R4.1, R4.4, C1)', async () => {
    const h = harness(['a', 'b']);
    await h.tick();
    expect(h.events()).toEqual([
        'persist:PREPARE_INTENT:a', 'effect:create-worktree:a',
    ]);
    await h.runUntil((s) => s.tracks?.every((t) => t.phase === 'ARMED') ?? false);
    expect(h.dispatches()).toEqual([]);
    await h.tick();
    expect(h.state().cohortPhase).toBe('ACTIVE');
    expect(h.state().tracks?.filter((t) => t.phase === 'ACTIVE')).toHaveLength(h.config.maxParallelTracks);
});

test('readiness con nonce diferente bloquea sin despachar (R4.9, C8)', async () => {
    const h = harness(['a', 'b']);
    h.observeReadiness('a', 'wrong');
    await h.tick();
    expect(h.track('a')).toMatchObject({ phase: 'BLOCKED', blockedReason: expect.stringContaining('readinessNonce') });
    expect(h.dispatches()).toEqual([]);
});

test('worktree/lock ajeno nunca se borra (R4.3, R4.6)', async () => {
    const h = harness(['a', 'b']);
    h.placeForeignJournal('a');
    await h.tick();
    expect(h.foreignJournalExists('a')).toBe(true);
    expect(h.track('a').phase).toBe('BLOCKED');
});
```

- [ ] **Step 2: Verificar RED**

Run: `cd cli && npx jest tests/commands/watch/track-bootstrap.test.ts tests/commands/track/supervisor-wrapper.test.ts --runInBand`

Expected: FAIL por módulos ausentes.

- [ ] **Step 3: Implementar efectos P1 como una operación por tick**

`tracks.ts` expone dependencias inyectables:

```ts
export interface TrackRuntime {
    addWorktree(planRoot: string, ref: TrackRef, baseSha: string): void;
    initTrackJournal(ref: TrackRef, context: TrackContext): void;
    spawnSupervisor(ref: TrackRef): ProcessRef | void;
    observeSupervisor(ref: TrackRef): 'absent' | 'claimed' | 'ready' | 'foreign';
}

export function reconcileTracks(
    planRoot: string, branch: string, state: JournalState, runtime: TrackRuntime,
): { state: JournalState; effectExecuted: string | null } {
    // 1. construir CohortProtocol desde state
    // 2. nextProtocolEffect
    // 3. persistir intent/phase con writeJournal cuando corresponde
    // 4. ejecutar como máximo un side effect
    // 5. observar y persistir resultado en el tick siguiente
}
```

No esconder varios side effects dentro de `addWorktree` o `initTrackJournal`: cada frontera de Task 1 debe ser observable en tests.

- [ ] **Step 4: Implementar creación segura del worktree y journal**

En `git.ts`:

```ts
export function addOwnedWorktree(repo: string, ref: TrackRef, baseSha: string): void {
    const parent = path.dirname(ref.worktreePath);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(ref.worktreePath) && fs.readdirSync(ref.worktreePath).length > 0) {
        throw new Error(`destino no vacío: ${ref.worktreePath}`);
    }
    git(repo, ['worktree', 'add', '-b', ref.branch, ref.worktreePath, baseSha]);
}
```

Antes de llamar: verificar que `.awm` está ignorado con `git check-ignore -q .awm/probe`; si no, registrar degradación y entrar a C2. Tras crear: `initJournal`, escribir `trackContext`, descriptor autenticado y comprobar que cualquier journal/lock preexistente pertenece al mismo intent.

Al construir cada `TrackRef` por primera vez, el supervisor del plan usa tokens criptográficamente aleatorios (los hashes deterministas de Task 1 son únicamente valores opacos del modelo puro):

```ts
fencingToken: crypto.randomBytes(32).toString('hex'),
readinessNonce: crypto.randomBytes(32).toString('hex'),
```

- [ ] **Step 5: Implementar wrapper detached con claim exact-once**

El supervisor del plan persiste:

```ts
ref.supervisorIntent = {
    nonce: crypto.randomBytes(16).toString('hex'),
    argv: [process.execPath, cliEntry, 'track', 'supervisor-wrapper', '--track', ref.trackId,
        '--readiness', ref.readinessNonce, '--fence', ref.fencingToken],
    claimPath: path.join(ref.worktreePath, '.awm', 'supervisor.claim'),
};
```

`supervisor-wrapper.ts` abre `claimPath` con `wx`, escribe/fsync identity sidecar, inicializa el journal local y persiste el readiness recibido como `ARMED`. Luego observa read-only únicamente su propio `TrackRef` en el journal del plan. Cuando ese ref pasa a `ACTIVE`, lanza `awm watch` para el worktree y espera que el lock quede adquirido. Mientras espera slot no ejecuta gate, fingerprint ni tareas. Un segundo wrapper con el mismo nonce detecta claim existente y sale 0 sin lanzar otro supervisor.

- [ ] **Step 6: Integrar P1 en el orden del tick del supervisor**

En `Supervisor.tick()` el orden queda:

```ts
verifyBranchInvariant(...);
reconcileOpenJoinBeforeMergeHeadGuard(...); // no-op si no hay join intent
consumePendingRequests(...);
reconcileTracks(...);                       // P1/P2, máximo un effect
runnerTick(...);                            // jobs
superviseController(...);
finalizeIfEligible(...);
```

Durante `PREPARING`, `ensureController` no puede despachar tareas de tracks; solo puede producir las requests de registro de cohorte. El test verifica orden con índices en `calls[]`, no solo presencia.

- [ ] **Step 7: Green y build**

Run: `cd cli && npx jest tests/commands/watch/track-bootstrap.test.ts tests/commands/track/supervisor-wrapper.test.ts tests/commands/watch/supervisor-loop.test.ts --runInBand && npm run build`

Expected: PASS; ningún proceso real queda vivo porque esta task usa spawners inyectados.

- [ ] **Step 8: Commit**

```bash
git add cli/src/commands/watch cli/src/commands/track cli/src/core/tracks/git.ts cli/tests/commands/watch cli/tests/commands/track
git commit -m "feat(tracks): bootstrap supervisors behind an armed cohort barrier"
```

### Task 9: Crash/restart de P1 y fallback serial tras bootstrap parcial

_Requirements: R4.2, R4.3, R4.5, R4.6, R4.8, R4.9, R4.10, C1, C2, C11_

**Files:**
- Create: `cli/tests/commands/watch/track-bootstrap-crash.test.ts`
- Modify: `cli/src/commands/watch/tracks.ts`
- Modify: `cli/src/commands/watch/supervisor.ts`

- [ ] **Step 1: Crear una tabla de crash points, no tests ad hoc**

```ts
const crashPoints = [
    'after-prepare-intent', 'after-worktree-effect', 'after-worktree-result',
    'after-journal-effect', 'after-journal-result', 'after-supervisor-intent',
    'after-supervisor-claim', 'after-supervisor-identity', 'after-readiness',
] as const;

test.each(crashPoints)('restart converge desde %s sin duplicar recursos (R4.2, C11)', async (point) => {
    const h = realGitHarness({ crashAt: point });
    await expect(h.firstSupervisor()).rejects.toThrow('injected-crash');
    const before = h.ownedResources();
    await h.restartSupervisorUntil('ACTIVE');
    expect(h.ownedResources()).toEqual(before.withMissingEffectsCompleted());
    expect(h.spawnClaimsByTrack()).toEqual({ a: 1, b: 1 });
    expect(h.worktreeCountByTrack()).toEqual({ a: 1, b: 1 });
});
```

- [ ] **Step 2: Verificar que la matriz descubre los casos aún no reconciliados**

Run: `cd cli && npx jest tests/commands/watch/track-bootstrap-crash.test.ts --runInBand`

Expected: al menos un FAIL en `after-supervisor-claim` o `after-readiness` antes de completar la reconciliación.

- [ ] **Step 3: Implementar la matriz observable de P1**

Agregar una función pura a `tracks.ts`:

```ts
export type PrepareDecision =
    | 'retry-worktree' | 'accept-worktree' | 'write-descriptor'
    | 'retry-supervisor-same-intent' | 'accept-readiness'
    | 'block-foreign' | 'begin-fallback';

export function decidePrepare(ref: TrackRef, observed: PrepareObservation): PrepareDecision {
    if (observed.foreignJournal || observed.foreignLock || observed.foreignIdentity) return 'block-foreign';
    if (ref.phase === 'PREPARE_INTENT') return observed.worktreeOwned ? 'accept-worktree' : 'retry-worktree';
    if (ref.phase === 'WORKTREE_CREATED' && !observed.descriptorExists) return 'write-descriptor';
    if (ref.phase === 'SUPERVISOR_STARTING') {
        if (observed.readinessNonce === ref.readinessNonce && observed.identityMatches) return 'accept-readiness';
        if (!observed.claimExists && observed.identity === 'absent') return 'retry-supervisor-same-intent';
        if (observed.identity === 'foreign') return 'block-foreign';
    }
    return 'begin-fallback';
}
```

La observación de muerte usa la tupla `ProcessRef`; un error de `ps` equivale a identidad indemostrable y bloquea.

- [ ] **Step 4: Escribir el test rojo del fallback completo**

```ts
test('fallo del segundo track limpia el primero antes de serializar (R4.5, C2)', async () => {
    const h = realGitHarness({ failWorktreeFor: 'b' });
    await h.runUntil((s) => s.cohortPhase === 'SERIAL');
    expect(h.events()).toEqual(expect.arrayContaining([
        'fallback-intent:prepare-failed:b', 'teardown-intent:a',
        'supervisor-stopped:a', 'worktree-removed:a', 'branch-removed:a', 'serial-entered',
    ]));
    expect(h.events().indexOf('branch-removed:a')).toBeLessThan(h.events().indexOf('serial-entered'));
    expect(h.liveSupervisorGroups()).toEqual([]);
    expect(h.worktrees()).not.toContain(h.trackPath('a'));
    expect(h.serialExecutionStarted()).toBe(true);
});
```

- [ ] **Step 5: Conectar fallback al mismo state machine de teardown de Task 13 mediante una interfaz temporal**

Hasta Task 13, `TrackRuntime.teardownOwned(ref)` ejecuta pasos observables uno por tick y persiste las fases ya definidas. Task 13 reemplaza el cuerpo por el módulo dedicado sin cambiar esta interfaz. Serial solo se persiste cuando todos los refs están `REMOVED` o nunca superaron `DECLARED`.

- [ ] **Step 6: Ejecutar la matriz completa dos veces**

Run: `cd cli && npx jest tests/commands/watch/track-bootstrap-crash.test.ts --runInBand && npx jest tests/commands/watch/track-bootstrap-crash.test.ts --runInBand`

Expected: ambas corridas PASS; no dependen de timing aleatorio ni dejan entradas en `git worktree list`.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/watch cli/tests/commands/watch/track-bootstrap-crash.test.ts
git commit -m "test(tracks): prove bootstrap recovery and serial fallback cleanup"
```

### Task 10: Freeze del track, quiescencia del plan y precondiciones de join

_Requirements: R5.2, R5.8, R5.9, R6.3, R6.4, R6.5, C7_

**Files:**
- Create: `cli/src/core/tracks/join.ts`
- Modify: `cli/src/core/tracks/git.ts`
- Modify: `cli/src/commands/watch/tracks.ts`
- Modify: `cli/src/commands/watch/supervisor.ts`
- Create: `cli/tests/core/tracks/join.test.ts`
- Create: `cli/tests/commands/watch/track-freeze.test.ts`

- [ ] **Step 1: Escribir tests rojos de precondiciones completas**

```ts
test('join exige freeze SHA, árbol limpio, gate recalculado, cero jobs y lock libre (R6.4, R6.5)', () => {
    const base = readyJoin({
        frozenHeadSha: 'track-head', actualHeadSha: 'track-head', dirtyPaths: [],
        gatePass: true, liveJobs: 0, supervisorAlive: false, lockExists: false,
    });
    expect(validateJoinReadiness(base)).toEqual({ ok: true });
    for (const mutation of [
        { dirtyPaths: ['untracked.txt'] }, { gatePass: false }, { liveJobs: 1 },
        { supervisorAlive: true }, { lockExists: true }, { actualHeadSha: 'moved' },
    ]) {
        expect(validateJoinReadiness({ ...base, ...mutation })).toMatchObject({ ok: false });
    }
});

test('dirty paths se nombran y nunca se descartan (R6.5)', () => {
    expect(validateJoinReadiness(readyJoin({ dirtyPaths: ['a.ts', 'new.txt'] })))
        .toEqual({ ok: false, reasons: ['worktree sucio: a.ts, new.txt'] });
});

test('ownership real fuera de scope serializa joins restantes, no ejecución (R5.8, R5.9)', () => {
    const out = planJoinOrder(['a', 'b'], { a: ['outside.ts'], b: [] });
    expect(out).toEqual({ mode: 'serial-joins', order: ['a', 'b'], violations: { a: ['outside.ts'] } });
});
```

- [ ] **Step 2: Verificar RED**

Run: `cd cli && npx jest tests/core/tracks/join.test.ts tests/commands/watch/track-freeze.test.ts --runInBand`

Expected: FAIL por `join.ts` ausente.

- [ ] **Step 3: Implementar snapshot de join y validación pura**

```ts
// cli/src/core/tracks/join.ts
export interface JoinReadiness {
    frozenHeadSha: string;
    actualHeadSha: string;
    dirtyPaths: string[];
    gatePass: boolean;
    liveJobs: number;
    supervisorAlive: boolean;
    lockExists: boolean;
}

export function validateJoinReadiness(x: JoinReadiness): { ok: true } | { ok: false; reasons: string[] } {
    const reasons: string[] = [];
    if (x.actualHeadSha !== x.frozenHeadSha) reasons.push(`HEAD cambió: esperado ${x.frozenHeadSha}, actual ${x.actualHeadSha}`);
    if (x.dirtyPaths.length > 0) reasons.push(`worktree sucio: ${[...x.dirtyPaths].sort().join(', ')}`);
    if (!x.gatePass) reasons.push('gate local rojo');
    if (x.liveJobs > 0) reasons.push(`${x.liveJobs} jobs vivos`);
    if (x.supervisorAlive) reasons.push('supervisor de track vivo');
    if (x.lockExists) reasons.push('lock de track retenido');
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
```

- [ ] **Step 4: Implementar freeze como request/ack durable**

El supervisor del plan emite `track-freeze-request` al journal del track. El supervisor del track:

1. deja de despachar;
2. consume/reconcilia jobs existentes;
3. recalcula `computeTrackGate` bajo su lock;
4. exige worktree/index limpio y persiste `frozenHeadSha` + `FROZEN`;
5. termina su controller generation y wrapper groups con identidad confirmada;
6. libera el lock y sale.

El supervisor del plan solo acepta freeze cuando observa los seis hechos. No escribe directamente el journal del track.

- [ ] **Step 5: Pausar la generación del plan y adquirir `integration.lock`**

Agregar `integrationLockPath(planRoot)` en `journal/paths.ts`. Antes del primer join:

```ts
await stopControllerGenerationConfirmed(planRoot, branch, cfg);
const integrationLock = acquireIntegrationLock(planRoot, {
    planJournalId: state.journalId,
    expectedPlanHeadSha: currentHead(planRoot),
});
```

El lock usa `wx`, 0600, fsync y contiene `ProcessRef` + expected SHA. Antes y después de cada operación Git se ejecuta `assertPlanHead(expectedPlanHeadSha)`. Un humano puede mutar el repo, pero la mutación se detecta y bloquea; ningún controller administrado sigue corriendo durante el lease.

- [ ] **Step 6: Comparar ownership post-hoc desde commits congelados**

Usar exactamente:

```ts
const base = mergeBase(planRoot, state.cohortBaseSha!, ref.frozenHeadSha!);
const changes = changedPaths(planRoot, base, ref.frozenHeadSha!);
const actual = assessActualOwnership(parsed.tracks[ref.trackId], changes);
```

No consultar `git status` para ownership; `status` solo participa del guard de limpieza.

- [ ] **Step 7: Tests y commit**

Run: `cd cli && npx jest tests/core/tracks/join.test.ts tests/commands/watch/track-freeze.test.ts tests/commands/watch/lock.test.ts --runInBand && npm run build`

Expected: PASS, incluido un test TOCTOU que mueve el HEAD del plan entre intent y merge y obtiene `BLOCKED` sin merge.

```bash
git add cli/src/core/tracks cli/src/core/journal/paths.ts cli/src/commands/watch cli/tests/core/tracks cli/tests/commands/watch
git commit -m "feat(tracks): freeze track and plan mutations before join"
```

### Task 11: Join durable y matriz MERGE_HEAD × HEAD

_Requirements: R6.2, R6.3, R6.6, R6.7, R6.8, R6.9, C7_

**Files:**
- Modify: `cli/src/core/tracks/join.ts`
- Modify: `cli/src/core/tracks/git.ts`
- Modify: `cli/src/commands/watch/tracks.ts`
- Modify: `cli/src/commands/watch/supervisor.ts`
- Create: `cli/tests/core/tracks/join-reconcile.test.ts`
- Create: `cli/tests/commands/watch/track-join-crash.test.ts`

- [ ] **Step 1: Codificar la matriz completa como table test**

```ts
type JoinCase = {
    name: string; observation: JoinObservation;
    expected: JoinDecision;
};

const cases: JoinCase[] = [
    { name: 'no empezó', observation: obs(null, 'plan', false), expected: { action: 'retry-merge' } },
    { name: 'conflicto propio', observation: obs('track', 'plan', false), expected: { action: 'abort-own-merge' } },
    { name: 'aplicado', observation: obs(null, 'merged', true), expected: { action: 'accept-merge', joinedCommitSha: 'merged' } },
    { name: 'MERGE_HEAD ajeno', observation: obs('other', 'plan', false), expected: { action: 'block', reason: 'MERGE_HEAD ajeno' } },
    { name: 'indemostrable', observation: obs(null, 'other', false), expected: { action: 'block', reason: 'estado de join indemostrable' } },
];

test.each(cases)('$name (R6.8, R6.9)', ({ observation, expected }) => {
    expect(decideJoinReconciliation(intent(), observation)).toEqual(expected);
});
```

- [ ] **Step 2: Ejecutar RED**

Run: `cd cli && npx jest tests/core/tracks/join-reconcile.test.ts --runInBand`

Expected: FAIL por función ausente.

- [ ] **Step 3: Implementar decisión pura y precedencia**

```ts
export function decideJoinReconciliation(intent: JoinIntent, o: JoinObservation): JoinDecision {
    if (o.mergeHead === null && o.planHead === intent.expectedPlanHeadSha && !o.trackIsAncestor) return { action: 'retry-merge' };
    if (o.mergeHead === intent.expectedTrackHeadSha && o.planHead === intent.expectedPlanHeadSha) return { action: 'abort-own-merge' };
    if (o.mergeHead === null && o.trackIsAncestor) return { action: 'accept-merge', joinedCommitSha: o.planHead };
    if (o.mergeHead !== null && o.mergeHead !== intent.expectedTrackHeadSha) return { action: 'block', reason: 'MERGE_HEAD ajeno' };
    return { action: 'block', reason: 'estado de join indemostrable' };
}
```

En `Supervisor.tick`, llamar `reconcileOpenJoin()` **antes** de cualquier guard general que rechace `MERGE_HEAD`.

- [ ] **Step 4: Implementar merge explícito `no-ff`**

```ts
export function mergeFrozenTrack(repo: string, intent: JoinIntent): void {
    assertPlanHead(repo, intent.expectedPlanHeadSha);
    git(repo, ['merge', '--no-ff', '--no-edit', intent.expectedTrackHeadSha]);
}

export function abortOwnedMerge(repo: string, intent: JoinIntent): void {
    const observed = readMergeHead(repo);
    if (observed !== intent.expectedTrackHeadSha) throw new Error('no se aborta MERGE_HEAD ajeno');
    git(repo, ['merge', '--abort']);
    if (readMergeHead(repo) !== null || dirtyPaths(repo).length > 0) throw new Error('merge --abort no restauró árbol limpio');
}
```

Persistir `joinIntent` antes de `mergeFrozenTrack`. Tras éxito o reconciliación, persistir `joinedCommitSha = currentHead` y fase `MERGED_UNVERIFIED`; no pedir todavía un job.

- [ ] **Step 5: Inyectar crash en cada frontera de P2**

```ts
const joinCrashPoints = [
    'after-join-request', 'after-join-intent', 'after-merge-effect',
    'during-conflict', 'after-merge-observation', 'after-merged-result',
] as const;

test.each(joinCrashPoints)('join converge desde %s sin doble merge (R6.2, R6.8)', async (point) => {
    const h = joinHarness({ crashAt: point });
    await h.crashAndRestart();
    expect(h.mergeCountFor('track-head')).toBe(1);
    expect(h.mergeHead()).toBeNull();
    expect(h.track().phase).toBe('MERGED_UNVERIFIED');
});
```

Para `during-conflict`, el fixture modifica la misma línea en plan y track; el restart debe abortar únicamente el merge propio y quedar reintentable o `BLOCKED` con índice limpio.

- [ ] **Step 6: Tests y commit**

Run: `cd cli && npx jest tests/core/tracks/join-reconcile.test.ts tests/commands/watch/track-join-crash.test.ts --runInBand && npm run build`

Expected: PASS dos veces consecutivas.

```bash
git add cli/src/core/tracks cli/src/commands/watch cli/tests/core/tracks cli/tests/commands/watch
git commit -m "feat(tracks): reconcile durable joins across merge crashes"
```

### Task 12: QA final, integración canónica única e interlock

_Requirements: R3.6, R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R7.7, R8.1, R8.2, C3, C4_

**Files:**
- Modify: `cli/src/commands/watch/apply.ts`
- Modify: `cli/src/commands/watch/tracks.ts`
- Modify: `cli/src/commands/watch/supervisor.ts`
- Modify: `cli/src/commands/job/request.ts`
- Modify: `cli/src/commands/job/gate.ts`
- Create: `cli/tests/commands/watch/track-finalize.test.ts`
- Modify: `cli/tests/commands/watch/apply.test.ts`
- Modify: `cli/tests/commands/job/gate-reconcile.test.ts`

- [ ] **Step 1: Escribir tests rojos de append idempotente**

```ts
test('cycle plan agrega items por id sin borrar satisfiedBy (R7.2)', () => {
    const state = stateWithCycleItems([{ id: 'qa', kind: 'qa', satisfiedBy: 'job-qa' }]);
    applyCyclePlanAppend(state, [
        { id: 'qa', kind: 'qa' },
        { id: 'track-integration:a', kind: 'track-integration' },
    ]);
    expect(state.cycleVerificationPlan).toEqual([
        { id: 'qa', kind: 'qa', satisfiedBy: 'job-qa' },
        { id: 'track-integration:a', kind: 'track-integration' },
    ]);
});

test('registrar tracks deja gate rojo desde el inicio (R7.3)', () => {
    const s = stateWithTracks(['a', 'b']);
    registerTrackIntegrationItems(s);
    expect(s.cycleVerificationPlan.filter((x) => x.kind === 'track-integration'))
        .toEqual([
            { id: 'track-integration:a', kind: 'track-integration' },
            { id: 'track-integration:b', kind: 'track-integration' },
        ]);
    expect(computeGate(s, false, fingerprintNow).pass).toBe(false);
});
```

- [ ] **Step 2: Escribir tests rojos del orden final**

```ts
test('solo el HEAD final recibe QA e integración (R7.7, C3)', async () => {
    const h = finalizerHarness(['a', 'b']);
    h.markMerged('a', 'H1');
    await h.tick();
    expect(h.requestsByKind('qa')).toEqual([]);
    expect(h.requestsByKind('track-integration')).toEqual([]);
    h.markMerged('b', 'H2');
    await h.tick();
    expect(h.nextAction()).toMatchObject({ type: 'run-global-qa', target: 'H2' });
});

test('QA con fixes debe culminar en commit limpio antes del job canónico (C3, C4)', async () => {
    const h = finalizerHarness(['a', 'b']);
    h.allMergedAt('H2');
    h.reportQaPass({ headSha: 'H3', clean: true });
    await h.tick();
    expect(h.requestedJobs()).toEqual([{
        argv: ['npm', 'test', '--', '--runInBand'],
        paths: ['cli/src/**', 'cli/tests/**'], cwd: '.',
        satisfies: ['track-integration:a', 'track-integration:b'],
        fingerprintHead: 'H3',
    }]);
});

test('mutación después de QA o integración vuelve stale el cierre (R7.7)', async () => {
    const h = finalizerHarness(['a', 'b']);
    h.finishIntegrationAt('H3');
    h.moveHeadTo('H4');
    expect(await h.interlock()).toMatchObject({ pass: false, reasons: expect.arrayContaining([
        expect.objectContaining({ category: 'stale-fingerprint' }),
    ]) });
});

test('un track pendiente mantiene IN_PROGRESS y lo nombra (R8.1)', () => {
    expect(canCompleteCohort(stateWithPhases({ a: 'MERGED_UNVERIFIED', b: 'FROZEN' })))
        .toEqual({ complete: false, pendingTracks: ['b'] });
});
```

- [ ] **Step 3: Verificar RED**

Run: `cd cli && npx jest tests/commands/watch/track-finalize.test.ts tests/commands/watch/apply.test.ts --runInBand`

Expected: FAIL en append y finalizer.

- [ ] **Step 4: Reemplazar el guard “solo si vacío” por append transaccional**

```ts
export function applyCyclePlanAppend(state: JournalState, incoming: VerificationItem[]): void {
    const byId = new Map(state.cycleVerificationPlan.map((item) => [item.id, item]));
    for (const item of incoming) {
        const prior = byId.get(item.id);
        if (prior !== undefined && prior.kind !== item.kind) throw new Error(`verification item ${item.id} cambia kind`);
        if (prior === undefined) byId.set(item.id, { ...item });
    }
    state.cycleVerificationPlan = [...byId.values()];
}
```

La aplicación ocurre sobre el clone transaccional ya usado por `consumePendingRequests`; una colisión de kind rechaza el request completo.

- [ ] **Step 5: Extender `requestJob` con varios satisfiers sin cambiar identidad mecánica**

```ts
export interface RequestJobOptions { satisfies?: string | string[] }

const satisfies = opts.satisfies === undefined ? []
    : Array.isArray(opts.satisfies) ? [...new Set(opts.satisfies)].sort() : [opts.satisfies];
const idempotencyKey = crypto.createHash('sha256')
    .update(`${fp.fingerprint}:${fp.commandDigest}:${satisfies.join('\0')}`).digest('hex');
```

En `apply.ts`, si un job equivalente ya existe, enlazar **todos** los items solicitados a ese job sin duplicarlo. `Job.satisfies` migra aditivamente a `satisfies: string[]`; `store.ts` normaliza el string legacy a array de un elemento.

- [ ] **Step 6: Guardar el contrato canónico y rechazar pedidos prematuros**

Al registrar la cohorte, persistir en el journal:

```ts
trackIntegration: {
    argv: parsed.integration.argv,
    paths: parsed.integration.paths,
    planDigest,
}
```

`requestJob` recibe `{ verificationKind: 'track-integration' }` solo desde el finalizer. Antes de emitir verifica:

```ts
if (state.tracks?.some((t) => t.phase !== 'MERGED_UNVERIFIED')) {
    throw new Error('track-integration requiere todos los merges aplicados');
}
if (dirtyPaths(repoRoot).length > 0) throw new Error('track-integration requiere árbol limpio');
if (argvDigest(argv) !== argvDigest(state.trackIntegration.argv)) throw new Error('argv de integración no canónico');
```

- [ ] **Step 7: Implementar agenda final**

1. Todos `MERGED_UNVERIFIED`: persistir `nextAction: run-global-qa` y reanudar una controller generation del plan.
2. El controller ejecuta `post-implementation-qa`, corrige hallazgos y commitea. Emite `track-finalize-request` con `qaHeadSha`; el supervisor exige árbol/índice limpio y `qaHeadSha === HEAD`.
3. El supervisor pausa de nuevo el controller y solicita un job con `trackIntegration.argv/paths`, satisfaciendo todos los IDs.
4. Al pass, `computeGate` recalcula cada fingerprint contra el mismo HEAD. Solo entonces ejecuta el interlock global existente.
5. Si pasa, cambia todos los tracks a `JOINED`, ciclo a `COMPLETE`, persiste y libera `integration.lock`.

No se relanza QA por cada merge. La semántica de R7.6 queda satisfecha por un único job posterior al último merge que enlaza todos los tracks integrados simultáneamente.

- [ ] **Step 8: Probar crash después de QA, request, pass y antes de COMPLETE**

Cada restart debe reutilizar el mismo request/job por fingerprint + argv + conjunto de satisfiers; no debe ejecutar el comando dos veces. Agregar contador del wrapper y esperar `1` en los cuatro casos.

Run: `cd cli && npx jest tests/commands/watch/track-finalize.test.ts tests/commands/watch/apply.test.ts tests/commands/job/gate-reconcile.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add cli/src/core/journal cli/src/commands/job cli/src/commands/watch cli/tests/commands/job cli/tests/commands/watch
git commit -m "feat(tracks): validate final head once before global interlock"
```

### Task 13: Teardown durable y remove recuperable

_Requirements: R4.2, R4.3, R4.6, R4.10, C2, C9_

**Files:**
- Create: `cli/src/core/tracks/teardown.ts`
- Modify: `cli/src/core/tracks/git.ts`
- Modify: `cli/src/commands/watch/tracks.ts`
- Create: `cli/tests/core/tracks/teardown.test.ts`
- Create: `cli/tests/commands/watch/track-teardown-crash.test.ts`

- [ ] **Step 1: Escribir matriz de teardown pura**

```ts
const cases = [
    ['request sin intent', phase('TEARDOWN_REQUESTED'), observed(), 'persist-intent'],
    ['supervisor propio vivo', phase('TEARDOWN_INTENT'), observed({ ownSupervisorAlive: true }), 'stop-own-supervisor'],
    ['identidad ajena', phase('TEARDOWN_INTENT'), observed({ foreignSupervisor: true }), 'block-foreign'],
    ['supervisor ausente', phase('TEARDOWN_INTENT'), observed({ ownSupervisorAlive: false }), 'accept-supervisor-stopped'],
    ['worktree propio', phase('SUPERVISOR_STOPPED'), observed({ ownedWorktreeExists: true }), 'remove-owned-worktree'],
    ['worktree ajeno', phase('SUPERVISOR_STOPPED'), observed({ foreignWorktree: true }), 'block-foreign'],
    ['branch propia', phase('WORKTREE_REMOVED'), observed({ ownedBranchExists: true }), 'remove-owned-branch'],
    ['todo ausente', phase('BRANCH_REMOVED'), observed(), 'mark-removed'],
] as const;

test.each(cases)('%s (R4.3, C9)', (_name, ref, observation, action) => {
    expect(decideTeardown(ref, observation)).toBe(action);
});
```

- [ ] **Step 2: Verificar RED**

Run: `cd cli && npx jest tests/core/tracks/teardown.test.ts --runInBand`

Expected: FAIL por módulo ausente.

- [ ] **Step 3: Implementar decisiones sin side effects**

```ts
export type TeardownDecision =
    | 'persist-intent' | 'stop-own-supervisor' | 'accept-supervisor-stopped'
    | 'remove-owned-worktree' | 'remove-owned-branch' | 'mark-removed'
    | 'block-foreign';

export function decideTeardown(ref: TrackRef, o: TeardownObservation): TeardownDecision {
    if (o.foreignSupervisor || o.foreignWorktree) return 'block-foreign';
    if (ref.phase === 'TEARDOWN_REQUESTED') return 'persist-intent';
    if (ref.phase === 'TEARDOWN_INTENT') return o.ownSupervisorAlive ? 'stop-own-supervisor' : 'accept-supervisor-stopped';
    if (ref.phase === 'SUPERVISOR_STOPPED') return o.ownedWorktreeExists ? 'remove-owned-worktree' : 'remove-owned-branch';
    if (ref.phase === 'WORKTREE_REMOVED') return o.ownedBranchExists ? 'remove-owned-branch' : 'mark-removed';
    if (ref.phase === 'BRANCH_REMOVED') return 'mark-removed';
    throw new Error(`teardown no válido desde ${ref.phase}`);
}
```

- [ ] **Step 4: Implementar efectos con prueba de propiedad**

`removeOwnedWorktree` requiere simultáneamente:

- `teardownIntent.worktreePath === realpath/canonical target`;
- `.awm/track.json` coincide en `planJournalId`, `trackId`, `fencingToken`;
- supervisor propio muerto confirmado y lock ausente;
- `git worktree list --porcelain` asocia ese path a `teardownIntent.branch`.

Entonces ejecuta `git worktree remove <path>` sin `--force`. Si está sucio, bloquea nombrando paths. `removeOwnedBranch` verifica que no esté checked out y ejecuta `git branch -d <branch>`; nunca `-D`.

- [ ] **Step 5: Inyectar crash después de cada frontera**

```ts
const teardownCrashPoints = [
    'after-teardown-request', 'after-teardown-intent', 'after-stop-effect',
    'after-supervisor-stopped', 'after-worktree-effect', 'after-worktree-removed',
    'after-branch-effect', 'after-branch-removed',
] as const;

test.each(teardownCrashPoints)('teardown converge desde %s (C9)', async (point) => {
    const h = teardownHarness({ crashAt: point });
    await h.crashAndRestartUntilRemoved();
    expect(h.track().phase).toBe('REMOVED');
    expect(h.worktreeExists()).toBe(false);
    expect(h.branchExists()).toBe(false);
    expect(h.signalledForeignProcess()).toBe(false);
});
```

- [ ] **Step 6: Reutilizar este módulo para C2**

Eliminar el cuerpo temporal `TrackRuntime.teardownOwned` de Task 9 y delegar en `decideTeardown` + efectos. Volver a correr el test de fallback parcial para probar que ambos caminos usan el mismo state machine.

- [ ] **Step 7: Tests y commit**

Run: `cd cli && npx jest tests/core/tracks/teardown.test.ts tests/commands/watch/track-teardown-crash.test.ts tests/commands/watch/track-bootstrap-crash.test.ts --runInBand && npm run build`

Expected: PASS; el fixture extranjero permanece byte-idéntico.

```bash
git add cli/src/core/tracks cli/src/commands/watch cli/tests/core/tracks cli/tests/commands/watch
git commit -m "feat(tracks): reconcile ownership-proven teardown after crashes"
```

### Task 14: Contrato de modo track en `awm-baseline-registry`

_Requirements: R1.1, R1.5, R2.2, R2.3, R2.4, R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R10.1, C3, C4, C6_

**Esta task se ejecuta en el repo hermano `../awm-baseline-registry`, no dentro de `agentic-workflow`.** Si el checkout instalado bajo `~/.awm` está detached, no se edita: se usa o crea el checkout hermano versionado.

**Files:**
- Modify: `../awm-baseline-registry/skills/writing-plans/SKILL.md`
- Modify: `../awm-baseline-registry/skills/subagent-driven-development/SKILL.md`
- Modify: `../awm-baseline-registry/skills/post-implementation-qa/SKILL.md`
- Create: `../awm-baseline-registry/tests/r5-track-contract.test.mjs`

- [ ] **Step 1: Descubrir o clonar un checkout limpio y crear rama**

```bash
test -e ../awm-baseline-registry/.git \
  || git clone https://github.com/Kodria/awm-baseline-registry.git ../awm-baseline-registry
git -C ../awm-baseline-registry fetch origin
git -C ../awm-baseline-registry status --short --branch
if git -C ../awm-baseline-registry show-ref --verify --quiet refs/heads/claude/agentic-workflow-awm-issues-dqka6l-r5; then
  git -C ../awm-baseline-registry switch claude/agentic-workflow-awm-issues-dqka6l-r5
else
  git -C ../awm-baseline-registry switch -c claude/agentic-workflow-awm-issues-dqka6l-r5 origin/main
fi
```

Expected: checkout limpio. Si `status --short` muestra cambios previos, detener esta task y preservar el trabajo ajeno; no usar reset/checkout destructivo.

- [ ] **Step 2: Escribir primero el test de contrato**

```js
// ../awm-baseline-registry/tests/r5-track-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skill = async (name) => readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');

test('writing-plans emits mechanically parseable track contract (R1.1, R1.5, C4)', async () => {
  const text = await skill('writing-plans');
  for (const token of ['## Tracks', '**Track:**', '**Integration argv:**', '**Integration paths:**', 'JSON string[]']) {
    assert.ok(text.includes(token), `writing-plans missing ${token}`);
  }
  assert.ok(text.includes('| Track | Depends on | Shared resources |'));
  assert.match(text, /no dependency[^\n]*none|none[^\n]*no dependency/i);
});

test('SDD track mode scopes tasks and skips plan writes/global QA (R2.2, R3.2-R3.5, C6)', async () => {
  const text = await skill('subagent-driven-development');
  for (const token of ['AWM-INTEGRATION: track-mode', 'trackContext.taskIds', 'computeTrackGate', 'planDigest', 'DO NOT modify the plan', 'DO NOT invoke `post-implementation-qa`']) {
    assert.ok(text.includes(token), `subagent-driven-development missing ${token}`);
  }
});

test('post QA refuses track context and runs only after final merge (R3.4, R3.6, C3)', async () => {
  const text = await skill('post-implementation-qa');
  assert.ok(text.includes('AWM-INTEGRATION: final-head-only'));
  assert.ok(text.includes('.awm/track.json'));
  assert.ok(text.includes('MERGED_UNVERIFIED'));
  assert.ok(text.includes('clean committed HEAD'));
});
```

Run: `cd ../awm-baseline-registry && node --test tests/r5-track-contract.test.mjs`

Expected: FAIL con los marcadores ausentes.

- [ ] **Step 3: Extender `writing-plans` con gramática exacta**

Agregar después de `Task Structure`:

````markdown
## Parallel track declaration (optional, fail-closed)

<!-- AWM-INTEGRATION: track-plan-contract -->

Use this only when two or more task groups have no overlap in files,
dependencies, declared resources, lockfiles, manifests, migrations, snapshots,
or generated outputs. If that claim cannot be made explicitly, omit all track
fields and keep the plan serial.

Add one `**Track:** <id>` line to every tracked task immediately after its
`_Requirements:_` line and before `**Files:**`. Add one plan-level block:

```markdown
## Tracks

**Integration argv:** ["npm","test","--","--runInBand"]
**Integration paths:** ["src/**","tests/**"]

| Track | Depends on | Shared resources |
|---|---|---|
| core | none | [] |
| docs | none | [] |
```

`Integration argv` and `Integration paths` are JSON string[] values, not shell
text. Derive argv from a command already verified in the repository; preserve
each token as a separate array element. `Depends on` is `none` only when there
is no dependency; any other value forces serial execution. `Shared resources`
must be explicit, including `[]`; omitted means serial. Resource IDs use
`<class>:<value>` such as `port:5432`, `db:dev`, or `path:.cache/tool`.
````

No plan se marca paralelo por cantidad de tasks; se deriva del análisis de Files/recursos y conserva fallback serial.

- [ ] **Step 4: Agregar modo track al skill SDD**

Después de la sección journal-first existente, agregar:

```markdown
## Track mode (authenticated worktree only)

<!-- AWM-INTEGRATION: track-mode -->

WHEN `<repo>/.awm/track.json` exists, first authenticate it through
`awm track status`. If authentication fails, stop; never infer track mode from
the directory name. Read assignment only from the local journal's
`trackContext.taskIds`; do not derive it again from the plan and do not read
dynamic state from sibling tracks.

Before acting on a task, verify its id belongs to `trackContext.taskIds` and
the current plan digest equals `trackContext.planDigest`. A mismatch is
BLOCKED. In track mode use `computeTrackGate` through `awm job gate`; it covers
local tasks, reviews, fixes, and declared local verification only.

In track mode:

- DO NOT modify the plan: no checkboxes, reconciliation edits, QA markers, or
  retro markers.
- DO NOT invoke `post-implementation-qa`; global QA belongs to the plan
  supervisor after every track is `MERGED_UNVERIFIED`.
- Commit all owned changes and leave worktree/index clean before requesting
  `awm track join <trackId>`.
- A join request freezes the track. After requesting it, do not dispatch or
  mutate until the plan supervisor reports the result.
```

- [ ] **Step 5: Agregar guard final-head-only a post-implementation-qa**

Después de `When to Use`, agregar:

```markdown
## Parallel-track final-head guard

<!-- AWM-INTEGRATION: final-head-only -->

IF `.awm/track.json` exists, refuse invocation: QA global never runs inside a
track. The track controller returns to its local gate instead.

IF the plan journal declares tracks, run only when every track is
`MERGED_UNVERIFIED` and the plan supervisor identifies the current HEAD as the
final integrated candidate. Apply every QA fix, commit the fixes, and require a
clean committed HEAD before reporting QA pass. The supervisor then runs the
canonical integration argv and interlock; no mutation is allowed after that
fingerprint is created.
```

- [ ] **Step 6: Subir version de las tres skills y validar registry**

Incrementar minor en el frontmatter `version` de cada skill porque cambia su contrato. No alterar nombres ni descripciones salvo que el validador lo exija.

Run:

```bash
cd ../awm-baseline-registry
node --test tests/r5-track-contract.test.mjs
node --test tests/validate-portability.test.mjs
node scripts/validate-portability.mjs
bash scripts/check-skill-version-bumps.sh
```

Expected: todas las pruebas PASS y `validate-portability` exit 0.

- [ ] **Step 7: Commit en el registry**

```bash
git -C ../awm-baseline-registry add skills/writing-plans/SKILL.md skills/subagent-driven-development/SKILL.md skills/post-implementation-qa/SKILL.md tests/r5-track-contract.test.mjs
git -C ../awm-baseline-registry commit -m "feat(sdd): coordinate authenticated parallel track mode"
```

No crear tag ni ejecutar `awm update` en esta task; promoción del registry ocurre después de mergear ambos PRs con `minCliVersion` coordinado.

### Task 15: E2E local de aceptación CA-4.1–CA-4.3

_Requirements: R4.5, R5.7, R5.8, R6.1, R7.6, R8.2, CA-4.1, CA-4.2, CA-4.3_

**Files:**
- Create: `cli/tests/integration/parallel-tracks.e2e.test.ts`
- Create: `cli/tests/fixtures/tracks/workload/plan.md`
- Create: `cli/tests/fixtures/tracks/workload/apply-task.mjs`

- [ ] **Step 1: Crear workload determinista con modo serial y paralelo**

El fixture inicializa un repo con `src/a.txt` y `src/b.txt`. `apply-task.mjs <file> <value>` reemplaza el contenido usando argv, nunca shell. El plan declara dos tracks, integration argv:

```json
["node","cli/tests/fixtures/tracks/workload/verify.mjs"]
```

y paths `['src/**']`. `verify.mjs` sale 0 solo si ambos archivos tienen sus valores finales.

- [ ] **Step 2: Escribir CA-4.1 sobre tree hash, no historial**

```ts
test('serial y paralelo producen el mismo árbol (CA-4.1)', async () => {
    const serial = await runWorkload({ mode: 'serial' });
    const parallel = await runWorkload({ mode: 'parallel' });
    expect(parallel.cycleStatus).toBe('COMPLETE');
    expect(parallel.treeHash).toBe(serial.treeHash);
    expect(parallel.commitHash).not.toBe(serial.commitHash);
    expect(parallel.integrationRuns).toBe(1);
});
```

- [ ] **Step 3: Escribir CA-4.2 con seam de `worktreeAdder`**

```ts
test('fallo de worktree completa serial y deja degradación (CA-4.2)', async () => {
    const out = await runWorkload({ mode: 'parallel', worktreeAdder: () => { throw new Error('injected'); } });
    expect(out.cycleStatus).toBe('COMPLETE');
    expect(out.executionMode).toBe('serial');
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'parallel-degraded', reason: expect.stringContaining('injected') }));
    expect(out.remainingWorktrees).toEqual([]);
});
```

- [ ] **Step 4: Escribir CA-4.3 con un solo lockfile**

```ts
test('un track que toca package-lock invalida la cohorte (CA-4.3, C5)', async () => {
    const out = await runWorkload({ mode: 'parallel', extraDeclaredFile: { track: 'a', path: 'package-lock.json' } });
    expect(out.executionMode).toBe('serial');
    expect(out.events).toContainEqual(expect.objectContaining({ kind: 'parallel-degraded', reason: 'global:lockfile:package-lock.json' }));
    expect(out.createdWorktrees).toEqual([]);
});
```

- [ ] **Step 5: Agregar caso de ownership real violado después de ejecución**

El track A declara `src/a.txt` pero su commit también toca `outside.txt`. Ambos tracks terminan en sus worktrees; la ejecución paralela no se mata, pero los joins ocurren uno por vez y el evento `joins-serialized` nombra `outside.txt`.

- [ ] **Step 6: Build local y corrida aislada**

Run: `cd cli && npm run build && npx jest tests/integration/parallel-tracks.e2e.test.ts --runInBand`

Expected: 4 tests PASS. El test invoca `node dist/src/index.js`, nunca `awm` del PATH.

- [ ] **Step 7: Repetir para detectar leaks**

Run: `cd cli && npx jest tests/integration/parallel-tracks.e2e.test.ts --runInBand && npx jest tests/integration/parallel-tracks.e2e.test.ts --runInBand`

Expected: ambas PASS; `afterEach` confirma cero procesos propios vivos y remueve solo los tmpdirs creados por el test.

- [ ] **Step 8: Commit**

```bash
git add cli/tests/integration/parallel-tracks.e2e.test.ts cli/tests/fixtures/tracks/workload
git commit -m "test(tracks): certify serial parity fallback and global collisions"
```

### Task 16: E2E reales en Claude Code y Codex

_Requirements: R10.1, R10.4, CA-T.5, RNF-T.2, RNF-T.5_

**Files:**
- Create: `docs/research/r5/provider-run.mjs`
- Create: `docs/research/r5/provider-protocol.md`
- Create: `docs/research/r5/evidence/.gitkeep`
- Create during execution: `docs/research/r5/evidence/claude-code-sandbox-remote.json`
- Create during execution: `docs/research/r5/evidence/codex-owner-mac.json`
- Create: `docs/research/r5/provider-matrix.md`
- Create: `cli/tests/integration/r5-provider-evidence.test.ts`

- [ ] **Step 1: Escribir el validador antes de recolectar evidencia**

```ts
// cli/tests/integration/r5-provider-evidence.test.ts
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../docs/research/r5/evidence');
const required = ['claude-code-sandbox-remote.json', 'codex-owner-mac.json'];

test.each(required)('%s certifica bootstrap/recovery/join con artefactos (R10.4)', (name) => {
    const x = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    expect(x.schema).toBe(1);
    expect(['claude-code', 'codex']).toContain(x.provider);
    expect(x.result).toBe('pass');
    expect(x.exercises).toMatchObject({ bootstrap: 'pass', recovery: 'pass', join: 'pass', finalIntegrationRuns: 1 });
    expect(x.sourceHead).toMatch(/^[0-9a-f]{40}$/);
    expect(x.commands).toEqual(expect.arrayContaining([expect.stringContaining('node dist/src/index.js')]));
    expect(x.artifacts.every((p: string) => fs.existsSync(path.resolve(root, '..', p)))).toBe(true);
    expect(JSON.stringify(x)).not.toMatch(/(?:token|secret|password|\/Users\/[^/]+|\/home\/[^/]+)/i);
});
```

Run: `cd cli && npx jest tests/integration/r5-provider-evidence.test.ts --runInBand`

Expected: FAIL porque faltan ambos JSON. Esta task no puede declararse completa con documentación solamente.

- [ ] **Step 2: Crear protocolo y runner provider-neutral**

`provider-protocol.md` instruye exactamente tres ejercicios sobre un repo temporal preparado por `provider-run.mjs`:

1. **Bootstrap:** iniciar plan de dos tracks, observar ambos `ARMED`, luego `ACTIVE`, y guardar status/eventos.
2. **Recovery:** matar con SIGKILL el supervisor del plan inmediatamente después de `supervisorIntent` del track B; relanzar `node dist/src/index.js watch`; probar un solo claim/spawn por track.
3. **Join:** completar ambos tracks, pedir joins, probar HEAD final limpio, un solo job track-integration, gate verde y `COMPLETE`.

El runner acepta solo:

```text
node docs/research/r5/provider-run.mjs --provider claude-code --environment sandbox-remote
node docs/research/r5/provider-run.mjs --provider codex --environment owner-mac
```

Rechaza otras combinaciones para el gate obligatorio. Crea un tmpdir con `mkdtemp`, copia el build local, prepara el fixture, calcula `sourceHead` y al final sanitiza paths a `<WORKDIR>` antes de escribir el JSON canónico.

- [ ] **Step 3: Ejecutar en Claude Code sandbox remoto**

Desde una sesión Claude Code sobre la rama implementada:

```bash
cd cli && npm ci && npm run build && cd ..
node docs/research/r5/provider-run.mjs --provider claude-code --environment sandbox-remote
claude -p --dangerously-skip-permissions "Lee docs/research/r5/provider-protocol.md y ejecuta los tres ejercicios en el WORKDIR impreso por provider-run.mjs. No edites fuera de WORKDIR. Termina ejecutando el comando finalize que imprime el runner."
node docs/research/r5/provider-run.mjs --provider claude-code --environment sandbox-remote --verify
```

Expected: `docs/research/r5/evidence/claude-code-sandbox-remote.json` con `result:"pass"` y logs sanitizados referenciados.

- [ ] **Step 4: Ejecutar en Codex sobre Mac del dueño**

Después de `git pull` de la misma rama y `npm ci`:

```bash
cd cli && npm ci && npm run build && cd ..
node docs/research/r5/provider-run.mjs --provider codex --environment owner-mac
codex exec -C "$PWD" --sandbox danger-full-access --ask-for-approval never "Lee docs/research/r5/provider-protocol.md y ejecuta los tres ejercicios en el WORKDIR impreso por provider-run.mjs. No edites fuera de WORKDIR. Termina ejecutando el comando finalize que imprime el runner."
node docs/research/r5/provider-run.mjs --provider codex --environment owner-mac --verify
```

Expected: `docs/research/r5/evidence/codex-owner-mac.json` con `result:"pass"`. El test acepta diferencias de primitivas/provider, pero estados, veredictos y gates deben ser iguales.

- [ ] **Step 5: Generar matriz solo desde evidencia**

`provider-run.mjs --consolidate` lee ambos JSON y genera:

```markdown
| Capability | Claude Code sandbox remote | Codex owner Mac |
|---|---|---|
| bootstrap | supported | supported |
| crash recovery | supported | supported |
| worktree join | supported | supported |
| final gate semantics | identical | identical |
```

Si falta o falla una fila, genera `not-certified` y sale 1; nunca escribe `supported` por ausencia.

Run: `node docs/research/r5/provider-run.mjs --consolidate && cd cli && npx jest tests/integration/r5-provider-evidence.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit de evidencia**

```bash
git add docs/research/r5 cli/tests/integration/r5-provider-evidence.test.ts
git commit -m "test(r5): certify parallel tracks in Claude Code and Codex"
```

### Task 17: Regresión completa, documentación operativa y handoff de release

_Requirements: R1.2, R4.5, R8.2, R10.1, RNF-T.2_

**Files:**
- Modify: `README.md`
- Modify: `cli/README.md`
- Modify: `docs/plans/2026-08-02-r5-parallel-tracks-plan.md` (solo checkboxes durante ejecución; marcadores QA/retro los agregan sus skills)
- Modify after CLI release decision: `../awm-baseline-registry/awm-registry.json`

- [ ] **Step 1: Documentar el flujo diario y fallback**

Agregar a `cli/README.md`:

```markdown
### Parallel tracks

Plans without `## Tracks` run serially exactly as before. A parallel plan must
declare task membership, dependency/resource rows, and one JSON argv integration
command. Start or resume with `awm watch`; inspect with `awm track status`.
Track workers commit only their assigned files and request `awm track join`.
The plan supervisor freezes and merges tracks, runs global QA once on the final
HEAD, executes the canonical integration job once, then applies the interlock.

Any missing declaration, overlap, global file class, unavailable worktree, or
failed preparation degrades to serial with an event. `BLOCKED` means ownership
or identity was not provable and needs operator evidence; never delete a
worktree, branch, lock, or process merely to make it proceed.
```

En `README.md` enlazar esa sección sin duplicar el protocolo.

- [ ] **Step 2: Correr suites focalizadas**

Run:

```bash
cd cli
npx jest tests/core/tracks tests/commands/track tests/commands/watch/track-bootstrap.test.ts tests/commands/watch/track-bootstrap-crash.test.ts tests/commands/watch/track-freeze.test.ts tests/commands/watch/track-join-crash.test.ts tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-teardown-crash.test.ts tests/integration/parallel-tracks.e2e.test.ts tests/integration/r5-provider-evidence.test.ts --runInBand
```

Expected: PASS, cero procesos/worktrees de fixtures remanentes.

- [ ] **Step 3: Correr regresión completa y build**

Run: `cd cli && npm test && npm run build`

Expected: PASS. No actualizar snapshots para ocultar diferencias; cada cambio inesperado se investiga.

- [ ] **Step 4: Auto-verificar el CLI compilado**

Run:

```bash
cd cli
node dist/src/index.js track --help
node dist/src/index.js watch --help
node dist/src/index.js sensors run
```

Expected: los dos help salen 0; sensores reporta `overall: pass` o `overall: inconclusive` con razones ambientales explícitas. Un `overall: fail` bloquea el cierre.

- [ ] **Step 5: Verificar registry completo**

Run:

```bash
cd ../awm-baseline-registry
node --test tests/*.test.mjs
node scripts/validate-portability.mjs
bash scripts/check-skill-version-bumps.sh
```

Expected: PASS.

- [ ] **Step 6: Coordinar compatibilidad de release**

Después de que el PR del CLI esté mergeado y la versión publicada sea conocida, actualizar `../awm-baseline-registry/awm-registry.json` para que `minCliVersion` sea esa versión exacta o superior. Probar con el CLI publicado en un HOME/AWM_HOME temporal mediante `awm update && awm init`; no promover el registry antes del CLI porque las skills nuevas invocan `awm track`.

- [ ] **Step 7: Commit de documentación en cada repo**

```bash
git add README.md cli/README.md
git commit -m "docs(tracks): explain parallel workflow and fail-closed fallback"

git -C ../awm-baseline-registry add awm-registry.json
git -C ../awm-baseline-registry commit -m "chore(registry): require CLI with parallel track support"
```

- [ ] **Step 8: Invocar QA y cierre del lifecycle**

Con todas las tasks marcadas, ejecutar `post-implementation-qa`; debe auditar cada requisito de la matriz siguiente y corregir todos los hallazgos. Luego ejecutar `harness-retro` y `finishing-a-development-branch` por separado en ambos repos. Los marcadores `awm-qa-complete` y `awm-retro-complete` se agregan solamente cuando esos skills terminan, no durante implementación.

## Matriz de trazabilidad

| Req | Task(s) | Test(s) / verificación específica |
|---|---:|---|
| R1.1 | T3, T14 | `parsea membresía...`; `writing-plans emits mechanically parseable track contract` |
| R1.2 | T3, T17 | `ausencia completa conserva serial legacy`; regresión `npm test` |
| R1.3 | T3, T4 | table test ids `'' . .. -x a/b a\\b`; `git check-ref-format participa` |
| R1.4 | T3, T4 | ownership derivado de Files; normalización/descendientes/rename |
| R1.5 | T3, T14 | fixture `## Tracks`; contract test de Depends on/Shared resources |
| R1.6 | T3 | `rechaza membresía sin fila y fila sin membresía` + duplicate rows |
| R1.7 | T3 | `degrada a serial si shared resources falta` |
| R1.8 | T3 | `Depends on no es none` produce serial |
| R2.1 | T2 | shape guard de `TrackContext` y round-trip journal |
| R2.2 | T5, T14 | `assertTrackTask`; marker `trackContext.taskIds` |
| R2.3 | T5, T14 | task fuera de asignación lanza error |
| R2.4 | T5, T14 | planDigest divergente bloquea |
| R2.5 | T5 | descriptor round-trip 0600 con todos los campos |
| R2.6 | T5 | fencingToken distinto rechaza contexto |
| R2.7 | T5 | test de contexto abre solo plan journal + journal local |
| R3.1 | T5, T14 | descriptor autenticado selecciona `mode:'track'` |
| R3.2 | T5, T14 | task scope viene de `trackContext.taskIds` |
| R3.3 | T5, T14 | contract test exige `DO NOT modify the plan`; hash del plan inmutable en E2E |
| R3.4 | T5, T14 | contract test impide QA global en track |
| R3.5 | T5, T14 | `computeTrackGate no exige qa/interlock global` |
| R3.6 | T12, T14 | finalizer agenda QA solo con todos `MERGED_UNVERIFIED` |
| R4.1 | T1, T8 | state exploration + orden persist/effect de P1 |
| R4.2 | T1, T8, T9, T13 | crash matrices P1 y teardown convergen |
| R4.3 | T8, T9, T13 | fixtures ajenos permanecen byte-idénticos |
| R4.4 | T1, T8 | `no activa parcialmente` + barrera de todos ARMED |
| R4.5 | T8, T9, T15, T17 | worktree failure limpia y completa serial con evento |
| R4.6 | T8, T9, T13 | journal/lock/identity ajenos bloquean sin borrar |
| R4.7 | T8 | `.awm` no ignorado produce serial y evento |
| R4.8 | T8, T9 | wrapper detached con ProcessRef real; crash test |
| R4.9 | T8, T9 | readiness nonce errado bloquea; no dispatch antes de ARMED |
| R4.10 | T8, T9, T13 | ausencia recuperable por claim/identity; `ps` ambiguo bloquea |
| R5.1 | T4 | path exacto/descendiente interseca |
| R5.2 | T4, T10 | `changedPaths(base, frozenHead)` ignora worktree sucio |
| R5.3 | T4 | colisión `src/api` vs `SRC/API` |
| R5.4 | T4 | rename cuenta old/new; directorio/glob cubre descendiente |
| R5.5 | T4 | `canonicalResource` acepta clase:valor y rechaza forma inválida |
| R5.6 | T4 | dos `db:dev` producen serial |
| R5.7 | T4, T15 | un solo `package-lock.json` invalida cohorte (CA-4.3) |
| R5.8 | T10, T15 | actual fuera de ownership serializa joins restantes |
| R5.9 | T10, T15 | ambos worktrees terminan antes de integración serial |
| R5.10 | T4, T6 | `verify-independence` sale 1 con violaciones |
| R6.1 | T6, T15 | add/join/remove solo emiten; HEAD/state permanecen iguales |
| R6.2 | T1, T11 | state exploration y crash matrix recorren freeze/join/merged/joined |
| R6.3 | T1, T10, T11 | joinIntent existe antes del primer merge call |
| R6.4 | T10 | table test de seis precondiciones |
| R6.5 | T10 | dirty paths nombrados, sin cleanup destructivo |
| R6.6 | T11 | estrategia `no-ff` y joinedCommitSha persistidos |
| R6.7 | T11 | conflicto propio termina sin MERGE_HEAD e índice limpio |
| R6.8 | T1, T11 | cinco filas de matriz + test de precedencia |
| R6.9 | T1, T11 | casos other/indemostrable bloquean sin Git mutation |
| R7.1 | T2, T12 | guard acepta `track-integration`; round-trip schema |
| R7.2 | T12 | append conserva `satisfiedBy` y rechaza kind conflictivo |
| R7.3 | T12 | dos items dejan gate rojo al registrar cohorte |
| R7.4 | T3, T12 | job se crea después de todos los merges sobre HEAD de QA |
| R7.5 | T3, T12 | request prematuro/argv no canónico lanza error |
| R7.6 | T12, T15 | un job enlaza todos los IDs; `integrationRuns === 1` |
| R7.7 | T1, T12 | ninguna request global con track pendiente; mutación posterior queda stale |
| R8.1 | T1, T12 | pendingTracks nombra track no unido y mantiene IN_PROGRESS |
| R8.2 | T1, T12, T15, T17 | interlock sobre mismo HEAD produce todos JOINED + COMPLETE |
| R9.1 | T2 | IDs nuevos únicos; legacy determinista entre lecturas |
| R9.2 | T2 | TrackRef completo pasa guard; token vacío falla |
| R9.3 | T2 | fixture schema 1 legacy conserva jobs/verdicts y lee sin error |
| R9.4 | T5 | cwd ajeno sale 1; plan/track autenticados pasan |
| R9.5 | T5, T6 | status no agrega `gate` al TrackRef ni escribe plan journal |
| R9.6 | T6 | agregado compone gate de cada journal read-only |
| R9.7 | T2, T5, T8 | tests fijan generador de cada token y reuse del nonce al reconciliar |
| R10.1 | T14, T16, T17 | contract registry + dos evidencias + matriz generada |
| R10.2 | T7 | scheduler respeta cap y encola excedentes |
| R10.3 | T7 | algoritmo deriva default del JSON medido, no constante manual |
| R10.4 | T16 | evidence tests de Claude Code y Codex con bootstrap/recovery/join |
| C1 | T1, T8, T9 | barrera ARMED sin activación parcial |
| C2 | T1, T9, T13 | fallback solo después de teardown completo |
| C3 | T1, T12, T14 | orden final y stale-after-mutation |
| C4 | T3, T12, T14 | JSON argv parseado, persistido y comparado por digest |
| C5 | T4, T15 | CA-4.3 con un solo archivo global |
| C6 | T5, T14 | gate local no exige QA/interlock |
| C7 | T1, T10, T11 | freeze + integration lease + HEAD assertions |
| C8 | T2, T5, T8 | autoridad de journal/fencing/spawn/readiness fijada por tests |
| C9 | T1, T13 | matriz teardown y crash points completos |
| C10 | T4, T15 | recursos declarados participan; test no afirma observar uso runtime oculto |
| C11 | T1, T8, T9 | intent + claim `wx`; spawn count 1 tras cada crash |
| CA-4.1 | T15 | tree hash serial === paralelo |
| CA-4.2 | T15 | worktreeAdder falla, serial completa y registra degradación |
| CA-4.3 | T4, T15 | package-lock en un track invalida cohorte |
| CA-T.5 | T16 | dos JSON reales con artefactos y sourceHead |

## Analyze gate

Antes de ejecutar el plan, correr:

```bash
python3 - <<'PY'
from pathlib import Path
import re

p = Path('docs/plans/2026-08-02-r5-parallel-tracks-plan.md').read_text()
design = Path('docs/plans/2026-08-02-r5-parallel-tracks-design.md').read_text()
requirements = set(re.findall(r'^- \*\*(R\d+\.\d+)\*\*', design, re.M))
rows = set(re.findall(r'^\| (R\d+\.\d+) \|', p, re.M))
missing = sorted(requirements - rows)
extra = sorted(rows - requirements)
if missing or extra:
    raise SystemExit(f'traceability mismatch missing={missing} extra={extra}')
tasks = set(re.findall(r'^### Task (\d+):', p, re.M))
referenced = set(re.findall(r'\bT(\d+)\b', p[p.index('## Matriz de trazabilidad'):]))
if tasks != referenced:
    raise SystemExit(f'task traceability mismatch unreferenced={sorted(tasks-referenced)} unknown={sorted(referenced-tasks)}')
print(f'OK: {len(requirements)} design requirements and {len(tasks)} tasks traced')
PY
```

Expected: `OK: 70 design requirements and 17 tasks traced` (si el diseño agrega o elimina requisitos, el número puede cambiar pero el script debe seguir en exit 0 solo con igualdad exacta).

## Handoff de ejecución

El primer checkpoint de ejecución es Task 1. Si el modelo no converge, no se autoriza “seguir y arreglar luego”: se corrige el protocolo puro y se vuelve a correr su exploración. Después de T1, los checkpoints recomendados son T5 (contratos puros completos), T9 (bootstrap/fallback), T13 (protocolos Git completos), T15 (aceptación local) y T16 (providers reales).
