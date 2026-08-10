// Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): `decideTeardown` YA vive en
// `protocol.ts` (autoridad única de decisión) — este módulo NO crea una
// segunda copia (mismo criterio que `join.ts` con `decideJoinReconciliation`,
// T11). `teardown.test.ts` prueba la matriz completa IMPORTANDO este
// re-export, así que cualquier fix que descubra tiene que vivir en
// `protocol.ts` (y volver a correr la exploración de T1 en el mismo commit)
// para que el gate siga significando algo.
//
// Lo que SÍ aporta este archivo es la única prueba de OWNERSHIP real que
// `tracks.ts` necesita antes de siquiera considerar `remove-owned-worktree`
// como decisión segura: cuatro condiciones simultáneas (R4.10) —
//   1. `teardownIntent.worktreePath` (snapshot durable tomado en
//      `TEARDOWN_REQUESTED` -> `TEARDOWN_INTENT`) resuelve al MISMO target
//      canónico que `ref.worktreePath` (el dato vivo del journal).
//   2. `teardownIntent.branch === ref.branch`.
//   3. `.awm/track.json` del worktree (`readDescriptor`) coincide en
//      `planJournalId`/`trackId`/`fencingToken` — la identidad completa que
//      el propio track escribió al armarse (Task 9), nunca reconstruida a
//      mano.
//   4. `git worktree list --porcelain` asocia ESE path exactamente con la
//      branch determinista del track (`ownedWorktreeExists`, ya construida
//      en Task 9 sobre el mismo criterio).
// Cualquier chequeo indemostrable (no existe, no legible, mismatch, fallo de
// git) es "ownership NO probado" — fail-closed (R4.6): el caller nunca
// adopta ni borra lo que no pudo probar.
import fs from 'fs';
import { readDescriptor } from './descriptor';
import { sameExistingPath } from '../paths';
import { ownedWorktreeExists } from './git';
import type { TrackRef } from '../journal/types';

export { decideTeardown } from './protocol';
export type { TeardownDecision, TeardownObservation } from './types';

export function worktreeOwnershipProven(repo: string, ref: TrackRef, planJournalId: string): boolean {
    const intent = ref.teardownIntent;
    if (intent === undefined) return false; // sin snapshot durable: nada que comparar, no probado
    // Identidad de filesystem, no de string (mismo motivo que en `ownedWorktreeExists`):
    // el snapshot durable del intent y el `TrackRef` vivo pueden traer dos grafías del
    // mismo path. `sameExistingPath` ya devuelve `false` si alguno no existe.
    if (!sameExistingPath(intent.worktreePath, ref.worktreePath)) return false;
    if (intent.branch !== ref.branch) return false;
    let descriptor;
    try {
        descriptor = readDescriptor(ref.worktreePath);
    } catch {
        return false; // track.json presente pero corrupto: indemostrable (R1.6/R4.6)
    }
    if (descriptor === null) return false;
    if (descriptor.planJournalId !== planJournalId || descriptor.trackId !== ref.trackId
        || descriptor.fencingToken !== ref.fencingToken) return false;
    return ownedWorktreeExists(repo, ref.worktreePath, ref.branch);
}
