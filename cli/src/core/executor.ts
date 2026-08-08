// src/core/executor.ts
import fs from 'fs';
import path from 'path';
import { isWindowsNative } from './paths';

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
        const sourceIsDirectory = fs.statSync(sourcePath).isDirectory();
        if (sourceIsDirectory) {
            // A directory *symlink* ('dir') needs SeCreateSymbolicLinkPrivilege on
            // Windows — denied by default on unprivileged accounts, including
            // GitHub Actions' windows-latest runner, so every install here would
            // throw EPERM. A *junction* is a different NTFS reparse-point kind
            // that Windows lets any account create, and Node/libuv report it the
            // same way a symlink is reported (`lstat().isSymbolicLink()` is true,
            // `readlinkSync()` resolves it) — so every downstream consumer
            // (verify(), R19's provider-facts hashing, doctor's symlink checks)
            // keeps working unmodified. Junctions require an absolute target,
            // which `sourcePath` always is here (registry content roots are
            // resolved under `awmHome()`). POSIX platforms are unaffected: 'dir'
            // is a plain no-op hint there.
            fs.symlinkSync(sourcePath, staged, isWindowsNative() ? 'junction' : 'dir');
        } else {
            // A junction is an NTFS *directory* reparse point — it has no
            // equivalent for an individual FILE artifact (agent .md, workflow
            // .md, ...), so a file source must never be passed to it (it was,
            // before this branch existed, and that silently produced a
            // reparse point that could not resolve back to the file — see
            // tests/core/bundle-install.test.ts's "claude-code agents" case).
            // A 'file'-type symlink is the correct primitive here, but it
            // needs the same SeCreateSymbolicLinkPrivilege a directory symlink
            // does, and Windows has no privilege-free substitute for files the
            // way junctions are for directories. So: attempt the real symlink
            // (works, and keeps `awm update` propagation, whenever the
            // privilege IS available — e.g. Developer Mode) and fall back to a
            // plain copy otherwise, mirroring the established fallback already
            // used for the bootstrap skill file (hooks/claude.ts,
            // tests/commands/hooks/install-symlink-fallback.test.ts).
            try {
                fs.symlinkSync(sourcePath, staged, 'file');
            } catch {
                fs.copyFileSync(sourcePath, staged);
            }
        }
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
