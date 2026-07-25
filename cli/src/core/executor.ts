// src/core/executor.ts
import fs from 'fs';
import path from 'path';

export function removeArtifact(targetPath: string): void {
    let exists = false;
    try {
        fs.lstatSync(targetPath);
        exists = true;
    } catch {
        exists = false;
    }
    
    if (!exists) {
        throw new Error(`Artifact not found at: ${targetPath}`);
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
}

/**
 * Stages `sourcePath` next to `targetPath` (same parent directory) WITHOUT
 * touching `targetPath` itself (R17): the live target is never removed until
 * a stage has already succeeded. Returns the staged path, ready to be swapped
 * in via `replaceArtifact`.
 */
export function stageArtifact(
    sourcePath: string,
    targetPath: string,
    method: 'symlink' | 'copy',
): string {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const parent = path.dirname(targetPath);
    fs.mkdirSync(parent, { recursive: true });

    const staged = path.join(parent, `.${path.basename(targetPath)}.${process.pid}.staged`);
    fs.rmSync(staged, { recursive: true, force: true });

    if (method === 'symlink') {
        fs.symlinkSync(sourcePath, staged, 'dir');
    } else {
        fs.cpSync(sourcePath, staged, { recursive: true });
    }
    return staged;
}

/** Atomically swaps a staged artifact into `targetPath`, replacing whatever is there. */
export function replaceArtifact(staged: string, targetPath: string): void {
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.renameSync(staged, targetPath);
}

/**
 * Convenience wrapper over `stageArtifact` + `replaceArtifact` for callers
 * that don't need transactional multi-target coordination (see
 * install-transaction.ts's `applyInstallPlan` for the transactional path).
 */
export function installArtifact(sourcePath: string, targetPath: string, method: 'symlink' | 'copy'): void {
    const staged = stageArtifact(sourcePath, targetPath, method);
    replaceArtifact(staged, targetPath);
}
