import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isAgentTarget, providerFor, type AgentTarget } from '../../providers';
import { renderedFilename } from '../renderers/registry';
import { listRegistries, REGISTRY_MANIFEST_NAME, type RegistrySource } from '../registries';
import { secureFs } from '../secure-fs/native-bridge';
import { parseJsonNoDuplicate } from '../plan/json';
import type { PlanDiagnostic, PlanValidationReport } from '../plan/types';
import { cliVersion } from '../cli-version';
import { compareSemver } from '../versioning';
import { checkCurrentness } from '../currentness/check';
import { runSensors } from '../../commands/sensors/run';
import { admitPlan, type AdmissionInput, type AdmissionReport } from './index';
import { readJournal } from '../journal/store';
import { bindingPlanPath } from '../journal/paths';
import { activeGeneration } from '../../commands/watch/generations';
import { refIsAlive } from '../journal/process';

const FRAMEWORK_CONTRACTS = ['using-awm', 'writing-plans', 'development-process', 'subagent-driven-development', 'executing-plans', 'post-implementation-qa', 'post-implementation-docs', 'harness-retro', 'finishing-a-development-branch'] as const;
const MAX_CONTRACT_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 10000;
type ContractScope = { provenance: 'proven' | 'unknown'; consumedRegistryComponents: string[]; identityDigest?: string; provenanceDiagnostic?: PlanDiagnostic };

function unknown(message: string): ContractScope {
    return { provenance: 'unknown', consumedRegistryComponents: [], provenanceDiagnostic: { code: 'ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED', message: `${message} Repair the installed runtime artifact or registry provenance before dispatch.` } };
}
function within(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function physicalDirectory(directory: string): string {
    const physical = fs.realpathSync.native(directory);
    if (!fs.lstatSync(physical).isDirectory()) throw new Error('path is not a directory');
    const handle = fs.opendirSync(physical);
    try {
        let entries = 0;
        while (handle.readSync() !== null) if (++entries > MAX_DIRECTORY_ENTRIES) throw new Error('directory entry limit exceeded');
    } finally { handle.closeSync(); }
    return physical;
}
function filesystemIdentity(file: string): string {
    const stat = fs.lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink() || stat.ino === 0n) throw new Error('filesystem identity is unavailable');
    return `${stat.dev.toString()}:${stat.ino.toString()}`;
}
/** Native descriptor bytes plus exact bigint leaf identity are observed only
 * in memory. No source body or new journal snapshot is persisted. */
function contractFileIdentity(file: string): string {
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.ino === 0n) throw new Error('contract identity is unavailable');
    const bytes = secureFs.readRegularFile(file, MAX_CONTRACT_BYTES).bytes;
    const after = fs.lstatSync(file, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('contract identity changed during inspection');
    return crypto.createHash('sha256').update(`${before.dev.toString()}:${before.ino.toString()}\0`).update(bytes).digest('hex');
}
/** ENOENT proves absence only when the nearest existing parent is readable.
 * A dangling/replaced ancestor never certifies an empty provider install. */
function directoryExists(directory: string): boolean {
    let current = directory;
    while (true) {
        try {
            fs.lstatSync(current);
            physicalDirectory(current);
            return current === directory;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            const parent = path.dirname(current);
            if (parent === current) throw error;
            // An existing dangling symlink causes realpath ENOENT; do not
            // continue above it as though the requested install were absent.
            try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('dangling directory ancestor'); }
            catch (inspection) { if ((inspection as NodeJS.ErrnoException).code !== 'ENOENT') throw inspection; }
            current = parent;
        }
    }
}

/** Physical sources AND actual provider artifacts define consumption. Copied
 * rendered artifacts have no owner proof; a basename is never provenance. */
export function consumedRegistryContracts(report: PlanValidationReport, cwd: string, registries: RegistrySource[], target: AgentTarget): ContractScope {
    if (report.state !== 'valid') return unknown('A validated compact plan is required.');
    if (!Array.isArray(registries) || registries.length > 256) return unknown('Registry inventory is invalid or unbounded.');
    let root: string;
    try { root = physicalDirectory(path.resolve(cwd)); } catch { return unknown('Project root provenance is unavailable.'); }
    const physicalRegistries: Array<{ name: string; root: string; identity: string; remote: string }> = [];
    for (const registry of registries) {
        try {
            if (!registry || typeof registry.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(registry.name)
                || typeof registry.contentRoot !== 'string' || registry.contentRoot.length > 4096
                || typeof registry.remote !== 'string' || registry.remote.length > 4096) throw new Error('invalid registry identity');
            const physicalRoot = physicalDirectory(registry.contentRoot);
            physicalRegistries.push({ name: registry.name, root: physicalRoot, identity: filesystemIdentity(physicalRoot), remote: registry.remote });
        } catch {
            const name = typeof registry?.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(registry.name) ? registry.name : 'unknown';
            return unknown(`Registry ${name} root cannot be inspected.`);
        }
    }
    const consumed = new Set<string>();
    const identities: string[] = [];
    for (const source of report.manifest.sources) {
        try {
            const file = fs.realpathSync.native(path.resolve(root, source.path));
            if (!within(root, file)) return unknown(`Plan source ${source.path} escapes its physical project root.`);
            identities.push(JSON.stringify(['source', source.id, contractFileIdentity(file)]));
            for (const registry of physicalRegistries) if (within(registry.root, file)) consumed.add(`registry:${registry.name}`);
        } catch { return unknown(`Plan source ${source.path} cannot be inspected as a bounded regular file.`); }
    }
    const provider = providerFor(target);
    const directories = [provider.skill.global, path.resolve(root, provider.skill.local)].filter((directory): directory is string => directory !== null);
    for (const directory of directories) {
        try { if (!directoryExists(directory)) continue; } catch { return unknown(`Provider ${target} install directory ${directory} is unsafe or unreadable.`); }
        for (const contract of FRAMEWORK_CONTRACTS) {
            const artifact = path.join(directory, renderedFilename(contract, provider.skill.renderer));
            try { fs.lstatSync(artifact); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; return unknown(`Runtime artifact ${artifact} cannot be inspected.`); }
            const declaredFile = provider.skill.renderer === 'link' ? path.join(artifact, 'SKILL.md') : artifact;
            try {
                const file = fs.realpathSync.native(declaredFile);
                const identity = contractFileIdentity(file);
                const owners = physicalRegistries.filter(registry => within(registry.root, file));
                if (owners.length !== 1) return unknown(`Runtime artifact ${artifact} has no unique physical registry owner (copied/rendered content is not ownership proof).`);
                consumed.add(`registry:${owners[0].name}`);
                identities.push(JSON.stringify(['artifact', target, contract, provider.skill.renderer, identity]));
            } catch { return unknown(`Runtime artifact ${artifact} is dangling, nonregular, unreadable or unbounded.`); }
        }
    }
    for (const registry of physicalRegistries) if (consumed.has(`registry:${registry.name}`)) identities.push(JSON.stringify(['registry', registry.name, registry.identity, registry.remote]));
    return { provenance: 'proven', consumedRegistryComponents: [...consumed].sort(), identityDigest: crypto.createHash('sha256').update(identities.sort().join('\0')).digest('hex') };
}

/** Only the declared CLI floor is consumed here, not a new registry catalog.
 * The native bounded/no-follow read prevents stat/read races and body leaks. */
export function registryCompatibility(registries: RegistrySource[], consumed: readonly string[]): PlanDiagnostic[] {
    const diagnostics: PlanDiagnostic[] = [];
    const current = cliVersion();
    for (const registry of registries) {
        const component = `registry:${registry.name}`;
        if (!consumed.includes(component)) continue;
        try {
            const physicalRoot = physicalDirectory(registry.contentRoot);
            const manifest = path.join(physicalRoot, REGISTRY_MANIFEST_NAME);
            try { fs.lstatSync(manifest); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
            const bytes = secureFs.readRegularFile(manifest, MAX_MANIFEST_BYTES).bytes;
            const raw = parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('manifest must be a JSON object');
            const min = (raw as Record<string, unknown>).minCliVersion;
            if (min !== undefined && (typeof min !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(min)
                || min.replace(/^v/, '').split('.').some(part => !Number.isSafeInteger(Number(part))))) throw new Error('invalid CLI floor');
            if (typeof min === 'string' && compareSemver(current, min) < 0) diagnostics.push({ code: 'ADMISSION_REGISTRY_CLI_INCOMPATIBLE', message: `${component} requires CLI >= ${min}; installed CLI is ${current}. Update the CLI before dispatch.` });
        } catch { diagnostics.push({ code: 'ADMISSION_REGISTRY_COMPATIBILITY_UNVERIFIABLE', message: `${component} manifest compatibility could not be verified as bounded regular JSON. Repair the registry before dispatch.` }); }
    }
    return diagnostics;
}

export type RegistryAdmissionDependencies = {
    listRegistries?: () => RegistrySource[];
    checkCurrentness?: typeof checkCurrentness;
    runSensors?: typeof runSensors;
    admitPlan?: typeof admitPlan;
    /** Deferred until every registry/currentness/sensor gate has admitted. */
    readRouting?: () => AdmissionInput['routing'] | Promise<AdmissionInput['routing']>;
};

/** A controller may ask for admission while its supervisor is writing journal
 * events. The already-launched generation passed sensors before launch; its
 * durable intent plus verified live process identity is the evidence, not a
 * second tree snapshot. A claim alone never certifies process ownership. */
function hasOwnedGenerationAdmission(input: AdmissionInput): boolean {
    if (!input.verifySensors || input.freshSensorsRequired || input.executionMode !== 'desatendido' || input.plan.state !== 'valid'
        || input.journalCorrupt || !input.journalState || input.journalState.schema !== 2
        || input.journalState.cycle.status !== 'IN_PROGRESS'
        || input.journalState.admissionContext?.provider !== input.provider
        || input.journalState.admissionContext.controllerAutonomy !== input.controllerAutonomy) return false;
    const observed = input.journalState;
    const binding = observed.planBinding;
    if (!binding) return false;
    if (input.plan.schema === 'compact-slices/v2' && !observed.admissionContext?.runtime) return false;
    let expectedPath: string;
    try { expectedPath = bindingPlanPath(input.planPath ?? ''); } catch { return false; }
    if (binding.path !== expectedPath || binding.digest !== input.plan.planDigest || binding.schema !== input.plan.schema
        || (binding.executionDigest !== undefined && binding.executionDigest !== input.plan.executionDigest)) return false;
    let fresh: ReturnType<typeof readJournal>;
    try { fresh = readJournal(input.cwd, observed.branch); } catch { return false; }
    if (fresh.corrupt || !fresh.state || fresh.state.cycle.status !== 'IN_PROGRESS'
        || fresh.state.revision < observed.revision || JSON.stringify(fresh.state.planBinding) !== JSON.stringify(binding)
        || JSON.stringify(fresh.state.admissionContext) !== JSON.stringify(observed.admissionContext)) return false;
    const generation = activeGeneration(fresh.state);
    if (!generation || generation !== fresh.state.generations.at(-1)
        || generation.provider !== input.provider || !generation.controllerJobId || !generation.launchArgvDigest) return false;
    const prior = observed.generations.find(item => item.token === generation.token);
    if (!prior || prior.controllerJobId !== generation.controllerJobId || prior.launchArgvDigest !== generation.launchArgvDigest) return false;
    return (generation.processRef !== undefined && generation.processRef.spawnNonce === generation.spawnNonce
            && generation.processRef.argvDigest === generation.launchArgvDigest && refIsAlive(generation.processRef))
        || (generation.wrapperRef !== undefined && generation.wrapperRef.spawnNonce === generation.spawnNonce
            && refIsAlive(generation.wrapperRef));
}

/** One admission authority for the public command AND actual watch dispatch.
 * No empirical execution occurs before provenance/currentness/CLI-floor gates. */
export async function admitRegistryPlan(input: AdmissionInput, dependencies: RegistryAdmissionDependencies = {}): Promise<AdmissionReport> {
    const admission = dependencies.admitPlan ?? admitPlan;
    if (input.plan.state !== 'valid' || !isAgentTarget(input.provider) || (input.enabledAgents && !input.enabledAgents.includes(input.provider))
        || (input.executionMode !== undefined && input.executionMode !== 'interactivo' && input.executionMode !== 'desatendido')) return admission(input);
    let registries: RegistrySource[] = [];
    let scope: ContractScope;
    const inventory = dependencies.listRegistries ?? listRegistries;
    const target = input.provider;
    try { registries = inventory(); scope = consumedRegistryContracts(input.plan, input.cwd, registries, target); }
    catch { scope = unknown('Registry inventory cannot be read.'); }
    const refresh = (): boolean => {
        try {
            const refreshedRegistries = inventory();
            const refreshed = consumedRegistryContracts(input.plan, input.cwd, refreshedRegistries, target);
            const previousComponents = scope.consumedRegistryComponents.join('\0');
            const previousIdentity = scope.identityDigest;
            registries = refreshedRegistries;
            scope = refreshed.provenance === 'unknown' ? refreshed
                : refreshed.consumedRegistryComponents.join('\0') !== previousComponents || refreshed.identityDigest !== previousIdentity
                    ? unknown('Consumed registry ownership changed during an asynchronous admission observation. Re-run actual currentness and read-only plan admission.') : refreshed;
            if (scope.provenanceDiagnostic) scope = { ...scope, provenanceDiagnostic: { ...scope.provenanceDiagnostic, message: `${scope.provenanceDiagnostic.message} Re-run actual currentness after repair.` } };
        } catch { scope = unknown('Registry inventory changed or cannot be read after asynchronous admission. Re-run actual currentness.'); }
        return scope.provenance === 'proven';
    };
    let generationBound = false;
    const compose = async (fields: Partial<AdmissionInput>): Promise<AdmissionReport> => {
        const report = await admission({ ...input, provenance: scope.provenance, consumedRegistryComponents: scope.consumedRegistryComponents, ...fields });
        const withEvidence = generationBound && report.sensors === 'pass' ? { ...report, sensorEvidence: 'generation-bound' as const } : report;
        if (scope.provenanceDiagnostic && report.diagnostics.some(diagnostic => diagnostic.code === 'ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED')) {
            return { ...withEvidence, diagnostics: report.diagnostics.map(diagnostic => diagnostic.code === 'ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED' ? scope.provenanceDiagnostic! : diagnostic) };
        }
        return withEvidence;
    };
    let currentness = input.currentness;
    let compatibilityDiagnostics: PlanDiagnostic[] | undefined;
    if (input.requireCurrent) {
        if (scope.provenance !== 'proven') return compose({});
        currentness = currentness ?? await (dependencies.checkCurrentness ?? checkCurrentness)(input.cwd);
        if (!refresh()) return compose({ currentness });
        // A missing sensor input stages composition before capability resolution.
        const currentnessGate = await compose({ currentness, verifySensors: true, sensors: undefined });
        if (currentnessGate.currentness !== 'current') return currentnessGate;
        compatibilityDiagnostics = registryCompatibility(registries, scope.consumedRegistryComponents);
        const compatibilityGate = await compose({ currentness, compatibilityDiagnostics, verifySensors: true, sensors: undefined });
        if (compatibilityGate.currentness !== 'current') return compatibilityGate;
    }
    generationBound = input.sensors === undefined && hasOwnedGenerationAdmission(input);
    const sensors = input.verifySensors ? input.sensors ?? (generationBound
        ? { sensors: [], overall: 'pass' as const, reason: 'generation-bound-admission' }
        : await (dependencies.runSensors ?? runSensors)({ cwd: input.cwd, all: true, readOnly: true })) : undefined;
    if (input.requireCurrent && input.verifySensors) {
        if (!refresh()) return compose({ currentness, sensors });
        const currentnessGate = await compose({ currentness, verifySensors: true, sensors: undefined });
        if (currentnessGate.currentness !== 'current') return currentnessGate;
        compatibilityDiagnostics = registryCompatibility(registries, scope.consumedRegistryComponents);
    }
    if (generationBound && input.plan.schema === 'compact-slices/v2') {
        const routing = input.routing ?? await dependencies.readRouting?.();
        const expected = input.journalState?.admissionContext?.runtime;
        if (!expected || !routing?.runtime || routing.runtime.target !== input.provider
            || routing.runtime.kind !== expected.kind || routing.runtime.version !== expected.version
            || routing.runtime.accountScopeDigest !== expected.accountScopeDigest) {
            return compose({ currentness, compatibilityDiagnostics, sensors,
                routing: { ...routing, eventIssue: { code: 'ADMISSION_GENERATION_RUNTIME_MISMATCH',
                    message: 'Live runtime identity differs from the admitted controller generation; stop and recover with a fresh admission.' } } });
        }
        return compose({ currentness, compatibilityDiagnostics, sensors, routing });
    }
    return compose({ currentness, compatibilityDiagnostics, sensors, ...(dependencies.readRouting ? { routingReader: dependencies.readRouting } : {}) });
}
