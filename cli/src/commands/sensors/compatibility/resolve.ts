import semver from 'semver';
import { legacyCompatibility } from './manifest';
import type { CompatibilityEvidence, SensorPackSensor, SensorVariant } from './types';

type ResolveEvidence = { paths?: string[]; applicable?: boolean; packageManagerConflict?: boolean; toolVersion?: string | null; runtimeVersion?: string | null; probe?: { status?: string } };

function result(state: CompatibilityEvidence['state'], reason: string, variant: SensorVariant | null, evidence: ResolveEvidence): CompatibilityEvidence {
    return { state, reason, variantId: variant?.id ?? null, toolVersion: evidence.toolVersion ?? null, runtimeVersion: evidence.runtimeVersion ?? null, certifiedRange: variant?.certifiedRange ?? null, evidence: [] };
}
function applies(sensor: SensorPackSensor, evidence: ResolveEvidence): boolean {
    if (evidence.applicable === false) return false;
    const paths = new Set(evidence.paths ?? []);
    const rule = sensor.applicability;
    return (!rule.allFiles || rule.allFiles.every(file => paths.has(file))) && (!rule.anyFiles || rule.anyFiles.some(file => paths.has(file)));
}
function specificity(variant: SensorVariant): number {
    return variant.requirements.toolRange.length + variant.requirements.runtimeRange.length + (variant.requirements.configFiles?.length ?? 0);
}
function validVersion(value: string | null | undefined): value is string { return typeof value === 'string' && semver.valid(value) !== null; }

/** Pure precedence resolver. It consumes discovered evidence and neither probes nor executes commands. */
export function resolveSensorCompatibility(sensor: SensorPackSensor | Record<string, unknown>, evidence: ResolveEvidence): CompatibilityEvidence {
    if (!sensor || typeof sensor !== 'object' || !evidence || typeof evidence !== 'object') throw new Error('sensor and discovered evidence are required');
    if (!('variants' in sensor)) return legacyCompatibility('legacy pack without schemaVersion');
    const v2 = sensor as SensorPackSensor;
    if (!Array.isArray(v2.variants) || !v2.applicability) throw new Error('v2 sensor must declare variants and applicability');
    if (!applies(v2, evidence)) return result('not-applicable', 'applicability-not-met', null, evidence);
    if (evidence.packageManagerConflict) return result('unverifiable', 'package-manager-conflict', null, evidence);
    if (evidence.toolVersion === null || evidence.toolVersion === undefined) return result('missing-tool', 'tool-not-found', null, evidence);
    if (!validVersion(evidence.toolVersion) || !validVersion(evidence.runtimeVersion)) return result('unverifiable', 'invalid-or-missing-version-evidence', null, evidence);
    const matches = v2.variants.filter(variant => semver.satisfies(evidence.toolVersion!, variant.requirements.toolRange) && semver.satisfies(evidence.runtimeVersion!, variant.requirements.runtimeRange));
    if (matches.length === 0) return result('incompatible', 'no-operational-variant', null, evidence);
    matches.sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a) || a.id.localeCompare(b.id));
    const best = matches[0];
    const tied = matches.filter(variant => variant.priority === best.priority && specificity(variant) === specificity(best));
    if (tied.length !== 1) throw new Error(`ambiguous sensor variants: ${tied.map(variant => variant.id).sort().join(', ')}`);
    if (evidence.probe?.status !== 'matched') return result('unverifiable', evidence.probe?.status === 'not-matched' ? 'probe-not-matched' : 'probe-inconclusive', best, evidence);
    return semver.satisfies(evidence.toolVersion, best.certifiedRange)
        ? result('certified', 'range-and-probe', best, evidence)
        : result('compatible-unverified', 'operational-range-and-probe', best, evidence);
}
