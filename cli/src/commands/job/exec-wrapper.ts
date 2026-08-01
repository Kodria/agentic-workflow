// PROCESO EXTERNO real (bloqueador 3): el supervisor lo spawnea detached y no
// lo espera. Hace el spawn demostrable (design R1.8): claim exclusivo por
// spawnNonce -> identidad real persistida -> ejecucion independiente ->
// resultado terminal atomico. La matriz de replay es LA UNICA (R3.3).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { captureSelfRef, captureRefFor, NONCE_ENV } from '../../core/journal/process';
import { redactText } from '../../core/journal/redact';
import { writeFileAtomicDurable, fsyncDirSync } from '../../core/atomic-file';
import type { ProcessRef } from '../../core/journal/types';

export function claimPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.claim`);
}
export function identityPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.identity.json`);
}
export function resultPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.result.json`);
}
export function logPath(logsRoot: string, jobId: string, nonce: string): string {
    return path.join(logsRoot, `${jobId}.${nonce}.log`);
}

export type ReplayVerdict = 'never-started' | 'completed' | 'unprovable';
export function replayVerdict(logsRoot: string, jobId: string, nonce: string): ReplayVerdict {
    if (!fs.existsSync(claimPath(logsRoot, jobId, nonce))) return 'never-started';
    if (fs.existsSync(resultPath(logsRoot, jobId, nonce))) return 'completed';
    return 'unprovable';
}

export interface WrapperIdentity { jobId: string; nonce: string; wrapper: ProcessRef; command: ProcessRef; }
export interface WrappedResult { exitCode: number; endedAt: string; resultPath: string; }

const MAX_LOG_BYTES = 1024 * 1024;   // retencion acotada (R2.5)

export async function runExecWrapper(opts: { logsRoot: string; jobId: string; nonce: string; argv: string[]; cwd: string }): Promise<WrappedResult> {
    const { logsRoot, jobId, nonce, argv, cwd } = opts;
    if (argv.length === 0) throw new Error('argv vacio');
    fs.mkdirSync(logsRoot, { recursive: true, mode: 0o700 });
    // (1) claim exclusivo DURABLE — wx + fsync de archivo y de directorio
    let fd: number;
    try {
        fd = fs.openSync(claimPath(logsRoot, jobId, nonce), 'wx', 0o600);
    } catch {
        throw new Error(`claim ya existe para ${jobId}/${nonce}: spawn previo no descartable (R1.8)`);
    }
    try {
        fs.writeFileSync(fd, JSON.stringify({ jobId, nonce, claimedAt: new Date().toISOString(), wrapperPid: process.pid }) + '\n');
        fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fsyncDirSync(logsRoot);

    const finish = (exitCode: number): WrappedResult => {
        const result: WrappedResult = { exitCode, endedAt: new Date().toISOString(), resultPath: resultPath(logsRoot, jobId, nonce) };
        // (4) resultado terminal atomico junto al claim
        writeFileAtomicDurable(result.resultPath, JSON.stringify(result, null, 2) + '\n', 0o600);
        return result;
    };

    // (2) spawn del comando EN EL GRUPO DEL WRAPPER (detached:false): un solo
    // process group por job, independiente del supervisor (R4.7: shell:false,
    // argv como array, secretos solo por referencia de entorno).
    const [exe, ...args] = argv;
    const child = spawn(exe, args, {
        cwd, shell: false, detached: false,
        env: { ...process.env, [NONCE_ENV]: nonce },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const spawnFailed: Promise<number | null> = new Promise((resolve) => {
        child.on('error', () => resolve(127));
        child.on('spawn', () => resolve(null));
    });
    const failed = await spawnFailed;
    if (failed !== null || child.pid === undefined) return finish(127);

    // (3) identidad REAL persistida ANTES de esperar el resultado: ProcessRef
    // del wrapper Y del comando (bloqueador 3: nunca mas pid/pgid cero).
    const identity: WrapperIdentity = {
        jobId, nonce,
        wrapper: captureSelfRef(nonce),
        command: captureRefFor(child.pid, nonce, argv),
    };
    writeFileAtomicDurable(identityPath(logsRoot, jobId, nonce), JSON.stringify(identity, null, 2) + '\n', 0o600);

    // ejecucion con salida redactada y acotada (R2.3, R2.5)
    let logged = 0;
    const logFile = logPath(logsRoot, jobId, nonce);
    const append = (chunk: Buffer) => {
        if (logged >= MAX_LOG_BYTES) return;
        const text = redactText(chunk.toString('utf8'));
        logged += Buffer.byteLength(text);
        fs.appendFileSync(logFile, text, { mode: 0o600 });
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const exitCode: number = await new Promise((resolve) => {
        child.on('close', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(127));
    });
    return finish(exitCode);
}
