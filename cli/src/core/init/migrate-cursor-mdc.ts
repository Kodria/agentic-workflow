// cli/src/core/init/migrate-cursor-mdc.ts
//
// Plan B S3 / R8: after Cursor skills move to link under ~/.agents/skills, remove
// only artifact-state records that were rendered with cursor-mdc under Cursor rules
// dirs. Never touch unrecorded files; never remove awm.mdc (project guidance carrier).

import fs from 'fs';
import path from 'path';
import { homeDir } from '../paths';
import {
    artifactStateFile,
    readArtifactState,
    writeArtifactState,
    type ManagedArtifactRecord,
} from '../artifact-state';

export type MigrateCursorMdcResult = {
    removed: string[];
    kept: number;
};

function isUnderCursorRules(targetPath: string, projectRoot?: string): boolean {
    const resolved = path.resolve(targetPath);
    const globalRules = path.resolve(homeDir(), '.cursor', 'rules');
    if (resolved === globalRules || resolved.startsWith(globalRules + path.sep)) return true;
    if (!projectRoot) return false;
    const localRules = path.resolve(projectRoot, '.cursor', 'rules');
    return resolved === localRules || resolved.startsWith(localRules + path.sep);
}

function isAwmMdcCarrier(record: ManagedArtifactRecord): boolean {
    return record.name === 'awm' || path.basename(record.targetPath) === 'awm.mdc';
}

function safeUnlinkManaged(targetPath: string): boolean {
    try {
        const stat = fs.lstatSync(targetPath);
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        fs.unlinkSync(targetPath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/**
 * Drop historical cursor-mdc skill renders under Cursor rules dirs once link
 * skills are the delivery path. Idempotent; safe on machines without cursor.
 */
export function migrateCursorMdcSkills(opts: {
    awmHome?: string;
    projectRoot?: string;
    stateFile?: string;
}): MigrateCursorMdcResult {
    const stateFile = opts.stateFile ?? artifactStateFile();
    const existing = readArtifactState(stateFile);
    const removed: string[] = [];
    const kept: ManagedArtifactRecord[] = [];

    for (const record of existing) {
        if (record.renderer !== 'cursor-mdc') {
            kept.push(record);
            continue;
        }
        if (isAwmMdcCarrier(record)) {
            kept.push(record);
            continue;
        }
        if (!isUnderCursorRules(record.targetPath, opts.projectRoot)) {
            kept.push(record);
            continue;
        }
        safeUnlinkManaged(record.targetPath);
        removed.push(record.targetPath);
    }

    if (removed.length > 0) {
        writeArtifactState(kept, stateFile);
    }
    return { removed, kept: kept.length };
}
