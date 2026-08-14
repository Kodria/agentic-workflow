import { observeDetector } from './evidence';
import { evaluateCoverage, type CoverageClassResult, type IndexedDetectorObservation } from './evaluate';
import { resolveCoverageInputs, type CoverageInputs } from './resolve';
import { resolveLiveCompatibility } from '../compatibility/live';
import { legacyCompatibility } from '../compatibility/manifest';
import type { CompatibilityEvidence } from '../compatibility/types';

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
    empirical?: unknown;
};

type Dependencies = {
    resolve: (cwd: string) => CoverageInputs | Promise<CoverageInputs>;
    observe: typeof observeDetector;
    resolveLive: typeof resolveLiveCompatibility;
};

const defaults: Dependencies = { resolve: resolveCoverageInputs, observe: observeDetector, resolveLive: resolveLiveCompatibility };

/** Build static coverage data only: no command execution and no writes. */
export async function runCoverage(cwd: unknown, dependencies: Partial<Dependencies> = {}): Promise<CoverageEnvelope> {
    if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('runCoverage: cwd must be a non-empty string');
    const deps = { ...defaults, ...dependencies };
    const input = await deps.resolve(cwd);
    if (input.kind === 'not_configured') {
        return { schemaVersion: 2, pack: null, registry: null, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'not_configured', classes: [] } };
    }
    if (input.kind === 'no_reference') {
        return { schemaVersion: 2, pack: input.pack, registry: input.registry, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'no_reference', classes: [] } };
    }

    let live: Record<string, CompatibilityEvidence>;
    if (input.manifest.kind === 'v2') {
        live = (await deps.resolveLive(input.projectRoot, input.pack, input.manifest.pack.registryRoot)).sensors;
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
    return {
        schemaVersion: 2, pack: input.pack, registry: input.registry, overall: evaluated.overall,
        static: { status: evaluated.overall, reason: null, classes: evaluated.classes },
    };
}
