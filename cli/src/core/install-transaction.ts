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
import crypto from 'crypto';
import { InstallPlan, PlannedOperation } from './install-planner';
import { mergeArtifactRecords, readArtifactState, writeArtifactState } from './artifact-state';
import { awmHome } from './paths';
import { writeFileAtomic } from './atomic-file';
import { renderArtifact } from './renderers/registry';
import { stageArtifact, replaceArtifact } from './executor';

/**
 * The single timestamp-sanitization rule for transaction IDs, shared by
 * `applyInstallPlan` and `beginBackupSession` so both always produce IDs
 * `restoreBackup`'s validation regex (`^\d{4}-\d{2}-\d{2}T[0-9A-Za-z.-]+$`)
 * accepts. Strips both `:` and `.` (an ISO timestamp has both) so the result
 * is filesystem- and regex-safe either way.
 */
/** Id de transaccion: timestamp + sufijo aleatorio.
 *
 *  El timestamp solo tiene resolucion de 1 ms y NO era unico. Dos
 *  transacciones en el mismo milisegundo (p. ej. `syncProfile`, que corre una
 *  por extension en un loop) producian el mismo id, y como cada una reescribe
 *  `manifest.json` con SUS entradas y numera los slots de backup desde 0, la
 *  segunda pisaba el backup de la primera: el respaldo del archivo original del
 *  usuario quedaba irrecuperable y `awm backup restore <id>` restauraba el
 *  target equivocado. Es un agujero en el unico mecanismo del que depende toda
 *  la promesa de "siempre se puede revertir". El regex de `restoreBackup` ya
 *  acepta este formato. */
function sanitizeTransactionTimestamp(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

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
    /** sha256 of the backed-up content; omitted when the target didn't exist (nothing to hash). */
    contentHash?: string;
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

/**
 * sha256 of the target's content, for the manifest's integrity record.
 * Files hash their bytes directly; directories and symlinks hash a stable
 * summary (entry name + kind + size + mtime, or the symlink's own target)
 * rather than walking and hashing every file individually — enough to detect
 * "the backup no longer matches what's on disk" without the cost of a full
 * recursive content hash.
 */
function computeContentHash(targetPath: string): string {
    const hash = crypto.createHash('sha256');
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
        hash.update('symlink:').update(fs.readlinkSync(targetPath));
    } else if (stat.isDirectory()) {
        hash.update('dir:');
        for (const name of fs.readdirSync(targetPath).sort()) {
            const entryStat = fs.lstatSync(path.join(targetPath, name));
            const kind = entryStat.isDirectory() ? 'd' : entryStat.isSymbolicLink() ? 'l' : 'f';
            hash.update(`${name}:${kind}:${entryStat.size}:${entryStat.mtimeMs}\n`);
        }
    } else {
        hash.update(fs.readFileSync(targetPath));
    }
    return hash.digest('hex');
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
    return { targetPath, existed: true, backupRelPath: relName, contentHash: computeContentHash(targetPath) };
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
 *   6. persist artifact-state records — merged into the existing ledger
 *      (upsert by targetPath, see mergeArtifactRecords), not a wholesale
 *      overwrite, so earlier applyInstallPlan calls' records survive
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

    const backupDir = path.join(awmHome(), 'backups', sanitizeTransactionTimestamp());
    const transactionId = path.basename(backupDir);

    const backups = new Map<PlannedOperation, string | null>();
    for (const op of plan.operations) backups.set(op, deps.backup(op, backupDir));

    const staged = new Map<PlannedOperation, string>();
    try {
        for (const op of plan.operations) staged.set(op, deps.stage(op));
    } catch (error) {
        // Best-effort: clean up any temp files earlier iterations already
        // staged before this one threw — none of them have been swapped in
        // yet (replace() hasn't run), so there's nothing to roll back, just
        // orphaned staging artifacts to remove.
        for (const stagedPath of staged.values()) {
            try {
                fs.rmSync(stagedPath, { recursive: true, force: true });
            } catch {
                // best-effort: retain the original failure
            }
        }
        throw error;
    }

    const replaced: PlannedOperation[] = [];
    try {
        for (const op of plan.operations) {
            deps.replace(op, staged.get(op)!);
            replaced.push(op);
        }
        for (const op of plan.operations) deps.verify(op);
        // Upsert this plan's records into the EXISTING persisted ledger,
        // keyed by targetPath — a real `awm init` run makes several separate
        // applyInstallPlan calls (one per bundle), and each one only knows
        // about the artifacts IT touched. Writing plan.records wholesale
        // would silently discard every earlier call's ownership records
        // (BLOCKER found in post-implementation QA); merging preserves them.
        writeArtifactState(mergeArtifactRecords(readArtifactState(), plan.records));
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
 * `cursor-mdc`/`copilot-instructions` targets are always 'skill'-type
 * operations (providers/index.ts only assigns these renderers to a
 * provider's `skill` ArtifactConfig), whose `sourcePath` is the skill's
 * DIRECTORY (discovery.ts's `discoverSkills`/bundle-install.ts's
 * `expandBundleArtifacts` both set it that way — the whole directory is what
 * a `link` renderer symlinks), not the SKILL.md file itself. Both renderers
 * are sourced from that directory's SKILL.md, so every call site needs this
 * same one-line join instead of reading `op.sourcePath` directly.
 */
/**
 * The real, filesystem-touching TransactionDeps used by applyInstallPlan by
 * default. Renders `codex-agent-toml`/`cursor-mdc`/`copilot-instructions`
 * targets from their respective canonical sources at stage time; every other
 * renderer ('link') uses the plain symlink/copy staging from executor.ts.
 * Never logs target contents or environment variables.
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
            // Renders without writing anything, purely to surface parse errors
            // before any backup/replace happens.
            // Renderiza y descarta: el objetivo es que un error de parseo salte ANTES
            // de tocar nada. El dispatch sale de la tabla (`renderArtifact`), no de una
            // copia local — esta era una de las dos que habia en este archivo.
            renderArtifact(op.renderer, op.sourcePath);
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
            const rendered = renderArtifact(op.renderer, op.sourcePath);
            // `null` = renderer `link`: no genera contenido, se instala el artefacto tal cual.
            return rendered === null
                ? stageArtifact(op.sourcePath, op.targetPath, op.method)
                : stageRenderedFile(rendered, op.targetPath);
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
            if (op.renderer === 'cursor-mdc') {
                if (!stat.isFile()) {
                    throw new Error(`verification failed: ${op.targetPath} is not a regular file`);
                }
                const content = fs.readFileSync(op.targetPath, 'utf8');
                if (!content.startsWith('---\n') || !content.includes('alwaysApply:')) {
                    throw new Error(`verification failed: ${op.targetPath} does not look like rendered Cursor .mdc`);
                }
                return;
            }
            if (op.renderer === 'copilot-instructions') {
                if (!stat.isFile()) {
                    throw new Error(`verification failed: ${op.targetPath} is not a regular file`);
                }
                const content = fs.readFileSync(op.targetPath, 'utf8');
                if (!content.startsWith('---\n') || !content.includes('applyTo:')) {
                    throw new Error(`verification failed: ${op.targetPath} does not look like rendered Copilot instructions`);
                }
                return;
            }
            if (op.method === 'symlink' && !stat.isSymbolicLink()) {
                // executor.ts's stageArtifact falls back to a plain copy for a
                // FILE source when the real 'file'-type symlink throws (no
                // privilege-free equivalent to a directory junction exists for
                // individual files on Windows) — accept that fallback here
                // rather than failing verification for an install that landed
                // correctly, just not as a symlink. A directory source always
                // gets a privilege-free junction and should never legitimately
                // reach this branch, so this stays scoped to files only.
                const sourceIsDirectory = fs.existsSync(op.sourcePath) && fs.statSync(op.sourcePath).isDirectory();
                const acceptableFileFallback = !sourceIsDirectory && stat.isFile();
                if (!acceptableFileFallback) {
                    throw new Error(`verification failed: ${op.targetPath} is not a symlink`);
                }
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
    const transactionId = sanitizeTransactionTimestamp();
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
