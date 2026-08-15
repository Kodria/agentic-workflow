import semver from 'semver';
import fs from 'fs';
import path from 'path';
import { parseCoverageContract } from '../coverage/contract';
import type {
    CompatibilityProbe,
    CompatibilityEvidence,
    LegacySensorPack,
    ParsedSensorPack,
    SensorPackSensor,
    SensorPackV2,
    SensorVariant,
    SemgrepPolicy,
    StructuredCommand,
} from './types';

const PACK_SCHEMA_VERSION = 2;
const SHELL_EXECUTABLES = new Set(['sh', 'bash', 'cmd', 'powershell']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const ALLOWED_PROBES = new Set<CompatibilityProbe>([
    'version',
    'eslint-print-config',
    'typescript-show-config',
    'semgrep-validate',
    'package-script-present',
    'config-present',
]);

type UnknownRecord = Record<string, unknown>;

function normalizedPackageManager(value: string): string {
    return value.toLowerCase().replace(/\.exe$/, '');
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceSuffix(source: unknown): string {
    return typeof source === 'string' && source.length > 0 && !/[\0\r\n]/.test(source) ? ` in ${source}` : ' in <unknown source>';
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
    if (parsed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(parsed) || parsed.startsWith('\\\\') || parsed.includes('\\') || parsed.split('/').some(part => part === '' || part === '.' || part === '..')) {
        invalid(source, `${location} must be a contained relative asset path`);
    }
    return parsed;
}

function stringArray(value: unknown, source: unknown, location: string): string[] {
    if (!Array.isArray(value) || value.length === 0) invalid(source, `${location} must be a nonempty array`);
    return value.map((item, index) => text(item, source, `${location}[${index}]`));
}

function assetArray(value: unknown, source: unknown, location: string, allowEmpty = false): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) invalid(source, `${location} must be a ${allowEmpty ? '' : 'nonempty '}array`);
    return value.map((item, index) => asset(item, source, `${location}[${index}]`));
}

const SEMGREP_POLICY_REF = 'shared/semgrep-policy.json' as const;
const MAX_POLICY_BYTES = 64 * 1024;

function contained(root: string, candidate: string): boolean {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return candidate.startsWith(prefix);
}

export function parseSemgrepPolicy(input: unknown, source: unknown): SemgrepPolicy {
    const value = record(input, source, 'Semgrep policy');
    fields(value, ['tool', 'toolRange', 'runtime', 'runtimeRange', 'probe'], source, 'Semgrep policy');
    if (value.tool !== 'semgrep' || value.runtime !== 'python' || value.probe !== 'semgrep-validate') {
        invalid(source, 'Semgrep policy must declare semgrep, python, and semgrep-validate');
    }
    const toolRange = text(value.toolRange, source, 'Semgrep policy.toolRange');
    const runtimeRange = text(value.runtimeRange, source, 'Semgrep policy.runtimeRange');
    if (semver.validRange(toolRange) === null || semver.validRange(runtimeRange) === null) invalid(source, 'Semgrep policy ranges must be valid semver ranges');
    return { tool: 'semgrep', toolRange, runtime: 'python', runtimeRange, probe: 'semgrep-validate' };
}

export function resolveSemgrepPolicy(policyRef: unknown, source: unknown, location = 'policy'): SemgrepPolicy {
    if (policyRef !== SEMGREP_POLICY_REF) invalid(source, `${location}.policyRef must be the contained AWM-owned ${SEMGREP_POLICY_REF}`);
    if (typeof source !== 'string' || !path.isAbsolute(source) || path.normalize(source) !== source || path.basename(source) !== 'pack.json') {
        invalid(source, `${location}.policyRef requires an absolute pack.json source`);
    }
    const packRoot = path.dirname(source);
    const sensorPacksRoot = path.dirname(packRoot);
    const candidate = path.join(sensorPacksRoot, ...SEMGREP_POLICY_REF.split('/'));
    if (!contained(sensorPacksRoot, candidate)) invalid(source, `${location}.policyRef escapes sensor-packs root`);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(candidate); } catch { invalid(source, `${location}.policyRef does not resolve to a regular policy file`); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_POLICY_BYTES) invalid(source, `${location}.policyRef must resolve to a bounded regular policy file`);
    let realRoot: string; let realPolicy: string;
    try { realRoot = fs.realpathSync(sensorPacksRoot); realPolicy = fs.realpathSync(candidate); } catch { invalid(source, `${location}.policyRef cannot be canonicalized`); }
    if (!contained(realRoot, realPolicy)) invalid(source, `${location}.policyRef escapes sensor-packs root`);
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(realPolicy, 'utf8')); } catch { invalid(source, `${location}.policyRef must contain valid JSON`); }
    return parseSemgrepPolicy(parsed, realPolicy);
}

export function parseStructuredCommand(input: unknown, source: unknown): StructuredCommand {
    const value = record(input, source, 'command');
    fields(value, ['executable', 'resolution', 'args', 'packageManager', 'environment', 'fileInput', 'pythonEnvironmentRoot'], source, 'command');
    const executable = text(value.executable, source, 'command.executable');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(executable) || SHELL_EXECUTABLES.has(executable.toLowerCase().replace(/\.exe$/, ''))) {
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
    if ('pythonEnvironmentRoot' in value) {
        if (value.resolution !== 'python-environment' || (value.pythonEnvironmentRoot !== '.venv' && value.pythonEnvironmentRoot !== 'venv')) invalid(source, 'command.pythonEnvironmentRoot must name the selected .venv or venv Python environment');
        command.pythonEnvironmentRoot = value.pythonEnvironmentRoot;
    }
    const executablePackageManager = normalizedPackageManager(executable);
    if (PACKAGE_MANAGERS.has(executablePackageManager) && !('packageManager' in value)) invalid(source, 'command.packageManager is required for a package-manager executable');
    if ('packageManager' in value) {
        if (typeof value.packageManager !== 'string' || !PACKAGE_MANAGERS.has(normalizedPackageManager(value.packageManager))) invalid(source, 'command.packageManager must be npm, pnpm, yarn, or bun');
        const packageManager = normalizedPackageManager(value.packageManager);
        if (packageManager !== executablePackageManager) invalid(source, 'command.packageManager must match executable');
        command.packageManager = packageManager as StructuredCommand['packageManager'];
    }
    if ('environment' in value) {
        const environment = record(value.environment, source, 'command.environment');
        fields(environment, ['ESLINT_USE_FLAT_CONFIG'], source, 'command.environment');
        if ((environment.ESLINT_USE_FLAT_CONFIG !== 'true' && environment.ESLINT_USE_FLAT_CONFIG !== 'false') || Object.keys(environment).length !== 1) invalid(source, 'command.environment must be the exact allowlisted ESLINT_USE_FLAT_CONFIG=true or false mapping');
        command.environment = { ESLINT_USE_FLAT_CONFIG: environment.ESLINT_USE_FLAT_CONFIG };
    }
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
    fields(value, ['id', 'priority', 'requirements', 'certifiedRange', 'command', 'assets', 'formatter', 'probe', 'policyRef'], source, location);
    const certifiedRange = text(value.certifiedRange, source, `${location}.certifiedRange`);
    if (semver.validRange(certifiedRange) === null) invalid(source, `${location}.certifiedRange must be a valid semver range`);
    if (typeof value.priority !== 'number' || !Number.isSafeInteger(value.priority)) invalid(source, `${location}.priority must be a safe integer`);
    const policy = 'policyRef' in value ? resolveSemgrepPolicy(value.policyRef, source, location) : undefined;
    if (policy && ('requirements' in value || 'probe' in value)) invalid(source, `${location}.policyRef is authoritative; requirements and probe must not duplicate it`);
    if (!policy && (!('requirements' in value) || !('probe' in value))) invalid(source, `${location} requires requirements and probe when policyRef is absent`);
    const requirements = policy ? undefined : record(value.requirements, source, `${location}.requirements`);
    if (requirements) fields(requirements, ['tool', 'toolRange', 'runtime', 'runtimeRange', 'configFiles', 'packageJsonFields'], source, `${location}.requirements`);
    const toolRange = policy?.toolRange ?? text(requirements!.toolRange, source, `${location}.requirements.toolRange`);
    const runtimeRange = policy?.runtimeRange ?? text(requirements!.runtimeRange, source, `${location}.requirements.runtimeRange`);
    if (semver.validRange(toolRange) === null || semver.validRange(runtimeRange) === null) invalid(source, `${location}.requirements ranges must be valid semver ranges`);
    const probe = policy ? undefined : record(value.probe, source, `${location}.probe`);
    if (probe) {
        fields(probe, ['kind'], source, `${location}.probe`);
        if (typeof probe.kind !== 'string' || !ALLOWED_PROBES.has(probe.kind as CompatibilityProbe)) invalid(source, `${location}.probe.kind must be an allowed probe`);
    }
    return {
        id: id(value.id, source, `${location}.id`),
        priority: value.priority,
        certifiedRange,
        requirements: policy
            ? { tool: policy.tool, toolRange, runtime: policy.runtime, runtimeRange }
            : { tool: text(requirements!.tool, source, `${location}.requirements.tool`), toolRange, runtime: text(requirements!.runtime, source, `${location}.requirements.runtime`), runtimeRange, ...('configFiles' in requirements! ? { configFiles: stringArray(requirements!.configFiles, source, `${location}.requirements.configFiles`).map((file, index) => asset(file, source, `${location}.requirements.configFiles[${index}]`)) } : {}), ...('packageJsonFields' in requirements! ? { packageJsonFields: stringArray(requirements!.packageJsonFields, source, `${location}.requirements.packageJsonFields`).map((field, index) => { if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) invalid(source, `${location}.requirements.packageJsonFields[${index}] must be a stable package.json field`); return field; }) } : {}) },
        assets: assetArray(value.assets, source, `${location}.assets`, true),
        formatter: text(value.formatter, source, `${location}.formatter`),
        probe: { kind: policy?.probe ?? probe!.kind as CompatibilityProbe },
        ...(policy ? { policyRef: SEMGREP_POLICY_REF } : {}),
        command: parseStructuredCommand(value.command, source),
    };
}

function parseHardening(input: unknown, source: unknown): SensorPackV2['hardening'] {
    const value = record(input, source, 'hardening');
    const names = Object.keys(value);
    if (names.length === 0) invalid(source, 'hardening must be nonempty when declared');
    const hardening: NonNullable<SensorPackV2['hardening']> = {};
    for (const name of names) {
        const entry = record(value[name], source, `hardening.${name}`);
        fields(entry, ['assets'], source, `hardening.${name}`);
        hardening[id(name, source, 'hardening id')] = { assets: assetArray(entry.assets, source, `hardening.${name}.assets`) };
    }
    return hardening;
}

function assertNoEqualPriorityOverlapParsed(parsed: SensorVariant[]): void {
    for (let left = 0; left < parsed.length; left++) {
        const first = parsed[left];
        for (let right = left + 1; right < parsed.length; right++) {
            const second = parsed[right];
            const toolRangesIntersect = semver.intersects(first.requirements.toolRange, second.requirements.toolRange);
            const runtimeRangesIntersect = semver.intersects(first.requirements.runtimeRange, second.requirements.runtimeRange);
            if (first.priority === second.priority && toolRangesIntersect && runtimeRangesIntersect) {
                throw new Error(`variants "${first.id}" and "${second.id}" overlap at priority ${first.priority}`);
            }
        }
    }
}

export function assertNoEqualPriorityOverlap(variants: unknown): void {
    if (!Array.isArray(variants) || variants.length === 0) throw new Error('variants must be a nonempty array');
    assertNoEqualPriorityOverlapParsed(variants.map((variant, index) => parseVariant(variant, 'public overlap validator', `variants[${index}]`)));
}

function parseSensor(input: unknown, source: unknown, location: string, variantIds: Set<string>): SensorPackSensor {
    const value = record(input, source, location);
    fields(value, ['applicability', 'variants', 'fast'], source, location);
    if (!Array.isArray(value.variants) || value.variants.length === 0) invalid(source, `${location}.variants must be a nonempty array`);
    const variants = value.variants.map((variant, index) => parseVariant(variant, source, `${location}.variants[${index}]`));
    for (const variant of variants) {
        if (variantIds.has(variant.id)) invalid(source, `variant id "${variant.id}" must be unique`);
        variantIds.add(variant.id);
    }
    try {
        assertNoEqualPriorityOverlapParsed(variants);
    } catch (error) {
        invalid(source, `${location}.variants ${error instanceof Error ? error.message : 'overlap validation failed'}`);
    }
    const applicabilityInput = record(value.applicability, source, `${location}.applicability`);
    fields(applicabilityInput, ['allFiles', 'anyFiles', 'kind'], source, `${location}.applicability`);
    const applicability: SensorPackSensor['applicability'] = {};
    if ('allFiles' in applicabilityInput) applicability.allFiles = stringArray(applicabilityInput.allFiles, source, `${location}.applicability.allFiles`).map((file, index) => asset(file, source, `${location}.applicability.allFiles[${index}]`));
    if ('anyFiles' in applicabilityInput) applicability.anyFiles = stringArray(applicabilityInput.anyFiles, source, `${location}.applicability.anyFiles`).map((file, index) => asset(file, source, `${location}.applicability.anyFiles[${index}]`));
    if ('kind' in applicabilityInput) applicability.kind = text(applicabilityInput.kind, source, `${location}.applicability.kind`);
    if (Object.keys(applicability).length === 0) invalid(source, `${location}.applicability must declare a condition`);
    if ('fast' in value && typeof value.fast !== 'boolean') invalid(source, `${location}.fast must be a boolean`);
    return { applicability, variants, ...('fast' in value ? { fast: value.fast as boolean } : {}) };
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
    const sensorsInput = record(value.sensors, source, 'sensors');
    const sensors: LegacySensorPack['sensors'] = {};
    for (const sensorName of Object.keys(sensorsInput)) {
        const sensor = record(sensorsInput[sensorName], source, `sensors.${sensorName}`);
        fields(sensor, ['defaultCmd', 'fast', 'enabled', 'changedCmd', 'changedExtensions', 'formatter', 'configFile', 'configFileFallback'], source, `sensors.${sensorName}`);
        const parsed: LegacySensorPack['sensors'][string] = {};
        if ('defaultCmd' in sensor) parsed.defaultCmd = text(sensor.defaultCmd, source, `sensors.${sensorName}.defaultCmd`);
        if ('fast' in sensor) { if (typeof sensor.fast !== 'boolean') invalid(source, `sensors.${sensorName}.fast must be a boolean`); parsed.fast = sensor.fast; }
        if ('enabled' in sensor) { if (typeof sensor.enabled !== 'boolean') invalid(source, `sensors.${sensorName}.enabled must be a boolean`); parsed.enabled = sensor.enabled; }
        if ('changedCmd' in sensor) parsed.changedCmd = text(sensor.changedCmd, source, `sensors.${sensorName}.changedCmd`);
        if ('changedExtensions' in sensor) parsed.changedExtensions = stringArray(sensor.changedExtensions, source, `sensors.${sensorName}.changedExtensions`);
        if ('formatter' in sensor) parsed.formatter = text(sensor.formatter, source, `sensors.${sensorName}.formatter`);
        if ('configFile' in sensor) parsed.configFile = asset(sensor.configFile, source, `sensors.${sensorName}.configFile`);
        if ('configFileFallback' in sensor) parsed.configFileFallback = asset(sensor.configFileFallback, source, `sensors.${sensorName}.configFileFallback`);
        sensors[id(sensorName, source, 'sensor id')] = parsed;
    }
    const legacy: LegacySensorPack = { name, sensors, compatibility: legacyCompatibility() };
    if ('description' in value) legacy.description = text(value.description, source, 'description');
    if ('detects' in value) {
        if (!Array.isArray(value.detects)) invalid(source, 'detects must be an array');
        legacy.detects = value.detects.map((detect, index) => text(detect, source, `detects[${index}]`));
    }
    if ('coverage' in value) legacy.coverage = parseCoverageContract(value.coverage, source);
    return legacy;
}

export function parseSensorPack(input: unknown, source: unknown): ParsedSensorPack {
    const value = record(input, source, 'root');
    if (!('schemaVersion' in value)) return { kind: 'legacy', pack: parseLegacyPack(value, source) };
    fields(value, ['schemaVersion', 'name', 'description', 'detects', 'sensors', 'coverage', 'hardening'], source, 'root');
    if (value.schemaVersion !== PACK_SCHEMA_VERSION) invalid(source, `unsupported pack schemaVersion ${String(value.schemaVersion)}; supported: legacy, 2; upgrade or migrate the pack`);
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
    const hardening = 'hardening' in value ? parseHardening(value.hardening, source) : undefined;
    return { kind: 'v2', pack: {
        schemaVersion: PACK_SCHEMA_VERSION,
        name: id(value.name, source, 'name'), description: text(value.description, source, 'description'), detects: stringArray(value.detects, source, 'detects'),
        sensors, ...(hardening ? { hardening } : {}),
        coverage,
    } };
}
