// src/core/install-transaction.ts
//
// Transactional filesystem apply for InstallPlan (install-planner.ts):
// validates every target, backs up every existing target BEFORE any
// replacement happens (R24.1), replaces targets, verifies, and — on any
// failure — rolls back every target already replaced, in reverse order
// (R25). Never removes a live target before its staged replacement exists
// (R17, enforced by executor.ts's stageArtifact/replaceArtifact split).
//
// Also exports a general-purpose `beginBackupSession`, for callers outside
// the planner (e.g. preferences/provider-config mutations during `init`)
// that want the same backup/restore guarantees without going through a full
// InstallPlan. `applyInstallPlan` and `beginBackupSession` write independent
// backup directories under ~/.awm/backups/<transactionId>/, each with a
// manifest.json (mode 0600) inside a 0700 directory — paths and existence
// flags only, never file contents or environment variables.
import fs from 'fs';
import path from 'path';
import { InstallPlan, PlannedOperation } from './install-planner';
import { writeArtifactState } from './artifact-state';
import { awmHome } from './paths';
import { writeFileAtomic } from './atomic-file';
import { renderCodexAgent } from './renderers/codex-agent';
import { stageArtifact, replaceArtifact } from './executor';

export type InstallSummary = {
    installed: string[];
    skipped: string[];
    /** Basename of this transaction's backup directory under ~/.awm/backups. */
    transactionId: string;
    /** Every target path this transaction wrote to (whether or not it existed before). */
    modifiedFiles: string[];
};

export type TransactionDeps = {
    validate(op: PlannedOperation): void;
    backup(op: PlannedOperation, backupDir: string): string | null;
    stage(op: PlannedOperation): string;
    replace(op: PlannedOperation, staged: string): void;
    verify(op: PlannedOperation): void;
    rollback(op: PlannedOperation, backup: string | null): void;
};

export type BackupSession = {
    transactionId: string;
    targetPaths: string[];
    commit(): void;
    rollback(): void;
};

// ---------------------------------------------------------------------------
// Backup manifest — the on-disk record backing both applyInstallPlan's own
// rollback and the standalone restoreBackup/backup-session flows.
// ---------------------------------------------------------------------------

type BackupManifestEntry = {
    targetPath: string;
    existed: boolean;
    /** Path relative to the manifest's backup directory; null when the target didn't exist. */
    backupRelPath: string | null;
};

type BackupManifest = {
    id: string;
    createdAt: string;
    committed: boolean;
    entries: BackupManifestEntry[];
};

function ensureBackupDir(backupDir: string): void {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.chmodSync(backupDir, 0o700);
}

function writeBackupManifest(backupDir: string, manifest: BackupManifest): void {
    ensureBackupDir(backupDir);
    writeFileAtomic(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 0o600);
}

function readBackupManifest(manifestPath: string): BackupManifest {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`backup manifest not found: ${manifestPath}`);
    }
    let value: unknown;
    try {
        value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        throw new Error(`${manifestPath} is not valid JSON`);
    }
    const manifest = value as Partial<BackupManifest>;
    if (!manifest || typeof manifest.id !== 'string' || !Array.isArray(manifest.entries)) {
        throw new Error(`${manifestPath} is not a valid backup manifest`);
    }
    return manifest as BackupManifest;
}

function targetExists(targetPath: string): boolean {
    try {
        fs.lstatSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

/** Copies `targetPath` (if it exists) into `backupDir/relName` and returns the manifest entry. */
function backupEntryFor(targetPath: string, backupDir: string, relName: string): BackupManifestEntry {
    if (!targetExists(targetPath)) {
        return { targetPath, existed: false, backupRelPath: null };
    }
    ensureBackupDir(backupDir);
    // dereference:false (fs.cpSync default) — a symlinked target is backed up
    // as a symlink, not by copying whatever it points at.
    fs.cpSync(targetPath, path.join(backupDir, relName), { recursive: true });
    return { targetPath, existed: true, backupRelPath: relName };
}

/** Restores `targetPath` from its backup, or removes it if it didn't exist before. */
function restoreTargetFrom(targetPath: string, backupPath: string | null): void {
    fs.rmSync(targetPath, { recursive: true, force: true });
    if (backupPath !== null) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.cpSync(backupPath, targetPath, { recursive: true });
    }
}

function restoreManifestEntry(backupDir: string, entry: BackupManifestEntry): void {
    // Only ever operates on targetPath/backupRelPath literally enumerated in
    // the validated manifest — never on a path derived from user input.
    const backupPath = entry.existed && entry.backupRelPath ? path.join(backupDir, entry.backupRelPath) : null;
    restoreTargetFrom(entry.targetPath, backupPath);
}

// ---------------------------------------------------------------------------
// applyInstallPlan
// ---------------------------------------------------------------------------

/**
 * Real transactional apply for an InstallPlan. Order (per target, across the
 * whole plan):
 *   1. validate every op                         (no writes)
 *   2. backup every op's existing target          (before ANY replace — R24.1)
 *   3. stage every op's replacement                (source untouched, target untouched — R17)
 *   4. replace every op's target with its staged replacement
 *   5. verify every op
 *   6. persist artifact-state records
 * Any failure from step 4 onward rolls back every already-replaced target, in
 * reverse order, using the backups captured in step 2 (R25). Rollback is
 * best-effort: a rollback failure for one target does not stop the others
 * from being attempted, and never masks the original failure.
 */
export function applyInstallPlan(
    plan: InstallPlan,
    deps: TransactionDeps = defaultTransactionDeps(),
): InstallSummary {
    for (const op of plan.operations) deps.validate(op);

    const backupDir = path.join(
        awmHome(),
        'backups',
        new Date().toISOString().replace(/[:.]/g, '-'),
    );
    const transactionId = path.basename(backupDir);

    const backups = new Map<PlannedOperation, string | null>();
    for (const op of plan.operations) backups.set(op, deps.backup(op, backupDir));

    const staged = new Map<PlannedOperation, string>();
    for (const op of plan.operations) staged.set(op, deps.stage(op));

    const replaced: PlannedOperation[] = [];
    try {
        for (const op of plan.operations) {
            deps.replace(op, staged.get(op)!);
            replaced.push(op);
        }
        for (const op of plan.operations) deps.verify(op);
        writeArtifactState(plan.records);
    } catch (error) {
        for (const op of [...replaced].reverse()) {
            try {
                deps.rollback(op, backups.get(op) ?? null);
            } catch {
                // best-effort: retain the original failure; the backup path remains available for manual recovery
            }
        }
        throw error;
    }

    return {
        // Every owner in plan.reports — 'install' (the owner whose selection
        // caused the physical write) AND 'retain' (co-owners of the same
        // shared target, e.g. OpenCode+Codex sharing one skill directory) —
        // gained ownership of this target as a result of THIS run. The
        // user-facing summary must list all of them, not just the first
        // (R15/R15.1): a single physical write can still mean N providers now
        // own the artifact.
        installed: plan.reports
            .map((report) => `${path.basename(report.targetPath)} → ${report.owner}`),
        skipped: [],
        transactionId,
        modifiedFiles: plan.operations.map((op) => op.targetPath),
    };
}

function stageRenderedFile(content: string, targetPath: string): string {
    const parent = path.dirname(targetPath);
    fs.mkdirSync(parent, { recursive: true });
    const staged = path.join(parent, `.${path.basename(targetPath)}.${process.pid}.staged`);
    fs.rmSync(staged, { recursive: true, force: true });
    fs.writeFileSync(staged, content, 'utf8');
    return staged;
}

/**
 * The real, filesystem-touching TransactionDeps used by applyInstallPlan by
 * default. Renders `codex-agent-toml` targets from the canonical agent
 * Markdown source at stage time; every other renderer uses the plain
 * symlink/copy staging from executor.ts. Never logs target contents or
 * environment variables.
 */
export function defaultTransactionDeps(): TransactionDeps {
    let index = 0;
    let createdAt: string | null = null;
    const manifestEntries: BackupManifestEntry[] = [];

    return {
        validate(op) {
            if (!fs.existsSync(op.sourcePath)) {
                throw new Error(`Source path does not exist: ${op.sourcePath}`);
            }
            if (op.renderer === 'codex-agent-toml') {
                // Renders without writing anything, purely to surface parse errors
                // before any backup/replace happens.
                renderCodexAgent(fs.readFileSync(op.sourcePath, 'utf8'));
            }
        },

        backup(op, backupDir) {
            if (createdAt === null) createdAt = new Date().toISOString();
            const entry = backupEntryFor(op.targetPath, backupDir, String(index));
            index += 1;
            manifestEntries.push(entry);
            writeBackupManifest(backupDir, {
                id: path.basename(backupDir),
                createdAt,
                committed: false,
                entries: manifestEntries,
            });
            return entry.existed ? path.join(backupDir, entry.backupRelPath!) : null;
        },

        stage(op) {
            if (op.renderer === 'codex-agent-toml') {
                const rendered = renderCodexAgent(fs.readFileSync(op.sourcePath, 'utf8'));
                return stageRenderedFile(rendered, op.targetPath);
            }
            return stageArtifact(op.sourcePath, op.targetPath, op.method);
        },

        replace(op, staged) {
            replaceArtifact(staged, op.targetPath);
        },

        verify(op) {
            let stat: fs.Stats;
            try {
                stat = fs.lstatSync(op.targetPath);
            } catch {
                throw new Error(`verification failed: ${op.targetPath} is missing after install`);
            }
            if (op.renderer === 'codex-agent-toml') {
                if (!stat.isFile()) {
                    throw new Error(`verification failed: ${op.targetPath} is not a regular file`);
                }
                const content = fs.readFileSync(op.targetPath, 'utf8');
                if (!content.startsWith('name = ')) {
                    throw new Error(`verification failed: ${op.targetPath} does not look like rendered TOML`);
                }
                return;
            }
            if (op.method === 'symlink' && !stat.isSymbolicLink()) {
                throw new Error(`verification failed: ${op.targetPath} is not a symlink`);
            }
            if (op.method === 'copy' && stat.isSymbolicLink()) {
                throw new Error(`verification failed: ${op.targetPath} is unexpectedly a symlink`);
            }
        },

        rollback(op, backup) {
            restoreTargetFrom(op.targetPath, backup);
        },
    };
}

// ---------------------------------------------------------------------------
// beginBackupSession — general-purpose backup wrapper for mutations outside
// the planner (preferences, provider configs, etc.)
// ---------------------------------------------------------------------------

function createBackupManifest(targets: string[], backupDir: string): BackupManifest {
    const entries = targets.map((target, i) => backupEntryFor(target, backupDir, String(i)));
    return {
        id: path.basename(backupDir),
        createdAt: new Date().toISOString(),
        committed: false,
        entries,
    };
}

function markBackupCommitted(backupDir: string): void {
    const manifest = readBackupManifest(path.join(backupDir, 'manifest.json'));
    writeBackupManifest(backupDir, { ...manifest, committed: true });
}

/**
 * Backs up every (currently existing) path in `targetPaths` before the
 * caller mutates them. `commit()` marks the backup as no-longer-needed
 * (kept for manual recovery, never auto-deleted); `rollback()` restores
 * every target to its pre-session state (or removes it, if it did not exist
 * before the session began).
 */
export function beginBackupSession(targetPaths: string[]): BackupSession {
    const unique = Array.from(new Set(targetPaths.map((target) => path.resolve(target))));
    if (unique.some((target) => target === path.parse(target).root)) {
        throw new Error('refusing to back up a filesystem root');
    }
    const transactionId = new Date().toISOString().replace(/[:]/g, '-');
    const backupDir = path.join(awmHome(), 'backups', transactionId);
    const manifest = createBackupManifest(unique, backupDir);
    writeBackupManifest(backupDir, manifest);
    return {
        transactionId,
        targetPaths: unique,
        commit: () => markBackupCommitted(backupDir),
        rollback: () => {
            restoreBackup(transactionId);
        },
    };
}

// ---------------------------------------------------------------------------
// restoreBackup — explicit, ID-scoped restore (also used by `awm backup restore`)
// ---------------------------------------------------------------------------

/**
 * Restores every target recorded in the given transaction's manifest.
 * `transactionId` is untrusted input (it reaches here from CLI args) — it is
 * validated against a strict format AND the resolved backup directory is
 * checked to stay inside ~/.awm/backups before any read, to rule out path
 * traversal. Only targets literally enumerated in the manifest are touched.
 */
export function restoreBackup(transactionId: string): { restored: string[] } {
    if (!/^\d{4}-\d{2}-\d{2}T[0-9A-Za-z.-]+$/.test(transactionId)) {
        throw new Error('invalid backup transaction id');
    }
    const root = path.join(awmHome(), 'backups');
    const dir = path.join(root, transactionId);
    if (!dir.startsWith(`${root}${path.sep}`)) {
        throw new Error('backup path escapes AWM backup root');
    }
    const manifest = readBackupManifest(path.join(dir, 'manifest.json'));
    const restored: string[] = [];
    for (const entry of manifest.entries) {
        restoreManifestEntry(dir, entry);
        restored.push(entry.targetPath);
    }
    return { restored };
}

export type BackupSummary = {
    id: string;
    createdAt: string;
    committed: boolean;
    targets: string[];
};

/** Lists every recorded backup transaction under ~/.awm/backups, newest first. Corrupt manifests are skipped. */
export function listBackups(): BackupSummary[] {
    const root = path.join(awmHome(), 'backups');
    if (!fs.existsSync(root)) return [];
    const ids = fs.readdirSync(root).filter((name) => {
        try {
            return fs.statSync(path.join(root, name)).isDirectory();
        } catch {
            return false;
        }
    });
    const summaries: BackupSummary[] = [];
    for (const id of ids) {
        const manifestPath = path.join(root, id, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const manifest = readBackupManifest(manifestPath);
            summaries.push({
                id: manifest.id,
                createdAt: manifest.createdAt,
                committed: manifest.committed,
                targets: manifest.entries.map((entry) => entry.targetPath),
            });
        } catch {
            // corrupt manifest — skip rather than fail the whole listing
        }
    }
    return summaries.sort((a, b) => b.id.localeCompare(a.id));
}
