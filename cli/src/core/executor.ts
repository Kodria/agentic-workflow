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

export function installArtifact(sourcePath: string, targetPath: string, method: 'symlink' | 'copy'): void {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    // Clean up existing if it exists
    fs.rmSync(targetPath, { recursive: true, force: true });

    if (method === 'symlink') {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
    } else {
        fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
}
