// src/core/artifact-state.ts
//
// Persistent ownership ledger for artifacts materialized by the planner
// (install-planner.ts). One record per physical target path; `owners` tracks
// which agent targets currently depend on that target so a later removal
// (planRemoval) knows whether it's safe to delete (R16).
import fs from 'fs';
import path from 'path';
import { AgentTarget, ArtifactType, RendererId, Scope } from '../providers';
import { awmHome } from './paths';
import { writeFileAtomic } from './atomic-file';

export type ManagedArtifactRecord = {
    name: string;
    type: ArtifactType;
    scope: Scope;
    targetPath: string;
    sourcePath: string;
    renderer: RendererId;
    owners: AgentTarget[];
};

export function artifactStateFile(): string {
    return path.join(awmHome(), 'state', 'artifacts.json');
}

export function readArtifactState(file = artifactStateFile()): ManagedArtifactRecord[] {
    if (!fs.existsSync(file)) return [];
    let value: unknown;
    try {
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(`${file} is not valid JSON. Fix it manually, then re-run.`);
    }
    if (!Array.isArray(value)) throw new Error(`${file} must contain an array`);
    return value as ManagedArtifactRecord[];
}

export function writeArtifactState(records: ManagedArtifactRecord[], file = artifactStateFile()): void {
    const ordered = [...records].sort((a, b) => a.targetPath.localeCompare(b.targetPath));
    writeFileAtomic(file, JSON.stringify(ordered, null, 2) + '\n', 0o600);
}

/**
 * Upserts `incoming` records into `existing`, keyed by `targetPath` — the
 * natural unique key for a ManagedArtifactRecord (see module docstring: "one
 * record per physical target path"). For each `targetPath` present in
 * `incoming`, the incoming record REPLACES any existing record for that same
 * path (it reflects the current true ownership state for that target after
 * the apply that produced it). Every existing record whose `targetPath` is
 * NOT touched by `incoming` is preserved unchanged.
 *
 * This is what makes a sequence of `applyInstallPlan` calls (e.g. the several
 * separate calls a real `awm init` run makes — one per bundle) additive
 * instead of each one clobbering every earlier call's ownership records.
 * `writeArtifactState` itself stays a low-level "write exactly this array"
 * primitive; callers that already have the final desired record set (e.g. a
 * future `planRemoval`-driven deletion) should keep calling it directly
 * rather than through this merge.
 */
export function mergeArtifactRecords(
    existing: ManagedArtifactRecord[],
    incoming: ManagedArtifactRecord[],
): ManagedArtifactRecord[] {
    const byTargetPath = new Map<string, ManagedArtifactRecord>();
    for (const record of existing) byTargetPath.set(record.targetPath, record);
    for (const record of incoming) byTargetPath.set(record.targetPath, record);
    return Array.from(byTargetPath.values());
}
