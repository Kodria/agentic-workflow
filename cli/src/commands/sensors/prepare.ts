import { changedScopeError, applyChangedCmd, filterByExtension, type ChangedFiles } from './changed';
import { resolveTimeout } from './compatibility/timeout';
import type { CompatibilityEvidence, SensorPackSensor, SensorVariant, StructuredCommand } from './compatibility/types';
import type { SensorManifestV2 } from './compatibility/manifest';
import type { PreparedSensorExecution, SensorConfig } from './types';

export type PrepareRunOptions = {
    fast?: boolean;
    slow?: boolean;
    all?: boolean;
    cwd?: string;
    changed?: boolean;
    ignoreBaseline?: boolean;
    base?: string;
};

type RequestedScope = PreparedSensorExecution['requestedScope'];

function resolveRequestedScope(value: unknown): RequestedScope {
    if (value === undefined) return 'full';
    if (value === 'full' || value === 'changed') return value;
    throw new Error('requested scope must be "full" or "changed"');
}

export type PrepareLegacySensorInput = {
    name: string;
    config: SensorConfig;
    packTimeout?: number;
    requestedScope?: RequestedScope;
    changed?: ChangedFiles;
};

export type PrepareV2SensorInput = {
    name: string;
    sensor: SensorManifestV2['sensors'][string];
    liveSensor?: SensorPackSensor;
    liveState?: CompatibilityEvidence;
    projectTimeout?: number;
    packTimeout?: number;
    requestedScope?: RequestedScope;
    changed?: ChangedFiles;
};

export function validateRunOptions(opts: PrepareRunOptions): void {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new Error('run options must be an object');
    if (opts.fast !== undefined && typeof opts.fast !== 'boolean') throw new Error('run option fast must be a boolean');
    if (opts.slow !== undefined && typeof opts.slow !== 'boolean') throw new Error('run option slow must be a boolean');
    if (opts.all !== undefined && typeof opts.all !== 'boolean') throw new Error('run option all must be a boolean');
    if (opts.cwd !== undefined && (typeof opts.cwd !== 'string' || opts.cwd.trim() === '')) throw new Error('run option cwd must be a nonempty string');
    if (opts.changed !== undefined && typeof opts.changed !== 'boolean') throw new Error('run option changed must be a boolean');
    if (opts.ignoreBaseline !== undefined && typeof opts.ignoreBaseline !== 'boolean') throw new Error('run option ignoreBaseline must be a boolean');
    if (opts.base !== undefined && (typeof opts.base !== 'string' || opts.base.trim() === '')) throw new Error('run option base must be a nonempty string');
    if (opts.changed && opts.ignoreBaseline) {
        throw new Error('refusing to combine --changed with a baseline capture: a partial run cannot define the accepted set');
    }
}

/** Expand the one declared file placeholder into literal structured argv entries. */
export function expandFileInput(command: StructuredCommand, files: string[]): StructuredCommand {
    if (!command.fileInput) throw new Error('changed command requires fileInput');
    const index = command.args.indexOf(command.fileInput.placeholder);
    if (index < 0 || command.args.lastIndexOf(command.fileInput.placeholder) !== index) {
        throw new Error('changed command requires exactly one standalone {files} argument');
    }
    // `fileInput` describes the unexpanded registry template. Leaving it on the
    // materialized command makes the execution boundary (correctly) demand a
    // placeholder that has already been replaced with literal argv entries.
    const { fileInput: _templateInput, ...materialized } = command;
    return { ...materialized, args: [...command.args.slice(0, index), ...files, ...command.args.slice(index + 1)] };
}

function timeout(project: number | undefined, pack: number | undefined, fast: boolean): Pick<PreparedSensorExecution, 'timeoutMs' | 'timeoutSource'> {
    const resolved = resolveTimeout({ project, pack, fast });
    return { timeoutMs: resolved.timeoutMs, timeoutSource: resolved.source };
}

function fullLegacy(input: PrepareLegacySensorInput, scopeReason?: string): PreparedSensorExecution {
    const requestedScope = resolveRequestedScope(input.requestedScope);
    return {
        name: input.name,
        ...(input.config.cmd ? { command: { kind: 'legacy' as const, value: input.config.cmd } } : { syntheticStatus: 'inconclusive' as const, syntheticReason: 'no cmd configured' }),
        ...(input.config.formatter ? { formatter: input.config.formatter } : {}),
        ...timeout(input.config.timeout, input.packTimeout, input.config.fast ?? false),
        requestedScope,
        effectiveScope: 'full',
        ...(scopeReason ? { scopeReason } : {}),
    };
}

/** Prepare one legacy command without dispatching it. */
export function prepareLegacySensor(input: PrepareLegacySensorInput): PreparedSensorExecution {
    if (!input || typeof input !== 'object' || !input.config || typeof input.name !== 'string' || input.name === '') throw new Error('legacy preparation input is invalid');
    const requestedScope = resolveRequestedScope(input.requestedScope);
    if (requestedScope !== 'changed' || !input.changed) return fullLegacy(input);
    const scopeError = changedScopeError(input.changed);
    if (scopeError) return fullLegacy(input, `changed scope could not be resolved safely: ${scopeError}`);
    if (!input.config.changedCmd) return fullLegacy(input, 'sensor does not support changed scope');
    if (!input.config.changedCmd.includes('{files}')) {
        const { command: _command, ...prepared } = fullLegacy(input);
        return { ...prepared, effectiveScope: 'changed', syntheticStatus: 'inconclusive', syntheticReason: 'changedCmd has no {files} placeholder' };
    }
    const files = filterByExtension(input.changed.files, input.config.changedExtensions);
    if (files.length === 0) {
        const { command: _command, ...prepared } = fullLegacy(input);
        return { ...prepared, effectiveScope: 'changed', files: 0, syntheticStatus: 'pass', syntheticReason: 'no changed files in scope' };
    }
    return {
        name: input.name,
        command: { kind: 'legacy', value: applyChangedCmd(input.config.changedCmd, files) },
        ...(input.config.formatter ? { formatter: input.config.formatter } : {}),
        ...timeout(input.config.timeout, input.packTimeout, input.config.fast ?? false),
        requestedScope,
        effectiveScope: 'changed',
        files: files.length,
    };
}

function v2Synthetic(input: PrepareV2SensorInput, reason: string): PreparedSensorExecution {
    const requestedScope = resolveRequestedScope(input.requestedScope);
    return {
        name: input.name,
        ...timeout(input.projectTimeout ?? input.sensor.timeout, input.packTimeout ?? input.liveSensor?.timeout, input.sensor.fast ?? input.liveSensor?.fast ?? false),
        requestedScope,
        effectiveScope: 'full',
        syntheticStatus: 'inconclusive',
        syntheticReason: reason,
    };
}

/**
 * Prepare a v2 command from the freshly resolved pack. The manifest command is
 * deliberately never read: variantId is only a selector for live authority.
 */
export function prepareV2Sensor(input: PrepareV2SensorInput): PreparedSensorExecution {
    if (!input || typeof input !== 'object' || !input.sensor || typeof input.name !== 'string' || input.name === '') throw new Error('v2 preparation input is invalid');
    const requestedScope = resolveRequestedScope(input.requestedScope);
    if (!input.liveState || input.liveState.state !== 'certified') return v2Synthetic(input, input.liveState ? `${input.liveState.state}: ${input.liveState.reason}` : 'compatibility could not be revalidated');
    if (input.liveState.variantId !== input.sensor.variantId) return v2Synthetic(input, `variant-drift: manifest ${input.sensor.variantId}, live ${input.liveState.variantId ?? 'none'}; run \`awm sensors init\``);
    const variant: SensorVariant | undefined = input.liveSensor?.variants.find(candidate => candidate.id === input.sensor.variantId);
    if (!variant) return v2Synthetic(input, 'variant-drift: selected live variant has no command; run `awm sensors init`');
    const common = {
        name: input.name,
        ...(variant.formatter ? { formatter: variant.formatter } : {}),
        ...timeout(input.projectTimeout ?? input.sensor.timeout, input.packTimeout ?? input.liveSensor?.timeout, input.sensor.fast ?? input.liveSensor?.fast ?? false),
        requestedScope,
    };
    if (requestedScope !== 'changed' || !input.changed) return { ...common, command: { kind: 'structured', value: variant.command }, effectiveScope: 'full' };
    if (input.changed.error) return { ...common, command: { kind: 'structured', value: variant.command }, effectiveScope: 'full', scopeReason: `changed scope could not be resolved: ${input.changed.error}` };
    if (!variant.changedCommand) return { ...common, command: { kind: 'structured', value: variant.command }, effectiveScope: 'full', scopeReason: 'sensor does not support changed scope' };
    const files = filterByExtension(input.changed.files, variant.changedCommand.fileInput?.extensions);
    if (files.length === 0) return { ...common, effectiveScope: 'changed', files: 0, syntheticStatus: 'pass', syntheticReason: 'no changed files in scope' };
    return { ...common, command: { kind: 'structured', value: expandFileInput(variant.changedCommand, files) }, effectiveScope: 'changed', files: files.length };
}
