# Controller-requested Track Teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `awm track remove <trackId>` durably cancel the complete parallel cohort, safely tear down demonstrably owned resources, and return to serial execution.

**Architecture:** The request consumer persists a declarative `teardownRequested` marker and performs no external side effect. The pure protocol reducer converts that marker into cohort-wide `FALLBACK_PENDING`; the existing reconciler and teardown driver remain the sole path for process, worktree, and branch removal. Terminal cohorts consume late requests as explicit moot events.

**Tech Stack:** TypeScript 5.9, Node.js 22, Commander, Jest 30, the existing AWM journal/protocol/teardown runtime.

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

## Source contract

The approved design is `docs/plans/2026-09-05-track-remove-design.md`. Its requirements `TR-REQ-01` through `TR-REQ-10` are normative. This is a serial plan: journal shape, protocol types, reconciliation, and tests depend on each other and must not be assigned to independent tracks.

### Task 1: Persist and validate the teardown request intent

_Requirements: TR-REQ-01, TR-REQ-02, TR-REQ-07_

**Files:**
- Modify: `cli/src/core/journal/types.ts:82-103`
- Modify: `cli/src/core/journal/types.ts:467-484`
- Modify: `cli/src/commands/watch/apply.ts:216-246`
- Modify: `cli/tests/core/journal/types.test.ts:101-181`
- Modify: `cli/tests/commands/watch/apply.test.ts:490-550`

**Skills:** test-driven-development

- [x] **Step 1: Add RED tests for the journal shape**

Extend the `TrackRef` validation test with a valid boolean and an invalid non-boolean value:

```ts
test('TrackRef valida teardownRequested como boolean opcional (TR-REQ-01, TR-REQ-07)', () => {
    const state = emptyState('main');
    state.tracks = [{
        trackId: 'cli', worktreePath: '/tmp/wt', branch: 'awm-track/cli', ownership: [],
        sharedResources: [], dependsOn: [], fencingToken: 'f'.repeat(32), phase: 'ACTIVE',
        readinessNonce: 'r'.repeat(32), teardownRequested: true,
    }];
    expect(isWellFormedState(state)).toBe(true);
    (state.tracks[0] as unknown as Record<string, unknown>).teardownRequested = 'true';
    expect(isWellFormedState(state)).toBe(false);
});
```

- [x] **Step 2: Add RED request-consumer tests**

Replace the test that expects every `track-teardown-request` to be rejected with these focused cases. Reuse the local `TrackRef` construction style already used by the join tests.

```ts
test('track-teardown-request persiste intención sin mover fases (TR-REQ-01, TR-REQ-07)', () => {
    const s0 = readJournal(repo, 'rama').state!;
    s0.tracks = [{
        trackId: 'alpha', worktreePath: path.join(repo, '.track-alpha'), branch: 'awm-track/alpha',
        ownership: [], sharedResources: [], dependsOn: [], fencingToken: 'f'.repeat(32),
        phase: 'ACTIVE', readinessNonce: 'n'.repeat(32),
    }];
    s0.cohortPhase = 'ACTIVE';
    writeJournal(repo, 'rama', s0);

    emitRequest(repo, 'rama', {
        kind: 'track-teardown-request', generationToken: 'g1', idempotencyKey: 'teardown-alpha',
        payload: { trackId: 'alpha' },
    });
    expect(consumePendingRequests(repo, 'rama', 'g1').applied).toBe(1);
    const saved = readJournal(repo, 'rama').state!;
    expect(saved.tracks![0].teardownRequested).toBe(true);
    expect(saved.tracks![0].phase).toBe('ACTIVE');
    expect(saved.cohortPhase).toBe('ACTIVE');
});

test.each([
    ['payload vacío', {}],
    ['trackId vacío', { trackId: '' }],
    ['track inexistente', { trackId: 'ghost' }],
])('track-teardown-request rechaza %s sin mutar protocolo (TR-REQ-02)', (_label, payload) => {
    const before = readJournal(repo, 'rama').state!;
    const request = emitRequest(repo, 'rama', {
        kind: 'track-teardown-request', generationToken: 'g1',
        idempotencyKey: `bad-${String((payload as { trackId?: string }).trackId)}`, payload,
    });
    const result = consumePendingRequests(repo, 'rama', 'g1');
    expect(result).toMatchObject({ applied: 0, rejectedInvalid: 1 });
    expect(fs.existsSync(`${request.file}.rejected`)).toBe(true);
    const after = readJournal(repo, 'rama').state!;
    expect(after.cohortPhase).toBe(before.cohortPhase);
    expect(after.tracks).toEqual(before.tracks);
});
```

- [x] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
cd cli
npx jest tests/core/journal/types.test.ts tests/commands/watch/apply.test.ts --runInBand
```

Expected: the shape test accepts the invalid string because the guard lacks the field, and the valid request test reports `rejectedInvalid: 1` because no handler exists.

- [x] **Step 4: Add the durable field and runtime validation**

Add this property beside `joinRequested` in `TrackRef`:

```ts
/** El controller pidió cancelar la cohorte mediante `awm track remove`.
 * Declarativo y durable: `reconcileProtocol` decide la transición y el
 * teardown driver existente ejecuta los efectos externos. */
teardownRequested?: boolean;
```

Extend `isWellFormedTrackRef` with:

```ts
&& (x.teardownRequested === undefined || typeof x.teardownRequested === 'boolean')
```

- [x] **Step 5: Implement the request handler**

Add this branch immediately after `track-join-request` in `applyRequestToState`:

```ts
if (env.kind === 'track-teardown-request') {
    const p = env.payload;
    if (typeof p.trackId !== 'string' || p.trackId.length === 0) {
        throw new Error('track-teardown-request requiere trackId');
    }
    const ref = s.tracks?.find((t) => t.trackId === p.trackId);
    if (ref === undefined) {
        throw new Error(`track-teardown-request: track desconocido: ${p.trackId}`);
    }
    ref.teardownRequested = true;
    applyOutcome(s, { ...base, outcome: 'applied', resultRef: p.trackId });
    return;
}
```

- [x] **Step 6: Run the focused tests and confirm GREEN**

Run:

```bash
cd cli
npx jest tests/core/journal/types.test.ts tests/commands/watch/apply.test.ts --runInBand
```

Expected: both suites pass; the request is applied declaratively and invalid inputs remain visibly rejected.

- [x] **Step 7: Commit the durable request bridge**

```bash
git add cli/src/core/journal/types.ts cli/src/commands/watch/apply.ts cli/tests/core/journal/types.test.ts cli/tests/commands/watch/apply.test.ts
git commit -m "feat(track): persist teardown request intent"
```

### Task 2: Add the cohort-cancellation transition to the pure protocol

_Requirements: TR-REQ-03, TR-REQ-05, TR-REQ-06, TR-REQ-08, TR-REQ-09_

**Files:**
- Modify: `cli/src/core/tracks/types.ts:82-99`
- Modify: `cli/src/core/tracks/protocol.ts:246-275`
- Modify: `cli/tests/core/tracks/protocol.test.ts:20-52`

**Skills:** test-driven-development

- [x] **Step 1: Add RED tests for cancellation, idempotence, terminal states, and blocking**

Add the following cases to `parallel-track protocol model`:

```ts
test('remove cancela toda la cohorte activa y conserva DECLARED/BLOCKED (TR-REQ-03, TR-REQ-05)', () => {
    const s = initialCohort('journal-1', ['active', 'declared', 'blocked']);
    s.cohortPhase = 'ACTIVE';
    s.tracks.active.phase = 'ACTIVE';
    s.tracks.declared.phase = 'DECLARED';
    s.tracks.blocked.phase = 'BLOCKED';

    const out = reconcileProtocol(s, { kind: 'teardown-requested', trackId: 'active' });
    expect(out.cohortPhase).toBe('FALLBACK_PENDING');
    expect(out.fallbackReason).toBe('controller-requested:active');
    expect(out.tracks.active.phase).toBe('TEARDOWN_REQUESTED');
    expect(out.tracks.declared.phase).toBe('DECLARED');
    expect(out.tracks.blocked.phase).toBe('BLOCKED');
    expect(nextProtocolEffect(out)).toBeNull();
});

test('remove repetido no rebobina teardown ni reemplaza la causa (TR-REQ-08)', () => {
    const s = initialCohort('journal-1', ids);
    s.cohortPhase = 'FALLBACK_PENDING';
    s.fallbackReason = 'controller-requested:cli';
    s.tracks.cli.phase = 'SUPERVISOR_STOPPED';
    s.tracks.docs.phase = 'TEARDOWN_REQUESTED';

    const out = reconcileProtocol(s, { kind: 'teardown-requested', trackId: 'docs' });
    expect(out.fallbackReason).toBe('controller-requested:cli');
    expect(out.tracks.cli.phase).toBe('SUPERVISOR_STOPPED');
    expect(out.tracks.docs.phase).toBe('TEARDOWN_REQUESTED');
});

test.each(['SERIAL', 'COMPLETE'] as const)(
    'remove es no-op protocolar en cohorte terminal %s (TR-REQ-09)',
    (cohortPhase) => {
        const s = initialCohort('journal-1', ids);
        s.cohortPhase = cohortPhase;
        for (const track of Object.values(s.tracks)) {
            track.phase = cohortPhase === 'SERIAL' ? 'REMOVED' : 'JOINED';
            if (cohortPhase === 'COMPLETE') track.frozenHeadSha = `${track.trackId}-head`;
        }
        expect(reconcileProtocol(s, { kind: 'teardown-requested', trackId: 'cli' })).toEqual(s);
    },
);

test('remove converge a serial solo después de desmontar la cohorte (TR-REQ-06)', () => {
    let s = initialCohort('journal-1', ids);
    for (const track of Object.values(s.tracks)) track.phase = 'ACTIVE';
    s.cohortPhase = 'ACTIVE';
    s = reconcileProtocol(s, { kind: 'teardown-requested', trackId: 'cli' });
    expect(nextProtocolEffect(s)).toEqual({ kind: 'begin-teardown', trackId: 'cli' });
    s.tracks.cli.phase = 'REMOVED';
    s.tracks.docs.phase = 'REMOVED';
    expect(nextProtocolEffect(s)).toEqual({
        kind: 'enter-serial', reason: 'controller-requested:cli',
    });
});
```

- [x] **Step 2: Run the protocol suite and confirm RED**

Run:

```bash
cd cli
npx jest tests/core/tracks/protocol.test.ts --runInBand
```

Expected: TypeScript/Jest fails because `teardown-requested` is not a member of `ProtocolObservation`.

- [x] **Step 3: Add the protocol observation and reducer branch**

Add this union member beside `join-requested`:

```ts
| { kind: 'teardown-requested'; trackId: string }
```

Add this as the first branch in `reconcileProtocol`, before `prepare-failed`:

```ts
if (observation.kind === 'teardown-requested') {
    const requested = out.tracks[observation.trackId];
    if (requested === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
    if (out.cohortPhase !== 'SERIAL' && out.cohortPhase !== 'COMPLETE'
        && out.cohortPhase !== 'FALLBACK_PENDING') {
        out.cohortPhase = 'FALLBACK_PENDING';
        out.fallbackReason = `controller-requested:${observation.trackId}`;
        markTeardownRequested(out.tracks);
    }
} else if (observation.kind === 'prepare-failed') {
```

Do not call `markTeardownRequested` when already in `FALLBACK_PENDING`: doing so would rewind `TEARDOWN_INTENT`, `SUPERVISOR_STOPPED`, or later states and violate TR-REQ-08.

- [x] **Step 4: Run the protocol suite and confirm GREEN**

Run:

```bash
cd cli
npx jest tests/core/tracks/protocol.test.ts --runInBand
```

Expected: the suite passes, including the existing exhaustive state exploration and the four new cancellation cases.

- [x] **Step 5: Commit the protocol transition**

```bash
git add cli/src/core/tracks/types.ts cli/src/core/tracks/protocol.ts cli/tests/core/tracks/protocol.test.ts
git commit -m "feat(track): cancel cohort on teardown request"
```

### Task 3: Reconcile the durable marker into the existing teardown driver

_Requirements: TR-REQ-03, TR-REQ-04, TR-REQ-05, TR-REQ-07, TR-REQ-08, TR-REQ-09_

**Files:**
- Create: `cli/tests/commands/watch/track-remove-request.test.ts`
- Modify: `cli/src/commands/watch/tracks.ts:940-992`

**Skills:** test-driven-development

- [ ] **Step 1: Create the integration test fixture and RED behavior tests**

Create `track-remove-request.test.ts` using real temporary journals and the real request emitter. The runtime must throw for every external mutation so the first assertions prove that marker consumption itself performs no destructive effect:

```ts
import fs from 'fs';
import path from 'path';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, type TrackRuntime } from '../../../src/commands/watch/tracks';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { emitTrackRequest } from '../../../src/commands/track/emit';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { eventsPath } from '../../../src/core/journal/paths';
import type { JournalState, TrackRef } from '../../../src/core/journal/types';
import type { TrackPhase } from '../../../src/core/tracks/types';

const BRANCH = 'main';

describe('awm track remove -> fallback teardown', () => {
    let planRoot: string;
    let baseSha: string;

    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        initJournal(planRoot, BRANCH);
    });
    afterEach(() => fs.rmSync(planRoot, { recursive: true, force: true }));

    function declareCohort(cohortPhase: JournalState['cohortPhase'] = 'ACTIVE'): JournalState {
        const state = readJournal(planRoot, BRANCH).state!;
        state.cohortPhase = cohortPhase;
        state.cohortBaseSha = baseSha;
        state.tracks = ['a', 'b'].map((trackId): TrackRef => ({
            trackId, worktreePath: path.join(planRoot, `../nope-${trackId}`),
            branch: `awm-track/${trackId}`, ownership: [], sharedResources: [], dependsOn: [],
            fencingToken: `fence-${trackId}`.padEnd(32, '0'), phase: 'ACTIVE' as TrackPhase,
            readinessNonce: `ready-${trackId}`.padEnd(32, '0'),
        }));
        writeJournal(planRoot, BRANCH, state);
        return state;
    }

    function inertRuntime(): TrackRuntime {
        const real = defaultTrackRuntime(planRoot, BRANCH);
        return {
            ...real,
            addWorktree: () => { throw new Error('no external mutation expected'); },
            initTrackJournal: () => { throw new Error('no external mutation expected'); },
            spawnSupervisor: () => { throw new Error('no external mutation expected'); },
            stopOwnSupervisor: () => { throw new Error('no external mutation expected'); },
            removeOwnedWorktree: () => { throw new Error('no external mutation expected'); },
            removeOwnedBranch: () => { throw new Error('no external mutation expected'); },
        };
    }

    function events(): Array<Record<string, unknown>> {
        if (!fs.existsSync(eventsPath(planRoot, BRANCH))) return [];
        return fs.readFileSync(eventsPath(planRoot, BRANCH), 'utf8').trim().split('\n')
            .filter(Boolean).map((line) => JSON.parse(line));
    }

    it('consume el marker antes que join y persiste fallback cohort-wide (TR-REQ-03, TR-REQ-04)', async () => {
        const state = declareCohort();
        state.tracks![0].joinRequested = true;
        writeJournal(planRoot, BRANCH, state);
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-teardown-request', 'b');
        consumePendingRequests(planRoot, BRANCH, 'g1');

        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(out.state.cohortPhase).toBe('FALLBACK_PENDING');
        expect(out.state.cohortFallbackReason).toBe('controller-requested:b');
        // La misma llamada cruza la frontera durable no destructiva que persiste el
        // teardownIntent del primer track; no llega a detener procesos ni borrar Git.
        expect(out.effectExecuted).toBe('begin-teardown');
        expect(out.state.tracks!.map((track) => track.phase)).toEqual([
            'TEARDOWN_INTENT', 'TEARDOWN_REQUESTED',
        ]);
        expect(out.state.tracks![0].joinRequested).toBe(true);
        expect(out.state.tracks![1].teardownRequested).toBeUndefined();
        expect(events()).toContainEqual(expect.objectContaining({
            kind: 'track-teardown-observed', trackId: 'b',
        }));
    });

    it('un marker sobreviviente a restart converge por el mismo reducer (TR-REQ-07)', async () => {
        const state = declareCohort();
        state.tracks![0].teardownRequested = true;
        writeJournal(planRoot, BRANCH, state);
        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(out.state.cohortPhase).toBe('FALLBACK_PENDING');
        expect(out.state.tracks![0].teardownRequested).toBeUndefined();
    });

    it.each(['SERIAL', 'COMPLETE'] as const)(
        'consume remove tardío como moot en %s (TR-REQ-09)',
        async (phase) => {
            const state = declareCohort(phase);
            for (const track of state.tracks!) {
                track.phase = phase === 'SERIAL' ? 'REMOVED' : 'JOINED';
                track.frozenHeadSha = phase === 'COMPLETE' ? baseSha : undefined;
            }
            state.tracks![0].teardownRequested = true;
            writeJournal(planRoot, BRANCH, state);
            const out = await reconcileTracks(planRoot, BRANCH, state, inertRuntime(), 2);
            expect(out.state.cohortPhase).toBe(phase);
            expect(out.state.tracks![0].teardownRequested).toBeUndefined();
            expect(events()).toContainEqual(expect.objectContaining({
                kind: 'track-teardown-moot', trackId: 'a', phase,
            }));
        },
    );
});
```

- [ ] **Step 2: Run the new suite and confirm RED**

Run:

```bash
cd cli
npx jest tests/commands/watch/track-remove-request.test.ts --runInBand
```

Expected: the first two tests fail because `reconcileTracks` does not consume `teardownRequested`; terminal tests fail because no moot event is emitted.

- [ ] **Step 3: Implement marker reconciliation ahead of join handling**

Insert this block before `pendingJoin` in `reconcileTracks`:

```ts
const pendingTeardown = (s.tracks ?? []).find((track) => track.teardownRequested === true);
if (pendingTeardown !== undefined) {
    const terminal = s.cohortPhase === 'SERIAL' || s.cohortPhase === 'COMPLETE';
    const protocolBefore = toProtocol(s, maxParallel);
    const observed = reconcileProtocol(protocolBefore, {
        kind: 'teardown-requested', trackId: pendingTeardown.trackId,
    });
    const next = applyProtocolToState(s, observed);
    for (const track of next.tracks ?? []) {
        if (track.trackId === pendingTeardown.trackId) track.teardownRequested = undefined;
    }
    s = persist(planRoot, branch, next);
    appendEvent(planRoot, branch, terminal
        ? { kind: 'track-teardown-moot', trackId: pendingTeardown.trackId, phase: s.cohortPhase }
        : { kind: 'track-teardown-observed', trackId: pendingTeardown.trackId, phase: s.cohortPhase });
    continue;
}
```

Do not call `runBeginTeardown` from this block. The following `nextProtocolEffect` iteration must select `begin-teardown`, preserving the existing one-authority path and crash boundaries.

- [ ] **Step 4: Run reconciliation and existing teardown crash suites**

Run:

```bash
cd cli
npx jest tests/commands/watch/track-remove-request.test.ts tests/commands/watch/track-teardown-crash.test.ts tests/core/tracks/teardown.test.ts --runInBand
```

Expected: all suites pass. Existing crash tests prove the driver resumes every destructive boundary and blocks foreign ownership; the new suite proves the request reaches that existing path.

- [ ] **Step 5: Commit the reconciler bridge**

```bash
git add cli/src/commands/watch/tracks.ts cli/tests/commands/watch/track-remove-request.test.ts
git commit -m "feat(track): reconcile requested cohort teardown"
```

### Task 4: Publish the supported CLI contract and verify end to end

_Requirements: TR-REQ-04, TR-REQ-05, TR-REQ-06, TR-REQ-07, TR-REQ-08, TR-REQ-09, TR-REQ-10_

**Files:**
- Modify: `cli/src/commands/track/index.ts:108-127`
- Modify: `cli/tests/commands/track/verbs.test.ts:80-105`
- Modify: `docs/cli-reference.md:691-710`
- Modify: `docs/guides/parallel-tracks.md:12-33`
- Modify: `docs/guides/parallel-tracks.md:70-86`
- Modify: `cli/README.md:64-76`

**Skills:** test-driven-development

- [ ] **Step 1: Add a RED help-contract assertion**

Add a focused test to `verbs.test.ts`:

```ts
test('remove se anuncia como cancelación request-only soportada (TR-REQ-10)', async () => {
    const out = await runCli(repo, ['track', 'remove', '--help']);
    expect(out.exitCode).toBe(0);
    expect(out.out).toContain('cancela la cohorte');
    expect(out.out).not.toContain('NO IMPLEMENTADO');
});
```

- [ ] **Step 2: Run the help test and confirm RED**

Run:

```bash
cd cli
npx jest tests/commands/track/verbs.test.ts --runInBand
```

Expected: the new assertion fails because the command still advertises `NO IMPLEMENTADO`.

- [ ] **Step 3: Update CLI help and operator documentation**

Replace the obsolete comment and description in `track/index.ts` with:

```ts
// Request-only: el supervisor persiste la intención, cancela la cohorte completa y
// reutiliza el teardown fail-closed antes de volver a ejecución serial.
track.command('remove')
    .description('emite track-teardown-request — cancela la cohorte y solicita teardown seguro antes del fallback serial')
```

Update the public docs with these exact semantics:

```markdown
| `remove <trackId>` | Emit a teardown request. The supervisor cancels the complete cohort, removes only demonstrably owned resources, and returns to serial execution only after teardown finishes. |
```

```markdown
| `awm track remove` (controller-requested teardown) | ✅ Verified | Request-to-protocol tests plus the existing crash-recovery and ownership-proof teardown suites. |
```

Add `awm track remove <id> --generation "$GEN"` to the guide workflow and state adjacent to it that cancellation applies to the complete cohort, preserves foreign or unprovable resources as `BLOCKED`, and is a request rather than a synchronous deletion. Add one sentence with the same contract to `cli/README.md`.

- [ ] **Step 4: Run focused feature verification**

Run:

```bash
cd cli
npx jest tests/core/journal/types.test.ts tests/commands/watch/apply.test.ts tests/core/tracks/protocol.test.ts tests/commands/watch/track-remove-request.test.ts tests/commands/watch/track-teardown-crash.test.ts tests/core/tracks/teardown.test.ts tests/commands/track/verbs.test.ts --runInBand
npm run typecheck
```

Expected: all selected suites pass and TypeScript exits 0.

- [ ] **Step 5: Run repository quality gates**

Run from `cli/`:

```bash
npm test -- --runInBand
npm run lint
npm run depcheck
npm run build
```

Expected: Jest reports no failed suite or test; lint, dependency-cruiser, and TypeScript build each exit 0. The release-only `native:package-check` is not a local gate because it requires every target in the release prebuild matrix, while this work changes no native source.

Run from the repository root, not `cli/`, so AWM resolves the root `.awm/`:

```bash
awm sensors run
```

Expected: the configured sensor gate reports pass.

- [ ] **Step 6: Check the diff for stale unsupported-contract language**

Run:

```bash
rg -n "NO IMPLEMENTADO|supervisor does not yet know how to apply|track remove.*Not implemented" cli/src/commands/track docs/cli-reference.md docs/guides/parallel-tracks.md cli/README.md
git diff --check
```

Expected: `rg` returns no match and `git diff --check` returns no output.

- [ ] **Step 7: Commit documentation and verified contract**

```bash
git add cli/src/commands/track/index.ts cli/tests/commands/track/verbs.test.ts docs/cli-reference.md docs/guides/parallel-tracks.md cli/README.md docs/plans/2026-09-05-track-remove-design.md docs/plans/2026-09-05-track-remove.md
git commit -m "docs(track): publish supported remove workflow"
```

## Traceability matrix

| Requirement | Task(s) | Test or evidence |
|---|---|---|
| TR-REQ-01 | Task 1 | `track-teardown-request persiste intención sin mover fases`; `TrackRef valida teardownRequested como boolean opcional` |
| TR-REQ-02 | Task 1 | `track-teardown-request rechaza %s sin mutar protocolo` |
| TR-REQ-03 | Tasks 2, 3 | `remove cancela toda la cohorte activa`; `consume el marker antes que join y persiste fallback cohort-wide` |
| TR-REQ-04 | Tasks 3, 4 | New reconciler test plus existing `track-teardown-crash.test.ts` and `teardown.test.ts` in the focused verification command |
| TR-REQ-05 | Tasks 2, 3, 4 | `remove cancela toda la cohorte activa y conserva DECLARED/BLOCKED`; existing ownership-proof teardown suites |
| TR-REQ-06 | Tasks 2, 4 | `remove converge a serial solo después de desmontar la cohorte`; full protocol suite |
| TR-REQ-07 | Tasks 1, 3, 4 | `un marker sobreviviente a restart converge`; existing destructive-boundary crash suite |
| TR-REQ-08 | Tasks 2, 3, 4 | `remove repetido no rebobina teardown ni reemplaza la causa`; focused feature verification |
| TR-REQ-09 | Tasks 2, 3, 4 | Protocol terminal-state parameterized test; reconciler `track-teardown-moot` parameterized test |
| TR-REQ-10 | Task 4 | `remove se anuncia como cancelación request-only soportada`; phrase-specific stale-language scan |
