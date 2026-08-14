import semver from 'semver';
import { parseCoverageContract } from '../coverage/contract';
import type {
    CompatibilityProbe,
    CompatibilityEvidence,
    LegacySensorPack,
    SensorPack,
    SensorPackSensor,
    SensorPackV2,
    SensorVariant,
    StructuredCommand,
} from './types';

const PACK_SCHEMA_VERSION = 2;
const SHELL_EXECUTABLES = new Set(['sh', 'bash', 'cmd', 'powershell']);
const ALLOWED_PROBES = new Set<CompatibilityProbe>([
    'version',
    'eslint-print-config',
    'typescript-show-config',
    'semgrep-validate',
    'package-script-present',
    'config-present',
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceSuffix(source: unknown): string {
    return typeof source === 'string' && source.length > 0 ? ` in ${source}` : '';
}

function invalid(source: unknown, message: string): never {
    throw new Error(`Invalid sensor pack${sourceSuffix(source)}: ${message}`);
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

function asset(value: unknown, source: unknown, location: string): string {
    const parsed = text(value, source, location);
    if (parsed.startsWith('/') || parsed.includes('\\') || parsed.split('/').some(part => part === '' || part === '.' || part === '..')) {
        invalid(source, `${location} must be a contained relative asset path`);
    }
    return parsed;
}

function stringArray(value: unknown, source: unknown, location: string): string[] {
    if (!Array.isArray(value) || value.length === 0) invalid(source, `${location} must be a nonempty array`);
    return value.map((item, index) => text(item, source, `${location}[${index}]`));
}

export function parseStructuredCommand(input: unknown, source: unknown): StructuredCommand {
    const value = record(input, source, 'command');
    fields(value, ['executable', 'resolution', 'args', 'fileInput'], source, 'command');
    const executable = text(value.executable, source, 'command.executable');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(executable) || SHELL_EXECUTABLES.has(executable.toLowerCase())) {
        invalid(source, 'command.executable must not be a shell or path');
    }
    if (value.resolution !== 'node-modules-bin' && value.resolution !== 'python-environment' && value.resolution !== 'path') {
        invalid(source, 'command.resolution must be a supported resolution');
    }
    const args = stringArray(value.args, source, 'command.args');
    for (const [index, arg] of args.entries()) {
        if (arg.includes('{files}') && arg !== '{files}') invalid(source, `command.args[${index}] must not embed {files}`);
    }
    const command: StructuredCommand = { executable, resolution: value.resolution, args };
    if ('fileInput' in value) {
        const fileInput = record(value.fileInput, source, 'command.fileInput');
        fields(fileInput, ['placeholder', 'extensions'], source, 'command.fileInput');
        if (fileInput.placeholder !== '{files}') invalid(source, 'command.fileInput.placeholder must be {files}');
        const extensions = stringArray(fileInput.extensions, source, 'command.fileInput.extensions');
        for (const [index, extension] of extensions.entries()) {
            if (!/^\.[A-Za-z0-9]+$/.test(extension)) invalid(source, `command.fileInput.extensions[${index}] must be an extension`);
        }
        if (args.filter(arg => arg === '{files}').length !== 1) invalid(source, 'command.fileInput requires exactly one {files} argument');
        command.fileInput = { placeholder: '{files}', extensions };
    } else if (args.includes('{files}')) {
        invalid(source, 'command {files} argument requires fileInput');
    }
    return command;
}

function parseVariant(input: unknown, source: unknown, location: string): SensorVariant {
    const value = record(input, source, location);
    fields(value, ['id', 'priority', 'certifiedRange', 'probes', 'command'], source, location);
    const certifiedRange = text(value.certifiedRange, source, `${location}.certifiedRange`);
    if (semver.validRange(certifiedRange) === null) invalid(source, `${location}.certifiedRange must be a valid semver range`);
    if (typeof value.priority !== 'number' || !Number.isSafeInteger(value.priority)) invalid(source, `${location}.priority must be a safe integer`);
    if (!Array.isArray(value.probes) || value.probes.length === 0) invalid(source, `${location}.probes must be a nonempty array`);
    const probes = value.probes.map((probe, index) => {
        if (typeof probe !== 'string' || !ALLOWED_PROBES.has(probe as CompatibilityProbe)) {
            invalid(source, `${location}.probes[${index}] must be an allowed probe`);
        }
        return probe as CompatibilityProbe;
    });
    return {
        id: id(value.id, source, `${location}.id`),
        priority: value.priority,
        certifiedRange,
        probes,
        command: parseStructuredCommand(value.command, source),
    };
}

export function assertNoEqualPriorityOverlap(variants: readonly SensorVariant[]): void {
    if (!Array.isArray(variants) || variants.length === 0) throw new Error('variants must be a nonempty array');
    for (let left = 0; left < variants.length; left++) {
        const first = variants[left];
        if (!first || typeof first !== 'object' || typeof first.priority !== 'number' || typeof first.certifiedRange !== 'string') {
            throw new Error('variants must contain complete variant records');
        }
        for (let right = left + 1; right < variants.length; right++) {
            const second = variants[right];
            if (first.priority === second.priority && semver.intersects(first.certifiedRange, second.certifiedRange)) {
                throw new Error(`variants "${first.id}" and "${second.id}" overlap at priority ${first.priority}`);
            }
        }
    }
}

function parseSensor(input: unknown, source: unknown, location: string, variantIds: Set<string>): SensorPackSensor {
    const value = record(input, source, location);
    fields(value, ['variants'], source, location);
    if (!Array.isArray(value.variants) || value.variants.length === 0) invalid(source, `${location}.variants must be a nonempty array`);
    const variants = value.variants.map((variant, index) => parseVariant(variant, source, `${location}.variants[${index}]`));
    for (const variant of variants) {
        if (variantIds.has(variant.id)) invalid(source, `variant id "${variant.id}" must be unique`);
        variantIds.add(variant.id);
    }
    try {
        assertNoEqualPriorityOverlap(variants);
    } catch (error) {
        invalid(source, `${location}.variants ${error instanceof Error ? error.message : 'overlap validation failed'}`);
    }
    return { variants };
}

function legacyCompatibility(): CompatibilityEvidence {
    return {
        state: 'compatible-unverified',
        reason: 'legacy pack without schemaVersion',
        variantId: null,
        toolVersion: null,
        runtimeVersion: null,
        certifiedRange: null,
        evidence: [],
    };
}

function parseLegacyPack(value: UnknownRecord, source: unknown): LegacySensorPack {
    fields(value, ['name', 'description', 'detects', 'sensors', 'coverage'], source, 'root');
    const name = id(value.name, source, 'name');
    const sensors = record(value.sensors, source, 'sensors');
    const legacy: LegacySensorPack = { name, sensors, compatibility: legacyCompatibility() };
    if ('description' in value) legacy.description = text(value.description, source, 'description');
    if ('detects' in value) {
        if (!Array.isArray(value.detects)) invalid(source, 'detects must be an array');
        legacy.detects = value.detects;
    }
    if ('coverage' in value) legacy.coverage = parseCoverageContract(value.coverage, source);
    return legacy;
}

export function parseSensorPack(input: unknown, source: unknown): SensorPack {
    const value = record(input, source, 'root');
    if (!('schemaVersion' in value)) return parseLegacyPack(value, source);
    fields(value, ['schemaVersion', 'id', 'assets', 'sensors', 'coverage'], source, 'root');
    if (value.schemaVersion !== PACK_SCHEMA_VERSION) invalid(source, `schemaVersion must be ${PACK_SCHEMA_VERSION}`);
    if (!Array.isArray(value.assets) || value.assets.length === 0) invalid(source, 'assets must be a nonempty array');
    const assets = value.assets.map((entry, index) => asset(entry, source, `assets[${index}]`));
    if (new Set(assets).size !== assets.length) invalid(source, 'assets must be unique');
    const sensorsInput = record(value.sensors, source, 'sensors');
    const sensorNames = Object.keys(sensorsInput);
    if (sensorNames.length === 0) invalid(source, 'sensors must be nonempty');
    const sensors: Record<string, SensorPackSensor> = {};
    const variantIds = new Set<string>();
    for (const name of sensorNames) sensors[id(name, source, 'sensor id')] = parseSensor(sensorsInput[name], source, `sensors.${name}`, variantIds);
    let coverage;
    try {
        coverage = parseCoverageContract(value.coverage, source);
    } catch (error) {
        invalid(source, `coverage.${error instanceof Error ? error.message.replace(/^.*?: /, '') : 'is invalid'}`);
    }
    return {
        schemaVersion: PACK_SCHEMA_VERSION,
        id: id(value.id, source, 'id'),
        assets,
        sensors,
        coverage,
    };
}
