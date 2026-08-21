import type { SensorConfig, SensorManifest } from '../types';
import type { CompatibilityEvidence, StructuredCommand } from './types';
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
    sensors: Record<string, { enabled: boolean; fast?: boolean; timeout?: number; variantId: string; command: StructuredCommand; assets?: string[]; policyRef?: 'shared/semgrep-policy.json'; initializedCompatibility: CompatibilityEvidence }>;
    concurrency?: number;
};

export type LegacySensorManifest = SensorManifest & { compatibility: CompatibilityEvidence };
export type ParsedSensorManifest = { kind: 'legacy'; pack: LegacySensorManifest } | { kind: 'v2'; pack: SensorManifestV2 };

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

function parseV2Sensor(input: unknown, source: unknown, location: string): SensorManifestV2['sensors'][string] {
    const value = record(input, source, location);
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

function parseV2Manifest(value: UnknownRecord, source: unknown): SensorManifestV2 {
    fields(value, ['schemaVersion', 'pack', 'packSelection', 'registryRoot', 'sensors', 'concurrency'], source, 'root');
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
    if ('concurrency' in value) {
        if (typeof value.concurrency !== 'number' || !Number.isSafeInteger(value.concurrency) || value.concurrency <= 0) invalid(source, 'concurrency must be a positive safe integer');
        manifest.concurrency = value.concurrency;
    }
    return manifest;
}

export function parseSensorManifest(input: unknown, source: unknown): ParsedSensorManifest {
    const value = record(input, source, 'root');
    return 'schemaVersion' in value ? { kind: 'v2', pack: parseV2Manifest(value, source) } : { kind: 'legacy', pack: parseLegacyManifest(value, source) };
}

export function serializeManifestV2(input: unknown): string {
    const parsed = parseSensorManifest(input, 'manifest serialization');
    if (parsed.kind !== 'v2') throw new Error('Cannot serialize a legacy sensor manifest as v2');
    return JSON.stringify(parsed.pack, null, 2);
}
