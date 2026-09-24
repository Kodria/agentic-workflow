import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { emptyState, type JournalState } from '../../core/journal/types';
import { readJournal } from '../../core/journal/store';
import { bindingPlanPath, branchSlug, journalDir, statePath, supervisorLockPath } from '../../core/journal/paths';
import { fsyncDirSync } from '../../core/atomic-file';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';

function controlledDirectory(directory: string): void {
    try {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unused bootstrap archive rejects unsafe directory: ${directory}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export interface WatchJournalStatus {
    state: 'missing' | 'corrupt' | 'present';
    cycleState?: JournalState['cycle']['status'];
    latestGeneration?: { n: number; token: string; state: JournalState['generations'][number]['state'] };
    binding?: { path: string; digest: string; executionDigest?: string; executionIdentitySchema?: string; schema: string; executionMode: string; boundAt: string };
    bootstrapUnused: boolean;
}

/** Read-only status of this branch, not directory-wide journal-first inference.
 * A corrupt or linked tree is never reported as absence. No plan body, prompt,
 * command argv or task/verdict content crosses this public observation. */
export function watchJournalStatus(repoRoot: string, branch: string): WatchJournalStatus {
    const file = statePath(repoRoot, branch);
    try {
        for (const directory of [path.join(repoRoot, '.awm'), path.join(repoRoot, '.awm/journal'), journalDir(repoRoot, branch)]) controlledDirectory(directory);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return { state: 'corrupt', bootstrapUnused: false };
    } catch (error) {
        return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'corrupt', bootstrapUnused: false };
    }
    const current = readJournal(repoRoot, branch);
    if (current.corrupt || !current.state || current.state.branch !== branch) return { state: 'corrupt', bootstrapUnused: false };
    let bootstrapUnused = false;
    try { assertUnused(current.state); assertUnusedTree(repoRoot, branch); bootstrapUnused = true; }
    catch { /* recognized present journal, but never eligible by absence alone */ }
    const binding = current.state.planBinding;
    const latest = current.state.generations.reduce<JournalState['generations'][number] | undefined>(
        (prev, generation) => prev === undefined || generation.n > prev.n ? generation : prev, undefined);
    return {
        state: 'present', cycleState: current.state.cycle.status, bootstrapUnused,
        ...(latest ? { latestGeneration: { n: latest.n, token: latest.token, state: latest.state } } : {}),
        ...(binding ? { binding: { path: binding.path, digest: binding.digest, ...(binding.executionDigest ? { executionDigest: binding.executionDigest, executionIdentitySchema: binding.executionIdentitySchema } : {}), schema: binding.schema, executionMode: binding.executionMode, boundAt: binding.boundAt } } : {}),
    };
}

/** Default-deny: only the exact unexecuted bootstrap shape is archivable.
 * Future runtime fields automatically make this route ineligible. */
function assertUnused(state: JournalState): void {
    const initial = emptyState(state.branch);
    const allowed = new Set([...Object.keys(initial), 'planBinding', 'planBindingHistory']);
    const bootstrap = initial.cycle.nextAction;
    if (state.schema !== 2 || !state.planBinding || state.cycle.status !== 'IN_PROGRESS'
        || Object.keys(state).some(key => !allowed.has(key))
        || Object.keys(state.cycle).some(key => !['status', 'startedAt', 'nextAction'].includes(key))
        || JSON.stringify(state.cycle.nextAction) !== JSON.stringify(bootstrap)
        || state.tasks.length !== 0 || state.cycleVerificationPlan.length !== 0
        || state.generations.length !== 0 || state.dispatches.length !== 0
        || Object.keys(state.jobs).length !== 0 || state.verdicts.length !== 0 || state.fixes.length !== 0
        || Object.keys(state.appliedRequests).length !== 0 || state.requestProblems.length !== 0
        || (state.custodyDecisions?.length ?? 0) !== 0) {
        throw new Error('unused bootstrap requerido: el journal tiene ejecución, evidencia o estado no reconocido; no se archiva');
    }
}

function assertUnusedTree(repoRoot: string, branch: string): void {
    const root = journalDir(repoRoot, branch);
    const emptyDirectories = new Set(['requests', 'acks', 'logs', 'export']);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (entry.isSymbolicLink()) throw new Error('unused bootstrap rejects symlink artifact');
        if (entry.name === 'state.json' && entry.isFile()) continue;
        if (emptyDirectories.has(entry.name) && entry.isDirectory() && fs.readdirSync(file).length === 0) continue;
        throw new Error(`unused bootstrap has runtime or unrecognized artifact: ${entry.name}`);
    }
}

/** Remove ONLY an unused admission bootstrap from the active namespace by one
 * recoverable rename. The archived state remains IN_PROGRESS, not COMPLETE;
 * no task, verdict, cycle evidence, or claimed native execution is generated. */
export function archiveUnusedWatch(repoRoot: string, branch: string, planPath: string): { archived: string; kind: 'unused-bootstrap'; journalId: string } {
    const canonicalPlan = bindingPlanPath(planPath);
    const before = readJournal(repoRoot, branch);
    if (before.corrupt || !before.state) throw new Error('unused bootstrap journal inexistente, corrupto o inseguro');
    const lockPath = supervisorLockPath(repoRoot);
    try { if (fs.lstatSync(lockPath).isSymbolicLink()) throw new Error('unused bootstrap rejects symlink lock'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const archiveRoot = path.join(repoRoot, '.awm', 'journal-unused');
    controlledDirectory(archiveRoot);
    const lock = acquireLock(repoRoot);
    try {
        verifyBranchInvariant(repoRoot, branch);
        const current = readJournal(repoRoot, branch);
        if (current.corrupt || !current.state || current.state.branch !== branch) throw new Error('unused bootstrap journal corrupto o de otra rama');
        if (current.state.planBinding?.path !== canonicalPlan) throw new Error('unused bootstrap requiere la misma ruta canónica del plan');
        assertUnused(current.state);
        assertUnusedTree(repoRoot, branch);
        controlledDirectory(archiveRoot);
        if (!fs.existsSync(archiveRoot)) fs.mkdirSync(archiveRoot, { mode: 0o700 });
        controlledDirectory(archiveRoot);
        fsyncDirSync(path.dirname(archiveRoot));
        const source = journalDir(repoRoot, branch);
        const destination = path.join(archiveRoot, `${branchSlug(branch)}.${crypto.randomUUID()}`);
        if (fs.existsSync(destination)) throw new Error('unused bootstrap archive destination already exists');
        // A single directory rename is the commit point; before it the source
        // exists, after it the original byte-for-byte state is recoverable.
        fs.renameSync(source, destination);
        fsyncDirSync(archiveRoot);
        fsyncDirSync(path.dirname(source));
        return { archived: path.relative(repoRoot, destination).split(path.sep).join('/'), kind: 'unused-bootstrap', journalId: current.state.journalId };
    } finally { releaseLock(repoRoot, lock); }
}
