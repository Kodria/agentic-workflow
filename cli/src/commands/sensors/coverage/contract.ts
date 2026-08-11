import type { SensorConfig } from '../types';

export const COVERAGE_SCHEMA_VERSION = 1;
export const MAX_COVERAGE_FILE_BYTES = 1024 * 1024;

export type CoverageFileRequirement = {
    path: string;
    containsAll: string[];
};

export type CoverageEvidenceContract = {
    commandIncludes?: string[];
    files?: CoverageFileRequirement[];
};

export type CoverageDetectorContract = {
    sensor: string;
    evidence?: CoverageEvidenceContract;
};

export type CoverageClassContract = {
    description: string;
    detectors: CoverageDetectorContract[];
    remedy: { summary: string; command: string };
};

export type CoverageContract = {
    schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
    classes: Record<string, CoverageClassContract>;
};

export type CoverageManifest = {
    pack: string;
    sensors: Record<string, SensorConfig>;
    concurrency?: number;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceSuffix(source: unknown): string {
    return typeof source === 'string' && source.length > 0 ? ` in ${source}` : '';
}

function invalid(source: unknown, message: string): never {
    throw new Error(`Invalid coverage contract${sourceSuffix(source)}: ${message}`);
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

function nonEmptyString(value: unknown, source: unknown, location: string): string {
    if (typeof value !== 'string' || value.length === 0) invalid(source, `${location} must be a nonempty string`);
    return value;
}

function safeName(value: unknown, source: unknown, location: string): string {
    const name = nonEmptyString(value, source, location);
    if (name === '.' || name === '..' || name.includes('..') || /[/\\]/.test(name)) {
        invalid(source, `${location} must be a safe filename component`);
    }
    return name;
}

function stringArray(value: unknown, source: unknown, location: string, allowEmpty: boolean): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        invalid(source, `${location} must be ${allowEmpty ? 'an array' : 'a nonempty array'}`);
    }
    return value.map((item, index) => nonEmptyString(item, source, `${location}[${index}]`));
}

function parseFileRequirement(input: unknown, source: unknown, location: string): CoverageFileRequirement {
    const value = record(input, source, location);
    fields(value, ['path', 'containsAll'], source, location);
    const path = safeName(value.path, source, `${location}.path`);
    const containsAll = stringArray(value.containsAll, source, `${location}.containsAll`, true);
    return { path, containsAll };
}

function parseEvidence(input: unknown, source: unknown, location: string): CoverageEvidenceContract {
    const value = record(input, source, location);
    fields(value, ['commandIncludes', 'files'], source, location);
    const evidence: CoverageEvidenceContract = {};
    if ('commandIncludes' in value) evidence.commandIncludes = stringArray(value.commandIncludes, source, `${location}.commandIncludes`, false);
    if ('files' in value) {
        if (!Array.isArray(value.files) || value.files.length === 0) invalid(source, `${location}.files must be a nonempty array`);
        evidence.files = value.files.map((file, index) => parseFileRequirement(file, source, `${location}.files[${index}]`));
    }
    return evidence;
}

function parseDetector(input: unknown, source: unknown, location: string): CoverageDetectorContract {
    const value = record(input, source, location);
    fields(value, ['sensor', 'evidence'], source, location);
    const detector: CoverageDetectorContract = { sensor: safeName(value.sensor, source, `${location}.sensor`) };
    if ('evidence' in value) detector.evidence = parseEvidence(value.evidence, source, `${location}.evidence`);
    return detector;
}

function parseClass(input: unknown, source: unknown, location: string): CoverageClassContract {
    const value = record(input, source, location);
    fields(value, ['description', 'detectors', 'remedy'], source, location);
    const description = nonEmptyString(value.description, source, `${location}.description`);
    if (!Array.isArray(value.detectors) || value.detectors.length === 0) invalid(source, `${location}.detectors must be a nonempty array`);
    const remedyInput = record(value.remedy, source, `${location}.remedy`);
    fields(remedyInput, ['summary', 'command'], source, `${location}.remedy`);
    return {
        description,
        detectors: value.detectors.map((detector, index) => parseDetector(detector, source, `${location}.detectors[${index}]`)),
        remedy: {
            summary: nonEmptyString(remedyInput.summary, source, `${location}.remedy.summary`),
            command: nonEmptyString(remedyInput.command, source, `${location}.remedy.command`),
        },
    };
}

export function parseCoverageContract(input: unknown, source: unknown): CoverageContract {
    const value = record(input, source, 'root');
    fields(value, ['schemaVersion', 'classes'], source, 'root');
    if (value.schemaVersion !== COVERAGE_SCHEMA_VERSION) invalid(source, `schemaVersion must be ${COVERAGE_SCHEMA_VERSION}`);
    const classesInput = record(value.classes, source, 'classes');
    const names = Object.keys(classesInput);
    if (names.length === 0) invalid(source, 'classes must be nonempty');
    const classes: Record<string, CoverageClassContract> = {};
    for (const name of names) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) invalid(source, `class "${name}" must use [a-z][a-z0-9-]*`);
        classes[name] = parseClass(classesInput[name], source, `classes.${name}`);
    }
    return { schemaVersion: COVERAGE_SCHEMA_VERSION, classes };
}

function manifestString(value: unknown, source: unknown, location: string): string {
    return nonEmptyString(value, source, location);
}

function parseManifestSensor(input: unknown, source: unknown, location: string): SensorConfig {
    const value = record(input, source, location);
    fields(value, ['cmd', 'fast', 'enabled', 'timeout', 'changedCmd', 'changedExtensions', 'formatter'], source, location);
    const sensor: SensorConfig = {};
    if ('cmd' in value) sensor.cmd = manifestString(value.cmd, source, `${location}.cmd`);
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
    if ('changedCmd' in value) sensor.changedCmd = manifestString(value.changedCmd, source, `${location}.changedCmd`);
    if ('changedExtensions' in value) sensor.changedExtensions = stringArray(value.changedExtensions, source, `${location}.changedExtensions`, true);
    if ('formatter' in value) sensor.formatter = manifestString(value.formatter, source, `${location}.formatter`);
    return sensor;
}

export function parseCoverageManifest(input: unknown, source: unknown): CoverageManifest {
    const value = record(input, source, 'manifest root');
    fields(value, ['pack', 'sensors', 'concurrency'], source, 'manifest root');
    const pack = safeName(value.pack, source, 'manifest.pack');
    const sensorsInput = record(value.sensors, source, 'manifest.sensors');
    const sensors: Record<string, SensorConfig> = {};
    for (const name of Object.keys(sensorsInput)) {
        sensors[safeName(name, source, 'manifest sensor name')] = parseManifestSensor(sensorsInput[name], source, `manifest.sensors.${name}`);
    }
    const manifest: CoverageManifest = { pack, sensors };
    if ('concurrency' in value) {
        if (typeof value.concurrency !== 'number' || !Number.isSafeInteger(value.concurrency) || value.concurrency <= 0) invalid(source, 'manifest.concurrency must be a positive safe integer');
        manifest.concurrency = value.concurrency;
    }
    return manifest;
}
