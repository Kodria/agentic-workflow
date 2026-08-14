import semver from 'semver';
import { legacyCompatibility } from './manifest';
import type { CompatibilityEvidence, SensorPack, SensorPackSensor, SensorVariant } from './types';
import type { ProjectEvidence } from './discovery';

export type ResolveEvidence = { paths?: string[]; applicable?: boolean; packageManagerConflict?: boolean; toolVersion?: string | null; runtimeVersion?: string | null; toolVersions?: Record<string, string | null>; runtimeVersions?: Record<string, string | null>; os?: NodeJS.Platform; probe?: { status?: string } };
export type ResolveContext = { pack: string; sensor: string };

function result(state: CompatibilityEvidence['state'], reason: string, variant: SensorVariant | null, evidence: ResolveEvidence): CompatibilityEvidence {
    const toolVersion = (variant ? toolFor(variant, evidence) : evidence.toolVersion) ?? null;
    const runtimeVersion = (variant ? runtimeFor(variant, evidence) : evidence.runtimeVersion) ?? null;
    const refs: CompatibilityEvidence['evidence'] = [];
    for (const candidate of (evidence.paths ?? []).slice(0, 32)) {
        if (typeof candidate === 'string' && candidate.length <= 240 && !candidate.startsWith('/') && !candidate.includes('\\') && !candidate.split('/').some(part => part === '' || part === '.' || part === '..')) refs.push({ kind: 'project-path', status: 'present', path: candidate });
    }
    if (evidence.packageManagerConflict) refs.push({ kind: 'package-manager', status: 'conflict' });
    if (variant && validVersion(toolVersion)) refs.push({ kind: 'tool-version', status: toolVersion });
    if (variant && validVersion(runtimeVersion)) refs.push({ kind: 'runtime-version', status: runtimeVersion });
    if (evidence.probe?.status === 'matched' || evidence.probe?.status === 'not-matched' || evidence.probe?.status === 'unverifiable') refs.push({ kind: 'probe', status: evidence.probe.status });
    return { state, reason, variantId: variant?.id ?? null, toolVersion, runtimeVersion, certifiedRange: variant?.certifiedRange ?? null, evidence: refs.slice(0, 32) };
}
function applies(sensor: SensorPackSensor, evidence: ResolveEvidence): boolean {
    if (sensor.applicability.kind === 'explicit-or-supported-language') return evidence.applicable === true;
    if (evidence.applicable === false) return false;
    const paths = new Set(evidence.paths ?? []);
    const rule = sensor.applicability;
    return (!rule.allFiles || rule.allFiles.every(file => paths.has(file))) && (!rule.anyFiles || rule.anyFiles.some(file => paths.has(file)));
}
function specificity(variant: SensorVariant): number {
    return variant.requirements.toolRange.length + variant.requirements.runtimeRange.length + (variant.requirements.configFiles?.length ?? 0);
}
function validVersion(value: string | null | undefined): value is string { return typeof value === 'string' && semver.valid(value) !== null; }
function toolFor(variant: SensorVariant, evidence: ResolveEvidence): string | null | undefined {
    return evidence.toolVersions === undefined ? evidence.toolVersion : evidence.toolVersions[variant.requirements.tool];
}
function runtimeFor(variant: SensorVariant, evidence: ResolveEvidence): string | null | undefined {
    return evidence.runtimeVersions === undefined ? evidence.runtimeVersion : evidence.runtimeVersions[variant.requirements.runtime];
}

/** Pure precedence resolver. It consumes discovered evidence and neither probes nor executes commands. */
export function resolveSensorCompatibility(sensor: SensorPackSensor | Record<string, unknown>, evidence: ResolveEvidence, context: ResolveContext): CompatibilityEvidence {
    if (!sensor || typeof sensor !== 'object' || !evidence || typeof evidence !== 'object') throw new Error('sensor and discovered evidence are required');
    if (!context || typeof context.pack !== 'string' || !context.pack.trim() || typeof context.sensor !== 'string' || !context.sensor.trim()) throw new Error('pack and sensor identity are required for compatibility resolution');
    if (!('variants' in sensor)) return legacyCompatibility('legacy pack without schemaVersion');
    const v2 = sensor as SensorPackSensor;
    if (!Array.isArray(v2.variants) || !v2.applicability) throw new Error('v2 sensor must declare variants and applicability');
    if (!applies(v2, evidence)) return result('not-applicable', 'applicability-not-met', null, evidence);
    if (evidence.packageManagerConflict) return result('unverifiable', 'package-manager-conflict', null, evidence);
    const availableTools = v2.variants.map(variant => toolFor(variant, evidence));
    if (availableTools.every(version => version === null || version === undefined)) return result('missing-tool', 'tool-not-found', null, evidence);
    const operational = v2.variants.filter(variant => validVersion(toolFor(variant, evidence)) && validVersion(runtimeFor(variant, evidence)));
    if (operational.length === 0) return result('unverifiable', 'invalid-or-missing-version-evidence', null, evidence);
    const matches = operational.filter(variant => semver.satisfies(toolFor(variant, evidence)!, variant.requirements.toolRange) && semver.satisfies(runtimeFor(variant, evidence)!, variant.requirements.runtimeRange));
    if (matches.length === 0) return result('incompatible', 'no-operational-variant', null, evidence);
    matches.sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a) || a.id.localeCompare(b.id));
    const best = matches[0];
    const tied = matches.filter(variant => variant.priority === best.priority && specificity(variant) === specificity(best));
    if (tied.length !== 1) {
        const matching = tied.sort((a, b) => a.id.localeCompare(b.id)).map(variant => `${variant.id} (tool ${variant.requirements.toolRange}, runtime ${variant.requirements.runtimeRange})`).join(', ');
        throw new Error(`ambiguous sensor variants in pack "${context.pack}" sensor "${context.sensor}": ${matching}`);
    }
    if (evidence.probe?.status !== 'matched') return result('unverifiable', evidence.probe?.status === 'not-matched' ? 'probe-not-matched' : 'probe-inconclusive', best, evidence);
    return semver.satisfies(toolFor(best, evidence)!, best.certifiedRange)
        ? result('certified', 'range-and-probe', best, evidence)
        : result('compatible-unverified', 'operational-range-and-probe', best, evidence);
}

/** Adapt bounded local project discovery into one source-aware resolution per sensor. */
export function resolveProjectCompatibility(pack: SensorPack, evidence: ProjectEvidence | ResolveEvidence): { sensors: Record<string, CompatibilityEvidence> } {
    if (!pack || typeof pack !== 'object' || typeof pack.name !== 'string') throw new Error('pack must be a parsed sensor pack');
    const sensors: Record<string, CompatibilityEvidence> = {};
    if (!('schemaVersion' in pack)) {
        for (const name of Object.keys(pack.sensors)) sensors[name] = legacyCompatibility('legacy pack without schemaVersion');
        return { sensors };
    }
    for (const [name, sensor] of Object.entries(pack.sensors)) {
        sensors[name] = resolveSensorCompatibility(sensor, evidence, { pack: pack.name, sensor: name });
    }
    return { sensors };
}
