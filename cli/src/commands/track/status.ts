// Agregado read-only de status por track (R9.5, R9.6): el journal del PLAN
// jamas espeja el estado de los journals de track — cada consulta lee el
// journal observado del track AL MOMENTO de necesitarlo y compone su gate,
// sin escribir nada de vuelta al plan journal.
import { computeFingerprint } from '../../core/journal/fingerprint';
import { readJournal } from '../../core/journal/store';
import type { JournalState, TrackRef } from '../../core/journal/types';
import { TRACK_PHASES } from '../../core/tracks/types';
import { computeTrackGate, FingerprintNow, GateResult } from '../job/gate';

/** Espejo de `realFingerprintNow` (cli/src/commands/job/index.ts) pero
 *  cerrado sobre el worktree OBSERVADO del track, no sobre el repo desde el
 *  que corre el comando `awm track status` (que es el del plan). */
export function fingerprintFor(worktreePath: string): FingerprintNow {
    return (argv, paths, cwd) => {
        try { return computeFingerprint(worktreePath, argv, paths, cwd).fingerprint; }
        catch { return null; }
    };
}

/** String de DISPLAY para un humano corriendo `awm track status` — no es
 *  input de ninguna decision de protocolo (esa vive en tracks/protocol.ts).
 *  Reporta el cuello de botella: cualquier track BLOCKED domina el mensaje;
 *  si no hay ninguno, se muestra la fase MENOS avanzada segun el orden
 *  canonico de TRACK_PHASES (la que atrasa a la cohorte) y cuantos tracks
 *  comparten esa fase. */
export function deriveCohortPhase(tracks: TrackRef[]): string {
    if (tracks.length === 0) return 'sin tracks declarados';
    const blocked = tracks.filter((t) => t.phase === 'BLOCKED');
    if (blocked.length > 0) {
        return `BLOCKED: ${blocked.map((t) => t.trackId).sort().join(', ')}`;
    }
    const rank = (phase: TrackRef['phase']): number => TRACK_PHASES.indexOf(phase);
    const bottleneck = tracks.reduce((min, t) => (rank(t.phase) < rank(min.phase) ? t : min));
    const atBottleneck = tracks.filter((t) => t.phase === bottleneck.phase).length;
    return `${bottleneck.phase} (${atBottleneck}/${tracks.length})`;
}

export interface AggregatedTrackStatus {
    cohort: string;
    tracks: Record<string, { phase: string; gate: GateResult }>;
}

/** `planRoot` no se usa para leer el journal del PLAN (ese ya se leyo antes
 *  de llamar aca) — se recibe por simetria con la firma del plan y para que
 *  el llamador no tenga que reconstruirla; cada TrackRef ya trae su propio
 *  `worktreePath`/`branch` absolutos (R9.2), que es lo que efectivamente se
 *  lee. Un journal de track que no puede leerse (corrupto o ausente) nunca
 *  se descarta en silencio: su gate sale rojo con categoria `corrupt-state`,
 *  igual que cualquier otra corrupcion en este codebase (R1.6). */
export function aggregateTrackStatus(planRoot: string, plan: JournalState): AggregatedTrackStatus {
    const refs = plan.tracks ?? [];
    const tracks: AggregatedTrackStatus['tracks'] = {};
    for (const ref of refs) {
        const observed = readJournal(ref.worktreePath, ref.branch);
        tracks[ref.trackId] = {
            phase: ref.phase,
            gate: computeTrackGate(observed.state, observed.corrupt, fingerprintFor(ref.worktreePath)),
        };
    }
    return { cohort: deriveCohortPhase(refs), tracks };
}
