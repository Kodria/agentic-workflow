import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export type RuntimeExecutable = { version: string; binaryDigest: string; inferenceDispatched: false };
export type RuntimeExecutableQuery = { command: string; args: string[]; timeoutMs: number };

function executablePath(command: string): string {
    if (typeof command !== 'string' || command.length === 0 || command.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(command)) throw new Error('runtime executable command is invalid');
    const candidates = path.isAbsolute(command) ? [command] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, command));
    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            const real = fs.realpathSync(candidate);
            if (!fs.statSync(real).isFile()) continue;
            return real;
        } catch { /* keep looking */ }
    }
    throw new Error('runtime executable is unavailable');
}

function versionOf(file: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(file, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
        let settled = false;
        let output = '';
        const finish = (error?: Error, version?: string): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) { child.kill(); reject(error); }
            else resolve(version!);
        };
        const timer = setTimeout(() => finish(new Error('runtime version query timed out')), timeoutMs);
        child.on('error', () => finish(new Error('runtime executable could not start')));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 4096) finish(new Error('runtime version output exceeds limit')); });
        child.on('exit', code => {
            if (code !== 0) return finish(new Error('runtime version command failed'));
            const match = output.match(/\b(?:v)?(\d+\.\d+\.\d+)\b/);
            if (!match) return finish(new Error('runtime version is unavailable'));
            finish(undefined, match[1]);
        });
    });
}

function hashFile(file: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const before = fs.statSync(file);
        if (!before.isFile() || before.size > 512 * 1024 * 1024) return reject(new Error('runtime executable file is invalid or too large'));
        const hash = createHash('sha256');
        const stream = fs.createReadStream(file);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', () => reject(new Error('runtime executable could not be read')));
        stream.on('end', () => {
            const after = fs.statSync(file);
            if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return reject(new Error('runtime executable changed while hashing'));
            resolve(hash.digest('hex'));
        });
    });
}

/** Fingerprint the executable reached by PATH and query only --version. */
export async function queryRuntimeExecutable(input: RuntimeExecutableQuery): Promise<RuntimeExecutable> {
    if (!input || typeof input !== 'object' || !Array.isArray(input.args) || input.args.length !== 1 || input.args[0] !== '--version'
        || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000) throw new Error('runtime version query is invalid');
    const file = executablePath(input.command);
    const version = await versionOf(file, input.timeoutMs);
    const binaryDigest = await hashFile(file);
    return { version, binaryDigest, inferenceDispatched: false };
}
