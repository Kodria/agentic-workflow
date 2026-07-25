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
