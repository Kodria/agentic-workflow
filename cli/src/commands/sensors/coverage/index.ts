import { observeDetector } from './evidence';
import { evaluateCoverage, type CoverageClassResult, type IndexedDetectorObservation } from './evaluate';
import { resolveCoverageInputs, type CoverageInputs } from './resolve';

export type CoverageEnvelope = {
    schemaVersion: 1;
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
    resolve: (cwd: string) => CoverageInputs;
    observe: typeof observeDetector;
};

const defaults: Dependencies = { resolve: resolveCoverageInputs, observe: observeDetector };

/** Build static coverage data only: no command execution and no writes. */
export function runCoverage(cwd: unknown, dependencies: Partial<Dependencies> = {}): CoverageEnvelope {
    if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('runCoverage: cwd must be a non-empty string');
    const deps = { ...defaults, ...dependencies };
    const input = deps.resolve(cwd);
    if (input.kind === 'not_configured') {
        return { schemaVersion: 1, pack: null, registry: null, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'not_configured', classes: [] } };
    }
    if (input.kind === 'no_reference') {
        return { schemaVersion: 1, pack: input.pack, registry: input.registry, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'no_reference', classes: [] } };
    }

    const observations: IndexedDetectorObservation[] = [];
    for (const [classId, coverageClass] of Object.entries(input.contract.classes)) {
        coverageClass.detectors.forEach((detector, detectorIndex) => {
            observations.push(deps.observe(
                input.projectRoot, classId, detectorIndex, detector, input.manifest.sensors[detector.sensor],
            ));
        });
    }
    const evaluated = evaluateCoverage(input.contract, observations);
    return {
        schemaVersion: 1, pack: input.pack, registry: input.registry, overall: evaluated.overall,
        static: { status: evaluated.overall, reason: null, classes: evaluated.classes },
    };
}
