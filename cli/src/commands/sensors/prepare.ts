import path from 'path';
import { changedScopeError, applyChangedCmd, filterByExtension, filterExistingFiles, type ChangedFiles } from './changed';
import { resolveTimeout } from './compatibility/timeout';
import type { CompatibilityEvidence, SensorPackSensor, SensorVariant, StructuredCommand } from './compatibility/types';
import {
    isProjectDeclaredSensor,
    type ProjectDeclaredSensor,
    type SensorManifestV2,
    type V3ManifestSensor,
} from './compatibility/manifest';
import { toSafeRepoRel } from './inputs-digest';
import type { PreparedSensorExecution, SensorConfig } from './types';

export type PrepareRunOptions = {
    fast?: boolean;
    slow?: boolean;
    all?: boolean;
    cwd?: string;
    changed?: boolean;
    ignoreBaseline?: boolean;
    base?: string;
    readOnly?: boolean;
    /** Operator `--slice` gate: skip bare `closureOnly`; run opted-in `sliceCommand`. */
    slice?: boolean;
    /** When true, read/write the fingerprint result cache (RF-2.11). */
    useCache?: boolean;
};

type RequestedScope = PreparedSensorExecution['requestedScope'];

function resolveRequestedScope(value: unknown): RequestedScope {
    if (value === undefined) return 'full';
    if (value === 'full' || value === 'changed' || value === 'slice') return value;
    throw new Error('requested scope must be "full", "changed", or "slice"');
}

/**
 * Keep only paths that stay inside `packageRoot`. Absolute paths and `..`
 * escapes are dropped (RF-1.4 / RF-1.8). Returns package-root-relative posix
 * paths for argv expansion.
 *
 * When `gitRoot` is provided, `files` are treated as git-root-relative (the
 * `changedFiles` contract); otherwise they are treated as package-relative.
 *
 * Containment uses `toSafeRepoRel` (realpath both sides) so Windows cannot
 * false-throw when `run.ts` passes a native-realpath'd gitRoot beside a
 * non-native packageRoot — the same native vs non-native pitfall documented
 * in `inputs-digest.ts`.
 */
export function filterPathsInsidePackageRoot(
    files: string[],
    packageRoot: string,
    gitRoot?: string,
): { files: string[]; dropped: number } {
    if (!Array.isArray(files)) throw new Error('files must be an array');
    if (typeof packageRoot !== 'string' || packageRoot.trim() === '') throw new Error('packageRoot must be a nonempty string');
    const packageAbs = path.resolve(packageRoot);
    let packageRootRel = '';
    if (typeof gitRoot === 'string' && gitRoot.trim() !== '') {
        try {
            packageRootRel = toSafeRepoRel(gitRoot, packageRoot, 'packageRoot');
        } catch {
            throw new Error('packageRoot must be inside gitRoot');
        }
    }
    const kept: string[] = [];
    let dropped = 0;
    for (const file of files) {
        if (typeof file !== 'string' || file.trim() === '') {
            dropped += 1;
            continue;
        }
        if (path.isAbsolute(file)) {
            dropped += 1;
            continue;
        }
        const normalized = file.replace(/\\/g, '/');
        if (normalized.split('/').some(part => part === '..' || part === '')) {
            dropped += 1;
            continue;
        }
        if (packageRootRel === '') {
            const abs = path.resolve(packageAbs, normalized);
            const rel = path.relative(packageAbs, abs).split(path.sep).join('/');
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
                dropped += 1;
                continue;
            }
            kept.push(rel);
            continue;
        }
        if (normalized === packageRootRel) {
            dropped += 1;
            continue;
        }
        const prefix = `${packageRootRel}/`;
        if (!normalized.startsWith(prefix)) {
            dropped += 1;
            continue;
        }
        kept.push(normalized.slice(prefix.length));
    }
    return { files: kept, dropped };
}

export type PrepareLegacySensorInput = {
    name: string;
    config: SensorConfig;
    packTimeout?: number;
    requestedScope?: RequestedScope;
    changed?: ChangedFiles;
    /** When set, drop non-existent paths before argv expansion. */
    worktreeRoot?: string;
    /** Deleted paths for RF-1.8 diagnostics — never expanded into argv. */
    deletedFiles?: string[];
};

export type PrepareV2SensorInput = {
    name: string;
    sensor: V3ManifestSensor | SensorManifestV2['sensors'][string];
    liveSensor?: SensorPackSensor;
    liveState?: CompatibilityEvidence;
    projectTimeout?: number;
    packTimeout?: number;
    requestedScope?: RequestedScope;
    changed?: ChangedFiles;
    /** Project paths used to evaluate optional project-sensor applicability. */
    applicabilityPaths?: string[];
    /** When set, drop non-existent paths before argv expansion. */
    worktreeRoot?: string;
    /** Deleted paths for RF-1.8 diagnostics — never expanded into argv. */
    deletedFiles?: string[];
};

/** Extension-filter then drop missing paths; note omitted deletes for diagnostics. */
function argvFilesForScope(
    files: string[],
    extensions: string[] | undefined,
    worktreeRoot: string | undefined,
    deletedFiles: string[] | undefined,
): { files: string[]; scopeReason?: string; deletedForDigest: string[] } {
    let scoped = filterByExtension(files, extensions);
    const notes: string[] = [];
    if (typeof worktreeRoot === 'string' && worktreeRoot.trim() !== '') {
        const existing = filterExistingFiles(worktreeRoot, scoped);
        if (existing.omitted > 0) {
            notes.push(`omitted ${existing.omitted} missing path(s) from argv`);
        }
        scoped = existing.files;
    }
    const deletedForDigest = filterByExtension(deletedFiles ?? [], extensions);
    if (deletedForDigest.length > 0) {
        notes.push(`omitted ${deletedForDigest.length} deleted path(s) from argv`);
    }
    return {
        files: scoped,
        ...(notes.length > 0 ? { scopeReason: notes.join('; ') } : {}),
        deletedForDigest,
    };
}

export function validateRunOptions(opts: PrepareRunOptions): void {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new Error('run options must be an object');
    if (opts.fast !== undefined && typeof opts.fast !== 'boolean') throw new Error('run option fast must be a boolean');
    if (opts.slow !== undefined && typeof opts.slow !== 'boolean') throw new Error('run option slow must be a boolean');
    if (opts.all !== undefined && typeof opts.all !== 'boolean') throw new Error('run option all must be a boolean');
    if (opts.cwd !== undefined && (typeof opts.cwd !== 'string' || opts.cwd.trim() === '')) throw new Error('run option cwd must be a nonempty string');
    if (opts.changed !== undefined && typeof opts.changed !== 'boolean') throw new Error('run option changed must be a boolean');
    if (opts.ignoreBaseline !== undefined && typeof opts.ignoreBaseline !== 'boolean') throw new Error('run option ignoreBaseline must be a boolean');
    if (opts.base !== undefined && (typeof opts.base !== 'string' || opts.base.trim() === '')) throw new Error('run option base must be a nonempty string');
    if (opts.readOnly !== undefined && typeof opts.readOnly !== 'boolean') throw new Error('run option readOnly must be a boolean');
    if (opts.slice !== undefined && typeof opts.slice !== 'boolean') throw new Error('run option slice must be a boolean');
    if (opts.useCache !== undefined && typeof opts.useCache !== 'boolean') throw new Error('run option useCache must be a boolean');
    if (opts.changed && opts.ignoreBaseline) {
        throw new Error('refusing to combine --changed with a baseline capture: a partial run cannot define the accepted set');
    }
    if (opts.slice && opts.all) {
        throw new Error('refusing to combine --slice with --all: slice already selects the non-closureOnly set');
    }
    if (opts.slice && opts.slow) {
        throw new Error('refusing to combine --slice with --slow: use a full gate for closureOnly/slow sensors');
    }
    if (opts.slice && opts.changed) {
        throw new Error('refusing to combine --slice with --changed: use one selection mode per run');
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

function resultsFileField(resultsFile: string | undefined): { resultsFile?: string } {
    return resultsFile !== undefined ? { resultsFile } : {};
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
    const scoped = argvFilesForScope(
        input.changed.files,
        input.config.changedExtensions,
        input.worktreeRoot,
        input.deletedFiles,
    );
    if (scoped.files.length === 0) {
        const { command: _command, ...prepared } = fullLegacy(input);
        return {
            ...prepared,
            effectiveScope: 'changed',
            files: 0,
            syntheticStatus: 'pass',
            syntheticReason: 'no changed files in scope',
            ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
        };
    }
    return {
        name: input.name,
        command: { kind: 'legacy', value: applyChangedCmd(input.config.changedCmd, scoped.files) },
        ...(input.config.formatter ? { formatter: input.config.formatter } : {}),
        ...timeout(input.config.timeout, input.packTimeout, input.config.fast ?? false),
        requestedScope,
        effectiveScope: 'changed',
        files: scoped.files.length,
        ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
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

function projectApplicabilityMet(sensor: ProjectDeclaredSensor, paths: string[] | undefined): boolean {
    const rule = sensor.applicability;
    if (!rule) return true;
    if (rule.kind === 'explicit-or-supported-language' || rule.kind === 'explicit-opt-in') {
        // Project sensors do not receive pack-selection signals; treat these kinds
        // as met when no path markers were declared.
        if (!rule.allFiles?.length && !rule.anyFiles?.length) return true;
    }
    const present = new Set(paths ?? []);
    return (!rule.allFiles || rule.allFiles.every(file => present.has(file)))
        && (!rule.anyFiles || rule.anyFiles.some(file => present.has(file)));
}

/**
 * Prepare a project-declared sensor from its manifest entry. No live pack variant
 * re-resolution: the structured command on the entry is authoritative.
 */
function prepareProjectSensor(input: PrepareV2SensorInput): PreparedSensorExecution {
    const sensor = input.sensor as ProjectDeclaredSensor;
    const requestedScope = resolveRequestedScope(input.requestedScope);
    const common = {
        name: input.name,
        formatter: sensor.formatter || (input.name === 'test' ? 'test' : 'exit-code'),
        ...resultsFileField(sensor.resultsFile),
        ...timeout(input.projectTimeout ?? sensor.timeout, input.packTimeout, sensor.fast ?? false),
        requestedScope,
        certification: 'project-declared' as const,
    };
    if (!projectApplicabilityMet(sensor, input.applicabilityPaths)) {
        return {
            ...common,
            effectiveScope: 'full',
            syntheticStatus: 'inconclusive',
            syntheticReason: 'not-applicable: applicability-not-met',
        };
    }
    if (requestedScope === 'slice') {
        if (!input.changed) {
            return { ...common, effectiveScope: 'slice', syntheticStatus: 'inconclusive', syntheticReason: 'slice scope requires --base' };
        }
        if (input.changed.error) {
            return {
                ...common,
                effectiveScope: 'slice',
                syntheticStatus: 'inconclusive',
                syntheticReason: `slice scope could not be resolved: ${input.changed.error}`,
            };
        }
        if (!sensor.sliceCommand?.fileInput) {
            return {
                ...common,
                effectiveScope: 'slice',
                syntheticStatus: 'inconclusive',
                syntheticReason: 'sliceCommand is not usable',
            };
        }
        const scoped = argvFilesForScope(
            input.changed.files,
            sensor.sliceCommand.fileInput.extensions,
            input.worktreeRoot,
            input.deletedFiles,
        );
        if (scoped.files.length === 0) {
            return {
                ...common,
                effectiveScope: 'slice',
                files: 0,
                syntheticStatus: 'skipped',
                syntheticReason: 'slice scope empty after filters',
                scopeReason: [
                    input.changed.files.length > 0 || (input.deletedFiles?.length ?? 0) > 0
                        ? 'extension or packageRoot filters removed every slice path'
                        : undefined,
                    scoped.scopeReason,
                ].filter(Boolean).join('; ') || undefined,
            };
        }
        return {
            ...common,
            command: { kind: 'structured', value: expandFileInput(sensor.sliceCommand, scoped.files) },
            effectiveScope: 'slice',
            files: scoped.files.length,
            ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
        };
    }
    if (requestedScope === 'changed' && input.changed) {
        if (input.changed.error) {
            return {
                ...common,
                command: { kind: 'structured', value: sensor.command },
                effectiveScope: 'full',
                scopeReason: `changed scope could not be resolved: ${input.changed.error}`,
            };
        }
        if (!sensor.changedCommand?.fileInput) {
            return {
                ...common,
                command: { kind: 'structured', value: sensor.command },
                effectiveScope: 'full',
                scopeReason: 'sensor does not support changed scope',
            };
        }
        const scoped = argvFilesForScope(
            input.changed.files,
            sensor.changedCommand.fileInput.extensions,
            input.worktreeRoot,
            input.deletedFiles,
        );
        if (scoped.files.length === 0) {
            return {
                ...common,
                effectiveScope: 'changed',
                files: 0,
                syntheticStatus: 'pass',
                syntheticReason: 'no changed files in scope',
                ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
            };
        }
        return {
            ...common,
            command: { kind: 'structured', value: expandFileInput(sensor.changedCommand, scoped.files) },
            effectiveScope: 'changed',
            files: scoped.files.length,
            ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
        };
    }
    return {
        ...common,
        command: { kind: 'structured', value: sensor.command },
        effectiveScope: 'full',
    };
}

/**
 * Prepare a v2/v3 command. Pack-bound sensors re-resolve from the live pack
 * (manifest command is never authority). Project-declared sensors use the
 * entry command and carry `project-declared` provenance.
 */
export function prepareV2Sensor(input: PrepareV2SensorInput): PreparedSensorExecution {
    if (!input || typeof input !== 'object' || !input.sensor || typeof input.name !== 'string' || input.name === '') throw new Error('v2 preparation input is invalid');
    if (isProjectDeclaredSensor(input.sensor as V3ManifestSensor)) return prepareProjectSensor(input);
    const packSensor = input.sensor as SensorManifestV2['sensors'][string];
    const requestedScope = resolveRequestedScope(input.requestedScope);
    // Un sensor se ejecuta cuando la herramienta ESTA y funciona aca: `certified` es
    // la version exacta que el registry congelo, y `compatible-unverified` es una que
    // cae dentro del rango operativo declarado por el pack y cuyo probe coincidio
    // (resolve.ts: 'operational-range-and-probe'). Antes solo corria la primera, asi
    // que una maquina con npm 10.9.7 frente a un certifiedRange `=10.8.3` no ejecutaba
    // el sensor: quedaba `inconclusive`, el veredicto global caia a `not_certified` y
    // la admision desatendida bloqueaba. No se puede pinear el gestor de paquetes que
    // viene con Node, asi que eso bloqueaba en cualquier maquina sin que nada estuviera
    // mal — se saltaba la verificacion justamente donde mas hace falta.
    //
    // La diferencia no se pierde: viaja en `certification` hasta el resultado, asi que
    // un veredicto producido por una version no congelada dice que lo fue. Lo que NO
    // se ejecuta sigue sin ejecutarse: `incompatible` (fuera de rango), `missing-tool`
    // (no esta), `unverifiable` (el probe no coincidio) y `not-applicable`.
    if (!input.liveState || (input.liveState.state !== 'certified' && input.liveState.state !== 'compatible-unverified')) {
        return v2Synthetic(input, input.liveState ? `${input.liveState.state}: ${input.liveState.reason}` : 'compatibility could not be revalidated');
    }
    if (input.liveState.variantId !== packSensor.variantId) return v2Synthetic(input, `variant-drift: manifest ${packSensor.variantId}, live ${input.liveState.variantId ?? 'none'}; run \`awm sensors init\``);
    const variant: SensorVariant | undefined = input.liveSensor?.variants.find(candidate => candidate.id === packSensor.variantId);
    if (!variant) return v2Synthetic(input, 'variant-drift: selected live variant has no command; run `awm sensors init`');
    const common = {
        name: input.name,
        certification: input.liveState.state === 'certified' ? 'certified' as const : 'operational-unverified' as const,
        ...(variant.formatter ? { formatter: variant.formatter } : {}),
        ...resultsFileField(packSensor.resultsFile),
        ...timeout(input.projectTimeout ?? packSensor.timeout, input.packTimeout ?? input.liveSensor?.timeout, packSensor.fast ?? input.liveSensor?.fast ?? false),
        requestedScope,
    };
    // RF-1.5: project structured override ?? pack variant default ?? absent
    const sliceCommand = packSensor.sliceCommand?.fileInput ? packSensor.sliceCommand : variant.sliceCommand;
    const changedCommand = packSensor.changedCommand?.fileInput ? packSensor.changedCommand : variant.changedCommand;
    if (requestedScope === 'slice') {
        if (!input.changed) {
            return {
                ...common,
                effectiveScope: 'slice',
                syntheticStatus: 'inconclusive',
                syntheticReason: 'slice scope requires --base',
            };
        }
        if (input.changed.error) {
            return {
                ...common,
                effectiveScope: 'slice',
                syntheticStatus: 'inconclusive',
                syntheticReason: `slice scope could not be resolved: ${input.changed.error}`,
            };
        }
        if (!sliceCommand?.fileInput) {
            return {
                ...common,
                effectiveScope: 'slice',
                syntheticStatus: 'inconclusive',
                syntheticReason: 'sliceCommand is not usable',
            };
        }
        const scoped = argvFilesForScope(
            input.changed.files,
            sliceCommand.fileInput.extensions,
            input.worktreeRoot,
            input.deletedFiles,
        );
        if (scoped.files.length === 0) {
            return {
                ...common,
                effectiveScope: 'slice',
                files: 0,
                syntheticStatus: 'skipped',
                syntheticReason: 'slice scope empty after filters',
                scopeReason: [
                    input.changed.files.length > 0 || (input.deletedFiles?.length ?? 0) > 0
                        ? 'extension or packageRoot filters removed every slice path'
                        : undefined,
                    scoped.scopeReason,
                ].filter(Boolean).join('; ') || undefined,
            };
        }
        return {
            ...common,
            command: { kind: 'structured', value: expandFileInput(sliceCommand, scoped.files) },
            effectiveScope: 'slice',
            files: scoped.files.length,
            ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
        };
    }
    if (requestedScope !== 'changed' || !input.changed) return { ...common, command: { kind: 'structured', value: variant.command }, effectiveScope: 'full' };
    if (input.changed.error) return { ...common, command: { kind: 'structured', value: variant.command }, effectiveScope: 'full', scopeReason: `changed scope could not be resolved: ${input.changed.error}` };
    if (!changedCommand) return { ...common, command: { kind: 'structured', value: variant.command }, effectiveScope: 'full', scopeReason: 'sensor does not support changed scope' };
    const scoped = argvFilesForScope(
        input.changed.files,
        changedCommand.fileInput?.extensions,
        input.worktreeRoot,
        input.deletedFiles,
    );
    if (scoped.files.length === 0) {
        return {
            ...common,
            effectiveScope: 'changed',
            files: 0,
            syntheticStatus: 'pass',
            syntheticReason: 'no changed files in scope',
            ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
        };
    }
    return {
        ...common,
        command: { kind: 'structured', value: expandFileInput(changedCommand, scoped.files) },
        effectiveScope: 'changed',
        files: scoped.files.length,
        ...(scoped.scopeReason ? { scopeReason: scoped.scopeReason } : {}),
    };
}
