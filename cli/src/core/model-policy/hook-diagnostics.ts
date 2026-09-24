import fs from 'fs';
import path from 'path';
import { awmHome } from '../paths';
import { parseJsonNoDuplicate } from '../plan/json';
import { secureFs } from '../secure-fs/native-bridge';

type Phase = 'start' | 'stop';
type PhaseStatus = { lastSuccessAt?: string; lastFailureAt?: string; reasonCode?: string; count: number };
type Status = { schema: 'routing-hook-status/v1'; start: PhaseStatus; stop: PhaseStatus };
const fresh = (): Status => ({ schema: 'routing-hook-status/v1', start: { count: 0 }, stop: { count: 0 } });
function target(): string { return path.join(awmHome(), 'routing-hook-status.json'); }
function safeParents(file: string): void {
    const chain: string[] = [];
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) { chain.unshift(dir); if (dir === path.dirname(dir)) break; }
    for (const dir of chain) {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('routing hook status has an unsafe ancestor');
    }
}
function read(): { status: Status; observed: ReturnType<typeof secureFs.readRegularFile> | null } {
    const file = target(); safeParents(file);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: fresh(), observed: null }; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('routing hook status is unsafe');
    const observed = secureFs.readRegularFile(file, 8192);
    const value = parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(observed.bytes)) as Status;
    if (!value || value.schema !== 'routing-hook-status/v1' || !value.start || !value.stop
        || !Number.isSafeInteger(value.start.count) || !Number.isSafeInteger(value.stop.count)
        || value.start.count < 0 || value.stop.count < 0) throw new Error('routing hook status is corrupt');
    return { status: value, observed };
}

/** Failure is a redacted code, never provider payload or an exception string.
 * Returns true only for a newly alertable failure episode. */
export function recordRoutingHookStatus(phase: Phase, result: 'success' | string, now: Date = new Date()): boolean {
    if (phase !== 'start' && phase !== 'stop') throw new Error('routing hook phase is invalid');
    if (result !== 'success' && !/^[A-Z0-9_]{3,64}$/.test(result)) throw new Error('routing hook reason code is invalid');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('routing hook clock is invalid');
    const root = awmHome();
    return secureFs.withProjectLease(root, () => {
        const { status, observed } = read();
        const item = status[phase];
        const pending = item.lastFailureAt !== undefined && (item.lastSuccessAt === undefined || item.lastFailureAt > item.lastSuccessAt);
        const alert = result !== 'success' && (!pending || item.reasonCode !== result);
        if (result === 'success') item.lastSuccessAt = now.toISOString();
        else { item.lastFailureAt = now.toISOString(); item.reasonCode = result; item.count += 1; }
        const bytes = Buffer.from(`${JSON.stringify(status)}\n`);
        secureFs.writeProjectTransaction(root, path.basename(target()), bytes, observed
            ? { mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: observed.identity }
            : { mode: 'create', createParents: false });
        return alert;
    });
}
export function readRoutingHookStatus(): { state: 'absent' | 'healthy' | 'failed' | 'invalid'; failures?: Array<{ phase: Phase; reasonCode: string; count: number }> } {
    try {
        const { status, observed } = read();
        if (!observed) return { state: 'absent' };
        const failures = (['start', 'stop'] as const).flatMap(phase => {
            const item = status[phase];
            return item.lastFailureAt && item.reasonCode && (!item.lastSuccessAt || item.lastFailureAt > item.lastSuccessAt)
                ? [{ phase, reasonCode: item.reasonCode, count: item.count }] : [];
        });
        return failures.length ? { state: 'failed', failures } : { state: 'healthy' };
    } catch { return { state: 'invalid' }; }
}
