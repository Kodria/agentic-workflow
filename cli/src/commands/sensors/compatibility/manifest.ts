import type { SensorConfig, SensorManifest } from '../types';
import type { CompatibilityEvidence, StructuredCommand } from './types';
import { parseStructuredCommand } from './contract';

type UnknownRecord = Record<string, unknown>;

export type SensorManifestV2 = {
    schemaVersion: 2;
    pack: string;
    sensors: Record<string, { selectedVariantId: string; command: StructuredCommand }>;
    concurrency?: number;
};

export type LegacySensorManifest = SensorManifest & { compatibility: CompatibilityEvidence };
export type ParsedSensorManifest = LegacySensorManifest | SensorManifestV2;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceSuffix(source: unknown): string {
    return typeof source === 'string' && source.length > 0 ? ` in ${source}` : '';
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
        if (typeof value.timeout !== 'number' || !Number.isSafeInteger(value.timeout) || value.timeout <= 0) invalid(source, `${location}.timeout must be a positive safe integer`);
        sensor.timeout = value.timeout;
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

function parseV2Sensor(input: unknown, source: unknown, location: string): { selectedVariantId: string; command: StructuredCommand } {
    const value = record(input, source, location);
    fields(value, ['selectedVariantId', 'command'], source, location);
    return {
        selectedVariantId: id(value.selectedVariantId, source, `${location}.selectedVariantId`),
        command: parseStructuredCommand(value.command, source),
    };
}

function parseV2Manifest(value: UnknownRecord, source: unknown): SensorManifestV2 {
    fields(value, ['schemaVersion', 'pack', 'sensors', 'concurrency'], source, 'root');
    if (value.schemaVersion !== 2) invalid(source, 'schemaVersion must be 2');
    const pack = id(value.pack, source, 'pack');
    const sensorsInput = record(value.sensors, source, 'sensors');
    const sensors: SensorManifestV2['sensors'] = {};
    for (const name of Object.keys(sensorsInput)) sensors[id(name, source, 'sensor id')] = parseV2Sensor(sensorsInput[name], source, `sensors.${name}`);
    const manifest: SensorManifestV2 = { schemaVersion: 2, pack, sensors };
    if ('concurrency' in value) {
        if (typeof value.concurrency !== 'number' || !Number.isSafeInteger(value.concurrency) || value.concurrency <= 0) invalid(source, 'concurrency must be a positive safe integer');
        manifest.concurrency = value.concurrency;
    }
    return manifest;
}

export function parseSensorManifest(input: unknown, source: unknown): ParsedSensorManifest {
    const value = record(input, source, 'root');
    return 'schemaVersion' in value ? parseV2Manifest(value, source) : parseLegacyManifest(value, source);
}

export function serializeManifestV2(input: unknown): string {
    const parsed = parseSensorManifest(input, 'manifest serialization');
    if (!('schemaVersion' in parsed) || parsed.schemaVersion !== 2) throw new Error('Cannot serialize a legacy sensor manifest as v2');
    return JSON.stringify(parsed, null, 2);
}
