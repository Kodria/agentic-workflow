import { observeDetector } from './evidence';
import { evaluateCoverage, type CoverageClassResult, type IndexedDetectorObservation } from './evaluate';
import { resolveCoverageInputs, type CoverageInputs } from './resolve';
import { resolveLiveCompatibility } from '../compatibility/live';
import { legacyCompatibility } from '../compatibility/manifest';
import type { CompatibilityEvidence } from '../compatibility/types';
import { scanProjectLedgers, type LedgerScanResult } from '../../../core/ledger/scan';
import { evaluateEmpiricalCoverage, type EmpiricalCoverage, type EmpiricalStaticAvailability, type EmpiricalStaticState } from './empirical';
import path from 'path';

export type CoverageEnvelope = {
    schemaVersion: 2;
    pack: string | null;
    registry: string | null;
    overall: 'covered' | 'gaps' | 'inconclusive';
    static: {
        status: 'covered' | 'gaps' | 'inconclusive';
        reason: null | 'not_configured' | 'no_reference';
        classes: CoverageClassResult[];
    };
    empirical?: EmpiricalCoverage;
};

type Dependencies = {
    resolve: (cwd: string) => CoverageInputs | Promise<CoverageInputs>;
    observe: typeof observeDetector;
    resolveLive: typeof resolveLiveCompatibility;
    scan: (projectRoot: string) => LedgerScanResult;
};

const defaults: Dependencies = { resolve: resolveCoverageInputs, observe: observeDetector, resolveLive: resolveLiveCompatibility, scan: scanProjectLedgers };

export type CoverageOptions = { min?: number };

function normalizedMin(value: unknown): number {
    if (value === undefined) return 2;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('runCoverage: min must be a positive safe integer');
    return value;
}

function empirical(
    deps: Dependencies,
    projectRoot: string,
    states: Readonly<Record<string, EmpiricalStaticState>>,
    min: number,
    staticAvailability: EmpiricalStaticAvailability = 'available',
): EmpiricalCoverage {
    return evaluateEmpiricalCoverage(deps.scan(projectRoot), states, min, staticAvailability);
}

/** Build static coverage data only: no command execution and no writes. */
export async function runCoverage(cwd: unknown, dependencies: Partial<Dependencies> = {}, options: CoverageOptions = {}): Promise<CoverageEnvelope> {
    if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('runCoverage: cwd must be a non-empty string');
    const min = normalizedMin(options.min);
    const deps = { ...defaults, ...dependencies };
    const input = await deps.resolve(cwd);
    if (input.kind === 'not_configured') {
        return { schemaVersion: 2, pack: null, registry: null, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'not_configured', classes: [] },
            empirical: empirical(deps, path.resolve(cwd), {}, min, 'unavailable') };
    }
    if (input.kind === 'no_reference') {
        return { schemaVersion: 2, pack: input.pack, registry: input.registry, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'no_reference', classes: [] },
            empirical: empirical(deps, input.projectRoot, {}, min, 'unavailable') };
    }

    let live: Record<string, CompatibilityEvidence>;
    if (input.manifest.kind !== 'legacy') {
        live = (await deps.resolveLive(input.projectRoot, input.pack, input.registryRoot)).sensors;
    } else {
        live = Object.fromEntries(Object.keys(input.manifest.pack.sensors).map((name) => [name, legacyCompatibility('legacy manifest without schemaVersion')]));
    }

    const observations: IndexedDetectorObservation[] = [];
    for (const [classId, coverageClass] of Object.entries(input.contract.classes)) {
        coverageClass.detectors.forEach((detector, detectorIndex) => {
            const observed = deps.observe(
                input.projectRoot, classId, detectorIndex, detector, input.manifest.pack.sensors[detector.sensor],
            );
            observations.push({
                ...observed,
                compatibility: live[detector.sensor] ?? {
                    state: 'unverifiable', reason: 'sensor-not-resolved', variantId: null,
                    toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [],
                },
            });
        });
    }
    const evaluated = evaluateCoverage(input.contract, observations);
    const states = Object.fromEntries(evaluated.classes.map((entry) => [entry.id, entry.status]));
    return {
        schemaVersion: 2, pack: input.pack, registry: input.registry, overall: evaluated.overall,
        static: { status: evaluated.overall, reason: null, classes: evaluated.classes },
        empirical: empirical(deps, input.projectRoot, states, min),
    };
}
