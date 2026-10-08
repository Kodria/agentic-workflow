import type { SensorConfig, SensorManifest } from '../types';
import type { CompatibilityEvidence, SensorPackSensor, StructuredCommand } from './types';
import { parseStructuredCommand } from './contract';
import { positiveTimeout } from './timeout';
import semver from 'semver';
import path from 'path';

type UnknownRecord = Record<string, unknown>;

export type SensorManifestV2 = {
    schemaVersion: 2;
    pack: string;
    /** Durable operator intent. Absent means detected/fallback, never explicit. */
    packSelection?: 'explicit';
    registryRoot?: string;
    /** Contained relative path from this manifest's directory to the actual
     *  project root (package.json/tsconfig/etc) sensors should detect against
     *  and execute in. Absent means the manifest's own directory — unchanged
     *  behavior for a single-package repo. Exists for a monorepo where the
     *  manifest lives at the repo root but the real package lives in a
     *  subdirectory (e.g. "cli"). */
    packageRoot?: string;
    sensors: Record<string, { enabled: boolean; fast?: boolean; timeout?: number; variantId: string; command: StructuredCommand; assets?: string[]; policyRef?: 'shared/semgrep-policy.json'; initializedCompatibility: CompatibilityEvidence }>;
    concurrency?: number;
};

/** Registered CLI formatter ids plus exit-code (default for project-declared sensors). */
const PROJECT_FORMATTERS = new Set([
    'tsc', 'eslint-llm', 'semgrep', 'test', 'mypy', 'ruff', 'shellcheck', 'generic', 'exit-code',
]);

export type PackBoundManifestSensor = SensorManifestV2['sensors'][string];

export type ProjectDeclaredSensor = {
    source: 'project';
    enabled: boolean;
    command: StructuredCommand;
    formatter: string;
    fast?: boolean;
    timeout?: number;
    assets?: string[];
    applicability?: SensorPackSensor['applicability'];
    description?: string;
};

export type V3ManifestSensor = PackBoundManifestSensor | ProjectDeclaredSensor;

export type SensorManifestV3ProjectSensors = {
    schemaVersion: 3;
    mode: 'project-sensors';
    pack?: string | null;
    packSelection?: 'explicit';
    /** Required only when pack is a nonempty string. */
    source?: { registry: string };
    packageRoot?: string;
    sensors: Record<string, V3ManifestSensor>;
    concurrency?: number;
};

/** Pack-bound v3 project-sensors (non-null pack + registry source; no project entries). */
export type PackBoundProjectSensorsManifest = SensorManifestV3ProjectSensors & {
    pack: string;
    source: { registry: string };
    sensors: Record<string, PackBoundManifestSensor>;
};

export function isProjectDeclaredSensor(sensor: V3ManifestSensor): sensor is ProjectDeclaredSensor {
    return 'source' in sensor && (sensor as ProjectDeclaredSensor).source === 'project';
}

export function isPackBoundManifestSensor(sensor: V3ManifestSensor): sensor is PackBoundManifestSensor {
    return !isProjectDeclaredSensor(sensor);
}

/** Narrow a parsed v3 manifest to the pack-bound shape expected by migrate/materialize. */
export function asPackBoundProjectSensors(manifest: SensorManifestV3ProjectSensors): PackBoundProjectSensorsManifest {
    if (typeof manifest.pack !== 'string' || manifest.pack.length === 0 || !manifest.source) {
        throw new Error('project-sensors manifest requires a nonempty pack and source.registry');
    }
    for (const [name, sensor] of Object.entries(manifest.sensors)) {
        if (isProjectDeclaredSensor(sensor)) {
            throw new Error(`sensors.${name} is project-declared; pack-bound operation required`);
        }
    }
    return manifest as PackBoundProjectSensorsManifest;
}

export type SensorManifestV3NativeGate = { schemaVersion: 3; mode: 'native-gate'; reason: string };
export type SensorManifestV3OptOut = { schemaVersion: 3; mode: 'opt-out'; reason: string };
export type SensorManifestV3 = SensorManifestV3ProjectSensors | SensorManifestV3NativeGate | SensorManifestV3OptOut;

export type LegacySensorManifest = SensorManifest & { compatibility: CompatibilityEvidence };
export type ParsedSensorManifest =
    | { kind: 'legacy'; pack: LegacySensorManifest }
    | { kind: 'v2'; pack: SensorManifestV2 }
    | { kind: 'v3'; pack: SensorManifestV3 };

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceSuffix(source: unknown): string {
    return typeof source === 'string' && source.length > 0 && !/[\0\r\n]/.test(source) ? ` in ${source}` : ' in <unknown source>';
}

function invalid(source: unknown, message: string): never {
    throw new Error(`Invalid sensor manifest${sourceSuffix(source)}: ${message}`);
}

function record(value: unknown, source: unknown, location: string): UnknownRecord {
    if (!isRecord(value)) invalid(source, `${location} must be an object`);
    return value;
}

function fields(value: UnknownRecord, allowed: readonly string[], source: unknown, location: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) invalid(source, `${location} has unknown field "${key}"`);
    }
}

function text(value: unknown, source: unknown, location: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || /[\0\r\n]/.test(value)) {
        invalid(source, `${location} must be a nonempty single-line string without NUL`);
    }
    return value;
}

function id(value: unknown, source: unknown, location: string): string {
    const parsed = text(value, source, location);
    if (!/^[a-z][a-z0-9-]*$/.test(parsed)) invalid(source, `${location} must be a stable lowercase id`);
    return parsed;
}

function stringArray(value: unknown, source: unknown, location: string, allowEmpty: boolean): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        invalid(source, `${location} must be ${allowEmpty ? 'an array' : 'a nonempty array'}`);
    }
    return value.map((item, index) => text(item, source, `${location}[${index}]`));
}

function asset(value: unknown, source: unknown, location: string): string {
    const parsed = text(value, source, location);
    if (parsed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(parsed) || parsed.startsWith('\\\\') || parsed.includes('\\') || parsed.split('/').some(part => part === '' || part === '.' || part === '..')) invalid(source, `${location} must be a contained relative asset path`);
    return parsed;
}

const STATES = new Set<CompatibilityEvidence['state']>(['certified', 'compatible-unverified', 'incompatible', 'missing-tool', 'unverifiable', 'not-applicable']);

function nullableText(value: unknown, source: unknown, location: string): string | null {
    return value === null ? null : text(value, source, location);
}

function parseCompatibilityEvidence(input: unknown, source: unknown, location: string): CompatibilityEvidence {
    const value = record(input, source, location);
    fields(value, ['state', 'reason', 'variantId', 'toolVersion', 'runtimeVersion', 'certifiedRange', 'evidence'], source, location);
    if (typeof value.state !== 'string' || !STATES.has(value.state as CompatibilityEvidence['state'])) invalid(source, `${location}.state must be a supported state`);
    if (!Array.isArray(value.evidence)) invalid(source, `${location}.evidence must be an array`);
    const evidence = { state: value.state as CompatibilityEvidence['state'], reason: text(value.reason, source, `${location}.reason`), variantId: nullableText(value.variantId, source, `${location}.variantId`), toolVersion: nullableText(value.toolVersion, source, `${location}.toolVersion`), runtimeVersion: nullableText(value.runtimeVersion, source, `${location}.runtimeVersion`), certifiedRange: nullableText(value.certifiedRange, source, `${location}.certifiedRange`), evidence: value.evidence.map((entry, index) => { const item = record(entry, source, `${location}.evidence[${index}]`); fields(item, ['kind', 'status', 'path'], source, `${location}.evidence[${index}]`); return { kind: text(item.kind, source, `${location}.evidence[${index}].kind`), status: text(item.status, source, `${location}.evidence[${index}].status`), ...('path' in item ? { path: asset(item.path, source, `${location}.evidence[${index}].path`) } : {}) }; }) };
    if (evidence.toolVersion !== null && semver.valid(evidence.toolVersion) === null) invalid(source, `${location}.toolVersion must be a valid semver version`);
    if (evidence.runtimeVersion !== null && semver.valid(evidence.runtimeVersion) === null) invalid(source, `${location}.runtimeVersion must be a valid semver version`);
    if (evidence.certifiedRange !== null && semver.validRange(evidence.certifiedRange) === null) invalid(source, `${location}.certifiedRange must be a valid semver range`);
    return evidence;
}

export function legacyCompatibility(reason = 'legacy manifest without schemaVersion'): CompatibilityEvidence {
    if (typeof reason !== 'string' || reason.trim().length === 0 || /[\0\r\n]/.test(reason)) {
        throw new Error('legacy compatibility reason must be a nonempty single-line string without NUL');
    }
    return {
        state: 'compatible-unverified',
        reason,
        variantId: null,
        toolVersion: null,
        runtimeVersion: null,
        certifiedRange: null,
        evidence: [],
    };
}

function parseLegacySensor(input: unknown, source: unknown, location: string): SensorConfig {
    if (typeof input === 'string') return { cmd: text(input, source, `${location}.cmd`) };
    const value = record(input, source, location);
    if (value.source === 'project') {
        invalid(source, `${location}.source "project" requires schemaVersion 3; migrate-to-v3`);
    }
    fields(value, ['cmd', 'fast', 'enabled', 'timeout', 'changedCmd', 'changedExtensions', 'formatter'], source, location);
    const sensor: SensorConfig = {};
    if ('cmd' in value) sensor.cmd = text(value.cmd, source, `${location}.cmd`);
    if ('fast' in value) {
        if (typeof value.fast !== 'boolean') invalid(source, `${location}.fast must be a boolean`);
        sensor.fast = value.fast;
    }
    if ('enabled' in value) {
        if (typeof value.enabled !== 'boolean') invalid(source, `${location}.enabled must be a boolean`);
        sensor.enabled = value.enabled;
    }
    if ('timeout' in value) {
        try { sensor.timeout = positiveTimeout(value.timeout, `${location}.timeout`); }
        catch (error) { invalid(source, error instanceof Error ? error.message : `${location}.timeout must be a positive safe integer`); }
    }
    if ('changedCmd' in value) sensor.changedCmd = text(value.changedCmd, source, `${location}.changedCmd`);
    if ('changedExtensions' in value) sensor.changedExtensions = stringArray(value.changedExtensions, source, `${location}.changedExtensions`, true);
    if ('formatter' in value) sensor.formatter = text(value.formatter, source, `${location}.formatter`);
    return sensor;
}

function parseLegacyManifest(value: UnknownRecord, source: unknown): LegacySensorManifest {
    fields(value, ['pack', 'sensors', 'concurrency'], source, 'root');
    const pack = id(value.pack, source, 'pack');
    const sensorsInput = record(value.sensors, source, 'sensors');
    const sensors: Record<string, SensorConfig> = {};
    for (const name of Object.keys(sensorsInput)) sensors[id(name, source, 'sensor id')] = parseLegacySensor(sensorsInput[name], source, `sensors.${name}`);
    const manifest: LegacySensorManifest = { pack, sensors, compatibility: legacyCompatibility() };
    if ('concurrency' in value) {
        if (typeof value.concurrency !== 'number' || !Number.isSafeInteger(value.concurrency) || value.concurrency <= 0) invalid(source, 'concurrency must be a positive safe integer');
        manifest.concurrency = value.concurrency;
    }
    return manifest;
}

function parseApplicability(input: unknown, source: unknown, location: string): SensorPackSensor['applicability'] {
    const applicabilityInput = record(input, source, location);
    fields(applicabilityInput, ['allFiles', 'anyFiles', 'kind'], source, location);
    const applicability: SensorPackSensor['applicability'] = {};
    if ('allFiles' in applicabilityInput) {
        applicability.allFiles = stringArray(applicabilityInput.allFiles, source, `${location}.allFiles`, false)
            .map((file, index) => asset(file, source, `${location}.allFiles[${index}]`));
    }
    if ('anyFiles' in applicabilityInput) {
        applicability.anyFiles = stringArray(applicabilityInput.anyFiles, source, `${location}.anyFiles`, false)
            .map((file, index) => asset(file, source, `${location}.anyFiles[${index}]`));
    }
    if ('kind' in applicabilityInput) {
        const kind = text(applicabilityInput.kind, source, `${location}.kind`);
        if (kind !== 'explicit-or-supported-language' && kind !== 'explicit-opt-in') {
            invalid(source, `${location}.kind must be a supported applicability kind`);
        }
        applicability.kind = kind;
    }
    if (Object.keys(applicability).length === 0) invalid(source, `${location} must declare a condition`);
    return applicability;
}

function parseProjectSensor(input: unknown, source: unknown, location: string): ProjectDeclaredSensor {
    const value = record(input, source, location);
    if ('variantId' in value) invalid(source, `${location}.variantId is forbidden on source:"project" entries`);
    if ('initializedCompatibility' in value) invalid(source, `${location}.initializedCompatibility is forbidden on source:"project" entries`);
    fields(value, ['source', 'enabled', 'command', 'formatter', 'fast', 'timeout', 'assets', 'applicability', 'description'], source, location);
    if (value.source !== 'project') invalid(source, `${location}.source must be "project"`);
    if (typeof value.enabled !== 'boolean') invalid(source, `${location}.enabled must be a boolean`);
    const sensor: ProjectDeclaredSensor = {
        source: 'project',
        enabled: value.enabled,
        command: parseStructuredCommand(value.command, source),
        formatter: 'exit-code',
    };
    if ('formatter' in value) {
        const formatter = text(value.formatter, source, `${location}.formatter`);
        if (!PROJECT_FORMATTERS.has(formatter)) invalid(source, `${location}.formatter is not a registered formatter id`);
        sensor.formatter = formatter;
    }
    if ('assets' in value) {
        sensor.assets = stringArray(value.assets, source, `${location}.assets`, true)
            .map((entry, index) => asset(entry, source, `${location}.assets[${index}]`));
    }
    if ('applicability' in value) sensor.applicability = parseApplicability(value.applicability, source, `${location}.applicability`);
    if ('description' in value) sensor.description = text(value.description, source, `${location}.description`);
    if ('fast' in value) {
        if (typeof value.fast !== 'boolean') invalid(source, `${location}.fast must be a boolean`);
        sensor.fast = value.fast;
    }
    if ('timeout' in value) {
        try { sensor.timeout = positiveTimeout(value.timeout, `${location}.timeout`); }
        catch (error) { invalid(source, error instanceof Error ? error.message : `${location}.timeout must be a positive safe integer`); }
    }
    return sensor;
}

function parseV3SensorEntry(input: unknown, source: unknown, location: string): SensorManifestV3ProjectSensors['sensors'][string] {
    const value = record(input, source, location);
    if (value.source === 'project') return parseProjectSensor(value, source, location);
    const unmarkedCustom = !('variantId' in value) && !('initializedCompatibility' in value) && 'command' in value;
    if (unmarkedCustom) {
        invalid(source, `${location}.source is required for project-declared sensors; add source:"project"`);
    }
    return parseV2Sensor(input, source, location);
}

function parseV2Sensor(input: unknown, source: unknown, location: string): SensorManifestV2['sensors'][string] {
    const value = record(input, source, location);
    if (value.source === 'project') {
        invalid(source, `${location}.source "project" requires schemaVersion 3; migrate-to-v3`);
    }
    fields(value, ['enabled', 'fast', 'timeout', 'variantId', 'command', 'assets', 'policyRef', 'initializedCompatibility'], source, location);
    if (typeof value.enabled !== 'boolean') invalid(source, `${location}.enabled must be a boolean`);
    const sensor: SensorManifestV2['sensors'][string] = {
        enabled: value.enabled, variantId: id(value.variantId, source, `${location}.variantId`),
        command: parseStructuredCommand(value.command, source),
        initializedCompatibility: parseCompatibilityEvidence(value.initializedCompatibility, source, `${location}.initializedCompatibility`),
    };
    if (sensor.initializedCompatibility.variantId !== null && sensor.initializedCompatibility.variantId !== sensor.variantId) invalid(source, `${location}.initializedCompatibility.variantId must match variantId`);
    if (['certified', 'compatible-unverified', 'incompatible'].includes(sensor.initializedCompatibility.state) && sensor.initializedCompatibility.variantId === null) invalid(source, `${location}.initializedCompatibility.variantId is required for ${sensor.initializedCompatibility.state}`);
    if (sensor.initializedCompatibility.state === 'certified' && (sensor.initializedCompatibility.toolVersion === null || sensor.initializedCompatibility.runtimeVersion === null || sensor.initializedCompatibility.certifiedRange === null)) invalid(source, `${location}.initializedCompatibility certified evidence is incomplete`);
    if (sensor.initializedCompatibility.state === 'certified' && !semver.satisfies(sensor.initializedCompatibility.toolVersion!, sensor.initializedCompatibility.certifiedRange!)) invalid(source, `${location}.initializedCompatibility.toolVersion must satisfy certifiedRange`);
    if ('assets' in value) sensor.assets = stringArray(value.assets, source, `${location}.assets`, true).map((entry, index) => asset(entry, source, `${location}.assets[${index}]`));
    if ('policyRef' in value) {
        if (value.policyRef !== 'shared/semgrep-policy.json') invalid(source, `${location}.policyRef must be the contained AWM-owned shared/semgrep-policy.json`);
        sensor.policyRef = value.policyRef;
    }
    if ('fast' in value) {
        if (typeof value.fast !== 'boolean') invalid(source, `${location}.fast must be a boolean`);
        sensor.fast = value.fast;
    }
    if ('timeout' in value) {
        try { sensor.timeout = positiveTimeout(value.timeout, `${location}.timeout`); }
        catch (error) { invalid(source, error instanceof Error ? error.message : `${location}.timeout must be a positive safe integer`); }
    }
    return sensor;
}

function provenanceRoot(value: unknown, source: unknown): string {
    const parsed = text(value, source, 'registryRoot');
    if (!path.isAbsolute(parsed) || path.normalize(parsed) !== parsed) invalid(source, 'registryRoot must be an absolute normalized path');
    return parsed;
}

/**
 * A v3 declaration is copied between machines, so no nested string may retain
 * a host path. Structured command arguments are intentionally free-form and
 * are therefore the only remaining place an otherwise validated declaration
 * could hide one.
 */
function containsPhysicalPath(value: unknown): boolean {
    if (typeof value === 'string') {
        // Web URLs are portable command values, not host filesystem paths.
        const withoutWebUrls = value.replace(/https?:\/\/[^\s"']+/gi, '');
        return /(?:^|[^A-Za-z0-9_.~\/\\-])["']?(?:\/|\\|[A-Za-z]:|\/\/)/.test(withoutWebUrls);
    }
    return Array.isArray(value)
        ? value.some(containsPhysicalPath)
        : isRecord(value) && Object.values(value).some(containsPhysicalPath);
}

function parseV2Manifest(value: UnknownRecord, source: unknown): SensorManifestV2 {
    fields(value, ['schemaVersion', 'pack', 'packSelection', 'registryRoot', 'packageRoot', 'sensors', 'concurrency'], source, 'root');
    if (value.schemaVersion !== 2) invalid(source, `unsupported manifest schemaVersion ${String(value.schemaVersion)}; supported: legacy, 2; upgrade or migrate the manifest`);
    const pack = id(value.pack, source, 'pack');
    const sensorsInput = record(value.sensors, source, 'sensors');
    const sensors: SensorManifestV2['sensors'] = {};
    for (const name of Object.keys(sensorsInput)) sensors[id(name, source, 'sensor id')] = parseV2Sensor(sensorsInput[name], source, `sensors.${name}`);
    const manifest: SensorManifestV2 = { schemaVersion: 2, pack, sensors };
    if ('packSelection' in value) {
        if (value.packSelection !== 'explicit') invalid(source, 'packSelection must be "explicit" when present');
        manifest.packSelection = 'explicit';
    }
    if ('registryRoot' in value) manifest.registryRoot = provenanceRoot(value.registryRoot, source);
    if ('packageRoot' in value) manifest.packageRoot = asset(value.packageRoot, source, 'packageRoot');
    if ('concurrency' in value) {
        if (typeof value.concurrency !== 'number' || !Number.isSafeInteger(value.concurrency) || value.concurrency <= 0) invalid(source, 'concurrency must be a positive safe integer');
        manifest.concurrency = value.concurrency;
    }
    return manifest;
}

function parseV3ProjectManifestRoot(value: UnknownRecord, source: unknown): Omit<SensorManifestV3ProjectSensors, 'sensors'> {
    fields(value, ['schemaVersion', 'mode', 'pack', 'packSelection', 'source', 'packageRoot', 'sensors', 'concurrency'], source, 'root');
    const hasPackKey = 'pack' in value;
    const pack = !hasPackKey ? undefined : value.pack === null ? null : id(value.pack, source, 'pack');
    const manifest: Omit<SensorManifestV3ProjectSensors, 'sensors'> = {
        schemaVersion: 3,
        mode: 'project-sensors',
        ...(hasPackKey ? { pack } : {}),
    };
    if (typeof pack === 'string' && pack.length > 0) {
        const sourceValue = record(value.source, source, 'source');
        fields(sourceValue, ['registry'], source, 'source');
        manifest.source = { registry: id(sourceValue.registry, source, 'source.registry') };
    } else if ('source' in value) {
        invalid(source, 'source requires a nonempty pack id');
    }
    if ('packSelection' in value) {
        if (value.packSelection !== 'explicit') invalid(source, 'packSelection must be "explicit" when present');
        if (typeof pack !== 'string' || pack.length === 0) invalid(source, 'packSelection requires a nonempty pack id');
        manifest.packSelection = 'explicit';
    }
    if ('packageRoot' in value) manifest.packageRoot = asset(value.packageRoot, source, 'packageRoot');
    if ('concurrency' in value) {
        if (typeof value.concurrency !== 'number' || !Number.isSafeInteger(value.concurrency) || value.concurrency <= 0) invalid(source, 'concurrency must be a positive safe integer');
        manifest.concurrency = value.concurrency;
    }
    return manifest;
}

function parseV3ProjectSensorsMap(
    sensorsInput: UnknownRecord,
    source: unknown,
    soft: boolean,
): { sensors: SensorManifestV3ProjectSensors['sensors']; invalidEntries: SensorManifestInvalidEntry[] } {
    const sensors: SensorManifestV3ProjectSensors['sensors'] = {};
    const invalidEntries: SensorManifestInvalidEntry[] = [];
    for (const name of Object.keys(sensorsInput)) {
        const sensorName = id(name, source, 'sensor id');
        try {
            sensors[sensorName] = parseV3SensorEntry(sensorsInput[name], source, `sensors.${sensorName}`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (!soft) throw error instanceof Error ? error : new Error(reason);
            invalidEntries.push({ name: sensorName, reason });
        }
    }
    return { sensors, invalidEntries };
}

function parseV3ProjectManifest(value: UnknownRecord, source: unknown, soft: boolean): {
    pack: SensorManifestV3ProjectSensors;
    invalidEntries: SensorManifestInvalidEntry[];
} {
    const root = parseV3ProjectManifestRoot(value, source);
    const sensorsInput = record(value.sensors, source, 'sensors');
    const { sensors, invalidEntries } = parseV3ProjectSensorsMap(sensorsInput, source, soft);
    return { pack: { ...root, sensors }, invalidEntries };
}

function parseV3Manifest(value: UnknownRecord, source: unknown): SensorManifestV3 {
    if (value.schemaVersion !== 3) invalid(source, `unsupported manifest schemaVersion ${String(value.schemaVersion)}; supported: legacy, 2, 3; upgrade or migrate the manifest`);
    if (value.mode === 'project-sensors') return parseV3ProjectManifest(value, source, false).pack;
    if (value.mode !== 'native-gate' && value.mode !== 'opt-out') invalid(source, 'schemaVersion 3 mode must be "project-sensors", "native-gate", or "opt-out"');
    fields(value, ['schemaVersion', 'mode', 'reason'], source, 'root');
    return { schemaVersion: 3, mode: value.mode, reason: text(value.reason, source, 'reason') };
}

export type SensorManifestInvalidEntry = { name: string; reason: string };

export type ParsedSensorManifestWithIssues = ParsedSensorManifest & {
    invalidEntries: SensorManifestInvalidEntry[];
};

/** Soft per-entry parse for v3 project-sensors; document-level errors still throw. */
export function parseSensorManifestWithIssues(input: unknown, source: unknown): ParsedSensorManifestWithIssues {
    const value = record(input, source, 'root');
    if (!('schemaVersion' in value)) return { kind: 'legacy', pack: parseLegacyManifest(value, source), invalidEntries: [] };
    if (value.schemaVersion === 2) return { kind: 'v2', pack: parseV2Manifest(value, source), invalidEntries: [] };
    if (value.schemaVersion === 3) {
        if (value.mode === 'project-sensors') {
            const parsed = parseV3ProjectManifest(value, source, true);
            return { kind: 'v3', pack: parsed.pack, invalidEntries: parsed.invalidEntries };
        }
        return { kind: 'v3', pack: parseV3Manifest(value, source), invalidEntries: [] };
    }
    invalid(source, `unsupported manifest schemaVersion ${String(value.schemaVersion)}; supported: legacy, 2, 3; upgrade or migrate the manifest`);
}

export function parseSensorManifest(input: unknown, source: unknown): ParsedSensorManifest {
    const withIssues = parseSensorManifestWithIssues(input, source);
    if (withIssues.invalidEntries.length > 0) {
        throw new Error(withIssues.invalidEntries[0]!.reason);
    }
    const { invalidEntries: _invalidEntries, ...parsed } = withIssues;
    return parsed;
}

export function serializeManifestV2(input: unknown): string {
    const parsed = parseSensorManifest(input, 'manifest serialization');
    if (parsed.kind !== 'v2') throw new Error('Cannot serialize a legacy sensor manifest as v2');
    return JSON.stringify(parsed.pack, null, 2) + '\n';
}

/** Serialize a validated portable v3 declaration deterministically. */
export function serializeManifestV3(input: unknown): string {
    const parsed = parseSensorManifest(input, 'manifest serialization');
    if (parsed.kind !== 'v3') {
        throw new Error('Cannot serialize a non-v3 sensor manifest as v3');
    }
    if (parsed.pack.mode === 'project-sensors' && containsPhysicalPath(parsed.pack)) {
        throw new Error('Cannot serialize a v3 declaration containing a physical path');
    }
    return JSON.stringify(parsed.pack, null, 2) + '\n';
}
