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
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 'unobservable';
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
